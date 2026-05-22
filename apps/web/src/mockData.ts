import type {
  AgentProfile,
  AgentAppearance,
  AgentActionType,
  AgentStrategyVersion,
  ArenaMap,
  BlastState,
  BubbleState,
  CellKind,
  DecisionLogEntry,
  GameEvent,
  ItemState,
  LeaderboardRow,
  MatchRecord,
  MatchState,
  MapPresetId,
  PlayerState,
  Position,
  ReplayFile,
  ZoneState
} from "./types";
import { normalizeAgentSkinId } from "./skins";

const now = new Date("2026-05-17T10:00:00.000Z").toISOString();

export const mockAgents: AgentProfile[] = [
  {
    id: "agent-ember",
    name: "Ember",
    callsign: "E-17",
    color: "#f97316",
    accessory: "cap",
    appearance: { color: "#f97316", accessory: "cap", skinId: "chameleon-1" },
    currentStrategyVersionId: "strat-ember-2",
    createdAt: now
  },
  {
    id: "agent-mesa",
    name: "Mesa",
    callsign: "M-04",
    color: "#84cc16",
    accessory: "visor",
    appearance: { color: "#84cc16", accessory: "visor", skinId: "chameleon-73" },
    currentStrategyVersionId: "strat-mesa-1",
    createdAt: now
  },
  {
    id: "agent-rivet",
    name: "Rivet",
    callsign: "R-22",
    color: "#38bdf8",
    accessory: "antenna",
    appearance: { color: "#38bdf8", accessory: "antenna", skinId: "chameleon-128" },
    currentStrategyVersionId: "strat-rivet-1",
    createdAt: now
  },
  {
    id: "agent-ghost",
    name: "Ghost",
    callsign: "G-09",
    color: "#eab308",
    accessory: "scarf",
    appearance: { color: "#eab308", accessory: "scarf", skinId: "chameleon-314" },
    currentStrategyVersionId: "strat-ghost-1",
    createdAt: now
  }
];

export const mockStrategies: AgentStrategyVersion[] = [
  {
    id: "strat-ember-2",
    agentId: "agent-ember",
    version: 2,
    prompt: "优先破坏软墙开路，确认逃生路线后再压迫最近对手。",
    summary: "先开墙，确认退路后放泡压制。",
    tactics: {
      dangerLookaheadTicks: 18,
      escapeMarginTicks: 6,
      attackEnemyEscapeLimit: 2,
      pressureBombing: 0.45,
      minUpgradesBeforeChase: 0
    },
    createdAt: now
  },
  {
    id: "strat-mesa-1",
    agentId: "agent-mesa",
    version: 1,
    prompt: "安全优先，主动收集火力和护盾，避免站在预测爆炸线上。",
    summary: "保守拾取路线，避开爆炸预测区。",
    tactics: {
      dangerLookaheadTicks: 22,
      escapeMarginTicks: 8,
      attackEnemyEscapeLimit: 1,
      pressureBombing: 0.35,
      minUpgradesBeforeChase: 1
    },
    createdAt: now
  },
  {
    id: "strat-rivet-1",
    agentId: "agent-rivet",
    version: 1,
    prompt: "争夺中线，在狭窄路口放泡，找不到安全路线就撤退。",
    summary: "中线控制，遇到风险立即回撤。",
    tactics: {
      dangerLookaheadTicks: 18,
      escapeMarginTicks: 6,
      attackEnemyEscapeLimit: 2,
      pressureBombing: 0.8,
      minUpgradesBeforeChase: 0
    },
    createdAt: now
  },
  {
    id: "strat-ghost-1",
    agentId: "agent-ghost",
    version: 1,
    prompt: "游走拿道具，至少吃到一个强化前避免正面对抗。",
    summary: "道具优先，强化后再接战。",
    tactics: {
      dangerLookaheadTicks: 18,
      escapeMarginTicks: 7,
      attackEnemyEscapeLimit: 1,
      pressureBombing: 0.45,
      minUpgradesBeforeChase: 1
    },
    createdAt: now
  }
];

