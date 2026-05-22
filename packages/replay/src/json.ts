import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DecisionLogEntry } from "@agent-bomber/core";
import type { ReplayFile } from "./types.js";

export function serializeReplay(replay: ReplayFile): string {
  return `${JSON.stringify(replay, null, 2)}\n`;
}

export function parseReplay(source: string): ReplayFile {
  const parsed = JSON.parse(source) as ReplayFile;
  if (parsed.version !== 1 || typeof parsed.matchId !== "string") {
    throw new Error("Invalid replay file");
  }
  return parsed;
}

export function serializeDecisionLog(decisions: readonly DecisionLogEntry[]): string {
  return decisions.map((decision) => JSON.stringify(decision)).join("\n") + (decisions.length > 0 ? "\n" : "");
}

export function parseDecisionLog(source: string): DecisionLogEntry[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DecisionLogEntry);
}

export async function writeReplayFile(path: string, replay: ReplayFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeReplay(replay), "utf8");
}

export async function readReplayFile(path: string): Promise<ReplayFile> {
  return parseReplay(await readFile(path, "utf8"));
}

export async function writeDecisionLogFile(path: string, decisions: readonly DecisionLogEntry[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeDecisionLog(decisions), "utf8");
}

export async function readDecisionLogFile(path: string): Promise<DecisionLogEntry[]> {
  return parseDecisionLog(await readFile(path, "utf8"));
}
