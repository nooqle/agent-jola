import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInitialMatchState, type DecisionLogEntry } from "@agent-poppy/core";
import { createStrategyVersion } from "@agent-poppy/strategy";
import { ReplayRecorder, readDecisionLogFile, readReplayFile, writeDecisionLogFile, writeReplayFile } from "./index.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("replay recorder", () => {
  it("serializes replay frames and JSONL decision entries", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agent-poppy-replay-"));
    const state = createInitialMatchState({
      matchId: "match-1",
      seed: "seed-1",
      agents: [{ id: "agent-1", name: "Alpha" }, { id: "agent-2", name: "Beta" }],
    });
    const strategy = createStrategyVersion("agent-1", "保守生存", 1, "2026-05-17T00:00:00.000Z");
    const recorder = new ReplayRecorder({
      matchId: "match-1",
      seed: "seed-1",
      participants: [{ agentId: "agent-1", name: "Alpha", strategyVersionId: strategy.id }],
      strategies: [strategy],
      initialState: state,
    });
    recorder.appendFrame(1, state, [{ type: "tick", tick: 1 }]);
    const decision: DecisionLogEntry = {
      matchId: "match-1",
      tick: 1,
      agentId: "agent-1",
      strategyVersionId: strategy.id,
      action: { agentId: "agent-1", type: "wait" },
      reason: "safe route",
      risk: "low",
    };
    recorder.appendDecision(decision);
    const replay = recorder.finish({
      id: "match-1",
      seed: "seed-1",
      mapId: "classic",
      status: "finished",
      createdAt: "2026-05-17T00:00:00.000Z",
      durationTicks: 1,
      participants: [{ agentId: "agent-1", name: "Alpha", survived: true, score: 0, strategyVersionId: strategy.id }],
    });

    const replayPath = join(tempDir, "replay.json");
    const decisionPath = join(tempDir, "decisions.jsonl");
    await writeReplayFile(replayPath, replay);
    await writeDecisionLogFile(decisionPath, replay.decisions);

    const savedReplay = await readReplayFile(replayPath);
    const decisions = await readDecisionLogFile(decisionPath);

    expect(savedReplay.engineVersion).toBe(state.engineVersion);
    expect(savedReplay.rulesVersion).toBe(state.rulesVersion);
    expect(savedReplay.frames).toHaveLength(1);
    expect(savedReplay.record?.durationTicks).toBe(1);
    expect(decisions[0]?.reason).toBe("safe route");
  });
});
