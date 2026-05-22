import {
  collectMockDecisions,
  createAgent as createMockAgent,
  createMatchRecord,
  createMockReplay,
  createStrategy,
  mockAgents,
  mockLeaderboard,
  mockMatches,
  mockStrategies
} from "./mockData";
import { normalizeAgentSkinId } from "./skins";
import type {
  LocalAgentProvider,
  PortalInstallCommandResponse,
  PortalMeResponse,
  PortalProductApiKeyResponse,
  PortalSessionResponse,
  PortalProfile
} from "@agent-bomber/protocol";
import type { StrategyPromptTemplate } from "@agent-bomber/strategy";
import type {
  AgentAccessory,
  AgentAppearance,
  AgentProfile,
  AgentStrategyVersion,
  CellKind,
  DecisionLogEntry,
  GameEvent,
  LeaderboardRow,
  MapPresetId,
  MatchRecord,
  MatchState,
  ReplayFile,
  ServerMode,
  ItemType,
  ZoneState
} from "./types";

const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

let fallbackAgents = [...mockAgents];
let fallbackStrategies = [...mockStrategies];
let fallbackMatches = [...mockMatches];

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export interface DashboardData {
  agents: AgentProfile[];
  strategies: AgentStrategyVersion[];
  matches: MatchRecord[];
  leaderboard: LeaderboardRow[];
  mode: ServerMode;
}

export async function loadDashboard(): Promise<DashboardData> {
  const health = await checkHealth();
  if (health !== "live") {
    return {
      agents: fallbackAgents,
      strategies: fallbackStrategies,
      matches: fallbackMatches,
      leaderboard: mockLeaderboard,
      mode: "mock"
    };
  }

  try {
    const [rawAgents, rawMatches, rawLeaderboard] = await Promise.all([
      requestJson<RawAgent[]>("/agents"),
      requestJson<RawMatchRecord[]>("/matches"),
      requestJson<RawLeaderboardEntry[]>("/leaderboard")
    ]);
    const agents = rawAgents.map(normalizeAgent);
    const strategies = (
      await Promise.all(
        agents.map((agent) =>
          requestJson<RawStrategyVersion[]>(
            `/agents/${encodeURIComponent(agent.id)}/strategy-versions`
          ).catch(() => [])
        )
      )
    )
      .flat()
      .map(normalizeStrategy);

    return {
      agents,
      strategies,
      matches: rawMatches.map(normalizeRecord),
      leaderboard: rawLeaderboard.map(normalizeLeaderboard),
      mode: "live"
    };
  } catch {
    return {
      agents: fallbackAgents,
      strategies: fallbackStrategies,
      matches: fallbackMatches,
      leaderboard: mockLeaderboard,
      mode: "mock"
    };
  }
}

