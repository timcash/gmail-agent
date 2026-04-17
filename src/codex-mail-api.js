const http = require("http");

const { serializeError } = require("./codex-system");

const DEFAULT_PUBLIC_ORIGIN = process.env.CODEX_PUBLIC_ORIGIN
  || process.env.CODEX_MAIL_PUBLIC_ORIGIN
  || "https://codex.dialtone.earth";
const DEFAULT_HOST = process.env.CODEX_MAIL_HOST || "127.0.0.1";
const DEFAULT_PORT = Number.parseInt(process.env.CODEX_MAIL_PORT || "4192", 10);
const DEFAULT_ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/timcash\.github\.io$/i,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^http:\/\/localhost(?::\d+)?$/i
];
const MAIL_VIEW_SPECS = [
  {
    id: "inbox",
    label: "Inbox",
    description: "All tracked threads in the shared mailbox.",
    kind: "mail"
  },
  {
    id: "needs-reply",
    label: "Needs Reply",
    description: "Human mail waiting for a response.",
    kind: "triage"
  },
  {
    id: "waiting",
    label: "Waiting",
    description: "Threads waiting on someone else.",
    kind: "triage"
  },
  {
    id: "queued",
    label: "Queued",
    description: "Codex requests queued for the worker.",
    kind: "status"
  },
  {
    id: "working",
    label: "Working",
    description: "The worker is actively handling these threads.",
    kind: "status"
  },
  {
    id: "done",
    label: "Done",
    description: "Completed codex work threads.",
    kind: "status"
  }
];
const MAIL_VIEW_IDS = new Set(MAIL_VIEW_SPECS.map((view) => view.id));

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

function buildCorsHeaders(origin, allowedOrigins) {
  const headers = {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Vary": "Origin"
  };

  if (matchesAllowedOrigin(origin, allowedOrigins)) {
    headers["Access-Control-Allow-Origin"] = origin;
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
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => normalizeAddress(entry))
    .filter(Boolean);
}

function getThreadTasks(state, threadState) {
  return (threadState && Array.isArray(threadState.taskIds) ? threadState.taskIds : [])
    .map((taskId) => state.tasks && state.tasks[taskId] ? state.tasks[taskId] : null)
    .filter(Boolean)
    .sort((left, right) => String(right.requestedAt || "").localeCompare(String(left.requestedAt || "")));
}

function buildThreadBadges(threadState, latestTask) {
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

function buildThreadExcerpt(threadState, latestTask) {
  if (latestTask && latestTask.requestText) {
    return clipText(latestTask.requestText, 140);
  }

  if (latestTask && latestTask.workerSummary) {
    return clipText(latestTask.workerSummary, 140);
  }

  if (threadState && threadState.subject) {
    return clipText(threadState.subject, 140);
  }

  return "(no summary yet)";
}

function summarizeThread(state, threadState) {
  const tasks = getThreadTasks(state, threadState);
  const latestTask = tasks[0] || null;

  return {
    threadId: threadState.threadId,
    subject: threadState.subject || "(no subject)",
    updatedAt: threadState.updatedAt || threadState.createdAt || null,
    workspaceKey: threadState.workspaceKey || null,
    workspacePath: threadState.workspacePath || null,
    status: threadState.lastStatus || null,
    triage: threadState.lastTriageCategory || null,
    taskCount: tasks.length,
    latestTaskId: latestTask ? latestTask.id : null,
    excerpt: buildThreadExcerpt(threadState, latestTask),
    badges: buildThreadBadges(threadState, latestTask)
  };
}

function matchesThreadView(threadState, viewId) {
  if (viewId === "inbox") {
    return true;
  }

  if (!threadState || typeof threadState !== "object") {
    return false;
  }

  if (viewId === "queued" || viewId === "working" || viewId === "done") {
    return threadState.lastStatus === viewId;
  }

  if (viewId === "needs-reply" || viewId === "waiting") {
    return threadState.lastTriageCategory === viewId;
  }

  return false;
}

function buildMailViews(state) {
  const threads = Object.values(state && state.threads && typeof state.threads === "object" ? state.threads : {});

  return MAIL_VIEW_SPECS.map((view) => ({
    ...view,
    count: threads.filter((thread) => matchesThreadView(thread, view.id)).length
  }));
}

function listThreadsForView(state, viewId, limit = 40) {
  const threads = Object.values(state && state.threads && typeof state.threads === "object" ? state.threads : {})
    .filter((thread) => matchesThreadView(thread, viewId))
    .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))
    .slice(0, Math.max(1, limit))
    .map((threadState) => summarizeThread(state, threadState));

  return threads;
}

