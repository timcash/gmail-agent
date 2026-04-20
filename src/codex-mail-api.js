const http = require("http");

const { serializeError } = require("./codex-system");

const DEFAULT_PUBLIC_ORIGIN = process.env.CODEX_PUBLIC_ORIGIN
  || process.env.CODEX_MAIL_PUBLIC_ORIGIN
  || "https://codex.dialtone.earth";
const DEFAULT_HOST = process.env.CODEX_MAIL_HOST || "127.0.0.1";
const DEFAULT_PORT = Number.parseInt(process.env.CODEX_MAIL_PORT || "4192", 10);
const DEFAULT_ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.github\.io$/i,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^http:\/\/localhost(?::\d+)?$/i
];
const MAIL_VIEW_SPECS = [
  {
    id: "inbox",
    label: "Inbox",
    description: "Recent inbox threads.",
    kind: "mail",
    query: "in:inbox"
  },
  {
    id: "unread",
    label: "Unread",
    description: "Unread inbox threads.",
    kind: "mail",
    query: "in:inbox is:unread"
  },
  {
    id: "starred",
    label: "Starred",
    description: "Starred threads.",
    kind: "mail",
    query: "is:starred"
  },
  {
    id: "sent",
    label: "Sent",
    description: "Recently sent mail.",
    kind: "mail",
    query: "in:sent"
  },
  {
    id: "all-mail",
    label: "All Mail",
    description: "Recent mail across the mailbox.",
    kind: "mail",
    query: "in:anywhere -in:trash"
  },
  {
    id: "codex",
    label: "Codex",
    description: "Codex-related conversations.",
    kind: "status",
    query: "subject:codex newer_than:30d"
  }
];
const MAIL_VIEW_IDS = new Set(MAIL_VIEW_SPECS.map((view) => view.id));
const THREAD_ACTION_IDS = new Set([
  "mark-read",
  "mark-unread",
  "star",
  "unstar",
  "archive",
  "move-to-inbox"
]);

function clipText(text, maxLength = 180) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "(empty)";
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      resolve(body);
    });
    request.on("error", reject);
  });
}

async function readJsonBody(request) {
  const body = await readBody(request);
  const trimmed = String(body || "").trim();

  if (!trimmed) {
    return {};
  }

  return JSON.parse(trimmed);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function matchesAllowedOrigin(origin, allowedOrigins) {
  if (!origin) {
    return false;
  }

  return allowedOrigins.some((entry) => {
    if (entry instanceof RegExp) {
      return entry.test(origin);
    }

    return String(entry || "") === origin;
  });
}

function buildCorsHeaders(origin, allowedOrigins, requestHeaders = {}) {
  const headers = {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Vary": "Origin, Access-Control-Request-Private-Network"
  };

  if (matchesAllowedOrigin(origin, allowedOrigins)) {
    headers["Access-Control-Allow-Origin"] = origin;

    if (String(requestHeaders["access-control-request-private-network"] || "").toLowerCase() === "true") {
      headers["Access-Control-Allow-Private-Network"] = "true";
    }
  }

  return headers;
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, statusCode, html, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    ...headers
  });
  response.end(html);
}

function decodeBase64Url(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  if (!normalized) {
    return "";
  }

  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function extractPayloadText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (payload.mimeType === "text/plain" && payload.body && payload.body.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const text = extractPayloadText(part);

      if (text) {
        return text;
      }
    }
  }

  if (payload.body && payload.body.data) {
    return decodeBase64Url(payload.body.data);
  }

  return "";
}

function getHeaderValue(headers, name) {
  if (!Array.isArray(headers)) {
    return "";
  }

  const match = headers.find((entry) => String(entry && entry.name || "").toLowerCase() === String(name || "").toLowerCase());
  return match && match.value ? String(match.value) : "";
}

function getMessageThreadId(message) {
  if (!message || typeof message !== "object") {
    return "";
  }

  if (message.threadId) {
    return String(message.threadId);
  }

  if (message.thread_id) {
    return String(message.thread_id);
  }

  return "";
}

