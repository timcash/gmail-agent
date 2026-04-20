const test = require("node:test");
const assert = require("node:assert/strict");

const { CodexEmailSystem } = require("../src/codex-system");
const TEST_NAME = "Repo Owner";
const TEST_MAILBOX = "owner@example.com";
const TEST_HOME = "C:\\Users\\example";
const TEST_WORKSPACE = `${TEST_HOME}\\linker`;

function makeMessage(overrides = {}) {
  return {
    id: "msg-1",
    thread_id: "thread-1",
    subject: "codex please help",
    body_text: "Please review the repo and summarize it.",
    from: {
      name: TEST_NAME,
      email: TEST_MAILBOX
    },
    to: [
      {
        name: TEST_NAME,
        email: TEST_MAILBOX
      }
    ],
    cc: null,
    ...overrides
  };
}

function makeWorkspaceResolver(workspaces = {}) {
  return async (workspaceToken) => {
    const normalized = String(workspaceToken || "").trim().replace(/\\/g, "/").toLowerCase();
    return workspaces[normalized] || null;
  };
}

class FakeTransport {
  constructor() {
    this.nextReplyId = 1;
    this.readThreadIds = [];
    this.replies = [];
    this.threadTriage = {};
    this.threadTriageHistory = [];
    this.threadStatus = {};
    this.threadStatusHistory = [];
  }

  async ensureLabels(labelNames) {
    return Object.fromEntries(labelNames.map((name) => [name, `label:${name}`]));
  }

  async setThreadStatus(threadId, status) {
    this.threadStatus[threadId] = status;
    this.threadStatusHistory.push({ threadId, status });
  }

  async setThreadTriage(threadId, triage) {
    this.threadTriage[threadId] = triage;
    this.threadTriageHistory.push({ threadId, triage });
  }

  async replyToMessage(messageId, body) {
    const reply = {
      id: `reply-${this.nextReplyId++}`,
      messageId,
      body
    };

    this.replies.push(reply);
    return reply;
  }

  async markThreadRead(threadId) {
    this.readThreadIds.push(threadId);
    return { threadId };
  }
}

class FakeWorkerRunner {
  constructor() {
    this.calls = [];
    this.sessionCounter = 1;
  }

  async runTask(context) {
    const sessionId = context.threadState.workerSessionId || `worker-session-${this.sessionCounter++}`;

    this.calls.push({
      taskId: context.task.id,
      threadId: context.task.threadId,
      sessionId,
      requestText: context.task.requestText,
      workspacePath: context.task.workspacePath || null
    });

    return {
      sessionId,
      replyBody: `worker reply for ${context.task.id}: ${context.task.requestText}`,
      summary: "ok"
    };
  }
}

class ControlledWorkerRunner {
  constructor() {
    this.calls = [];
    this.pending = [];
    this.sessionCounter = 1;
  }

  async runTask(context) {
    const sessionId = context.threadState.workerSessionId || `worker-session-${this.sessionCounter++}`;

    this.calls.push({
      taskId: context.task.id,
      threadId: context.task.threadId,
      sessionId,
      requestText: context.task.requestText,
      workspacePath: context.task.workspacePath || null
    });

    return new Promise((resolve) => {
      this.pending.push(() => resolve({
        sessionId,
        replyBody: `worker reply for ${context.task.id}`
      }));
    });
  }

  releaseNext() {
    const next = this.pending.shift();

    if (next) {
      next();
    }
  }
}

class FakeMonitorRunner {
  constructor() {
    this.calls = [];
    this.sessionId = "monitor-session-1";
  }

  async reviewTask(context) {
    this.calls.push({
      taskId: context.task.id,
      workerReply: context.workerResult.replyBody
    });

    return {
      approved: true,
      issues: [],
      replyBody: `monitor approved\n\n${context.workerResult.replyBody}`,
      sessionId: this.sessionId
    };
  }
}

