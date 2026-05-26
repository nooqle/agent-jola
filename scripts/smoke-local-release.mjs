import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = resolve(rootDir, "apps/server/dist/index.js");
const webIndex = resolve(rootDir, "apps/web/dist/index.html");
const dataDir = resolve(rootDir, ".tmp-smoke-release-data");

if (!existsSync(serverEntry) || !existsSync(webIndex)) {
  console.error("Release smoke requires built artifacts. Run: pnpm build");
  process.exit(1);
}

const port = await freePort(Number(process.env.AGENT_POPPY_SMOKE_PORT ?? 3011));
const baseUrl = `http://127.0.0.1:${port}`;
const adminKey = "agent-poppy-local-admin-key";

await rm(dataDir, { recursive: true, force: true });

const child = spawn(process.execPath, [serverEntry], {
  cwd: rootDir,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    AGENT_POPPY_DATA_DIR: dataDir,
    AGENT_POPPY_WEB_DIST: "apps/web/dist",
    AGENT_POPPY_API_KEY: "agent-poppy-local-dev-key",
    AGENT_POPPY_ADMIN_KEY: adminKey,
    AGENT_POPPY_KEY_ISSUER_SECRET: "agent-poppy-local-smoke-issuer-secret",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  await waitForHealth(`${baseUrl}/health`);

  const home = await fetch(baseUrl);
  assert(home.ok, `GET / expected 200, got ${home.status}`);
  assert((await home.text()).includes("<!doctype html>"), "GET / did not return built web HTML");

  const issued = await postJson(`${baseUrl}/api/admin/product-keys`, {
    headers: { "x-agent-poppy-admin-key": adminKey },
    body: { handle: "smoke-local-agent", scopes: ["profile:read", "templates:read"], ttlSeconds: 3600 },
  });
  assert(typeof issued.id === "string" && issued.id.startsWith("key_"), "issued key id is missing");
  assert(typeof issued.key === "string" && issued.key.startsWith("ap_issued_"), "issued key is missing");

  const me = await getJson(`${baseUrl}/api/me`, { headers: { "x-agent-poppy-key": issued.key } });
  assert(me.user?.handle === "smoke-local-agent", "issued key could not authenticate /api/me");

  await postJson(`${baseUrl}/api/admin/product-keys/${issued.id}/revoke`, {
    headers: { "x-agent-poppy-admin-key": adminKey },
    body: {},
  });
  const revoked = await fetch(`${baseUrl}/api/me`, { headers: { "x-agent-poppy-key": issued.key } });
  assert(revoked.status === 401, `revoked key expected 401, got ${revoked.status}`);

  console.log(`Release smoke passed: ${baseUrl}`);
} catch (error) {
  console.error("Release smoke failed.");
  if (output.trim()) {
    console.error(output.trim());
  }
  throw error;
} finally {
  child.kill("SIGTERM");
  await waitForExit(child);
  await rm(dataDir, { recursive: true, force: true });
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

async function waitForHealth(url) {
  const deadline = Date.now() + 15_000;
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

async function getJson(url, options = {}) {
  const response = await fetch(url, options);
  assert(response.ok, `${url} expected 2xx, got ${response.status}`);
  return response.json();
}

async function postJson(url, options) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    body: JSON.stringify(options.body ?? {}),
  });
  assert(response.ok, `${url} expected 2xx, got ${response.status}`);
  return response.json();
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
