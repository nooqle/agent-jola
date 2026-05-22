import { describe, expect, it } from "vitest";
import { createMockReplay, createMockState } from "./mockData";

describe("web mock data", () => {
  it("creates a replay with ordered frames and evidence events", () => {
    const replay = createMockReplay("test-match");

    expect(replay.frames.length).toBeGreaterThan(5);
    expect(replay.frames[0]?.tick).toBe(0);
    expect(replay.frames.at(-1)?.tick).toBeGreaterThan(replay.frames[0]!.tick);
    expect(replay.summaryEvents.some((event) => event.type === "wall_destroyed")).toBe(true);
  });

  it("marks the mock match finished after the final window", () => {
    const state = createMockState("test-match", 260);

    expect(state.status).toBe("finished");
    expect(state.winnerAgentId).toBe("agent-ember");
  });

  it("keeps selected mock map ids through state and replay frames", () => {
    const state = createMockState("test-match", 0, "maze");
    const replay = createMockReplay("test-match", "open-court");

    expect(state.mapId).toBe("maze");
    expect(state.map.id).toBe("maze");
    expect(replay.frames[0]?.state.mapId).toBe("open-court");
  });
});
