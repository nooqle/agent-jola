import {
  DIRECTIONS,
  ENGINE_VERSION,
  RULES_VERSION,
  getCell,
  movePosition,
  samePosition,
  type AgentAction,
  type BubbleState,
  type DecisionLogEntry,
  type Direction,
  type GameEvent,
  type MapPresetId,
  type MatchRecord,
  type MatchState,
  type PlayerState,
  type Position
} from "@agent-bomber/core";
import type { ReplayFile } from "@agent-bomber/replay";
import type {
  AgentAppearance,
  AgentProfile,
  AgentStrategyVersion,
  StrategyPromptTemplate
} from "@agent-bomber/strategy";

export const AGENT_PROTOCOL_VERSION = "agent-jola-agent@1";

export type { AgentAppearance, AgentProfile, AgentStrategyVersion };

export interface HealthResponse {
  ok: true;
  service: "agent-bomber-server";
  time: string;
}

export type ProductApiScope =
  | "profile:read"
  | "profile:write"
  | "templates:read"
  | "rooms:read"
  | "rooms:write"
  | "bridge"
  | "leaderboard:read";

export interface ProductApiUser {
  id: string;
  handle: string;
  mode: "local-dev" | "configured" | "issued";
  scopes: ProductApiScope[];
}

export interface ProductApiAuthInfo {
  header: "X-Agent-Jola-Key";
  legacyHeaders?: string[];
  authorization: "Bearer";
  source: "env" | "issuer" | "local-dev-default" | "missing";
  scopes: ProductApiScope[];
}

export interface CreateProductApiKeyRequest {
  handle?: string;
  scopes?: ProductApiScope[];
  ttlSeconds?: number;
}

export interface CreateProductApiKeyResponse {
  id: string;
  key: string;
  user: ProductApiUser;
  createdAt: string;
  expiresAt?: string;
}

export type PortalAuthProvider = "google" | "dev";

