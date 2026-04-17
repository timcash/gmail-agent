#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn, spawnSync } = require("child_process");

const {
  CodexEmailSystem,
  LEGACY_MANAGED_LABEL_NAMES,
  MANAGED_LABEL_NAMES,
  STATUS_LABELS,
  SUBJECT_PREFIX,
  TRIAGE_LABEL_NAMES,
  createInitialState,
  parseJson,
  serializeError
} = require("./codex-system");
const {
  ensureDaemonScopes,
  getMailboxProfile,
  listMessages,
  markThreadRead: markGmailThreadRead,
  modifyThreadLabels,
  readMessage,
  readThread,
  replyToMessage,
  sendEmail,
  runGwsJson
} = require("./codex-gmail");
const {
  buildEnv,
  getEffectiveProjectId,
  getGwsAuthStatus,
  projectRoot,
  runGwsProcess
} = require("./gmail-agent");
const {
  DEFAULT_PUBLIC_ORIGIN,
  startMailApiServer
} = require("./codex-mail-api");

const runtimeDir = (() => {
  const configured = process.env.CODEX_RUNTIME_DIR || process.env.CODEX_314_RUNTIME_DIR;

  if (!configured) {
    return path.join(projectRoot, ".daemon");
  }

  return path.isAbsolute(configured)
    ? configured
    : path.join(projectRoot, configured);
})();
const stateFile = path.join(runtimeDir, "codex-state.json");
const legacyStateFile = path.join(runtimeDir, "codex-314-state.json");
const pidFile = path.join(runtimeDir, "codex.pid");
const legacyPidFile = path.join(runtimeDir, "codex-314.pid");
const globalMutexName = "Global\\gmail-agent-codex-daemon";
const defaultQuery = `subject:${SUBJECT_PREFIX} newer_than:30d`;
const defaultMaxMessages = 25;
const defaultMailApiPort = Number.parseInt(process.env.CODEX_MAIL_PORT || "4192", 10);
const defaultWatchRenewHours = 24;
const defaultReconcileIntervalMs = 15000;
const defaultPublicOrigin = process.env.CODEX_PUBLIC_ORIGIN
  || process.env.CODEX_MAIL_PUBLIC_ORIGIN
  || DEFAULT_PUBLIC_ORIGIN;
const legacySubjectPrefixes = ["codex-314"];
const workspaceRoot = (() => {
  const configured = process.env.CODEX_WORKSPACE_ROOT || process.env.CODEX_314_WORKSPACE_ROOT;

  if (!configured) {
    return os.homedir();
  }

  return path.isAbsolute(configured)
    ? configured
    : path.resolve(os.homedir(), configured);
})();

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function isPathInsideRoot(candidatePath, rootPath) {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedCandidate = path.resolve(candidatePath);

  if (process.platform === "win32") {
    const rootLower = normalizedRoot.toLowerCase();
    const candidateLower = normalizedCandidate.toLowerCase();
    return candidateLower === rootLower || candidateLower.startsWith(`${rootLower}${path.sep}`);
  }

  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function parseArgs(args) {
  const options = {
    allowExternalMessages: false,
    maxMessages: defaultMaxMessages,
    once: false,
    query: defaultQuery,
    reconcileIntervalMs: defaultReconcileIntervalMs,
    httpPort: defaultMailApiPort,
    publicOrigin: defaultPublicOrigin,
    triageQuery: buildTriageReconcileQuery(),
    watchRenewHours: defaultWatchRenewHours
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--once") {
      options.once = true;
    } else if (arg === "--allow-external-messages") {
      options.allowExternalMessages = true;
    } else if (arg === "--max-messages" && args[index + 1]) {
      const value = Number(args[index + 1]);

      if (Number.isFinite(value) && value > 0) {
        options.maxMessages = value;
      }

      index += 1;
    } else if (arg === "--query" && args[index + 1]) {
      options.query = args[index + 1];
      index += 1;
    } else if (arg === "--triage-query" && args[index + 1]) {
      options.triageQuery = args[index + 1];
      index += 1;
    } else if (arg === "--watch-renew-hours" && args[index + 1]) {
      const value = Number(args[index + 1]);

      if (Number.isFinite(value) && value > 0) {
        options.watchRenewHours = value;
      }

      index += 1;
    } else if (arg === "--reconcile-sec" && args[index + 1]) {
      const value = Number(args[index + 1]);

      if (Number.isFinite(value) && value > 0) {
        options.reconcileIntervalMs = Math.max(1000, value * 1000);
      }

      index += 1;
    } else if (arg === "--http-port" && args[index + 1]) {
      const value = Number(args[index + 1]);

      if (Number.isFinite(value) && value >= 0) {
        options.httpPort = Math.floor(value);
      }

      index += 1;
    } else if (arg === "--public-origin" && args[index + 1]) {
      options.publicOrigin = args[index + 1];
      index += 1;
    }
  }

  return options;
}

function resolveCodexInvocation() {
  if (process.platform === "win32") {
    const whereResult = spawnSync("where.exe", ["codex.cmd"], {
      encoding: "utf8",
      stdio: "pipe",
      windowsHide: true
    });

    if (!whereResult.error && whereResult.status === 0) {
      const codexCmdPath = (whereResult.stdout || "").split(/\r?\n/).find(Boolean);

      if (codexCmdPath) {
        const codexDir = path.dirname(codexCmdPath.trim());
        const bundledNode = path.join(codexDir, "node.exe");
        const codexJs = path.join(codexDir, "node_modules", "@openai", "codex", "bin", "codex.js");

        if (fs.existsSync(codexJs)) {
          return {
            command: fs.existsSync(bundledNode) ? bundledNode : "node",
            preArgs: [codexJs]
          };
        }
      }
    }
  }

  return {
    command: "codex",
    preArgs: []
  };
}