test("new work email gets an immediate queue ack and a final monitored reply", async () => {
  const transport = new FakeTransport();
  const workerRunner = new FakeWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    transport,
    workerRunner
  });

  await system.initialize();
  await system.ingestMessage(makeMessage());
  await system.waitForIdle();

  assert.equal(transport.replies.length, 2);
  assert.match(transport.replies[0].body, /status: in-work/);
  assert.match(transport.replies[1].body, /monitor approved/);
  assert.deepEqual(transport.readThreadIds, ["thread-1", "thread-1", "thread-1"]);
  assert.equal(system.state.tasks["task-0001"].status, "done");
  assert.equal(system.state.threads["thread-1"].workerSessionId, "worker-session-1");
  assert.equal(system.state.monitor.sessionId, "monitor-session-1");
  assert.equal(transport.threadStatus["thread-1"], "done");
});

test("only one message is worked at a time and later requests stay queued", async () => {
  const transport = new FakeTransport();
  const workerRunner = new ControlledWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    transport,
    workerRunner
  });

  await system.initialize();
  await system.ingestMessage(makeMessage({ id: "msg-1", thread_id: "thread-1", subject: "codex task one" }));
  await system.ingestMessage(makeMessage({ id: "msg-2", thread_id: "thread-2", subject: "codex task two" }));

  assert.equal(system.state.activeTaskId, "task-0001");
  assert.deepEqual(system.state.queue, ["task-0002"]);
  assert.match(transport.replies[0].body, /status: in-work/);
  assert.match(transport.replies[1].body, /status: queued/);

  workerRunner.releaseNext();
  await new Promise((resolve) => setImmediate(resolve));
  workerRunner.releaseNext();
  await system.waitForIdle();

  assert.equal(system.state.tasks["task-0001"].status, "done");
  assert.equal(system.state.tasks["task-0002"].status, "done");
  assert.equal(transport.threadStatus["thread-1"], "done");
  assert.equal(transport.threadStatus["thread-2"], "done");
});

test("follow-up emails in the same thread reuse the worker session", async () => {
  const transport = new FakeTransport();
  const workerRunner = new FakeWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    transport,
    workerRunner
  });

  await system.initialize();
  await system.ingestMessage(makeMessage({ id: "msg-1", thread_id: "thread-1", subject: "codex first task" }));
  await system.waitForIdle();
  await system.ingestMessage(makeMessage({
    id: "msg-2",
    thread_id: "thread-1",
    subject: "Re: codex follow up",
    body_text: "Please continue with the same session."
  }));
  await system.waitForIdle();

  assert.equal(workerRunner.calls.length, 2);
  assert.equal(workerRunner.calls[0].sessionId, workerRunner.calls[1].sessionId);
  assert.equal(system.state.threads["thread-1"].workerSessionId, workerRunner.calls[0].sessionId);
});

test("status messages are answered by the monitor without creating new work", async () => {
  const transport = new FakeTransport();
  const workerRunner = new FakeWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    transport,
    workerRunner
  });

  await system.initialize();
  await system.ingestMessage(makeMessage({ id: "msg-1", thread_id: "thread-1", subject: "codex do work" }));
  await system.waitForIdle();
  const taskCountBefore = Object.keys(system.state.tasks).length;

  await system.ingestMessage(makeMessage({
    id: "msg-2",
    thread_id: "thread-1",
    subject: "codex status",
    body_text: ""
  }));

  assert.equal(Object.keys(system.state.tasks).length, taskCountBefore);
  assert.match(transport.replies[2].body, /active-task:/);
  assert.equal(system.state.threads["thread-1"].lastStatus, "done");
});

test("natural language liveness questions stay on the monitor path", async () => {
  const transport = new FakeTransport();
  const workerRunner = new FakeWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    transport,
    workerRunner
  });

  await system.initialize();
  await system.ingestMessage(makeMessage({
    id: "msg-1",
    thread_id: "thread-1",
    subject: "codex is the gmail-agent up and running?",
    body_text: ""
  }));
  await system.waitForIdle();

  assert.equal(workerRunner.calls.length, 0);
  assert.equal(Object.keys(system.state.tasks).length, 0);
  assert.equal(transport.replies.length, 1);
  assert.match(transport.replies[0].body, /status: awake/);
});