export interface PortalUser {
  id: string;
  provider: PortalAuthProvider;
  providerSubject: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PortalProfile {
  userId: string;
  agentName: string;
  appearance: AgentAppearance;
  strategyText: string;
  updatedAt: string;
}

export interface PortalSessionResponse {
  user: PortalUser;
  portalToken: string;
  expiresAt: string;
}

export type LocalAgentProvider = "mock" | "openai" | "anthropic";

export interface PortalInstallCommandResponse {
  baseUrl: string;
  cloudUrl: string;
  provider: LocalAgentProvider;
  commands: {
    clone: string;
    install: string;
    configure: string;
    syncProfile: string;
    runServer: string;
    runAgent: string;
    openWeb: string;
  };
  scripts?: {
    windowsPowerShell: string;
    posixShell: string;
  };
  env: Record<string, string>;
}

export interface PortalProductApiKeyResponse extends CreateProductApiKeyResponse {
  install: PortalInstallCommandResponse;
}

export interface PortalMeResponse {
  user: PortalUser;
  profile: PortalProfile | null;
  keys: ProductApiKeyRecord[];
  quotas?: ProductApiQuotaPolicy[];
}

export interface RuntimeProfileResponse {
  user: ProductApiUser;
  profile: PortalProfile;
}

export interface ProductApiKeyRecord {
  id: string;
  userId: string;
  handle: string;
  scopes: ProductApiScope[];
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
}

export type ProductApiKeyStatus = "active" | "expired" | "revoked" | "missing";

export type ProductApiQuotaKey =
  | "character_randomize"
  | "room_create"
  | "template_read"
  | "template_apply"
  | "bridge_prompt";

export interface ProductApiQuotaPolicy {
  key: ProductApiQuotaKey;
  label: string;
  limit: number | null;
  remaining: number | null;
  used?: number;
  resetAt?: string;
}

export interface AgentDetail extends AgentProfile {
  currentStrategyVersion?: AgentStrategyVersion;
  strategyVersions: AgentStrategyVersion[];
}

export interface StrategyTemplatesResponse {
  templates: StrategyPromptTemplate[];
}

export interface StrategyTemplateDetailResponse {
  template: StrategyPromptTemplate;
  localAgentPrompt: string;
}

export interface ApplyStrategyTemplateRequest {
  templateId: string;
  name?: string;
  appearance?: Partial<AgentAppearance>;
}

export interface CreateAgentRequest {
  name: string;
  appearance?: Partial<AgentAppearance>;
  strategyText?: string;
}

export interface UpdateAgentRequest {
  name?: string;
  appearance?: Partial<AgentAppearance>;
}

export interface CreateStrategyVersionRequest {
  sourceText: string;
}

export interface CreateMatchRequest {
  agentIds: string[];
  seed?: string;
  mapId?: MapPresetId;
}

export interface CreateMatchResponse {
  matchId: string;
  record: MatchRecord;
}

export interface MatchDetailResponse {
  record: MatchRecord;
  state?: MatchState;
}

export interface LeaderboardEntry {
  agentId: string;
  name: string;
  matches: number;
  wins: number;
  winRate: number;
  score: number;
}

export type RoomMode = "royale-4";

export type RoomStatus = "draft" | "ready" | "running" | "finished" | "cancelled";

export interface RoomParticipant {
  agentId: string;
  name: string;
  appearance?: AgentAppearance;
  strategyVersionId?: string;
  ready: boolean;
  joinedAt: string;
}

export interface RoomRecord {
  id: string;
  inviteCode: string;
  mode: RoomMode;
  status: RoomStatus;
  mapId: MapPresetId;
  createdAt: string;
  updatedAt: string;
  maxParticipants: 4;
  participants: RoomParticipant[];
  hostAgentId?: string;
  matchId?: string;
}

export interface CreateRoomRequest {
  hostAgentId?: string;
  mapId?: MapPresetId;
}

export interface JoinRoomRequest {
  agentId: string;
}

export interface LeaveRoomRequest {
  agentId: string;
}

export interface SetRoomReadyRequest {
  agentId: string;
  ready: boolean;
}

export interface StartRoomRequest {
  seed?: string;
}

export interface StartRoomResponse {
  room: RoomRecord;
  matchId: string;
  record: MatchRecord;
}

export interface DangerCell extends Position {
  source: "blast" | "bubble";
  ownerId?: string;
  active: boolean;
  earliestTick: number;
}

export interface AgentObservation {
  protocolVersion: typeof AGENT_PROTOCOL_VERSION;
  engineVersion: string;
  rulesVersion: string;
  matchId: string;
  tick: number;
  agentId: string;
  you: PlayerState;
  map: MatchState["map"];
  zone: MatchState["zone"];
  players: PlayerState[];
  bubbles: BubbleState[];
  blasts: MatchState["blasts"];
  items: MatchState["items"];
  dangerCells: DangerCell[];
  legalActions: AgentAction[];
}

export interface AgentActionRequest {
  type: "observe";
  requestId: string;
  observation: AgentObservation;
  deadlineMs: number;
}

export interface AgentActionResponse {
  protocolVersion: typeof AGENT_PROTOCOL_VERSION;
  requestId: string;
  matchId: string;
  tick: number;
  agentId: string;
  action: AgentAction;
  reason?: string;
}

export interface LocalAgentControllerStatus {
  agentId: string;
  connected: boolean;
  label?: string;
  activeMatchId?: string;
  latestRequestId?: string;
  latestTick?: number;
  submittedRequestId?: string;
  fallback: "internal-planner";
}

export interface ConnectLocalAgentRequest {
  label?: string;
}

export interface ConnectLocalAgentResponse {
  status: LocalAgentControllerStatus;
  observeUrl: string;
  actionUrl: string;
}

export interface LocalAgentObserveResponse {
  status: LocalAgentControllerStatus;
  request?: AgentActionRequest;
}

export interface SubmitLocalAgentActionRequest {
  requestId: string;
  matchId: string;
  tick: number;
  action: AgentAction;
  reason?: string;
}

export interface SubmitLocalAgentActionResponse {
  accepted: boolean;
  status: LocalAgentControllerStatus;
  action: AgentAction;
}

export const AGENT_ACTION_TOOL_NAME = "choose_agent_action";

export type AgentBridgeProvider = "openai-chat" | "openai-responses" | "anthropic-messages";

type JsonSchema = Record<string, unknown>;

export interface ProviderAgentActionExtraction {
  action: AgentAction;
  reason?: string;
  rawInput?: unknown;
}

export interface OpenAIChatAgentRequest {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  tools: Array<{
    type: "function";
    function: {
      name: typeof AGENT_ACTION_TOOL_NAME;
      description: string;
      parameters: JsonSchema;
      strict?: boolean;
    };
  }>;
  tool_choice: {
    type: "function";
    function: { name: typeof AGENT_ACTION_TOOL_NAME };
  };
  parallel_tool_calls: false;
}

export interface OpenAIResponsesAgentRequest {
  model: string;
  input: Array<{ role: "system" | "user"; content: string }>;
  tools: Array<{
    type: "function";
    name: typeof AGENT_ACTION_TOOL_NAME;
    description: string;
    parameters: JsonSchema;
    strict?: boolean;
  }>;
  tool_choice: { type: "function"; name: typeof AGENT_ACTION_TOOL_NAME };
  parallel_tool_calls: false;
}

export interface AnthropicMessagesAgentRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: "user"; content: Array<{ type: "text"; text: string }> }>;
  tools: Array<{
    name: typeof AGENT_ACTION_TOOL_NAME;
    description: string;
    input_schema: JsonSchema;
  }>;
  tool_choice: { type: "tool"; name: typeof AGENT_ACTION_TOOL_NAME };
}

