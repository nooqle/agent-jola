import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@agent-bomber/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      "@agent-bomber/strategy": fileURLToPath(new URL("./packages/strategy/src/index.ts", import.meta.url)),
      "@agent-bomber/agent": fileURLToPath(new URL("./packages/agent/src/index.ts", import.meta.url)),
      "@agent-bomber/replay": fileURLToPath(new URL("./packages/replay/src/index.ts", import.meta.url)),
      "@agent-bomber/protocol": fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "apps/**/*.test.tsx"],
    passWithNoTests: true,
  },
});
