const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTriageReconcileQuery,
  buildExecCommandArgs,
  callStructuredCodexSession,
  CodexMonitorRunner,
  CodexWorkerRunner
} = require("../src/codex-daemon");
const TEST_MAILBOX = "owner@example.com";
const TEST_HOME = "C:\\Users\\example";
const TEST_REPO = `${TEST_HOME}\\gmail-agent`;
const TEST_SAMPLE = `${TEST_HOME}\\codex-e2e-sample`;

function makeWorkerContext() {
  return {
    mailboxEmail: TEST_MAILBOX,
    persist: async () => {},
    state: {
      monitor: {
        sessionId: null
      }
    },
    task: {
      id: "task-0001",
      subject: "codex improve monitor rigor",
      threadId: "thread-1",
      requestText: "make the monitor enforce a TDD workflow and finish with a README update",
      workspacePath: TEST_REPO,
      workflowHistory: []
    },
    threadState: {
      threadId: "thread-1",
      workerSessionId: null,
      workspacePath: TEST_REPO
    }
  };
}

test("buildTriageReconcileQuery backfills untriaged inbox mail without touching codex threads", () => {
  const query = buildTriageReconcileQuery();

  assert.match(query, /in:inbox/);
  assert.match(query, /newer_than:14d/);
  assert.match(query, /-subject:codex/);
  assert.match(query, /-subject:codex-314/);
  assert.match(query, /-label:mail\/needs-reply/);
  assert.match(query, /-label:mail\/alert/);
});

test("buildExecCommandArgs keeps approval and sandbox flags at the top level for new and resumed runs", () => {
  assert.deepEqual(
    buildExecCommandArgs({
      approvalPolicy: "never",
      cwd: TEST_REPO,
      sandboxMode: "danger-full-access"
    }),
    ["-a", "never", "-C", TEST_REPO, "-s", "danger-full-access", "exec"]
  );

  assert.deepEqual(
    buildExecCommandArgs({
      approvalPolicy: "never",
      cwd: TEST_SAMPLE,
      sandboxMode: "read-only",
      sessionId: "session-123"
    }),
    [
      "-a",
      "never",
      "-C",
      TEST_SAMPLE,
      "-s",
      "read-only",
      "exec",
      "resume",
      "session-123"
    ]
  );

  assert.deepEqual(
    buildExecCommandArgs({
      cwd: "C:\\Users\\timca\\codex-e2e-sample",
      dangerousBypass: true,
      sessionId: "session-456"
    }),
    [
      "--dangerously-bypass-approvals-and-sandbox",
      "-C",
      "C:\\Users\\timca\\codex-e2e-sample",
      "exec",
      "resume",
      "session-456"
    ]
  );
});

test("callStructuredCodexSession forwards dangerous worker bypass to the session runner", async () => {
  const seenArgs = [];
  const result = await callStructuredCodexSession(
    async ({ commandArgs }) => {
      seenArgs.push(commandArgs);
      return {
        replyBody: JSON.stringify({ approved: true }),
        sessionId: "session-789"
      };
    },
    {
      approvalPolicy: "never",
      cwd: TEST_SAMPLE,
      dangerousBypass: true,
      label: "worker checkpoint",
      normalizer: (parsed) => parsed,
      prompt: "Return JSON only.",
      sandboxMode: "danger-full-access",
      sessionId: null
    }
  );

  assert.deepEqual(seenArgs, [[
    "--dangerously-bypass-approvals-and-sandbox",
    "-C",
    TEST_SAMPLE,
    "exec"
  ]]);
  assert.equal(result.sessionId, "session-789");
  assert.deepEqual(result.report, { approved: true });
});