const agentActionToolDescription =
  "Choose exactly one legal Agent Bomber action for the current tick. Use wait when no safe action is available.";

const agentActionToolInputSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: {
          type: "string",
          enum: ["wait", "move", "place_bubble"],
          description: "The action type to execute this tick."
        },
        direction: {
          type: "string",
          enum: DIRECTIONS,
          description: "Required only when action.type is move."
        }
      },
      required: ["type"]
    },
    reason: {
      type: "string",
      minLength: 1,
      maxLength: 240,
      description: "Short tactical reason in the user's language."
    }
  },
  required: ["action", "reason"]
};

const AGENT_DECISION_SYSTEM_PROMPT = [
  "You control one Agent in a deterministic grid-bomb royale match.",
  "Your only job is to choose one safe and useful action for this tick.",
  "Prefer survival over attacks when the danger zone, blasts, or bubbles make the next cell unsafe.",
  "Only call the choose_agent_action tool. Do not answer in natural language outside the tool call."
].join(" ");

export function createOpenAIChatAgentRequest(
  request: AgentActionRequest,
  model = "gpt-4.1"
): OpenAIChatAgentRequest {
  return {
    model,
    messages: [
      { role: "system", content: AGENT_DECISION_SYSTEM_PROMPT },
      { role: "user", content: createAgentDecisionPrompt(request) }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: AGENT_ACTION_TOOL_NAME,
          description: agentActionToolDescription,
          parameters: agentActionToolInputSchema,
          strict: false
        }
      }
    ],
    tool_choice: { type: "function", function: { name: AGENT_ACTION_TOOL_NAME } },
    parallel_tool_calls: false
  };
}

export function createOpenAIResponsesAgentRequest(
  request: AgentActionRequest,
  model = "gpt-4.1"
): OpenAIResponsesAgentRequest {
  return {
    model,
    input: [
      { role: "system", content: AGENT_DECISION_SYSTEM_PROMPT },
      { role: "user", content: createAgentDecisionPrompt(request) }
    ],
    tools: [
      {
        type: "function",
        name: AGENT_ACTION_TOOL_NAME,
        description: agentActionToolDescription,
        parameters: agentActionToolInputSchema,
        strict: false
      }
    ],
    tool_choice: { type: "function", name: AGENT_ACTION_TOOL_NAME },
    parallel_tool_calls: false
  };
}

export function createAnthropicMessagesAgentRequest(
  request: AgentActionRequest,
  model = "claude-sonnet-4-20250514"
): AnthropicMessagesAgentRequest {
  return {
    model,
    max_tokens: 512,
    system: AGENT_DECISION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: createAgentDecisionPrompt(request) }]
      }
    ],
    tools: [
      {
        name: AGENT_ACTION_TOOL_NAME,
        description: agentActionToolDescription,
        input_schema: agentActionToolInputSchema
      }
    ],
    tool_choice: { type: "tool", name: AGENT_ACTION_TOOL_NAME }
  };
}

