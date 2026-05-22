import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = join(tmpdir(), `agent-jola-install-smoke-${Date.now()}`);
const installedRoot = join(tempRoot, "agent-jola");
const dataDir = join(tempRoot, "data");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const apiKeyIssuerSecret = "agent-jola-install-smoke-issuer-secret";

await rm(tempRoot, { recursive: true, force: true });
await mkdir(tempRoot, { recursive: true });

try {
  await copyInstallSource(rootDir, installedRoot);
  await installDependencies(installedRoot);
  await run(pnpm, ["build"], { cwd: installedRoot });

  const port = await freePort(Number(process.env.AGENT_JOLA_INSTALL_SMOKE_PORT ?? 3021));
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverEntry = join(installedRoot, "apps/server/dist/index.js");
  const server = spawn(process.execPath, [serverEntry], {
    cwd: installedRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      AGENT_BOMBER_DATA_DIR: dataDir,
      AGENT_JOLA_WEB_DIST: "apps/web/dist",
      AGENT_JOLA_KEY_ISSUER_SECRET: apiKeyIssuerSecret,
      AGENT_JOLA_ENABLE_DEV_PORTAL_LOGIN: "true",
      AGENT_JOLA_PUBLIC_API_BASE_URL: baseUrl,
      AGENT_JOLA_CORS_ORIGINS: baseUrl
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const serverOutput = collectOutput(server);

  try {
    await waitForHealth(`${baseUrl}/health`);
    const portal = await postJson(`${baseUrl}/api/portal/dev-login`, {
      body: {
        email: "install-smoke@example.com",
        displayName: "Install Smoke"
      }
    });
    assert(typeof portal.portalToken === "string", "dev portal login did not return a portal token");
    const portalHeaders = { "x-agent-jola-portal-token": portal.portalToken };

    await putJson(`${baseUrl}/api/portal/profile`, {
      headers: portalHeaders,
      body: {
        agentName: "InstallSmoke",
        appearance: { color: "#38bdf8", accessory: "none", skinId: "chameleon-101" },
        strategyText: "先进安全区，拿到道具后再靠近最近对手。"
      }
    });

    const issued = await postJson(`${baseUrl}/api/portal/product-keys`, {
      headers: portalHeaders,
      body: {
        handle: "install-smoke-runtime",
        provider: "mock",
        localBaseUrl: baseUrl
      }
    });
    assert(typeof issued.key === "string" && issued.key.startsWith("ap_issued_"), "portal key was not issued");

    await run(
      pnpm,
      [
        "agent:setting",
        "write",
        "--yes",
        "--base-url",
        baseUrl,
        "--cloud-url",
        baseUrl,
        "--api-key",
        issued.key,
        "--provider",
        "mock",
        "--agent",
        "InstallSmoke"
      ],
      { cwd: installedRoot, redact: [issued.key] }
    );
    await run(pnpm, ["agent:setting", "sync"], { cwd: installedRoot, redact: [issued.key] });
    await run(pnpm, ["agent:setting", "check"], { cwd: installedRoot, redact: [issued.key] });

    const me = await getJson(`${baseUrl}/api/me`, { headers: { "x-agent-jola-key": issued.key } });
    assert(me.user?.handle === issued.user?.handle, "issued key could not authenticate local runtime");
    const profile = await getJson(`${baseUrl}/api/profile`, { headers: { "x-agent-jola-key": issued.key } });
    assert(profile.agent?.name === "InstallSmoke", "synced local Agent was not created");
    const room = await postJson(`${baseUrl}/api/rooms`, {
      headers: { "x-agent-jola-key": issued.key },
      body: { hostAgentId: profile.agent.id, mapId: "royale" }
    });
    assert(typeof room.inviteCode === "string" && room.inviteCode.startsWith("AP-"), "room invite code missing");

    console.log(`Install smoke passed: ${baseUrl}`);
  } catch (error) {
    if (serverOutput.text().trim()) {
      console.error(serverOutput.text().trim());
    }
    throw error;
  } finally {
    server.kill("SIGTERM");
    await waitForExit(server);
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function copyInstallSource(source, target) {
  await cp(source, target, {
    recursive: true,
    filter: (path) => {
      const name = basename(path);
      if (
        name === "node_modules" ||
        name === ".git" ||
        name === "data" ||
        name === ".codex" ||
        name === ".codex-artifacts" ||
        name === ".playwright-mcp" ||
        name.endsWith(".log") ||
        name.endsWith(".pid") ||
        name.startsWith(".tmp") ||
        name.startsWith("server-runtime.") ||
        name.startsWith("agent-jola-portal-redesign")
      ) {
        return false;
      }
      if (name.startsWith(".env") && name !== ".env.example" && name !== ".env.production.example") {
        return false;
      }
      if (name === "dist" && /[\\/]apps[\\/][^\\/]+[\\/]dist$/.test(path)) {
        return false;
      }
      if (/\.(png|jpg|jpeg|webp|gif)$/i.test(name) && dirname(path) === source) {
        return false;
      }
      return true;
    }
  });
}

async function installDependencies(cwd) {
  try {
    await run(pnpm, ["install", "--frozen-lockfile", "--offline"], { cwd });
  } catch {
    await run(pnpm, ["install", "--frozen-lockfile"], { cwd });
  }
}

async function getJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${url} expected 2xx, got ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function postJson(url, options) {
  return requestJson("POST", url, options);
}

async function putJson(url, options) {
  return requestJson("PUT", url, options);
}

async function requestJson(method, url, options) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    body: JSON.stringify(options.body ?? {})
  });
  if (!response.ok) {
    throw new Error(`${url} expected 2xx, got ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function waitForHealth(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function freePort(preferred) {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.listen(preferred, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePort(typeof address === "object" && address ? address.port : preferred));
    });
    server.on("error", () => {
      const fallback = createServer();
      fallback.listen(0, "127.0.0.1", () => {
        const address = fallback.address();
        fallback.close(() => resolvePort(typeof address === "object" && address ? address.port : 0));
      });
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun(output);
        return;
      }
      const commandLine = redact(`${command} ${args.join(" ")}`, options.redact);
      rejectRun(new Error(`${commandLine} failed with ${code}\n${redact(output, options.redact)}`));
    });
  });
}

function collectOutput(child) {
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  return { text: () => output };
}

async function waitForExit(process) {
  await new Promise((resolveWait) => {
    const timer = setTimeout(() => {
      process.kill("SIGKILL");
      resolveWait();
    }, 3000);
    process.once("exit", () => {
      clearTimeout(timer);
      resolveWait();
    });
  });
}

function redact(value, secrets = []) {
  return secrets.reduce((current, secret) => current.replaceAll(secret, "<redacted>"), value);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
