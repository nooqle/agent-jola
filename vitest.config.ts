import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@agent-poppy/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      "@agent-poppy/strategy": fileURLToPath(new URL("./packages/strategy/src/index.ts", import.meta.url)),
      "@agent-poppy/agent": fileURLToPath(new URL("./packages/agent/src/index.ts", import.meta.url)),
      "@agent-poppy/replay": fileURLToPath(new URL("./packages/replay/src/index.ts", import.meta.url)),
      "@agent-poppy/protocol": fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "apps/**/*.test.tsx"],
    passWithNoTests: true,
  },
});
