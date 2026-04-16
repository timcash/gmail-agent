#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { STATUS_LABELS } = require("./codex-system");
const {
  ensureDaemonScopes,
  getMailboxProfile,
  listMessages,
  readMessage,
  readThread,
  replyToMessage,
  sendEmail
} = require("./codex-gmail");
const { projectRoot } = require("./gmail-agent");

let runtimeDir = path.join(projectRoot, ".daemon");
let stateFile = path.join(runtimeDir, "codex-state.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readState() {
  return fs.existsSync(stateFile)
    ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
    : null;
}

async function waitFor(checkFn, timeoutMs, label) {
  const startedAt = Date.now();
  let lastError = null;

  for (;;) {
    let value;

    try {
      value = await checkFn();
      lastError = null;
    } catch (error) {
      lastError = error;
    }

    if (value) {
      return value;
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ""}`);
    }

    await sleep(1500);
  }
}

function findReplyMessage(messages, sentId, pattern) {
  return messages.find((message) => message.id !== sentId && pattern.test(String(message.body_text || "")));
}

function collectThreadLabelIds(threadData) {
  return Array.from(new Set(
    (Array.isArray(threadData.messages) ? threadData.messages : [])
      .flatMap((message) => Array.isArray(message.labelIds) ? message.labelIds : [])
  ));
}

async function main() {
  ensureDaemonScopes("codex:e2e");
  const profile = getMailboxProfile();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const harnessStartedAt = Date.now();
  runtimeDir = path.join(projectRoot, ".daemon", `e2e-${stamp}`);
  stateFile = path.join(runtimeDir, "codex-state.json");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const daemonPath = path.join(__dirname, "codex-daemon.js");
  const daemonLogs = { stdout: "", stderr: "" };
  const daemon = spawn(process.execPath, [daemonPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CODEX_RUNTIME_DIR: runtimeDir,
      CODEX_TEST_WORK_DELAY_MS: "2000"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  daemon.stdout.on("data", (chunk) => {
    daemonLogs.stdout += chunk.toString();
  });
  daemon.stderr.on("data", (chunk) => {
    daemonLogs.stderr += chunk.toString();
  });

  try {
    await waitFor(() => {
      if (daemon.exitCode !== null) {
        throw new Error(`Temporary daemon exited early with status ${daemon.exitCode}`);
      }

      const state = readState();
      const lastStartedAt = state && state.watch && state.watch.lastStartedAt
        ? Date.parse(state.watch.lastStartedAt)
        : 0;
      const watchReady = /Listening for new emails/i.test(`${daemonLogs.stdout}\n${daemonLogs.stderr}`);

      return watchReady && Number.isFinite(lastStartedAt) && lastStartedAt >= harnessStartedAt - 1000;
    }, 60000, "daemon startup");

    const helpSubject = `codex/help e2e ${stamp}`;
    const helpSent = sendEmail({
      to: profile.emailAddress,
      subject: helpSubject,
      body: "Show the email CLI help."
    });
    const helpReply = await waitFor(() => {
      const messages = listMessages(`subject:"${helpSubject}" newer_than:1d`, 10).map((item) => readMessage(item.id));
      return findReplyMessage(messages, helpSent.id, /Direct monitor commands:/);
    }, 90000, "help reply");

    const workOneSubject = `codex e2e worker one ${stamp}`;
    const workTwoSubject = `codex e2e worker two ${stamp}`;
    const workBody = [
      "Please reply with a short operator note confirming the codex monitor and worker are both active.",
      "Do not inspect the repo or modify files.",
      "Mention the queue state and clearly say that this e2e task made no code changes, no tests, and no README updates."
    ].join("\n\n");
    const workOneSent = sendEmail({ to: profile.emailAddress, subject: workOneSubject, body: workBody });
    const workTwoSent = sendEmail({ to: profile.emailAddress, subject: workTwoSubject, body: workBody });
    const workOneThread = await waitFor(() => {
      const message = readMessage(workOneSent.id);
      return message.thread_id || null;
    }, 30000, "work one sent thread id");
    const workTwoThread = await waitFor(() => {
      const message = readMessage(workTwoSent.id);
      return message.thread_id || null;
    }, 30000, "work two sent thread id");

    const workOneAck = await waitFor(() => {
      const messages = listMessages(`subject:"${workOneSubject}" newer_than:1d`, 10).map((item) => readMessage(item.id));
      return findReplyMessage(messages, workOneSent.id, /status: in-work/);
    }, 90000, "work one queue acknowledgement");

    const workTwoAck = await waitFor(() => {
      const messages = listMessages(`subject:"${workTwoSubject}" newer_than:1d`, 10).map((item) => readMessage(item.id));
      return findReplyMessage(messages, workTwoSent.id, /status: queued/);
    }, 90000, "work two queue acknowledgement");

    const psSubject = `codex/ps e2e ${stamp}`;
    const psSent = sendEmail({
      to: profile.emailAddress,
      subject: psSubject,
      body: "Report daemon status."
    });
    const psReply = await waitFor(() => {
      const messages = listMessages(`subject:"${psSubject}" newer_than:1d`, 10).map((item) => readMessage(item.id));
      return findReplyMessage(messages, psSent.id, /queue-depth: 1/);
    }, 90000, "ps reply");

    const workOneFinal = await waitFor(() => {
      const messages = listMessages(`subject:"${workOneSubject}" newer_than:1d`, 10).map((item) => readMessage(item.id));
      return messages.find((message) => message.id !== workOneSent.id && message.id !== workOneAck.id && String(message.body_text || "").trim());
    }, 480000, "work one final reply");

    const workTwoFinal = await waitFor(() => {
      const messages = listMessages(`subject:"${workTwoSubject}" newer_than:1d`, 10).map((item) => readMessage(item.id));
      return messages.find((message) => message.id !== workTwoSent.id && message.id !== workTwoAck.id && String(message.body_text || "").trim());
    }, 480000, "work two final reply");

    const threadCommandSent = replyToMessage(workTwoFinal.id, "codex/thread");
    const threadReply = await waitFor(() => {
      const messages = listMessages(`subject:"${workTwoSubject}" newer_than:1d`, 20).map((item) => readMessage(item.id));
      return messages.find((message) =>
        message.id !== threadCommandSent.id &&
        message.id !== workTwoAck.id &&
        message.id !== workTwoFinal.id &&
        /task-count:/.test(String(message.body_text || ""))
      );
    }, 90000, "thread report reply");

    const state = readState();
    const workTasks = Object.values(state.tasks || {}).filter((task) => [workOneThread, workTwoThread].includes(task.threadId));
    const workOneTask = workTasks.find((task) => task.threadId === workOneThread);
    const workTwoTask = workTasks.find((task) => task.threadId === workTwoThread);
    const acceptedStatuses = new Set(["done", "blocked"]);
    const workOneExpectedLabelId = state.labels[STATUS_LABELS[workOneTask.status]];
    const workTwoExpectedLabelId = state.labels[STATUS_LABELS[workTwoTask.status]];
    const workOneLabelIds = collectThreadLabelIds(readThread(workOneThread));
    const workTwoLabelIds = collectThreadLabelIds(readThread(workTwoThread));

    if (!workOneTask || !workTwoTask) {
      throw new Error("Expected persisted tasks for both live worker threads.");
    }

    if (!acceptedStatuses.has(workOneTask.status) || !acceptedStatuses.has(workTwoTask.status)) {
      throw new Error(`Expected both live tasks to finish as done or blocked. Got ${workOneTask.status} and ${workTwoTask.status}.`);
    }

    if (!workOneExpectedLabelId || !workOneLabelIds.includes(workOneExpectedLabelId)) {
      throw new Error(`Expected worker one thread to carry the Gmail label for status ${workOneTask.status}.`);
    }

    if (!workTwoExpectedLabelId || !workTwoLabelIds.includes(workTwoExpectedLabelId)) {
      throw new Error(`Expected worker two thread to carry the Gmail label for status ${workTwoTask.status}.`);
    }

    console.log(JSON.stringify({
      mailbox: profile.emailAddress,
      stamp,
      daemonPid: daemon.pid,
      helpReplyId: helpReply.id,
      psReplyId: psReply.id,
      threadReplyId: threadReply.id,
      workOne: {
        subject: workOneSubject,
        threadId: workOneThread,
        ackId: workOneAck.id,
        finalId: workOneFinal.id,
        taskId: workOneTask.id,
        workerSessionId: workOneTask.workerSessionIdUsed,
        monitorSessionId: workOneTask.monitorSessionIdUsed
      },
      workTwo: {
        subject: workTwoSubject,
        threadId: workTwoThread,
        ackId: workTwoAck.id,
        finalId: workTwoFinal.id,
        taskId: workTwoTask.id,
        workerSessionId: workTwoTask.workerSessionIdUsed,
        monitorSessionId: workTwoTask.monitorSessionIdUsed
      },
      labels: {
        workOneExpectedLabelId,
        workTwoExpectedLabelId,
        workOneThreadLabels: workOneLabelIds,
        workTwoThreadLabels: workTwoLabelIds
      }
    }, null, 2));
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\nDaemon stdout:\n${daemonLogs.stdout}\n\nDaemon stderr:\n${daemonLogs.stderr}`);
  } finally {
    if (!daemon.killed) {
      daemon.kill();
      await sleep(2000);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
