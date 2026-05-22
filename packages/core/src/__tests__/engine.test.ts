import { describe, expect, it } from "vitest";
import { applyTick } from "../engine.js";
import { createInitialMatchState, defaultRules } from "../factory.js";
import { validateMatchState } from "../invariants.js";
import { createMapFromPreset, getCell, MAP_PRESETS } from "../map.js";
import type { AgentAction, MatchState } from "../types.js";
import { advanceZone, createInitialZoneState } from "../zone.js";

function makeMatch(seed = "test-seed"): MatchState {
  return createInitialMatchState({
    matchId: "match-test",
    seed,
    agents: [
      { id: "a1", name: "Alpha" },
      { id: "a2", name: "Beta" },
    ],
  });
}

describe("core engine", () => {
  it("creates selectable map presets with stable ids", () => {
    const classic = createMapFromPreset("classic");
    const openCourt = createMapFromPreset("open-court");
    const royale = createMapFromPreset("royale");
    const state = createInitialMatchState({
      matchId: "map-test",
      seed: "map-seed",
      mapId: "crossfire",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });

    expect(MAP_PRESETS.map((preset) => preset.id)).toEqual(["classic", "open-court", "crossfire", "maze", "royale"]);
    expect(state.mapId).toBe("crossfire");
    expect(state.map.id).toBe("crossfire");
    expect(royale).toMatchObject({ id: "royale", width: 39, height: 31 });
    expect(classic.cells.filter((cell) => cell === "soft")).not.toHaveLength(
      openCourt.cells.filter((cell) => cell === "soft").length,
    );
  });

  it("randomizes royale soft bricks deterministically by seed", () => {
    const first = createInitialMatchState({
      matchId: "royale-layout-a",
      seed: "layout-seed-a",
      mapId: "royale",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
        { id: "a3", name: "Gamma" },
        { id: "a4", name: "Delta" },
      ],
    });
    const repeat = createInitialMatchState({
      matchId: "royale-layout-b",
      seed: "layout-seed-a",
      mapId: "royale",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
        { id: "a3", name: "Gamma" },
        { id: "a4", name: "Delta" },
      ],
    });
    const different = createInitialMatchState({
      matchId: "royale-layout-c",
      seed: "layout-seed-c",
      mapId: "royale",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
        { id: "a3", name: "Gamma" },
        { id: "a4", name: "Delta" },
      ],
    });

    expect(first.map.cells).toEqual(repeat.map.cells);
    expect(first.map.cells).not.toEqual(different.map.cells);
    expect(first.map.cells.filter((cell) => cell === "soft").length).toBeGreaterThan(190);
  });

  it("keeps fixed seeds deterministic", () => {
    let left = makeMatch("golden");
    let right = makeMatch("golden");
    const actions: AgentAction[][] = [
      [
        { agentId: "a1", type: "move", direction: "right" },
        { agentId: "a2", type: "move", direction: "left" },
      ],
      [
        { agentId: "a1", type: "place_bubble" },
        { agentId: "a2", type: "place_bubble" },
      ],
      [
        { agentId: "a1", type: "move", direction: "right" },
        { agentId: "a2", type: "move", direction: "left" },
      ],
    ];

    for (const tickActions of actions) {
      left = applyTick(left, tickActions).state;
      right = applyTick(right, tickActions).state;
    }

    expect(right).toEqual(left);
  });

  it("treats malformed runtime actions as wait instead of crashing", () => {
    const state = makeMatch("malformed-action");
    const result = applyTick(state, [
      { agentId: "a1", type: "move", direction: "sideways" },
      { agentId: "a2", type: "dance" },
    ] as unknown as AgentAction[]);

    expect(result.state.players.find((player) => player.id === "a1")).toMatchObject({ x: 1, y: 1 });
    expect(result.state.players.find((player) => player.id === "a2")).toMatchObject({ x: 11, y: 9 });
    expect(result.events).toEqual([{ type: "tick", tick: 1 }]);
  });

  it("does not advance already finished matches", () => {
    const state = makeMatch("finished-static");
    state.status = "finished";
    state.finishReason = "elimination";
    state.winnerAgentId = "a1";

    const result = applyTick(state, [{ agentId: "a1", type: "move", direction: "right" }]);

    expect(result.state.tick).toBe(0);
    expect(result.state.status).toBe("finished");
    expect(result.events).toHaveLength(0);
  });

  it("blocks movement into solid and soft walls", () => {
    let state = makeMatch();
    const result = applyTick(state, [{ agentId: "a1", type: "move", direction: "up" }]);
    state = result.state;
    expect(state.players.find((player) => player.id === "a1")).toMatchObject({ x: 1, y: 1 });
    expect(result.events.some((event) => event.type === "blocked" && event.reason === "wall")).toBe(true);
  });

  it("resolves same-tile movement conflicts with one deterministic winner", () => {
    let state = makeMatch("same-tile-conflict");
    openInterior(state);
    const left = state.players[0];
    const right = state.players[1];
    if (!left || !right) {
      throw new Error("missing players");
    }
    state.players[0] = { ...left, x: 4, y: 5 };
    state.players[1] = { ...right, x: 6, y: 5 };

    const result = applyTick(state, [
      { agentId: "a1", type: "move", direction: "right" },
      { agentId: "a2", type: "move", direction: "left" },
    ]);

    expect(result.events.filter((event) => event.type === "moved" && event.to.x === 5 && event.to.y === 5)).toHaveLength(
      1,
    );
    expect(result.events.filter((event) => event.type === "blocked" && event.reason === "conflict")).toHaveLength(1);
  });

  it("blocks direct swaps and moves into stationary players", () => {
    let state = makeMatch("occupied-conflict");
    openInterior(state);
    const left = state.players[0];
    const right = state.players[1];
    if (!left || !right) {
      throw new Error("missing players");
    }
    state.players[0] = { ...left, x: 4, y: 5 };
    state.players[1] = { ...right, x: 5, y: 5 };

    const swap = applyTick(state, [
      { agentId: "a1", type: "move", direction: "right" },
      { agentId: "a2", type: "move", direction: "left" },
    ]);
    expect(swap.state.players.find((player) => player.id === "a1")).toMatchObject({ x: 4, y: 5 });
    expect(swap.state.players.find((player) => player.id === "a2")).toMatchObject({ x: 5, y: 5 });

    state = makeMatch("stationary-conflict");
    openInterior(state);
    const stationaryLeft = state.players[0];
    const stationaryRight = state.players[1];
    if (!stationaryLeft || !stationaryRight) {
      throw new Error("missing players");
    }
    state.players[0] = { ...stationaryLeft, x: 4, y: 5 };
    state.players[1] = { ...stationaryRight, x: 5, y: 5 };
    const stationary = applyTick(state, [{ agentId: "a1", type: "move", direction: "right" }]);
    expect(stationary.state.players.find((player) => player.id === "a1")).toMatchObject({ x: 4, y: 5 });
    expect(stationary.events.some((event) => event.type === "blocked" && event.reason === "conflict")).toBe(true);
  });

  it("places and explodes bubbles after the fixed fuse", () => {
    let state = makeMatch("bubble");
    state = applyTick(state, [{ agentId: "a1", type: "place_bubble" }]).state;
    expect(state.bubbles).toHaveLength(1);

    for (let index = 0; index < defaultRules.bubbleFuseTicks; index += 1) {
      state = applyTick(state, []).state;
    }

    expect(state.bubbles).toHaveLength(0);
    expect(state.blasts.length).toBeGreaterThan(0);
  });

  it("destroys soft walls and can spawn items deterministically", () => {
    let state = makeMatch("soft-wall");
    const player = state.players[0];
    if (!player) {
      throw new Error("missing player");
    }
    state.players[0] = { ...player, x: 3, y: 1, blastRange: 3 };
    state.map.cells[state.map.width * 1 + 4] = "soft";
    state = applyTick(state, [{ agentId: "a1", type: "place_bubble" }], { itemDropChance: 1 }).state;

    for (let index = 0; index < defaultRules.bubbleFuseTicks; index += 1) {
      state = applyTick(state, [], { itemDropChance: 1 }).state;
    }

    expect(getCell(state.map, { x: 4, y: 1 })).toBe("empty");
    expect(state.items.some((item) => item.x === 4 && item.y === 1)).toBe(true);
  });

  it("uses shields to absorb one blast hit", () => {
    let state = makeMatch("shield");
    const player = state.players[0];
    if (!player) {
      throw new Error("missing player");
    }
    state.items.push({ id: "shield-1", type: "shield", x: player.x, y: player.y });
    state.blasts.push({
      id: "blast-shield",
      sourceBubbleId: "bubble-enemy",
      ownerId: "a2",
      x: player.x,
      y: player.y,
      expiresAtTick: 5,
    });

    const result = applyTick(state, []);
    const updated = result.state.players.find((entry) => entry.id === "a1");
    expect(updated).toMatchObject({ alive: true, shieldCharges: 0 });
    expect(updated?.invulnerableUntilTick).toBeGreaterThan(result.state.tick);
    expect(result.events.some((event) => event.type === "shield_absorbed" && event.agentId === "a1")).toBe(true);
  });

  it("lets pierce bubbles destroy through one soft wall", () => {
    let state = makeMatch("pierce");
    const player = state.players[0];
    if (!player) {
      throw new Error("missing player");
    }
    state.players[0] = { ...player, x: 3, y: 1, blastRange: 3, pierceCharges: 1 };
    state.map.cells[state.map.width * 1 + 4] = "soft";
    state.map.cells[state.map.width * 1 + 5] = "soft";
    state = applyTick(state, [{ agentId: "a1", type: "place_bubble" }], { itemDropChance: 0 }).state;

    for (let index = 0; index < defaultRules.bubbleFuseTicks; index += 1) {
      state = applyTick(state, [], { itemDropChance: 0 }).state;
    }

    expect(getCell(state.map, { x: 4, y: 1 })).toBe("empty");
    expect(getCell(state.map, { x: 5, y: 1 })).toBe("empty");
    expect(state.players[0]?.pierceCharges).toBe(0);
  });

  it("uses quick-fuse charges for faster bubbles", () => {
    let state = makeMatch("quick-fuse");
    const player = state.players[0];
    if (!player) {
      throw new Error("missing player");
    }
    state.players[0] = { ...player, quickFuseCharges: 1 };
    state = applyTick(state, [{ agentId: "a1", type: "place_bubble" }]).state;
    const bubble = state.bubbles[0];
    expect(bubble).toMatchObject({ quickFuse: true, explodeAtTick: state.tick + defaultRules.quickFuseTicks });
    expect(state.players[0]?.quickFuseCharges).toBe(0);
  });

  it("finishes when one player remains", () => {
    let state = makeMatch("finish");
    const player = state.players[1];
    if (!player) {
      throw new Error("missing player");
    }
    state.players[1] = { ...player, alive: false };
    state = applyTick(state, []).state;
    expect(state.status).toBe("finished");
    expect(state.winnerAgentId).toBe("a1");
  });

  it("does not finish by tick limit while multiple players remain", () => {
    let state = makeMatch("no-timeout");
    state.maxTicks = 1;

    state = applyTick(state, []).state;
    state = applyTick(state, []).state;

    expect(state.tick).toBeGreaterThan(1);
    expect(state.status).toBe("running");
    expect(state.finishReason).toBeUndefined();
    expect(state.winnerAgentId).toBeUndefined();
  });

  it("enables royale poison zone and eliminates players who stay outside", () => {
    let state = createInitialMatchState({
      matchId: "zone-test",
      seed: "zone-seed",
      mapId: "royale",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    const exposed = state.players[0];
    const safe = state.players[1];
    if (!exposed || !safe) {
      throw new Error("missing players");
    }
    state.players[0] = { ...exposed, x: 2, y: 2 };
    state.players[1] = { ...safe, x: 11, y: 9 };
    state.zone = {
      ...state.zone,
      enabled: true,
      status: "stable",
      center: { x: 11, y: 9 },
      radius: 1,
      fromCenter: { x: 11, y: 9 },
      fromRadius: 1,
      targetCenter: { x: 11, y: 9 },
      targetRadius: 1,
      damageGraceTicks: 2,
    };

    state = applyTick(state, []).state;
    const result = applyTick(state, []);

    expect(result.state.players.find((player) => player.id === "a1")?.alive).toBe(false);
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: "eliminated", agentId: "a1", reason: "zone" }),
    );
    expect(result.state.status).toBe("finished");
    expect(result.state.winnerAgentId).toBe("a2");
  });

  it("uses a deterministic score tiebreaker instead of drawing when all players fall together", () => {
    let state = createInitialMatchState({
      matchId: "simultaneous-finish",
      seed: "simultaneous-finish",
      mapId: "royale",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    const left = state.players[0];
    const right = state.players[1];
    if (!left || !right) {
      throw new Error("missing players");
    }
    state.players[0] = { ...left, x: 2, y: 2, score: 5 };
    state.players[1] = { ...right, x: 36, y: 28, score: 12 };
    state.zone = {
      ...state.zone,
      enabled: true,
      status: "stable",
      center: { x: 19, y: 15 },
      radius: 1,
      fromCenter: { x: 19, y: 15 },
      fromRadius: 1,
      targetCenter: { x: 19, y: 15 },
      targetRadius: 1,
      damageGraceTicks: 0,
    };

    state = applyTick(state, []).state;

    expect(state.status).toBe("finished");
    expect(state.finishReason).toBe("elimination");
    expect(state.winnerAgentId).toBe("a2");
  });

  it("keeps each royale safe-zone target fully inside the previous safe zone", () => {
    const map = createMapFromPreset("royale");
    const rules = {
      ...defaultRules,
      zoneStartTick: 1,
      zoneShrinkDurationTicks: 4,
      zoneShrinkIntervalTicks: 3,
      zoneMinRadius: 0.75,
    };
    let zone = createInitialZoneState(map, "nested-zone-seed", rules, true);

    for (let tick = 0; tick < 220; tick += 1) {
      const previous = zone;
      zone = advanceZone(zone, map, tick, rules);

      if (zone.phase > previous.phase || zone.status === "shrinking") {
        const dx = zone.targetCenter.x - zone.fromCenter.x;
        const dy = zone.targetCenter.y - zone.fromCenter.y;
        const targetEdgeDistance = Math.sqrt(dx * dx + dy * dy) + zone.targetRadius;
        expect(targetEdgeDistance).toBeLessThanOrEqual(zone.fromRadius + 0.001);
      }
    }
  });

  it("uses a single-cell final royale zone so matches cannot stall with two adjacent survivors", () => {
    const map = createMapFromPreset("royale");
    const rules = {
      ...defaultRules,
      zoneStartTick: 1,
      zoneShrinkDurationTicks: 4,
      zoneShrinkIntervalTicks: 3,
      zoneMinRadius: 0.45,
    };
    let zone = createInitialZoneState(map, "single-cell-final-zone", rules, true);

    for (let tick = 0; tick < 220; tick += 1) {
      zone = advanceZone(zone, map, tick, rules);
    }

    expect(zone.targetRadius).toBe(0.45);
    expect(Number.isInteger(zone.targetCenter.x)).toBe(true);
    expect(Number.isInteger(zone.targetCenter.y)).toBe(true);

    const safeCells = Array.from({ length: map.width * map.height }, (_, index) => ({
      x: index % map.width,
      y: Math.floor(index / map.width),
    })).filter((position) => {
      const dx = position.x - zone.targetCenter.x;
      const dy = position.y - zone.targetCenter.y;
      return Math.sqrt(dx * dx + dy * dy) <= zone.targetRadius;
    });
    expect(safeCells).toHaveLength(1);
  });

  it("keeps generated and ticked match states internally valid", () => {
    let state = createInitialMatchState({
      matchId: "invariant-test",
      seed: "invariant-seed",
      mapId: "royale",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
        { id: "a3", name: "Gamma" },
        { id: "a4", name: "Delta" },
      ],
    });

    expect(validateMatchState(state)).toEqual([]);
    for (let index = 0; index < 80 && state.status === "running"; index += 1) {
      state = applyTick(state, [
        { agentId: "a1", type: "move", direction: "right" },
        { agentId: "a2", type: "move", direction: "left" },
        { agentId: "a3", type: "move", direction: "right" },
        { agentId: "a4", type: "move", direction: "left" },
      ]).state;
      expect(validateMatchState(state)).toEqual([]);
    }
  });
});

function openInterior(state: MatchState): void {
  for (let y = 1; y < state.map.height - 1; y += 1) {
    for (let x = 1; x < state.map.width - 1; x += 1) {
      state.map.cells[y * state.map.width + x] = "empty";
    }
  }
}
