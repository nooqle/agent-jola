import { createMapFromPreset, getMapPresetSpawns, normalizeMapPresetId } from "./map.js";
import { ENGINE_VERSION, RULES_VERSION } from "./metadata.js";
import { hashSeed } from "./rng.js";
import type { MapPresetId, MatchState, PlayerAppearance, PlayerState, RulesConfig } from "./types.js";
import { createInitialZoneState } from "./zone.js";

export const defaultRules: RulesConfig = {
  tickRate: 10,
  normalMoveCooldownTicks: 2,
  boostedMoveCooldownTicks: 1,
  bubbleFuseTicks: 25,
  quickFuseTicks: 15,
  blastDurationTicks: 3,
  maxTicks: 1200,
  itemDropChance: 0.4,
  maxShieldCharges: 2,
  maxPierceCharges: 3,
  maxQuickFuseCharges: 2,
  zoneStartTick: 140,
  zoneShrinkIntervalTicks: 65,
  zoneShrinkDurationTicks: 75,
  zoneMinRadius: 0.45,
  zoneDamageGraceTicks: 18,
};

export interface CreateMatchOptions {
  matchId: string;
  seed: string;
  mapId?: MapPresetId;
  agents: Array<{
    id: string;
    name: string;
    appearance?: PlayerAppearance;
    strategyVersionId?: string;
  }>;
  maxTicks?: number;
}

export function createInitialMatchState(options: CreateMatchOptions): MatchState {
  const mapId = normalizeMapPresetId(options.mapId);
  const map = createMapFromPreset(mapId, options.seed);
  const spawns = getMapPresetSpawns(mapId);
  const players: PlayerState[] = options.agents.slice(0, 4).map((agent, index) => {
    const spawn = spawns[index] ?? (spawns[0] as PlayerState["spawn"]);
    const player: PlayerState = {
      id: agent.id,
      name: agent.name,
      appearance: agent.appearance ?? defaultAppearance(index),
      x: spawn.x,
      y: spawn.y,
      spawn,
      alive: true,
      direction: index === 1 ? "left" : "right",
      moveCooldown: 0,
      bubbleCapacity: 1,
      activeBubbleCount: 0,
      blastRange: 2,
      speedBoostTicks: 0,
      shieldCharges: 0,
      pierceCharges: 0,
      quickFuseCharges: 0,
      invulnerableUntilTick: 0,
      zoneExposureTicks: 0,
      score: 0,
    };
    if (agent.strategyVersionId) {
      player.strategyVersionId = agent.strategyVersionId;
    }
    return player;
  });

  return {
    matchId: options.matchId,
    engineVersion: ENGINE_VERSION,
    rulesVersion: RULES_VERSION,
    mapId,
    tick: 0,
    status: "running",
    map,
    players,
    bubbles: [],
    blasts: [],
    items: [],
    seed: options.seed,
    rngState: hashSeed(options.seed),
    maxTicks: options.maxTicks ?? defaultRules.maxTicks,
    zone: createInitialZoneState(map, options.seed, defaultRules, mapId === "royale"),
  };
}

function defaultAppearance(index: number): PlayerAppearance {
  const palette = ["#f97316", "#84cc16", "#38bdf8", "#eab308"];
  const skins = ["chameleon-1", "chameleon-4", "chameleon-8", "chameleon-12"];
  return {
    color: palette[index % palette.length] ?? "#f97316",
    accessory: "none",
    skinId: skins[index % skins.length] ?? "chameleon-1",
  };
}

export function cloneMatchState(state: MatchState): MatchState {
  return {
    ...state,
    map: {
      ...state.map,
      cells: [...state.map.cells],
    },
    players: state.players.map((player) => ({
      ...player,
      spawn: { ...player.spawn },
    })),
    bubbles: state.bubbles.map((bubble) => ({ ...bubble })),
    blasts: state.blasts.map((blast) => ({ ...blast })),
    items: state.items.map((item) => ({ ...item })),
    zone: {
      ...state.zone,
      center: { ...state.zone.center },
      fromCenter: { ...state.zone.fromCenter },
      targetCenter: { ...state.zone.targetCenter },
    },
  };
}