export function portalGoogleStartUrl(returnTo = "/portal"): string {
  return `${API_BASE_URL}/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export async function portalMe(): Promise<PortalMeResponse> {
  return requestJson<PortalMeResponse>("/api/portal/me", { credentials: "include" });
}

export async function portalDevLogin(input: {
  email: string;
  displayName?: string;
}): Promise<PortalSessionResponse> {
  return requestJson<PortalSessionResponse>("/api/portal/dev-login", {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(input)
  });
}

export async function portalLogout(): Promise<void> {
  await requestJson<{ ok: true }>("/api/auth/logout", { method: "POST", credentials: "include" });
}

export async function portalSaveProfile(input: {
  agentName: string;
  appearance: AgentAppearance;
  strategyText: string;
}): Promise<PortalProfile> {
  return requestJson<PortalProfile>("/api/portal/profile", {
    method: "PUT",
    credentials: "include",
    body: JSON.stringify(input)
  });
}

export async function portalCreateProductKey(input: {
  handle?: string;
  provider: LocalAgentProvider;
  localBaseUrl?: string;
}): Promise<PortalProductApiKeyResponse> {
  return requestJson<PortalProductApiKeyResponse>("/api/portal/product-keys", {
    method: "POST",
    credentials: "include",
    body: JSON.stringify(input)
  });
}

export async function portalRevokeProductKey(keyId: string): Promise<void> {
  await requestJson(`/api/portal/product-keys/${encodeURIComponent(keyId)}/revoke`, {
    method: "POST",
    credentials: "include"
  });
}

export async function portalInstallCommand(
  keyId: string,
  provider: LocalAgentProvider
): Promise<PortalInstallCommandResponse> {
  return requestJson<PortalInstallCommandResponse>(
    `/api/portal/install-command/${encodeURIComponent(keyId)}?provider=${provider}`,
    { credentials: "include" }
  );
}

export async function portalStrategyTemplates(): Promise<{ templates: StrategyPromptTemplate[] }> {
  return requestJson<{ templates: StrategyPromptTemplate[] }>("/api/portal/strategy-templates", {
    credentials: "include"
  });
}

export async function createAgent(
  name: string,
  existingCount: number,
  mode: ServerMode,
  appearance?: AgentAppearance
): Promise<AgentProfile> {
  if (mode === "live") {
    const detail = await requestJson<RawAgentDetail>("/agents", {
      method: "POST",
      body: JSON.stringify({ name, appearance })
    });
    return normalizeAgent(detail, existingCount);
  }

  const agent = createMockAgent(name, existingCount, appearance);
  fallbackAgents = [agent, ...fallbackAgents];
  return agent;
}

export async function updateAgent(
  agentId: string,
  updates: { name?: string; appearance?: AgentAppearance },
  mode: ServerMode
): Promise<AgentProfile> {
  if (mode === "live") {
    const raw = await requestJson<RawAgent>(`/agents/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      body: JSON.stringify(updates)
    });
    return normalizeAgent(raw);
  }

  const existing = fallbackAgents.find((agent) => agent.id === agentId);
  const nextAppearance = updates.appearance ?? existing?.appearance ?? defaultAppearance(0);
  const updated: AgentProfile = {
    ...(existing ??
      createMockAgent(updates.name ?? "Agent", fallbackAgents.length, nextAppearance)),
    name: updates.name?.trim() || existing?.name || "Agent",
    color: nextAppearance.color,
    accessory: nextAppearance.accessory,
    appearance: nextAppearance
  };
  fallbackAgents = fallbackAgents.map((agent) => (agent.id === agentId ? updated : agent));
  return updated;
}

export async function createStrategyVersion(
  agentId: string,
  prompt: string,
  mode: ServerMode
): Promise<AgentStrategyVersion> {
  if (mode === "live") {
    const raw = await requestJson<RawStrategyVersion>(
      `/agents/${encodeURIComponent(agentId)}/strategy-versions`,
      {
        method: "POST",
        body: JSON.stringify({ sourceText: prompt })
      }
    );
    return normalizeStrategy(raw);
  }

  const strategy = createStrategy(agentId, prompt, fallbackStrategies);
  fallbackStrategies = [strategy, ...fallbackStrategies];
  fallbackAgents = fallbackAgents.map((agent) =>
    agent.id === agentId ? { ...agent, currentStrategyVersionId: strategy.id } : agent
  );
  return strategy;
}

export async function startMatch(
  participantIds: string[],
  mode: ServerMode,
  mapId: MapPresetId = "royale"
): Promise<MatchRecord> {
  if (mode === "live") {
    const response = await requestJson<{ matchId: string; record: RawMatchRecord }>("/matches", {
      method: "POST",
      body: JSON.stringify({ agentIds: participantIds, mapId })
    });
    return normalizeRecord(response.record);
  }

  const record = createMatchRecord(participantIds, mapId);
  fallbackMatches = [record, ...fallbackMatches];
  return record;
}

export async function getReplay(matchId: string, mode: ServerMode): Promise<ReplayFile> {
  if (mode === "live") {
    const raw = await requestJson<RawReplayFile>(`/matches/${encodeURIComponent(matchId)}/replay`);
    return normalizeReplay(raw);
  }
  return createMockReplay(
    matchId,
    fallbackMatches.find((match) => match.id === matchId)?.mapId ?? "royale"
  );
}

export async function getDecisions(matchId: string, mode: ServerMode): Promise<DecisionLogEntry[]> {
  if (mode === "live") {
    const raw = await requestJson<RawDecision[]>(
      `/matches/${encodeURIComponent(matchId)}/decisions`
    );
    return raw.map(normalizeDecision);
  }
  return collectMockDecisions(matchId);
}