export function createArenaMap(mapId: MapPresetId = "royale"): ArenaMap {
  const width = mapId === "royale" ? 39 : 13;
  const height = mapId === "royale" ? 31 : 11;
  const rows: CellKind[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return "solid";
      if (isMockHardBlock(mapId, x, y)) return "solid";
      return "empty";
    })
  );

  const safeCells = safeCellsForMap(mapId);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (rows[y]?.[x] !== "empty" || safeCells.has(`${x},${y}`)) continue;
      if (shouldMockSoftWall(mapId, x, y)) {
        rows[y]![x] = "soft";
      }
    }
  }

  return { id: mapId, name: mapLabel(mapId), width, height, rows };
}

const spawnPoints: Position[] = [
  { x: 1, y: 1 },
  { x: 11, y: 9 },
  { x: 11, y: 1 },
  { x: 1, y: 9 }
];

const royaleSpawnPoints: Position[] = [
  { x: 2, y: 2 },
  { x: 36, y: 28 },
  { x: 2, y: 28 },
  { x: 36, y: 2 }
];

export function createMockState(
  matchId = "mock-match-001",
  tick = 0,
  mapId: MapPresetId = "royale"
): MatchState {
  const participants = mockAgents.slice(0, 4);
  const map = createArenaMap(mapId);
  const spawns = mapId === "royale" ? royaleSpawnPoints : spawnPoints;
  const players: PlayerState[] = participants.map((agent, index) => {
    const point = spawns[index] ?? spawns[0]!;
    const step = Math.floor(tick / 12);
    const drift =
      agent.id === "agent-ember"
        ? step % 6
        : agent.id === "agent-mesa"
          ? -(step % 6)
          : agent.id === "agent-rivet"
            ? step % 4
            : -(step % 4);
    return {
      id: agent.id,
      name: agent.name,
      color: agent.color,
      accessory: agent.accessory,
      appearance: agent.appearance,
      x: clamp(point.x + drift, 1, map.width - 2),
      y: agent.id === "agent-rivet" ? clamp(point.y + (step % 4), 1, map.height - 2) : point.y,
      alive: tick < 210 || agent.id !== "agent-ghost",
      bubbleCapacity: 2,
      activeBubbleCount: tick % 40 > 8 && tick % 40 < 26 ? 1 : 0,
      blastRange: agent.id === "agent-mesa" ? 3 : 2,
      speedBoostTicks: agent.id === "agent-rivet" && tick < 90 ? 30 : 0,
      shieldCharges: agent.id === "agent-mesa" && tick < 120 ? 1 : 0,
      pierceCharges: agent.id === "agent-ember" && tick > 70 ? 1 : 0,
      quickFuseCharges: agent.id === "agent-ghost" && tick < 120 ? 1 : 0,
      zoneExposureTicks: 0
    };
  });

  const bubbles: BubbleState[] =
    tick % 60 > 12 && tick % 60 < 38
      ? [
          {
            id: `bubble-${matchId}-${Math.floor(tick / 60)}`,
            ownerId: "agent-ember",
            x:
              mapId === "royale"
                ? 17 + (Math.floor(tick / 60) % 5)
                : 4 + (Math.floor(tick / 60) % 3),
            y: mapId === "royale" ? 14 : 3,
            explodeAtTick: tick + 12,
            range: 2,
            pierce: tick > 70 ? 1 : 0,
            quickFuse: tick % 120 > 60
          }
        ]
      : [];

  const blasts: BlastState[] =
    tick % 60 >= 38 && tick % 60 < 43
      ? [
          {
            id: "blast-center",
            x: mapId === "royale" ? 19 : 6,
            y: mapId === "royale" ? 14 : 3,
            expiresAtTick: tick + 3,
            ownerId: "agent-ember"
          },
          {
            id: "blast-left",
            x: mapId === "royale" ? 18 : 5,
            y: mapId === "royale" ? 14 : 3,
            expiresAtTick: tick + 3,
            ownerId: "agent-ember"
          },
          {
            id: "blast-right",
            x: mapId === "royale" ? 20 : 7,
            y: mapId === "royale" ? 14 : 3,
            expiresAtTick: tick + 3,
            ownerId: "agent-ember"
          },
          {
            id: "blast-down",
            x: mapId === "royale" ? 19 : 6,
            y: mapId === "royale" ? 15 : 4,
            expiresAtTick: tick + 3,
            ownerId: "agent-ember"
          }
        ]
      : [];

  const items: ItemState[] = [
    {
      id: "item-range",
      type: "rangeUp",
      x: mapId === "royale" ? 24 : 9,
      y: mapId === "royale" ? 12 : 3
    },
    {
      id: "item-speed",
      type: "speedUp",
      x: mapId === "royale" ? 10 : 3,
      y: mapId === "royale" ? 21 : 7
    },
    {
      id: "item-shield",
      type: "shield",
      x: mapId === "royale" ? 19 : 7,
      y: mapId === "royale" ? 15 : 5
    },
    {
      id: "item-pierce",
      type: "pierce",
      x: mapId === "royale" ? 13 : 5,
      y: mapId === "royale" ? 25 : 7
    },
    {
      id: "item-quick",
      type: "quickFuse",
      x: mapId === "royale" ? 28 : 9,
      y: mapId === "royale" ? 22 : 7
    }
  ];

  const status = tick >= 240 ? "finished" : "running";
  return {
    matchId,
    mapId,
    tick,
    status,
    map,
    players,
    bubbles,
    blasts,
    items,
    seed: "mock-seed-17",
    zone: createMockZone(map, tick, mapId),
    ...(status === "finished"
      ? {
          winnerAgentId: "agent-ember",
          finishReason: "Ember survived the final blast window."
        }
      : {})
  };
}