export function extractOpenAIChatAgentAction(
  agentId: string,
  response: unknown
): ProviderAgentActionExtraction {
  const root = asRecord(response);
  const choices = asArray(root?.choices);
  for (const choice of choices) {
    const message = asRecord(asRecord(choice)?.message);
    const toolCalls = asArray(message?.tool_calls);
    for (const toolCall of toolCalls) {
      const call = asRecord(toolCall);
      const fn = asRecord(call?.function);
      if (fn?.name !== AGENT_ACTION_TOOL_NAME) {
        continue;
      }
      return providerActionChoiceToAgentAction(agentId, parseJsonArgument(fn.arguments));
    }
  }
  throw new Error("OpenAI Chat response did not contain a choose_agent_action tool call.");
}

export function extractOpenAIResponsesAgentAction(
  agentId: string,
  response: unknown
): ProviderAgentActionExtraction {
  const root = asRecord(response);
  const output = asArray(root?.output);
  for (const item of output) {
    const call = asRecord(item);
    if (call?.type !== "function_call" || call.name !== AGENT_ACTION_TOOL_NAME) {
      continue;
    }
    return providerActionChoiceToAgentAction(agentId, parseJsonArgument(call.arguments));
  }
  throw new Error("OpenAI Responses response did not contain a choose_agent_action function_call.");
}

export function extractAnthropicMessagesAgentAction(
  agentId: string,
  response: unknown
): ProviderAgentActionExtraction {
  const root = asRecord(response);
  const content = asArray(root?.content);
  for (const block of content) {
    const candidate = asRecord(block);
    if (candidate?.type !== "tool_use" || candidate.name !== AGENT_ACTION_TOOL_NAME) {
      continue;
    }
    return providerActionChoiceToAgentAction(agentId, candidate.input);
  }
  throw new Error(
    "Anthropic Messages response did not contain a choose_agent_action tool_use block."
  );
}

export function providerActionChoiceToAgentAction(
  agentId: string,
  input: unknown
): ProviderAgentActionExtraction {
  const inputRecord = asRecord(input);
  const actionRecord = asRecord(inputRecord?.action) ?? inputRecord;
  if (!actionRecord) {
    throw new Error("Agent action tool input must be an object.");
  }

  const reason =
    typeof inputRecord?.reason === "string" ? inputRecord.reason.slice(0, 240) : undefined;
  const extraction: ProviderAgentActionExtraction = {
    action: providerActionToNativeAction(agentId, actionRecord),
    rawInput: input
  };
  if (reason !== undefined) {
    extraction.reason = reason;
  }
  return extraction;
}

export function createAgentObservation(state: MatchState, agentId: string): AgentObservation {
  const you = state.players.find((player) => player.id === agentId);
  if (!you) {
    throw new Error(`Cannot create observation for missing agent: ${agentId}`);
  }
  return {
    protocolVersion: AGENT_PROTOCOL_VERSION,
    engineVersion: state.engineVersion ?? ENGINE_VERSION,
    rulesVersion: state.rulesVersion ?? RULES_VERSION,
    matchId: state.matchId,
    tick: state.tick,
    agentId,
    you,
    map: state.map,
    zone: state.zone,
    players: state.players,
    bubbles: state.bubbles,
    blasts: state.blasts,
    items: state.items,
    dangerCells: projectedDangerCells(state),
    legalActions: legalActionsForAgent(state, you)
  };
}

export function validateAgentAction(
  state: MatchState,
  agentId: string,
  action: unknown
): AgentAction {
  const fallback: AgentAction = { agentId, type: "wait" };
  if (!isActionLike(action) || action.agentId !== agentId) {
    return fallback;
  }
  const player = state.players.find((candidate) => candidate.id === agentId);
  if (!player?.alive) {
    return fallback;
  }
  const legalActions = legalActionsForAgent(state, player);
  const legal = legalActions.some((candidate) => sameAction(candidate, action));
  return legal ? action : fallback;
}

