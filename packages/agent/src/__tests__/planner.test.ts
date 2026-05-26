import { describe, expect, it } from "vitest";
import { createInitialMatchState } from "@agent-poppy/core";
import { defaultStrategy, parseNaturalLanguageStrategy } from "@agent-poppy/strategy";
import { planAgentAction } from "../planner.js";

describe("agent planner", () => {
  it("produces a decision log with an action", () => {
    const state = createInitialMatchState({
      matchId: "m1",
      seed: "planner",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    const player = state.players[0];
    if (!player) {
      throw new Error("missing player");
    }
    const output = planAgentAction(state, player, defaultStrategy());
    expect(output.action.agentId).toBe("a1");
    expect(output.decision.reason.length).toBeGreaterThan(0);
  });

  it("places a bubble near a soft wall when escape exists", () => {
    const state = createInitialMatchState({
      matchId: "m2",
      seed: "planner-bomb",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    const player = state.players[0];
    if (!player) {
      throw new Error("missing player");
    }
    state.map.cells[state.map.width * 1 + 2] = "soft";
    const strategy = parseNaturalLanguageStrategy("优先炸墙开路").strategy;
    const output = planAgentAction(state, player, strategy);
    expect(output.action.type).toBe("place_bubble");
  });

  it("places an attacking bubble when the opponent is in blast line with limited escape", () => {
    const state = createInitialMatchState({
      matchId: "m3",
      seed: "planner-attack",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    openInterior(state);
    const player = state.players[0];
    const enemy = state.players[1];
    if (!player || !enemy) {
      throw new Error("missing players");
    }
    player.x = 5;
    player.y = 5;
    enemy.x = 7;
    enemy.y = 5;
    state.map.cells[state.map.width * 4 + 7] = "solid";
    state.map.cells[state.map.width * 5 + 8] = "solid";
    state.map.cells[state.map.width * 6 + 7] = "solid";

    const strategy = parseNaturalLanguageStrategy("稳健攻击，只有同一行同一列能覆盖时才放泡").strategy;
    const output = planAgentAction(state, player, strategy);
    expect(output.action.type).toBe("place_bubble");
    expect(output.decision.reason).toContain("爆炸覆盖线");
  });

  it("does not waste an attacking bubble in a fully open lane", () => {
    const state = createInitialMatchState({
      matchId: "m3-open",
      seed: "planner-open-attack",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    openInterior(state);
    const player = state.players[0];
    const enemy = state.players[1];
    if (!player || !enemy) {
      throw new Error("missing players");
    }
    player.x = 5;
    player.y = 5;
    enemy.x = 7;
    enemy.y = 5;

    const strategy = parseNaturalLanguageStrategy("稳健攻击，只有同一行同一列能覆盖时才放泡").strategy;
    const output = planAgentAction(state, player, strategy);
    expect(output.action.type).not.toBe("place_bubble");
  });

  it("uses a saved quick-fuse charge to pressure-bomb a fully open lane when its escape is verified", () => {
    const state = createInitialMatchState({
      matchId: "m3-aggressive-open",
      seed: "planner-aggressive-open-attack",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    openInterior(state);
    const player = state.players[0];
    const enemy = state.players[1];
    if (!player || !enemy) {
      throw new Error("missing players");
    }
    player.x = 5;
    player.y = 5;
    player.quickFuseCharges = 1;
    enemy.x = 7;
    enemy.y = 5;

    const strategy = parseNaturalLanguageStrategy("激进攻击，急爆留给攻击，主动压制对手").strategy;
    const output = planAgentAction(state, player, strategy);
    expect(output.action.type).toBe("place_bubble");
    expect(output.decision.evidence).toContain("attackEscapeLimit=3");
  });

  it("does not panic-bomb when a nearby opponent is not in blast line", () => {
    const state = createInitialMatchState({
      matchId: "m4",
      seed: "planner-no-l-bomb",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    openInterior(state);
    const player = state.players[0];
    const enemy = state.players[1];
    if (!player || !enemy) {
      throw new Error("missing players");
    }
    player.x = 5;
    player.y = 5;
    enemy.x = 6;
    enemy.y = 6;

    const strategy = parseNaturalLanguageStrategy("激进攻击追击对手").strategy;
    const output = planAgentAction(state, player, strategy);
    expect(output.action.type).not.toBe("place_bubble");
  });

  it("moves toward an attack tile when a steady line attack can build pressure", () => {
    const state = createInitialMatchState({
      matchId: "m4-trap-path",
      seed: "planner-trap-path",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    openInterior(state);
    const player = state.players[0];
    const enemy = state.players[1];
    if (!player || !enemy) {
      throw new Error("missing players");
    }
    player.x = 5;
    player.y = 5;
    enemy.x = 9;
    enemy.y = 5;
    state.map.cells[state.map.width * 4 + 9] = "solid";
    state.map.cells[state.map.width * 5 + 10] = "solid";
    state.map.cells[state.map.width * 6 + 9] = "solid";

    const strategy = parseNaturalLanguageStrategy("稳健攻击，只有同一行同一列能覆盖时才放泡").strategy;
    const output = planAgentAction(state, player, strategy);
    expect(output.action).toEqual({ agentId: "a1", type: "move", direction: "right" });
    expect(output.decision.reason).toContain("攻击位");
  });

  it("waits instead of stepping into an active blast while pursuing a target", () => {
    const state = createInitialMatchState({
      matchId: "m5",
      seed: "planner-wait-before-blast-tile",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    openInterior(state);
    const player = state.players[0];
    const enemy = state.players[1];
    if (!player || !enemy) {
      throw new Error("missing players");
    }
    state.tick = 10;
    player.x = 5;
    player.y = 5;
    enemy.x = 9;
    enemy.y = 9;
    state.items.push({ id: "item-risk", type: "rangeUp", x: 4, y: 5 });
    state.blasts.push({
      id: "blast-risk",
      sourceBubbleId: "bubble-risk",
      ownerId: "a2",
      x: 4,
      y: 5,
      expiresAtTick: 12,
    });

    const strategy = parseNaturalLanguageStrategy("优先道具，但必须安全等待爆炸结束").strategy;
    const output = planAgentAction(state, player, strategy);
    expect(output.action.type).toBe("wait");
    expect(output.decision.reason).toContain("等待危险窗口");
  });

  it("prioritizes leaving its own future blast line after placing a bubble", () => {
    const state = createInitialMatchState({
      matchId: "m6",
      seed: "planner-own-blast-exit",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    openInterior(state);
    const player = state.players[0];
    const enemy = state.players[1];
    if (!player || !enemy) {
      throw new Error("missing players");
    }
    state.tick = 10;
    player.x = 5;
    player.y = 5;
    enemy.x = 9;
    enemy.y = 9;
    state.bubbles.push({
      id: "own-bubble",
      ownerId: "a1",
      x: 5,
      y: 5,
      placedAtTick: 10,
      explodeAtTick: 25,
      range: 2,
      ownerCanPass: true,
      pierce: 0,
      quickFuse: false,
    });

    const output = planAgentAction(state, player, defaultStrategy());
    expect(output.action.type).toBe("move");
    expect(output.decision.reason).toContain("自己水泡");
  });

  it("does not route into its own future blast line while moving toward a shrinking zone", () => {
    const state = createInitialMatchState({
      matchId: "m6-zone-own-blast",
      seed: "planner-zone-own-blast",
      mapId: "royale",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    openInterior(state);
    const player = state.players[0];
    const enemy = state.players[1];
    if (!player || !enemy) {
      throw new Error("missing players");
    }
    state.tick = 300;
    player.x = 10;
    player.y = 10;
    enemy.x = 30;
    enemy.y = 20;
    state.zone = {
      ...state.zone,
      enabled: true,
      phase: 3,
      status: "shrinking",
      center: { x: 10, y: 10 },
      radius: 2,
      fromCenter: { x: 10, y: 10 },
      fromRadius: 2,
      targetCenter: { x: 10, y: 13 },
      targetRadius: 1,
      finalRadius: 0.45,
      shrinkStartTick: 290,
      shrinkEndTick: 340,
      nextShrinkStartTick: 420,
    };
    state.bubbles.push({
      id: "own-zone-bubble",
      ownerId: "a1",
      x: 10,
      y: 12,
      placedAtTick: 290,
      explodeAtTick: 308,
      range: 2,
      ownerCanPass: false,
      pierce: 0,
      quickFuse: false,
    });

    const output = planAgentAction(state, player, defaultStrategy());
    expect(output.action.type).toBe("move");
    if (output.action.type === "move") {
      expect(output.action.direction).not.toBe("down");
    }
    expect(output.decision.reason).toContain("安全区");
  });

  it("avoids its own future blast line when taking an emergency escape route", () => {
    const state = createInitialMatchState({
      matchId: "m6-emergency-own-blast",
      seed: "planner-emergency-own-blast",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    openInterior(state);
    const player = state.players[0];
    const enemy = state.players[1];
    if (!player || !enemy) {
      throw new Error("missing players");
    }
    state.tick = 10;
    player.x = 5;
    player.y = 5;
    enemy.x = 9;
    enemy.y = 9;
    state.map.cells[state.map.width * 4 + 5] = "solid";
    state.map.cells[state.map.width * 6 + 5] = "solid";
    state.blasts.push({
      id: "active-danger",
      sourceBubbleId: "enemy-danger",
      ownerId: "a2",
      x: 5,
      y: 5,
      expiresAtTick: 12,
    });
    state.bubbles.push({
      id: "own-future-line",
      ownerId: "a1",
      x: 8,
      y: 5,
      placedAtTick: 6,
      explodeAtTick: 25,
      range: 2,
      ownerCanPass: false,
      pierce: 0,
      quickFuse: false,
    });

    const output = planAgentAction(state, player, defaultStrategy());
    expect(output.action).toEqual({ agentId: "a1", type: "move", direction: "left" });
    expect(output.decision.reason).toContain("危险窗口");
  });

  it("raises attack priority over farming in the late game", () => {
    const state = createInitialMatchState({
      matchId: "m7",
      seed: "planner-late-tempo",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    openInterior(state);
    const player = state.players[0];
    const enemy = state.players[1];
    if (!player || !enemy) {
      throw new Error("missing players");
    }
    state.tick = 420;
    state.maxTicks = 900;
    player.x = 5;
    player.y = 5;
    enemy.x = 9;
    enemy.y = 5;
    state.items.push({ id: "near-item", type: "rangeUp", x: 4, y: 5 });

    const output = planAgentAction(state, player, defaultStrategy());
    expect(output.action).toEqual({ agentId: "a1", type: "move", direction: "right" });
    expect(output.decision.reason).toContain("攻击位");
  });

  it("does not place a second bubble before its active bubble resolves", () => {
    const state = createInitialMatchState({
      matchId: "m8",
      seed: "planner-single-bubble",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    openInterior(state);
    const player = state.players[0];
    const enemy = state.players[1];
    if (!player || !enemy) {
      throw new Error("missing players");
    }
    player.x = 5;
    player.y = 5;
    player.bubbleCapacity = 2;
    player.activeBubbleCount = 1;
    enemy.x = 7;
    enemy.y = 5;
    state.bubbles.push({
      id: "active-own-bubble",
      ownerId: "a1",
      x: 1,
      y: 1,
      placedAtTick: 0,
      explodeAtTick: 25,
      range: 2,
      ownerCanPass: false,
      pierce: 0,
      quickFuse: false,
    });

    const output = planAgentAction(state, player, parseNaturalLanguageStrategy("激进攻击").strategy);
    expect(output.action.type).not.toBe("place_bubble");
  });

  it("does not spend a quick-fuse charge on routine wall breaking", () => {
    const state = createInitialMatchState({
      matchId: "m9",
      seed: "planner-save-quick-fuse",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    const player = state.players[0];
    const enemy = state.players[1];
    if (!player || !enemy) {
      throw new Error("missing players");
    }
    player.quickFuseCharges = 1;
    enemy.x = 11;
    enemy.y = 9;
    state.map.cells[state.map.width * 1 + 2] = "soft";

    const output = planAgentAction(state, player, parseNaturalLanguageStrategy("优先炸墙开路").strategy);
    expect(output.action.type).not.toBe("place_bubble");
  });

  it("respects an upgrade gate before chasing", () => {
    const state = createInitialMatchState({
      matchId: "m10",
      seed: "planner-upgrade-gate",
      agents: [
        { id: "a1", name: "Alpha" },
        { id: "a2", name: "Beta" },
      ],
    });
    openInterior(state);
    const player = state.players[0];
    const enemy = state.players[1];
    if (!player || !enemy) {
      throw new Error("missing players");
    }
    player.x = 5;
    player.y = 5;
    enemy.x = 9;
    enemy.y = 5;
    state.items.push({ id: "near-item", type: "rangeUp", x: 4, y: 5 });

    const output = planAgentAction(
      state,
      player,
      parseNaturalLanguageStrategy("至少吃到 2 个强化后再主动靠近对手，发育期优先道具").strategy,
    );
    expect(output.action).toEqual({ agentId: "a1", type: "move", direction: "left" });
    expect(output.decision.evidence).toContain("minUpgradesBeforeChase=2");
  });
});

function openInterior(state: ReturnType<typeof createInitialMatchState>): void {
  for (let y = 1; y < state.map.height - 1; y += 1) {
    for (let x = 1; x < state.map.width - 1; x += 1) {
      state.map.cells[y * state.map.width + x] = "empty";
    }
  }
}
