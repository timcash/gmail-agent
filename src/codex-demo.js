#!/usr/bin/env node

const path = require("path");
const { spawnSync } = require("child_process");

const {
  ensureDaemonScopes,
  getMailboxProfile,
  listMessages,
  readMessages,
  sendEmail
} = require("./codex-gmail");

function sendDemoEmail(to, subject) {
  return sendEmail({
    to,
    subject,
    body: [
      "Please prove the codex monitor and worker are both active.",
      "Reply with a short status note describing the queue acknowledgement and the completed worker reply."
    ].join("\n\n")
  });
}

function runDaemonOnce(query) {
  const daemonPath = path.join(__dirname, "codex-daemon.js");
  const result = spawnSync(process.execPath, [
    daemonPath,
    "--once",
    "--query",
    query,
    "--max-messages",
    "10"
  ], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "").trim() || `daemon exited with status ${result.status}`);
  }
}

function listThreadMessages(query) {
  const items = listMessages(query, 10);
  return readMessages(items.map((item) => item.id));
}

async function main() {
  ensureDaemonScopes("codex:demo");
  const profile = getMailboxProfile();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const subject = `codex demo ${stamp}`;
  const query = `subject:"${subject}" newer_than:1d`;
  const sent = sendDemoEmail(profile.emailAddress, subject);

  runDaemonOnce(query);

  const messages = listThreadMessages(query);
  const summary = {
    mailbox: profile.emailAddress,
    subject,
    requestId: sent && sent.id ? sent.id : null,
    messageCount: messages.length,
    messages: messages.map((message) => ({
      subject: message.subject || null,
      from: message.from && message.from.email ? message.from.email : null,
      threadId: message.thread_id || null,
      excerpt: String(message.body_text || "").slice(0, 160)
    }))
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