function getMessageSubject(message) {
  const payload = message && message.payload && typeof message.payload === "object"
    ? message.payload
    : null;
  const headers = payload && Array.isArray(payload.headers)
    ? payload.headers
    : [];
  const subject = getHeaderValue(headers, "Subject")
    || String(message && message.subject || "").trim();

  return subject;
}

function getMessageFrom(message) {
  const payload = message && message.payload && typeof message.payload === "object"
    ? message.payload
    : null;
  const headers = payload && Array.isArray(payload.headers)
    ? payload.headers
    : [];

  return normalizeAddress(getHeaderValue(headers, "From") || message && message.from);
}

function getMessageTo(message) {
  const payload = message && message.payload && typeof message.payload === "object"
    ? message.payload
    : null;
  const headers = payload && Array.isArray(payload.headers)
    ? payload.headers
    : [];

  return normalizeAddressList(getHeaderValue(headers, "To") || message && message.to);
}

function getMessageBodyText(message) {
  const payload = message && message.payload && typeof message.payload === "object"
    ? message.payload
    : null;

  return String(
    message && (message.bodyText || message.body_text)
      ? message.bodyText || message.body_text
      : extractPayloadText(payload) || String(message && message.snippet || "")
  );
}

function getMessageSnippet(message) {
  const snippet = String(message && message.snippet || "").trim();

  if (snippet) {
    return snippet;
  }

  return clipText(getMessageBodyText(message), 220);
}

function getMessageLabelIds(message) {
  if (Array.isArray(message && message.labelIds)) {
    return message.labelIds.slice();
  }

  if (Array.isArray(message && message.label_ids)) {
    return message.label_ids.slice();
  }

  return [];
}

function normalizeAddress(entry) {
  if (!entry) {
    return "";
  }

  if (typeof entry === "string") {
    return entry;
  }

  if (entry.name && entry.email) {
    return `${entry.name} <${entry.email}>`;
  }

  if (entry.email) {
    return entry.email;
  }

  if (entry.value) {
    return String(entry.value);
  }

  return "";
}

