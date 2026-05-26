import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentPoppyClient,
  DEFAULT_BASE_URL,
  DEFAULT_LOCAL_PRODUCT_API_KEY,
  envValue,
} from "./client.js";

const rootDir = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const localEnvPath = resolve(rootDir, ".env.local");
const managedStart = "# >>> AgentPoppy local settings";
const managedEnd = "# <<< AgentPoppy local settings";

const argv = process.argv.slice(2);
const command = argv[0] ?? "status";

switch (command) {
  case "status":
  case "check":
    await showStatus(command === "check");
    break;
  case "sync":
    await syncProfile();
    break;
  case "write":
  case "init":
    await writeSettings();
    break;
  default:
    printUsage();
    process.exitCode = 1;
}

async function showStatus(strict: boolean): Promise<void> {
  const baseUrl =
    optionValue("--base-url") ??
    envValue("AGENT_POPPY_BASE_URL", DEFAULT_BASE_URL);
  const cloudUrl =
    optionValue("--cloud-url") ??
    envValue("AGENT_POPPY_CLOUD_BASE_URL", baseUrl);
  const apiKey =
    optionValue("--api-key") ??
    envValue("AGENT_POPPY_API_KEY", DEFAULT_LOCAL_PRODUCT_API_KEY);
  const provider = envValue("AGENT_POPPY_PROVIDER", "mock");
  const agentName = envValue("AGENT_POPPY_AGENT_NAME", "Local Agent");

  console.log("AgentPoppy local settings");
  console.log(`- Base URL: ${baseUrl}`);
  console.log(`- Cloud URL: ${cloudUrl}`);
  console.log(`- Product key: ${mask(apiKey)}`);
  console.log(`- Agent name: ${agentName}`);
  console.log(`- Provider: ${provider}`);
  console.log(`- OpenAI key: ${envValue("OPENAI_API_KEY") ? "configured" : "not configured"}`);
  console.log(`- Anthropic key: ${envValue("ANTHROPIC_API_KEY") ? "configured" : "not configured"}`);
  console.log(`- Local env file: ${existsSync(localEnvPath) ? ".env.local found" : ".env.local missing"}`);

  const client = new AgentPoppyClient({ baseUrl, apiKey });
  try {
    const me = await client.me();
    const profile = await client.profile();
    console.log(`- Server: connected as ${me.user.handle} (${me.user.mode})`);
    console.log(`- Scopes: ${me.user.scopes.join(", ")}`);
    console.log(`- Profile Agent: ${profile.agent ? `${profile.agent.name} (${profile.agent.id})` : "not created"}`);
    const quotas = Array.isArray(me.quotas)
      ? me.quotas
          .map((quota) =>
            quota.limit === null
              ? `${quota.key}=unlimited`
              : `${quota.key}=${quota.remaining}/${quota.limit}`,
          )
          .join(", ")
      : "not reported by this server";
    console.log(`- Quotas: ${quotas}`);
  } catch (error) {
    console.error(`- Server: not ready (${errorMessage(error)})`);
    if (strict) {
      process.exitCode = 1;
    }
  }
}

async function syncProfile(): Promise<void> {
  const localBaseUrl =
    optionValue("--base-url") ??
    envValue("AGENT_POPPY_BASE_URL", DEFAULT_BASE_URL);
  const cloudBaseUrl =
    optionValue("--cloud-url") ??
    envValue("AGENT_POPPY_CLOUD_BASE_URL", localBaseUrl);
  const apiKey =
    optionValue("--api-key") ??
    envValue("AGENT_POPPY_API_KEY", DEFAULT_LOCAL_PRODUCT_API_KEY);
  const localApiKey =
    optionValue("--local-api-key") ??
    envValue("AGENT_POPPY_LOCAL_API_KEY", apiKey);

  const cloudClient = new AgentPoppyClient({ baseUrl: cloudBaseUrl, apiKey });
  const localClient = new AgentPoppyClient({ baseUrl: localBaseUrl, apiKey: localApiKey });
  const runtimeProfile = await cloudClient.runtimeProfile();
  const agent = await localClient.upsertProfileAgent({
    name: runtimeProfile.profile.agentName,
    appearance: runtimeProfile.profile.appearance,
    strategyText: runtimeProfile.profile.strategyText,
  });

  console.log(`Synced hosted profile ${runtimeProfile.profile.agentName} into local runtime.`);
  console.log(`- Hosted user: ${runtimeProfile.user.handle}`);
  console.log(`- Local Agent: ${agent.name} (${agent.id})`);
  console.log(`- Skin: ${agent.appearance.skinId}`);
}

