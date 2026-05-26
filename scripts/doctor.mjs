import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const checks = [];

function check(name, ok, details = "", optional = false) {
  checks.push({ name, ok, details, optional });
}

function optionalCheck(name, ok, details = "") {
  check(name, ok, details, true);
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
}

function semverMajor(version) {
  const match = version.match(/v?(\d+)/);
  return match ? Number(match[1]) : 0;
}

const nodeVersion = process.version;
check("Node.js >= 22", semverMajor(nodeVersion) >= 22, nodeVersion);

const pnpm = run("pnpm", ["--version"]);
check(
  "pnpm is available",
  pnpm.status === 0,
  pnpm.status === 0 ? pnpm.stdout.trim() : "Install pnpm before running the workspace."
);
const docker = run("docker", ["--version"]);
optionalCheck(
  "Docker CLI",
  docker.status === 0,
  docker.status === 0 ? docker.stdout.trim() : "Install Docker Desktop to use docker compose."
);
const dockerCompose = run("docker", ["compose", "version"]);
optionalCheck(
  "Docker Compose",
  dockerCompose.status === 0,
  dockerCompose.status === 0 ? dockerCompose.stdout.trim() : "Required only for Docker startup."
);
check("workspace dependencies installed", existsSync(join(rootDir, "node_modules")));

const requiredFiles = [
  "pnpm-workspace.yaml",
  "package.json",
  "apps/web/package.json",
  "apps/server/package.json",
  "apps/local-agent/package.json",
  "packages/core/package.json",
  "packages/agent/package.json",
  "packages/strategy/package.json",
  "packages/protocol/package.json",
  "packages/replay/package.json"
];

for (const file of requiredFiles) {
  check(file, existsSync(join(rootDir, file)));
}

const rootPackagePath = join(rootDir, "package.json");
if (existsSync(rootPackagePath)) {
  const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
  for (const scriptName of ["dev", "build", "test", "lint", "agent:mock", "agent:templates"]) {
    check(`script: ${scriptName}`, Boolean(rootPackage.scripts?.[scriptName]));
  }
}

check(
  ".env.example",
  existsSync(join(rootDir, ".env.example")),
  "Copy to .env if you want local overrides."
);

const failed = checks.filter((item) => !item.ok && !item.optional);
for (const item of checks) {
  const marker = item.ok ? "[ok]" : item.optional ? "[optional]" : "[missing]";
  const details = item.details ? ` - ${item.details}` : "";
  console.log(`${marker} ${item.name}${details}`);
}

console.log("");
if (failed.length > 0) {
  console.log(`Doctor found ${failed.length} issue(s). Fix them before starting AgentPoppy.`);
  process.exitCode = 1;
} else {
  console.log("AgentPoppy local workspace looks ready.");
  console.log("");
  console.log("Next commands:");
  console.log("  pnpm dev");
  console.log("  pnpm agent:templates");
  console.log("  pnpm agent:template prompt zoneHunter --agent Ember");
}