function normalizeAddressList(entries) {
  if (Array.isArray(entries)) {
    return entries
      .map((entry) => normalizeAddress(entry))
      .filter(Boolean);
  }

  const normalized = String(entries || "").trim();

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\s*,\s*/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeDate(value) {
  const text = String(value || "").trim();

  if (!text) {
    return null;
  }

  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    const date = new Date(numeric);
    return Number.isNaN(date.valueOf()) ? text : date.toISOString();
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? text : parsed.toISOString();
}

function formatLabelName(labelName) {
  const raw = String(labelName || "").trim();

  if (!raw) {
    return "";
  }

  if (raw.startsWith("CATEGORY_")) {
    return toTitleCase(raw.replace(/^CATEGORY_/, ""));
  }

  if (raw === "INBOX" || raw === "UNREAD" || raw === "STARRED" || raw === "IMPORTANT" || raw === "SENT") {
    return toTitleCase(raw);
  }

  return raw;
}

function toTitleCase(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function createLabelLookup(labels) {
  const lookup = new Map();

  for (const systemLabel of ["INBOX", "UNREAD", "STARRED", "IMPORTANT", "SENT"]) {
    lookup.set(systemLabel, systemLabel);
  }

  if (!Array.isArray(labels)) {
    return lookup;
  }

  for (const label of labels) {
    if (!label || !label.id) {
      continue;
    }

    lookup.set(String(label.id), String(label.name || label.id));
  }

  return lookup;
}

function mapLabelIdsToNames(labelIds, labelLookup) {
  if (!Array.isArray(labelIds)) {
    return [];
  }

  return labelIds
    .map((labelId) => {
      const resolved = labelLookup.get(String(labelId)) || String(labelId);
      return formatLabelName(resolved);
    })
    .filter(Boolean);
}

function getThreadTasks(state, threadState) {
  return (threadState && Array.isArray(threadState.taskIds) ? threadState.taskIds : [])
    .map((taskId) => state.tasks && state.tasks[taskId] ? state.tasks[taskId] : null)
    .filter(Boolean)
    .sort((left, right) => String(right.requestedAt || "").localeCompare(String(left.requestedAt || "")));
}

function buildCodexBadges(threadState, latestTask) {
  const badges = [];

  if (threadState && threadState.lastStatus) {
    badges.push(threadState.lastStatus);
  }

  if (threadState && threadState.lastTriageCategory) {
    badges.push(threadState.lastTriageCategory);
  }

  if (latestTask && latestTask.workflowStage) {
    badges.push(latestTask.workflowStage);
  }

  return badges;
}

function buildCodexExcerpt(threadState, latestTask) {
  if (latestTask && latestTask.requestText) {
    return clipText(latestTask.requestText, 140);
  }

  if (latestTask && latestTask.workerSummary) {
    return clipText(latestTask.workerSummary, 140);
  }

  if (threadState && threadState.subject) {
    return clipText(threadState.subject, 140);
  }

  return "";
}

function summarizeThreadFromMessage(state, labelLookup, message) {
  const threadId = getMessageThreadId(message) || String(message && message.id || "");
  const threadState = state && state.threads && threadId && state.threads[threadId]
    ? state.threads[threadId]
    : null;
  const tasks = getThreadTasks(state, threadState);
  const latestTask = tasks[0] || null;
  const subject = getMessageSubject(message)
    || (threadState && threadState.subject)
    || getMessageSnippet(message)
    || getMessageFrom(message)
    || "(no subject)";
  const from = getMessageFrom(message);
  const to = getMessageTo(message);
  const labelIds = getMessageLabelIds(message);
  const labelNames = mapLabelIdsToNames(labelIds, labelLookup);
  const unread = labelIds.includes("UNREAD");
  const starred = labelIds.includes("STARRED");
  const inInbox = labelIds.includes("INBOX");
  const inSent = labelIds.includes("SENT");
  const excerpt = clipText(
    buildCodexExcerpt(threadState, latestTask)
    || getMessageSnippet(message)
    || getMessageBodyText(message)
    || subject,
    180
  );
  const badges = [
    ...(unread ? ["Unread"] : []),
    ...(starred ? ["Starred"] : []),
    ...buildCodexBadges(threadState, latestTask)
  ];

  return {
    threadId,
    latestMessageId: message.id || null,
    subject,
    updatedAt: normalizeDate(message && (message.internalDate || message.internal_date || message.sentAt || message.date)),
    workspaceKey: threadState && threadState.workspaceKey ? threadState.workspaceKey : null,
    workspacePath: threadState && threadState.workspacePath ? threadState.workspacePath : null,
    status: threadState && threadState.lastStatus ? threadState.lastStatus : null,
    triage: threadState && threadState.lastTriageCategory ? threadState.lastTriageCategory : null,
    taskCount: tasks.length,
    latestTaskId: latestTask ? latestTask.id : null,
    from,
    to,
    excerpt,
    labelIds,
    labelNames,
    unread,
    starred,
    inInbox,
    inSent,
    badges
  };
}

function summarizeFallbackThread(state, labelLookup, threadId) {
  const threadState = state && state.threads && state.threads[threadId]
    ? state.threads[threadId]
    : {
        threadId,
        subject: "(unknown thread)",
        updatedAt: null,
        lastStatus: null,
        lastTriageCategory: null,
        taskIds: []
      };
  const tasks = getThreadTasks(state, threadState);
  const latestTask = tasks[0] || null;

  return {
    threadId,
    latestMessageId: threadState.lastUserMessageId || null,
    subject: threadState.subject || "(no subject)",
    updatedAt: normalizeDate(threadState.updatedAt || threadState.createdAt),
    workspaceKey: threadState.workspaceKey || null,
    workspacePath: threadState.workspacePath || null,
    status: threadState.lastStatus || null,
    triage: threadState.lastTriageCategory || null,
    taskCount: tasks.length,
    latestTaskId: latestTask ? latestTask.id : null,
    from: "",
    to: [],
    excerpt: buildCodexExcerpt(threadState, latestTask) || "(no summary yet)",
    labelIds: [],
    labelNames: [],
    unread: false,
    starred: false,
    inInbox: false,
    inSent: false,
    badges: buildCodexBadges(threadState, latestTask)
  };
}

function normalizeMailMessage(message, labelLookup) {
  const payload = message && message.payload && typeof message.payload === "object"
    ? message.payload
    : null;
  const labelIds = getMessageLabelIds(message);

  return {
    id: message && message.id ? message.id : null,
    from: getMessageFrom(message),
    to: getMessageTo(message),
    sentAt: normalizeDate(message && (message.internalDate || message.internal_date || message.sentAt || message.date)),
    snippet: clipText(getMessageSnippet(message), 220),
    bodyText: clipText(
      getMessageBodyText(message),
      4000
    ),
    labelIds,
    labelNames: mapLabelIdsToNames(labelIds, labelLookup)
  };
}

function buildThreadActions(summary) {
  return {
    canMarkRead: Boolean(summary.unread),
    canMarkUnread: !summary.unread,
    canStar: !summary.starred,
    canUnstar: Boolean(summary.starred),
    canArchive: Boolean(summary.inInbox),
    canMoveToInbox: !summary.inInbox
  };
}

function buildThreadDetail(state, labelLookup, threadId, rawThread, loadError = null) {
  const fallbackSummary = summarizeFallbackThread(state, labelLookup, threadId);
  const normalizedMessages = Array.isArray(rawThread && rawThread.messages)
    ? rawThread.messages.map((message) => normalizeMailMessage(message, labelLookup))
    : [];
  const summary = normalizedMessages.length
    ? summarizeThreadFromMessage(state, labelLookup, {
        ...rawThread.messages[rawThread.messages.length - 1],
        threadId
      })
    : fallbackSummary;
  const threadState = state && state.threads && state.threads[threadId]
    ? state.threads[threadId]
    : null;
  const tasks = getThreadTasks(state, threadState);

  return {
    summary,
    latestReplyToMessageId: normalizedMessages.length
      ? normalizedMessages[normalizedMessages.length - 1].id
      : threadState && threadState.lastUserMessageId
        ? threadState.lastUserMessageId
        : null,
    loadError,
    actions: buildThreadActions(summary),
    tasks: tasks.map((task) => ({
      id: task.id,
      status: task.status,
      requestedAt: task.requestedAt || null,
      completedAt: task.completedAt || null,
      workflowStage: task.workflowStage || null,
      requestText: task.requestText || "",
      workerSummary: task.workerSummary || null
    })),
    messages: normalizedMessages
  };
}

function buildAuthorizeHtml(context) {
  const mailbox = context.getMailboxProfile ? context.getMailboxProfile() : null;
  const mailboxLabel = mailbox && mailbox.emailAddress ? mailbox.emailAddress : "gmail-agent";

  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\" />",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    "<title>Codex Mail Access</title>",
    "<style>",
    "html,body{margin:0;min-height:100%;background:#000;color:#fff;font-family:ui-sans-serif,system-ui,sans-serif;}",
    "main{min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;}",
    "section{max-width:520px;border:1px solid #2a2a2a;padding:24px;background:#080808;}",
    "h1{margin:0 0 12px;font-size:1.5rem;}",
    "p{margin:0 0 10px;line-height:1.5;color:#d6d6d6;}",
    "code{font-family:ui-monospace,SFMono-Regular,monospace;background:#111;padding:2px 6px;}",
    "</style>",
    "</head>",
    "<body>",
    "<main>",
    "<section>",
    "<h1>Cloudflare Access ready.</h1>",
    `<p>The shared gmail-agent mailbox for <code>${escapeHtml(mailboxLabel)}</code> is available.</p>`,
    "<p>You can close this tab and return to Linker. The /codex page will reload the mailbox list automatically.</p>",
    "</section>",
    "</main>",
    "</body>",
    "</html>"
  ].join("");
}

async function runSearch(options, query, maxResults) {
  if (typeof options.searchMessages !== "function") {
    return { messages: [], resultSizeEstimate: 0 };
  }

  const result = await options.searchMessages(query, maxResults);

  if (Array.isArray(result)) {
    return {
      messages: result,
      resultSizeEstimate: result.length
    };
  }

  if (!result || typeof result !== "object") {
    return { messages: [], resultSizeEstimate: 0 };
  }

  return {
    messages: Array.isArray(result.messages) ? result.messages : [],
    resultSizeEstimate: Number.isFinite(Number(result.resultSizeEstimate))
      ? Number(result.resultSizeEstimate)
      : Array.isArray(result.messages)
        ? result.messages.length
        : 0
  };
}

async function getLabelLookup(options) {
  if (typeof options.listLabels !== "function") {
    return createLabelLookup([]);
  }

  const labels = await options.listLabels();
  return createLabelLookup(labels);
}

function getViewSpec(viewId) {
  return MAIL_VIEW_SPECS.find((view) => view.id === viewId) || MAIL_VIEW_SPECS[0];
}

function composeMailboxQuery(baseQuery, searchQuery = "") {
  const parts = [String(baseQuery || "").trim(), String(searchQuery || "").trim()].filter(Boolean);
  return parts.join(" ").trim();
}

async function buildMailViews(options) {
  return await Promise.all(MAIL_VIEW_SPECS.map(async (view) => {
    const result = await runSearch(options, view.query, 1);

    return {
      id: view.id,
      label: view.label,
      description: view.description,
      kind: view.kind,
      count: result.resultSizeEstimate
    };
  }));
}

async function listThreadsForView(options, viewId, limit = 20, searchQuery = "") {
  const state = options.getState();
  const labelLookup = await getLabelLookup(options);
  const view = getViewSpec(viewId);
  const result = await runSearch(
    options,
    composeMailboxQuery(view.query, searchQuery),
    Math.max(1, limit * 3)
  );
  const seenThreadIds = new Set();
  const candidates = [];

  for (const message of result.messages) {
    const threadId = message && message.threadId ? String(message.threadId) : "";

    if (!threadId || seenThreadIds.has(threadId)) {
      continue;
    }

    seenThreadIds.add(threadId);
    candidates.push(message);

    if (candidates.length >= limit) {
      break;
    }
  }

  const messages = await Promise.all(candidates.map(async (message) => {
    if (typeof options.readMessage === "function" && message && message.id) {
      const hydrated = await options.readMessage(message.id);
      return {
        ...message,
        ...(hydrated && typeof hydrated === "object" ? hydrated : {})
      };
    }

    return message;
  }));

  return messages.map((message) => summarizeThreadFromMessage(state, labelLookup, message));
}

async function buildHealthSnapshot(context) {
  const state = context.getState();
  const runtime = context.getRuntimeInfo ? context.getRuntimeInfo() : {};
  const views = await buildMailViews(context);

  return {
    ok: true,
    mailbox: context.getMailboxProfile ? context.getMailboxProfile() : null,
    runtime: runtime && typeof runtime === "object" ? runtime : {},
    counts: {
      threads: Number(views.find((view) => view.id === "all-mail")?.count || 0),
      tasks: Object.keys(state.tasks || {}).length,
      queueDepth: Array.isArray(state.queue) ? state.queue.length : 0,
      activeTaskId: state.activeTaskId || null,
      events: Array.isArray(state.events) ? state.events.length : 0
    },
    views
  };
}

async function applyThreadAction(threadId, action, options) {
  switch (action) {
    case "mark-read":
      if (typeof options.markThreadRead === "function") {
        await options.markThreadRead(threadId);
      }
      return "mail_api_mark_read";
    case "mark-unread":
      if (typeof options.markThreadUnread === "function") {
        await options.markThreadUnread(threadId);
      }
      return "mail_api_mark_unread";
    case "star":
      if (typeof options.starThread === "function") {
        await options.starThread(threadId);
      }
      return "mail_api_star";
    case "unstar":
      if (typeof options.unstarThread === "function") {
        await options.unstarThread(threadId);
      }
      return "mail_api_unstar";
    case "archive":
      if (typeof options.archiveThread === "function") {
        await options.archiveThread(threadId);
      }
      return "mail_api_archive";
    case "move-to-inbox":
      if (typeof options.moveThreadToInbox === "function") {
        await options.moveThreadToInbox(threadId);
      }
      return "mail_api_move_to_inbox";
    default:
      throw new Error(`Unsupported mail action: ${action}`);
  }
}

function buildMailApiHandler(options) {
  const allowedOrigins = Array.isArray(options.allowedOrigins) && options.allowedOrigins.length
    ? options.allowedOrigins
    : DEFAULT_ALLOWED_ORIGIN_PATTERNS;

  return async (request, response) => {
    const origin = request.headers.origin || "";
    const corsHeaders = buildCorsHeaders(origin, allowedOrigins, request.headers);
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    const state = options.getState();

    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    try {
      if (request.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/codex" || requestUrl.pathname === "/codex/")) {
        sendHtml(response, 200, buildAuthorizeHtml(options), corsHeaders);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/mail/public-config") {
        sendJson(response, 200, {
          ok: true,
          authRequired: true,
          publicOrigin: options.publicOrigin || DEFAULT_PUBLIC_ORIGIN
        }, corsHeaders);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/mail/health") {
        sendJson(response, 200, await buildHealthSnapshot(options), corsHeaders);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/mail/views") {
        sendJson(response, 200, {
          ok: true,
          views: await buildMailViews(options)
        }, corsHeaders);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/mail/threads") {
        const requestedView = String(requestUrl.searchParams.get("view") || "inbox").trim().toLowerCase();
        const viewId = MAIL_VIEW_IDS.has(requestedView) ? requestedView : "inbox";
        const limit = Number.parseInt(requestUrl.searchParams.get("limit") || "20", 10);
        const searchQuery = String(requestUrl.searchParams.get("q") || "").trim();

        sendJson(response, 200, {
          ok: true,
          view: viewId,
          searchQuery,
          threads: await listThreadsForView(
            options,
            viewId,
            Number.isFinite(limit) ? limit : 40,
            searchQuery
          )
        }, corsHeaders);
        return;
      }

      const threadMatch = requestUrl.pathname.match(/^\/api\/mail\/thread\/([^/]+)$/);
      const threadReplyMatch = requestUrl.pathname.match(/^\/api\/mail\/thread\/([^/]+)\/reply$/);
      const threadActionMatch = requestUrl.pathname.match(/^\/api\/mail\/thread\/([^/]+)\/action$/);
      const threadReadMatch = requestUrl.pathname.match(/^\/api\/mail\/thread\/([^/]+)\/read$/);

      if (request.method === "GET" && threadMatch) {
        const threadId = decodeURIComponent(threadMatch[1]);
        let rawThread = null;
        let loadError = null;

        if (typeof options.readThread === "function") {
          try {
            rawThread = await options.readThread(threadId);
          } catch (error) {
            loadError = serializeError(error);
          }
        }

        const labelLookup = await getLabelLookup(options);

        sendJson(response, 200, {
          ok: true,
          thread: buildThreadDetail(state, labelLookup, threadId, rawThread, loadError)
        }, corsHeaders);
        return;
      }

      if (request.method === "POST" && threadReadMatch) {
        const threadId = decodeURIComponent(threadReadMatch[1]);
        const eventType = await applyThreadAction(threadId, "mark-read", options);

        if (typeof options.recordEvent === "function") {
          options.recordEvent(eventType, { threadId });
        }

        if (typeof options.persist === "function") {
          await options.persist();
        }

        sendJson(response, 200, {
          ok: true,
          threadId,
          action: "mark-read"
        }, corsHeaders);
        return;
      }

      if (request.method === "POST" && threadActionMatch) {
        const threadId = decodeURIComponent(threadActionMatch[1]);
        const payload = await readJsonBody(request);
        const action = String(payload.action || "").trim();

        if (!THREAD_ACTION_IDS.has(action)) {
          sendJson(response, 400, {
            ok: false,
            error: "A supported mail action is required."
          }, corsHeaders);
          return;
        }

        const eventType = await applyThreadAction(threadId, action, options);

        if (typeof options.recordEvent === "function") {
          options.recordEvent(eventType, { threadId, action });
        }

        if (typeof options.persist === "function") {
          await options.persist();
        }

        sendJson(response, 200, {
          ok: true,
          threadId,
          action
        }, corsHeaders);
        return;
      }

      if (request.method === "POST" && threadReplyMatch) {
        const threadId = decodeURIComponent(threadReplyMatch[1]);
        const payload = await readJsonBody(request);
        const replyBody = String(payload.body || "").trim();

        if (!replyBody) {
          sendJson(response, 400, {
            ok: false,
            error: "Reply body is required."
          }, corsHeaders);
          return;
        }

        let messageId = String(payload.messageId || "").trim();

        if (!messageId && typeof options.readThread === "function") {
          const labelLookup = await getLabelLookup(options);
          const rawThread = await options.readThread(threadId);
          const detail = buildThreadDetail(state, labelLookup, threadId, rawThread, null);
          messageId = detail.latestReplyToMessageId || "";
        }

        if (!messageId) {
          sendJson(response, 400, {
            ok: false,
            error: "No reply target message id is available for this thread."
          }, corsHeaders);
          return;
        }

        const result = typeof options.replyToMessage === "function"
          ? await options.replyToMessage(messageId, replyBody)
          : { id: null };

        if (typeof options.recordEvent === "function") {
          options.recordEvent("mail_api_reply_sent", {
            threadId,
            messageId,
            responseId: result && result.id ? result.id : ""
          });
        }

        if (typeof options.persist === "function") {
          await options.persist();
        }

        sendJson(response, 200, {
          ok: true,
          threadId,
          messageId,
          responseId: result && result.id ? result.id : null
        }, corsHeaders);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/mail/compose") {
        const payload = await readJsonBody(request);
        const to = String(payload.to || "").trim();
        const subject = String(payload.subject || "").trim();
        const body = String(payload.body || "").trim();

        if (!to || !body) {
          sendJson(response, 400, {
            ok: false,
            error: "Compose requires a recipient and a body."
          }, corsHeaders);
          return;
        }

        const result = typeof options.sendEmail === "function"
          ? await options.sendEmail({ to, subject, body })
          : { id: null };

        if (typeof options.recordEvent === "function") {
          options.recordEvent("mail_api_compose_sent", {
            to,
            subject
          });
        }

        if (typeof options.persist === "function") {
          await options.persist();
        }

        sendJson(response, 200, {
          ok: true,
          id: result && result.id ? result.id : null
        }, corsHeaders);
        return;
      }

      sendJson(response, 404, {
        ok: false,
        error: "Mail API route not found."
      }, corsHeaders);
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: serializeError(error)
      }, corsHeaders);
    }
  };
}

function startMailApiServer(options) {
  const host = options.host || DEFAULT_HOST;
  const port = Number.isFinite(Number(options.port)) ? Number(options.port) : DEFAULT_PORT;
  const handler = buildMailApiHandler(options);

  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      void handler(request, response);
    });

    server.on("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const resolvedPort = address && typeof address === "object" ? address.port : port;

      resolve({
        host,
        port: resolvedPort,
        publicOrigin: options.publicOrigin || DEFAULT_PUBLIC_ORIGIN,
        server,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => {
            if (error) {
              closeReject(error);
              return;
            }

            closeResolve();
          });
        })
      });
    });
  });
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_PUBLIC_ORIGIN,
  MAIL_VIEW_SPECS,
  buildHealthSnapshot,
  buildMailApiHandler,
  buildMailViews,
  buildThreadDetail,
  listThreadsForView,
  startMailApiServer
};