export type MatchWebSocketMessage =
  | {
      type: "snapshot";
      matchId: string;
      tick: number;
      state: MatchState;
      events: GameEvent[];
    }
  | {
      type: "decision";
      matchId: string;
      decision: DecisionLogEntry;
    }
  | {
      type: "finished";
      matchId: string;
      record: MatchRecord;
      replay: ReplayFile;
    };

function legalActionsForAgent(state: MatchState, player: PlayerState): AgentAction[] {
  if (!player.alive) {
    return [{ agentId: player.id, type: "wait" }];
  }
  const actions: AgentAction[] = [{ agentId: player.id, type: "wait" }];
  if (canPlaceBubble(state, player)) {
    actions.push({ agentId: player.id, type: "place_bubble" });
  }
  if (player.moveCooldown <= 0) {
    for (const direction of DIRECTIONS) {
      const target = movePosition(player, direction);
      if (getCell(state.map, target) !== "empty") {
        continue;
      }
      if (state.bubbles.some((bubble) => samePosition(bubble, target))) {
        continue;
      }
      if (
        state.players.some(
          (candidate) =>
            candidate.alive && candidate.id !== player.id && samePosition(candidate, target)
        )
      ) {
        continue;
      }
      actions.push({ agentId: player.id, type: "move", direction });
    }
  }
  return actions;
}

function createAgentDecisionPrompt(request: AgentActionRequest): string {
  return JSON.stringify(
    {
      type: "agent_bomber_decision",
      requestId: request.requestId,
      deadlineMs: request.deadlineMs,
      observation: compactObservation(request.observation),
      instruction:
        "Pick one action from legalActions. Return it by calling choose_agent_action with action and a short reason."
    },
    null,
    2
  );
}

function compactObservation(observation: AgentObservation) {
  return {
    protocolVersion: observation.protocolVersion,
    matchId: observation.matchId,
    tick: observation.tick,
    agentId: observation.agentId,
    you: compactPlayer(observation.you),
    map: {
      id: observation.map.id,
      width: observation.map.width,
      height: observation.map.height,
      rows: mapRows(observation.map)
    },
    zone: observation.zone.enabled
      ? {
          status: observation.zone.status,
          phase: observation.zone.phase,
          center: observation.zone.center,
          radius: observation.zone.radius,
          targetCenter: observation.zone.targetCenter,
          targetRadius: observation.zone.targetRadius,
          shrinkStartTick: observation.zone.shrinkStartTick,
          shrinkEndTick: observation.zone.shrinkEndTick,
          nextShrinkStartTick: observation.zone.nextShrinkStartTick,
          damageGraceTicks: observation.zone.damageGraceTicks
        }
      : { enabled: false },
    players: observation.players.map(compactPlayer),
    bubbles: observation.bubbles.map((bubble) => ({
      id: bubble.id,
      ownerId: bubble.ownerId,
      x: bubble.x,
      y: bubble.y,
      explodeAtTick: bubble.explodeAtTick,
      range: bubble.range,
      pierce: bubble.pierce,
      quickFuse: bubble.quickFuse
    })),
    blasts: observation.blasts.map((blast) => ({
      ownerId: blast.ownerId,
      x: blast.x,
      y: blast.y,
      expiresAtTick: blast.expiresAtTick
    })),
    items: observation.items.map((item) => ({ type: item.type, x: item.x, y: item.y })),
    dangerCells: observation.dangerCells.slice(0, 160).map((cell) => ({
      x: cell.x,
      y: cell.y,
      source: cell.source,
      active: cell.active,
      earliestTick: cell.earliestTick,
      ownerId: cell.ownerId
    })),
    legalActions: observation.legalActions.map((action) => {
      if (action.type === "move") {
        return { type: action.type, direction: action.direction };
      }
      return { type: action.type };
    })
  };
}