const codexInvocation = resolveCodexInvocation();

function loadState() {
  ensureDir(runtimeDir);

  const activeStateFile = fs.existsSync(stateFile)
    ? stateFile
    : legacyStateFile;

  if (!fs.existsSync(activeStateFile)) {
    return createInitialState();
  }

  const state = parseJson(fs.readFileSync(activeStateFile, "utf8"));
  return state || createInitialState();
}

function resolveThreadWorkspace(workspaceToken) {
  const relativeToken = String(workspaceToken || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^~\//, "")
    .replace(/^\/+/, "");

  if (!relativeToken) {
    return null;
  }

  const candidatePath = path.resolve(workspaceRoot, relativeToken);

  if (!isPathInsideRoot(candidatePath, workspaceRoot) || !fs.existsSync(candidatePath)) {
    return null;
  }

  let realPath;

  try {
    realPath = fs.realpathSync(candidatePath);
  } catch {
    return null;
  }

  if (!isPathInsideRoot(realPath, workspaceRoot)) {
    return null;
  }

  const stats = fs.statSync(realPath);

  if (!stats.isDirectory()) {
    return null;
  }

  return {
    key: relativeToken,
    path: realPath
  };
}

function saveState(state) {
  ensureDir(runtimeDir);
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function writePidFile() {
  ensureDir(runtimeDir);
  if (fs.existsSync(legacyPidFile)) {
    fs.unlinkSync(legacyPidFile);
  }
  fs.writeFileSync(pidFile, JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString()
  }, null, 2));
}

function removePidFile() {
  if (fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }

  if (fs.existsSync(legacyPidFile)) {
    fs.unlinkSync(legacyPidFile);
  }
}

function ensureSingleInstance() {
  ensureDir(runtimeDir);

  for (const candidatePidFile of [pidFile, legacyPidFile]) {
    if (!fs.existsSync(candidatePidFile)) {
      continue;
    }

    const existing = parseJson(fs.readFileSync(candidatePidFile, "utf8"));

    if (!existing || typeof existing.pid !== "number") {
      try {
        fs.unlinkSync(candidatePidFile);
      } catch {
      }
      continue;
    }

    try {
      process.kill(existing.pid, 0);
      throw new Error(`codex daemon is already running with pid ${existing.pid}`);
    } catch (error) {
      if (error && error.code === "ESRCH") {
        try {
          fs.unlinkSync(candidatePidFile);
        } catch {
        }
        continue;
      }

      throw error;
    }
  }
}

function acquireWindowsMutex() {
  const helperScript = path.join(projectRoot, "scripts", "hold-codex-mutex.ps1");

  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      helperScript,
      "-MutexName",
      globalMutexName,
      "-ParentPid",
      String(process.pid)
    ], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let settled = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const fail = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    };

    child.on("error", fail);
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();

      if (!settled && stdoutBuffer.includes("ACQUIRED")) {
        settled = true;
        resolve(child);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
    });
    child.on("exit", (code) => {
      if (!settled) {
        if (code === 2) {
          fail(new Error("codex daemon is already running system-wide."));
        } else {
          fail(new Error(stderrBuffer.trim() || stdoutBuffer.trim() || `Mutex helper exited with code ${code}`));
        }
      }
    });
  });
}

async function acquireSingletonGuard() {
  ensureSingleInstance();

  if (process.platform !== "win32") {
    return null;
  }

  return acquireWindowsMutex();
}

function listMessagesMatchingQuery(query, maxMessages) {
  if (!String(query || "").trim()) {
    return [];
  }

  return listMessages(query, maxMessages);
}

function buildTriageReconcileQuery({
  subjectPrefixes = [SUBJECT_PREFIX, ...legacySubjectPrefixes],
  triageLabelNames = TRIAGE_LABEL_NAMES
} = {}) {
  return [
    "in:inbox",
    "newer_than:14d",
    ...subjectPrefixes
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
      .map((value) => `-subject:${value}`),
    ...triageLabelNames
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map((value) => `-label:${value}`)
  ].join(" ");
}

function collectReconcileCandidates(options) {
  const querySpecs = [
    { name: "command", query: options.query },
    { name: "triage", query: options.triageQuery }
  ].filter((spec) => String(spec.query || "").trim());
  const seenMessageIds = new Set();
  const candidates = [];
  const stats = {};

  for (const spec of querySpecs) {
    const matches = listMessagesMatchingQuery(spec.query, options.maxMessages);
    stats[spec.name] = {
      matches: matches.length,
      query: spec.query
    };

    for (const item of matches.slice().reverse()) {
      if (!item || !item.id || seenMessageIds.has(item.id)) {
        continue;
      }

      seenMessageIds.add(item.id);
      candidates.push({
        id: item.id,
        source: spec.name
      });
    }
  }

  return {
    candidates,
    stats
  };
}

function isWatchErrorLine(line) {
  return /(error|failed|exception|fatal|denied|invalid|unable|missing)/i.test(String(line || ""));
}

