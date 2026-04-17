const test = require("node:test");
const assert = require("node:assert/strict");

const {
  startMailApiServer
} = require("../src/codex-mail-api");

function createState() {
  return {
    activeTaskId: "task-0002",
    events: [],
    nextEventSequence: 1,
    queue: ["task-0001"],
    tasks: {
      "task-0001": {
        id: "task-0001",
        threadId: "thread-queued",
        requestText: "Please review the onboarding flow and tighten the copy.",
        requestedAt: "2026-04-17T17:00:00.000Z",
        status: "queued",
        workflowStage: "plan"
      },
      "task-0002": {
        id: "task-0002",
        threadId: "thread-working",
        requestText: "Continue the logs route cleanup and reply with the final diff summary.",
        requestedAt: "2026-04-17T18:00:00.000Z",
        status: "working",
        workflowStage: "green",
        workerSummary: "Focused on the logs route and browser smoke."
      },
      "task-0003": {
        id: "task-0003",
        threadId: "thread-done",
        requestText: "Publish the updated README notes.",
        requestedAt: "2026-04-17T16:00:00.000Z",
        status: "done",
        completedAt: "2026-04-17T16:30:00.000Z",
        workerSummary: "README shipped."
      }
    },
    threads: {
      "thread-needs-reply": {
        threadId: "thread-needs-reply",
        subject: "Quick question about next week",
        updatedAt: "2026-04-17T19:00:00.000Z",
        lastTriageCategory: "needs-reply",
        taskIds: [],
        lastUserMessageId: "msg-human-1"
      },
      "thread-waiting": {
        threadId: "thread-waiting",
        subject: "Waiting for vendor approval",
        updatedAt: "2026-04-17T18:30:00.000Z",
        lastTriageCategory: "waiting",
        taskIds: []
      },
      "thread-queued": {
        threadId: "thread-queued",
        subject: "codex please review onboarding",
        updatedAt: "2026-04-17T17:05:00.000Z",
        lastStatus: "queued",
        taskIds: ["task-0001"],
        workspaceKey: "linker"
      },
      "thread-working": {
        threadId: "thread-working",
        subject: "codex keep working on logs",
        updatedAt: "2026-04-17T18:10:00.000Z",
        lastStatus: "working",
        taskIds: ["task-0002"],
        workspaceKey: "linker",
        lastUserMessageId: "msg-work-2"
      },
      "thread-done": {
        threadId: "thread-done",
        subject: "codex update README",
        updatedAt: "2026-04-17T16:35:00.000Z",
        lastStatus: "done",
        taskIds: ["task-0003"],
        workspaceKey: "linker"
      }
    }
  };
}