export function buildMatchWebSocketUrl(matchId: string) {
  const base = new URL(API_BASE_URL);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `/matches/${encodeURIComponent(matchId)}/ws`;
  base.search = "";
  return base.toString();
}

export function normalizeSocketMessage(input: unknown): NormalizedSocketMessage {
  const message = input as RawSocketMessage;
  if (message.type === "decision") {
    return {
      type: "decision",
      decision: normalizeDecision(message.decision)
    };
  }
  if (message.type === "finished") {
    return {
      type: "finished",
      record: normalizeRecord(message.record),
      replay: normalizeReplay(message.replay)
    };
  }
  return {
    type: "snapshot",
    state: normalizeState(message.state)
  };
}

async function checkHealth(): Promise<ServerMode> {
  try {
    await requestJson<{ ok?: boolean; status?: string }>("/health", { timeoutMs: 1200 });
    return "live";
  } catch {
    return "mock";
  }
}

async function requestJson<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new ApiRequestError(`Request failed: ${response.status}`, response.status);
    }

    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

interface RawAgent {
  id: string;
  name: string;
  appearance?: Partial<AgentAppearance>;
  createdAt: string;
  currentStrategyVersionId?: string;
}

interface RawAgentDetail extends RawAgent {
  strategyVersions?: RawStrategyVersion[];
}

interface RawStrategyVersion {
  id: string;
  agentId: string;
  version: number;
  sourceText: string;
  createdAt: string;
  strategy?: {
    notes?: string[];
    tone?: string;
    tactics?: Record<string, string | number | boolean>;
  };
}

interface RawLeaderboardEntry {
  agentId: string;
  name: string;
  matches: number;
  wins: number;
  winRate: number;
  score: number;
}

interface RawMatchRecord {
  id: string;
  seed: string;
  engineVersion?: string;
  rulesVersion?: string;
  agentProtocolVersion?: string;
  mapId?: string;
  status: "waiting" | "running" | "finished";
  createdAt: string;
  finishedAt?: string;
  durationTicks: number;
  winnerAgentId?: string;
  finishReason?: string;
  participants: Array<{
    agentId: string;
    name: string;
    score: number;
    survived: boolean;
    appearance?: Partial<AgentAppearance>;
    strategyVersionId?: string;
  }>;
}

interface RawGameMap {
  id?: string;
  name?: string;
  width: number;
  height: number;
  cells: CellKind[];
}

interface RawPlayerState {
  id: string;
  name: string;
  appearance?: Partial<AgentAppearance>;
  color?: string;
  accessory?: AgentAccessory;
  x: number;
  y: number;
  alive: boolean;
  bubbleCapacity: number;
  activeBubbleCount: number;
  blastRange: number;
  speedBoostTicks?: number;
  shieldCharges?: number;
  pierceCharges?: number;
  quickFuseCharges?: number;
  zoneExposureTicks?: number;
}

interface RawBubbleState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  explodeAtTick: number;
  range: number;
  pierce?: number;
  quickFuse?: boolean;
}

interface RawBlastState {
  id: string;
  x: number;
  y: number;
  expiresAtTick: number;
  ownerId?: string;
}

interface RawItemState {
  id: string;
  type: ItemType;
  x: number;
  y: number;
}

interface RawMatchState {
  matchId: string;
  engineVersion?: string;
  rulesVersion?: string;
  mapId?: string;
  tick: number;
  status: "waiting" | "running" | "finished";
  map: RawGameMap;
  players: RawPlayerState[];
  bubbles: RawBubbleState[];
  blasts: RawBlastState[];
  items: RawItemState[];
  seed: string;
  zone?: ZoneState;
  winnerAgentId?: string;
  finishReason?: string;
}

interface RawDecision {
  matchId: string;
  tick: number;
  agentId: string;
  strategyVersionId?: string;
  action: {
    agentId: string;
    type: "wait" | "move" | "place_bubble";
    direction?: "up" | "down" | "left" | "right";
  };
  reason: string;
  target?: { x: number; y: number };
  risk: "none" | "low" | "medium" | "high";
  evidence?: string[];
}