test("non-command inbox mail is triaged into a label without creating work or replies", async () => {
  const transport = new FakeTransport();
  const workerRunner = new FakeWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    transport,
    workerRunner
  });

  await system.initialize();
  const result = await system.ingestMessage(makeMessage({
    id: "msg-1",
    thread_id: "thread-alert",
    subject: "New Passkey added to Luma",
    body_text: "Platform: iOS\nAuthenticator: Google Password Manager\nLocation: Example City",
    from: {
      name: "Luma",
      email: "support@luma.com"
    },
    to: [
      { name: TEST_NAME, email: TEST_MAILBOX }
    ]
  }));

  assert.equal(result.action, "triaged");
  assert.equal(result.category, "alert");
  assert.equal(workerRunner.calls.length, 0);
  assert.equal(transport.replies.length, 0);
  assert.equal(system.state.threads["thread-alert"].lastTriageCategory, "alert");
  assert.equal(transport.threadTriage["thread-alert"].labelName, "mail/alert");
  assert.equal(system.state.messages["msg-1"].kind, "triaged");
});

test("human external mail is triaged as needs-reply instead of ignored", async () => {
  const transport = new FakeTransport();
  const workerRunner = new FakeWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    transport,
    workerRunner
  });

  await system.initialize();
  const result = await system.ingestMessage(makeMessage({
    id: "msg-1",
    thread_id: "thread-human",
    subject: "Quick question about next week",
    body_text: "Are you free to chat on Tuesday afternoon?",
    from: {
      name: "Jane Doe",
      email: "jane@example.com"
    },
    to: [
      { name: TEST_NAME, email: TEST_MAILBOX }
    ]
  }));

  assert.equal(result.action, "triaged");
  assert.equal(result.category, "needs-reply");
  assert.equal(workerRunner.calls.length, 0);
  assert.equal(transport.replies.length, 0);
  assert.equal(transport.threadTriage["thread-human"].labelName, "mail/needs-reply");
});

test("slash commands are handled directly without invoking the worker", async () => {
  const transport = new FakeTransport();
  const workerRunner = new FakeWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    transport,
    workerRunner
  });

  await system.initialize();
  await system.ingestMessage(makeMessage({
    id: "msg-1",
    thread_id: "thread-1",
    subject: "codex/help",
    body_text: ""
  }));

  assert.equal(workerRunner.calls.length, 0);
  assert.equal(Object.keys(system.state.tasks).length, 0);
  assert.equal(transport.replies.length, 1);
  assert.deepEqual(transport.readThreadIds, ["thread-1", "thread-1"]);
  assert.match(transport.replies[0].body, /Direct monitor commands:/);
});

test("help command returns the system guide and recommended workflow", async () => {
  const transport = new FakeTransport();
  const workerRunner = new FakeWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    transport,
    workerRunner
  });

  await system.initialize();
  await system.ingestMessage(makeMessage({
    id: "msg-guide",
    thread_id: "thread-guide",
    subject: "codex/help",
    body_text: ""
  }));

  assert.equal(workerRunner.calls.length, 0);
  assert.equal(Object.keys(system.state.tasks).length, 0);
  assert.equal(transport.replies.length, 1);
  assert.match(transport.replies[0].body, /What the system is:/);
  assert.match(transport.replies[0].body, /Recommended workflow:/);
  assert.match(transport.replies[0].body, /Good starter commands:/);
  assert.match(transport.replies[0].body, /Triage is label-only right now\. It does not auto-archive mail\./);
  assert.match(transport.replies[0].body, /codex\/task latest/);
});

test("task inspection commands report recent tasks without creating new work", async () => {
  const transport = new FakeTransport();
  const workerRunner = new FakeWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    transport,
    workerRunner
  });

  await system.initialize();
  await system.ingestMessage(makeMessage({
    id: "msg-1",
    thread_id: "thread-1",
    subject: "codex finish the first task"
  }));
  await system.waitForIdle();
  const taskCountBefore = Object.keys(system.state.tasks).length;

  await system.ingestMessage(makeMessage({
    id: "msg-2",
    thread_id: "thread-1",
    subject: "codex/tasks 5",
    body_text: ""
  }));

  assert.equal(Object.keys(system.state.tasks).length, taskCountBefore);
  assert.equal(workerRunner.calls.length, 1);
  assert.match(transport.replies[2].body, /recent-tasks: 1/);
  assert.match(transport.replies[2].body, /task-0001 done/);
});

