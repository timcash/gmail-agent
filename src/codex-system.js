const SUBJECT_PREFIX = "codex";
const LEGACY_SUBJECT_PREFIXES = ["codex-314"];
const STATUS_LABELS = {
  queued: `${SUBJECT_PREFIX}/queued`,
  working: `${SUBJECT_PREFIX}/working`,
  review: `${SUBJECT_PREFIX}/review`,
  done: `${SUBJECT_PREFIX}/done`,
  error: `${SUBJECT_PREFIX}/error`,
  blocked: `${SUBJECT_PREFIX}/blocked`
};
const LEGACY_STATUS_LABELS = {
  queued: "codex-314/queued",
  working: "codex-314/working",
  review: "codex-314/review",
  done: "codex-314/done",
  error: "codex-314/error",
  blocked: "codex-314/blocked"
};

const MANAGED_LABEL_NAMES = Object.values(STATUS_LABELS);
const LEGACY_MANAGED_LABEL_NAMES = Object.values(LEGACY_STATUS_LABELS);
const TRIAGE_LABELS = {
  needsReply: "mail/needs-reply",
  waiting: "mail/waiting",
  receipt: "mail/receipt",
  newsletter: "mail/newsletter",
  alert: "mail/alert",
  personal: "mail/personal"
};
const TRIAGE_LABEL_NAMES = Object.values(TRIAGE_LABELS);
const ALL_SUBJECT_PREFIXES = [SUBJECT_PREFIX, ...LEGACY_SUBJECT_PREFIXES]
  .map((value) => String(value || "").trim().toLowerCase())
  .filter(Boolean)
  .sort((left, right) => right.length - left.length);
const MONITOR_REPORT_HEADER = `${SUBJECT_PREFIX} monitor`;
const WORKER_REPORT_HEADER = `${SUBJECT_PREFIX} worker`;
const LEGACY_MONITOR_REPORT_HEADERS = LEGACY_SUBJECT_PREFIXES.map((prefix) => `${prefix} monitor`);
const LEGACY_WORKER_REPORT_HEADERS = LEGACY_SUBJECT_PREFIXES.map((prefix) => `${prefix} worker`);
const LEGACY_OPERATOR_REPORT_HEADERS = LEGACY_SUBJECT_PREFIXES.map((prefix) => `${prefix} operator report`);
const DEFAULT_STATE_VERSION = 6;
const DEFAULT_EVENT_LIMIT = 200;
const EMAIL_CLI_COMMANDS = [
  {
    name: "help",
    usage: "codex/help",
    summary: "show the email CLI help and command vocabulary",
    allowSpace: true,
    aliases: []
  },
  {
    name: "ping",
    usage: "codex/ping",
    summary: "prove the daemon is awake without waking the worker",
    allowSpace: true,
    aliases: []
  },
  {
    name: "ps",
    usage: "codex/ps",
    summary: "show the live daemon, queue, and session summary",
    allowSpace: true,
    aliases: ["status", "state"]
  },
  {
    name: "health",
    usage: "codex/health",
    summary: "show operational health, watch drift, and label readiness",
    allowSpace: false,
    aliases: []
  },
  {
    name: "queue",
    usage: "codex/queue",
    summary: "show the active task and waiting backlog",
    allowSpace: false,
    aliases: ["ls"]
  },
  {
    name: "tasks",
    usage: "codex/tasks [count]",
    summary: "show recent tasks across the mailbox",
    allowSpace: false,
    aliases: ["recent"]
  },
  {
    name: "errors",
    usage: "codex/errors [count]",
    summary: "show blocked and errored tasks plus monitor issues",
    allowSpace: false,
    aliases: []
  },
  {
    name: "report",
    usage: "codex/report",
    summary: "show a compact operator report with queue and event context",
    allowSpace: false,
    aliases: []
  },
  {
    name: "task",
    usage: "codex/task [task-id|current|latest|thread]",
    summary: "inspect one task in detail",
    allowSpace: false,
    aliases: []
  },
  {
    name: "thread",
    usage: "codex/thread",
    summary: "inspect the current Gmail thread state",
    allowSpace: false,
    aliases: []
  },
  {
    name: "sessions",
    usage: "codex/sessions",
    summary: "show monitor and worker session reuse",
    allowSpace: false,
    aliases: ["session"]
  },
  {
    name: "monitor",
    usage: "codex/monitor",
    summary: "show the monitor role, review posture, and issue totals",
    allowSpace: false,
    aliases: []
  },
  {
    name: "worker",
    usage: "codex/worker",
    summary: "show the worker role and current thread focus",
    allowSpace: false,
    aliases: []
  },
  {
    name: "workspace",
    usage: "codex/workspace [name|clear]",
    summary: "inspect or pin the thread workspace under your home folder",
    allowSpace: true,
    aliases: ["cwd", "folder"]
  },
  {
    name: "labels",
    usage: "codex/labels",
    summary: "show Gmail status labels and the current thread label state",
    allowSpace: false,
    aliases: ["label"]
  },
  {
    name: "watch",
    usage: "codex/watch",
    summary: "show Gmail watch and reconcile loop status",
    allowSpace: false,
    aliases: []
  },
  {
    name: "config",
    usage: "codex/config",
    summary: "show daemon policy, query, and runtime configuration",
    allowSpace: false,
    aliases: []
  },
  {
    name: "logs",
    usage: "codex/logs [count]",
    summary: "show recent system events",
    allowSpace: false,
    aliases: ["log"]
  },
  {
    name: "reset",
    usage: "codex/reset",
    summary: "clear the worker session for the current thread",
    allowSpace: true,
    aliases: []
  }
];
const HELP_GUIDE_SECTIONS = [
  {
    title: "What the system is:",
    lines: [
      "- The monitor is the fast control role. It handles labels, queueing, reports, health checks, direct commands, and inbox triage.",
      "- The worker is the Codex-backed role. It handles real repo work inside the pinned workspace for a thread.",
      "- Only one worker task runs at a time system-wide. New work gets a queue acknowledgement right away.",
      "- Follow-ups in the same Gmail thread reuse the same worker session and thread history.",
      "- The worker is guided through a TDD flow: plan -> red -> green -> refactor -> docs."
    ]
  },
  {
    title: "Best direct commands:",
    lines: [
      `- ${SUBJECT_PREFIX}/help`,
      `- ${SUBJECT_PREFIX}/ps`,
      `- ${SUBJECT_PREFIX}/health`,
      `- ${SUBJECT_PREFIX}/queue`,
      `- ${SUBJECT_PREFIX}/tasks 10`,
      `- ${SUBJECT_PREFIX}/errors 10`,
      `- ${SUBJECT_PREFIX}/report`,
      `- ${SUBJECT_PREFIX}/thread`,
      `- ${SUBJECT_PREFIX}/task latest`,
      `- ${SUBJECT_PREFIX}/watch`,
      `- ${SUBJECT_PREFIX}/labels`,
      `- ${SUBJECT_PREFIX}/config`,
      `- ${SUBJECT_PREFIX}/logs 10`,
      `- ${SUBJECT_PREFIX}/reset`
    ]
  },
  {
    title: "Workspace routing:",
    lines: [
      `- ${SUBJECT_PREFIX}/workspace linker`,
      `- ${SUBJECT_PREFIX}/linker fix the build`,
      `- ${SUBJECT_PREFIX}/workspace clear`
    ]
  },
  {
    title: "Recommended workflow:",
    lines: [
      `1. Start with ${SUBJECT_PREFIX}/health or ${SUBJECT_PREFIX}/ps to confirm the daemon is healthy and the queue is clear.`,
      `2. Pin the thread to a repo folder with ${SUBJECT_PREFIX}/workspace <folder> if you want work to happen in a specific project.`,
      `3. Send the real work request in the same thread, for example: ${SUBJECT_PREFIX}/linker review the repo and fix the failing tests.`,
      `4. While work is running, use ${SUBJECT_PREFIX}/thread, ${SUBJECT_PREFIX}/task latest, or ${SUBJECT_PREFIX}/report to inspect status without waking a new worker.`,
      `5. If something looks wrong, use ${SUBJECT_PREFIX}/errors 10 and ${SUBJECT_PREFIX}/logs 10.`,
      `6. If you want a clean conversation state for that thread, use ${SUBJECT_PREFIX}/reset and then send the next request.`
    ]
  },
  {
    title: "Inbox triage:",
    lines: [
      "- Normal inbox mail is categorized into mail/needs-reply, mail/waiting, mail/receipt, mail/newsletter, mail/alert, and mail/personal.",
      "- Triage is label-only right now. It does not auto-archive mail."
    ]
  },
  {
    title: "Current safety posture:",
    lines: [
      "- Self-only mode is enabled, so the daemon only responds to mail that stays within your mailbox.",
      "- The monitor remains read-only.",
      "- The worker is the only role that edits files in the pinned workspace.",
      "- Monitor commands do not call any LLM."
    ]
  },
  {
    title: "Good starter commands:",
    lines: [
      `- ${SUBJECT_PREFIX}/health`,
      `- ${SUBJECT_PREFIX}/workspace linker`,
      `- ${SUBJECT_PREFIX}/linker review the repo and give me a report`,
      `- ${SUBJECT_PREFIX}/thread`,
      `- ${SUBJECT_PREFIX}/report`
    ]
  }
];
const DIRECT_COMMANDS = new Set(EMAIL_CLI_COMMANDS.map((command) => command.name));
const SPACE_DIRECT_COMMANDS = new Set(
  EMAIL_CLI_COMMANDS
    .filter((command) => command.allowSpace)
    .flatMap((command) => [command.name, ...(command.aliases || [])])
);
const COMMAND_ALIASES = new Map(
  EMAIL_CLI_COMMANDS.flatMap((command) =>
    (command.aliases || []).map((alias) => [alias, command.name])
  )
);
const NATURAL_LANGUAGE_MONITOR_COMMANDS = [
  {
    pattern: /^is (?:the )?gmail[- ]agent up and running$/,
    command: "ping"
  }
];