interface RawReplayFile {
  matchId: string;
  seed: string;
  engineVersion?: string;
  rulesVersion?: string;
  agentProtocolVersion?: string;
  createdAt: string;
  strategies: RawStrategyVersion[];
  frames: Array<{
    tick: number;
    state: RawMatchState;
    events: unknown[];
  }>;
}

type RawSocketMessage =
  | { type: "snapshot"; state: RawMatchState }
  | { type: "decision"; decision: RawDecision }
  | { type: "finished"; record: RawMatchRecord; replay: RawReplayFile };

export type NormalizedSocketMessage =
  | { type: "snapshot"; state: MatchState }
  | { type: "decision"; decision: DecisionLogEntry }
  | { type: "finished"; record: MatchRecord; replay: ReplayFile };

function normalizeAgent(raw: RawAgent, index?: number): AgentProfile {
  const paletteIndex = index ?? colorIndex(raw.id);
  const appearance = normalizeAppearance(raw.appearance, raw.id, paletteIndex);
  const agent: AgentProfile = {
    id: raw.id,
    name: raw.name,
    callsign: `${raw.name.slice(0, 1).toUpperCase()}-${String(paletteIndex + 1).padStart(2, "0")}`,
    color: appearance.color,
    accessory: appearance.accessory,
    appearance,
    createdAt: raw.createdAt
  };
  if (raw.currentStrategyVersionId) {
    agent.currentStrategyVersionId = raw.currentStrategyVersionId;
  }
  return agent;
}

function normalizeStrategy(raw: RawStrategyVersion): AgentStrategyVersion {
  const notes = raw.strategy?.notes ?? [];
  const strategy: AgentStrategyVersion = {
    id: raw.id,
    agentId: raw.agentId,
    version: raw.version,
    prompt: raw.sourceText,
    summary: notes[0] ?? raw.strategy?.tone ?? raw.sourceText.slice(0, 86),
    createdAt: raw.createdAt
  };
  if (raw.strategy?.tactics) {
    strategy.tactics = raw.strategy.tactics;
  }
  return strategy;
}

function normalizeRecord(raw: RawMatchRecord): MatchRecord {
  const record: MatchRecord = {
    id: raw.id,
    status: raw.status,
    seed: raw.seed,
    mapId: normalizeMapId(raw.mapId),
    createdAt: raw.createdAt,
    participantIds: raw.participants.map((participant) => participant.agentId),
    participants: raw.participants.map((participant) => {
      const normalized = {
        agentId: participant.agentId,
        name: participant.name,
        score: participant.score,
        survived: participant.survived
      };
      return participant.strategyVersionId
        ? { ...normalized, strategyVersionId: participant.strategyVersionId }
        : normalized;
    }),
    totalTicks: raw.durationTicks
  };
  if (raw.finishedAt) {
    record.finishedAt = raw.finishedAt;
  }
  if (raw.engineVersion) {
    record.engineVersion = raw.engineVersion;
  }
  if (raw.rulesVersion) {
    record.rulesVersion = raw.rulesVersion;
  }
  if (raw.agentProtocolVersion) {
    record.agentProtocolVersion = raw.agentProtocolVersion;
  }
  if (raw.winnerAgentId) {
    record.winnerAgentId = raw.winnerAgentId;
  }
  return record;
}

function normalizeLeaderboard(raw: RawLeaderboardEntry): LeaderboardRow {
  return {
    agentId: raw.agentId,
    name: raw.name,
    matches: raw.matches,
    wins: raw.wins,
    losses: Math.max(0, raw.matches - raw.wins),
    winRate: raw.winRate,
    rating: 1000 + raw.score + raw.wins * 45
  };
}