async function writeSettings(): Promise<void> {
  const nonInteractive = argv.some((arg) => arg === "--yes" || arg === "-y");
  const answers = nonInteractive ? undefined : createInterface({ input, output });
  try {
    const baseUrl = await valueFromOptionOrPrompt(
      answers,
      "--base-url",
      "AgentPoppy server URL",
      envValue("AGENT_POPPY_BASE_URL", DEFAULT_BASE_URL),
    );
    const cloudUrl = await valueFromOptionOrPrompt(
      answers,
      "--cloud-url",
      "AgentPoppy cloud API URL",
      envValue("AGENT_POPPY_CLOUD_BASE_URL", baseUrl),
    );
    const apiKey = await valueFromOptionOrPrompt(
      answers,
      "--api-key",
      "AgentPoppy Product API key",
      envValue("AGENT_POPPY_API_KEY", DEFAULT_LOCAL_PRODUCT_API_KEY),
    );
    const agentName = await valueFromOptionOrPrompt(
      answers,
      "--agent",
      "Local Agent name",
      envValue("AGENT_POPPY_AGENT_NAME", "Local Agent"),
    );
    const provider = await valueFromOptionOrPrompt(
      answers,
      "--provider",
      "Provider (mock/openai/anthropic)",
      envValue("AGENT_POPPY_PROVIDER", "mock"),
    );

    const values: Record<string, string> = {
      AGENT_POPPY_BASE_URL: baseUrl,
      AGENT_POPPY_CLOUD_BASE_URL: cloudUrl,
      AGENT_POPPY_API_KEY: apiKey,
      AGENT_POPPY_AGENT_NAME: agentName,
      AGENT_POPPY_PROVIDER: normalizeProvider(provider),
    };

    if (values.AGENT_POPPY_PROVIDER === "openai") {
      values.OPENAI_MODEL = await valueFromOptionOrPrompt(
        answers,
        "--model",
        "OpenAI model",
        envValue("OPENAI_MODEL", "gpt-4.1"),
      );
      const openAiKey = optionValue("--openai-key") ?? envValue("OPENAI_API_KEY");
      if (openAiKey) {
        values.OPENAI_API_KEY = openAiKey;
      }
    }

    if (values.AGENT_POPPY_PROVIDER === "anthropic") {
      values.ANTHROPIC_MODEL = await valueFromOptionOrPrompt(
        answers,
        "--model",
        "Anthropic model",
        envValue("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
      );
      const anthropicKey = optionValue("--anthropic-key") ?? envValue("ANTHROPIC_API_KEY");
      if (anthropicKey) {
        values.ANTHROPIC_API_KEY = anthropicKey;
      }
    }

    await upsertManagedEnvBlock(values);
    console.log(`Wrote AgentPoppy settings to ${localEnvPath}`);
    await showStatus(false);
  } finally {
    answers?.close();
  }
}

async function valueFromOptionOrPrompt(
  answers: ReturnType<typeof createInterface> | undefined,
  flag: string,
  label: string,
  fallback: string,
): Promise<string> {
  const configured = optionValue(flag);
  if (configured !== undefined) {
    return configured;
  }
  if (!answers) {
    return fallback;
  }
  const raw = await answers.question(`${label} [${fallback}]: `);
  return raw.trim() || fallback;
}

async function upsertManagedEnvBlock(values: Record<string, string>): Promise<void> {
  const existing = existsSync(localEnvPath) ? await readFile(localEnvPath, "utf8") : "";
  const withoutManaged = removeManagedBlock(existing).trimEnd();
  const block = [
    managedStart,
    ...Object.entries(values).map(([key, value]) => `${key}=${quoteEnv(value)}`),
    managedEnd,
  ].join("\n");
  const next = withoutManaged ? `${withoutManaged}\n\n${block}\n` : `${block}\n`;
  await writeFile(localEnvPath, next, "utf8");
}

function removeManagedBlock(value: string): string {
  return removeBlock(value, managedStart, managedEnd);
}

function removeBlock(value: string, startMarker: string, endMarker: string): string {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    return value;
  }
  return `${value.slice(0, start)}${value.slice(end + endMarker.length)}`;
}

function optionValue(flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : "";
}

function normalizeProvider(provider: string): "mock" | "openai" | "anthropic" {
  const normalized = provider.trim().toLowerCase();
  return normalized === "openai" || normalized === "anthropic" ? normalized : "mock";
}

function quoteEnv(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function mask(value: string): string {
  if (value.length <= 8) {
    return "***";
  }
  return `${value.slice(0, 5)}...${value.slice(-4)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printUsage(): void {
  console.log(`Usage:
  pnpm agent:setting status
  pnpm agent:setting check
  pnpm agent:setting sync
  pnpm agent:setting init
  pnpm agent:setting write --yes --cloud-url https://agentpoppy.example.com --api-key <key> --provider mock --agent Poppy
  pnpm agent:setting write --yes --provider openai --openai-key <key> --model gpt-4.1
`);
}