export function createMockDecision(
  matchId: string,
  tick: number,
  agentId = "agent-ember"
): DecisionLogEntry {
  const actionType: AgentActionType =
    tick % 50 < 16 ? "place_bubble" : tick % 30 < 14 ? "move" : "wait";
  const direction = actionType === "move" ? (tick % 60 < 30 ? "right" : "down") : undefined;
  const reasons: Record<AgentActionType, string> = {
    place_bubble: "相邻软墙可破坏，逃生搜索在 3 步内找到安全格。",
    move: "危险图标记当前通道偏热，改走低风险道具路线。",
    wait: "放泡收益低于阈值，暂时停在预测爆炸区外。"
  };
  const strategyVersionId = mockAgents.find(
    (agent) => agent.id === agentId
  )?.currentStrategyVersionId;

  return {
    id: `decision-${matchId}-${tick}-${agentId}`,
    matchId,
    tick,
    agentId,
    action: direction ? { type: actionType, direction } : { type: actionType },
    reason: reasons[actionType],
    target: { x: 8, y: 3, label: actionType === "place_bubble" ? "软墙" : "火力道具" },
    risk: actionType === "place_bubble" ? 0.31 : 0.18,
    ...(strategyVersionId ? { strategyVersionId } : {}),
    path: [
      { x: 4, y: 3 },
      { x: 5, y: 3 },
      { x: 6, y: 3 },
      { x: 7, y: 3 },
      { x: 8, y: 3 }
    ],
    dangerCells: [
      { x: 6, y: 3 },
      { x: 6, y: 4 },
      { x: 5, y: 3 },
      { x: 7, y: 3 }
    ]
  };
}

export function createMockReplay(
  matchId = "mock-match-001",
  mapId: MapPresetId = "royale"
): ReplayFile {
  const frames = Array.from({ length: 36 }, (_, index) => {
    const tick = index * 6;
    return {
      tick,
      state: createMockState(matchId, tick, mapId),
      events: createEventsForTick(matchId, tick)
    };
  });

  return {
    matchId,
    seed: "mock-seed-17",
    createdAt: now,
    strategyVersions: mockStrategies,
    frames,
    summaryEvents: frames.flatMap((frame) => frame.events).filter((event) => event.type !== "move")
  };
}

function matchParticipant(agent: AgentProfile, score: number, survived: boolean) {
  const participant = {
    agentId: agent.id,
    name: agent.name,
    score,
    survived
  };
  return agent.currentStrategyVersionId
    ? { ...participant, strategyVersionId: agent.currentStrategyVersionId }
    : participant;
}

