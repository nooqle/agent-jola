import { describe, expect, it } from "vitest";
import { createInitialMatchState } from "@agent-bomber/core";
import { buildDangerWindows, dangerAt } from "../danger.js";

describe("danger windows", () => {
  it("propagates earlier explosion ticks through chained bubbles", () => {
    const state = createInitialMatchState({
      matchId: "danger-chain",
      seed: "danger-chain",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    openInterior(state);
    state.tick = 100;
    state.bubbles = [
      {
        id: "early",
        ownerId: "a2",
        x: 5,
        y: 5,
        placedAtTick: 90,
        explodeAtTick: 110,
        range: 2,
        ownerCanPass: false,
        pierce: 0,
        quickFuse: false,
      },
      {
        id: "late",
        ownerId: "a1",
        x: 7,
        y: 5,
        placedAtTick: 95,
        explodeAtTick: 120,
        range: 2,
        ownerCanPass: false,
        pierce: 0,
        quickFuse: false,
      },
    ];

    const windows = buildDangerWindows(state);

    expect(
      windows.some(
        (window) =>
          window.sourceId === "late" && window.position.x === 7 && window.position.y === 5 && window.startsAtTick === 110,
      ),
    ).toBe(true);
    expect(dangerAt(windows, { x: 7, y: 5 }, 119)).toBeUndefined();
  });
});

function openInterior(state: ReturnType<typeof createInitialMatchState>): void {
  for (let y = 1; y < state.map.height - 1; y += 1) {
    for (let x = 1; x < state.map.width - 1; x += 1) {
      state.map.cells[y * state.map.width + x] = "empty";
    }
  }
}