test("health and config commands stay on the monitor path", async () => {
  const transport = new FakeTransport();
  const workerRunner = new FakeWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    runtimeInfoProvider: () => ({
      mode: "evented-watch",
      pid: 1234,
      query: "subject:codex newer_than:30d",
      reconcileIntervalMs: 15000,
      triageQuery: "in:inbox newer_than:14d -subject:codex -label:mail/alert",
      watchRenewHours: 24
    }),
    transport,
    workerRunner
  });

  await system.initialize();
  await system.ingestMessage(makeMessage({
    id: "msg-1",
    thread_id: "thread-1",
    subject: "codex/health",
    body_text: ""
  }));
  await system.ingestMessage(makeMessage({
    id: "msg-2",
    thread_id: "thread-1",
    subject: "codex/config",
    body_text: ""
  }));

  assert.equal(workerRunner.calls.length, 0);
  assert.equal(Object.keys(system.state.tasks).length, 0);
  assert.equal(transport.replies.length, 2);
  assert.match(transport.replies[0].body, /health: healthy/);
  assert.match(transport.replies[0].body, /triage-mode: label-only/);
  assert.match(transport.replies[1].body, /single-flight-worker: enabled/);
  assert.match(transport.replies[1].body, /subject-prefix: codex/);
  assert.match(transport.replies[1].body, /triage-label-count: 6/);
  assert.match(transport.replies[1].body, /watch-triage-query: in:inbox/);
});

test("workspace command pins the thread folder without creating worker work", async () => {
  const transport = new FakeTransport();
  const workerRunner = new FakeWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    runtimeInfoProvider: () => ({
      workspaceRoot: "C:\\Users\\timca"
    }),
    transport,
    workerRunner,
    workspaceResolver: makeWorkspaceResolver({
      linker: {
        key: "linker",
        path: "C:\\Users\\timca\\linker"
      }
    })
  });

  await system.initialize();
  await system.ingestMessage(makeMessage({
    id: "msg-1",
    thread_id: "thread-1",
    subject: "codex/workspace linker",
    body_text: ""
  }));

  assert.equal(workerRunner.calls.length, 0);
  assert.equal(Object.keys(system.state.tasks).length, 0);
  assert.equal(system.state.threads["thread-1"].workspaceKey, "linker");
  assert.equal(system.state.threads["thread-1"].workspacePath, "C:\\Users\\timca\\linker");
  assert.match(transport.replies[0].body, /status: workspace-pinned/);
  assert.match(transport.replies[0].body, /workspace: linker -> C:\\Users\\timca\\linker/);
});

test("slash workspace shorthand creates work in the pinned folder and reuses it on follow-up", async () => {
  const transport = new FakeTransport();
  const workerRunner = new FakeWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    transport,
    workerRunner,
    workspaceResolver: makeWorkspaceResolver({
      linker: {
        key: "linker",
        path: "C:\\Users\\timca\\linker"
      }
    })
  });

  await system.initialize();
  await system.ingestMessage(makeMessage({
    id: "msg-1",
    thread_id: "thread-1",
    subject: "codex/linker fix the build",
    body_text: ""
  }));
  await system.waitForIdle();
  await system.ingestMessage(makeMessage({
    id: "msg-2",
    thread_id: "thread-1",
    subject: "Re: codex follow up",
    body_text: "Please continue in the same folder."
  }));
  await system.waitForIdle();

  assert.equal(workerRunner.calls.length, 2);
  assert.equal(workerRunner.calls[0].workspacePath, "C:\\Users\\timca\\linker");
  assert.equal(workerRunner.calls[1].workspacePath, "C:\\Users\\timca\\linker");
  assert.equal(system.state.tasks["task-0001"].workspaceKey, "linker");
  assert.equal(system.state.tasks["task-0002"].workspaceKey, "linker");
  assert.match(transport.replies[0].body, /workspace: linker -> C:\\Users\\timca\\linker/);
});