function normalizeState(raw: RawMatchState): MatchState {
  const mapId = normalizeMapId(raw.mapId ?? raw.map.id);
  const map = {
    id: mapId,
    name: raw.map.name ?? mapLabel(mapId),
    width: raw.map.width,
    height: raw.map.height,
    rows: rowsFromCells(raw.map)
  };
  return {
    ...raw,
    mapId,
    map,
    players: raw.players.map((player, index) => {
      const playerAppearanceInput: Partial<AgentAppearance> = { ...(player.appearance ?? {}) };
      if (player.color) {
        playerAppearanceInput.color = player.color;
      }
      if (player.accessory) {
        playerAppearanceInput.accessory = player.accessory;
      }
      const appearance = normalizeAppearance(playerAppearanceInput, player.id, index);
      return {
        ...player,
        appearance,
        color: appearance.color,
        accessory: appearance.accessory,
        speedBoostTicks: player.speedBoostTicks ?? 0,
        shieldCharges: player.shieldCharges ?? 0,
        pierceCharges: player.pierceCharges ?? 0,
        quickFuseCharges: player.quickFuseCharges ?? 0,
        zoneExposureTicks: player.zoneExposureTicks ?? 0
      };
    }),
    zone: raw.zone ?? fallbackZone(map)
  };
}

function normalizeDecision(raw: RawDecision): DecisionLogEntry {
  const decision: DecisionLogEntry = {
    id: `${raw.matchId}-${raw.tick}-${raw.agentId}-${raw.action.type}`,
    matchId: raw.matchId,
    tick: raw.tick,
    agentId: raw.agentId,
    action: {
      type: raw.action.type
    },
    reason: raw.reason,
    risk: riskScore(raw.risk)
  };
  if (raw.action.direction) {
    decision.action.direction = raw.action.direction;
  }
  if (raw.target) {
    decision.target = raw.target;
  }
  if (raw.strategyVersionId) {
    decision.strategyVersionId = raw.strategyVersionId;
  }
  return decision;
}

function normalizeReplay(raw: RawReplayFile): ReplayFile {
  const frames = raw.frames.map((frame) => ({
    tick: frame.tick,
    state: normalizeState(frame.state),
    events: (frame.events as RawEvent[]).map((event, index) => normalizeEvent(event, index))
  }));
  return {
    matchId: raw.matchId,
    seed: raw.seed,
    ...(raw.engineVersion ? { engineVersion: raw.engineVersion } : {}),
    ...(raw.rulesVersion ? { rulesVersion: raw.rulesVersion } : {}),
    ...(raw.agentProtocolVersion ? { agentProtocolVersion: raw.agentProtocolVersion } : {}),
    createdAt: raw.createdAt,
    strategyVersions: raw.strategies.map(normalizeStrategy),
    frames,
    summaryEvents: frames.flatMap((frame) => frame.events).filter(isReplayKeyEvent)
  };
}

interface RawEvent {
  type?: string;
  tick?: number;
  agentId?: string;
  winnerAgentId?: string;
  reason?: string;
  position?: { x: number; y: number };
  item?: { type?: ItemType; x: number; y: number };
  bubble?: { ownerId: string; x: number; y: number };
}

function normalizeEvent(raw: RawEvent, index = 0): GameEvent {
  const normalizedType =
    raw.type === "moved" || raw.type === "tick" ? "move" : (raw.type ?? "move");
  const type = normalizedType as GameEvent["type"];
  const tick = raw.tick ?? 0;
  const event: GameEvent = {
    id: `event-${tick}-${type}-${raw.agentId ?? raw.winnerAgentId ?? raw.bubble?.ownerId ?? "system"}-${index}`,
    tick,
    type,
    message: eventMessage(type, raw)
  };
  const agentId = raw.agentId ?? raw.winnerAgentId ?? raw.bubble?.ownerId;
  const position = raw.position ?? raw.item ?? raw.bubble;
  if (agentId) {
    event.agentId = agentId;
  }
  if (position) {
    event.position = position;
  }
  if (raw.item?.type) {
    event.itemType = raw.item.type;
  }
  return event;
}

function eventMessage(type: string, raw: RawEvent): string {
  if (type === "bubble_placed")
    return `${raw.bubble?.ownerId ?? raw.agentId ?? "Agent"} 放置水泡。`;
  if (type === "bubble_exploded") return "水泡爆炸并刷新危险区。";
  if (type === "wall_destroyed") return "软墙被炸开。";
  if (type === "item_spawned") return `道具出现：${raw.item?.type ?? "item"}`;
  if (type === "item_collected")
    return `${raw.agentId ?? "Agent"} 拾取 ${raw.item?.type ?? "道具"}。`;
  if (type === "shield_absorbed") return `${raw.agentId ?? "Agent"} 的护盾抵消爆炸。`;
  if (type === "eliminated") {
    return raw.reason === "zone"
      ? `${raw.agentId ?? "Agent"} 在毒圈外被淘汰。`
      : `${raw.agentId ?? "Agent"} 被淘汰。`;
  }
  if (type === "finished") return raw.winnerAgentId ? `${raw.winnerAgentId} 获胜。` : "对局结束。";
  return raw.reason ?? type.replaceAll("_", " ");
}