export const mockMatches: MatchRecord[] = [
  {
    id: "mock-match-001",
    status: "finished",
    seed: "mock-seed-17",
    mapId: "royale",
    createdAt: now,
    finishedAt: new Date("2026-05-17T10:04:00.000Z").toISOString(),
    participantIds: mockAgents.slice(0, 4).map((agent) => agent.id),
    participants: mockAgents
      .slice(0, 4)
      .map((agent, index) =>
        matchParticipant(agent, [3246, 2819, 1630, 1420][index] ?? 0, agent.id === "agent-ember")
      ),
    winnerAgentId: "agent-ember",
    totalTicks: 210
  },
  {
    id: "mock-match-000",
    status: "finished",
    seed: "mock-seed-13",
    mapId: "royale",
    createdAt: new Date("2026-05-17T09:42:00.000Z").toISOString(),
    finishedAt: new Date("2026-05-17T09:46:00.000Z").toISOString(),
    participantIds: mockAgents.slice(0, 4).map((agent) => agent.id),
    participants: mockAgents
      .slice(0, 4)
      .map((agent, index) =>
        matchParticipant(agent, [1800, 3090, 1700, 1260][index] ?? 0, agent.id === "agent-mesa")
      ),
    winnerAgentId: "agent-mesa",
    totalTicks: 188
  }
];

export const mockLeaderboard: LeaderboardRow[] = [
  {
    agentId: "agent-ember",
    name: "Ember",
    wins: 8,
    losses: 3,
    matches: 11,
    winRate: 0.73,
    rating: 1240
  },
  {
    agentId: "agent-mesa",
    name: "Mesa",
    wins: 6,
    losses: 4,
    matches: 10,
    winRate: 0.6,
    rating: 1195
  },
  {
    agentId: "agent-rivet",
    name: "Rivet",
    wins: 3,
    losses: 5,
    matches: 8,
    winRate: 0.38,
    rating: 1085
  },
  {
    agentId: "agent-ghost",
    name: "Ghost",
    wins: 2,
    losses: 7,
    matches: 9,
    winRate: 0.22,
    rating: 1010
  }
];

export function createMatchRecord(
  participantIds: string[],
  mapId: MapPresetId = "royale"
): MatchRecord {
  const id = `local-${Date.now().toString(36)}`;
  return {
    id,
    status: "running",
    seed: `seed-${Math.floor(Math.random() * 99999)}`,
    mapId,
    createdAt: new Date().toISOString(),
    participantIds
  };
}

export function createStrategy(
  agentId: string,
  prompt: string,
  previousVersions: AgentStrategyVersion[]
): AgentStrategyVersion {
  const latest = previousVersions
    .filter((strategy) => strategy.agentId === agentId)
    .reduce((version, strategy) => Math.max(version, strategy.version), 0);

  return {
    id: `local-strategy-${agentId}-${Date.now().toString(36)}`,
    agentId,
    version: latest + 1,
    prompt,
    summary: summarizeStrategy(prompt),
    createdAt: new Date().toISOString()
  };
}

export function createAgent(
  name: string,
  index: number,
  appearance?: AgentAppearance
): AgentProfile {
  const colors = ["#f97316", "#84cc16", "#38bdf8", "#eab308", "#fb7185", "#a3e635"];
  const id = `local-agent-${Date.now().toString(36)}`;
  const nextAppearance = appearance ?? {
    color: colors[index % colors.length] ?? "#f97316",
    accessory: "none",
    skinId: normalizeAgentSkinId(undefined, index)
  };
  return {
    id,
    name,
    callsign: `L-${String(index + 1).padStart(2, "0")}`,
    color: nextAppearance.color,
    accessory: nextAppearance.accessory,
    appearance: nextAppearance,
    createdAt: new Date().toISOString()
  };
}

export function collectMockDecisions(matchId: string): DecisionLogEntry[] {
  return Array.from({ length: 18 }, (_, index) => {
    const agent = mockAgents[index % mockAgents.length]!;
    return createMockDecision(matchId, index * 12 + 8, agent.id);
  });
}