test("worker runner executes the full staged TDD workflow before drafting the final reply", async () => {
  const checkpoints = [];
  const sessionReplies = [
    {
      replyBody: JSON.stringify({
        stage: "plan",
        status: "completed",
        summary: "planned the smallest change and identified the focused tests",
        commands_ran: ["rg -n monitor README.md src"],
        files_touched: [],
        tests_status: "not_run",
        readme_updated: false,
        notes: "ready for red"
      }),
      sessionId: "worker-session-1"
    },
    {
      replyBody: JSON.stringify({
        stage: "red",
        status: "completed",
        summary: "added a focused failing test",
        commands_ran: ["npm test -- monitor-workflow"],
        files_touched: ["test/codex-daemon.test.js"],
        tests_status: "failing",
        readme_updated: false,
        notes: "failing as expected"
      })
    },
    {
      replyBody: JSON.stringify({
        stage: "green",
        status: "completed",
        summary: "implemented the minimal fix and reran the focused tests",
        commands_ran: ["npm test -- monitor-workflow"],
        files_touched: ["src/codex-daemon.js"],
        tests_status: "passing",
        readme_updated: false,
        notes: "green"
      })
    },
    {
      replyBody: JSON.stringify({
        stage: "refactor",
        status: "completed",
        summary: "cleaned up the helper structure and reran the focused tests",
        commands_ran: ["npm test -- monitor-workflow"],
        files_touched: ["src/codex-daemon.js"],
        tests_status: "passing",
        readme_updated: false,
        notes: "refactor complete"
      })
    },
    {
      replyBody: JSON.stringify({
        stage: "docs",
        status: "completed",
        summary: "updated README and reran the relevant tests",
        commands_ran: ["npm test -- monitor-workflow"],
        files_touched: ["README.md"],
        tests_status: "passing",
        readme_updated: true,
        notes: "docs complete"
      })
    },
    {
      replyBody: [
        "codex worker",
        "",
        "TDD flow complete: plan, red, green, refactor, docs.",
        "Tests run: npm test -- monitor-workflow.",
        "README.md updated."
      ].join("\n")
    }
  ];

  const workerRunner = new CodexWorkerRunner({
    sessionRunner: async () => {
      const next = sessionReplies.shift();

      if (!next) {
        throw new Error("Unexpected worker session call");
      }

      return next;
    },
    workflowMonitor: {
      async reviewCheckpoint(context) {
        checkpoints.push(context.stage.name);
        return {
          approved: true,
          stageComplete: true,
          issues: [],
          guidance: `move to ${context.stage.name}`,
          verifiedSummary: `${context.stage.name} verified`,
          suspiciousSignals: [],
          sessionId: "monitor-session-1"
        };
      }
    }
  });
  const context = makeWorkerContext();

  const result = await workerRunner.runTask(context);

  assert.equal(result.sessionId, "worker-session-1");
  assert.match(result.replyBody, /README\.md updated/);
  assert.equal(checkpoints.join(","), "plan,red,green,refactor,docs");
  assert.equal(context.state.monitor.sessionId, "monitor-session-1");
  assert.equal(context.task.workflowStage, "ready_for_final_review");
  assert.equal(context.task.workflowHistory.length, 5);
  assert.deepEqual(
    context.task.workflowHistory.map((entry) => `${entry.stage}:${entry.outcome}`),
    ["plan:approved", "red:approved", "green:approved", "refactor:approved", "docs:approved"]
  );
  assert.equal(context.task.workflowHistory[4].readmeUpdated, true);
});

