const { parseJson } = require("./codex-system");
const {
  getGmailProfileStatus,
  getGwsAuthStatus,
  getMissingRequiredGmailScopes,
  gmailDaemonScopes,
  runGwsProcess
} = require("./gmail-agent");

function runGwsJson(args) {
  const result = runGwsProcess(args, {
    capture: true,
    strictClientSecret: false
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "").trim() || `gws exited with status ${result.status}`);
  }

  const data = parseJson(result.stdout);

  if (!data) {
    throw new Error(`Expected JSON output for gws args: ${args.join(" ")}`);
  }

  return data;
}

function getMailboxProfile() {
  const status = getGmailProfileStatus();

  if (status.result.error) {
    throw status.result.error;
  }

  if (typeof status.result.status === "number" && status.result.status !== 0) {
    throw new Error((status.result.stderr || status.result.stdout || "").trim() || "Failed to fetch Gmail profile");
  }

  if (!status.data || !status.data.emailAddress) {
    throw new Error("Gmail profile is missing emailAddress");
  }

  return status.data;
}

function buildScopeError(requiredScopes, commandLabel) {
  const authStatus = getGwsAuthStatus();
  const missingScopes = getMissingRequiredGmailScopes(authStatus, requiredScopes);

  if (!missingScopes.length) {
    return null;
  }

  return [
    `${commandLabel} needs additional Google scopes before it can run.`,
    "",
    "Missing scopes:",
    ...missingScopes.map((scope) => `- ${scope}`),
    "",
    "Add those scopes in Google Cloud -> Google Auth Platform -> Data Access, then run:",
    "npm run auth:reset:daemon"
  ].join("\n");
}

function ensureRequiredScopes(requiredScopes, commandLabel) {
  const errorMessage = buildScopeError(requiredScopes, commandLabel);

  if (errorMessage) {
    throw new Error(errorMessage);
  }
}

function ensureDaemonScopes(commandLabel = "codex daemon") {
  ensureRequiredScopes(gmailDaemonScopes, commandLabel);
}

function searchMessages(query, maxResults = 10) {
  return runGwsJson([
    "gmail",
    "users",
    "messages",
    "list",
    "--params",
    JSON.stringify({
      userId: "me",
      q: query,
      maxResults
    }),
    "--format",
    "json"
  ]);
}

function listMessages(query, maxResults = 10) {
  const data = searchMessages(query, maxResults);

  return Array.isArray(data.messages) ? data.messages : [];
}

function readMessage(id) {
  const data = runGwsJson([
    "gmail",
    "+read",
    "--id",
    id,
    "--headers",
    "--format",
    "json"
  ]);

  return {
    ...data,
    id
  };
}

function readMessages(ids) {
  return ids.map((id) => readMessage(id));
}

function readThread(threadId) {
  return runGwsJson([
    "gmail",
    "users",
    "threads",
    "get",
    "--params",
    JSON.stringify({ userId: "me", id: threadId }),
    "--format",
    "json"
  ]);
}

function listLabels() {
  const data = runGwsJson([
    "gmail",
    "users",
    "labels",
    "list",
    "--params",
    JSON.stringify({ userId: "me" }),
    "--format",
    "json"
  ]);

  return Array.isArray(data.labels) ? data.labels : [];
}

function modifyThreadLabels(threadId, { addLabelIds = [], removeLabelIds = [] } = {}) {
  if (!threadId) {
    return null;
  }

  const addIds = Array.isArray(addLabelIds) ? addLabelIds.filter(Boolean) : [];
  const removeIds = Array.isArray(removeLabelIds) ? removeLabelIds.filter(Boolean) : [];

  if (!addIds.length && !removeIds.length) {
    return null;
  }

  return runGwsJson([
    "gmail",
    "users",
    "threads",
    "modify",
    "--params",
    JSON.stringify({
      userId: "me",
      id: threadId
    }),
    "--json",
    JSON.stringify({
      addLabelIds: addIds,
      removeLabelIds: removeIds
    }),
    "--format",
    "json"
  ]);
}

function markThreadRead(threadId) {
  return modifyThreadLabels(threadId, {
    removeLabelIds: ["UNREAD"]
  });
}

function markThreadUnread(threadId) {
  return modifyThreadLabels(threadId, {
    addLabelIds: ["UNREAD"]
  });
}

function archiveThread(threadId) {
  return modifyThreadLabels(threadId, {
    removeLabelIds: ["INBOX"]
  });
}

function moveThreadToInbox(threadId) {
  return modifyThreadLabels(threadId, {
    addLabelIds: ["INBOX"]
  });
}

function starThread(threadId) {
  return modifyThreadLabels(threadId, {
    addLabelIds: ["STARRED"]
  });
}

function unstarThread(threadId) {
  return modifyThreadLabels(threadId, {
    removeLabelIds: ["STARRED"]
  });
}

function sendEmail({ to, subject, body, attachments = [] }) {
  const args = [
    "gmail",
    "+send",
    "--to",
    to,
    "--subject",
    subject,
    "--body",
    body
  ];

  for (const attachmentPath of attachments) {
    args.push("-a", attachmentPath);
  }

  args.push("--format", "json");
  return runGwsJson(args);
}

function replyToMessage(messageId, body) {
  return runGwsJson([
    "gmail",
    "+reply",
    "--message-id",
    messageId,
    "--body",
    body,
    "--format",
    "json"
  ]);
}

module.exports = {
  ensureDaemonScopes,
  ensureRequiredScopes,
  listLabels,
  getMailboxProfile,
  listMessages,
  searchMessages,
  archiveThread,
  markThreadRead,
  markThreadUnread,
  moveThreadToInbox,
  modifyThreadLabels,
  readMessage,
  readMessages,
  readThread,
  replyToMessage,
  runGwsJson,
  sendEmail,
  starThread,
  unstarThread
};
