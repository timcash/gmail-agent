#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

require("dotenv").config({ quiet: true });

const projectRoot = path.resolve(__dirname, "..");
const configDir = path.join(projectRoot, ".gws");
const localClientSecret = path.join(configDir, "client_secret.json");
const defaultClientSecretPath = path.join(projectRoot, "secrets", "client_secret.json");
const gmailReadonlyScope = "https://www.googleapis.com/auth/gmail.readonly";
const knownGcloudBins = [
  path.join(process.env.LOCALAPPDATA || "", "Google", "Cloud SDK", "google-cloud-sdk", "bin"),
  path.join("C:", "Program Files", "Google", "Cloud SDK", "google-cloud-sdk", "bin")
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseJson(text) {
  const trimmed = (text || "").trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function getGcloudBin() {
  return knownGcloudBins.find((dirPath) => dirPath && fs.existsSync(path.join(dirPath, "gcloud.cmd"))) || null;
}

function getGcloudCommand() {
  const gcloudBin = getGcloudBin();
  return gcloudBin ? path.join(gcloudBin, "gcloud.cmd") : null;
}

function runProcess(command, args, options = {}) {
  const { capture = false, env = process.env, cwd = projectRoot } = options;

  return spawnSync(command, args, capture
    ? {
        cwd,
        env,
        shell: false,
        encoding: "utf8",
        stdio: "pipe",
        windowsHide: true
      }
    : {
        cwd,
        env,
        shell: false,
        stdio: "inherit",
        windowsHide: true
      });
}

function escapePowerShellArgument(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerShellCommand(command, args, options = {}) {
  const { capture = false, env = process.env, cwd = projectRoot } = options;
  const commandLine = `& ${escapePowerShellArgument(command)} ${args.map(escapePowerShellArgument).join(" ")}`.trim();

  return spawnSync("powershell.exe", ["-NoProfile", "-Command", commandLine], capture
    ? {
        cwd,
        env,
        shell: false,
        encoding: "utf8",
        stdio: "pipe",
        windowsHide: true
      }
    : {
        cwd,
        env,
        shell: false,
        stdio: "inherit",
        windowsHide: true
      });
}

function ensureLocalClientSecret(strict = true) {
  const configuredPath = process.env.GMAIL_AGENT_CLIENT_SECRET_FILE;

  if (!configuredPath) {
    return { configured: false, exists: false, source: null };
  }

  const source = path.resolve(projectRoot, configuredPath);

  if (!fs.existsSync(source)) {
    if (!strict) {
      return { configured: true, exists: false, source };
    }

    console.error(JSON.stringify({
      error: "missing_client_secret_file",
      message: `Expected OAuth client JSON at ${source}`,
      fix: "Download a Desktop OAuth client JSON from Google Cloud Console and save it there, or use GOOGLE_WORKSPACE_CLI_CLIENT_ID and GOOGLE_WORKSPACE_CLI_CLIENT_SECRET in .env."
    }, null, 2));
    process.exit(1);
  }

  ensureDir(configDir);

  if (!fs.existsSync(localClientSecret) || fs.readFileSync(source, "utf8") !== fs.readFileSync(localClientSecret, "utf8")) {
    fs.copyFileSync(source, localClientSecret);
  }

  return { configured: true, exists: true, source };
}

function hasEnvClientCredentials() {
  return Boolean(process.env.GOOGLE_WORKSPACE_CLI_CLIENT_ID && process.env.GOOGLE_WORKSPACE_CLI_CLIENT_SECRET);
}

function hasClientConfiguration() {
  const clientSecret = ensureLocalClientSecret(false);

  return {
    clientSecret,
    hasEnvClientCredentials: hasEnvClientCredentials(),
    isReady: clientSecret.exists || hasEnvClientCredentials()
  };
}

function getGcloudContext() {
  const gcloudCommand = getGcloudCommand();

  if (!gcloudCommand) {
    return {
      available: false,
      command: null,
      bin: null,
      account: null,
      project: null
    };
  }

  const authList = runPowerShellCommand(gcloudCommand, ["auth", "list", "--format=json"], { capture: true, cwd: projectRoot });
  const authEntries = parseJson(authList.stdout);
  const activeEntry = Array.isArray(authEntries)
    ? authEntries.find((entry) => entry && entry.status === "ACTIVE") || authEntries[0]
    : null;

  const projectResult = runPowerShellCommand(gcloudCommand, ["config", "get-value", "project"], { capture: true, cwd: projectRoot });
  const projectValue = (projectResult.stdout || "").trim();

  return {
    available: true,
    command: gcloudCommand,
    bin: path.dirname(gcloudCommand),
    account: activeEntry && activeEntry.account ? activeEntry.account : null,
    project: projectValue && projectValue !== "(unset)" ? projectValue : null
  };
}

function getEffectiveProjectId(gcloudContext = getGcloudContext()) {
  return process.env.GOOGLE_WORKSPACE_PROJECT_ID || gcloudContext.project || null;
}

function buildConsoleUrls(projectId = getEffectiveProjectId()) {
  const suffix = projectId ? `?project=${encodeURIComponent(projectId)}` : "";

  return {
    console: `https://console.cloud.google.com/${projectId ? `home/dashboard${suffix}` : ""}`.replace(/\/$/, ""),
    consent: `https://console.cloud.google.com/apis/credentials/consent${suffix}`,
    credentials: `https://console.cloud.google.com/apis/credentials${suffix}`,
    gmailApi: `https://console.cloud.google.com/apis/library/gmail.googleapis.com${suffix}`
  };
}

function buildEnv(options = {}) {
  const { strictClientSecret = true } = options;
  ensureDir(configDir);
  ensureLocalClientSecret(strictClientSecret);

  const gcloudBin = getGcloudBin();
  const currentPath = process.env.PATH || process.env.Path || "";
  const pathWithGcloud = gcloudBin && !currentPath.toLowerCase().includes(gcloudBin.toLowerCase())
    ? `${gcloudBin};${currentPath}`
    : currentPath;

  return {
    ...process.env,
    GOOGLE_WORKSPACE_CLI_CONFIG_DIR: process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR || configDir,
    PATH: pathWithGcloud,
    Path: pathWithGcloud
  };
}

function runGwsProcess(args, options = {}) {
  const isAuthSetup = args[0] === "auth" && args[1] === "setup";
  const needsStrictClientSecret = options.strictClientSecret !== undefined
    ? options.strictClientSecret
    : !isAuthSetup && !args.includes("--help") && !args.includes("-h") && !args.includes("--dry-run");
  const env = buildEnv({ strictClientSecret: needsStrictClientSecret });
  const bin = process.platform === "win32"
    ? path.join(projectRoot, "node_modules", "@googleworkspace", "cli", "bin", "gws.exe")
    : path.join(projectRoot, "node_modules", ".bin", "gws");

  return runProcess(bin, args, {
    capture: options.capture === true,
    env,
    cwd: projectRoot
  });
}

function exitForResult(result) {
  if (result.error) {
    console.error(result.error.message);
    process.exit(typeof result.status === "number" ? result.status : 1);
  }

  process.exit(typeof result.status === "number" ? result.status : 0);
}

function runGws(args, options = {}) {
  const result = runGwsProcess(args, options);
  exitForResult(result);
}

function getGwsAuthStatus() {
  const result = runGwsProcess(["auth", "status"], {
    capture: true,
    strictClientSecret: false
  });

  return {
    result,
    data: parseJson(result.stdout)
  };
}

function getGmailProfileStatus() {
  const result = runGwsProcess([
    "gmail",
    "users",
    "getProfile",
    "--params",
    JSON.stringify({ userId: "me" })
  ], {
    capture: true,
    strictClientSecret: false
  });

  return {
    result,
    data: parseJson(result.stdout)
  };
}

function getErrorDetails(payload) {
  const error = payload && payload.error ? payload.error : null;

  return {
    code: error && typeof error.code !== "undefined" ? error.code : null,
    message: error && error.message ? error.message : null,
    reason: error && error.reason ? error.reason : null,
    enableUrl: error && error.enable_url ? error.enable_url : null
  };
}

function hasStoredCredentials(authStatus) {
  return Boolean(
    authStatus &&
    authStatus.data &&
    (authStatus.data.encrypted_credentials_exists || authStatus.data.plain_credentials_exists)
  );
}

function hasGmailScope(authStatus) {
  const scopes = authStatus && authStatus.data && Array.isArray(authStatus.data.scopes)
    ? authStatus.data.scopes
    : [];

  return scopes.some((scope) => typeof scope === "string" && scope.startsWith("https://www.googleapis.com/auth/gmail"));
}

function printManualOAuthChecklist(projectId, urls, expectedPath) {
  console.log(`
Manual setup checklist:
  1. Gmail API: enable it here
     ${urls.gmailApi}
  2. Google Auth Platform -> Audience:
     - App type: External
     - Publishing status: Testing
     - Add your Google account as a Test user
     ${urls.consent}
  3. Google Auth Platform -> Data Access:
     - Add the Gmail read-only scope
     - Scope: ${gmailReadonlyScope}
     ${urls.consent}
  4. Credentials:
     - Create OAuth client ID
     - Application type: Desktop app
     ${urls.credentials}
  5. Save the downloaded JSON to:
     ${expectedPath}
`);
}

function printScopeRepair(projectId, urls) {
  console.log(`
Your login exists, but Gmail still is not fully authorized.

Fix this in Google Cloud for project ${projectId || "<set your project first>"}:
  1. Google Auth Platform -> Audience
     - Confirm your Google account is listed as a Test user
     ${urls.consent}
  2. Google Auth Platform -> Data Access
     - Add ${gmailReadonlyScope}
     ${urls.consent}
  3. Then refresh the token so Google grants the new scope:
     npm run auth:reset
`);
}

function printVerificationSuccess(authStatus, profileStatus) {
  const emailAddress = profileStatus.data && profileStatus.data.emailAddress ? profileStatus.data.emailAddress : authStatus.data.user;

  console.log(`
gmail-agent is ready.

Connected account: ${emailAddress}
Granted Gmail scope: yes
Mailbox access: verified

Try:
  npm run gmail:inbox
  npm run gmail:search -- "from:github newer_than:7d"
`);
}

async function authVerify(options = {}) {
  const { quietSuccess = false } = options;
  const gcloudContext = getGcloudContext();
  const projectId = getEffectiveProjectId(gcloudContext);
  const urls = buildConsoleUrls(projectId);
  const authStatus = getGwsAuthStatus();

  if (!hasStoredCredentials(authStatus)) {
    console.log(`
No saved Google Workspace CLI credentials were found.

Next step:
  npm run auth:login
`);
    return false;
  }

  if (!hasGmailScope(authStatus)) {
    printScopeRepair(projectId, urls);
    return false;
  }

  const profileStatus = getGmailProfileStatus();

  if (profileStatus.result.status === 0 && profileStatus.data && profileStatus.data.emailAddress) {
    if (!quietSuccess) {
      printVerificationSuccess(authStatus, profileStatus);
    }
    return true;
  }

  const errorDetails = getErrorDetails(profileStatus.data);

  if (errorDetails.reason === "insufficientPermissions") {
    printScopeRepair(projectId, urls);
    return false;
  }

  if (errorDetails.reason === "accessNotConfigured" || errorDetails.enableUrl) {
    console.log(`
The Gmail API is not enabled for the active project yet.

Enable it here:
  ${errorDetails.enableUrl || urls.gmailApi}

Then retry:
  npm run auth:verify
`);
    return false;
  }

  if (profileStatus.result.status !== 0) {
    console.log(`
Gmail auth verification failed.

What to check:
  - The OAuth client is a Desktop app
  - Your account is a Test user
  - ${gmailReadonlyScope} is added under Google Auth Platform -> Data Access
  - If you changed scopes after logging in, run: npm run auth:reset

Raw error:
${errorDetails.message || profileStatus.result.stderr || profileStatus.result.stdout || "Unknown error"}
`);
    return false;
  }

  return false;
}

async function authLoginFlow() {
  const result = runGwsProcess(["auth", "login", "--readonly", "-s", "gmail"], {
    strictClientSecret: true
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(typeof result.status === "number" ? result.status : 1);
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }

  const verified = await authVerify();
  process.exit(verified ? 0 : 1);
}

async function authResetFlow() {
  console.log("Clearing saved credentials so the next login can pick up new scopes...");
  const logoutResult = runGwsProcess(["auth", "logout"], {
    strictClientSecret: false
  });

  if (logoutResult.error) {
    console.error(logoutResult.error.message);
    process.exit(typeof logoutResult.status === "number" ? logoutResult.status : 1);
  }

  if (typeof logoutResult.status === "number" && logoutResult.status !== 0) {
    process.exit(logoutResult.status);
  }

  await authLoginFlow();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openExternal(target) {
  let result;

  if (process.platform === "win32") {
    result = spawnSync("cmd.exe", ["/c", "start", "", target], {
      cwd: projectRoot,
      stdio: "ignore",
      windowsHide: true
    });
  } else if (process.platform === "darwin") {
    result = spawnSync("open", [target], {
      cwd: projectRoot,
      stdio: "ignore"
    });
  } else {
    result = spawnSync("xdg-open", [target], {
      cwd: projectRoot,
      stdio: "ignore"
    });
  }

  return !result.error;
}

function printAuthAssistantMessage() {
  const gcloudContext = getGcloudContext();
  const projectId = getEffectiveProjectId(gcloudContext);
  const urls = buildConsoleUrls(projectId);
  const auth = hasClientConfiguration();
  const expectedPath = auth.clientSecret.source || defaultClientSecretPath;

  console.log(`
gmail-agent auth assistant

What you need:
  1. Google Cloud project
  2. Gmail API enabled
  3. Google Auth Platform -> Audience:
     - External app
     - Testing mode
     - Your Google account added as a Test user
  4. Google Auth Platform -> Data Access:
     - Add ${gmailReadonlyScope}
  5. Credentials -> Desktop app OAuth client
  6. Desktop OAuth client JSON downloaded to:
     ${expectedPath}

Helpful links:
  Console:      ${urls.console}
  Gmail API:    ${urls.gmailApi}
  Consent:      ${urls.consent}
  Credentials:  ${urls.credentials}
`);

  if (gcloudContext.available) {
    console.log(`Detected gcloud: ${gcloudContext.bin}`);
  } else {
    console.log("Detected gcloud: not found");
  }

  if (gcloudContext.account) {
    console.log(`Active gcloud account: ${gcloudContext.account}`);
  }

  if (projectId) {
    console.log(`Active project: ${projectId}`);
  }

  if (auth.hasEnvClientCredentials) {
    console.log("Client ID and secret are already present in .env, so the project can skip the JSON file.");
  } else if (auth.clientSecret.exists) {
    console.log("OAuth client JSON is already present, so the project is ready to start login.");
  } else {
    console.log("OAuth client JSON is not present yet.");
  }
}

async function waitForClientSecret(timeoutMs) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const auth = hasClientConfiguration();

    if (auth.isReady) {
      return auth;
    }

    const remainingSeconds = Math.max(0, Math.ceil((timeoutMs - (Date.now() - started)) / 1000));
    console.log(`Waiting for OAuth credentials at ${auth.clientSecret.source || defaultClientSecretPath} (${remainingSeconds}s left)...`);
    await sleep(5000);
  }

  return hasClientConfiguration();
}

async function authSetup(options = {}) {
  const { open = false, wait = false, timeoutMs = 15 * 60 * 1000, loginAfterReady = false } = options;

  ensureDir(path.dirname(defaultClientSecretPath));
  printAuthAssistantMessage();

  if (open) {
    const urls = buildConsoleUrls();
    openExternal(urls.gmailApi);
    openExternal(urls.consent);
    openExternal(urls.credentials);
    openExternal(path.dirname(defaultClientSecretPath));
  }

  let auth = hasClientConfiguration();

  if (!auth.isReady && wait) {
    auth = await waitForClientSecret(timeoutMs);
  }

  if (!auth.isReady) {
    const gcloudContext = getGcloudContext();
    const projectId = getEffectiveProjectId(gcloudContext);
    const urls = buildConsoleUrls(projectId);

    if (gcloudContext.available && gcloudContext.account && projectId) {
      console.log(`
Fastest path with gcloud:
  npm run gws -- auth setup --project ${projectId} --login
`);
    }

    printManualOAuthChecklist(projectId, urls, auth.clientSecret.source || defaultClientSecretPath);

    console.log(`
Next step:
  Download the Desktop OAuth client JSON and save it to:
  ${auth.clientSecret.source || defaultClientSecretPath}

Then run:
  npm run auth:login
`);
    return;
  }

  if (loginAfterReady) {
    await authLoginFlow();
  } else {
    console.log("OAuth client configuration is ready. Run `npm run auth:login` when you want to start the browser login.");
  }
}

function printUsage() {
  console.log(`
gmail-agent

Commands:
  auth:doctor                Show the auth files/vars this project sees
  auth:guide                 Show the full setup and repair checklist for Gmail auth
  auth:setup                 Show auth steps and optionally open Google Cloud pages
  auth:start                 Open auth pages, wait for the OAuth JSON, then launch login
  auth:login                 Run login, then verify that Gmail access really works
  auth:verify                Check saved auth state, Gmail scopes, and live mailbox access
  auth:reset                 Clear saved tokens, re-login, and verify again
  gmail:profile              Show your Gmail profile
  gmail:inbox                Show a simple unread inbox summary
  gmail:search <query>       Search Gmail and show matching message headers
  gmail:read <messageId>     Read one message body plus common headers
  gws <...args>              Pass raw args straight through to gws
`);
}

function authDoctor() {
  const clientSecret = ensureLocalClientSecret(false);
  const env = buildEnv({ strictClientSecret: false });
  const gcloudContext = getGcloudContext();
  const authStatus = getGwsAuthStatus();
  const report = {
    projectRoot,
    configDir: env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR,
    detectedGcloudBin: gcloudContext.bin,
    gcloudAccount: gcloudContext.account,
    gcloudProject: gcloudContext.project,
    localClientSecretExists: fs.existsSync(localClientSecret),
    usingClientSecretFile: clientSecret.configured,
    configuredClientSecretPath: clientSecret.source,
    configuredClientSecretExists: clientSecret.exists,
    usingClientIdAndSecret: hasEnvClientCredentials(),
    projectId: getEffectiveProjectId(gcloudContext),
    hasStoredCredentials: hasStoredCredentials(authStatus),
    hasGmailScope: hasGmailScope(authStatus)
  };

  console.log(JSON.stringify(report, null, 2));
}

function authGuide(options = {}) {
  const { open = false } = options;
  const gcloudContext = getGcloudContext();
  const projectId = getEffectiveProjectId(gcloudContext);
  const urls = buildConsoleUrls(projectId);
  const auth = hasClientConfiguration();
  const authStatus = getGwsAuthStatus();
  const expectedPath = auth.clientSecret.source || defaultClientSecretPath;

  if (open) {
    openExternal(urls.gmailApi);
    openExternal(urls.consent);
    openExternal(urls.credentials);
    openExternal(path.dirname(expectedPath));
  }

  console.log(`
gmail-agent auth guide

Detected:
  gcloud installed: ${gcloudContext.available ? "yes" : "no"}
  gcloud account:   ${gcloudContext.account || "not signed in"}
  gcloud project:   ${projectId || "not set"}
  OAuth client:     ${auth.isReady ? "ready" : "missing"}
  Saved login:      ${hasStoredCredentials(authStatus) ? "yes" : "no"}
  Gmail scope:      ${hasGmailScope(authStatus) ? "granted" : "missing"}
`);

  if (!auth.isReady) {
    if (gcloudContext.available && gcloudContext.account && projectId) {
      console.log(`
Recommended next command:
  npm run gws -- auth setup --project ${projectId} --login
`);
    }

    printManualOAuthChecklist(projectId, urls, expectedPath);
    return;
  }

  if (!hasStoredCredentials(authStatus)) {
    console.log(`
Next step:
  npm run auth:login
`);
    return;
  }

  if (!hasGmailScope(authStatus)) {
    printScopeRepair(projectId, urls);
    return;
  }

  console.log(`
Next step:
  npm run auth:verify
`);
}

function gmailSearch(queryParts) {
  const query = queryParts.join(" ").trim();

  if (!query) {
    console.error("Usage: npm run gmail:search -- \"from:someone@example.com newer_than:7d\"");
    process.exit(1);
  }

  runGws([
    "gmail",
    "+triage",
    "--query",
    query,
    "--max",
    "10"
  ]);
}

function gmailRead(messageId) {
  if (!messageId) {
    console.error("Usage: npm run gmail:read -- MESSAGE_ID");
    process.exit(1);
  }

  runGws([
    "gmail",
    "+read",
    "--id",
    messageId,
    "--headers"
  ]);
}

function parseFlags(args) {
  return {
    open: args.includes("--open"),
    wait: args.includes("--wait"),
    timeoutMs: (() => {
      const index = args.indexOf("--timeout-sec");

      if (index === -1 || !args[index + 1]) {
        return 15 * 60 * 1000;
      }

      const seconds = Number(args[index + 1]);
      return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 15 * 60 * 1000;
    })()
  };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "auth:doctor":
      authDoctor();
      break;
    case "auth:guide": {
      const flags = parseFlags(rest);
      authGuide({ open: flags.open });
      break;
    }
    case "auth:setup": {
      const flags = parseFlags(rest);
      await authSetup({
        open: flags.open,
        wait: flags.wait,
        timeoutMs: flags.timeoutMs,
        loginAfterReady: false
      });
      break;
    }
    case "auth:start": {
      const flags = parseFlags(rest);
      await authSetup({
        open: true,
        wait: true,
        timeoutMs: flags.timeoutMs,
        loginAfterReady: true
      });
      break;
    }
    case "auth:login":
      await authLoginFlow();
      break;
    case "auth:verify":
      process.exit(await authVerify() ? 0 : 1);
      break;
    case "auth:reset":
      await authResetFlow();
      break;
    case "gmail:profile":
      runGws(["gmail", "users", "getProfile", "--params", JSON.stringify({ userId: "me" })]);
      break;
    case "gmail:inbox":
      runGws(["gmail", "+triage"]);
      break;
    case "gmail:search":
      gmailSearch(rest);
      break;
    case "gmail:read":
      gmailRead(rest[0]);
      break;
    case "gws":
      runGws(rest);
      break;
    default:
      printUsage();
      break;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
