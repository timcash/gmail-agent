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
        threadId: "thread-working",
        requestText: "Continue the logs route cleanup and reply with the final diff summary.",
        requestedAt: "2026-04-17T18:00:00.000Z",
        status: "working",
        workflowStage: "green",
        workerSummary: "Focused on the logs route and browser smoke."
      }
    },
    threads: {
      "thread-working": {
        threadId: "thread-working",
        subject: "codex keep working on logs",
        updatedAt: "2026-04-17T18:10:00.000Z",
        lastStatus: "working",
        taskIds: ["task-0001"],
        workspaceKey: "linker",
        lastUserMessageId: "msg-work-2"
      }
    }
  };
}

function createMailboxFixtures() {
  const labelCatalog = [
    { id: "INBOX", name: "INBOX" },
    { id: "UNREAD", name: "UNREAD" },
    { id: "STARRED", name: "STARRED" },
    { id: "SENT", name: "SENT" },
    { id: "Label_reply", name: "Needs Reply" },
    { id: "Label_codex", name: "Codex/Working" }
  ];
  const messageCatalog = {
    "msg-human-1": {
      id: "msg-human-1",
      threadId: "thread-human",
      internalDate: "1776471600000",
      labelIds: ["INBOX", "UNREAD", "Label_reply"],
      payload: {
        headers: [
          { name: "Subject", value: "Quick question about next week" },
          { name: "From", value: "Jane <jane@example.com>" },
          { name: "To", value: "Repo Owner <owner@example.com>" }
        ]
      },
      snippet: "Are you free Tuesday afternoon?",
      bodyText: "Are you free Tuesday afternoon?"
    },
    "msg-work-1": {
      id: "msg-work-1",
      threadId: "thread-working",
      internalDate: "1776468120000",
      labelIds: ["INBOX", "STARRED", "Label_codex"],
      payload: {
        headers: [
          { name: "Subject", value: "codex keep working on logs" },
          { name: "From", value: "Repo Owner <owner@example.com>" },
          { name: "To", value: "Repo Owner <owner@example.com>" }
        ]
      },
      snippet: "The logs route is almost done.",
      bodyText: "The logs route is almost done."
    },
    "msg-work-2": {
      id: "msg-work-2",
      threadId: "thread-working",
      internalDate: "1776468300000",
      labelIds: ["INBOX", "STARRED", "Label_codex"],
      payload: {
        headers: [
          { name: "Subject", value: "codex keep working on logs" },
          { name: "From", value: "Repo Owner <owner@example.com>" },
          { name: "To", value: "Repo Owner <owner@example.com>" }
        ]
      },
      snippet: "Please keep going and finish the smoke test.",
      bodyText: "Please keep going and finish the smoke test."
    },
    "msg-sent-1": {
      id: "msg-sent-1",
      threadId: "thread-sent",
      internalDate: "1776464700000",
      labelIds: ["SENT"],
      payload: {
        headers: [
          { name: "Subject", value: "Tuesday follow-up" },
          { name: "From", value: "Repo Owner <owner@example.com>" },
          { name: "To", value: "Jane <jane@example.com>" }
        ]
      },
      snippet: "Tuesday afternoon works for me.",
      bodyText: "Tuesday afternoon works for me."
    }
  };

  return {
    labelCatalog,
    messageCatalog
  };
}