test("worker runner retries a rejected stage with monitor guidance before continuing", async () => {
  const sessionReplies = [
    {
      replyBody: JSON.stringify({
        stage: "plan",
        status: "completed",
        summary: "planned",
        commands_ran: ["rg -n tdd src"],
        files_touched: [],
        tests_status: "not_run",
        readme_updated: false,
        notes: ""
      }),
      sessionId: "worker-session-2"
    },
    {
      replyBody: JSON.stringify({
        stage: "red",
        status: "completed",
        summary: "claimed red without a clear failing test",
        commands_ran: [],
        files_touched: ["test/codex-daemon.test.js"],
        tests_status: "unknown",
        readme_updated: false,
        notes: ""
      })
    },
    {
      replyBody: JSON.stringify({
        stage: "red",
        status: "completed",
        summary: "captured the real failing test",
        commands_ran: ["npm test -- monitor-workflow"],
        files_touched: ["test/codex-daemon.test.js"],
        tests_status: "failing",
        readme_updated: false,
        notes: ""
      })
    },
    {
      replyBody: JSON.stringify({
        stage: "green",
        status: "completed",
        summary: "green",
        commands_ran: ["npm test -- monitor-workflow"],
        files_touched: ["src/codex-daemon.js"],
        tests_status: "passing",
        readme_updated: false,
        notes: ""
      })
    },
    {
      replyBody: JSON.stringify({
        stage: "refactor",
        status: "completed",
        summary: "refactor",
        commands_ran: ["npm test -- monitor-workflow"],
        files_touched: ["src/codex-daemon.js"],
        tests_status: "passing",
        readme_updated: false,
        notes: ""
      })
    },
    {
      replyBody: JSON.stringify({
        stage: "docs",
        status: "completed",
        summary: "docs",
        commands_ran: ["npm test -- monitor-workflow"],
        files_touched: ["README.md"],
        tests_status: "passing",
        readme_updated: true,
        notes: ""
      })
    },
    {
      replyBody: "final worker reply"
    }
  ];
  let redReviewCount = 0;

  const workerRunner = new CodexWorkerRunner({
    sessionRunner: async () => {
      const next = sessionReplies.shift();

      if (!next) {
        throw new Error("Unexpected worker session call");
      }

      return next;
    },
    workflowMonitor: {
      async reviewCheckpoint(context) {
        if (context.stage.name === "red" && redReviewCount === 0) {
          redReviewCount += 1;
          return {
            approved: false,
            stageComplete: false,
            issues: ["No failing test evidence yet."],
            guidance: "Run the focused test and capture the real failing output.",
            verifiedSummary: "red rejected",
            suspiciousSignals: ["missing failing test evidence"],
            sessionId: "monitor-session-2"
          };
        }

        return {
          approved: true,
          stageComplete: true,
          issues: [],
          guidance: "",
          verifiedSummary: `${context.stage.name} approved`,
          suspiciousSignals: [],
          sessionId: "monitor-session-2"
        };
      }
    }
  });
  const context = makeWorkerContext();

  await workerRunner.runTask(context);

  const redEntries = context.task.workflowHistory.filter((entry) => entry.stage === "red");
  assert.equal(redEntries.length, 2);
  assert.equal(redEntries[0].outcome, "retry");
  assert.equal(redEntries[1].outcome, "approved");
  assert.match(redEntries[0].issues.join(" "), /failing test evidence/);
});

test("final monitor review normalizes JSON replies and keeps the worker draft grounded", async () => {
  const monitorRunner = new CodexMonitorRunner({
    sessionRunner: async () => ({
      replyBody: JSON.stringify({
        approved: true,
        reply_body: "codex monitor\n\nverified TDD flow and README update",
        issues: []
      }),
      sessionId: "monitor-session-final"
    })
  });

  const result = await monitorRunner.reviewTask({
    state: {
      monitor: {
        sessionId: null
      }
    },
    task: {
      id: "task-0001",
      subject: "codex example",
      workspacePath: TEST_REPO
    },
    threadState: {
      workspacePath: TEST_REPO
    },
    workerResult: {
      replyBody: "worker draft",
      workflowHistory: [
        { stage: "plan", outcome: "approved", summary: "planned" },
        { stage: "red", outcome: "approved", summary: "failing test" },
        { stage: "green", outcome: "approved", summary: "passing test" },
        { stage: "refactor", outcome: "approved", summary: "cleanup" },
        { stage: "docs", outcome: "approved", summary: "README updated" }
      ]
    },
    mailboxEmail: TEST_MAILBOX
  });

  assert.equal(result.approved, true);
  assert.equal(result.sessionId, "monitor-session-final");
  assert.match(result.replyBody, /README update/);
});