function createEventsForTick(matchId: string, tick: number): GameEvent[] {
  const events: GameEvent[] = [];
  if (tick === 12) {
    events.push({
      id: `${matchId}-event-bubble-${tick}`,
      tick,
      type: "bubble_placed",
      agentId: "agent-ember",
      message: "Ember 在软墙旁放置水泡。",
      position: { x: 4, y: 3 }
    });
  }
  if (tick === 42) {
    events.push({
      id: `${matchId}-event-wall-${tick}`,
      tick,
      type: "wall_destroyed",
      message: "爆炸打开了中右侧通道。",
      position: { x: 7, y: 3 }
    });
  }
  if (tick === 78) {
    events.push({
      id: `${matchId}-event-item-${tick}`,
      tick,
      type: "item_collected",
      agentId: "agent-mesa",
      message: "Mesa 拾取火力道具，爆炸范围提升。",
      position: { x: 9, y: 3 },
      itemType: "rangeUp"
    });
  }
  if (tick === 126) {
    events.push({
      id: `${matchId}-event-shield-${tick}`,
      tick,
      type: "shield_absorbed",
      agentId: "agent-mesa",
      message: "Mesa 的护盾抵消了一次爆炸。",
      position: { x: 9, y: 3 }
    });
  }
  if (tick === 162) {
    events.push({
      id: `${matchId}-event-ko-${tick}`,
      tick,
      type: "eliminated",
      agentId: "agent-ghost",
      message: "Ghost 被连锁爆炸淘汰。",
      position: { x: 1, y: 9 }
    });
  }
  if (tick === 210) {
    events.push({
      id: `${matchId}-event-finished-${tick}`,
      tick,
      type: "finished",
      agentId: "agent-ember",
      message: "Ember 挺过最后爆炸窗口并获胜。"
    });
  }
  return events;
}

