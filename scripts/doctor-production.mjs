import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFile(join(rootDir, ".env.production"));
if (process.env.AGENT_JOLA_DOCTOR_INCLUDE_LOCAL_ENV === "true") {
  loadEnvFile(join(rootDir, ".env"));
}

const checks = [];

function check(name, ok, details = "", optional = false) {
  checks.push({ name, ok, details, optional });
}

function optionalCheck(name, ok, details = "") {
  check(name, ok, details, true);
}

const publicBaseUrl = env("AGENT_JOLA_PUBLIC_API_BASE_URL");
const redirectUri = env("AGENT_JOLA_GOOGLE_REDIRECT_URI");
const corsOrigins = env("AGENT_JOLA_CORS_ORIGINS");
const issuerSecret = env("AGENT_JOLA_KEY_ISSUER_SECRET");

check("AGENT_JOLA_PUBLIC_API_BASE_URL", isHttpsAgentJolaUrl(publicBaseUrl), "Use https://agentjola.tech");
check("AGENT_JOLA_GOOGLE_CLIENT_ID", Boolean(env("AGENT_JOLA_GOOGLE_CLIENT_ID")));
check("AGENT_JOLA_GOOGLE_CLIENT_SECRET", Boolean(env("AGENT_JOLA_GOOGLE_CLIENT_SECRET")));
check(
  "AGENT_JOLA_GOOGLE_REDIRECT_URI",
  redirectUri === `${publicBaseUrl.replace(/\/$/, "")}/api/auth/google/callback`,
  "Must exactly match the Google Console authorized redirect URI."
);
check(
  "AGENT_JOLA_KEY_ISSUER_SECRET",
  issuerSecret.length >= 32 && !/replace|local|test|secret/i.test(issuerSecret),
  "Use a long random production-only secret."
);
check(
  "AGENT_JOLA_CORS_ORIGINS",
  corsOrigins
    .split(",")
    .map((origin) => origin.trim())
    .includes("https://agentjola.tech"),
  "Must include https://agentjola.tech."
);
check(
  "dev-login disabled",
  env("AGENT_JOLA_ENABLE_DEV_PORTAL_LOGIN") !== "true",
  "Do not enable dev-login in production."
);
check(
  "local default product key not configured",
  env("AGENT_JOLA_API_KEY") !== "agent-jola-local-dev-key",
  "Production must not accept the local default product API key."
);
optionalCheck("AGENT_JOLA_ADMIN_KEY", env("AGENT_JOLA_ADMIN_KEY").length >= 24, "Recommended for admin-only key tools.");
optionalCheck(".env.production", existsSync(join(rootDir, ".env.production")), "Can also be provided by host environment.");

const failed = checks.filter((item) => !item.ok && !item.optional);
for (const item of checks) {
  const marker = item.ok ? "[ok]" : item.optional ? "[optional]" : "[missing]";
  const details = item.details ? ` - ${item.details}` : "";
  console.log(`${marker} ${item.name}${details}`);
}

console.log("");
if (failed.length > 0) {
  console.log(`Production doctor found ${failed.length} blocking issue(s).`);
  process.exitCode = 1;
} else {
  console.log("Agent Jola production configuration is ready for an agentjola.tech smoke test.");
}

function env(name) {
  return process.env[name]?.trim() ?? "";
}

function isHttpsAgentJolaUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "agentjola.tech" || url.hostname === "www.agentjola.tech")
    );
  } catch {
    return false;
  }
}

function loadEnvFile(path) {
  if (!existsSync(path)) {
    return;
  }
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index < 0) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