test("bare slash workspace shorthand pins the thread without creating an empty task", async () => {
  const transport = new FakeTransport();
  const workerRunner = new FakeWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    runtimeInfoProvider: () => ({
      workspaceRoot: "C:\\Users\\timca"
    }),
    transport,
    workerRunner,
    workspaceResolver: makeWorkspaceResolver({
      linker: {
        key: "linker",
        path: "C:\\Users\\timca\\linker"
      }
    })
  });

  await system.initialize();
  await system.ingestMessage(makeMessage({
    id: "msg-1",
    thread_id: "thread-1",
    subject: "codex/linker",
    body_text: ""
  }));

  assert.equal(workerRunner.calls.length, 0);
  assert.equal(Object.keys(system.state.tasks).length, 0);
  assert.equal(system.state.threads["thread-1"].workspaceKey, "linker");
  assert.match(transport.replies[0].body, /status: workspace-pinned/);
});

test("body commands on the first line are handled directly without worker execution", async () => {
  const transport = new FakeTransport();
  const workerRunner = new FakeWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    transport,
    workerRunner
  });

  await system.initialize();
  await system.ingestMessage(makeMessage({
    id: "msg-1",
    thread_id: "thread-1",
    subject: "codex",
    body_text: "codex/ps\n\nshow the daemon status"
  }));

  assert.equal(workerRunner.calls.length, 0);
  assert.equal(Object.keys(system.state.tasks).length, 0);
  assert.equal(transport.replies.length, 1);
  assert.match(transport.replies[0].body, /status: awake/);
  assert.match(transport.replies[0].body, /queue-depth:/);
});

test("unknown slash workspace shorthand returns a workspace error instead of creating work", async () => {
  const transport = new FakeTransport();
  const workerRunner = new FakeWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    transport,
    workerRunner
  });

  await system.initialize();
  await system.ingestMessage(makeMessage({
    id: "msg-1",
    thread_id: "thread-1",
    subject: "codex/not-a-command",
    body_text: ""
  }));

  assert.equal(workerRunner.calls.length, 0);
  assert.equal(Object.keys(system.state.tasks).length, 0);
  assert.equal(transport.replies.length, 1);
  assert.match(transport.replies[0].body, /status: workspace-not-found/);
});

test("old daemon replies are ignored by signature during reconciliation", async () => {
  const transport = new FakeTransport();
  const workerRunner = new FakeWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    transport,
    workerRunner
  });

  await system.initialize();
  await system.ingestMessage(makeMessage({
    id: "msg-1",
    thread_id: "thread-1",
    subject: "Re: codex old thread",
    body_text: "codex monitor\n\nstatus: in-work\ntask: task-9999"
  }));

  assert.equal(workerRunner.calls.length, 0);
  assert.equal(Object.keys(system.state.tasks).length, 0);
  assert.equal(transport.replies.length, 0);
  assert.deepEqual(transport.readThreadIds, ["thread-1"]);
  assert.equal(system.state.messages["msg-1"].replyKind, "signature_match");
});

test("messages with outside participants are ignored in self-only mode", async () => {
  const transport = new FakeTransport();
  const workerRunner = new FakeWorkerRunner();
  const monitorRunner = new FakeMonitorRunner();
  const system = new CodexEmailSystem({
    mailboxEmail: TEST_MAILBOX,
    monitorRunner,
    persistState: async () => {},
    transport,
    workerRunner
  });

  await system.initialize();
  const result = await system.ingestMessage(makeMessage({
    id: "msg-1",
    to: [
      { name: TEST_NAME, email: TEST_MAILBOX },
      { name: "Other", email: "other@example.com" }
    ]
  }));

  assert.equal(result.action, "ignored_external");
  assert.equal(transport.replies.length, 0);
  assert.deepEqual(system.state.queue, []);
  assert.equal(system.state.activeTaskId, null);
});
