export type CellType = "empty" | "solid" | "soft";

export type Direction = "up" | "down" | "left" | "right";

export type MapPresetId = "classic" | "open-court" | "crossfire" | "maze" | "royale";

export type MatchStatus = "waiting" | "running" | "finished";

export type FinishReason = "elimination" | "draw";

export type ItemType = "rangeUp" | "capacityUp" | "speedUp" | "shield" | "pierce" | "quickFuse";
export type PlayerAccessory = "none" | "cap" | "visor" | "scarf" | "crown" | "antenna";

export interface PlayerAppearance {
  color: string;
  accessory: PlayerAccessory;
  skinId: string;
}

export interface Position {
  x: number;
  y: number;
}

export interface GameMap {
  id: MapPresetId;
  name: string;
  width: number;
  height: number;
  cells: CellType[];
}

export interface PlayerState extends Position {
  id: string;
  name: string;
  appearance: PlayerAppearance;
  alive: boolean;
  direction: Direction;
  moveCooldown: number;
  bubbleCapacity: number;
  activeBubbleCount: number;
  blastRange: number;
  speedBoostTicks: number;
  shieldCharges: number;
  pierceCharges: number;
  quickFuseCharges: number;
  invulnerableUntilTick: number;
  zoneExposureTicks: number;
  score: number;
  strategyVersionId?: string;
  spawn: Position;
}

export interface ZoneState {
  enabled: boolean;
  phase: number;
  status: "waiting" | "shrinking" | "stable";
  center: Position;
  radius: number;
  fromCenter: Position;
  fromRadius: number;
  targetCenter: Position;
  targetRadius: number;
  shrinkStartTick: number;
  shrinkEndTick: number;
  nextShrinkStartTick: number;
  finalRadius: number;
  damageGraceTicks: number;
  rngState: number;
}

export interface BubbleState extends Position {
  id: string;
  ownerId: string;
  placedAtTick: number;
  explodeAtTick: number;
  range: number;
  ownerCanPass: boolean;
  pierce: number;
  quickFuse: boolean;
}

export interface BlastState extends Position {
  id: string;
  sourceBubbleId: string;
  ownerId: string;
  expiresAtTick: number;
}

export interface ItemState extends Position {
  id: string;
  type: ItemType;
}

export interface MatchState {
  matchId: string;
  engineVersion: string;
  rulesVersion: string;
  mapId: MapPresetId;
  tick: number;
  status: MatchStatus;
  map: GameMap;
  players: PlayerState[];
  bubbles: BubbleState[];
  blasts: BlastState[];
  items: ItemState[];
  seed: string;
  rngState: number;
  maxTicks: number;
  zone: ZoneState;
  winnerAgentId?: string;
  finishReason?: FinishReason;
}

export type AgentAction =
  | {
      agentId: string;
      type: "wait";
    }
  | {
      agentId: string;
      type: "move";
      direction: Direction;
    }
  | {
      agentId: string;
      type: "place_bubble";
    };

export type GameEvent =
  | {
      type: "tick";
      tick: number;
    }
  | {
      type: "moved";
      tick: number;
      agentId: string;
      from: Position;
      to: Position;
    }
  | {
      type: "blocked";
      tick: number;
      agentId: string;
      reason: "wall" | "bubble" | "conflict" | "cooldown" | "dead" | "bounds";
      from: Position;
      to?: Position;
    }
  | {
      type: "bubble_placed";
      tick: number;
      bubble: BubbleState;
    }
  | {
      type: "bubble_exploded";
      tick: number;
      bubbleId: string;
      ownerId: string;
      cells: Position[];
    }
  | {
      type: "wall_destroyed";
      tick: number;
      position: Position;
    }
  | {
      type: "item_spawned";
      tick: number;
      item: ItemState;
    }
  | {
      type: "item_collected";
      tick: number;
      agentId: string;
      item: ItemState;
    }
  | {
      type: "shield_absorbed";
      tick: number;
      agentId: string;
      byBubbleId?: string;
      remainingCharges: number;
    }
  | {
      type: "eliminated";
      tick: number;
      agentId: string;
      ownerId?: string;
      byBubbleId?: string;
      reason?: "blast" | "zone";
    }
  | {
      type: "finished";
      tick: number;
      reason: FinishReason;
      winnerAgentId?: string;
    };

export interface DecisionLogEntry {
  matchId: string;
  tick: number;
  agentId: string;
  strategyVersionId?: string;
  action: AgentAction;
  reason: string;
  target?: Position;
  risk: "none" | "low" | "medium" | "high";
  evidence?: string[];
}

export interface MatchRecord {
  id: string;
  seed: string;
  engineVersion?: string;
  rulesVersion?: string;
  agentProtocolVersion?: string;
  mapId: MapPresetId;
  status: MatchStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationTicks: number;
  winnerAgentId?: string;
  finishReason?: FinishReason;
  participants: Array<{
    agentId: string;
    name: string;
    appearance?: PlayerAppearance;
    strategyVersionId?: string;
    survived: boolean;
    score: number;
  }>;
}

export interface RulesConfig {
  tickRate: number;
  normalMoveCooldownTicks: number;
  boostedMoveCooldownTicks: number;
  bubbleFuseTicks: number;
  quickFuseTicks: number;
  blastDurationTicks: number;
  maxTicks: number;
  itemDropChance: number;
  maxShieldCharges: number;
  maxPierceCharges: number;
  maxQuickFuseCharges: number;
  zoneStartTick: number;
  zoneShrinkIntervalTicks: number;
  zoneShrinkDurationTicks: number;
  zoneMinRadius: number;
  zoneDamageGraceTicks: number;
}

export interface TickResult {
  state: MatchState;
  events: GameEvent[];
}