class GmailTransport {
  async ensureLabels(labelNames, existingLabels = {}) {
    const labelResponse = runGwsJson([
      "gmail",
      "users",
      "labels",
      "list",
      "--params",
      JSON.stringify({ userId: "me" }),
      "--format",
      "json"
    ]);
    const labels = Array.isArray(labelResponse.labels) ? labelResponse.labels : [];
    const labelMap = { ...existingLabels };

    for (const label of labels) {
      if (label && label.name && label.id) {
        labelMap[label.name] = label.id;
      }
    }

    for (const labelName of labelNames) {
      if (labelMap[labelName]) {
        continue;
      }

      const created = runGwsJson([
        "gmail",
        "users",
        "labels",
        "create",
        "--params",
        JSON.stringify({ userId: "me" }),
        "--json",
        JSON.stringify({
          name: labelName,
          labelListVisibility: "labelShow",
          messageListVisibility: "show"
        }),
        "--format",
        "json"
      ]);

      if (!created || !created.id) {
        throw new Error(`Failed to create label ${labelName}`);
      }

      labelMap[labelName] = created.id;
    }

    return labelMap;
  }

  async setThreadStatus(threadId, status, options = {}) {
    const statusLabelName = STATUS_LABELS[status];
    const labels = options.labels || {};
    const activeLabelId = statusLabelName && labels[statusLabelName]
      ? labels[statusLabelName]
      : null;
    const removableLabelNames = Array.from(new Set([
      ...(options.managedLabelNames || MANAGED_LABEL_NAMES),
      ...LEGACY_MANAGED_LABEL_NAMES
    ]));
    const removeLabelIds = removableLabelNames
      .map((labelName) => labels[labelName])
      .filter((labelId) => Boolean(labelId) && labelId !== activeLabelId);
    const addLabelIds = activeLabelId ? [activeLabelId] : [];

    if (!addLabelIds.length && !removeLabelIds.length) {
      return null;
    }

    return modifyThreadLabels(threadId, {
      addLabelIds,
      removeLabelIds
    });
  }

  async setThreadTriage(threadId, triage, options = {}) {
    if (!triage || !triage.labelName) {
      return null;
    }

    const labels = options.labels || {};
    const activeLabelId = labels[triage.labelName] || null;
    const removeLabelIds = (options.triageLabelNames || TRIAGE_LABEL_NAMES)
      .map((labelName) => labels[labelName])
      .filter((labelId) => Boolean(labelId) && labelId !== activeLabelId);
    const addLabelIds = activeLabelId ? [activeLabelId] : [];

    if (!addLabelIds.length && !removeLabelIds.length) {
      return null;
    }

    return modifyThreadLabels(threadId, {
      addLabelIds,
      removeLabelIds
    });
  }

  async replyToMessage(messageId, body) {
    return replyToMessage(messageId, body);
  }

  async markThreadRead(threadId) {
    return markGmailThreadRead(threadId);
  }
}

