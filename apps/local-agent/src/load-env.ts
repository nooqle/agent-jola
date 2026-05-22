import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const inheritedEnv = new Set(Object.keys(process.env));

loadEnvFile(resolve(rootDir, ".env"), false);
loadEnvFile(resolve(rootDir, ".env.local"), true);

function loadEnvFile(path: string, overrideLocalFileValues: boolean): void {
  if (!existsSync(path)) {
    return;
  }
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = stripQuotes(trimmed.slice(separator + 1).trim());
    if (inheritedEnv.has(key)) {
      continue;
    }
    if (overrideLocalFileValues || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
