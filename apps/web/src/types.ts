export type CellKind = "empty" | "solid" | "soft";
export type ItemType = "rangeUp" | "capacityUp" | "speedUp" | "shield" | "pierce" | "quickFuse";
export type MatchStatus = "waiting" | "running" | "finished";
export type AgentActionType = "move" | "place_bubble" | "wait";
export type AgentAccessory = "none" | "cap" | "visor" | "scarf" | "crown" | "antenna";
export type MapPresetId = "classic" | "open-court" | "crossfire" | "maze" | "royale";

export interface AgentAppearance {
  color: string;
  accessory: AgentAccessory;
  skinId: string;
}

export interface Position {
  x: number;
  y: number;
}

export interface ArenaMap {
  id: MapPresetId;
  name: string;
  width: number;
  height: number;
  rows: CellKind[][];
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
}

export interface AgentProfile {
  id: string;
  name: string;
  callsign: string;
  color: string;
  accessory: AgentAccessory;
  appearance: AgentAppearance;
  currentStrategyVersionId?: string;
  createdAt: string;
}

export interface AgentStrategyVersion {
  id: string;
  agentId: string;
  version: number;
  prompt: string;
  summary: string;
  tactics?: Record<string, string | number | boolean>;
  createdAt: string;
}

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  accessory: AgentAccessory;
  appearance: AgentAppearance;
  x: number;
  y: number;
  alive: boolean;
  bubbleCapacity: number;
  activeBubbleCount: number;
  blastRange: number;
  speedBoostTicks: number;
  shieldCharges: number;
  pierceCharges: number;
  quickFuseCharges: number;
  zoneExposureTicks?: number;
}

export interface BubbleState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  explodeAtTick: number;
  range: number;
  pierce?: number;
  quickFuse?: boolean;
}

export interface BlastState {
  id: string;
  x: number;
  y: number;
  expiresAtTick: number;
  ownerId?: string;
}

export interface ItemState {
  id: string;
  type: ItemType;
  x: number;
  y: number;
}

export interface GameEvent {
  id: string;
  tick: number;
  type:
    | "move"
    | "blocked"
    | "bubble_placed"
    | "bubble_exploded"
    | "wall_destroyed"
    | "item_spawned"
    | "item_collected"
    | "shield_absorbed"
    | "eliminated"
    | "finished";
  agentId?: string;
  message: string;
  position?: Position;
  itemType?: ItemType;
}

export interface MatchState {
  matchId: string;
  engineVersion?: string;
  rulesVersion?: string;
  mapId: MapPresetId;
  tick: number;
  status: MatchStatus;
  map: ArenaMap;
  players: PlayerState[];
  bubbles: BubbleState[];
  blasts: BlastState[];
  items: ItemState[];
  seed: string;
  zone: ZoneState;
  winnerAgentId?: string;
  finishReason?: string;
}

export interface DecisionLogEntry {
  id: string;
  matchId: string;
  tick: number;
  agentId: string;
  action: {
    type: AgentActionType;
    direction?: "up" | "down" | "left" | "right";
  };
  reason: string;
  target?: Position & { label?: string };
  risk: number;
  strategyVersionId?: string;
  path?: Position[];
  dangerCells?: Position[];
}

export interface MatchRecord {
  id: string;
  status: MatchStatus;
  seed: string;
  engineVersion?: string;
  rulesVersion?: string;
  agentProtocolVersion?: string;
  mapId: MapPresetId;
  createdAt: string;
  finishedAt?: string;
  participantIds: string[];
  participants?: Array<{
    agentId: string;
    name: string;
    score: number;
    survived: boolean;
    strategyVersionId?: string;
  }>;
  winnerAgentId?: string;
  totalTicks?: number;
}

export interface ReplayFrame {
  tick: number;
  state: MatchState;
  events: GameEvent[];
}

export interface ReplayFile {
  matchId: string;
  seed: string;
  engineVersion?: string;
  rulesVersion?: string;
  agentProtocolVersion?: string;
  createdAt: string;
  strategyVersions: AgentStrategyVersion[];
  frames: ReplayFrame[];
  summaryEvents: GameEvent[];
}

export interface LeaderboardRow {
  agentId: string;
  name: string;
  wins: number;
  losses: number;
  matches: number;
  winRate: number;
  rating: number;
}

export interface MapPreset {
  id: MapPresetId;
  name: string;
  description: string;
}

export type ServerMode = "checking" | "live" | "mock";

export type MatchSocketMessage =
  | { type: "snapshot"; state: MatchState }
  | { type: "decision"; decision: DecisionLogEntry }
  | { type: "finished"; state: MatchState; record?: MatchRecord };
