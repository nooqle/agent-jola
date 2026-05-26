import { existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { MAP_PRESETS, normalizeMapPresetId } from "@agent-poppy/core";
import { readDecisionLogFile, readReplayFile } from "@agent-poppy/replay";
import {
  createAnthropicMessagesAgentRequest,
  createOpenAIChatAgentRequest,
  createOpenAIResponsesAgentRequest,
  extractAnthropicMessagesAgentAction,
  extractOpenAIChatAgentAction,
  extractOpenAIResponsesAgentAction
} from "@agent-poppy/protocol";
import type {
  AgentActionRequest,
  AgentBridgeProvider,
  CreateProductApiKeyRequest,
  HealthResponse,
  LocalAgentProvider,
  PortalInstallCommandResponse,
  PortalProductApiKeyResponse,
  PortalSessionResponse,
  PortalUser,
  ProductApiQuotaKey,
  ProductApiQuotaPolicy,
  ProductApiScope,
  ProductApiUser,
  ProviderAgentActionExtraction,
  SubmitLocalAgentActionRequest
} from "@agent-poppy/protocol";
import {
  buildLocalAgentPromptFromTemplate,
  getStrategyPromptTemplate,
  listStrategyPromptTemplates,
  type AgentAppearance
} from "@agent-poppy/strategy";
import {
  ALL_PRODUCT_API_SCOPES,
  configureProductApiKeyStatusLookup,
  issueProductApiKey,
  issueProductApiKeyForUser,
  productApiAuthInfo,
  productApiQuotaPolicies,
  PRODUCT_API_ADMIN_KEY_HEADER,
  PRODUCT_API_KEY_HEADER,
  requireProductApiAdminKey,
  requireProductApiKey,
  requireProductApiScope
} from "./auth.js";
import { HttpError } from "./errors.js";
import { MatchRuntimeManager } from "./runtime.js";
import { Storage } from "./storage.js";

const bridgeProviders = ["openai-chat", "openai-responses", "anthropic-messages"] as const;
const productApiScopeSchema = z.enum(
  ALL_PRODUCT_API_SCOPES as [ProductApiScope, ...ProductApiScope[]]
);

const createAgentSchema = z.object({
  name: z.string().min(1).max(80),
  appearance: z
    .object({
      color: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .optional(),
      accessory: z.enum(["none", "cap", "visor", "scarf", "crown", "antenna"]).optional(),
      skinId: z
        .string()
        .regex(/^chameleon-\d+$/)
        .optional()
    })
    .optional(),
  strategyText: z.string().optional()
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  appearance: z
    .object({
      color: z
        .string()
        .regex(/^#[0-9a-f]{6}$/i)
        .optional(),
      accessory: z.enum(["none", "cap", "visor", "scarf", "crown", "antenna"]).optional(),
      skinId: z
        .string()
        .regex(/^chameleon-\d+$/)
        .optional()
    })
    .optional()
});

const createStrategySchema = z.object({
  sourceText: z.string().min(1).max(2000)
});

const createMatchSchema = z.object({
  agentIds: z.array(z.string()).length(4),
  seed: z.string().optional(),
  mapId: z.enum(["classic", "open-court", "crossfire", "maze", "royale"]).optional()
});

const createRoomSchema = z.object({
  hostAgentId: z.string().optional(),
  mapId: z.enum(["classic", "open-court", "crossfire", "maze", "royale"]).optional()
});

const roomAgentSchema = z.object({
  agentId: z.string()
});

const setRoomReadySchema = z.object({
  agentId: z.string(),
  ready: z.boolean()
});

const startRoomSchema = z.object({
  seed: z.string().optional()
});

const agentActionSchema = z.discriminatedUnion("type", [
  z.object({
    agentId: z.string(),
    type: z.literal("wait")
  }),
  z.object({
    agentId: z.string(),
    type: z.literal("place_bubble")
  }),
  z.object({
    agentId: z.string(),
    type: z.literal("move"),
    direction: z.enum(["up", "down", "left", "right"])
  })
]);

const connectLocalAgentSchema = z.object({
  label: z.string().max(80).optional()
});

const bridgeProviderSchema = z.enum(bridgeProviders);

const submitLocalAgentActionSchema = z.object({
  requestId: z.string(),
  matchId: z.string(),
  tick: z.number().int().nonnegative(),
  action: agentActionSchema,
  reason: z.string().max(240).optional()
});

const submitProviderAgentActionSchema = z.object({
  requestId: z.string(),
  matchId: z.string(),
  tick: z.number().int().nonnegative(),
  response: z.unknown()
});

const upsertProductProfileAgentSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  appearance: createAgentSchema.shape.appearance,
  strategyText: z.string().min(1).max(2000).optional()
});

const applyStrategyTemplateSchema = z.object({
  templateId: z.string().min(1).max(40),
  name: z.string().min(1).max(80).optional(),
  appearance: createAgentSchema.shape.appearance
});

const apiCreateRoomSchema = z.object({
  hostAgentId: z.string().optional(),
  mapId: z.enum(["classic", "open-court", "crossfire", "maze", "royale"]).optional()
});

const apiRoomAgentSchema = z.object({
  agentId: z.string().optional()
});

const apiJoinRoomByInviteCodeSchema = z.object({
  inviteCode: z.string().min(3).max(32),
  agentId: z.string().optional()
});

const apiSetRoomReadySchema = z.object({
  agentId: z.string().optional(),
  ready: z.boolean().optional()
});

const createProductApiKeySchema = z.object({
  handle: z.string().min(1).max(80).optional(),
  scopes: z.array(productApiScopeSchema).optional(),
  ttlSeconds: z.number().int().positive().max(31_536_000).optional()
});

const localAgentProviderSchema = z.enum(["mock", "openai", "anthropic"]);
const DEFAULT_PORTAL_PRODUCT_API_SCOPES: ProductApiScope[] = [
  "profile:read",
  "profile:write",
  "templates:read",
  "rooms:read",
  "rooms:write",
  "bridge"
];

const portalDevLoginSchema = z.object({
  email: z.string().email().max(320),
  displayName: z.string().min(1).max(80).optional(),
  avatarUrl: z.string().url().max(500).optional()
});

