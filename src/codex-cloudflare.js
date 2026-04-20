const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { get } = require("https");

const DEFAULT_TUNNEL_NAME = "codex-mail";
const DEFAULT_HOSTNAME = "codex.dialtone.earth";
const DEFAULT_ZONE = "dialtone.earth";

async function ensureCloudflaredBinary(workspaceRoot) {
  const resolved = resolveConfiguredCloudflared(workspaceRoot);
  if (resolved) {
    return resolved;
  }

  const downloadSpec = resolveDownloadSpec();
  const targetPath = path.resolve(
    workspaceRoot,
    ".runtime",
    "cloudflare",
    downloadSpec.fileName
  );

  if (fs.existsSync(targetPath)) {
    return targetPath;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  await downloadCloudflared(downloadSpec.url, targetPath);

  if (process.platform !== "win32") {
    fs.chmodSync(targetPath, 0o755);
  }

  return targetPath;
}

async function ensureCodexTunnelProvisioned(options) {
  const hostname = String(options.hostname || DEFAULT_HOSTNAME).trim();
  const tunnelName = String(options.tunnelName || DEFAULT_TUNNEL_NAME).trim();
  const zoneName = resolveZoneName(hostname);
  const config = resolveCloudflareConfig(options.workspaceRoot);
  const headers = {
    Authorization: `Bearer ${config.apiToken}`,
    "Content-Type": "application/json"
  };

  const zones = await fetchCloudflare(
    `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(zoneName)}`,
    {
      headers
    }
  );
  const zoneId = zones[0] && zones[0].id ? zones[0].id : "";
  if (!zoneId) {
    throw new Error(`Cloudflare zone ${zoneName} was not found.`);
  }

  const listedTunnels = await fetchCloudflare(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/tunnels?name=${encodeURIComponent(tunnelName)}`,
    {
      headers
    }
  );

  let tunnelId = "";
  let createdTunnel = false;
  for (const item of listedTunnels) {
    if (item && item.name === tunnelName && item.id) {
      tunnelId = item.id;
      break;
    }
  }

  if (!tunnelId) {
    const secret = randomBase64Secret();
    const created = await fetchCloudflare(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/tunnels`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: tunnelName,
          tunnel_secret: secret
        })
      }
    );
    tunnelId = created.id;
    createdTunnel = true;
  }

  if (!tunnelId) {
    throw new Error(`Unable to resolve a Cloudflare tunnel id for ${tunnelName}.`);
  }

  const runToken = await fetchCloudflare(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/cfd_tunnel/${tunnelId}/token`,
    {
      headers
    }
  );

  const dnsAction = await ensureDnsRecord({
    headers,
    zoneId,
    hostname,
    target: `${tunnelId}.cfargotunnel.com`
  });

  return {
    hostname,
    publicOrigin: `https://${hostname}`,
    tunnelId,
    tunnelName,
    zoneId,
    createdTunnel,
    dnsAction,
    runToken
  };
}

async function startCodexTunnel(options) {
  const provisioned = await ensureCodexTunnelProvisioned({
    workspaceRoot: options.workspaceRoot,
    hostname: options.hostname,
    tunnelName: options.tunnelName
  });
  const executablePath = await ensureCloudflaredBinary(options.workspaceRoot);
  const args = [
    "tunnel",
    "run",
    "--token",
    provisioned.runToken,
    "--url",
    options.localUrl
  ];
  const child = spawn(executablePath, args, {
    cwd: options.workspaceRoot,
    stdio: options.stdio,
    windowsHide: true
  });

  return {
    child,
    commandLabel: `${executablePath} tunnel run --token [redacted] --url ${options.localUrl}`,
    provisioned
  };
}

function resolveCloudflareConfig(workspaceRoot) {
  const apiToken = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();

  if (apiToken && accountId) {
    return { apiToken, accountId };
  }

  const candidates = [
    path.resolve(workspaceRoot, "..", "dialtone", "env", "dialtone.json"),
    path.join(os.homedir(), "dialtone", "env", "dialtone.json")
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
    const candidateToken = String(parsed.CLOUDFLARE_API_TOKEN || "").trim();
    const candidateAccountId = String(parsed.CLOUDFLARE_ACCOUNT_ID || "").trim();

    if (candidateToken && candidateAccountId) {
      return {
        apiToken: candidateToken,
        accountId: candidateAccountId
      };
    }
  }

  throw new Error("Cloudflare credentials were not found in env vars or dialtone/env/dialtone.json.");
}