function nowIso(now = () => new Date()) {
  return now().toISOString();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseJson(text) {
  const trimmed = String(text || "").trim();

  if (!trimmed) {
    return null;
  }

  const firstChar = trimmed[0];

  if (firstChar === "{" || firstChar === "[") {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < trimmed.length; index += 1) {
      const char = trimmed[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }

        continue;
      }

      if (char === "\"") {
        inString = true;
      } else if (char === "{" || char === "[") {
        depth += 1;
      } else if (char === "}" || char === "]") {
        depth -= 1;

        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(0, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com"
]);
const ALERT_PATTERNS = [
  "security alert",
  "verification code",
  "verification link",
  "verify your email",
  "verify your account",
  "passkey",
  "one-time password",
  "otp",
  "2fa",
  "two-factor",
  "two factor",
  "new sign-in",
  "new signin",
  "login attempt",
  "password reset",
  "device added",
  "account alert",
  "suspicious activity"
];
const WAITING_PATTERNS = [
  "we received your request",
  "we received your message",
  "we have received your request",
  "we'll get back to you",
  "we will get back to you",
  "thank you for contacting",
  "thanks for contacting",
  "case has been created",
  "ticket has been created",
  "support request received",
  "auto reply",
  "automatic reply",
  "out of office",
  "out-of-office"
];
const RECEIPT_PATTERNS = [
  "receipt",
  "invoice",
  "payment",
  "paid",
  "transaction",
  "billing",
  "renewal",
  "refund",
  "your order",
  "order #",
  "shipped",
  "delivered",
  "tracking",
  "statement",
  "subscription"
];
const NEWSLETTER_PATTERNS = [
  "unsubscribe",
  "manage preferences",
  "manage subscription",
  "view in browser",
  "newsletter",
  "digest",
  "roundup",
  "release notes",
  "changelog",
  "weekly",
  "daily",
  "top stories"
];

function normalizeRecipientList(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map((entry) => ({
      name: entry && entry.name ? String(entry.name) : "",
      email: normalizeEmail(entry && entry.email)
    }))
    .filter((entry) => entry.email);
}

function getEmailDomain(email) {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf("@");
  return atIndex === -1 ? "" : normalized.slice(atIndex + 1);
}

function getEmailLocalPart(email) {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf("@");
  return atIndex === -1 ? normalized : normalized.slice(0, atIndex);
}

function compactMessageText(message) {
  return [
    String(message && message.subject || ""),
    String(message && message.body_text || ""),
    String(message && message.from && message.from.name || ""),
    String(message && message.from && message.from.email || "")
  ].join("\n").toLowerCase();
}

function includesAnyPattern(text, patterns) {
  return patterns.some((pattern) => text.includes(pattern));
}

function isAutomatedSender(message) {
  const senderEmail = normalizeEmail(message && message.from && message.from.email);
  const senderName = String(message && message.from && message.from.name || "").toLowerCase();
  const localPart = getEmailLocalPart(senderEmail);

  if (!senderEmail) {
    return true;
  }

  return /(no.?reply|do.?not.?reply|notifications?|mailer-daemon|postmaster|bounce)/i.test(localPart)
    || /(no.?reply|notification|system|support update)/i.test(senderName);
}

function classifyInboxMessage(message, selfEmail) {
  const senderEmail = normalizeEmail(message && message.from && message.from.email);

  if (!senderEmail || senderEmail === normalizeEmail(selfEmail)) {
    return null;
  }

  const text = compactMessageText(message);

  if (includesAnyPattern(text, ALERT_PATTERNS)) {
    return {
      category: "alert",
      labelName: TRIAGE_LABELS.alert,
      reason: "alert-pattern"
    };
  }

  if (includesAnyPattern(text, WAITING_PATTERNS)) {
    return {
      category: "waiting",
      labelName: TRIAGE_LABELS.waiting,
      reason: "waiting-pattern"
    };
  }

  if (includesAnyPattern(text, RECEIPT_PATTERNS)) {
    return {
      category: "receipt",
      labelName: TRIAGE_LABELS.receipt,
      reason: "receipt-pattern"
    };
  }

  if (includesAnyPattern(text, NEWSLETTER_PATTERNS)) {
    return {
      category: "newsletter",
      labelName: TRIAGE_LABELS.newsletter,
      reason: "newsletter-pattern"
    };
  }

  if (!isAutomatedSender(message) && FREE_MAIL_DOMAINS.has(getEmailDomain(senderEmail))) {
    return {
      category: "personal",
      labelName: TRIAGE_LABELS.personal,
      reason: "personal-domain"
    };
  }

  if (!isAutomatedSender(message)) {
    return {
      category: "needs-reply",
      labelName: TRIAGE_LABELS.needsReply,
      reason: "human-sender"
    };
  }

  return {
    category: "newsletter",
    labelName: TRIAGE_LABELS.newsletter,
    reason: "automated-fallback"
  };
}

function getParticipantEmails(message) {
  return Array.from(new Set([
    normalizeEmail(message && message.from && message.from.email),
    normalizeEmail(message && message.reply_to && message.reply_to.email),
    ...normalizeRecipientList(message && message.to).map((entry) => entry.email),
    ...normalizeRecipientList(message && message.cc).map((entry) => entry.email)
  ].filter(Boolean)));
}

function isSelfOnlyMessage(message, selfEmail) {
  const normalizedSelf = normalizeEmail(selfEmail);
  const participants = getParticipantEmails(message);
  const sender = normalizeEmail(message && message.from && message.from.email);

  if (!normalizedSelf || !sender || sender !== normalizedSelf) {
    return false;
  }

  return participants.length > 0 && participants.every((email) => email === normalizedSelf);
}

function stripReplyPrefixes(subject) {
  let value = String(subject || "").trim();

  while (/^(re|fw|fwd):\s*/i.test(value)) {
    value = value.replace(/^(re|fw|fwd):\s*/i, "").trim();
  }

  return value;
}

function normalizeCommandName(value) {
  const lowered = String(value || "").trim().toLowerCase();

  if (!lowered) {
    return "";
  }

  return COMMAND_ALIASES.get(lowered) || lowered;
}

function isDirectCommandName(value) {
  return DIRECT_COMMANDS.has(normalizeCommandName(value));
}

function parseNaturalLanguageMonitorCommand(text) {
  const normalized = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[?!.\s]+$/g, "")
    .replace(/\s+/g, " ");
  const matchedCommand = NATURAL_LANGUAGE_MONITOR_COMMANDS.find(({ pattern }) => pattern.test(normalized));
  return matchedCommand ? matchedCommand.command : null;
}

function parseCommandText(text, options = {}) {
  const cleaned = options.skipReplyStrip ? String(text || "").trim() : stripReplyPrefixes(text);
  const prefixPattern = ALL_SUBJECT_PREFIXES.map((prefix) => escapeRegExp(prefix)).join("|");
  const match = cleaned.match(new RegExp(`\\b(?:${prefixPattern})(?=$|[/:\\s])([\\s\\S]*)$`, "i"));

  if (!match) {
    return {
      matches: false,
      command: null,
      commandArgs: "",
      explicitCommand: false,
      rawRemainder: "",
      rawCommandToken: "",
      viaSlash: false,
      unknownCommand: false,
      workspaceToken: null
    };
  }

  const remainder = String(match[1] || "");
  const trimmedRemainder = remainder.trim();

  if (!trimmedRemainder) {
    return {
      matches: true,
      command: "run",
      commandArgs: "",
      explicitCommand: false,
      rawRemainder: "",
      rawCommandToken: "",
      viaSlash: false,
      unknownCommand: false,
      workspaceToken: null
    };
  }

  const viaSlash = /^[/:]/.test(trimmedRemainder);
  const content = viaSlash ? trimmedRemainder.slice(1).trim() : trimmedRemainder;
  const [rawToken = "", ...rest] = content.split(/\s+/).filter(Boolean);
  const normalizedToken = normalizeCommandName(rawToken);
  const commandArgs = rest.join(" ").trim();

  if (viaSlash) {
    if (rawToken && !isDirectCommandName(normalizedToken || rawToken)) {
      return {
        matches: true,
        command: "run",
        commandArgs,
        explicitCommand: false,
        rawRemainder: trimmedRemainder,
        rawCommandToken: rawToken.toLowerCase(),
        viaSlash: true,
        unknownCommand: false,
        workspaceToken: rawToken
      };
    }

    const command = normalizedToken || "help";

    return {
      matches: true,
      command,
      commandArgs,
      explicitCommand: true,
      rawRemainder: trimmedRemainder,
      rawCommandToken: rawToken.toLowerCase(),
      viaSlash: true,
      unknownCommand: Boolean(rawToken) && command !== "run" && !isDirectCommandName(command),
      workspaceToken: null
    };
  }

  if (normalizedToken === "run") {
    return {
      matches: true,
      command: "run",
      commandArgs,
      explicitCommand: true,
      rawRemainder: trimmedRemainder,
      rawCommandToken: rawToken.toLowerCase(),
      viaSlash: false,
      unknownCommand: false,
      workspaceToken: null
    };
  }

  if (SPACE_DIRECT_COMMANDS.has(rawToken.toLowerCase()) || (rawToken && SPACE_DIRECT_COMMANDS.has(normalizedToken))) {
    return {
      matches: true,
      command: normalizedToken,
      commandArgs,
      explicitCommand: true,
      rawRemainder: trimmedRemainder,
      rawCommandToken: rawToken.toLowerCase(),
      viaSlash: false,
      unknownCommand: false,
      workspaceToken: null
    };
  }

  const naturalLanguageCommand = parseNaturalLanguageMonitorCommand(trimmedRemainder);

  if (naturalLanguageCommand) {
    return {
      matches: true,
      command: naturalLanguageCommand,
      commandArgs: "",
      explicitCommand: true,
      rawRemainder: trimmedRemainder,
      rawCommandToken: rawToken.toLowerCase(),
      viaSlash: false,
      unknownCommand: false,
      workspaceToken: null
    };
  }

  return {
    matches: true,
    command: "run",
    commandArgs: trimmedRemainder,
    explicitCommand: false,
    rawRemainder: trimmedRemainder,
    rawCommandToken: rawToken.toLowerCase(),
    viaSlash: false,
    unknownCommand: false,
    workspaceToken: null
  };
}

function parseSubjectCommand(subject) {
  return parseCommandText(subject, { skipReplyStrip: false });
}

function extractLatestPlainText(message) {
  const body = String(message && message.body_text || "")
    .replace(/\r\n/g, "\n")
    .trim();

  if (!body) {
    return "";
  }

  const markers = [
    /\nOn .+ wrote:\n/i,
    /\nFrom: .+\nSent: .+\n/i
  ];

  for (const marker of markers) {
    const match = marker.exec(body);

    if (match && match.index > 0) {
      return body.slice(0, match.index).trim();
    }
  }

  const nonQuotedLines = body
    .split("\n")
    .filter((line) => !line.startsWith(">"))
    .join("\n")
    .trim();

  return nonQuotedLines || body;
}

function parseBodyCommand(latestBodyText) {
  const latestBody = String(latestBodyText || "").replace(/\r\n/g, "\n").trim();

  if (!latestBody) {
    return {
      matches: false,
      command: null,
      commandArgs: "",
      explicitCommand: false,
      rawRemainder: "",
      rawCommandToken: "",
      viaSlash: false,
      unknownCommand: false,
      workspaceToken: null,
      remainingBody: ""
    };
  }

  const lines = latestBody.split("\n");
  const firstIndex = lines.findIndex((line) => String(line).trim());

  if (firstIndex === -1) {
    return {
      matches: false,
      command: null,
      commandArgs: "",
      explicitCommand: false,
      rawRemainder: "",
      rawCommandToken: "",
      viaSlash: false,
      unknownCommand: false,
      workspaceToken: null,
      remainingBody: latestBody
    };
  }

  const firstLine = lines[firstIndex].trim();
  const parsed = parseCommandText(firstLine, { skipReplyStrip: true });

  if (!parsed.matches) {
    return {
      ...parsed,
      remainingBody: latestBody
    };
  }

  const remainingBody = lines
    .slice(firstIndex + 1)
    .join("\n")
    .trim();

  return {
    ...parsed,
    remainingBody
  };
}

function parseMessageCommand(message) {
  const subjectCommand = parseSubjectCommand(message && message.subject || "");
  const latestBody = extractLatestPlainText(message);

  if (!subjectCommand.matches) {
    return {
      ...subjectCommand,
      source: "subject",
      latestBody,
      taskBody: latestBody,
      bodyCommand: parseBodyCommand(latestBody),
      subjectCommand
    };
  }

  const bodyCommand = parseBodyCommand(latestBody);

  if (bodyCommand.matches && bodyCommand.explicitCommand) {
    return {
      ...bodyCommand,
      source: "body",
      latestBody,
      taskBody: bodyCommand.remainingBody,
      bodyCommand,
      subjectCommand
    };
  }

  return {
    ...subjectCommand,
    source: "subject",
    latestBody,
    taskBody: latestBody,
    bodyCommand,
    subjectCommand
  };
}

function looksLikeSystemReply(message) {
  const latestBody = extractLatestPlainText(message).toLowerCase();

  if (!latestBody) {
    return false;
  }

  return [
    MONITOR_REPORT_HEADER,
    WORKER_REPORT_HEADER,
    `${SUBJECT_PREFIX} operator report`,
    ...LEGACY_MONITOR_REPORT_HEADERS,
    ...LEGACY_WORKER_REPORT_HEADERS,
    ...LEGACY_OPERATOR_REPORT_HEADERS
  ].some((prefix) => latestBody.startsWith(prefix));
}

function buildTaskRequestText(message, commandContext) {
  const taskBody = String(commandContext && commandContext.taskBody || extractLatestPlainText(message)).trim();
  const commandArgs = String(commandContext && commandContext.commandArgs || "").trim();

  if (taskBody && commandArgs) {
    return `${commandArgs}\n\n${taskBody}`.trim();
  }

  return taskBody || commandArgs;
}

function createInitialState(now = () => new Date()) {
  return {
    version: DEFAULT_STATE_VERSION,
    createdAt: nowIso(now),
    mailboxEmail: null,
    nextTaskSequence: 1,
    nextEventSequence: 1,
    activeTaskId: null,
    queue: [],
    tasks: {},
    threads: {},
    messages: {},
    labels: {},
    events: [],
    monitor: {
      sessionId: null
    },
    watch: {
      mode: "evented",
      renewAfterHours: 24,
      lastStartedAt: null,
      lastEventAt: null,
      lastErrorAt: null,
      lastError: null
    }
  };
}

function normalizeThreadState(threadId, value = {}, now = () => new Date()) {
  return {
    threadId,
    subject: value.subject || null,
    createdAt: value.createdAt || nowIso(now),
    updatedAt: value.updatedAt || nowIso(now),
    workerSessionId: value.workerSessionId || null,
    workspaceKey: value.workspaceKey || null,
    workspacePath: value.workspacePath || null,
    systemMessageIds: Array.isArray(value.systemMessageIds) ? value.systemMessageIds.slice() : [],
    taskIds: Array.isArray(value.taskIds) ? value.taskIds.slice() : [],
    lastStatus: value.lastStatus || null,
    lastUserMessageId: value.lastUserMessageId || null,
    lastTriageCategory: value.lastTriageCategory || null,
    lastTriageAt: value.lastTriageAt || null,
    lastTriageMessageId: value.lastTriageMessageId || null
  };
}

function normalizeTaskState(taskId, value = {}, now = () => new Date()) {
  return {
    id: taskId,
    threadId: value.threadId || null,
    messageId: value.messageId || null,
    subject: value.subject || null,
    command: value.command || "run",
    requestText: value.requestText || "",
    workspaceKey: value.workspaceKey || null,
    workspacePath: value.workspacePath || null,
    requestedAt: value.requestedAt || nowIso(now),
    startedAt: value.startedAt || null,
    completedAt: value.completedAt || null,
    status: value.status || "queued",
    queueAckId: value.queueAckId || null,
    finalReplyId: value.finalReplyId || null,
    workerSessionIdUsed: value.workerSessionIdUsed || null,
    monitorSessionIdUsed: value.monitorSessionIdUsed || null,
    workflowStage: value.workflowStage || null,
    workflowHistory: Array.isArray(value.workflowHistory) ? value.workflowHistory.map((entry) => ({ ...entry })) : [],
    error: value.error || null,
    monitorIssues: Array.isArray(value.monitorIssues) ? value.monitorIssues.slice() : [],
    workerSummary: value.workerSummary || null
  };
}

function normalizeEventState(value = {}, now = () => new Date()) {
  return {
    id: value.id || null,
    at: value.at || nowIso(now),
    type: value.type || "event",
    message: value.message || null,
    details: value.details && typeof value.details === "object" ? { ...value.details } : {}
  };
}

function normalizeState(rawState, now = () => new Date()) {
  const initial = createInitialState(now);
  const source = rawState && typeof rawState === "object" ? rawState : {};
  const normalized = {
    ...initial,
    ...source,
    version: DEFAULT_STATE_VERSION,
    queue: Array.isArray(source.queue) ? source.queue.slice() : [],
    tasks: {},
    threads: {},
    messages: source.messages && typeof source.messages === "object" ? source.messages : {},
    labels: source.labels && typeof source.labels === "object" ? source.labels : {},
    events: Array.isArray(source.events) ? source.events.map((event) => normalizeEventState(event, now)).slice(-DEFAULT_EVENT_LIMIT) : [],
    monitor: {
      sessionId: source.monitor && source.monitor.sessionId ? source.monitor.sessionId : null
    },
    watch: {
      ...initial.watch,
      ...(source.watch && typeof source.watch === "object" ? source.watch : {})
    },
    nextTaskSequence: Number.isFinite(Number(source.nextTaskSequence))
      ? Math.max(1, Number(source.nextTaskSequence))
      : 1,
    nextEventSequence: Number.isFinite(Number(source.nextEventSequence))
      ? Math.max(1, Number(source.nextEventSequence))
      : Math.max(1, (Array.isArray(source.events) ? source.events.length : 0) + 1)
  };

  for (const [taskId, value] of Object.entries(source.tasks || {})) {
    normalized.tasks[taskId] = normalizeTaskState(taskId, value, now);
  }

  for (const [threadId, value] of Object.entries(source.threads || {})) {
    normalized.threads[threadId] = normalizeThreadState(threadId, value, now);
  }

  for (const [status, labelName] of Object.entries(STATUS_LABELS)) {
    const legacyLabelName = LEGACY_STATUS_LABELS[status];

    if (!normalized.labels[labelName] && legacyLabelName && normalized.labels[legacyLabelName]) {
      normalized.labels[labelName] = normalized.labels[legacyLabelName];
    }
  }

  if (normalized.activeTaskId && !normalized.tasks[normalized.activeTaskId]) {
    normalized.activeTaskId = null;
  }

  normalized.queue = normalized.queue.filter((taskId) => normalized.tasks[taskId]);

  return normalized;
}

function clipText(text, maxLength = 120) {
  const value = String(text || "").replace(/\s+/g, " ").trim();

  if (!value) {
    return "(empty)";
  }

  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function buildQueueRows(system, limit = 10) {
  const rows = [];
  const activeTask = system.state.activeTaskId ? system.state.tasks[system.state.activeTaskId] : null;

  if (activeTask) {
    rows.push(`1. ${activeTask.id} working thread=${activeTask.threadId} workspace=${activeTask.workspaceKey || "default"} requested=${activeTask.requestedAt} request=${clipText(activeTask.requestText, 70)}`);
  }

  for (const queuedTaskId of system.state.queue.slice(0, Math.max(0, limit - rows.length))) {
    const task = system.state.tasks[queuedTaskId];

    if (!task) {
      continue;
    }

    rows.push(`${rows.length + 1}. ${task.id} queued thread=${task.threadId} workspace=${task.workspaceKey || "default"} requested=${task.requestedAt} request=${clipText(task.requestText, 70)}`);
  }

  return rows;
}

function buildTaskCounts(system) {
  const tasks = Object.values(system.state.tasks);
  const counts = {
    total: tasks.length,
    queued: 0,
    working: 0,
    review: 0,
    done: 0,
    error: 0,
    blocked: 0
  };

  for (const task of tasks) {
    counts[task.status] = (counts[task.status] || 0) + 1;
  }

  return counts;
}

function buildMessageCounts(system) {
  const counts = {
    total: 0,
    user: 0,
    system: 0,
    triaged: 0,
    ignored: 0
  };

  for (const value of Object.values(system.state.messages || {})) {
    counts.total += 1;
    counts[value.kind] = (counts[value.kind] || 0) + 1;
  }

  return counts;
}

function formatQueuePosition(system, taskId) {
  if (system.state.activeTaskId === taskId) {
    return 1;
  }

  const index = system.state.queue.indexOf(taskId);
  return index === -1 ? system.state.queue.length + (system.state.activeTaskId ? 1 : 0) : index + 1 + (system.state.activeTaskId ? 1 : 0);
}

function buildMonitorReport(lines) {
  return [
    MONITOR_REPORT_HEADER,
    "",
    ...lines
  ].join("\n");
}

function buildWorkerReport(lines) {
  return [
    WORKER_REPORT_HEADER,
    "",
    ...lines
  ].join("\n");
}

function buildCommandHelpLines() {
  return EMAIL_CLI_COMMANDS.map((command) => {
    const aliasText = command.aliases && command.aliases.length
      ? ` aliases: ${command.aliases.map((alias) => `/${alias}`).join(", ")}`
      : "";

    return `  ${command.usage}  ${command.summary}${aliasText}`;
  });
}

function parseListCount(value, { min = 1, max = 20, fallback = 10 } = {}) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function listRecentTasks(system, count = 10) {
  return Object.values(system.state.tasks)
    .sort((left, right) => String(right.requestedAt || "").localeCompare(String(left.requestedAt || "")))
    .slice(0, count);
}

function normalizeWorkspaceReference(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^~\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

function formatWorkspaceLine(workspaceKey, workspacePath) {
  if (!workspacePath) {
    return "workspace: default";
  }

  return `workspace: ${workspaceKey || workspacePath} -> ${workspacePath}`;
}

function buildHelpBody() {
  const lines = [
    "Codex Email System Guide",
    ""
  ];

  for (const section of HELP_GUIDE_SECTIONS) {
    lines.push(section.title, ...section.lines, "");
  }

  lines.push(
    "Direct monitor commands:",
    ...buildCommandHelpLines(),
    "",
    "Body commands:",
    `  Put a command like \`${SUBJECT_PREFIX}/ps\` on the first non-empty line of the email body.`,
    "  The monitor will run it without invoking the worker."
  );

  return buildMonitorReport(lines);
}

function buildQueueAckBody(system, task, threadState) {
  const statusLine = task.status === "working" ? "in-work" : "queued";

  return buildMonitorReport([
    `status: ${statusLine}`,
    `task: ${task.id}`,
    `thread: ${threadState.threadId}`,
    formatWorkspaceLine(task.workspaceKey || threadState.workspaceKey, task.workspacePath || threadState.workspacePath),
    `queue-position: ${formatQueuePosition(system, task.id)}`,
    `worker-session: ${threadState.workerSessionId || "new"}`,
    `requested-at: ${task.requestedAt}`,
    "",
    "The daemon is awake and this request is recorded.",
    `Use \`${SUBJECT_PREFIX}/ps\` or \`${SUBJECT_PREFIX}/queue\` to inspect the worker.`
  ]);
}

function buildPingBody(system, threadState, runtimeInfo) {
  return buildMonitorReport([
    "status: awake",
    `mailbox: ${system.mailboxEmail || "unknown"}`,
    `thread: ${threadState ? threadState.threadId : "n/a"}`,
    `daemon-pid: ${runtimeInfo.pid || process.pid}`,
    `watch-mode: ${runtimeInfo.mode || system.state.watch.mode || "evented"}`,
    `last-event-at: ${system.state.watch.lastEventAt || "none"}`,
    `active-task: ${system.state.activeTaskId || "none"}`
  ]);
}

function buildPsBody(system, threadState, runtimeInfo) {
  const taskCounts = buildTaskCounts(system);
  const messageCounts = buildMessageCounts(system);
  const activeTask = system.state.activeTaskId ? system.state.tasks[system.state.activeTaskId] : null;
  const lines = [
    "status: awake",
    `mailbox: ${system.mailboxEmail || "unknown"}`,
    `daemon-pid: ${runtimeInfo.pid || process.pid}`,
    `watch-mode: ${runtimeInfo.mode || system.state.watch.mode || "evented"}`,
    `watch-last-started-at: ${system.state.watch.lastStartedAt || "none"}`,
      `watch-last-event-at: ${system.state.watch.lastEventAt || "none"}`,
      `active-task: ${activeTask ? activeTask.id : "none"}`,
      `queue-depth: ${system.state.queue.length}`,
      `tasks: total=${taskCounts.total} queued=${taskCounts.queued} working=${taskCounts.working} review=${taskCounts.review} done=${taskCounts.done} blocked=${taskCounts.blocked} error=${taskCounts.error}`,
      `messages: total=${messageCounts.total} user=${messageCounts.user} system=${messageCounts.system} triaged=${messageCounts.triaged} ignored=${messageCounts.ignored}`,
      `monitor-session: ${system.state.monitor.sessionId || "new"}`
    ];

  if (threadState) {
      lines.push(`thread: ${threadState.threadId}`);
      lines.push(`thread-status: ${threadState.lastStatus || "idle"}`);
      lines.push(`thread-triage: ${threadState.lastTriageCategory || "none"}`);
      lines.push(formatWorkspaceLine(threadState.workspaceKey, threadState.workspacePath));
      lines.push(`thread-worker-session: ${threadState.workerSessionId || "new"}`);
      lines.push(`thread-task-count: ${threadState.taskIds.length}`);
  }

  if (activeTask) {
    lines.push(`active-thread: ${activeTask.threadId}`);
    lines.push(formatWorkspaceLine(activeTask.workspaceKey, activeTask.workspacePath));
    lines.push(`active-workflow-stage: ${activeTask.workflowStage || "none"}`);
    lines.push(`active-request: ${clipText(activeTask.requestText, 90)}`);
  }

  const queueRows = buildQueueRows(system, 5);

  if (queueRows.length) {
    lines.push("");
    lines.push("queue:");
    lines.push(...queueRows);
  }

  return buildMonitorReport(lines);
}

function buildQueueBody(system) {
  const rows = buildQueueRows(system, 20);

  return buildMonitorReport([
    `active-task: ${system.state.activeTaskId || "none"}`,
    `queue-depth: ${system.state.queue.length}`,
    "",
    "queue:",
    ...(rows.length ? rows : ["(empty)"])
  ]);
}

function buildHealthBody(system, threadState, runtimeInfo) {
  const taskCounts = buildTaskCounts(system);
  const watchError = system.state.watch.lastError || null;
  const expectedLabels = Array.from(new Set([
    ...MANAGED_LABEL_NAMES,
    ...TRIAGE_LABEL_NAMES
  ]));
  const missingLabels = expectedLabels.filter((labelName) => !system.state.labels[labelName]);
  const health = watchError
    ? "degraded"
    : missingLabels.length
      ? "attention"
      : "healthy";

  return buildMonitorReport([
    `health: ${health}`,
    `mailbox: ${system.mailboxEmail || "unknown"}`,
      `self-only-mode: ${system.allowExternalMessages ? "disabled" : "enabled"}`,
      `triage-mode: ${system.triageMode}`,
      "single-flight-worker: enabled",
    `active-task: ${system.state.activeTaskId || "none"}`,
    `queue-depth: ${system.state.queue.length}`,
    `task-totals: queued=${taskCounts.queued} working=${taskCounts.working} review=${taskCounts.review} done=${taskCounts.done} blocked=${taskCounts.blocked} error=${taskCounts.error}`,
    `watch-last-started-at: ${system.state.watch.lastStartedAt || "none"}`,
    `watch-last-event-at: ${system.state.watch.lastEventAt || "none"}`,
    `watch-last-error: ${watchError || "none"}`,
    `missing-labels: ${missingLabels.length ? missingLabels.join(", ") : "none"}`,
      `monitor-session: ${system.state.monitor.sessionId || "new"}`,
      `thread-worker-session: ${threadState && threadState.workerSessionId ? threadState.workerSessionId : "new"}`,
      `thread-triage: ${threadState && threadState.lastTriageCategory ? threadState.lastTriageCategory : "none"}`,
      formatWorkspaceLine(
        (threadState && threadState.workspaceKey) || null,
        (threadState && threadState.workspacePath) || null
    ),
    `watch-query: ${runtimeInfo.query || "n/a"}`
  ]);
}

function buildTasksBody(system, countArg) {
  const tasks = listRecentTasks(system, parseListCount(countArg, { min: 1, max: 25, fallback: 10 }));

  return buildMonitorReport([
    `recent-tasks: ${tasks.length}`,
    "",
    ...(tasks.length
      ? tasks.map((task) => `${task.id} ${task.status} thread=${task.threadId} workspace=${task.workspaceKey || "default"} requested=${task.requestedAt} request=${clipText(task.requestText, 80)}`)
      : ["(no tasks)"])
  ]);
}

function buildErrorsBody(system, countArg) {
  const tasks = listRecentTasks(system, 100)
    .filter((task) => task.status === "blocked" || task.status === "error")
    .slice(0, parseListCount(countArg, { min: 1, max: 25, fallback: 10 }));

  return buildMonitorReport([
    `faulted-tasks: ${tasks.length}`,
    "",
    ...(tasks.length
      ? tasks.map((task) => `${task.id} ${task.status} thread=${task.threadId} workspace=${task.workspaceKey || "default"} error=${clipText(task.error || task.monitorIssues.join(", ") || "none", 100)}`)
      : ["(none)"])
  ]);
}

function buildResetBody(threadState) {
  return buildMonitorReport([
    `thread: ${threadState.threadId}`,
    "status: worker-session-reset",
    "",
    "The stored worker session for this thread was cleared.",
    "The next work request in this thread will start a fresh worker session."
  ]);
}

function buildTaskBody(system, task) {
  if (!task) {
    return buildMonitorReport([
      "status: task-not-found"
    ]);
  }

  return buildMonitorReport([
    `task: ${task.id}`,
    `status: ${task.status}`,
    `workflow-stage: ${task.workflowStage || "none"}`,
    `thread: ${task.threadId || "unknown"}`,
    `message: ${task.messageId || "unknown"}`,
    formatWorkspaceLine(task.workspaceKey, task.workspacePath),
    `requested-at: ${task.requestedAt || "unknown"}`,
    `started-at: ${task.startedAt || "not-started"}`,
    `completed-at: ${task.completedAt || "not-complete"}`,
    `worker-session: ${task.workerSessionIdUsed || "none"}`,
    `monitor-session: ${task.monitorSessionIdUsed || "none"}`,
    `queue-ack-id: ${task.queueAckId || "none"}`,
    `final-reply-id: ${task.finalReplyId || "none"}`,
    `worker-summary: ${task.workerSummary || "none"}`,
    `monitor-issues: ${task.monitorIssues.length ? task.monitorIssues.join(", ") : "none"}`,
    `error: ${task.error || "none"}`,
    "",
    "workflow-history:",
    ...(task.workflowHistory.length
      ? task.workflowHistory.slice(-10).map((entry) => {
          const parts = [
            entry.stage || "unknown",
            entry.outcome || "unknown"
          ];

          if (entry.attempt) {
            parts.push(`attempt=${entry.attempt}`);
          }

          if (entry.summary) {
            parts.push(`summary=${clipText(entry.summary, 70)}`);
          }

          return parts.join(" ");
        })
      : ["(none)"]),
    "",
    "request:",
    task.requestText || "(empty)"
  ]);
}

function buildThreadBody(system, threadState) {
  if (!threadState) {
    return buildMonitorReport([
      "status: thread-not-found"
    ]);
  }

  const tasks = threadState.taskIds.map((taskId) => system.state.tasks[taskId]).filter(Boolean);
  const taskLines = tasks.length
    ? tasks.map((task, index) => `${index + 1}. ${task.id} ${task.status} requested=${task.requestedAt}`)
    : ["(no tasks)"];

  return buildMonitorReport([
    `thread: ${threadState.threadId}`,
    `subject: ${threadState.subject || "(none)"}`,
    `thread-status: ${threadState.lastStatus || "idle"}`,
    `thread-triage: ${threadState.lastTriageCategory || "none"}`,
    `triaged-at: ${threadState.lastTriageAt || "none"}`,
    formatWorkspaceLine(threadState.workspaceKey, threadState.workspacePath),
    `worker-session: ${threadState.workerSessionId || "new"}`,
    `last-user-message: ${threadState.lastUserMessageId || "none"}`,
    `last-triage-message: ${threadState.lastTriageMessageId || "none"}`,
    `system-message-count: ${threadState.systemMessageIds.length}`,
    `task-count: ${tasks.length}`,
    "",
    "tasks:",
    ...taskLines
  ]);
}

function buildSessionsBody(system, threadState) {
  const recentTasks = listRecentTasks(system, 5);

  return buildMonitorReport([
    `monitor-session: ${system.state.monitor.sessionId || "new"}`,
    formatWorkspaceLine(
      (threadState && threadState.workspaceKey) || null,
      (threadState && threadState.workspacePath) || null
    ),
    `thread-worker-session: ${threadState && threadState.workerSessionId ? threadState.workerSessionId : "new"}`,
    "",
    "recent-task-sessions:",
    ...(recentTasks.length
      ? recentTasks.map((task) => `${task.id} worker=${task.workerSessionIdUsed || "none"} monitor=${task.monitorSessionIdUsed || "none"}`)
      : ["(no completed tasks)"])
  ]);
}

function buildMonitorBody(system) {
  const blockedTasks = Object.values(system.state.tasks).filter((task) => task.status === "blocked");
  const issueCount = Object.values(system.state.tasks).reduce((total, task) => total + task.monitorIssues.length, 0);

  return buildMonitorReport([
    `session: ${system.state.monitor.sessionId || "new"}`,
    `blocked-tasks: ${blockedTasks.length}`,
    `monitor-issues-recorded: ${issueCount}`,
    "",
    "monitor-role:",
    "- validates worker replies before they leave the mailbox",
    "- checks for self-only and operational safety",
    "- makes sure test/docs status is reported clearly",
    "- keeps the email CLI responses structured and debuggable"
  ]);
}

function buildWorkerBody(system, threadState) {
  const tasks = threadState
    ? threadState.taskIds.map((taskId) => system.state.tasks[taskId]).filter(Boolean)
    : [];
  const latestTask = tasks.length ? tasks[tasks.length - 1] : null;

  return buildWorkerReport([
    formatWorkspaceLine(
      (threadState && threadState.workspaceKey) || null,
      (threadState && threadState.workspacePath) || null
    ),
    `thread-worker-session: ${threadState && threadState.workerSessionId ? threadState.workerSessionId : "new"}`,
    `latest-task: ${latestTask ? latestTask.id : "none"}`,
    `latest-status: ${latestTask ? latestTask.status : "none"}`,
    `latest-workflow-stage: ${latestTask ? latestTask.workflowStage || "none" : "none"}`,
    `latest-request: ${latestTask ? clipText(latestTask.requestText, 120) : "none"}`,
    "",
    "worker-role:",
    "- handles non-command requests with Codex",
    "- reuses the same session inside a Gmail thread",
    "- never sends mail directly without the monitor pass"
  ]);
}

function buildLabelsBody(system, threadState) {
  const lines = [
    "status-labels:"
  ];

  for (const [status, labelName] of Object.entries(STATUS_LABELS)) {
    lines.push(`${status}: ${labelName} -> ${system.state.labels[labelName] || "missing"}`);
  }

  lines.push("");
  lines.push("triage-labels:");

  for (const [category, labelName] of Object.entries(TRIAGE_LABELS)) {
    lines.push(`${category}: ${labelName} -> ${system.state.labels[labelName] || "missing"}`);
  }

  if (threadState) {
    lines.push("");
    lines.push(`thread: ${threadState.threadId}`);
    lines.push(`thread-status: ${threadState.lastStatus || "idle"}`);
    lines.push(`thread-triage: ${threadState.lastTriageCategory || "none"}`);
  }

  return buildMonitorReport(lines);
}

function buildWatchBody(system, runtimeInfo) {
  return buildMonitorReport([
    `watch-mode: ${runtimeInfo.mode || system.state.watch.mode || "evented"}`,
    `daemon-pid: ${runtimeInfo.pid || process.pid}`,
    `command-query: ${runtimeInfo.query || "n/a"}`,
    `triage-query: ${runtimeInfo.triageQuery || "n/a"}`,
    `reconcile-interval-ms: ${runtimeInfo.reconcileIntervalMs || "n/a"}`,
    `watch-renew-hours: ${runtimeInfo.watchRenewHours || system.state.watch.renewAfterHours || "n/a"}`,
    `watch-last-started-at: ${system.state.watch.lastStartedAt || "none"}`,
    `watch-last-event-at: ${system.state.watch.lastEventAt || "none"}`,
    `watch-last-error-at: ${system.state.watch.lastErrorAt || "none"}`,
    `watch-last-error: ${system.state.watch.lastError || "none"}`
  ]);
}

function buildConfigBody(system, runtimeInfo) {
  return buildMonitorReport([
    `subject-prefix: ${SUBJECT_PREFIX}`,
    `mailbox: ${system.mailboxEmail || "unknown"}`,
    `self-only-mode: ${system.allowExternalMessages ? "disabled" : "enabled"}`,
    `triage-mode: ${system.triageMode}`,
    "single-flight-worker: enabled",
    `workspace-root: ${runtimeInfo.workspaceRoot || "n/a"}`,
    `watch-mode: ${runtimeInfo.mode || system.state.watch.mode || "evented"}`,
    `watch-command-query: ${runtimeInfo.query || "n/a"}`,
    `watch-triage-query: ${runtimeInfo.triageQuery || "n/a"}`,
    `reconcile-interval-ms: ${runtimeInfo.reconcileIntervalMs || "n/a"}`,
    `watch-renew-hours: ${runtimeInfo.watchRenewHours || system.state.watch.renewAfterHours || "n/a"}`,
    `managed-label-count: ${MANAGED_LABEL_NAMES.length}`,
    `managed-labels: ${MANAGED_LABEL_NAMES.join(", ")}`,
    `triage-label-count: ${TRIAGE_LABEL_NAMES.length}`,
    `triage-labels: ${TRIAGE_LABEL_NAMES.join(", ")}`
  ]);
}

function buildLogsBody(system, count) {
  const limit = parseListCount(count, { min: 1, max: 50, fallback: 10 });
  const events = system.state.events.slice(-limit).reverse();

  return buildMonitorReport([
    `recent-events: ${events.length}`,
    "",
    ...(events.length
      ? events.map((event) => {
          const detailText = Object.entries(event.details || {})
            .map(([key, value]) => `${key}=${clipText(String(value), 40)}`)
            .join(" ");

          return `${event.at} ${event.type}${detailText ? ` ${detailText}` : ""}`;
        })
      : ["(no events)"])
  ]);
}

function buildReportBody(system, threadState, runtimeInfo) {
  const queueRows = buildQueueRows(system, 5);
  const events = system.state.events.slice(-5).reverse();

  return [
    buildPsBody(system, threadState, runtimeInfo),
    "",
    "recent-events:",
    ...(events.length
      ? events.map((event) => `${event.at} ${event.type}`)
      : ["(no events)"]),
    "",
    "queue-snapshot:",
    ...(queueRows.length ? queueRows : ["(empty)"]),
    "",
    "thread-snapshot:",
    ...(threadState
      ? [
          `thread=${threadState.threadId}`,
          `status=${threadState.lastStatus || "idle"}`,
          `worker-session=${threadState.workerSessionId || "new"}`,
          `tasks=${threadState.taskIds.length}`
        ]
      : ["(no thread context)"])
  ].join("\n");
}

function buildInvalidCommandBody(commandToken) {
  return buildMonitorReport([
    "status: invalid-command",
    `command: ${commandToken || "(empty)"}`,
    "",
    `Use \`${SUBJECT_PREFIX}/help\` to see the available email CLI commands.`
  ]);
}

function buildWorkspaceBody(system, threadState, runtimeInfo) {
  return buildMonitorReport([
    formatWorkspaceLine(
      (threadState && threadState.workspaceKey) || null,
      (threadState && threadState.workspacePath) || null
    ),
    `workspace-root: ${runtimeInfo.workspaceRoot || "n/a"}`,
    "",
    `Use \`${SUBJECT_PREFIX}/workspace <name>\` to pin a thread workspace.`,
    `Use \`${SUBJECT_PREFIX}/workspace clear\` to clear it.`,
    `Use \`${SUBJECT_PREFIX}/<name>\` as a shorthand work request that also pins the thread workspace.`
  ]);
}

function buildWorkspacePinnedBody(threadState, runtimeInfo) {
  return buildMonitorReport([
    "status: workspace-pinned",
    formatWorkspaceLine(threadState.workspaceKey, threadState.workspacePath),
    `workspace-root: ${runtimeInfo.workspaceRoot || "n/a"}`,
    `worker-session: ${threadState.workerSessionId || "new"}`,
    "",
    "The next work request in this thread will run in that folder."
  ]);
}

function buildWorkspaceClearedBody(runtimeInfo) {
  return buildMonitorReport([
    "status: workspace-cleared",
    "workspace: default",
    `workspace-root: ${runtimeInfo.workspaceRoot || "n/a"}`,
    "",
    "The next work request in this thread will run from the daemon repo workspace unless a folder is pinned again."
  ]);
}

function buildWorkspaceNotFoundBody(workspaceToken, runtimeInfo) {
  return buildMonitorReport([
    "status: workspace-not-found",
    `workspace: ${workspaceToken || "(empty)"}`,
    `workspace-root: ${runtimeInfo.workspaceRoot || "n/a"}`,
    "",
    "The monitor only allows folders inside your home directory.",
    `Try \`${SUBJECT_PREFIX}/workspace <folder>\` to pin a valid folder first.`
  ]);
}

const DIRECT_COMMAND_HANDLERS = {
  help: ({ system }) => buildHelpBody(system),
  ping: ({ system, threadState, runtimeInfo }) => buildPingBody(system, threadState, runtimeInfo),
  ps: ({ system, threadState, runtimeInfo }) => buildPsBody(system, threadState, runtimeInfo),
  health: ({ system, threadState, runtimeInfo }) => buildHealthBody(system, threadState, runtimeInfo),
  queue: ({ system }) => buildQueueBody(system),
  tasks: ({ system, commandArgs }) => buildTasksBody(system, commandArgs),
  errors: ({ system, commandArgs }) => buildErrorsBody(system, commandArgs),
  report: ({ system, threadState, runtimeInfo }) => buildReportBody(system, threadState, runtimeInfo),
  task: ({ system, commandArgs, threadState }) => buildTaskBody(system, system.resolveTaskReference(commandArgs, threadState)),
  thread: ({ system, threadState }) => buildThreadBody(system, threadState),
  sessions: ({ system, threadState }) => buildSessionsBody(system, threadState),
  monitor: ({ system }) => buildMonitorBody(system),
  worker: ({ system, threadState }) => buildWorkerBody(system, threadState),
  workspace: async ({ system, commandArgs, runtimeInfo, threadState }) => {
    const workspaceToken = normalizeWorkspaceReference(commandArgs);

    if (!workspaceToken) {
      return buildWorkspaceBody(system, threadState, runtimeInfo);
    }

    if (workspaceToken === "clear" || workspaceToken === "default") {
      threadState.workspaceKey = null;
      threadState.workspacePath = null;
      threadState.workerSessionId = null;
      return buildWorkspaceClearedBody(runtimeInfo);
    }

    const workspace = await system.resolveWorkspace(workspaceToken);

    if (!workspace) {
      return buildWorkspaceNotFoundBody(workspaceToken, runtimeInfo);
    }

    system.assignThreadWorkspace(threadState, workspace);
    return buildWorkspacePinnedBody(threadState, runtimeInfo);
  },
  labels: ({ system, threadState }) => buildLabelsBody(system, threadState),
  watch: ({ system, runtimeInfo }) => buildWatchBody(system, runtimeInfo),
  config: ({ system, runtimeInfo }) => buildConfigBody(system, runtimeInfo),
  logs: ({ system, commandArgs }) => buildLogsBody(system, commandArgs),
  reset: async ({ system, threadState, threadId }) => {
    threadState.workerSessionId = null;
    await system.setThreadStatus(threadId, "blocked");
    return buildResetBody(threadState);
  }
};

function serializeError(error) {
  return error instanceof Error ? error.message : String(error);
}

class CodexEmailSystem {
  constructor(options) {
    this.allowExternalMessages = options.allowExternalMessages === true;
    this.logger = options.logger || console;
    this.mailboxEmail = normalizeEmail(options.mailboxEmail);
    this.monitorRunner = options.monitorRunner;
    this.now = options.now || (() => new Date());
    this.persistState = options.persistState || null;
    this.runtimeInfoProvider = typeof options.runtimeInfoProvider === "function"
      ? options.runtimeInfoProvider
      : null;
    this.state = normalizeState(options.state, this.now);
    this.transport = options.transport;
    this.workspaceResolver = typeof options.workspaceResolver === "function"
      ? options.workspaceResolver
      : null;
    this.workerRunner = options.workerRunner;
    this.managedLabelNames = Array.isArray(options.managedLabelNames) && options.managedLabelNames.length
      ? options.managedLabelNames.slice()
      : MANAGED_LABEL_NAMES.slice();
    this.triageLabelNames = Array.isArray(options.triageLabelNames) && options.triageLabelNames.length
      ? options.triageLabelNames.slice()
      : TRIAGE_LABEL_NAMES.slice();
    this.triageMode = options.triageMode || "label-only";
    this.allLabelNames = Array.from(new Set([
      ...this.managedLabelNames,
      ...this.triageLabelNames
    ]));
    this.ingestChain = Promise.resolve();
    this.workLoopPromise = null;

    if (!this.state.mailboxEmail && this.mailboxEmail) {
      this.state.mailboxEmail = this.mailboxEmail;
    }
  }

  log(message) {
    if (this.logger && typeof this.logger.log === "function") {
      this.logger.log(message);
    }
  }

  getRuntimeInfo() {
    const provided = this.runtimeInfoProvider ? this.runtimeInfoProvider() : {};
    return provided && typeof provided === "object" ? provided : {};
  }

  recordEvent(type, details = {}, message = null) {
    const event = normalizeEventState({
      id: `event-${String(this.state.nextEventSequence).padStart(6, "0")}`,
      at: nowIso(this.now),
      type,
      message,
      details
    }, this.now);

    this.state.nextEventSequence += 1;
    this.state.events.push(event);

    if (this.state.events.length > DEFAULT_EVENT_LIMIT) {
      this.state.events.splice(0, this.state.events.length - DEFAULT_EVENT_LIMIT);
    }

    return event;
  }

  async initialize() {
    if (this.transport && typeof this.transport.ensureLabels === "function") {
      this.state.labels = await this.transport.ensureLabels(this.allLabelNames, this.state.labels || {});
      this.recordEvent("labels_ready", {
        count: Object.keys(this.state.labels || {}).length
      });
      await this.persist();
    }
  }

  async resumePendingWork() {
    if (this.state.activeTaskId || this.state.queue.length) {
      this.recordEvent("resume_pending_work", {
        activeTaskId: this.state.activeTaskId || null,
        queueDepth: this.state.queue.length
      });
      this.scheduleWork();
      await this.waitForIdle();
    }
  }

  async persist() {
    if (!this.persistState) {
      return;
    }

    await this.persistState(this.state);
  }

  async resolveWorkspace(workspaceToken) {
    if (!this.workspaceResolver) {
      return null;
    }

    return this.workspaceResolver(workspaceToken);
  }

  getThreadState(threadId, subject = null) {
    if (!this.state.threads[threadId]) {
      this.state.threads[threadId] = normalizeThreadState(threadId, { subject }, this.now);
    }

    const threadState = this.state.threads[threadId];

    if (subject) {
      threadState.subject = threadState.subject || subject;
    }

    threadState.updatedAt = nowIso(this.now);
    return threadState;
  }

  assignThreadWorkspace(threadState, workspace) {
    const previousPath = threadState.workspacePath || null;
    const nextPath = workspace && workspace.path ? workspace.path : null;
    const changed = previousPath !== nextPath;

    threadState.workspaceKey = workspace && workspace.key ? workspace.key : null;
    threadState.workspacePath = nextPath;

    if (changed) {
      threadState.workerSessionId = null;
      this.recordEvent("thread_workspace_changed", {
        threadId: threadState.threadId,
        previousWorkspacePath: previousPath || "",
        workspacePath: nextPath || ""
      });
    }
  }

  async resolveTaskWorkspace(commandContext, threadState) {
    const workspaceToken = normalizeWorkspaceReference(commandContext && commandContext.workspaceToken);

    if (workspaceToken) {
      const workspace = await this.resolveWorkspace(workspaceToken);

      if (!workspace) {
        return {
          found: false,
          fromCommand: true,
          token: workspaceToken
        };
      }

      this.assignThreadWorkspace(threadState, workspace);
      return {
        found: true,
        fromCommand: true,
        workspace
      };
    }

    if (threadState.workspacePath) {
      return {
        found: true,
        fromCommand: false,
        workspace: {
          key: threadState.workspaceKey || null,
          path: threadState.workspacePath
        }
      };
    }

    return {
      found: true,
      fromCommand: false,
      workspace: null
    };
  }

  createTask(threadId, message, commandContext, workspace, requestText = buildTaskRequestText(message, commandContext)) {
    const taskId = `task-${String(this.state.nextTaskSequence).padStart(4, "0")}`;
    this.state.nextTaskSequence += 1;
    this.state.tasks[taskId] = normalizeTaskState(taskId, {
      threadId,
      messageId: message.id,
      subject: message.subject || null,
      command: commandContext.command || "run",
      requestText,
      workspaceKey: workspace && workspace.key ? workspace.key : null,
      workspacePath: workspace && workspace.path ? workspace.path : null,
      requestedAt: nowIso(this.now),
      status: "queued"
    }, this.now);
    return this.state.tasks[taskId];
  }

  markMessage(messageId, value) {
    this.state.messages[messageId] = {
      ...value,
      updatedAt: nowIso(this.now)
    };
  }

  async setThreadStatus(threadId, status) {
    const threadState = this.getThreadState(threadId);
    threadState.lastStatus = status;
    threadState.updatedAt = nowIso(this.now);

    if (this.transport && typeof this.transport.setThreadStatus === "function") {
      await this.transport.setThreadStatus(threadId, status, {
        labels: this.state.labels,
        managedLabelNames: this.managedLabelNames
      });
    }
  }

  async setThreadTriage(threadId, triage) {
    if (!threadId || !triage || !this.transport || typeof this.transport.setThreadTriage !== "function") {
      return;
    }

    await this.transport.setThreadTriage(threadId, triage, {
      labels: this.state.labels,
      triageLabelNames: this.triageLabelNames
    });
  }

  async markThreadRead(threadId, details = {}) {
    if (!threadId || !this.transport || typeof this.transport.markThreadRead !== "function") {
      return;
    }

    try {
      await this.transport.markThreadRead(threadId);
      this.recordEvent("thread_marked_read", {
        threadId,
        ...details
      });
    } catch (error) {
      const serialized = serializeError(error);
      this.log(`failed to mark thread ${threadId} read: ${serialized}`);
      this.recordEvent("thread_mark_read_failed", {
        threadId,
        error: serialized,
        ...details
      });
    }
  }

  async triageIncomingMessage(message, threadId) {
    const triage = classifyInboxMessage(message, this.mailboxEmail);

    if (!triage) {
      return null;
    }

    const threadState = this.getThreadState(threadId, message && message.subject ? message.subject : null);
    threadState.lastTriageCategory = triage.category;
    threadState.lastTriageAt = nowIso(this.now);
    threadState.lastTriageMessageId = message.id;
    threadState.updatedAt = nowIso(this.now);

    this.markMessage(message.id, {
      kind: "triaged",
      triageCategory: triage.category,
      triageLabel: triage.labelName,
      triageReason: triage.reason,
      threadId,
      subject: message && message.subject ? message.subject : null
    });

    await this.setThreadTriage(threadId, triage);
    this.recordEvent("mail_triaged", {
      threadId,
      messageId: message.id,
      category: triage.category,
      labelName: triage.labelName,
      reason: triage.reason,
      mode: this.triageMode
    });
    await this.persist();

    return {
      action: "triaged",
      id: message.id,
      category: triage.category
    };
  }

  async sendTrackedReply({ taskId = null, threadId, messageId, body, kind }) {
    const response = await this.transport.replyToMessage(messageId, body);
    const responseId = response && response.id ? response.id : null;

    if (responseId) {
      const threadState = this.getThreadState(threadId);
      threadState.systemMessageIds.push(responseId);
      this.markMessage(responseId, {
        kind: "system",
        replyKind: kind,
        taskId,
        threadId
      });
    }

    await this.markThreadRead(threadId, {
      kind,
      messageId,
      responseId: responseId || "",
      source: "reply"
    });

    this.recordEvent("reply_sent", {
      kind,
      taskId: taskId || "",
      threadId,
      messageId,
      responseId: responseId || ""
    });
    await this.persist();
    return response;
  }

  resolveTaskReference(commandArgs, threadState) {
    const token = String(commandArgs || "").trim().toLowerCase();

    if (!token || token === "current") {
      return this.state.activeTaskId ? this.state.tasks[this.state.activeTaskId] : null;
    }

    if (token === "thread" || token === "latest") {
      const threadTasks = threadState
        ? threadState.taskIds.map((taskId) => this.state.tasks[taskId]).filter(Boolean)
        : [];

      return threadTasks.length ? threadTasks[threadTasks.length - 1] : null;
    }

    return this.state.tasks[token] || null;
  }

  async handleDirectCommand({ commandContext, message, threadId, threadState }) {
    const runtimeInfo = this.getRuntimeInfo();
    const command = normalizeCommandName(commandContext.command);
    const commandArgs = String(commandContext.commandArgs || "").trim();
    const handler = DIRECT_COMMAND_HANDLERS[command];
    const body = handler
      ? await handler({
          commandArgs,
          commandContext,
          message,
          runtimeInfo,
          system: this,
          threadId,
          threadState
        })
      : buildInvalidCommandBody(commandContext.rawCommandToken || commandContext.command);

    await this.sendTrackedReply({
      threadId,
      messageId: message.id,
      body,
      kind: command
    });

    this.recordEvent("direct_command", {
      command,
      threadId,
      messageId: message.id,
      source: commandContext.source || "subject",
      args: commandArgs
    });

    await this.persist();
    return { action: `${command}_replied`, id: message.id };
  }

  async ingestMessage(message) {
    const work = async () => this.#ingestMessage(message);
    const resultPromise = this.ingestChain.then(work, work);
    this.ingestChain = resultPromise.then(() => undefined, () => undefined);
    return resultPromise;
  }

  async #ingestMessage(message) {
    if (!message || !message.id) {
      this.recordEvent("ignored_missing_id", {});
      return { action: "ignored_missing_id" };
    }

    if (this.state.messages[message.id]) {
      return { action: "ignored_seen", id: message.id };
    }

    const threadId = message.thread_id || message.threadId || message.id;
    const threadState = this.getThreadState(threadId, message.subject || null);

    if (threadState.systemMessageIds.includes(message.id)) {
      this.markMessage(message.id, {
        kind: "system",
        threadId,
        replyKind: "tracked"
      });
      await this.markThreadRead(threadId, {
        messageId: message.id,
        source: "tracked_system_message"
      });
      this.recordEvent("ignored_system_message", {
        threadId,
        messageId: message.id
      });
      await this.persist();
      return { action: "ignored_system_message", id: message.id };
    }

    if (looksLikeSystemReply(message)) {
      this.markMessage(message.id, {
        kind: "system",
        threadId,
        replyKind: "signature_match"
      });
      await this.markThreadRead(threadId, {
        messageId: message.id,
        source: "signature_match"
      });
      this.recordEvent("ignored_system_signature", {
        threadId,
        messageId: message.id
      });
      await this.persist();
      return { action: "ignored_system_signature", id: message.id };
    }

    const commandContext = parseMessageCommand(message);

    if (!commandContext.matches) {
      const triageResult = await this.triageIncomingMessage(message, threadId);

      if (triageResult) {
        return triageResult;
      }

      this.markMessage(message.id, {
        kind: "ignored",
        reason: "subject_mismatch",
        threadId
      });
      this.recordEvent("ignored_subject", {
        threadId,
        messageId: message.id
      });
      await this.persist();
      return { action: "ignored_subject", id: message.id };
    }

    if (!this.allowExternalMessages && !isSelfOnlyMessage(message, this.mailboxEmail)) {
      const triageResult = await this.triageIncomingMessage(message, threadId);

      if (triageResult) {
        return triageResult;
      }

      this.markMessage(message.id, {
        kind: "ignored",
        reason: "external_participants",
        threadId
      });
      this.recordEvent("ignored_external", {
        threadId,
        messageId: message.id
      });
      await this.persist();
      return { action: "ignored_external", id: message.id };
    }

    threadState.lastUserMessageId = message.id;
    this.markMessage(message.id, {
      kind: "user",
      threadId,
      subject: message.subject || null,
      command: commandContext.command || null,
      commandSource: commandContext.source || "subject"
    });
    await this.markThreadRead(threadId, {
      messageId: message.id,
      source: "ingest"
    });

    if (commandContext.unknownCommand) {
      await this.handleDirectCommand({
        commandContext: {
          ...commandContext,
          command: "__invalid__"
        },
        message,
        threadId,
        threadState
      });
      return { action: "invalid_command_replied", id: message.id };
    }

    if (commandContext.command !== "run" && (commandContext.explicitCommand || isDirectCommandName(commandContext.command))) {
      return this.handleDirectCommand({
        commandContext,
        message,
        threadId,
        threadState
      });
    }

    const taskWorkspace = await this.resolveTaskWorkspace(commandContext, threadState);

    if (!taskWorkspace.found) {
      await this.sendTrackedReply({
        threadId,
        messageId: message.id,
        body: buildWorkspaceNotFoundBody(taskWorkspace.token, this.getRuntimeInfo()),
        kind: "workspace_not_found"
      });
      this.recordEvent("workspace_not_found", {
        threadId,
        messageId: message.id,
        workspace: taskWorkspace.token
      });
      await this.persist();
      return { action: "workspace_not_found", id: message.id };
    }

    const requestText = buildTaskRequestText(message, commandContext);

    if (commandContext.workspaceToken && !requestText.trim()) {
      await this.sendTrackedReply({
        threadId,
        messageId: message.id,
        body: buildWorkspacePinnedBody(threadState, this.getRuntimeInfo()),
        kind: "workspace_pinned"
      });
      this.recordEvent("workspace_pinned", {
        threadId,
        messageId: message.id,
        workspace: taskWorkspace.workspace && taskWorkspace.workspace.key ? taskWorkspace.workspace.key : ""
      });
      await this.persist();
      return { action: "workspace_pinned", id: message.id };
    }

    const task = this.createTask(threadId, message, commandContext, taskWorkspace.workspace, requestText);
    threadState.taskIds.push(task.id);

    if (!task.requestText.trim()) {
      await this.sendTrackedReply({
        threadId,
        messageId: message.id,
        body: buildMonitorReport([
          "status: empty-request",
          "",
          `Send a request after \`${SUBJECT_PREFIX}\` or use \`${SUBJECT_PREFIX}/help\` for command syntax.`
        ]),
        kind: "empty_request"
      });
      task.status = "blocked";
      task.completedAt = nowIso(this.now);
      await this.setThreadStatus(threadId, "blocked");
      this.recordEvent("blocked_empty_request", {
        taskId: task.id,
        threadId,
        messageId: message.id
      });
      await this.persist();
      return {
        action: "blocked_empty_request",
        id: message.id,
        taskId: task.id
      };
    }

    this.recordEvent("task_created", {
      taskId: task.id,
      threadId,
      messageId: message.id,
      commandSource: commandContext.source || "subject"
    });

    if (!this.state.activeTaskId && !this.workLoopPromise) {
      this.state.activeTaskId = task.id;
      task.status = "working";
      task.startedAt = nowIso(this.now);
      await this.setThreadStatus(threadId, "working");
      this.recordEvent("task_started", {
        taskId: task.id,
        threadId
      });
    } else {
      task.status = "queued";
      this.state.queue.push(task.id);
      await this.setThreadStatus(threadId, "queued");
      this.recordEvent("task_queued", {
        taskId: task.id,
        threadId,
        queueDepth: this.state.queue.length
      });
    }

    const queueAck = await this.sendTrackedReply({
      taskId: task.id,
      threadId,
      messageId: message.id,
      body: buildQueueAckBody(this, task, threadState),
      kind: "queue_ack"
    });
    task.queueAckId = queueAck && queueAck.id ? queueAck.id : null;
    await this.persist();
    this.scheduleWork();

    return {
      action: "queued",
      id: message.id,
      taskId: task.id
    };
  }

  scheduleWork() {
    if (this.workLoopPromise) {
      return this.workLoopPromise;
    }

    this.workLoopPromise = this.#runWorkLoop()
      .catch((error) => {
        this.log(`work loop failed: ${serializeError(error)}`);
        this.recordEvent("work_loop_failed", {
          error: serializeError(error)
        });
      })
      .finally(() => {
        this.workLoopPromise = null;
      });

    return this.workLoopPromise;
  }

  async waitForIdle() {
    await this.ingestChain;

    if (this.workLoopPromise) {
      await this.workLoopPromise;
    }
  }

  promoteNextTask() {
    while (!this.state.activeTaskId && this.state.queue.length) {
      const nextTaskId = this.state.queue.shift();
      const nextTask = nextTaskId ? this.state.tasks[nextTaskId] : null;

      if (!nextTask) {
        continue;
      }

      this.state.activeTaskId = nextTask.id;
      nextTask.status = "working";
      nextTask.startedAt = nextTask.startedAt || nowIso(this.now);
      this.recordEvent("task_promoted", {
        taskId: nextTask.id,
        threadId: nextTask.threadId
      });
      return nextTask;
    }

    return this.state.activeTaskId ? this.state.tasks[this.state.activeTaskId] : null;
  }

  async #runWorkLoop() {
    for (;;) {
      const activeTask = this.promoteNextTask();

      if (!activeTask) {
        await this.persist();
        return;
      }

      await this.#processTask(activeTask);
      this.state.activeTaskId = null;
      await this.persist();
    }
  }

  async #processTask(task) {
    const threadState = this.getThreadState(task.threadId);
    await this.setThreadStatus(task.threadId, "working");
    await this.persist();

    try {
      const workerResult = await this.workerRunner.runTask({
        mailboxEmail: this.mailboxEmail,
        persist: async () => {
          await this.persist();
        },
        state: this.state,
        task,
        threadState
      });

      threadState.workerSessionId = workerResult.sessionId || threadState.workerSessionId || null;
      task.workerSessionIdUsed = workerResult.sessionId || threadState.workerSessionId || null;
      task.workerSummary = workerResult.summary || null;
      this.recordEvent("worker_completed", {
        taskId: task.id,
        threadId: task.threadId,
        workerSessionId: task.workerSessionIdUsed || ""
      });

      await this.setThreadStatus(task.threadId, "review");
      const monitorResult = await this.monitorRunner.reviewTask({
        mailboxEmail: this.mailboxEmail,
        state: this.state,
        task,
        threadState,
        workerResult
      });

      if (monitorResult && monitorResult.sessionId) {
        this.state.monitor.sessionId = monitorResult.sessionId;
        task.monitorSessionIdUsed = monitorResult.sessionId;
      }

      task.monitorIssues = Array.isArray(monitorResult && monitorResult.issues)
        ? monitorResult.issues.slice()
        : [];

      const finalReply = String(
        monitorResult && monitorResult.replyBody
          ? monitorResult.replyBody
          : workerResult.replyBody || ""
      ).trim();

      if (!finalReply) {
        throw new Error("worker/monitor produced an empty reply");
      }

      const response = await this.sendTrackedReply({
        taskId: task.id,
        threadId: task.threadId,
        messageId: task.messageId,
        body: finalReply,
        kind: "final_reply"
      });

      task.finalReplyId = response && response.id ? response.id : null;
      task.status = monitorResult && monitorResult.approved === false ? "blocked" : "done";
      task.workflowStage = task.status === "done" ? "complete" : task.workflowStage || "final_review";
      task.completedAt = nowIso(this.now);
      await this.setThreadStatus(task.threadId, task.status === "done" ? "done" : "blocked");
      this.recordEvent("task_completed", {
        taskId: task.id,
        threadId: task.threadId,
        status: task.status,
        finalReplyId: task.finalReplyId || ""
      });
    } catch (error) {
      task.error = serializeError(error);
      task.status = "error";
      task.workflowStage = task.workflowStage || "error";
      task.completedAt = nowIso(this.now);
      await this.setThreadStatus(task.threadId, "error");
      this.recordEvent("task_error", {
        taskId: task.id,
        threadId: task.threadId,
        error: task.error
      });

      try {
        await this.sendTrackedReply({
          taskId: task.id,
          threadId: task.threadId,
          messageId: task.messageId,
          body: buildMonitorReport([
            "status: error",
            `task: ${task.id}`,
            `error: ${task.error}`,
            "",
            "The request stayed in the queue state machine, but the worker could not complete it."
          ]),
          kind: "error_reply"
        });
      } catch (replyError) {
        this.log(`failed to send error reply for ${task.id}: ${serializeError(replyError)}`);
        this.recordEvent("error_reply_failed", {
          taskId: task.id,
          error: serializeError(replyError)
        });
      }
    }
  }
}

module.exports = {
  CodexEmailSystem,
  EMAIL_CLI_COMMANDS,
  LEGACY_MANAGED_LABEL_NAMES,
  LEGACY_STATUS_LABELS,
  LEGACY_SUBJECT_PREFIXES,
  MANAGED_LABEL_NAMES,
  STATUS_LABELS,
  SUBJECT_PREFIX,
  TRIAGE_LABELS,
  TRIAGE_LABEL_NAMES,
  buildConfigBody,
  buildErrorsBody,
  buildHelpBody,
  buildHealthBody,
  buildPingBody,
  buildPsBody,
  buildQueueAckBody,
  buildQueueBody,
  buildReportBody,
  buildTaskBody,
  buildTaskRequestText,
  buildTasksBody,
  buildThreadBody,
  createInitialState,
  extractLatestPlainText,
  classifyInboxMessage,
  isDirectCommandName,
  isSelfOnlyMessage,
  looksLikeSystemReply,
  normalizeEmail,
  normalizeState,
  parseBodyCommand,
  parseCommandText,
  parseJson,
  parseMessageCommand,
  parseSubjectCommand,
  serializeError
};