function isReplayKeyEvent(event: GameEvent): boolean {
  return [
    "bubble_placed",
    "bubble_exploded",
    "wall_destroyed",
    "item_spawned",
    "item_collected",
    "shield_absorbed",
    "eliminated",
    "finished"
  ].includes(event.type);
}

function rowsFromCells(map: RawGameMap): CellKind[][] {
  return Array.from({ length: map.height }, (_, y) =>
    Array.from({ length: map.width }, (_, x) => map.cells[y * map.width + x] ?? "empty")
  );
}

function normalizeMapId(mapId: string | undefined): MapPresetId {
  return mapId === "classic" ||
    mapId === "open-court" ||
    mapId === "crossfire" ||
    mapId === "maze" ||
    mapId === "royale"
    ? mapId
    : "royale";
}

function mapLabel(mapId: MapPresetId): string {
  if (mapId === "royale") return "Royale Ruins";
  if (mapId === "open-court") return "Open Court";
  if (mapId === "crossfire") return "Crossfire";
  if (mapId === "maze") return "Maze";
  return "Classic Yard";
}

function fallbackZone(map: { width: number; height: number }): ZoneState {
  const center = { x: (map.width - 1) / 2, y: (map.height - 1) / 2 };
  const radius = Math.ceil(Math.hypot(map.width, map.height) / 2);
  return {
    enabled: false,
    phase: 0,
    status: "stable",
    center,
    radius,
    fromCenter: center,
    fromRadius: radius,
    targetCenter: center,
    targetRadius: radius,
    shrinkStartTick: 0,
    shrinkEndTick: 0,
    nextShrinkStartTick: 0,
    finalRadius: radius,
    damageGraceTicks: 0
  };
}

function riskScore(risk: RawDecision["risk"]): number {
  if (risk === "high") return 0.9;
  if (risk === "medium") return 0.58;
  if (risk === "low") return 0.25;
  return 0;
}

function colorIndex(id: string): number {
  return Math.abs([...id].reduce((total, char) => total + char.charCodeAt(0), 0)) % 8;
}

function agentColor(id: string, fallbackIndex = 0): string {
  const palette = [
    "#f97316",
    "#84cc16",
    "#38bdf8",
    "#eab308",
    "#fb7185",
    "#a3e635",
    "#22c55e",
    "#facc15"
  ];
  return palette[colorIndex(id) || fallbackIndex % palette.length] ?? "#f97316";
}

function defaultAppearance(index: number): AgentAppearance {
  return {
    color: agentColor(`agent-${index}`, index),
    accessory: "none",
    skinId: normalizeAgentSkinId(undefined, index)
  };
}

function normalizeAppearance(
  appearance: Partial<AgentAppearance> | undefined,
  id: string,
  fallbackIndex: number
): AgentAppearance {
  const fallback = defaultAppearance(fallbackIndex);
  return {
    color: normalizeColor(appearance?.color ?? agentColor(id, fallbackIndex) ?? fallback.color),
    accessory: normalizeAccessory(appearance?.accessory ?? fallback.accessory),
    skinId: normalizeAgentSkinId(appearance?.skinId ?? fallback.skinId, fallbackIndex)
  };
}

function normalizeColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#f97316";
}

function normalizeAccessory(accessory: string): AgentAccessory {
  return ["none", "cap", "visor", "scarf", "crown", "antenna"].includes(accessory)
    ? (accessory as AgentAccessory)
    : "none";
}

function normalizeApiBaseUrl(configured: string | undefined): string {
  const trimmed = configured?.trim();
  if (trimmed) {
    return trimmed.replace(/\/$/, "");
  }
  if (import.meta.env.DEV) {
    return "http://localhost:3001";
  }
  return window.location.origin;
}
