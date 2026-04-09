#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

require("dotenv").config({ quiet: true });

const projectRoot = path.resolve(__dirname, "..");
const configDir = path.join(projectRoot, ".gws");
const localClientSecret = path.join(configDir, "client_secret.json");
const defaultClientSecretPath = path.join(projectRoot, "secrets", "client_secret.json");
const knownGcloudBins = [
  path.join(process.env.LOCALAPPDATA || "", "Google", "Cloud SDK", "google-cloud-sdk", "bin"),
  path.join("C:", "Program Files", "Google", "Cloud SDK", "google-cloud-sdk", "bin")
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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

function buildConsoleUrls() {
  const projectId = process.env.GOOGLE_WORKSPACE_PROJECT_ID;
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

  const gcloudBin = knownGcloudBins.find((dirPath) => dirPath && fs.existsSync(path.join(dirPath, "gcloud.cmd")));
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

function runGws(args) {
  const isAuthSetup = args[0] === "auth" && args[1] === "setup";
  const needsStrictClientSecret = !isAuthSetup && !args.includes("--help") && !args.includes("-h") && !args.includes("--dry-run");
  const env = buildEnv({ strictClientSecret: needsStrictClientSecret });
  const bin = process.platform === "win32"
    ? path.join(projectRoot, "node_modules", "@googleworkspace", "cli", "bin", "gws.exe")
    : path.join(projectRoot, "node_modules", ".bin", "gws");

  const result = spawnSync(bin, args, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(typeof result.status === "number" ? result.status : 1);
  }

  process.exit(typeof result.status === "number" ? result.status : 0);
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
  const urls = buildConsoleUrls();
  const auth = hasClientConfiguration();
  const expectedPath = auth.clientSecret.source || defaultClientSecretPath;

  console.log(`
gmail-agent auth assistant

What you need:
  1. Google Cloud project
  2. Gmail API enabled
  3. OAuth consent screen set to External, in Testing
  4. Your Gmail added as a Test user
  5. Desktop OAuth client JSON downloaded to:
     ${expectedPath}

Helpful links:
  Console:      ${urls.console}
  Gmail API:    ${urls.gmailApi}
  Consent:      ${urls.consent}
  Credentials:  ${urls.credentials}
`);

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
    runGws(["auth", "login", "--readonly", "-s", "gmail"]);
  } else {
    console.log("OAuth client configuration is ready. Run `npm run auth:login` when you want to start the browser login.");
  }
}

function printUsage() {
  console.log(`
gmail-agent

Commands:
  auth:doctor                Show the auth files/vars this project sees
  auth:setup                 Show auth steps and optionally open Google Cloud pages
  auth:start                 Open auth pages, wait for the OAuth JSON, then launch login
  auth:login                 Run the Google Workspace CLI login flow with read-only Gmail scopes
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
  const detectedGcloudBin = knownGcloudBins.find((dirPath) => dirPath && fs.existsSync(path.join(dirPath, "gcloud.cmd"))) || null;
  const report = {
    projectRoot,
    configDir: env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR,
    detectedGcloudBin,
    localClientSecretExists: fs.existsSync(localClientSecret),
    usingClientSecretFile: clientSecret.configured,
    configuredClientSecretPath: clientSecret.source,
    configuredClientSecretExists: clientSecret.exists,
    usingClientIdAndSecret: hasEnvClientCredentials(),
    projectId: process.env.GOOGLE_WORKSPACE_PROJECT_ID || null
  };

  console.log(JSON.stringify(report, null, 2));
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
      runGws(["auth", "login", "--readonly", "-s", "gmail"]);
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