const portalProfileSchema = z.object({
  agentName: z.string().min(1).max(80),
  appearance: createAgentSchema.shape.appearance.optional(),
  strategyText: z.string().min(1).max(2000)
});

const createPortalProductApiKeySchema = createProductApiKeySchema.extend({
  provider: localAgentProviderSchema.optional(),
  localBaseUrl: z.string().url().optional()
});

export interface BuildAppOptions {
  storage: Storage;
  runtime: MatchRuntimeManager;
  webDistDir?: string;
}

interface WebSocketLike {
  send(data: string): void;
  close?(): void;
  on(event: "close", listener: () => void): void;
}

type WebSocketConnection = WebSocketLike & {
  socket?: WebSocketLike;
};

interface SubmitProviderAgentActionInput {
  requestId: string;
  matchId: string;
  tick: number;
  response: unknown;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
  const app = Fastify({
    logger: {
      redact: [
        "req.headers.authorization",
        `req.headers.${PRODUCT_API_KEY_HEADER}`,
        `req.headers.${PRODUCT_API_ADMIN_KEY_HEADER}`,
        "req.headers.x-agent-poppy-portal-token",
        "req.headers.cookie"
      ]
    }
  });
  configureProductApiKeyStatusLookup((keyId) => {
    const status = options.storage.getProductApiKeyStatus(keyId);
    if (status === "active") {
      options.storage.touchProductApiKey(keyId);
    }
    return status;
  });
  await app.register(cors, { origin: corsOriginPolicy() });
  await app.register(websocket);

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  });

  app.addHook("onClose", async () => {
    options.runtime.shutdown();
    configureProductApiKeyStatusLookup(undefined);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.status(error.statusCode).send({ error: error.code, message: error.message });
      return;
    }
    if (error instanceof z.ZodError) {
      reply.status(400).send({ error: "VALIDATION_ERROR", details: error.flatten() });
      return;
    }
    app.log.error(error);
    reply.status(500).send({ error: "INTERNAL_ERROR", message: "Unexpected server error." });
  });

  app.get(
    "/health",
    async (): Promise<HealthResponse> => ({
      ok: true,
      service: "agent-poppy-server",
      time: new Date().toISOString()
    })
  );

  app.get("/maps", async () => MAP_PRESETS);

  app.get("/api/auth/google/start", async (request, reply) => {
    enforceRateLimit(rateLimitBuckets, request, "auth-google-start", 30, 10 * 60 * 1000);
    const config = googleOAuthConfig(request);
    if (!config) {
      throw new HttpError(
        503,
        "Google OAuth is not configured.",
        "GOOGLE_OAUTH_NOT_CONFIGURED"
      );
    }
    const query = request.query as { returnTo?: unknown };
    const returnTo = typeof query.returnTo === "string" ? query.returnTo : "/portal";
    const state = `st_${randomBytes(32).toString("base64url")}`;
    options.storage.createPortalOAuthState(
      hashPortalToken(state),
      new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      returnTo
    );

    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.searchParams.set("client_id", config.clientId);
    authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", "openid email profile");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("access_type", "offline");
    authorizationUrl.searchParams.set("prompt", "select_account");
    await reply.redirect(authorizationUrl.toString());
  });

  app.get("/api/auth/google/callback", async (request, reply) => {
    const config = googleOAuthConfig(request);
    if (!config) {
      throw new HttpError(
        503,
        "Google OAuth is not configured.",
        "GOOGLE_OAUTH_NOT_CONFIGURED"
      );
    }
    const query = request.query as { code?: unknown; state?: unknown; error?: unknown };
    if (typeof query.error === "string") {
      throw new HttpError(400, `Google OAuth error: ${query.error}`, "GOOGLE_OAUTH_REJECTED");
    }
    if (typeof query.code !== "string" || typeof query.state !== "string") {
      throw new HttpError(400, "Missing OAuth code or state.", "GOOGLE_OAUTH_INVALID");
    }
    const oauthState = options.storage.consumePortalOAuthState(hashPortalToken(query.state));
    if (!oauthState) {
      throw new HttpError(400, "Invalid or expired OAuth state.", "GOOGLE_OAUTH_STATE_INVALID");
    }

    const identity = await exchangeGoogleOAuthCode(config, query.code);
    const user = options.storage.upsertPortalUser({
      provider: "google",
      providerSubject: identity.sub,
      email: identity.email,
      displayName: identity.name ?? identity.email.split("@")[0] ?? "AgentPoppy User",
      ...(identity.picture ? { avatarUrl: identity.picture } : {})
    });
    const session = createPortalSession(options.storage, user);
    setPortalSessionCookie(reply, session.portalToken, session.expiresAt);
    await reply.redirect(oauthState.returnTo ?? "/portal");
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = portalTokenFromRequest(request);
    if (token) {
      options.storage.revokePortalSession(hashPortalToken(token));
    }
    clearPortalSessionCookie(reply);
    return { ok: true };
  });

  app.post("/api/portal/dev-login", async (request, reply): Promise<PortalSessionResponse> => {
    requireDevPortalLoginEnabled();
    const body = portalDevLoginSchema.parse(request.body ?? {});
    const userInput: {
      provider: "dev";
      providerSubject: string;
      email: string;
      displayName: string;
      avatarUrl?: string;
    } = {
      provider: "dev",
      providerSubject: body.email.toLowerCase(),
      email: body.email,
      displayName: body.displayName ?? body.email.split("@")[0] ?? "AgentPoppy User"
    };
    if (body.avatarUrl !== undefined) {
      userInput.avatarUrl = body.avatarUrl;
    }
    const user = options.storage.upsertPortalUser(userInput);
    const session = createPortalSession(options.storage, user);
    setPortalSessionCookie(reply, session.portalToken, session.expiresAt);
    return session;
  });

  app.get("/api/portal/me", async (request) => {
    const user = requirePortalSession(options.storage, request);
    return {
      user,
      profile: options.storage.getPortalProfile(user.id) ?? null,
      keys: options.storage.listProductApiKeysForUser(user.id),
      quotas: productApiQuotaPoliciesForUser(options.storage, {
        id: user.id,
        handle: user.displayName,
        mode: "issued",
        scopes: ALL_PRODUCT_API_SCOPES
      })
    };
  });

  app.get("/api/portal/profile", async (request) => {
    const user = requirePortalSession(options.storage, request);
    return {
      user,
      profile: options.storage.getPortalProfile(user.id) ?? null
    };
  });

  app.get("/api/portal/strategy-templates", async (request) => {
    requirePortalSession(options.storage, request);
    return { templates: listStrategyPromptTemplates() };
  });

  app.put("/api/portal/profile", async (request) => {
    const user = requirePortalSession(options.storage, request);
    const body = portalProfileSchema.parse(request.body ?? {});
    const profileInput: {
      agentName: string;
      appearance?: Partial<AgentAppearance>;
      strategyText: string;
    } = {
      agentName: body.agentName,
      strategyText: body.strategyText
    };
    const appearance = requestAppearance(body.appearance);
    if (appearance) {
      profileInput.appearance = appearance;
    }
    return options.storage.upsertPortalProfile(user.id, profileInput);
  });

  app.post(
    "/api/portal/product-keys",
    async (request): Promise<PortalProductApiKeyResponse> => {
      enforceRateLimit(rateLimitBuckets, request, "portal-product-key-create", 10, 60 * 60 * 1000);
      const user = requirePortalSession(options.storage, request);
      const profile = options.storage.getPortalProfile(user.id);
      if (!profile) {
        throw new HttpError(
          409,
          "Create your AgentPoppy chameleon before issuing an API key.",
          "PORTAL_PROFILE_REQUIRED"
        );
      }
      const body = createPortalProductApiKeySchema.parse(request.body ?? {});
      const input: CreateProductApiKeyRequest = {
        handle: body.handle ?? profile.agentName,
        scopes: body.scopes ?? DEFAULT_PORTAL_PRODUCT_API_SCOPES
      };
      if (body.ttlSeconds !== undefined) {
        input.ttlSeconds = body.ttlSeconds;
      }
      const issued = issueProductApiKeyForUser(input, {
        id: user.id,
        handle: user.displayName
      });
      options.storage.createProductApiKey({
        id: issued.id,
        userId: issued.user.id,
        handle: issued.user.handle,
        scopes: issued.user.scopes,
        createdAt: issued.createdAt,
        ...(issued.expiresAt ? { expiresAt: issued.expiresAt } : {})
      });
      return {
        ...issued,
        install: createPortalInstallCommand({
          request,
          apiKey: issued.key,
          provider: body.provider ?? "mock",
          localBaseUrl: body.localBaseUrl
        })
      };
    }
  );

  app.get("/api/portal/product-keys", async (request) => {
    const user = requirePortalSession(options.storage, request);
    return { keys: options.storage.listProductApiKeysForUser(user.id) };
  });

  app.post("/api/portal/product-keys/:keyId/revoke", async (request) => {
    const user = requirePortalSession(options.storage, request);
    const { keyId } = request.params as { keyId: string };
    return options.storage.revokeProductApiKeyForUser(user.id, keyId);
  });

  app.get("/api/portal/install-command/:keyId", async (request) => {
    const user = requirePortalSession(options.storage, request);
    const { keyId } = request.params as { keyId: string };
    const key = options.storage
      .listProductApiKeysForUser(user.id)
      .find((candidate) => candidate.id === keyId);
    if (!key) {
      throw new HttpError(404, `Product API key not found: ${keyId}`, "PRODUCT_API_KEY_NOT_FOUND");
    }
    const query = request.query as { provider?: unknown; localBaseUrl?: unknown };
    const provider = localAgentProviderSchema.parse(
      typeof query.provider === "string" ? query.provider : "mock"
    );
    const localBaseUrl = typeof query.localBaseUrl === "string" ? query.localBaseUrl : undefined;
    return createPortalInstallCommand({
      request,
      apiKey: "<paste API key shown when it was created>",
      provider,
      localBaseUrl
    });
  });

  app.get("/api/runtime/profile", async (request) => {
    const user = requireProductApiScope(request, "profile:read");
    const profile = options.storage.getPortalProfile(user.id);
    if (!profile) {
      throw new HttpError(
        409,
        "No hosted AgentPoppy profile has been configured for this API key.",
        "RUNTIME_PROFILE_REQUIRED"
      );
    }
    return { user, profile };
  });

  app.post("/api/admin/product-keys", async (request) => {
    requireProductApiAdminKey(request);
    const body = createProductApiKeySchema.parse(request.body ?? {});
    const input: CreateProductApiKeyRequest = {};
    if (body.handle !== undefined) {
      input.handle = body.handle;
    }
    if (body.scopes !== undefined) {
      input.scopes = body.scopes;
    }
    if (body.ttlSeconds !== undefined) {
      input.ttlSeconds = body.ttlSeconds;
    }
    const issued = issueProductApiKey(input);
    options.storage.createProductApiKey({
      id: issued.id,
      userId: issued.user.id,
      handle: issued.user.handle,
      scopes: issued.user.scopes,
      createdAt: issued.createdAt,
      ...(issued.expiresAt ? { expiresAt: issued.expiresAt } : {})
    });
    return issued;
  });

  app.get("/api/admin/product-keys", async (request) => {
    requireProductApiAdminKey(request);
    return { keys: options.storage.listProductApiKeys() };
  });

  app.post("/api/admin/product-keys/:keyId/revoke", async (request) => {
    requireProductApiAdminKey(request);
    const { keyId } = request.params as { keyId: string };
    return options.storage.revokeProductApiKey(keyId);
  });

  app.get("/api/me", async (request) => {
    const user = requireProductApiKey(request);
    return {
      user,
      auth: productApiAuthInfo(),
      capabilities: {
        bridgeProviders,
        roomMode: "royale-4",
        localRuntime: true
      },
      quotas: productApiQuotaPoliciesForUser(options.storage, user)
    };
  });

  app.get("/api/profile", async (request) => {
    const user = requireProductApiScope(request, "profile:read");
    return {
      user,
      agent: getPrimaryAgentDetail(options.storage) ?? null,
      agents: options.storage.listAgents()
    };
  });

  app.post("/api/profile/agent", async (request) => {
    const user = requireProductApiScope(request, "profile:write");
    const body = upsertProductProfileAgentSchema.parse(request.body ?? {});
    if (body.appearance) {
      consumeProductApiQuota(options.storage, user, "character_randomize");
    }
    return upsertPrimaryAgent(options.storage, body);
  });

  app.post("/api/profile/agent/strategy-template", async (request) => {
    const user = requireProductApiScope(request, "profile:write");
    const body = applyStrategyTemplateSchema.parse(request.body ?? {});
    consumeProductApiQuota(options.storage, user, "template_apply");
    const template = requireStrategyTemplate(body.templateId);
    return upsertPrimaryAgent(options.storage, {
      name: body.name,
      appearance: body.appearance,
      strategyText: template.prompt
    });
  });

  app.get("/api/strategy-templates", async (request) => {
    const user = requireProductApiScope(request, "templates:read");
    consumeProductApiQuota(options.storage, user, "template_read");
    return { templates: listStrategyPromptTemplates() };
  });

  app.get("/api/strategy-templates/:templateId", async (request) => {
    const user = requireProductApiScope(request, "templates:read");
    consumeProductApiQuota(options.storage, user, "template_read");
    const { templateId } = request.params as { templateId: string };
    const query = request.query as { agentName?: unknown };
    const agentName =
      typeof query.agentName === "string" && query.agentName.trim()
        ? query.agentName.trim().slice(0, 80)
        : undefined;
    const template = requireStrategyTemplate(templateId);
    return {
      template,
      localAgentPrompt: buildLocalAgentPromptFromTemplate(
        template.id,
        agentName ? { agentName } : {}
      )
    };
  });

  app.get("/api/agents", async (request) => {
    requireProductApiScope(request, "profile:read");
    return options.storage.listAgents();
  });

  app.get("/api/agents/:agentId", async (request) => {
    requireProductApiScope(request, "profile:read");
    const { agentId } = request.params as { agentId: string };
    return options.storage.getAgentDetail(agentId);
  });

  app.get("/api/rooms", async (request) => {
    requireProductApiScope(request, "rooms:read");
    return options.storage.listRooms();
  });

  app.post("/api/rooms", async (request) => {
    enforceRateLimit(rateLimitBuckets, request, "api-room-create", 60, 60 * 60 * 1000);
    const user = requireProductApiScope(request, "rooms:write");
    const body = apiCreateRoomSchema.parse(request.body ?? {});
    consumeProductApiQuota(options.storage, user, "room_create");
    const hostAgentId = body.hostAgentId ?? requirePrimaryAgent(options.storage).id;
    return options.storage.createRoom(hostAgentId, body.mapId);
  });

  app.get("/api/rooms/invite/:inviteCode", async (request) => {
    requireProductApiScope(request, "rooms:read");
    const { inviteCode } = request.params as { inviteCode: string };
    return options.storage.getRoomByInviteCode(inviteCode);
  });

  app.post("/api/rooms/join", async (request) => {
    requireProductApiScope(request, "rooms:write");
    const body = apiJoinRoomByInviteCodeSchema.parse(request.body ?? {});
    return options.storage.joinRoomByInviteCode(
      body.inviteCode,
      body.agentId ?? requirePrimaryAgent(options.storage).id
    );
  });

  app.get("/api/rooms/:roomId", async (request) => {
    requireProductApiScope(request, "rooms:read");
    const { roomId } = request.params as { roomId: string };
    return options.storage.getRoom(roomId);
  });

  app.post("/api/rooms/:roomId/join", async (request) => {
    requireProductApiScope(request, "rooms:write");
    const { roomId } = request.params as { roomId: string };
    const body = apiRoomAgentSchema.parse(request.body ?? {});
    return options.storage.joinRoom(
      roomId,
      body.agentId ?? requirePrimaryAgent(options.storage).id
    );
  });

  app.post("/api/rooms/:roomId/leave", async (request) => {
    requireProductApiScope(request, "rooms:write");
    const { roomId } = request.params as { roomId: string };
    const body = apiRoomAgentSchema.parse(request.body ?? {});
    return options.storage.leaveRoom(
      roomId,
      body.agentId ?? requirePrimaryAgent(options.storage).id
    );
  });

  app.post("/api/rooms/:roomId/ready", async (request) => {
    requireProductApiScope(request, "rooms:write");
    const { roomId } = request.params as { roomId: string };
    const body = apiSetRoomReadySchema.parse(request.body ?? {});
    return options.storage.setRoomReady(
      roomId,
      body.agentId ?? requirePrimaryAgent(options.storage).id,
      body.ready ?? true
    );
  });

  app.post("/api/rooms/:roomId/cancel", async (request) => {
    requireProductApiScope(request, "rooms:write");
    const { roomId } = request.params as { roomId: string };
    return options.storage.cancelRoom(roomId);
  });

  app.post("/api/rooms/:roomId/start", async (request) => {
    requireProductApiScope(request, "rooms:write");
    const { roomId } = request.params as { roomId: string };
    const body = startRoomSchema.parse(request.body ?? {});
    return startStoredRoom(options, roomId, body.seed);
  });

  app.get("/api/leaderboard", async (request) => {
    requireProductApiScope(request, "leaderboard:read");
    return options.storage.getLeaderboard();
  });

  app.get("/api/bridge/agents/:agentId/status", async (request) => {
    requireProductApiScope(request, "bridge");
    const { agentId } = request.params as { agentId: string };
    options.storage.getAgent(agentId);
    return options.runtime.localAgentStatus(agentId);
  });

  app.post("/api/bridge/agents/:agentId/connect", async (request) => {
    requireProductApiScope(request, "bridge");
    const { agentId } = request.params as { agentId: string };
    const body = connectLocalAgentSchema.parse(request.body ?? {});
    const status = options.runtime.connectLocalAgent(agentId, body.label);
    return {
      status,
      promptUrls: {
        openaiChat: `/api/bridge/agents/${agentId}/prompt/openai-chat`,
        openaiResponses: `/api/bridge/agents/${agentId}/prompt/openai-responses`,
        anthropicMessages: `/api/bridge/agents/${agentId}/prompt/anthropic-messages`
      }
    };
  });

  app.delete("/api/bridge/agents/:agentId/connect", async (request) => {
    requireProductApiScope(request, "bridge");
    const { agentId } = request.params as { agentId: string };
    return options.runtime.disconnectLocalAgent(agentId);
  });

  app.get("/api/bridge/agents/:agentId/prompt/:provider", async (request) => {
    enforceRateLimit(rateLimitBuckets, request, "api-bridge-prompt", 600, 60 * 1000);
    const user = requireProductApiScope(request, "bridge");
    const { agentId, provider: rawProvider } = request.params as {
      agentId: string;
      provider: string;
    };
    consumeProductApiQuota(options.storage, user, "bridge_prompt");
    const provider = bridgeProviderSchema.parse(rawProvider);
    const query = request.query as { model?: unknown };
    const model =
      typeof query.model === "string" && query.model.trim()
        ? query.model.trim().slice(0, 120)
        : undefined;
    return createProviderPromptResponse(options, agentId, provider, model, "/api");
  });

  app.post("/api/bridge/agents/:agentId/action/:provider", async (request) => {
    enforceRateLimit(rateLimitBuckets, request, "api-bridge-action", 600, 60 * 1000);
    requireProductApiScope(request, "bridge");
    const { agentId, provider: rawProvider } = request.params as {
      agentId: string;
      provider: string;
    };
    const provider = bridgeProviderSchema.parse(rawProvider);
    const body = submitProviderAgentActionSchema.parse(
      request.body
    ) as SubmitProviderAgentActionInput;
    return submitProviderAgentAction(options, agentId, provider, body);
  });

  app.get("/agents", async () => options.storage.listAgents());

  app.post("/agents", async (request) => {
    const body = createAgentSchema.parse(request.body);
    return options.storage.createAgent(
      body.name,
      body.strategyText,
      requestAppearance(body.appearance)
    );
  });

  app.patch("/agents/:agentId", async (request) => {
    const { agentId } = request.params as { agentId: string };
    const body = updateAgentSchema.parse(request.body);
    const updates: { name?: string; appearance?: Partial<AgentAppearance> } = {};
    if (body.name !== undefined) {
      updates.name = body.name;
    }
    if (body.appearance !== undefined) {
      const appearance = requestAppearance(body.appearance);
      if (appearance) {
        updates.appearance = appearance;
      }
    }
    return options.storage.updateAgent(agentId, updates);
  });

  app.get("/agents/:agentId", async (request) => {
    const { agentId } = request.params as { agentId: string };
    return options.storage.getAgentDetail(agentId);
  });

  app.get("/agents/:agentId/strategy-versions", async (request) => {
    const { agentId } = request.params as { agentId: string };
    return options.storage.listStrategyVersions(agentId);
  });

  app.post("/agents/:agentId/strategy-versions", async (request) => {
    const { agentId } = request.params as { agentId: string };
    const body = createStrategySchema.parse(request.body);
    return options.storage.createStrategyVersion(agentId, body.sourceText);
  });

  app.get("/bridge/agents/:agentId/status", async (request) => {
    const { agentId } = request.params as { agentId: string };
    options.storage.getAgent(agentId);
    return options.runtime.localAgentStatus(agentId);
  });

  app.post("/bridge/agents/:agentId/connect", async (request) => {
    const { agentId } = request.params as { agentId: string };
    const body = connectLocalAgentSchema.parse(request.body ?? {});
    const status = options.runtime.connectLocalAgent(agentId, body.label);
    return {
      status,
      observeUrl: `/bridge/agents/${agentId}/observe`,
      actionUrl: `/bridge/agents/${agentId}/action`
    };
  });

  app.delete("/bridge/agents/:agentId/connect", async (request) => {
    const { agentId } = request.params as { agentId: string };
    return options.runtime.disconnectLocalAgent(agentId);
  });

  app.get("/bridge/agents/:agentId/observe", async (request) => {
    const { agentId } = request.params as { agentId: string };
    return options.runtime.observeLocalAgent(agentId);
  });

  app.get("/bridge/agents/:agentId/prompt/:provider", async (request) => {
    const { agentId, provider: rawProvider } = request.params as {
      agentId: string;
      provider: string;
    };
    const provider = bridgeProviderSchema.parse(rawProvider);
    const query = request.query as { model?: unknown };
    const model =
      typeof query.model === "string" && query.model.trim()
        ? query.model.trim().slice(0, 120)
        : undefined;
    return createProviderPromptResponse(options, agentId, provider, model, "");
  });

  app.post("/bridge/agents/:agentId/action", async (request) => {
    const { agentId } = request.params as { agentId: string };
    const body = submitLocalAgentActionSchema.parse(request.body);
    const actionRequest: SubmitLocalAgentActionRequest = {
      requestId: body.requestId,
      matchId: body.matchId,
      tick: body.tick,
      action: body.action
    };
    if (body.reason !== undefined) {
      actionRequest.reason = body.reason;
    }
    return options.runtime.submitLocalAgentAction(agentId, actionRequest);
  });

  app.post("/bridge/agents/:agentId/action/:provider", async (request) => {
    const { agentId, provider: rawProvider } = request.params as {
      agentId: string;
      provider: string;
    };
    const provider = bridgeProviderSchema.parse(rawProvider);
    const body = submitProviderAgentActionSchema.parse(
      request.body
    ) as SubmitProviderAgentActionInput;
    return submitProviderAgentAction(options, agentId, provider, body);
  });

  app.get("/rooms", async () => options.storage.listRooms());

  app.post("/rooms", async (request) => {
    const body = createRoomSchema.parse(request.body ?? {});
    return options.storage.createRoom(body.hostAgentId, body.mapId);
  });

  app.get("/rooms/:roomId", async (request) => {
    const { roomId } = request.params as { roomId: string };
    return options.storage.getRoom(roomId);
  });

  app.post("/rooms/:roomId/join", async (request) => {
    const { roomId } = request.params as { roomId: string };
    const body = roomAgentSchema.parse(request.body);
    return options.storage.joinRoom(roomId, body.agentId);
  });

  app.post("/rooms/:roomId/leave", async (request) => {
    const { roomId } = request.params as { roomId: string };
    const body = roomAgentSchema.parse(request.body);
    return options.storage.leaveRoom(roomId, body.agentId);
  });

  app.post("/rooms/:roomId/ready", async (request) => {
    const { roomId } = request.params as { roomId: string };
    const body = setRoomReadySchema.parse(request.body);
    return options.storage.setRoomReady(roomId, body.agentId, body.ready);
  });

  app.post("/rooms/:roomId/cancel", async (request) => {
    const { roomId } = request.params as { roomId: string };
    return options.storage.cancelRoom(roomId);
  });

  app.post("/rooms/:roomId/start", async (request) => {
    const { roomId } = request.params as { roomId: string };
    const body = startRoomSchema.parse(request.body ?? {});
    return startStoredRoom(options, roomId, body.seed);
  });

  app.post("/matches", async (request) => {
    const body = createMatchSchema.parse(request.body);
    const record = options.runtime.createMatch(
      body.agentIds,
      body.seed,
      normalizeMapPresetId(body.mapId)
    );
    return {
      matchId: record.id,
      record
    };
  });

  app.get("/matches", async () => options.storage.listMatches());

  app.get("/matches/:matchId", async (request) => {
    const { matchId } = request.params as { matchId: string };
    return {
      record: options.storage.getMatch(matchId),
      state: options.runtime.getState(matchId)
    };
  });

  app.get("/matches/:matchId/replay", async (request) => {
    const { matchId } = request.params as { matchId: string };
    options.storage.getMatch(matchId);
    const path = options.storage.getReplayPath(matchId);
    if (!existsSync(path)) {
      throw new HttpError(404, "Replay is not available yet.", "REPLAY_NOT_READY");
    }
    return readReplayFile(path);
  });

  app.get("/matches/:matchId/decisions", async (request) => {
    const { matchId } = request.params as { matchId: string };
    options.storage.getMatch(matchId);
    const path = options.storage.getDecisionPath(matchId);
    if (!existsSync(path)) {
      throw new HttpError(404, "Decision log is not available yet.", "DECISIONS_NOT_READY");
    }
    return readDecisionLogFile(path);
  });

  app.get("/leaderboard", async () => options.storage.getLeaderboard());

  app.get(
    "/matches/:matchId/ws",
    { websocket: true },
    (connection: WebSocketConnection, request) => {
      const { matchId } = request.params as { matchId: string };
      const socket = connection.socket ?? connection;
      const unsubscribe = options.runtime.subscribe(matchId, socket);
      socket.on("close", unsubscribe);
    }
  );

  registerWebStaticRoutes(app, options.webDistDir);

  return app;
}

