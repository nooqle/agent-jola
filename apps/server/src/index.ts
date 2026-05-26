import "./load-env.js";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { MatchRuntimeManager } from "./runtime.js";
import { Storage } from "./storage.js";

const rootDir = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const dataDir = resolveRootPath(process.env.AGENT_POPPY_DATA_DIR, resolve(rootDir, "data"));
const webDistDir = resolveRootPath(
  process.env.AGENT_POPPY_WEB_DIST,
  resolve(rootDir, "apps", "web", "dist")
);
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

const storage = new Storage(dataDir);
await storage.init();
const runtime = new MatchRuntimeManager(storage);
const app = await buildApp({ storage, runtime, webDistDir });

const close = async (): Promise<void> => {
  await app.close();
  storage.close();
};

process.on("SIGINT", () => {
  void close().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void close().then(() => process.exit(0));
});

await app.listen({ port, host });

function resolveRootPath(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }
  return isAbsolute(trimmed) ? trimmed : resolve(rootDir, trimmed);
}
