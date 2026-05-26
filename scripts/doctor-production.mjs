import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFile(join(rootDir, ".env.production"));
if (
  process.env.AGENT_POPPY_DOCTOR_INCLUDE_LOCAL_ENV === "true"
) {
  loadEnvFile(join(rootDir, ".env"));
}

const checks = [];

function check(name, ok, details = "", optional = false) {
  checks.push({ name, ok, details, optional });
}

function optionalCheck(name, ok, details = "") {
  check(name, ok, details, true);
}

const publicBaseUrl = envValue("AGENT_POPPY_PUBLIC_API_BASE_URL");
const redirectUri = envValue("AGENT_POPPY_GOOGLE_REDIRECT_URI");
const corsOrigins = envValue("AGENT_POPPY_CORS_ORIGINS");
const issuerSecret = envValue("AGENT_POPPY_KEY_ISSUER_SECRET");
const configuredApiKey = envValue("AGENT_POPPY_API_KEY");
const publicOrigin = originOf(publicBaseUrl);

check(
  "AGENT_POPPY_PUBLIC_API_BASE_URL",
  isProductionHttpsUrl(publicBaseUrl),
  "Use the real https:// production origin, not localhost or *.example.com."
);
check("AGENT_POPPY_GOOGLE_CLIENT_ID", Boolean(envValue("AGENT_POPPY_GOOGLE_CLIENT_ID")));
check(
  "AGENT_POPPY_GOOGLE_CLIENT_SECRET",
  Boolean(envValue("AGENT_POPPY_GOOGLE_CLIENT_SECRET"))
);
check(
  "AGENT_POPPY_GOOGLE_REDIRECT_URI",
  Boolean(publicBaseUrl) && redirectUri === `${publicBaseUrl.replace(/\/$/, "")}/api/auth/google/callback`,
  "Must exactly match the Google Console authorized redirect URI."
);
check(
  "AGENT_POPPY_KEY_ISSUER_SECRET",
  issuerSecret.length >= 32 && !/replace|local|test|secret/i.test(issuerSecret),
  "Use a long random production-only secret."
);
check(
  "AGENT_POPPY_CORS_ORIGINS",
  Boolean(publicOrigin) &&
    corsOrigins
      .split(",")
      .map((origin) => origin.trim())
      .includes(publicOrigin),
  "Must include the public production origin."
);
check(
  "dev-login disabled",
  envValue("AGENT_POPPY_ENABLE_DEV_PORTAL_LOGIN") !== "true",
  "Do not enable dev-login in production."
);
check(
  "local default product key not configured",
  configuredApiKey !== "agent-poppy-local-dev-key",
  "Production must not accept a local default Product API key."
);
optionalCheck(
  "AGENT_POPPY_ADMIN_KEY",
  envValue("AGENT_POPPY_ADMIN_KEY").length >= 24,
  "Recommended for admin-only key tools."
);
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
  console.log("AgentPoppy production configuration is ready for a smoke test.");
}

function envValue(name) {
  return process.env[name]?.trim() || "";
}

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function isProductionHttpsUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
      !url.hostname.endsWith(".example.com")
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
