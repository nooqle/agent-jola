import "./load-env.js";
import type {
  AgentActionRequest,
  AgentBridgeProvider,
  AgentDetail,
  AgentProfile,
  AnthropicMessagesAgentRequest,
  ApplyStrategyTemplateRequest,
  OpenAIResponsesAgentRequest,
  ProductApiAuthInfo,
  ProductApiQuotaPolicy,
  ProductApiUser,
  RoomRecord,
  RuntimeProfileResponse,
  StartRoomResponse,
  StrategyTemplateDetailResponse,
  StrategyTemplatesResponse
} from "@agent-poppy/protocol";

export const DEFAULT_BASE_URL = "http://127.0.0.1:3001";
export const DEFAULT_LOCAL_PRODUCT_API_KEY = "agent-poppy-local-dev-key";

export interface AgentPoppyClientOptions {
  baseUrl?: string;
  apiKey?: string;
}

export interface ProductMeResponse {
  user: ProductApiUser;
  auth: ProductApiAuthInfo;
  capabilities: {
    bridgeProviders: AgentBridgeProvider[];
    roomMode: "royale-4";
    localRuntime: boolean;
  };
  quotas: ProductApiQuotaPolicy[];
}

export interface ProductProfileResponse {
  user: ProductApiUser;
  agent: AgentDetail | null;
  agents: AgentProfile[];
}

export interface ProviderPromptResponse<TPayload> {
  status: {
    connected: boolean;
    activeMatchId?: string;
    latestTick?: number;
  };
  provider: AgentBridgeProvider;
  request?: AgentActionRequest;
  payload?: TPayload;
  actionUrl: string;
}

export interface ProviderLoopOptions<TPayload> {
  provider: AgentBridgeProvider;
  model: string;
  label: string;
  defaultAgentName: string;
  defaultStrategy: string;
  maxPolls: number;
  pollIntervalMs: number;
  client?: AgentPoppyClient;
  decide(payload: TPayload): Promise<unknown>;
}

export class AgentPoppyClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: AgentPoppyClientOptions = {}) {
    this.baseUrl = (
      options.baseUrl ?? envValue("AGENT_POPPY_BASE_URL", DEFAULT_BASE_URL)
    ).replace(/\/$/, "");
    this.apiKey = options.apiKey ?? envValue("AGENT_POPPY_API_KEY", DEFAULT_LOCAL_PRODUCT_API_KEY);
  }

  me(): Promise<ProductMeResponse> {
    return this.request<ProductMeResponse>("/api/me");
  }

  profile(): Promise<ProductProfileResponse> {
    return this.request<ProductProfileResponse>("/api/profile");
  }

  runtimeProfile(): Promise<RuntimeProfileResponse> {
    return this.request<RuntimeProfileResponse>("/api/runtime/profile");
  }

  upsertProfileAgent(input: {
    name?: string;
    appearance?: unknown;
    strategyText?: string;
  }): Promise<AgentDetail> {
    return this.request<AgentDetail>("/api/profile/agent", { method: "POST", body: input });
  }

  listStrategyTemplates(): Promise<StrategyTemplatesResponse> {
    return this.request<StrategyTemplatesResponse>("/api/strategy-templates");
  }

  getStrategyTemplate(
    templateId: string,
    agentName?: string
  ): Promise<StrategyTemplateDetailResponse> {
    const query = agentName ? `?agentName=${encodeURIComponent(agentName)}` : "";
    return this.request<StrategyTemplateDetailResponse>(
      `/api/strategy-templates/${encodeURIComponent(templateId)}${query}`
    );
  }

  applyStrategyTemplate(input: ApplyStrategyTemplateRequest): Promise<AgentDetail> {
    return this.request<AgentDetail>("/api/profile/agent/strategy-template", {
      method: "POST",
      body: input
    });
  }

  listAgents(): Promise<AgentProfile[]> {
    return this.request<AgentProfile[]>("/api/agents");
  }

  listRooms(): Promise<RoomRecord[]> {
    return this.request<RoomRecord[]>("/api/rooms");
  }

  createRoom(input: { hostAgentId?: string; mapId?: string } = {}): Promise<RoomRecord> {
    return this.request<RoomRecord>("/api/rooms", { method: "POST", body: input });
  }

  getRoom(roomId: string): Promise<RoomRecord> {
    return this.request<RoomRecord>(`/api/rooms/${encodeURIComponent(roomId)}`);
  }

  getRoomByInviteCode(inviteCode: string): Promise<RoomRecord> {
    return this.request<RoomRecord>(`/api/rooms/invite/${encodeURIComponent(inviteCode)}`);
  }

  joinRoom(roomId: string, agentId?: string): Promise<RoomRecord> {
    return this.request<RoomRecord>(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
      method: "POST",
      body: agentId ? { agentId } : {}
    });
  }

  joinRoomByInviteCode(inviteCode: string, agentId?: string): Promise<RoomRecord> {
    return this.request<RoomRecord>("/api/rooms/join", {
      method: "POST",
      body: agentId ? { inviteCode, agentId } : { inviteCode }
    });
  }

  setRoomReady(roomId: string, ready = true, agentId?: string): Promise<RoomRecord> {
    return this.request<RoomRecord>(`/api/rooms/${encodeURIComponent(roomId)}/ready`, {
      method: "POST",
      body: agentId ? { agentId, ready } : { ready }
    });
  }

  startRoom(roomId: string, seed?: string): Promise<StartRoomResponse> {
    return this.request<StartRoomResponse>(`/api/rooms/${encodeURIComponent(roomId)}/start`, {
      method: "POST",
      body: seed ? { seed } : {}
    });
  }

  connectBridge(
    agentId: string,
    label?: string
  ): Promise<{ status: unknown; promptUrls: Record<string, string> }> {
    return this.request<{ status: unknown; promptUrls: Record<string, string> }>(
      `/api/bridge/agents/${encodeURIComponent(agentId)}/connect`,
      {
        method: "POST",
        body: label ? { label } : {}
      }
    );
  }

  getProviderPrompt<TPayload>(
    agentId: string,
    provider: AgentBridgeProvider,
    model: string
  ): Promise<ProviderPromptResponse<TPayload>> {
    return this.request<ProviderPromptResponse<TPayload>>(
      `/api/bridge/agents/${encodeURIComponent(agentId)}/prompt/${provider}?model=${encodeURIComponent(model)}`
    );
  }

  submitProviderAction(
    path: string,
    body: { requestId: string; matchId: string; tick: number; response: unknown }
  ) {
    return this.request(path, { method: "POST", body });
  }

  async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const init: RequestInit = {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Poppy-Key": this.apiKey
      }
    };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(`${this.baseUrl}${path}`, init);
    return parseJsonResponse(response, "AgentPoppy") as Promise<T>;
  }
}