async function withServer(run) {
  const state = createState();
  const { labelCatalog, messageCatalog } = createMailboxFixtures();
  const readThreadCalls = [];
  const replyCalls = [];
  const composeCalls = [];
  const markReadCalls = [];
  const markUnreadCalls = [];
  const starCalls = [];
  const unstarCalls = [];
  const archiveCalls = [];
  const moveToInboxCalls = [];
  const events = [];
  const server = await startMailApiServer({
    allowedOrigins: [
      /^https:\/\/[a-z0-9-]+\.github\.io$/i,
      /^http:\/\/127\.0\.0\.1(?::\d+)?$/
    ],
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
    listLabels: async () => labelCatalog,
    searchMessages: async (query, maxResults) => {
      const normalizedQuery = String(query || "").toLowerCase();
      const baseMatches = Object.values(messageCatalog).filter((message) => {
        if (normalizedQuery.includes("in:sent")) {
          return message.labelIds.includes("SENT");
        }

        if (normalizedQuery.includes("subject:codex")) {
          return /codex/i.test(message.payload.headers[0].value);
        }

        if (normalizedQuery.includes("is:starred")) {
          return message.labelIds.includes("STARRED");
        }

        if (normalizedQuery.includes("in:inbox is:unread")) {
          return message.labelIds.includes("INBOX") && message.labelIds.includes("UNREAD");
        }

        if (normalizedQuery.includes("in:anywhere")) {
          return true;
        }

        if (normalizedQuery.includes("in:inbox")) {
          return message.labelIds.includes("INBOX");
        }

        return true;
      }).filter((message) => {
        if (!normalizedQuery.includes("tuesday")) {
          return true;
        }

        const searchable = [
          message.payload.headers[0].value,
          message.snippet,
          message.bodyText
        ].join(" ").toLowerCase();
        return searchable.includes("tuesday");
      });

      return {
        messages: baseMatches.slice(0, Math.max(1, maxResults)),
        resultSizeEstimate: baseMatches.length
      };
    },
    readMessage: async (messageId) => {
      const message = messageCatalog[messageId];

      if (!message) {
        return null;
      }

      return {
        id: message.id,
        thread_id: message.threadId,
        subject: message.payload.headers.find((header) => header.name === "Subject")?.value || "",
        from: { email: "sender@example.com", name: "Sender" },
        to: [{ email: "owner@example.com", name: "Repo Owner" }],
        date: new Date(Number(message.internalDate)).toUTCString(),
        body_text: message.bodyText,
        snippet: message.snippet
      };
    },
    markThreadRead: async (threadId) => {
      markReadCalls.push(threadId);
      return { threadId };
    },
    markThreadUnread: async (threadId) => {
      markUnreadCalls.push(threadId);
      return { threadId };
    },
    starThread: async (threadId) => {
      starCalls.push(threadId);
      return { threadId };
    },
    unstarThread: async (threadId) => {
      unstarCalls.push(threadId);
      return { threadId };
    },
    archiveThread: async (threadId) => {
      archiveCalls.push(threadId);
      return { threadId };
    },
    moveThreadToInbox: async (threadId) => {
      moveToInboxCalls.push(threadId);
      return { threadId };
    },
    persist: async () => {},
    readThread: async (threadId) => {
      readThreadCalls.push(threadId);
      if (threadId === "thread-working") {
        return {
          id: threadId,
          messages: [messageCatalog["msg-work-1"], messageCatalog["msg-work-2"]]
        };
      }

      if (threadId === "thread-human") {
        return {
          id: threadId,
          messages: [messageCatalog["msg-human-1"]]
        };
      }

      if (threadId === "thread-sent") {
        return {
          id: threadId,
          messages: [messageCatalog["msg-sent-1"]]
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
      archiveCalls,
      baseUrl: `http://${server.host}:${server.port}`,
      composeCalls,
      events,
      markReadCalls,
      markUnreadCalls,
      moveToInboxCalls,
      readThreadCalls,
      replyCalls,
      starCalls,
      unstarCalls
    });
  } finally {
    await server.close();
  }
}

test("mail api exposes Gmail inbox views and search-backed thread lists", async () => {
  await withServer(async ({ baseUrl }) => {
    const viewsResponse = await fetch(`${baseUrl}/api/mail/views`, {
      headers: {
        Origin: "http://127.0.0.1:4173"
      }
    });
    const viewsPayload = await viewsResponse.json();

    assert.equal(viewsResponse.status, 200);
    assert.deepEqual(
      viewsPayload.views.map((view) => [view.id, view.count]),
      [
        ["inbox", 3],
        ["unread", 1],
        ["starred", 2],
        ["sent", 1],
        ["all-mail", 4],
        ["codex", 2]
      ]
    );

    const threadsResponse = await fetch(`${baseUrl}/api/mail/threads?view=inbox&q=Tuesday`, {
      headers: {
        Origin: "http://127.0.0.1:4173"
      }
    });
    const threadsPayload = await threadsResponse.json();

    assert.equal(threadsResponse.status, 200);
    assert.equal(threadsPayload.view, "inbox");
    assert.equal(threadsPayload.searchQuery, "Tuesday");
    assert.equal(threadsPayload.threads.length, 1);
    assert.equal(threadsPayload.threads[0].threadId, "thread-human");
    assert.equal(threadsPayload.threads[0].subject, "Quick question about next week");
    assert.equal(threadsPayload.threads[0].unread, true);
    assert.deepEqual(threadsPayload.threads[0].labelNames, ["Inbox", "Unread", "Needs Reply"]);
  });
});

test("mail api exposes detail plus inbox actions, reply, and compose", async () => {
  await withServer(async ({
    archiveCalls,
    baseUrl,
    composeCalls,
    events,
    markReadCalls,
    markUnreadCalls,
    moveToInboxCalls,
    readThreadCalls,
    replyCalls,
    starCalls,
    unstarCalls
  }) => {
    const detailResponse = await fetch(`${baseUrl}/api/mail/thread/thread-working`, {
      headers: {
        Origin: "http://127.0.0.1:4173"
      }
    });
    const detailPayload = await detailResponse.json();

    assert.equal(detailResponse.status, 200);
    assert.equal(detailPayload.thread.summary.threadId, "thread-working");
    assert.equal(detailPayload.thread.summary.starred, true);
    assert.equal(detailPayload.thread.actions.canUnstar, true);
    assert.equal(detailPayload.thread.actions.canArchive, true);
    assert.equal(detailPayload.thread.messages.length, 2);
    assert.equal(readThreadCalls.includes("thread-working"), true);

    const archiveResponse = await fetch(`${baseUrl}/api/mail/thread/thread-working/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:4173"
      },
      body: JSON.stringify({ action: "archive" })
    });
    assert.equal(archiveResponse.status, 200);
    assert.deepEqual(archiveCalls, ["thread-working"]);

    const unstarResponse = await fetch(`${baseUrl}/api/mail/thread/thread-working/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:4173"
      },
      body: JSON.stringify({ action: "unstar" })
    });
    assert.equal(unstarResponse.status, 200);
    assert.deepEqual(unstarCalls, ["thread-working"]);

    const unreadResponse = await fetch(`${baseUrl}/api/mail/thread/thread-working/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:4173"
      },
      body: JSON.stringify({ action: "mark-unread" })
    });
    assert.equal(unreadResponse.status, 200);
    assert.deepEqual(markUnreadCalls, ["thread-working"]);

    const moveToInboxResponse = await fetch(`${baseUrl}/api/mail/thread/thread-working/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:4173"
      },
      body: JSON.stringify({ action: "move-to-inbox" })
    });
    assert.equal(moveToInboxResponse.status, 200);
    assert.deepEqual(moveToInboxCalls, ["thread-working"]);

    const readResponse = await fetch(`${baseUrl}/api/mail/thread/thread-working/read`, {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:4173"
      }
    });
    assert.equal(readResponse.status, 200);
    assert.deepEqual(markReadCalls, ["thread-working"]);

    const starResponse = await fetch(`${baseUrl}/api/mail/thread/thread-working/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:4173"
      },
      body: JSON.stringify({ action: "star" })
    });
    assert.equal(starResponse.status, 200);
    assert.deepEqual(starCalls, ["thread-working"]);

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
      [
        "mail_api_archive",
        "mail_api_unstar",
        "mail_api_mark_unread",
        "mail_api_move_to_inbox",
        "mail_api_mark_read",
        "mail_api_star",
        "mail_api_reply_sent",
        "mail_api_compose_sent"
      ]
    );
  });
});

test("mail api allows GitHub Pages private-network preflight to loopback", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/mail/health`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.github.io",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Private-Network": "true"
      }
    });

    assert.equal(response.status, 204);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://example.github.io"
    );
    assert.equal(
      response.headers.get("access-control-allow-private-network"),
      "true"
    );
  });
});