function runCodexJsonSession({ commandArgs, cwd = projectRoot, input }) {
  const outputFile = path.join(os.tmpdir(), `codex-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  return new Promise((resolve, reject) => {
    const child = spawn(codexInvocation.command, [
      ...codexInvocation.preArgs,
      ...commandArgs,
      "--skip-git-repo-check",
      "--json",
      "--output-last-message",
      outputFile,
      "-"
    ], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";

    child.on("error", (error) => {
      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }

      reject(new Error(`codex exec failed: ${error.message}`));
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) {
        if (fs.existsSync(outputFile)) {
          fs.unlinkSync(outputFile);
        }

        reject(new Error(`codex exec exited with status ${code}: ${(stderr || stdout || "").trim()}`));
        return;
      }

      const stdoutLines = String(stdout || "").split(/\r?\n/);
      let sessionId = null;

      for (const line of stdoutLines) {
        const payload = parseJson(line);

        if (payload && payload.type === "thread.started" && payload.thread_id) {
          sessionId = payload.thread_id;
        }
      }

      const replyBody = fs.existsSync(outputFile)
        ? fs.readFileSync(outputFile, "utf8").trim()
        : "";

      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }

      resolve({
        replyBody,
        sessionId
      });
    });

    child.stdin.end(input);
  });
}

const TDD_WORKFLOW_STAGES = [
  {
    name: "plan",
    instructions: [
      "Inspect the repo and frame the task as a smallest-safe change.",
      "Identify the focused test command or commands you expect to use.",
      "Do not claim completion and do not update README yet."
    ]
  },
  {
    name: "red",
    instructions: [
      "Create or tighten a focused test first.",
      "Run the focused test and capture a real failing result.",
      "Do not make production code changes that would turn the test green in this stage."
    ]
  },
  {
    name: "green",
    instructions: [
      "Implement the smallest production change that makes the red test pass.",
      "Rerun the focused tests and capture the passing result.",
      "Do not skip, delete, or weaken tests to get a pass."
    ]
  },
  {
    name: "refactor",
    instructions: [
      "Clean up the implementation while keeping behavior the same.",
      "Rerun the relevant tests after the refactor.",
      "Keep the code honest and avoid broad unrelated edits."
    ]
  },
  {
    name: "docs",
    instructions: [
      "Update README.md for any user-visible behavior, workflow, or command changes.",
      "Do not leave the task without a README update.",
      "Rerun the relevant tests if code changed in this stage."
    ]
  }
];
const MAX_WORKFLOW_STAGE_ATTEMPTS = 2;

function clipText(value, maxLength = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();

  if (!text) {
    return "";
  }

  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function formatWorkflowHistory(history) {
  if (!Array.isArray(history) || !history.length) {
    return "(none yet)";
  }

  return history
    .slice(-10)
    .map((entry) => {
      const details = [
        entry.stage || "unknown",
        entry.outcome || "unknown"
      ];

      if (entry.attempt) {
        details.push(`attempt=${entry.attempt}`);
      }

      if (entry.summary) {
        details.push(`summary=${clipText(entry.summary, 80)}`);
      }

      if (entry.issues && entry.issues.length) {
        details.push(`issues=${clipText(entry.issues.join("; "), 80)}`);
      }

      return `- ${details.join(" ")}`;
    })
    .join("\n");
}

function buildWorkerStagePrompt({ guidance, mailboxEmail, stage, task, taskCwd, threadState, workflowHistory }) {
  return [
    "You are the worker agent for the codex email control plane.",
    "",
    "You are inside a monitor-guided TDD workflow. Complete only the current stage.",
    "",
    "Global rules:",
    `- The mailbox owner is ${mailboxEmail}.`,
    `- The current workspace is ${taskCwd}.`,
    "- Use real repo inspection, file edits, and test runs. Do not simulate work.",
    "- Treat that workspace as the project root and use relative repo paths when editing or testing.",
    "- Do not use absolute filesystem paths in apply_patch or other edit commands.",
    "- Never skip, delete, or weaken tests just to get them passing.",
    "- Never claim README work is complete unless README.md was actually updated in this stage or an earlier approved docs stage.",
    "- Return JSON only. No prose, no markdown fences.",
    "",
    `Current stage: ${stage.name}`,
    "Stage instructions:",
    ...stage.instructions.map((instruction) => `- ${instruction}`),
    "",
    "Thread:",
    `- Gmail thread id: ${task.threadId}`,
    `- Existing worker session: ${threadState.workerSessionId || "new"}`,
    `- Task id: ${task.id}`,
    `- Subject: ${task.subject || ""}`,
    "",
    "Latest user request:",
    task.requestText || "(empty request body)",
    "",
    "Approved workflow history so far:",
    formatWorkflowHistory(workflowHistory),
    "",
    "Monitor guidance for this stage:",
    guidance || "(none)",
    "",
    "Return JSON only with this exact shape:",
    "{\"stage\":\"plan|red|green|refactor|docs\",\"status\":\"completed|blocked\",\"summary\":\"...\",\"commands_ran\":[\"...\"],\"files_touched\":[\"...\"],\"tests_status\":\"not_run|failing|passing|unknown\",\"readme_updated\":true,\"notes\":\"...\"}"
  ].join("\n");
}

function buildFinalWorkerPrompt({ mailboxEmail, task, taskCwd, workflowHistory }) {
  return [
    "You are the worker agent for the codex email control plane.",
    "",
    "The monitor has approved each TDD checkpoint. Draft the final plain-text email body for the operator.",
    "",
    "Rules:",
    `- The mailbox owner is ${mailboxEmail}.`,
    `- The workspace was ${taskCwd}.`,
    "- Output only the final plain-text email body.",
    "- Keep it concise and factual.",
    "- Summarize the TDD flow: plan, red, green, refactor, docs.",
    "- Explicitly mention the tests you ran and that README.md was updated.",
    "- Do not claim anything beyond the approved workflow history.",
    "",
    `Task id: ${task.id}`,
    `Subject: ${task.subject || ""}`,
    "",
    "Approved workflow history:",
    formatWorkflowHistory(workflowHistory)
  ].join("\n");
}

function buildCheckpointMonitorPrompt({ mailboxEmail, stage, task, taskCwd, workerReport, workflowHistory }) {
  return [
    "You are the checkpoint monitor for the codex email system.",
    "",
    "Review this worker checkpoint and inspect the repo if needed before approving the next stage.",
    "You may inspect files and run read-only verification commands, including tests.",
    "Do not modify files in this monitor role.",
    "",
    "Primary goals:",
    "- Enforce a real TDD flow.",
    "- Reject attempts to skip, delete, weaken, or sidestep tests just to get a pass.",
    "- Reject any docs completion that does not actually update README.md.",
    "",
    "Mandatory stage expectations:",
    "- plan: the worker should identify the smallest safe change and focused tests; no README claim yet.",
    "- red: there must be a real failing test signal.",
    "- green: the focused tests must be rerun and pass without cheating.",
    "- refactor: relevant tests must be rerun after cleanup.",
    "- docs: README.md must be updated before approval.",
    "",
    "Anti-cheat checks:",
    "- look for skipped tests, .only, weakened assertions, deleted coverage, or config changes that mask failures",
    "- reject vague statements like 'tests should pass' without evidence",
    "- reject missing test commands in red/green/refactor/docs when code changed",
    "",
    `Mailbox owner: ${mailboxEmail}`,
    `Workspace: ${taskCwd}`,
    `Task id: ${task.id}`,
    `Subject: ${task.subject || ""}`,
    `Stage: ${stage.name}`,
    "",
    "Approved workflow history so far:",
    formatWorkflowHistory(workflowHistory),
    "",
    "Worker checkpoint JSON:",
    JSON.stringify(workerReport, null, 2),
    "",
    "Return JSON only with this exact shape:",
    "{\"approved\":true,\"stage_complete\":true,\"issues\":[\"...\"],\"guidance\":\"...\",\"verified_summary\":\"...\",\"suspicious_signals\":[\"...\"]}"
  ].join("\n");
}

function buildMonitorPrompt({ mailboxEmail, task, workerResult }) {
  return [
    "You are the final monitor agent for the codex email system.",
    "",
    "Review the worker draft before it is emailed back.",
    "Use the approved workflow history to verify that the task followed a plan -> red -> green -> refactor -> docs sequence.",
    "",
    "Checks:",
    "- Keep the reply plain text and concise.",
    `- The mailbox owner is ${mailboxEmail}; do not introduce external recipients or suggest emailing others.`,
    "- Do not allow claims that go beyond the approved workflow history.",
    "- Reject drafts that do not mention real test execution.",
    "- Reject drafts that do not mention the README.md update.",
    "- Reject replies that skip important security, auth, or daemon-state caveats.",
    "- Keep the response formatted like an operator report, not a casual chat reply.",
    "",
    "Approved workflow history:",
    formatWorkflowHistory(workerResult.workflowHistory || []),
    "",
    "Return JSON only with this shape:",
    "{\"approved\":true,\"reply_body\":\"...\",\"issues\":[\"...\"]}",
    "",
    `Task id: ${task.id}`,
    `Subject: ${task.subject || ""}`,
    "",
    "Worker draft:",
    workerResult.replyBody || "(empty)"
  ].join("\n");
}

function normalizeWorkerStageReport(stageName, parsed, rawReply) {
  return {
    stage: stageName,
    status: String(parsed.status || "completed").trim().toLowerCase(),
    summary: String(parsed.summary || "").trim() || clipText(rawReply, 120) || `${stageName} stage completed`,
    commandsRan: normalizeStringArray(parsed.commands_ran || parsed.commandsRan),
    filesTouched: normalizeStringArray(parsed.files_touched || parsed.filesTouched),
    testsStatus: String(parsed.tests_status || parsed.testsStatus || "unknown").trim().toLowerCase(),
    readmeUpdated: parsed.readme_updated === true,
    notes: String(parsed.notes || "").trim()
  };
}

function normalizeCheckpointReview(stageName, parsed, rawReply) {
  return {
    stage: stageName,
    approved: parsed.approved !== false,
    stageComplete: parsed.stage_complete !== false,
    issues: normalizeStringArray(parsed.issues),
    guidance: String(parsed.guidance || "").trim(),
    verifiedSummary: String(parsed.verified_summary || "").trim() || clipText(rawReply, 120) || `${stageName} verified`,
    suspiciousSignals: normalizeStringArray(parsed.suspicious_signals || parsed.suspiciousSignals)
  };
}

function buildExecCommandArgs({
  approvalPolicy = "never",
  cwd = projectRoot,
  dangerousBypass = false,
  sandboxMode = "read-only",
  sessionId = null
}) {
  const args = dangerousBypass
    ? [
      "--dangerously-bypass-approvals-and-sandbox",
      "-C",
      cwd,
      "exec"
    ]
    : [
      "-a",
      approvalPolicy,
      "-C",
      cwd,
      "-s",
      sandboxMode,
      "exec"
    ];

  if (sessionId) {
    args.push("resume", sessionId);
  }

  return args;
}

async function callCodexSession(sessionRunner, { approvalPolicy, cwd, dangerousBypass = false, prompt, sandboxMode, sessionId }) {
  const result = await sessionRunner({
    commandArgs: buildExecCommandArgs({
      approvalPolicy,
      cwd,
      dangerousBypass,
      sandboxMode,
      sessionId
    }),
    cwd,
    input: prompt
  });

  return {
    sessionId: result.sessionId || sessionId || null,
    replyBody: String(result.replyBody || "").trim()
  };
}

async function callStructuredCodexSession(
  sessionRunner,
  { approvalPolicy, cwd, dangerousBypass = false, label, normalizer, prompt, sandboxMode, sessionId }
) {
  let result = await callCodexSession(sessionRunner, {
    approvalPolicy,
    cwd,
    dangerousBypass,
    prompt,
    sandboxMode,
    sessionId
  });
  let parsed = parseJson(result.replyBody);

  if (!parsed || typeof parsed !== "object") {
    result = await callCodexSession(sessionRunner, {
      approvalPolicy,
      cwd,
      dangerousBypass,
      sessionId: result.sessionId,
      prompt: [
        `Reformat your last ${label} as JSON only.`,
        "Return exactly one JSON object and no commentary.",
        "Do not add markdown fences."
      ].join("\n"),
      sandboxMode
    });
    parsed = parseJson(result.replyBody);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`${label} was not valid JSON`);
  }

  return {
    sessionId: result.sessionId || sessionId || null,
    report: normalizer(parsed, result.replyBody)
  };
}

class CodexCheckpointMonitor {
  constructor(options = {}) {
    this.sessionRunner = options.sessionRunner || runCodexJsonSession;
  }

  async reviewCheckpoint(context) {
    const prompt = buildCheckpointMonitorPrompt(context);
    const result = await callStructuredCodexSession(this.sessionRunner, {
      approvalPolicy: "never",
      cwd: context.taskCwd,
      label: `${context.stage.name} checkpoint review`,
      normalizer: (parsed, rawReply) => normalizeCheckpointReview(context.stage.name, parsed, rawReply),
      prompt,
      sandboxMode: "read-only",
      sessionId: context.monitorSessionId || null
    });

    return {
      ...result.report,
      sessionId: result.sessionId || context.monitorSessionId || null
    };
  }
}

class CodexWorkerRunner {
  constructor(options = {}) {
    this.sessionRunner = options.sessionRunner || runCodexJsonSession;
    this.workflowMonitor = options.workflowMonitor || new CodexCheckpointMonitor({
      sessionRunner: options.monitorSessionRunner || runCodexJsonSession
    });
  }

  async runTask(context) {
    const testDelayMs = Number(process.env.CODEX_TEST_WORK_DELAY_MS || process.env.CODEX_314_TEST_WORK_DELAY_MS || 0);
    const threadState = context.threadState;
    const taskCwd = context.task.workspacePath || threadState.workspacePath || projectRoot;
    const workflowHistory = Array.isArray(context.task.workflowHistory)
      ? context.task.workflowHistory.slice()
      : [];
    let workerSessionId = threadState.workerSessionId || null;
    let monitorSessionId = context.state.monitor && context.state.monitor.sessionId
      ? context.state.monitor.sessionId
      : null;

    if (Number.isFinite(testDelayMs) && testDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, testDelayMs));
    }

    for (const stage of TDD_WORKFLOW_STAGES) {
      let stageApproved = false;
      let guidance = `Complete the ${stage.name} stage and satisfy every listed stage instruction.`;

      for (let attempt = 1; attempt <= MAX_WORKFLOW_STAGE_ATTEMPTS; attempt += 1) {
        context.task.workflowStage = stage.name;
        await context.persist();

        const workerStageResult = await callStructuredCodexSession(this.sessionRunner, {
          approvalPolicy: "never",
          cwd: taskCwd,
          dangerousBypass: true,
          label: `${stage.name} worker checkpoint`,
          normalizer: (parsed, rawReply) => normalizeWorkerStageReport(stage.name, parsed, rawReply),
          prompt: buildWorkerStagePrompt({
            guidance,
            mailboxEmail: context.mailboxEmail,
            stage,
            task: context.task,
            taskCwd,
            threadState,
            workflowHistory
          }),
          sandboxMode: "danger-full-access",
          sessionId: workerSessionId
        });
        workerSessionId = workerStageResult.sessionId || workerSessionId;

        const monitorReview = await this.workflowMonitor.reviewCheckpoint({
          mailboxEmail: context.mailboxEmail,
          monitorSessionId,
          stage,
          task: context.task,
          taskCwd,
          workerReport: workerStageResult.report,
          workflowHistory
        });
        monitorSessionId = monitorReview.sessionId || monitorSessionId;
        if (monitorSessionId) {
          context.state.monitor.sessionId = monitorSessionId;
        }

        const historyEntry = {
          stage: stage.name,
          attempt,
          outcome: monitorReview.approved && monitorReview.stageComplete ? "approved" : "retry",
          summary: monitorReview.verifiedSummary || workerStageResult.report.summary,
          issues: monitorReview.issues.slice(),
          suspiciousSignals: monitorReview.suspiciousSignals.slice(),
          commandsRan: workerStageResult.report.commandsRan.slice(),
          filesTouched: workerStageResult.report.filesTouched.slice(),
          testsStatus: workerStageResult.report.testsStatus,
          readmeUpdated: workerStageResult.report.readmeUpdated
        };

        workflowHistory.push(historyEntry);
        context.task.workflowHistory = workflowHistory.slice(-20);
        await context.persist();

        if (monitorReview.approved && monitorReview.stageComplete) {
          stageApproved = true;
          break;
        }

        guidance = [
          `Retry the ${stage.name} stage.`,
          monitorReview.guidance || "",
          monitorReview.issues.length
            ? `Fix these issues: ${monitorReview.issues.join("; ")}`
            : "Provide stronger evidence for the stage requirements."
        ].filter(Boolean).join("\n");
      }

      if (!stageApproved) {
        throw new Error(`Monitor rejected the ${stage.name} stage after ${MAX_WORKFLOW_STAGE_ATTEMPTS} attempts.`);
      }
    }

    context.task.workflowStage = "finalize";
    await context.persist();

    const finalDraft = await callCodexSession(this.sessionRunner, {
      approvalPolicy: "never",
      cwd: taskCwd,
      dangerousBypass: true,
      prompt: buildFinalWorkerPrompt({
        mailboxEmail: context.mailboxEmail,
        task: context.task,
        taskCwd,
        workflowHistory
      }),
      sandboxMode: "danger-full-access",
      sessionId: workerSessionId
    });

    context.task.workflowHistory = workflowHistory.slice(-20);
    context.task.workflowStage = "ready_for_final_review";
    await context.persist();

    return {
      sessionId: finalDraft.sessionId || workerSessionId || threadState.workerSessionId || null,
      replyBody: finalDraft.replyBody,
      summary: "worker-complete:tdd-workflow",
      workflowHistory: workflowHistory.slice(-20)
    };
  }
}

class CodexMonitorRunner {
  constructor(options = {}) {
    this.sessionRunner = options.sessionRunner || runCodexJsonSession;
  }

  async reviewTask(context) {
    const prompt = buildMonitorPrompt(context);
    const result = await callStructuredCodexSession(this.sessionRunner, {
      approvalPolicy: "never",
      cwd: context.task.workspacePath || context.threadState.workspacePath || projectRoot,
      label: "final monitor review",
      normalizer: (parsed) => ({
        approved: parsed.approved !== false,
        issues: normalizeStringArray(parsed.issues),
        replyBody: String(parsed.reply_body || context.workerResult.replyBody || "").trim()
      }),
      prompt,
      sandboxMode: "read-only",
      sessionId: context.state.monitor && context.state.monitor.sessionId
        ? context.state.monitor.sessionId
        : null
    });

    return {
      approved: result.report.approved,
      issues: result.report.issues,
      replyBody: result.report.replyBody,
      sessionId: result.sessionId || (context.state.monitor && context.state.monitor.sessionId) || null
    };
  }
}

function createSystem(profile, state, options) {
  return new CodexEmailSystem({
    allowExternalMessages: options.allowExternalMessages,
    logger: { log },
    mailboxEmail: profile.emailAddress,
    monitorRunner: new CodexMonitorRunner(),
    persistState: async (nextState) => {
      saveState(nextState);
    },
    runtimeInfoProvider: () => ({
      pid: process.pid,
      mode: options.once ? "once" : "evented-watch",
      query: options.query,
      reconcileIntervalMs: options.reconcileIntervalMs,
      triageQuery: options.triageQuery,
      triageMode: "label-only",
      httpPort: options.httpPort,
      publicOrigin: options.publicOrigin,
      workspaceRoot,
      watchRenewHours: options.watchRenewHours
    }),
    state,
    transport: new GmailTransport(),
    triageMode: "label-only",
    workspaceResolver: resolveThreadWorkspace,
    workerRunner: new CodexWorkerRunner()
  });
}

function buildWatchArgs(projectId) {
  return [
    path.join(projectRoot, "src", "gmail-agent.js"),
    "gws",
    "gmail",
    "+watch",
    "--project",
    projectId,
    "--label-ids",
    "INBOX",
    "--msg-format",
    "minimal",
    "--cleanup"
  ];
}

async function runOnce(system, options) {
  const { candidates, stats } = collectReconcileCandidates(options);

  log(`Found ${candidates.length} reconcile candidates across ${Object.keys(stats).length} mailbox queries.`);
  system.recordEvent("run_once_scan", {
    commandMatches: stats.command ? stats.command.matches : 0,
    commandQuery: stats.command ? stats.command.query : "none",
    triageMatches: stats.triage ? stats.triage.matches : 0,
    triageQuery: stats.triage ? stats.triage.query : "none",
    matches: candidates.length
  });
  await system.persist();

  for (const item of candidates) {
    if (!item || !item.id) {
      continue;
    }

    try {
      const message = readMessage(item.id);
      system.state.watch.lastEventAt = new Date().toISOString();
      system.recordEvent("run_once_message", {
        messageId: item.id
      });
      await system.ingestMessage(message);
    } catch (error) {
      log(`Failed to ingest message ${item.id}: ${serializeError(error)}`);
      system.state.watch.lastErrorAt = new Date().toISOString();
      system.state.watch.lastError = serializeError(error);
      system.recordEvent("run_once_ingest_error", {
        messageId: item.id,
        error: serializeError(error)
      });
    }
  }

  await system.waitForIdle();
}

async function reconcileMailbox(system, options, reason = "reconcile") {
  const { candidates, stats } = collectReconcileCandidates(options);
  let ingested = 0;

  for (const item of candidates) {
    if (!item || !item.id) {
      continue;
    }

    try {
      const message = readMessage(item.id);
      const result = await system.ingestMessage(message);

      if (result && !String(result.action || "").startsWith("ignored_")) {
        ingested += 1;
      }
    } catch (error) {
      log(`Reconcile failed for message ${item.id}: ${serializeError(error)}`);
      system.state.watch.lastErrorAt = new Date().toISOString();
      system.state.watch.lastError = serializeError(error);
      system.recordEvent("reconcile_error", {
        messageId: item.id,
        error: serializeError(error),
        reason
      });
    }
  }

  system.recordEvent("reconcile_scan", {
    reason,
    commandMatches: stats.command ? stats.command.matches : 0,
    triageMatches: stats.triage ? stats.triage.matches : 0,
    matches: candidates.length,
    ingested
  });
  await system.persist();
}

function startReconcileLoop(system, options) {
  let stopped = false;
  let running = false;

  const tick = async (reason = "interval") => {
    if (stopped || running) {
      return;
    }

    running = true;

    try {
      await reconcileMailbox(system, options, reason);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    tick("interval").catch((error) => {
      log(`Reconcile loop failed: ${serializeError(error)}`);
    });
  }, options.reconcileIntervalMs);

  tick("startup").catch((error) => {
    log(`Initial reconcile failed: ${serializeError(error)}`);
  });

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);

      while (running) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  };
}

async function startWatchSession(system, projectId, renewHours) {
  const env = buildEnv({ strictClientSecret: false });
  const watchArgs = buildWatchArgs(projectId);
  const child = spawn(process.execPath, watchArgs, {
    cwd: projectRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  const renewTimer = setTimeout(() => {
    log("Renewing Gmail watch session.");
    child.kill();
  }, renewHours * 60 * 60 * 1000);

  const stdout = readline.createInterface({ input: child.stdout });
  const stderr = readline.createInterface({ input: child.stderr });
  let processing = Promise.resolve();

  stdout.on("line", (line) => {
    const payload = parseJson(line);

    if (!payload || !payload.id) {
      return;
    }

    processing = processing
      .then(async () => {
        const message = readMessage(payload.id);
        system.state.watch.lastEventAt = new Date().toISOString();
        system.recordEvent("watch_message", {
          messageId: payload.id
        });
        await system.ingestMessage(message);
      })
      .catch((error) => {
        log(`Watch message handling failed: ${serializeError(error)}`);
        system.state.watch.lastErrorAt = new Date().toISOString();
        system.state.watch.lastError = serializeError(error);
        system.recordEvent("watch_message_error", {
          messageId: payload.id,
          error: serializeError(error)
        });
      });
  });

  stderr.on("line", (line) => {
    if (line && line.trim()) {
      const trimmedLine = line.trim();
      log(`watch stderr: ${trimmedLine}`);

      if (isWatchErrorLine(trimmedLine)) {
        system.state.watch.lastErrorAt = new Date().toISOString();
        system.state.watch.lastError = trimmedLine;
        system.recordEvent("watch_stderr", {
          line: trimmedLine
        });
      } else {
        system.recordEvent("watch_notice", {
          line: trimmedLine
        });
      }
    }
  });

  return new Promise((resolve, reject) => {
    child.on("error", (error) => {
      clearTimeout(renewTimer);
      system.state.watch.lastErrorAt = new Date().toISOString();
      system.state.watch.lastError = serializeError(error);
      system.recordEvent("watch_process_error", {
        error: serializeError(error)
      });
      reject(error);
    });

    child.on("exit", async (code) => {
      clearTimeout(renewTimer);
      await processing;

      if (code === 0 || code === null) {
        system.recordEvent("watch_exit", {
          code: code === null ? "signal" : String(code)
        });
        resolve();
      } else {
        system.state.watch.lastErrorAt = new Date().toISOString();
        system.state.watch.lastError = `watch helper exited with status ${code}`;
        system.recordEvent("watch_exit_error", {
          code: String(code)
        });
        reject(new Error(`watch helper exited with status ${code}`));
      }
    });
  });
}

async function runEventLoop(system, projectId, options) {
  for (;;) {
    system.state.watch.lastStartedAt = new Date().toISOString();
    system.state.watch.lastError = null;
    system.state.watch.lastErrorAt = null;
    system.state.watch.renewAfterHours = options.watchRenewHours;
    system.recordEvent("watch_started", {
      projectId,
      renewHours: options.watchRenewHours
    });
    saveState(system.state);
    const reconcileLoop = startReconcileLoop(system, options);

    try {
      await startWatchSession(system, projectId, options.watchRenewHours);
    } catch (error) {
      log(`Watch session failed: ${serializeError(error)}`);
      system.state.watch.lastErrorAt = new Date().toISOString();
      system.state.watch.lastError = serializeError(error);
      system.recordEvent("watch_failed", {
        error: serializeError(error)
      });
    } finally {
      await reconcileLoop.stop();
    }

    await system.waitForIdle();
    await system.persist();
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const singletonHelper = await acquireSingletonGuard();
  writePidFile();
  let shuttingDown = false;
  let apiServer = null;

  const cleanup = () => {
    shuttingDown = true;

    if (singletonHelper && !singletonHelper.killed) {
      singletonHelper.kill();
    }

    if (apiServer) {
      void apiServer.close().catch(() => undefined);
      apiServer = null;
    }

    removePidFile();
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  if (singletonHelper) {
    singletonHelper.on("exit", (code) => {
      if (!shuttingDown && code !== null && !process.exitCode) {
        log("Singleton mutex helper exited unexpectedly. Stopping daemon.");
        cleanup();
        process.exit(1);
      }
    });
  }

  try {
    ensureDaemonScopes("The evented codex daemon");
    const profile = getMailboxProfile();
    const state = loadState();
    const projectId = getEffectiveProjectId() || (getGwsAuthStatus().data && getGwsAuthStatus().data.project_id) || null;

    if (!projectId) {
      throw new Error("No Google Cloud project id is configured for Gmail watch. Set GOOGLE_WORKSPACE_PROJECT_ID in .env.");
    }

    const system = createSystem(profile, state, options);
    await system.initialize();
    await system.resumePendingWork();
    system.state.watch.renewAfterHours = options.watchRenewHours;
    system.recordEvent("daemon_started", {
      mailbox: profile.emailAddress,
      mode: options.once ? "once" : "evented-watch"
    });
    await system.persist();
    log(`codex daemon started for ${profile.emailAddress}. Mode: ${options.once ? "once" : "evented-watch"}.`);

    if (!options.once && options.httpPort !== 0) {
      try {
        apiServer = await startMailApiServer({
          getMailboxProfile: () => profile,
          getRuntimeInfo: () => system.getRuntimeInfo(),
          getState: () => system.state,
          host: process.env.CODEX_MAIL_HOST || "127.0.0.1",
          markThreadRead: async (threadId) => markGmailThreadRead(threadId),
          persist: async () => {
            await system.persist();
          },
          port: options.httpPort,
          publicOrigin: options.publicOrigin,
          readThread: async (threadId) => readThread(threadId),
          recordEvent: (type, details) => {
            system.recordEvent(type, details);
          },
          replyToMessage: async (messageId, body) => replyToMessage(messageId, body),
          sendEmail: async ({ to, subject, body }) => sendEmail({ to, subject, body })
        });

        system.recordEvent("mail_api_started", {
          host: apiServer.host,
          port: apiServer.port,
          publicOrigin: apiServer.publicOrigin
        });
        await system.persist();
        log(`mail api listening on http://${apiServer.host}:${apiServer.port} -> ${apiServer.publicOrigin}`);
      } catch (error) {
        system.recordEvent("mail_api_failed", {
          error: serializeError(error),
          port: options.httpPort
        });
        await system.persist();
        log(`mail api failed to start: ${serializeError(error)}`);
      }
    }

    if (options.once) {
      await runOnce(system, options);
      return;
    }

    await runEventLoop(system, projectId, options);
  } finally {
    cleanup();
  }
}

module.exports = {
  CodexCheckpointMonitor,
  CodexMonitorRunner,
  CodexWorkerRunner,
  TDD_WORKFLOW_STAGES,
  buildExecCommandArgs,
  buildCheckpointMonitorPrompt,
  buildFinalWorkerPrompt,
  buildMonitorPrompt,
  buildWorkerStagePrompt,
  callCodexSession,
  callStructuredCodexSession,
  buildTriageReconcileQuery,
  collectReconcileCandidates,
  createSystem,
  normalizeCheckpointReview,
  normalizeWorkerStageReport,
  parseArgs,
  resolveThreadWorkspace,
  workspaceRoot
};

if (require.main === module) {
  main().catch((error) => {
    log(`Fatal error: ${serializeError(error)}`);
    removePidFile();
    process.exit(1);
  });
}