export function envValue(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  return value || fallback || "";
}

export function envValueAny(names: string[], fallback?: string): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return fallback || "";
}

export function requireEnvValue(name: string): string {
  const value = envValue(name);
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export async function runProviderLoop<TPayload>(
  options: ProviderLoopOptions<TPayload>
): Promise<void> {
  const client = options.client ?? new AgentPoppyClient();
  const agent = await ensureProfileAgent(options.defaultAgentName, options.defaultStrategy, client);
  await client.connectBridge(agent.id, options.label);

  console.log(`[local-agent] Connected ${agent.name} (${agent.id}) through ${options.provider}.`);
  console.log("[local-agent] Waiting for a running match that includes this Agent.");

  const submittedRequestIds = new Set<string>();
  for (let poll = 0; poll < options.maxPolls; poll += 1) {
    const prompt = await client.getProviderPrompt<TPayload>(
      agent.id,
      options.provider,
      options.model
    );
    if (!prompt.request || !prompt.payload) {
      await sleep(options.pollIntervalMs);
      continue;
    }
    if (submittedRequestIds.has(prompt.request.requestId)) {
      await sleep(options.pollIntervalMs);
      continue;
    }

    const response = await options.decide(prompt.payload);
    try {
      await client.submitProviderAction(prompt.actionUrl, {
        requestId: prompt.request.requestId,
        matchId: prompt.request.observation.matchId,
        tick: prompt.request.observation.tick,
        response
      });
      submittedRequestIds.add(prompt.request.requestId);
      console.log(
        `[local-agent] Submitted ${options.provider} action for tick ${prompt.request.observation.tick} in ${prompt.request.observation.matchId}.`
      );
    } catch (error) {
      console.warn(`[local-agent] Action was not accepted: ${errorMessage(error)}`);
    }

    await sleep(options.pollIntervalMs);
  }

  console.log(`[local-agent] Stopped after ${options.maxPolls} polls.`);
}

export async function ensureProfileAgent(
  defaultName: string,
  strategyText: string,
  client = new AgentPoppyClient()
): Promise<AgentDetail> {
  const profile = await client.profile();
  if (profile.agent) {
    return profile.agent;
  }
  return client.upsertProfileAgent({
    name: defaultName,
    strategyText
  });
}

export async function callOpenAIResponses(payload: OpenAIResponsesAgentRequest): Promise<unknown> {
  const apiKey = requireEnvValue("OPENAI_API_KEY");
  const response = await fetch(envValue("OPENAI_BASE_URL", "https://api.openai.com/v1/responses"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse(response, "OpenAI");
}

export async function callAnthropicMessages(
  payload: AnthropicMessagesAgentRequest
): Promise<unknown> {
  const apiKey = requireEnvValue("ANTHROPIC_API_KEY");
  const response = await fetch(
    envValue("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1/messages"),
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": envValue("ANTHROPIC_VERSION", "2023-06-01"),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );
  return parseJsonResponse(response, "Anthropic");
}

export function maxPollsFromEnv(): number {
  return numberEnvAny(["AGENT_POPPY_MAX_POLLS"], 240);
}

export function pollIntervalFromEnv(): number {
  return numberEnvAny(["AGENT_POPPY_POLL_MS"], 150);
}

export function openAIWaitResponse(reason: string): unknown {
  return {
    output: [
      {
        type: "function_call",
        name: "choose_agent_action",
        arguments: JSON.stringify({ action: { type: "wait" }, reason })
      }
    ]
  };
}

async function parseJsonResponse(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  const parsed = text ? parseResponseBody(text) : {};
  if (!response.ok) {
    throw new Error(`${label} API ${response.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

function parseResponseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function numberEnvAny(names: string[], fallback: number): number {
  for (const name of names) {
    const value = Number(process.env[name]);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