function summarizeStrategy(prompt: string): string {
  const clean = prompt.trim();
  if (clean.length <= 86) return clean;
  return `${clean.slice(0, 83)}...`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function safeCellsForMap(mapId: MapPresetId): Set<string> {
  if (mapId === "royale") {
    const cells = new Set<string>();
    for (const spawn of royaleSpawnPoints) {
      for (let y = spawn.y - 4; y <= spawn.y + 4; y += 1) {
        for (let x = spawn.x - 4; x <= spawn.x + 4; x += 1) {
          if (Math.abs(spawn.x - x) + Math.abs(spawn.y - y) <= 4) {
            cells.add(`${x},${y}`);
          }
        }
      }
    }
    return cells;
  }
  return new Set([
    "1,1",
    "2,1",
    "3,1",
    "1,2",
    "1,3",
    "11,9",
    "10,9",
    "9,9",
    "11,8",
    "11,7",
    "1,9",
    "2,9",
    "3,9",
    "1,8",
    "1,7",
    "11,1",
    "10,1",
    "9,1",
    "11,2",
    "11,3"
  ]);
}

function isMockHardBlock(mapId: MapPresetId, x: number, y: number): boolean {
  if (mapId !== "royale") {
    return x % 2 === 0 && y % 2 === 0;
  }
  if (isMockRoyalePermanentLane(x, y)) {
    return false;
  }
  const center = mockRoyaleCenter();
  const innerPillar = x % 4 === 0 && y % 4 === 0;
  const shortWall =
    ((x === center.x - 6 || x === center.x + 6) &&
      y >= center.y - 6 &&
      y <= center.y + 6 &&
      y !== center.y) ||
    ((y === center.y - 5 || y === center.y + 5) &&
      x >= center.x - 7 &&
      x <= center.x + 7 &&
      x !== center.x);
  const outpost = (x === 8 || x === 30) && (y === 7 || y === 23);
  return innerPillar || shortWall || outpost;
}

function createMockZone(map: ArenaMap, tick: number, mapId: MapPresetId): ZoneState {
  const enabled = mapId === "royale";
  const center = { x: (map.width - 1) / 2, y: (map.height - 1) / 2 };
  const targetCenter =
    tick < 215
      ? { x: 23, y: 18 }
      : tick < 495
        ? { x: 15, y: 12 }
        : tick < 775
          ? { x: 18, y: 16 }
          : { x: 19, y: 15 };
  const fromRadius = Math.ceil(Math.hypot(map.width, map.height) / 2);
  const targetRadius = tick < 215 ? 18 : tick < 495 ? 11 : tick < 775 ? 4 : 0.75;
  const progress =
    tick < 140
      ? 0
      : tick < 215
        ? Math.min(1, (tick - 140) / 75)
        : tick < 355
          ? Math.min(1, (tick - 280) / 75)
          : 1;
  return {
    enabled,
    phase: tick < 215 ? 0 : tick < 355 ? 1 : tick < 495 ? 2 : tick < 775 ? 3 : 6,
    status: !enabled ? "stable" : tick < 140 ? "waiting" : progress < 1 ? "shrinking" : "stable",
    center: {
      x: center.x + (targetCenter.x - center.x) * progress,
      y: center.y + (targetCenter.y - center.y) * progress
    },
    radius: fromRadius + (targetRadius - fromRadius) * progress,
    fromCenter: center,
    fromRadius,
    targetCenter,
    targetRadius,
    shrinkStartTick: 140,
    shrinkEndTick: 215,
    nextShrinkStartTick: 280,
    finalRadius: 0.75,
    damageGraceTicks: 18
  };
}

function shouldMockSoftWall(mapId: MapPresetId, x: number, y: number): boolean {
  if (mapId === "royale") {
    if (isMockRoyalePermanentLane(x, y)) {
      return false;
    }
    const center = mockRoyaleCenter();
    const sector = (Math.floor(x / 6) + Math.floor(y / 6)) % 3;
    const density = sector === 0 ? 5 : sector === 1 ? 4 : 3;
    const centerDistance = Math.abs(x - center.x) + Math.abs(y - center.y);
    const centerAdjustment = centerDistance < 7 ? -1 : centerDistance > 18 ? 1 : 0;
    return (x * 37 + y * 19 + x * y * 3) % 10 < density + centerAdjustment;
  }
  if (mapId === "open-court") {
    return x !== 6 && y !== 5 && (x * 11 + y * 7) % 6 === 0;
  }
  if (mapId === "crossfire") {
    return (
      x !== 6 &&
      y !== 5 &&
      x !== 1 &&
      x !== 11 &&
      y !== 1 &&
      y !== 9 &&
      (x === 3 || x === 9 || y === 3 || y === 7) &&
      (x * 13 + y * 19) % 4 <= 1
    );
  }
  if (mapId === "maze") {
    const connector =
      ((x === 3 || x === 9) && y % 2 === 1) || ((y === 3 || y === 7) && x % 2 === 1);
    return (
      x !== 1 &&
      x !== 11 &&
      y !== 1 &&
      y !== 9 &&
      x !== 6 &&
      y !== 5 &&
      !connector &&
      (x * 17 + y * 23) % 7 <= 3
    );
  }
  return (x * 17 + y * 29) % 5 <= 2;
}

function isMockRoyalePermanentLane(x: number, y: number): boolean {
  const center = mockRoyaleCenter();
  const centralCross = x === center.x || y === center.y;
  const quadrantGate = (x === 9 || x === 29) && y >= 5 && y <= 25;
  const longConnector = (y === 7 || y === 23) && x >= 5 && x <= 33;
  const diagonalCut =
    Math.abs(x - y - (center.x - center.y)) <= 1 ||
    Math.abs(x + y - (center.x + center.y + 3)) <= 1;
  return centralCross || quadrantGate || longConnector || diagonalCut;
}

function mockRoyaleCenter(): Position {
  return { x: 19, y: 15 };
}

function mapLabel(mapId: MapPresetId): string {
  if (mapId === "royale") return "Royale Ruins";
  if (mapId === "open-court") return "Open Court";
  if (mapId === "crossfire") return "Crossfire";
  if (mapId === "maze") return "Maze";
  return "Classic Yard";
}