const PORTAL_TOKEN_HEADER = "x-agent-poppy-portal-token";
const PORTAL_SESSION_COOKIE = "agent_poppy_portal";

interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface GoogleOAuthIdentity {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

function requireDevPortalLoginEnabled(): void {
  if (
    process.env.NODE_ENV === "production" &&
    envValue("AGENT_POPPY_ENABLE_DEV_PORTAL_LOGIN") !== "true"
  ) {
    throw new HttpError(404, "Portal dev login is disabled.", "PORTAL_DEV_LOGIN_DISABLED");
  }
}

function createPortalSession(storage: Storage, user: PortalUser): PortalSessionResponse {
  const token = `pt_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + portalSessionTtlMs()).toISOString();
  storage.createPortalSession(user.id, hashPortalToken(token), expiresAt);
  return {
    user,
    portalToken: token,
    expiresAt
  };
}

function requirePortalSession(storage: Storage, request: FastifyRequest): PortalUser {
  const token = portalTokenFromRequest(request);
  if (!token) {
    throw new HttpError(401, "Missing AgentPoppy portal session.", "PORTAL_SESSION_INVALID");
  }
  const user = storage.getPortalUserBySessionTokenHash(hashPortalToken(token));
  if (!user) {
    throw new HttpError(401, "Missing or invalid AgentPoppy portal session.", "PORTAL_SESSION_INVALID");
  }
  return user;
}

function portalTokenFromRequest(request: FastifyRequest): string | undefined {
  const direct = headerValue(request.headers[PORTAL_TOKEN_HEADER]);
  if (direct) {
    return direct.trim();
  }
  const cookieToken = cookieValue(headerValue(request.headers.cookie), PORTAL_SESSION_COOKIE);
  if (cookieToken) {
    return cookieToken;
  }
  const authorization = headerValue(request.headers.authorization);
  if (!authorization) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim();
}

function hashPortalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function portalSessionTtlMs(): number {
  const days = Number(envValue("AGENT_POPPY_PORTAL_SESSION_DAYS") || 30);
  const normalizedDays = Number.isFinite(days) && days > 0 ? days : 30;
  return normalizedDays * 24 * 60 * 60 * 1000;
}

function createPortalInstallCommand(input: {
  request: FastifyRequest;
  apiKey: string;
  provider: LocalAgentProvider;
  localBaseUrl?: string | undefined;
}): PortalInstallCommandResponse {
  const cloudUrl = publicApiBaseUrl(input.request);
  const baseUrl = input.localBaseUrl?.trim() || "http://127.0.0.1:3001";
  const providerCommand =
    input.provider === "openai"
      ? "pnpm agent:openai"
      : input.provider === "anthropic"
        ? "pnpm agent:anthropic"
        : "pnpm agent:mock";
  const configure = [
    "pnpm agent:setting write --yes",
    `--base-url ${shellQuote(baseUrl)}`,
    `--cloud-url ${shellQuote(cloudUrl)}`,
    `--api-key ${shellQuote(input.apiKey)}`,
    `--provider ${input.provider}`
  ].join(" ");
  return {
    baseUrl,
    cloudUrl,
    provider: input.provider,
    commands: {
      clone: "git clone https://github.com/nooqle/AgentPoppy.git",
      install: "pnpm install",
      configure,
      syncProfile: "pnpm agent:setting sync",
      runServer: "pnpm dev",
      runAgent: providerCommand,
      openWeb: `${baseUrl}/`
    },
    scripts: {
      windowsPowerShell: [
        "git clone https://github.com/nooqle/AgentPoppy.git",
        "cd AgentPoppy",
        "pnpm install",
        configure,
        "pnpm agent:setting sync",
        "pnpm dev",
        providerCommand
      ].join("\n"),
      posixShell: [
        "git clone https://github.com/nooqle/AgentPoppy.git",
        "cd AgentPoppy",
        "pnpm install",
        configure,
        "pnpm agent:setting sync",
        "pnpm dev",
        providerCommand
      ].join("\n")
    },
    env: {
      AGENT_POPPY_BASE_URL: baseUrl,
      AGENT_POPPY_CLOUD_BASE_URL: cloudUrl,
      AGENT_POPPY_API_KEY: input.apiKey,
      AGENT_POPPY_PROVIDER: input.provider
    }
  };
}

function publicApiBaseUrl(request: FastifyRequest): string {
  const configured = envValue("AGENT_POPPY_PUBLIC_API_BASE_URL");
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  const proto = headerValue(request.headers["x-forwarded-proto"]) ?? "http";
  const host = headerValue(request.headers["x-forwarded-host"]) ?? request.headers.host;
  return `${proto}://${host ?? "127.0.0.1:3001"}`.replace(/\/$/, "");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function envValue(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function enforceRateLimit(
  buckets: Map<string, { count: number; resetAt: number }>,
  request: FastifyRequest,
  name: string,
  limit: number,
  windowMs: number
): void {
  const now = Date.now();
  const key = `${name}:${request.ip}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (current.count >= limit) {
    throw new HttpError(429, "Too many requests. Try again later.", "RATE_LIMITED");
  }
  current.count += 1;
}

function corsOriginPolicy(): boolean | string[] {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }
  const configured = envValue("AGENT_POPPY_CORS_ORIGINS");
  if (!configured) {
    return false;
  }
  return configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function googleOAuthConfig(request: FastifyRequest): GoogleOAuthConfig | undefined {
  const clientId = envValue("AGENT_POPPY_GOOGLE_CLIENT_ID");
  const clientSecret = envValue("AGENT_POPPY_GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return undefined;
  }
  return {
    clientId,
    clientSecret,
    redirectUri:
      envValue("AGENT_POPPY_GOOGLE_REDIRECT_URI") ||
      `${publicApiBaseUrl(request)}/api/auth/google/callback`
  };
}

async function exchangeGoogleOAuthCode(
  config: GoogleOAuthConfig,
  code: string
): Promise<GoogleOAuthIdentity> {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code"
    })
  });
  const tokenPayload = (await tokenResponse.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    throw new HttpError(
      400,
      tokenPayload.error_description ?? tokenPayload.error ?? "Google OAuth token exchange failed.",
      "GOOGLE_OAUTH_TOKEN_INVALID"
    );
  }

  const userInfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenPayload.access_token}` }
  });
  const userInfo = (await userInfoResponse.json()) as Partial<GoogleOAuthIdentity> & {
    email_verified?: boolean;
  };
  if (
    !userInfoResponse.ok ||
    typeof userInfo.sub !== "string" ||
    typeof userInfo.email !== "string" ||
    userInfo.email_verified === false
  ) {
    throw new HttpError(
      400,
      "Google OAuth identity could not be verified.",
      "GOOGLE_OAUTH_IDENTITY_INVALID"
    );
  }
  const identity: GoogleOAuthIdentity = {
    sub: userInfo.sub,
    email: userInfo.email
  };
  if (typeof userInfo.name === "string") {
    identity.name = userInfo.name;
  }
  if (typeof userInfo.picture === "string") {
    identity.picture = userInfo.picture;
  }
  return identity;
}

