import { describe, expect, it } from "vitest";
import { runBenchmark, type CliOptions } from "../cli.js";

describe("royale simulation stability", () => {
  it(
    "finishes a deterministic royale batch without safety stops or self-elimination spikes",
    () => {
      const options: CliOptions = {
        seed: "sim-stability-regression",
        count: 8,
        maxTicks: 1600,
        agents: 4,
        mapId: "royale",
        assertState: true,
      };

      const report = runBenchmark(options);

      expect(report.safetyStops).toBe(0);
      expect(report.finishReasons.elimination).toBe(options.count);
      expect(report.rates.selfEliminationsPerMatch).toBeLessThanOrEqual(0.25);
      expect(report.rates.waitActionRate).toBeLessThan(0.75);
    },
    20_000,
  );
});