function resolveConfiguredCloudflared(workspaceRoot) {
  const executableName = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const candidates = [
    process.env.CODEX_CLOUDFLARED_BIN,
    process.env.DIALTONE_CLOUDFLARED_BIN,
    path.join(workspaceRoot, ".runtime", "cloudflare", executableName),
    path.join(os.homedir(), "cad-pga", ".runtime", "cloudflare", executableName),
    path.join(os.homedir(), "web-code", ".runtime", "cloudflare", executableName),
    path.join(os.homedir(), "dialtone", "env", "cloudflare", executableName),
    "cloudflared"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === "cloudflared") {
      const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
      const lookupResult = spawnSync(lookupCommand, ["cloudflared"], {
        encoding: "utf8",
        windowsHide: true
      });
      if (lookupResult.status === 0 && String(lookupResult.stdout || "").trim()) {
        return String(lookupResult.stdout || "").split(/\r?\n/)[0].trim();
      }
      continue;
    }

    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

function resolveDownloadSpec() {
  if (process.platform === "win32" && process.arch === "x64") {
    return {
      fileName: "cloudflared.exe",
      url: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    };
  }

  if (process.platform === "linux" && process.arch === "x64") {
    return {
      fileName: "cloudflared",
      url: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
    };
  }

  throw new Error(`Automatic cloudflared install is not configured for ${process.platform}/${process.arch}. Set CODEX_CLOUDFLARED_BIN.`);
}

async function downloadCloudflared(url, destinationPath) {
  await new Promise((resolvePromise, rejectPromise) => {
    const file = fs.createWriteStream(destinationPath);
    const handleResponse = (response) => {
      const statusCode = response.statusCode || 0;

      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        file.close();
        void downloadCloudflared(response.headers.location, destinationPath).then(resolvePromise, rejectPromise);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        file.close();
        rejectPromise(new Error(`cloudflared download failed with status ${statusCode}.`));
        return;
      }

      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolvePromise();
      });
    };

    get(url, handleResponse).on("error", (error) => {
      file.close();
      rejectPromise(error);
    });
  });
}

async function fetchCloudflare(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json();

  if (!response.ok || !payload.success) {
    const message =
      (payload.errors && payload.errors[0] && payload.errors[0].message) ||
      `Cloudflare request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return payload.result;
}

async function ensureDnsRecord(options) {
  const existing = await fetchCloudflare(
    `https://api.cloudflare.com/client/v4/zones/${options.zoneId}/dns_records?name=${encodeURIComponent(options.hostname)}`,
    {
      headers: options.headers
    }
  );

  if (existing.length > 0) {
    const sameRecord = existing.find(
      (record) =>
        record &&
        record.type === "CNAME" &&
        record.name === options.hostname &&
        record.content === options.target &&
        record.proxied === true
    );

    if (sameRecord) {
      return "unchanged";
    }

    const exactRecord = existing[0];
    if (exactRecord.type !== "CNAME") {
      throw new Error(`Existing exact DNS record for ${options.hostname} is type ${exactRecord.type}, not CNAME.`);
    }

    await fetchCloudflare(
      `https://api.cloudflare.com/client/v4/zones/${options.zoneId}/dns_records/${exactRecord.id}`,
      {
        method: "PUT",
        headers: options.headers,
        body: JSON.stringify({
          type: "CNAME",
          name: options.hostname,
          content: options.target,
          proxied: true,
          ttl: 1
        })
      }
    );

    return "updated";
  }

  await fetchCloudflare(
    `https://api.cloudflare.com/client/v4/zones/${options.zoneId}/dns_records`,
    {
      method: "POST",
      headers: options.headers,
      body: JSON.stringify({
        type: "CNAME",
        name: options.hostname,
        content: options.target,
        proxied: true,
        ttl: 1
      })
    }
  );

  return "created";
}

function resolveZoneName(hostname) {
  if (hostname.endsWith(`.${DEFAULT_ZONE}`)) {
    return DEFAULT_ZONE;
  }

  const parts = hostname.split(".");
  parts.shift();
  return parts.join(".");
}

function randomBase64Secret() {
  return require("crypto").randomBytes(32).toString("base64");
}

module.exports = {
  DEFAULT_HOSTNAME,
  DEFAULT_TUNNEL_NAME,
  ensureCloudflaredBinary,
  ensureCodexTunnelProvisioned,
  startCodexTunnel
};