function compactPlayer(player: PlayerState) {
  return {
    id: player.id,
    name: player.name,
    alive: player.alive,
    x: player.x,
    y: player.y,
    direction: player.direction,
    moveCooldown: player.moveCooldown,
    bubbleCapacity: player.bubbleCapacity,
    activeBubbleCount: player.activeBubbleCount,
    blastRange: player.blastRange,
    speedBoostTicks: player.speedBoostTicks,
    shieldCharges: player.shieldCharges,
    pierceCharges: player.pierceCharges,
    quickFuseCharges: player.quickFuseCharges,
    zoneExposureTicks: player.zoneExposureTicks,
    score: player.score
  };
}

function mapRows(map: MatchState["map"]): string[] {
  const rows: string[] = [];
  for (let y = 0; y < map.height; y += 1) {
    let row = "";
    for (let x = 0; x < map.width; x += 1) {
      const cell = getCell(map, { x, y });
      row += cell === "solid" ? "#" : cell === "soft" ? "+" : ".";
    }
    rows.push(row);
  }
  return rows;
}

function providerActionToNativeAction(
  agentId: string,
  action: Record<string, unknown>
): AgentAction {
  if (action.type === "wait") {
    return { agentId, type: "wait" };
  }
  if (action.type === "place_bubble") {
    return { agentId, type: "place_bubble" };
  }
  if (action.type === "move" && isDirection(action.direction)) {
    return { agentId, type: "move", direction: action.direction };
  }
  throw new Error("Agent action tool input contains an unsupported action.");
}

function parseJsonArgument(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("Agent action tool arguments were not valid JSON.");
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && DIRECTIONS.includes(value as Direction);
}

function canPlaceBubble(state: MatchState, player: PlayerState): boolean {
  return (
    player.activeBubbleCount < player.bubbleCapacity &&
    !state.bubbles.some((bubble) => samePosition(bubble, player))
  );
}

function projectedDangerCells(state: MatchState): DangerCell[] {
  const danger = new Map<string, DangerCell>();
  for (const blast of state.blasts) {
    danger.set(positionKey(blast), {
      x: blast.x,
      y: blast.y,
      source: "blast",
      ownerId: blast.ownerId,
      active: true,
      earliestTick: state.tick
    });
  }
  for (const bubble of state.bubbles) {
    for (const cell of bubbleBlastCells(state, bubble)) {
      const key = positionKey(cell);
      const existing = danger.get(key);
      if (!existing || bubble.explodeAtTick < existing.earliestTick) {
        danger.set(key, {
          x: cell.x,
          y: cell.y,
          source: "bubble",
          ownerId: bubble.ownerId,
          active: false,
          earliestTick: bubble.explodeAtTick
        });
      }
    }
  }
  return [...danger.values()].sort(
    (left, right) => left.earliestTick - right.earliestTick || left.y - right.y || left.x - right.x
  );
}

function bubbleBlastCells(state: MatchState, bubble: BubbleState): Position[] {
  const cells: Position[] = [{ x: bubble.x, y: bubble.y }];
  for (const direction of DIRECTIONS) {
    let cursor: Position = { x: bubble.x, y: bubble.y };
    let pierceLeft = bubble.pierce;
    for (let distance = 0; distance < bubble.range; distance += 1) {
      cursor = movePosition(cursor, direction);
      const cell = getCell(state.map, cursor);
      if (!cell || cell === "solid") {
        break;
      }
      cells.push({ x: cursor.x, y: cursor.y });
      if (cell === "soft") {
        if (pierceLeft <= 0) {
          break;
        }
        pierceLeft -= 1;
      }
    }
  }
  return cells;
}

function sameAction(left: AgentAction, right: AgentAction): boolean {
  return (
    left.agentId === right.agentId &&
    left.type === right.type &&
    ("direction" in left ? left.direction : undefined) ===
      ("direction" in right ? right.direction : undefined)
  );
}

function isActionLike(action: unknown): action is AgentAction {
  if (typeof action !== "object" || action === null) {
    return false;
  }
  const candidate = action as Record<string, unknown>;
  if (typeof candidate.agentId !== "string") {
    return false;
  }
  if (candidate.type === "wait" || candidate.type === "place_bubble") {
    return true;
  }
  return candidate.type === "move" && typeof candidate.direction === "string";
}

function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}