function normalizeMailMessage(message) {
  const payload = message && message.payload && typeof message.payload === "object"
    ? message.payload
    : null;
  const bodyText = clipText(
    message && message.bodyText
      ? String(message.bodyText)
      : extractPayloadText(payload) || String(message && message.snippet || ""),
    4000
  );

  return {
    id: message && message.id ? message.id : null,
    from: normalizeAddress(message && message.from),
    to: normalizeAddressList(message && message.to),
    sentAt: message && (message.internalDate || message.sentAt || message.date) ? String(message.internalDate || message.sentAt || message.date) : null,
    snippet: clipText(message && message.snippet ? message.snippet : bodyText, 220),
    bodyText,
    labelIds: Array.isArray(message && message.labelIds) ? message.labelIds.slice() : []
  };
}

function buildThreadDetail(state, threadId, rawThread, loadError = null) {
  const threadState = state && state.threads && state.threads[threadId]
    ? state.threads[threadId]
    : {
        threadId,
        subject: rawThread && rawThread.subject ? rawThread.subject : "(unknown thread)",
        updatedAt: null,
        lastStatus: null,
        lastTriageCategory: null,
        taskIds: []
      };
  const tasks = getThreadTasks(state, threadState);
  const messages = Array.isArray(rawThread && rawThread.messages)
    ? rawThread.messages.map((message) => normalizeMailMessage(message))
    : [];

  return {
    summary: summarizeThread(state, threadState),
    latestReplyToMessageId: messages.length
      ? messages[messages.length - 1].id
      : threadState.lastUserMessageId || null,
    loadError,
    tasks: tasks.map((task) => ({
      id: task.id,
      status: task.status,
      requestedAt: task.requestedAt || null,
      completedAt: task.completedAt || null,
      workflowStage: task.workflowStage || null,
      requestText: task.requestText || "",
      workerSummary: task.workerSummary || null
    })),
    messages
  };
}

function buildHealthSnapshot(context) {
  const state = context.getState();
  const runtime = context.getRuntimeInfo ? context.getRuntimeInfo() : {};
  const views = buildMailViews(state);

  return {
    ok: true,
    mailbox: context.getMailboxProfile ? context.getMailboxProfile() : null,
    runtime: runtime && typeof runtime === "object" ? runtime : {},
    counts: {
      threads: Object.keys(state.threads || {}).length,
      tasks: Object.keys(state.tasks || {}).length,
      queueDepth: Array.isArray(state.queue) ? state.queue.length : 0,
      activeTaskId: state.activeTaskId || null,
      events: Array.isArray(state.events) ? state.events.length : 0
    },
    views
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

function buildMailApiHandler(options) {
  const allowedOrigins = Array.isArray(options.allowedOrigins) && options.allowedOrigins.length
    ? options.allowedOrigins
    : DEFAULT_ALLOWED_ORIGIN_PATTERNS;

  return async (request, response) => {
    const origin = request.headers.origin || "";
    const corsHeaders = buildCorsHeaders(origin, allowedOrigins);
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
        sendJson(response, 200, buildHealthSnapshot(options), corsHeaders);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/mail/views") {
        sendJson(response, 200, {
          ok: true,
          views: buildMailViews(state)
        }, corsHeaders);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/mail/threads") {
        const requestedView = String(requestUrl.searchParams.get("view") || "inbox").trim().toLowerCase();
        const viewId = MAIL_VIEW_IDS.has(requestedView) ? requestedView : "inbox";
        const limit = Number.parseInt(requestUrl.searchParams.get("limit") || "40", 10);

        sendJson(response, 200, {
          ok: true,
          view: viewId,
          threads: listThreadsForView(state, viewId, Number.isFinite(limit) ? limit : 40)
        }, corsHeaders);
        return;
      }

      const threadMatch = requestUrl.pathname.match(/^\/api\/mail\/thread\/([^/]+)$/);
      const threadActionMatch = requestUrl.pathname.match(/^\/api\/mail\/thread\/([^/]+)\/(read|reply)$/);

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

        sendJson(response, 200, {
          ok: true,
          thread: buildThreadDetail(state, threadId, rawThread, loadError)
        }, corsHeaders);
        return;
      }

      if (request.method === "POST" && threadActionMatch) {
        const threadId = decodeURIComponent(threadActionMatch[1]);
        const action = threadActionMatch[2];

        if (action === "read") {
          if (typeof options.markThreadRead === "function") {
            await options.markThreadRead(threadId);
          }

          if (typeof options.recordEvent === "function") {
            options.recordEvent("mail_api_mark_read", { threadId });
          }

          if (typeof options.persist === "function") {
            await options.persist();
          }

          sendJson(response, 200, {
            ok: true,
            threadId
          }, corsHeaders);
          return;
        }

        if (action === "reply") {
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
            const rawThread = await options.readThread(threadId);
            const detail = buildThreadDetail(state, threadId, rawThread, null);
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