async function withServer(run) {
  const state = createState();
  const readCalls = [];
  const replyCalls = [];
  const composeCalls = [];
  const markReadCalls = [];
  const events = [];
  const server = await startMailApiServer({
    allowedOrigins: [/^http:\/\/127\.0\.0\.1(?::\d+)?$/],
    getMailboxProfile: () => ({
      displayName: "Repo Owner",
      emailAddress: "owner@example.com"
    }),
    getRuntimeInfo: () => ({
      pid: 1234,
      mode: "evented-watch",
      publicOrigin: "https://codex.dialtone.earth"
    }),
    getState: () => state,
    host: "127.0.0.1",
    port: 0,
    publicOrigin: "https://codex.dialtone.earth",
    markThreadRead: async (threadId) => {
      markReadCalls.push(threadId);
      return { threadId };
    },
    persist: async () => {},
    readThread: async (threadId) => {
      readCalls.push(threadId);
      if (threadId === "thread-working") {
        return {
          id: threadId,
          messages: [
            {
              id: "msg-work-1",
              from: { email: "owner@example.com", name: "Repo Owner" },
              to: [{ email: "owner@example.com", name: "Repo Owner" }],
              bodyText: "The logs route is almost done.",
              snippet: "The logs route is almost done."
            },
            {
              id: "msg-work-2",
              from: { email: "owner@example.com", name: "Repo Owner" },
              to: [{ email: "owner@example.com", name: "Repo Owner" }],
              payload: {
                mimeType: "multipart/alternative",
                parts: [
                  {
                    mimeType: "text/plain",
                    body: {
                      data: Buffer.from("Please keep going and finish the smoke test.", "utf8")
                        .toString("base64")
                        .replace(/\+/g, "-")
                        .replace(/\//g, "_")
                        .replace(/=+$/g, "")
                    }
                  }
                ]
              },
              snippet: "Please keep going and finish the smoke test."
            }
          ]
        };
      }

      if (threadId === "thread-needs-reply") {
        return {
          id: threadId,
          messages: [
            {
              id: "msg-human-1",
              from: { email: "jane@example.com", name: "Jane" },
              to: [{ email: "owner@example.com", name: "Repo Owner" }],
              bodyText: "Are you free Tuesday afternoon?",
              snippet: "Are you free Tuesday afternoon?"
            }
          ]
        };
      }

      return {
        id: threadId,
        messages: []
      };
    },
    recordEvent: (type, details) => {
      events.push({ type, details });
    },
    replyToMessage: async (messageId, body) => {
      replyCalls.push({ messageId, body });
      return { id: "reply-1" };
    },
    sendEmail: async ({ to, subject, body }) => {
      composeCalls.push({ to, subject, body });
      return { id: "sent-1" };
    }
  });

  try {
    await run({
      baseUrl: `http://${server.host}:${server.port}`,
      composeCalls,
      events,
      markReadCalls,
      readCalls,
      replyCalls,
      state
    });
  } finally {
    await server.close();
  }
}

test("mail api returns compact views and filtered thread lists", async () => {
  await withServer(async ({ baseUrl }) => {
    const viewsResponse = await fetch(`${baseUrl}/api/mail/views`, {
      headers: {
        Origin: "http://127.0.0.1:4173"
      }
    });
    const viewsPayload = await viewsResponse.json();

    assert.equal(viewsResponse.status, 200);
    assert.equal(viewsPayload.ok, true);
    assert.deepEqual(
      viewsPayload.views.map((view) => [view.id, view.count]),
      [
        ["inbox", 5],
        ["needs-reply", 1],
        ["waiting", 1],
        ["queued", 1],
        ["working", 1],
        ["done", 1]
      ]
    );
    assert.equal(
      viewsResponse.headers.get("access-control-allow-origin"),
      "http://127.0.0.1:4173"
    );

    const threadsResponse = await fetch(`${baseUrl}/api/mail/threads?view=working`, {
      headers: {
        Origin: "http://127.0.0.1:4173"
      }
    });
    const threadsPayload = await threadsResponse.json();

    assert.equal(threadsResponse.status, 200);
    assert.equal(threadsPayload.view, "working");
    assert.equal(threadsPayload.threads.length, 1);
    assert.equal(threadsPayload.threads[0].threadId, "thread-working");
    assert.match(threadsPayload.threads[0].excerpt, /logs route cleanup/i);
    assert.deepEqual(threadsPayload.threads[0].badges, ["working", "green"]);
  });
});

test("mail api exposes thread detail plus read, reply, and compose actions", async () => {
  await withServer(async ({ baseUrl, composeCalls, events, markReadCalls, readCalls, replyCalls }) => {
    const detailResponse = await fetch(`${baseUrl}/api/mail/thread/thread-working`, {
      headers: {
        Origin: "http://127.0.0.1:4173"
      }
    });
    const detailPayload = await detailResponse.json();

    assert.equal(detailResponse.status, 200);
    assert.equal(detailPayload.ok, true);
    assert.equal(detailPayload.thread.summary.threadId, "thread-working");
    assert.equal(detailPayload.thread.messages.length, 2);
    assert.match(detailPayload.thread.messages[1].bodyText, /finish the smoke test/i);
    assert.equal(detailPayload.thread.latestReplyToMessageId, "msg-work-2");
    assert.equal(readCalls.includes("thread-working"), true);

    const markReadResponse = await fetch(`${baseUrl}/api/mail/thread/thread-working/read`, {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:4173"
      }
    });
    assert.equal(markReadResponse.status, 200);
    assert.deepEqual(markReadCalls, ["thread-working"]);

    const replyResponse = await fetch(`${baseUrl}/api/mail/thread/thread-working/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:4173"
      },
      body: JSON.stringify({
        body: "I cleaned up the logs route and I am rerunning the smoke now."
      })
    });
    const replyPayload = await replyResponse.json();

    assert.equal(replyResponse.status, 200);
    assert.equal(replyPayload.responseId, "reply-1");
    assert.deepEqual(replyCalls, [{
      messageId: "msg-work-2",
      body: "I cleaned up the logs route and I am rerunning the smoke now."
    }]);

    const composeResponse = await fetch(`${baseUrl}/api/mail/compose`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:4173"
      },
      body: JSON.stringify({
        to: "jane@example.com",
        subject: "Follow-up",
        body: "Tuesday afternoon works for me."
      })
    });
    const composePayload = await composeResponse.json();

    assert.equal(composeResponse.status, 200);
    assert.equal(composePayload.id, "sent-1");
    assert.deepEqual(composeCalls, [{
      to: "jane@example.com",
      subject: "Follow-up",
      body: "Tuesday afternoon works for me."
    }]);
    assert.deepEqual(
      events.map((event) => event.type),
      ["mail_api_mark_read", "mail_api_reply_sent", "mail_api_compose_sent"]
    );
  });
});