function setPortalSessionCookie(reply: FastifyReply, token: string, expiresAt: string): void {
  reply.header(
    "set-cookie",
    serializeCookie(PORTAL_SESSION_COOKIE, token, {
      expires: new Date(expiresAt),
      maxAgeSeconds: Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))
    })
  );
}

function clearPortalSessionCookie(reply: FastifyReply): void {
  reply.header(
    "set-cookie",
    serializeCookie(PORTAL_SESSION_COOKIE, "", {
      expires: new Date(0),
      maxAgeSeconds: 0
    })
  );
}

function serializeCookie(
  name: string,
  value: string,
  options: { expires: Date; maxAgeSeconds: number }
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${options.expires.toUTCString()}`,
    `Max-Age=${options.maxAgeSeconds}`
  ];
  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = part.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rawValueParts.join("="));
    }
  }
  return undefined;
}

function requestAppearance(
  input:
    | {
        color?: string | undefined;
        accessory?: AgentAppearance["accessory"] | undefined;
        skinId?: string | undefined;
      }
    | undefined
) {
  if (!input) return undefined;
  const appearance: Partial<AgentAppearance> = {};
  if (input.color !== undefined) {
    appearance.color = input.color;
  }
  if (input.accessory !== undefined) {
    appearance.accessory = input.accessory;
  }
  if (input.skinId !== undefined) {
    appearance.skinId = input.skinId;
  }
  return appearance;
}

function getPrimaryAgentDetail(storage: Storage) {
  const [agent] = storage.listAgents();
  return agent ? storage.getAgentDetail(agent.id) : undefined;
}

function requirePrimaryAgent(storage: Storage) {
  const agent = getPrimaryAgentDetail(storage);
  if (!agent) {
    throw new HttpError(
      409,
      "No local Agent profile exists yet.",
      "PRODUCT_PROFILE_AGENT_REQUIRED"
    );
  }
  return agent;
}

function requireStrategyTemplate(templateId: string) {
  const template = getStrategyPromptTemplate(templateId);
  if (!template) {
    throw new HttpError(
      404,
      `Strategy template was not found: ${templateId}`,
      "STRATEGY_TEMPLATE_NOT_FOUND"
    );
  }
  return template;
}

function upsertPrimaryAgent(
  storage: Storage,
  body: {
    name?: string | undefined;
    appearance?:
      | {
          color?: string | undefined;
          accessory?: AgentAppearance["accessory"] | undefined;
          skinId?: string | undefined;
        }
      | undefined;
    strategyText?: string | undefined;
  }
) {
  const current = getPrimaryAgentDetail(storage);
  if (!current) {
    return storage.createAgent(
      body.name ?? "Local Agent",
      body.strategyText,
      requestAppearance(body.appearance)
    );
  }

  const updates: { name?: string; appearance?: Partial<AgentAppearance> } = {};
  if (body.name !== undefined) {
    updates.name = body.name;
  }
  if (body.appearance !== undefined) {
    const appearance = requestAppearance(body.appearance);
    if (appearance) {
      updates.appearance = appearance;
    }
  }
  if (updates.name !== undefined || updates.appearance !== undefined) {
    storage.updateAgent(current.id, updates);
  }
  if (body.strategyText !== undefined) {
    storage.createStrategyVersion(current.id, body.strategyText);
  }
  return storage.getAgentDetail(current.id);
}

function productApiQuotaPoliciesForUser(
  storage: Storage,
  user: ProductApiUser,
): ProductApiQuotaPolicy[] {
  return productApiQuotaPolicies().map((policy) => {
    const used = storage.getProductApiQuotaUsage(user.id, policy.key);
    return {
      ...policy,
      used,
      remaining: policy.limit === null ? null : Math.max(policy.limit - used, 0),
    };
  });
}

function consumeProductApiQuota(
  storage: Storage,
  user: ProductApiUser,
  key: ProductApiQuotaKey,
): void {
  const policy = productApiQuotaPolicies().find((candidate) => candidate.key === key);
  storage.consumeProductApiQuota(user.id, key, policy?.limit ?? null);
}

function startStoredRoom(options: BuildAppOptions, roomId: string, seed?: string) {
  const room = options.storage.getRoom(roomId);
  if (room.status !== "ready") {
    throw new HttpError(409, "Room is not ready to start.", "ROOM_NOT_READY");
  }
  const record = options.runtime.createMatch(
    room.participants.map((participant) => participant.agentId),
    seed,
    normalizeMapPresetId(room.mapId)
  );
  return {
    room: options.storage.markRoomRunning(roomId, record.id),
    matchId: record.id,
    record
  };
}

function createProviderPromptResponse(
  options: BuildAppOptions,
  agentId: string,
  provider: AgentBridgeProvider,
  model: string | undefined,
  prefix: "" | "/api"
) {
  options.storage.getAgent(agentId);
  const observed = options.runtime.observeLocalAgent(agentId);
  const response: {
    status: typeof observed.status;
    provider: AgentBridgeProvider;
    request?: AgentActionRequest;
    payload?: ReturnType<typeof createProviderAgentRequest>;
    actionUrl: string;
  } = {
    status: observed.status,
    provider,
    actionUrl: `${prefix}/bridge/agents/${agentId}/action/${provider}`
  };
  if (observed.request) {
    response.request = observed.request;
    response.payload = createProviderAgentRequest(provider, observed.request, model);
  }
  return response;
}

function submitProviderAgentAction(
  options: BuildAppOptions,
  agentId: string,
  provider: AgentBridgeProvider,
  body: SubmitProviderAgentActionInput
) {
  const extracted = extractProviderAgentAction(provider, agentId, body.response);
  const actionRequest: SubmitLocalAgentActionRequest = {
    requestId: body.requestId,
    matchId: body.matchId,
    tick: body.tick,
    action: extracted.action
  };
  if (extracted.reason !== undefined) {
    actionRequest.reason = extracted.reason;
  }
  return options.runtime.submitLocalAgentAction(agentId, actionRequest);
}

function createProviderAgentRequest(
  provider: AgentBridgeProvider,
  request: AgentActionRequest,
  model?: string
) {
  switch (provider) {
    case "openai-chat":
      return createOpenAIChatAgentRequest(request, model);
    case "openai-responses":
      return createOpenAIResponsesAgentRequest(request, model);
    case "anthropic-messages":
      return createAnthropicMessagesAgentRequest(request, model);
  }
}

function extractProviderAgentAction(
  provider: AgentBridgeProvider,
  agentId: string,
  response: unknown
): ProviderAgentActionExtraction {
  try {
    switch (provider) {
      case "openai-chat":
        return extractOpenAIChatAgentAction(agentId, response);
      case "openai-responses":
        return extractOpenAIResponsesAgentAction(agentId, response);
      case "anthropic-messages":
        return extractAnthropicMessagesAgentAction(agentId, response);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Provider response could not be parsed.";
    throw new HttpError(400, message, "PROVIDER_RESPONSE_INVALID");
  }
}

function registerWebStaticRoutes(app: FastifyInstance, webDistDir: string | undefined): void {
  if (!webDistDir || !existsSync(resolve(webDistDir, "index.html"))) {
    return;
  }

  app.get("/", async (_request, reply) => sendStaticFile(reply, resolve(webDistDir, "index.html")));

  app.get("/assets/*", async (request, reply) => {
    const wildcard = (request.params as { "*": string })["*"];
    await sendStaticFile(reply, resolveSafeWebPath(webDistDir, `/assets/${wildcard}`));
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (isApiLikePath(request)) {
      reply.status(404).send({ error: "NOT_FOUND", message: "Route not found." });
      return;
    }

    const path = pathFromRequest(request);
    if (extname(path)) {
      const candidate = resolveSafeWebPath(webDistDir, path);
      if (existsSync(candidate)) {
        await sendStaticFile(reply, candidate);
        return;
      }
    }

    await sendStaticFile(reply, resolve(webDistDir, "index.html"));
  });
}

async function sendStaticFile(reply: FastifyReply, filePath: string) {
  try {
    const data = await readFile(filePath);
    reply.type(contentTypeForPath(filePath)).send(data);
  } catch {
    reply.status(404).send({ error: "STATIC_ASSET_NOT_FOUND", message: "Static asset not found." });
  }
}

function resolveSafeWebPath(webDistDir: string, requestPath: string): string {
  const root = resolve(webDistDir);
  const relative = decodeURIComponent(requestPath).replace(/^\/+/, "");
  const target = resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new HttpError(400, "Invalid static asset path.", "STATIC_ASSET_PATH_INVALID");
  }
  return target;
}

function pathFromRequest(request: FastifyRequest): string {
  return new URL(request.url, "http://agent-poppy.local").pathname;
}

function isApiLikePath(request: FastifyRequest): boolean {
  const path = pathFromRequest(request);
  return [
    "/api",
    "/agents",
    "/bridge",
    "/health",
    "/leaderboard",
    "/maps",
    "/matches",
    "/rooms"
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}
