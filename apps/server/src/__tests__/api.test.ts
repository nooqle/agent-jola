import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { MatchRuntimeManager } from "../runtime.js";
import { Storage } from "../storage.js";

let tempDir: string;
let storage: Storage;
const productApiHeaders = { "x-agent-jola-key": "agent-jola-local-dev-key" };

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "agent-bomber-server-"));
  storage = new Storage(tempDir);
  await storage.init();
});

afterEach(async () => {
  storage.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("server API", () => {
  it("serves the built web app when a web dist directory is configured", async () => {
    const webDistDir = join(tempDir, "web-dist");
    await mkdir(join(webDistDir, "assets"), { recursive: true });
    await writeFile(
      join(webDistDir, "index.html"),
      '<!doctype html><div id="root">Agent Jola Web</div><script src="/assets/app.js"></script>'
    );
    await writeFile(join(webDistDir, "assets", "app.js"), "console.log('agent-jola');");

    const runtime = new MatchRuntimeManager(storage, 1000);
    const app = await buildApp({ storage, runtime, webDistDir });

    try {
      const home = await app.inject({ method: "GET", url: "/" });
      expect(home.statusCode).toBe(200);
      expect(home.headers["content-type"]).toContain("text/html");
      expect(home.body).toContain("Agent Jola Web");

      const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
      expect(asset.statusCode).toBe(200);
      expect(asset.headers["content-type"]).toContain("text/javascript");
      expect(asset.body).toContain("agent-jola");

      const spaRoute = await app.inject({ method: "GET", url: "/battle/match_123" });
      expect(spaRoute.statusCode).toBe(200);
      expect(spaRoute.body).toContain("Agent Jola Web");

      const missingApi = await app.inject({ method: "GET", url: "/api/not-found" });
      expect(missingApi.statusCode).toBe(404);
      expect(missingApi.json()).toMatchObject({ error: "NOT_FOUND" });
    } finally {
      await app.close();
    }
  });

  it("requires a product API key for /api and exposes profile, room, and provider bridge flows", async () => {
    const runtime = new MatchRuntimeManager(storage, 1000);
    const app = await buildApp({ storage, runtime });

    try {
      const rejected = await app.inject({ method: "GET", url: "/api/me" });
      expect(rejected.statusCode).toBe(401);

      const me = await app.inject({ method: "GET", url: "/api/me", headers: productApiHeaders });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({
        user: {
          id: "local-user",
          mode: "local-dev",
          scopes: expect.arrayContaining([
            "profile:read",
            "templates:read",
            "rooms:write",
            "bridge"
          ])
        },
        capabilities: { roomMode: "royale-4", localRuntime: true },
        quotas: expect.arrayContaining([
          expect.objectContaining({ key: "room_create", limit: null, remaining: null }),
          expect.objectContaining({ key: "template_read", limit: null, remaining: null }),
          expect.objectContaining({ key: "bridge_prompt", limit: null, remaining: null })
        ])
      });

      const emptyProfile = await app.inject({
        method: "GET",
        url: "/api/profile",
        headers: productApiHeaders
      });
      expect(emptyProfile.statusCode).toBe(200);
      expect(emptyProfile.json().agent).toBeNull();

      const templates = await app.inject({
        method: "GET",
        url: "/api/strategy-templates",
        headers: productApiHeaders
      });
      expect(templates.statusCode).toBe(200);
      expect(templates.json().templates).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "zoneHunter", title: "毒圈追猎" })])
      );

      const templateDetail = await app.inject({
        method: "GET",
        url: "/api/strategy-templates/zoneHunter?agentName=Ember",
        headers: productApiHeaders
      });
      expect(templateDetail.statusCode).toBe(200);
      expect(templateDetail.json()).toMatchObject({
        template: { id: "zoneHunter" },
        localAgentPrompt: expect.stringContaining("Ember")
      });

      const missingTemplate = await app.inject({
        method: "GET",
        url: "/api/strategy-templates/nope",
        headers: productApiHeaders
      });
      expect(missingTemplate.statusCode).toBe(404);
      expect(missingTemplate.json()).toMatchObject({ error: "STRATEGY_TEMPLATE_NOT_FOUND" });

      const appliedTemplate = await app.inject({
        method: "POST",
        url: "/api/profile/agent/strategy-template",
        headers: productApiHeaders,
        payload: {
          name: "Template Local",
          templateId: "safeAttack",
          appearance: { color: "#f97316", accessory: "cap", skinId: "chameleon-101" }
        }
      });
      expect(appliedTemplate.statusCode).toBe(200);
      expect(appliedTemplate.json()).toMatchObject({
        name: "Template Local",
        currentStrategyVersion: { sourceText: expect.stringContaining("稳健进攻") }
      });

      const profileAgent = await app.inject({
        method: "POST",
        url: "/api/profile/agent",
        headers: productApiHeaders,
        payload: {
          name: "Product Local",
          strategyText: "本地 Agent API 策略：优先生存，安全时再攻击。",
          appearance: { color: "#38bdf8", accessory: "visor", skinId: "chameleon-128" }
        }
      });
      expect(profileAgent.statusCode).toBe(200);
      const localAgent = profileAgent.json();
      expect(localAgent).toMatchObject({
        name: "Product Local",
        appearance: { color: "#38bdf8", accessory: "visor", skinId: "chameleon-128" }
      });

      const otherAgents = [];
      for (const name of ["Product North", "Product East", "Product West"]) {
        const response = await app.inject({
          method: "POST",
          url: "/agents",
          payload: { name, strategyText: "内部测试策略：先进安全区，再寻找攻击机会。" }
        });
        expect(response.statusCode).toBe(200);
        otherAgents.push(response.json());
      }

      const roomResponse = await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers: productApiHeaders,
        payload: { mapId: "royale" }
      });
      expect(roomResponse.statusCode).toBe(200);
      const room = roomResponse.json();
      expect(room).toMatchObject({
        inviteCode: expect.stringMatching(/^AP-[A-Z2-9]{6}$/),
        hostAgentId: localAgent.id,
        participants: [expect.objectContaining({ agentId: localAgent.id })]
      });

      const inviteLookup = await app.inject({
        method: "GET",
        url: `/api/rooms/invite/${room.inviteCode.replace("-", "")}`,
        headers: productApiHeaders
      });
      expect(inviteLookup.statusCode).toBe(200);
      expect(inviteLookup.json().id).toBe(room.id);

      const joinedByInvite = await app.inject({
        method: "POST",
        url: "/api/rooms/join",
        headers: productApiHeaders,
        payload: { inviteCode: room.inviteCode, agentId: otherAgents[0].id }
      });
      expect(joinedByInvite.statusCode).toBe(200);

      for (const agent of otherAgents.slice(1)) {
        const joined = await app.inject({
          method: "POST",
          url: `/api/rooms/${room.id}/join`,
          headers: productApiHeaders,
          payload: { agentId: agent.id }
        });
        expect(joined.statusCode).toBe(200);
      }

      for (const agent of [localAgent, ...otherAgents]) {
        const ready = await app.inject({
          method: "POST",
          url: `/api/rooms/${room.id}/ready`,
          headers: productApiHeaders,
          payload: { agentId: agent.id, ready: true }
        });
        expect(ready.statusCode).toBe(200);
      }

      const connect = await app.inject({
        method: "POST",
        url: `/api/bridge/agents/${localAgent.id}/connect`,
        headers: productApiHeaders,
        payload: { label: "product-api-local-agent" }
      });
      expect(connect.statusCode).toBe(200);
      expect(connect.json()).toMatchObject({
        status: { connected: true, agentId: localAgent.id },
        promptUrls: {
          openaiResponses: `/api/bridge/agents/${localAgent.id}/prompt/openai-responses`
        }
      });

      const started = await app.inject({
        method: "POST",
        url: `/api/rooms/${room.id}/start`,
        headers: productApiHeaders,
        payload: { seed: "product-api-room-seed" }
      });
      expect(started.statusCode).toBe(200);
      const matchId = started.json().matchId;

      const prompt = await app.inject({
        method: "GET",
        url: `/api/bridge/agents/${localAgent.id}/prompt/openai-responses?model=gpt-product-test`,
        headers: productApiHeaders
      });
      expect(prompt.statusCode).toBe(200);
      const promptBody = prompt.json();
      expect(promptBody).toMatchObject({
        provider: "openai-responses",
        request: { observation: { matchId, agentId: localAgent.id } },
        payload: {
          model: "gpt-product-test",
          tool_choice: { type: "function", name: "choose_agent_action" }
        },
        actionUrl: `/api/bridge/agents/${localAgent.id}/action/openai-responses`
      });

      const action = await app.inject({
        method: "POST",
        url: `/api/bridge/agents/${localAgent.id}/action/openai-responses`,
        headers: productApiHeaders,
        payload: {
          requestId: promptBody.request.requestId,
          matchId,
          tick: promptBody.request.observation.tick,
          response: {
            output: [
              {
                type: "function_call",
                name: "choose_agent_action",
                arguments: JSON.stringify({
                  action: { type: "wait" },
                  reason: "Product API mock waits safely."
                })
              }
            ]
          }
        }
      });
      expect(action.statusCode).toBe(200);
      expect(action.json()).toMatchObject({
        accepted: true,
        action: { agentId: localAgent.id, type: "wait" }
      });
    } finally {
      await app.close();
    }
  });

  it("keeps legacy Agent Poppy product API headers working for one compatibility version", async () => {
    const runtime = new MatchRuntimeManager(storage, 1000);
    const app = await buildApp({ storage, runtime });

    try {
      const me = await app.inject({
        method: "GET",
        url: "/api/me",
        headers: { "x-agent-poppy-key": "agent-poppy-local-dev-key" }
      });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({
        user: { id: "local-user", mode: "local-dev" },
        auth: {
          header: "X-Agent-Jola-Key",
          legacyHeaders: ["X-Agent-Poppy-Key"]
        }
      });
    } finally {
      await app.close();
    }
  });

  it("reports configurable quota policy while defaulting to unlimited", async () => {
    const previousQuotas = process.env.AGENT_POPPY_QUOTAS;
    process.env.AGENT_POPPY_QUOTAS =
      "room_create=12,template_read=unlimited,template_apply=3,bridge_prompt=0,unknown=99";
    const runtime = new MatchRuntimeManager(storage, 1000);
    const app = await buildApp({ storage, runtime });

    try {
      const me = await app.inject({ method: "GET", url: "/api/me", headers: productApiHeaders });
      expect(me.statusCode).toBe(200);
      expect(me.json().quotas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "character_randomize", limit: null, remaining: null }),
          expect.objectContaining({ key: "room_create", limit: 12, remaining: 12 }),
          expect.objectContaining({ key: "template_read", limit: null, remaining: null }),
          expect.objectContaining({ key: "template_apply", limit: 3, remaining: 3 }),
          expect.objectContaining({ key: "bridge_prompt", limit: 0, remaining: 0 })
        ])
      );
    } finally {
      await app.close();
      if (previousQuotas === undefined) {
        delete process.env.AGENT_POPPY_QUOTAS;
      } else {
        process.env.AGENT_POPPY_QUOTAS = previousQuotas;
      }
    }
  });

  it("enforces configured product API quotas", async () => {
    const previousQuotas = process.env.AGENT_POPPY_QUOTAS;
    process.env.AGENT_POPPY_QUOTAS =
      "template_read=1,room_create=0,template_apply=0,character_randomize=0,bridge_prompt=0";
    const runtime = new MatchRuntimeManager(storage, 1000);
    const app = await buildApp({ storage, runtime });

    try {
      const firstTemplates = await app.inject({
        method: "GET",
        url: "/api/strategy-templates",
        headers: productApiHeaders
      });
      expect(firstTemplates.statusCode).toBe(200);

      const me = await app.inject({ method: "GET", url: "/api/me", headers: productApiHeaders });
      expect(me.statusCode).toBe(200);
      expect(me.json().quotas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "template_read", limit: 1, used: 1, remaining: 0 })
        ])
      );

      const secondTemplates = await app.inject({
        method: "GET",
        url: "/api/strategy-templates",
        headers: productApiHeaders
      });
      expect(secondTemplates.statusCode).toBe(429);
      expect(secondTemplates.json()).toMatchObject({ error: "PRODUCT_API_QUOTA_EXCEEDED" });

      const createRoom = await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers: productApiHeaders,
        payload: { mapId: "royale" }
      });
      expect(createRoom.statusCode).toBe(429);
      expect(createRoom.json()).toMatchObject({ error: "PRODUCT_API_QUOTA_EXCEEDED" });

      const randomizeCharacter = await app.inject({
        method: "POST",
        url: "/api/profile/agent",
        headers: productApiHeaders,
        payload: {
          name: "Quota Local",
          appearance: { color: "#38bdf8", accessory: "visor", skinId: "chameleon-128" }
        }
      });
      expect(randomizeCharacter.statusCode).toBe(429);
      expect(randomizeCharacter.json()).toMatchObject({ error: "PRODUCT_API_QUOTA_EXCEEDED" });
    } finally {
      await app.close();
      if (previousQuotas === undefined) {
        delete process.env.AGENT_POPPY_QUOTAS;
      } else {
        process.env.AGENT_POPPY_QUOTAS = previousQuotas;
      }
    }
  });

  it("enforces product API key scopes", async () => {
    const previousKey = process.env.AGENT_POPPY_API_KEY;
    process.env.AGENT_POPPY_API_KEY = "limited-key|profile:read";
    const runtime = new MatchRuntimeManager(storage, 1000);
    const app = await buildApp({ storage, runtime });

    try {
      const profile = await app.inject({
        method: "GET",
        url: "/api/profile",
        headers: { "x-agent-poppy-key": "limited-key" }
      });
      expect(profile.statusCode).toBe(200);
      expect(profile.json().user.scopes).toEqual(["profile:read"]);

      const createRoom = await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers: { "x-agent-poppy-key": "limited-key" },
        payload: { mapId: "royale" }
      });
      expect(createRoom.statusCode).toBe(403);
      expect(createRoom.json()).toMatchObject({ error: "PRODUCT_API_KEY_SCOPE_MISSING" });

      const templates = await app.inject({
        method: "GET",
        url: "/api/strategy-templates",
        headers: { "x-agent-poppy-key": "limited-key" }
      });
      expect(templates.statusCode).toBe(403);
      expect(templates.json()).toMatchObject({ error: "PRODUCT_API_KEY_SCOPE_MISSING" });
    } finally {
      await app.close();
      if (previousKey === undefined) {
        delete process.env.AGENT_POPPY_API_KEY;
      } else {
        process.env.AGENT_POPPY_API_KEY = previousKey;
      }
    }
  });

  it("issues signed product API keys with scoped access", async () => {
    const previousAdminKey = process.env.AGENT_JOLA_ADMIN_KEY;
    const previousIssuerSecret = process.env.AGENT_JOLA_KEY_ISSUER_SECRET;
    process.env.AGENT_JOLA_ADMIN_KEY = "admin-test-key";
    process.env.AGENT_JOLA_KEY_ISSUER_SECRET = "issuer-test-secret";
    const runtime = new MatchRuntimeManager(storage, 1000);
    const app = await buildApp({ storage, runtime });

    try {
      const rejected = await app.inject({
        method: "POST",
        url: "/api/admin/product-keys",
        payload: { handle: "No Admin" }
      });
      expect(rejected.statusCode).toBe(401);

      const issued = await app.inject({
        method: "POST",
        url: "/api/admin/product-keys",
        headers: { "x-agent-jola-admin-key": "admin-test-key" },
        payload: {
          handle: "OpenClaw Local",
          scopes: ["profile:read", "templates:read"],
          ttlSeconds: 3600
        }
      });
      expect(issued.statusCode).toBe(200);
      const body = issued.json();
      expect(body.key).toMatch(/^ap_issued_/);
      expect(body.id).toMatch(/^key_/);
      expect(body).toMatchObject({
        user: {
          handle: "OpenClaw Local",
          mode: "issued",
          scopes: ["profile:read", "templates:read"]
        },
        expiresAt: expect.any(String)
      });

      const me = await app.inject({
        method: "GET",
        url: "/api/me",
        headers: { "x-agent-jola-key": body.key }
      });
      expect(me.statusCode).toBe(200);
      expect(me.json().user).toMatchObject({
        handle: "OpenClaw Local",
        mode: "issued",
        scopes: ["profile:read", "templates:read"]
      });

      const templates = await app.inject({
        method: "GET",
        url: "/api/strategy-templates",
        headers: { "x-agent-jola-key": body.key }
      });
      expect(templates.statusCode).toBe(200);

      const createRoom = await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers: { "x-agent-jola-key": body.key },
        payload: { mapId: "royale" }
      });
      expect(createRoom.statusCode).toBe(403);
      expect(createRoom.json()).toMatchObject({ error: "PRODUCT_API_KEY_SCOPE_MISSING" });

      const listed = await app.inject({
        method: "GET",
        url: "/api/admin/product-keys",
        headers: { "x-agent-jola-admin-key": "admin-test-key" }
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().keys).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: body.id,
            handle: "OpenClaw Local",
            scopes: ["profile:read", "templates:read"]
          })
        ])
      );

      const revoked = await app.inject({
        method: "POST",
        url: `/api/admin/product-keys/${body.id}/revoke`,
        headers: { "x-agent-jola-admin-key": "admin-test-key" }
      });
      expect(revoked.statusCode).toBe(200);
      expect(revoked.json()).toMatchObject({ id: body.id, revokedAt: expect.any(String) });

      const revokedMe = await app.inject({
        method: "GET",
        url: "/api/me",
        headers: { "x-agent-jola-key": body.key }
      });
      expect(revokedMe.statusCode).toBe(401);
    } finally {
      await app.close();
      if (previousAdminKey === undefined) {
        delete process.env.AGENT_JOLA_ADMIN_KEY;
      } else {
        process.env.AGENT_JOLA_ADMIN_KEY = previousAdminKey;
      }
      if (previousIssuerSecret === undefined) {
        delete process.env.AGENT_JOLA_KEY_ISSUER_SECRET;
      } else {
        process.env.AGENT_JOLA_KEY_ISSUER_SECRET = previousIssuerSecret;
      }
    }
  });

  it("supports hosted portal profile, install command, and runtime profile sync", async () => {
    const previousIssuerSecret = process.env.AGENT_JOLA_KEY_ISSUER_SECRET;
    const previousPublicBaseUrl = process.env.AGENT_JOLA_PUBLIC_API_BASE_URL;
    process.env.AGENT_JOLA_KEY_ISSUER_SECRET = "portal-issuer-test-secret";
    process.env.AGENT_JOLA_PUBLIC_API_BASE_URL = "https://api.agentjola.test";
    const runtime = new MatchRuntimeManager(storage, 1000);
    const app = await buildApp({ storage, runtime });

    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/portal/dev-login",
        payload: { email: "ember@example.com", displayName: "Ember" }
      });
      expect(login.statusCode).toBe(200);
      const session = login.json();
      expect(session).toMatchObject({
        portalToken: expect.stringMatching(/^pt_/),
        user: { email: "ember@example.com", displayName: "Ember", provider: "dev" }
      });
      expect(login.headers["set-cookie"]).toContain("HttpOnly");
      expect(login.headers["set-cookie"]).toContain("SameSite=Lax");
      const portalHeaders = { "x-agent-jola-portal-token": session.portalToken };

      const cookieMe = await app.inject({
        method: "GET",
        url: "/api/portal/me",
        headers: { cookie: login.headers["set-cookie"] }
      });
      expect(cookieMe.statusCode).toBe(200);
      expect(cookieMe.json().user.email).toBe("ember@example.com");

      const rejectedKeyWithoutProfile = await app.inject({
        method: "POST",
        url: "/api/portal/product-keys",
        headers: portalHeaders,
        payload: { handle: "No Profile Runtime", provider: "mock" }
      });
      expect(rejectedKeyWithoutProfile.statusCode).toBe(409);
      expect(rejectedKeyWithoutProfile.json()).toMatchObject({ error: "PORTAL_PROFILE_REQUIRED" });

      const profile = await app.inject({
        method: "PUT",
        url: "/api/portal/profile",
        headers: portalHeaders,
        payload: {
          agentName: "Ember",
          appearance: { color: "#f97316", accessory: "visor", skinId: "chameleon-101" },
          strategyText: "毒圈优先生存，确认安全路线后再压制最近对手。"
        }
      });
      expect(profile.statusCode).toBe(200);
      expect(profile.json()).toMatchObject({
        agentName: "Ember",
        appearance: { color: "#f97316", accessory: "visor", skinId: "chameleon-101" }
      });

      const issued = await app.inject({
        method: "POST",
        url: "/api/portal/product-keys",
        headers: portalHeaders,
        payload: {
          handle: "Ember Runtime",
          provider: "openai",
          scopes: ["profile:read", "profile:write", "rooms:read", "rooms:write", "bridge"]
        }
      });
      expect(issued.statusCode).toBe(200);
      const keyBody = issued.json();
      expect(keyBody.key).toMatch(/^ap_issued_/);
      expect(keyBody.install).toMatchObject({
        baseUrl: "http://127.0.0.1:3001",
        cloudUrl: "https://api.agentjola.test",
        provider: "openai",
        commands: {
          clone: "git clone https://github.com/agentjola/agent-jola.git",
          configure: expect.stringContaining("--cloud-url https://api.agentjola.test"),
          syncProfile: "pnpm agent:setting sync",
          runAgent: "pnpm agent:openai"
        },
        env: {
          AGENT_JOLA_CLOUD_BASE_URL: "https://api.agentjola.test",
          AGENT_JOLA_API_KEY: keyBody.key
        }
      });

      const runtimeProfile = await app.inject({
        method: "GET",
        url: "/api/runtime/profile",
        headers: { "x-agent-jola-key": keyBody.key }
      });
      expect(runtimeProfile.statusCode).toBe(200);
      expect(runtimeProfile.json()).toMatchObject({
        user: { id: session.user.id, handle: "Ember Runtime", mode: "issued" },
        profile: {
          userId: session.user.id,
          agentName: "Ember",
          strategyText: expect.stringContaining("毒圈优先生存")
        }
      });

      const me = await app.inject({
        method: "GET",
        url: "/api/portal/me",
        headers: portalHeaders
      });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({
        profile: { agentName: "Ember" },
        keys: [expect.objectContaining({ id: keyBody.id, handle: "Ember Runtime" })]
      });

      const installAgain = await app.inject({
        method: "GET",
        url: `/api/portal/install-command/${keyBody.id}?provider=anthropic`,
        headers: portalHeaders
      });
      expect(installAgain.statusCode).toBe(200);
      expect(installAgain.json()).toMatchObject({
        provider: "anthropic",
        commands: { runAgent: "pnpm agent:anthropic" },
        env: { AGENT_JOLA_API_KEY: "<paste API key shown when it was created>" }
      });

      const revoked = await app.inject({
        method: "POST",
        url: `/api/portal/product-keys/${keyBody.id}/revoke`,
        headers: portalHeaders
      });
      expect(revoked.statusCode).toBe(200);
      expect(revoked.json()).toMatchObject({ id: keyBody.id, revokedAt: expect.any(String) });

      const rejectedRuntimeProfile = await app.inject({
        method: "GET",
        url: "/api/runtime/profile",
        headers: { "x-agent-jola-key": keyBody.key }
      });
      expect(rejectedRuntimeProfile.statusCode).toBe(401);
    } finally {
      await app.close();
      if (previousIssuerSecret === undefined) {
        delete process.env.AGENT_JOLA_KEY_ISSUER_SECRET;
      } else {
        process.env.AGENT_JOLA_KEY_ISSUER_SECRET = previousIssuerSecret;
      }
      if (previousPublicBaseUrl === undefined) {
        delete process.env.AGENT_JOLA_PUBLIC_API_BASE_URL;
      } else {
        process.env.AGENT_JOLA_PUBLIC_API_BASE_URL = previousPublicBaseUrl;
      }
    }
  });

  it("exposes safe auth behavior for Google OAuth, dev login, and logout", async () => {
    const runtime = new MatchRuntimeManager(storage, 1000);
    const app = await buildApp({ storage, runtime });

    try {
      const googleStart = await app.inject({ method: "GET", url: "/api/auth/google/start" });
      expect(googleStart.statusCode).toBe(503);
      expect(googleStart.headers["x-content-type-options"]).toBe("nosniff");
      expect(googleStart.headers["referrer-policy"]).toBe("no-referrer");
      expect(googleStart.json()).toMatchObject({ error: "GOOGLE_OAUTH_NOT_CONFIGURED" });

      const login = await app.inject({
        method: "POST",
        url: "/api/portal/dev-login",
        payload: { email: "logout@example.com", displayName: "Logout User" }
      });
      expect(login.statusCode).toBe(200);
      const cookie = login.headers["set-cookie"];

      const beforeLogout = await app.inject({
        method: "GET",
        url: "/api/portal/me",
        headers: { cookie }
      });
      expect(beforeLogout.statusCode).toBe(200);

      const logout = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { cookie }
      });
      expect(logout.statusCode).toBe(200);
      expect(logout.headers["set-cookie"]).toContain("Max-Age=0");

      const afterLogout = await app.inject({
        method: "GET",
        url: "/api/portal/me",
        headers: { cookie }
      });
      expect(afterLogout.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("builds production Google OAuth redirects and secure cookies for agentjola.tech", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousClientId = process.env.AGENT_JOLA_GOOGLE_CLIENT_ID;
    const previousClientSecret = process.env.AGENT_JOLA_GOOGLE_CLIENT_SECRET;
    const previousRedirect = process.env.AGENT_JOLA_GOOGLE_REDIRECT_URI;
    const previousPublicBaseUrl = process.env.AGENT_JOLA_PUBLIC_API_BASE_URL;
    const previousDevLogin = process.env.AGENT_JOLA_ENABLE_DEV_PORTAL_LOGIN;
    process.env.NODE_ENV = "production";
    process.env.AGENT_JOLA_GOOGLE_CLIENT_ID = "google-client-id";
    process.env.AGENT_JOLA_GOOGLE_CLIENT_SECRET = "google-client-secret";
    process.env.AGENT_JOLA_GOOGLE_REDIRECT_URI = "https://agentjola.tech/api/auth/google/callback";
    process.env.AGENT_JOLA_PUBLIC_API_BASE_URL = "https://agentjola.tech";
    process.env.AGENT_JOLA_ENABLE_DEV_PORTAL_LOGIN = "true";
    const runtime = new MatchRuntimeManager(storage, 1000);
    const app = await buildApp({ storage, runtime });

    try {
      const googleStart = await app.inject({
        method: "GET",
        url: "/api/auth/google/start?returnTo=/portal"
      });
      expect(googleStart.statusCode).toBe(302);
      const location = String(googleStart.headers.location);
      expect(location).toContain("https://accounts.google.com/o/oauth2/v2/auth");
      expect(location).toContain(
        encodeURIComponent("https://agentjola.tech/api/auth/google/callback")
      );
      expect(location).toContain("state=st_");

      const login = await app.inject({
        method: "POST",
        url: "/api/portal/dev-login",
        payload: { email: "secure-cookie@example.com" }
      });
      expect(login.statusCode).toBe(200);
      expect(login.headers["set-cookie"]).toContain("HttpOnly");
      expect(login.headers["set-cookie"]).toContain("SameSite=Lax");
      expect(login.headers["set-cookie"]).toContain("Secure");
    } finally {
      await app.close();
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      if (previousClientId === undefined) {
        delete process.env.AGENT_JOLA_GOOGLE_CLIENT_ID;
      } else {
        process.env.AGENT_JOLA_GOOGLE_CLIENT_ID = previousClientId;
      }
      if (previousClientSecret === undefined) {
        delete process.env.AGENT_JOLA_GOOGLE_CLIENT_SECRET;
      } else {
        process.env.AGENT_JOLA_GOOGLE_CLIENT_SECRET = previousClientSecret;
      }
      if (previousRedirect === undefined) {
        delete process.env.AGENT_JOLA_GOOGLE_REDIRECT_URI;
      } else {
        process.env.AGENT_JOLA_GOOGLE_REDIRECT_URI = previousRedirect;
      }
      if (previousPublicBaseUrl === undefined) {
        delete process.env.AGENT_JOLA_PUBLIC_API_BASE_URL;
      } else {
        process.env.AGENT_JOLA_PUBLIC_API_BASE_URL = previousPublicBaseUrl;
      }
      if (previousDevLogin === undefined) {
        delete process.env.AGENT_JOLA_ENABLE_DEV_PORTAL_LOGIN;
      } else {
        process.env.AGENT_JOLA_ENABLE_DEV_PORTAL_LOGIN = previousDevLogin;
      }
    }
  });

  it("does not expose dev-login in production unless explicitly enabled", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDevLogin = process.env.AGENT_JOLA_ENABLE_DEV_PORTAL_LOGIN;
    process.env.NODE_ENV = "production";
    delete process.env.AGENT_JOLA_ENABLE_DEV_PORTAL_LOGIN;
    const runtime = new MatchRuntimeManager(storage, 1000);
    const app = await buildApp({ storage, runtime });

    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/portal/dev-login",
        payload: { email: "prod@example.com" }
      });
      expect(login.statusCode).toBe(404);
      expect(login.json()).toMatchObject({ error: "PORTAL_DEV_LOGIN_DISABLED" });
    } finally {
      await app.close();
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      if (previousDevLogin === undefined) {
        delete process.env.AGENT_JOLA_ENABLE_DEV_PORTAL_LOGIN;
      } else {
        process.env.AGENT_JOLA_ENABLE_DEV_PORTAL_LOGIN = previousDevLogin;
      }
    }
  });

  it("runs a room through join, ready, start, and finished states", async () => {
    const runtime = new MatchRuntimeManager(storage, 1);
    const app = await buildApp({ storage, runtime });

    try {
      const agents = [];
      for (const name of ["Host", "Bravo", "Charlie", "Delta"]) {
        const response = await app.inject({
          method: "POST",
          url: "/agents",
          payload: { name, strategyText: "毒圈模式优先生存，靠近对手时再放泡压迫。" }
        });
        expect(response.statusCode).toBe(200);
        agents.push(response.json());
      }

      const roomResponse = await app.inject({
        method: "POST",
        url: "/rooms",
        payload: { hostAgentId: agents[0].id, mapId: "royale" }
      });
      expect(roomResponse.statusCode).toBe(200);
      const room = roomResponse.json();
      expect(room).toMatchObject({
        status: "draft",
        mode: "royale-4",
        mapId: "royale",
        hostAgentId: agents[0].id
      });
      expect(room.participants).toHaveLength(1);

      const prematureStart = await app.inject({
        method: "POST",
        url: `/rooms/${room.id}/start`,
        payload: { seed: "room-seed-early" }
      });
      expect(prematureStart.statusCode).toBe(409);

      let currentRoom = room;
      for (const agent of agents.slice(1)) {
        const joined = await app.inject({
          method: "POST",
          url: `/rooms/${room.id}/join`,
          payload: { agentId: agent.id }
        });
        expect(joined.statusCode).toBe(200);
        currentRoom = joined.json();
      }
      expect(currentRoom.participants).toHaveLength(4);
      expect(currentRoom.status).toBe("draft");

      for (const agent of agents.slice(0, 3)) {
        const ready = await app.inject({
          method: "POST",
          url: `/rooms/${room.id}/ready`,
          payload: { agentId: agent.id, ready: true }
        });
        expect(ready.statusCode).toBe(200);
        currentRoom = ready.json();
      }
      expect(currentRoom.status).toBe("draft");

      const finalReady = await app.inject({
        method: "POST",
        url: `/rooms/${room.id}/ready`,
        payload: { agentId: agents[3].id, ready: true }
      });
      expect(finalReady.statusCode).toBe(200);
      currentRoom = finalReady.json();
      expect(currentRoom.status).toBe("ready");
      expect(
        currentRoom.participants.every((participant: { ready: boolean }) => participant.ready)
      ).toBe(true);

      const started = await app.inject({
        method: "POST",
        url: `/rooms/${room.id}/start`,
        payload: { seed: "room-seed-0" }
      });
      expect(started.statusCode).toBe(200);
      const startedBody = started.json();
      expect(startedBody.room.status).toBe("running");
      expect(startedBody.room.matchId).toBe(startedBody.matchId);
      expect(startedBody.record.mapId).toBe("royale");

      const editRunning = await app.inject({
        method: "POST",
        url: `/rooms/${room.id}/leave`,
        payload: { agentId: agents[0].id }
      });
      expect(editRunning.statusCode).toBe(409);

      const finishedRecord = await waitForFinished(app, startedBody.matchId);
      expect(finishedRecord.status).toBe("finished");

      const finishedRoom = await app.inject({ method: "GET", url: `/rooms/${room.id}` });
      expect(finishedRoom.statusCode).toBe(200);
      expect(finishedRoom.json()).toMatchObject({
        id: room.id,
        status: "finished",
        matchId: startedBody.matchId
      });

      const cancelRoom = await app.inject({
        method: "POST",
        url: "/rooms",
        payload: { hostAgentId: agents[0].id }
      });
      const cancel = await app.inject({
        method: "POST",
        url: `/rooms/${cancelRoom.json().id}/cancel`
      });
      expect(cancel.statusCode).toBe(200);
      expect(cancel.json().status).toBe("cancelled");
    } finally {
      await app.close();
    }
  }, 90000);

  it("lets a local Agent bridge observe a match and submit an action", async () => {
    const runtime = new MatchRuntimeManager(storage, 1000);
    const app = await buildApp({ storage, runtime });

    try {
      const createdAgents = await Promise.all(
        ["Local", "North", "East", "West"].map(async (name) => {
          const response = await app.inject({
            method: "POST",
            url: "/agents",
            payload: { name, strategyText: "先保命，再寻找安全机会攻击。" }
          });
          expect(response.statusCode).toBe(200);
          return response.json();
        })
      );
      const localAgent = createdAgents[0];

      const connect = await app.inject({
        method: "POST",
        url: `/bridge/agents/${localAgent.id}/connect`,
        payload: { label: "codex-local-agent" }
      });
      expect(connect.statusCode).toBe(200);
      expect(connect.json()).toMatchObject({
        status: {
          agentId: localAgent.id,
          connected: true,
          label: "codex-local-agent",
          fallback: "internal-planner"
        },
        observeUrl: `/bridge/agents/${localAgent.id}/observe`,
        actionUrl: `/bridge/agents/${localAgent.id}/action`
      });

      const match = await app.inject({
        method: "POST",
        url: "/matches",
        payload: {
          agentIds: createdAgents.map((agent) => agent.id),
          seed: "bridge-seed-0",
          mapId: "royale"
        }
      });
      expect(match.statusCode).toBe(200);

      const observe = await app.inject({
        method: "GET",
        url: `/bridge/agents/${localAgent.id}/observe`
      });
      expect(observe.statusCode).toBe(200);
      const observationBody = observe.json();
      expect(observationBody.status).toMatchObject({
        connected: true,
        activeMatchId: match.json().matchId,
        latestTick: 0
      });
      expect(observationBody.request.observation).toMatchObject({
        matchId: match.json().matchId,
        tick: 0,
        agentId: localAgent.id
      });
      expect(observationBody.request.observation.legalActions).toContainEqual({
        agentId: localAgent.id,
        type: "wait"
      });

      const openAiPrompt = await app.inject({
        method: "GET",
        url: `/bridge/agents/${localAgent.id}/prompt/openai-chat?model=gpt-test`
      });
      expect(openAiPrompt.statusCode).toBe(200);
      expect(openAiPrompt.json()).toMatchObject({
        provider: "openai-chat",
        request: { requestId: observationBody.request.requestId },
        payload: {
          model: "gpt-test",
          tool_choice: { type: "function", function: { name: "choose_agent_action" } }
        },
        actionUrl: `/bridge/agents/${localAgent.id}/action/openai-chat`
      });
      expect(openAiPrompt.json().payload.tools[0].function.name).toBe("choose_agent_action");

      const openAiAction = await app.inject({
        method: "POST",
        url: `/bridge/agents/${localAgent.id}/action/openai-chat`,
        payload: {
          requestId: observationBody.request.requestId,
          matchId: match.json().matchId,
          tick: observationBody.request.observation.tick,
          response: {
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      type: "function",
                      function: {
                        name: "choose_agent_action",
                        arguments: JSON.stringify({
                          action: { type: "wait" },
                          reason: "OpenAI adapter chooses to wait safely."
                        })
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      });
      expect(openAiAction.statusCode).toBe(200);
      expect(openAiAction.json()).toMatchObject({
        accepted: true,
        action: { agentId: localAgent.id, type: "wait" }
      });

      const anthropicPrompt = await app.inject({
        method: "GET",
        url: `/bridge/agents/${localAgent.id}/prompt/anthropic-messages?model=claude-test`
      });
      expect(anthropicPrompt.statusCode).toBe(200);
      expect(anthropicPrompt.json()).toMatchObject({
        provider: "anthropic-messages",
        payload: {
          model: "claude-test",
          tool_choice: { type: "tool", name: "choose_agent_action" }
        }
      });
      expect(anthropicPrompt.json().payload.tools[0].input_schema).toMatchObject({
        type: "object"
      });

      const anthropicAction = await app.inject({
        method: "POST",
        url: `/bridge/agents/${localAgent.id}/action/anthropic-messages`,
        payload: {
          requestId: observationBody.request.requestId,
          matchId: match.json().matchId,
          tick: observationBody.request.observation.tick,
          response: {
            content: [
              {
                type: "tool_use",
                name: "choose_agent_action",
                input: {
                  action: { type: "wait" },
                  reason: "Anthropic adapter keeps the agent in place."
                }
              }
            ]
          }
        }
      });
      expect(anthropicAction.statusCode).toBe(200);
      expect(anthropicAction.json()).toMatchObject({
        accepted: true,
        action: { agentId: localAgent.id, type: "wait" }
      });

      const action = await app.inject({
        method: "POST",
        url: `/bridge/agents/${localAgent.id}/action`,
        payload: {
          requestId: observationBody.request.requestId,
          matchId: match.json().matchId,
          tick: observationBody.request.observation.tick,
          action: { agentId: localAgent.id, type: "wait" },
          reason: "保持当前安全位置，等待下一帧重新评估。"
        }
      });
      expect(action.statusCode).toBe(200);
      expect(action.json()).toMatchObject({
        accepted: true,
        action: { agentId: localAgent.id, type: "wait" },
        status: { connected: true, submittedRequestId: observationBody.request.requestId }
      });

      const disconnect = await app.inject({
        method: "DELETE",
        url: `/bridge/agents/${localAgent.id}/connect`
      });
      expect(disconnect.statusCode).toBe(200);
      expect(disconnect.json()).toMatchObject({ agentId: localAgent.id, connected: false });
    } finally {
      await app.close();
    }
  });

  it("creates agents, strategy versions, matches, and leaderboard entries", async () => {
    const runtime = new MatchRuntimeManager(storage, 1);
    const app = await buildApp({ storage, runtime });

    try {
      const first = await app.inject({
        method: "POST",
        url: "/agents",
        payload: {
          name: "Alpha",
          strategyText: "平衡策略，先确认逃生路线，再炸墙吃道具。",
          appearance: { color: "#38bdf8", accessory: "visor", skinId: "chameleon-128" }
        }
      });
      const second = await app.inject({
        method: "POST",
        url: "/agents",
        payload: { name: "Beta", strategyText: "激进追杀对手，看到机会就压制。" }
      });
      const third = await app.inject({
        method: "POST",
        url: "/agents",
        payload: { name: "Gamma", strategyText: "毒圈收缩时优先进安全区，沿路收集道具。" }
      });
      const fourth = await app.inject({
        method: "POST",
        url: "/agents",
        payload: { name: "Delta", strategyText: "游走控图，保持退路，最后阶段主动压迫对手。" }
      });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(third.statusCode).toBe(200);
      expect(fourth.statusCode).toBe(200);
      const firstAgent = first.json();
      const secondAgent = second.json();
      const thirdAgent = third.json();
      const fourthAgent = fourth.json();
      expect(firstAgent.appearance).toMatchObject({
        color: "#38bdf8",
        accessory: "visor",
        skinId: "chameleon-128"
      });

      const updated = await app.inject({
        method: "PATCH",
        url: `/agents/${firstAgent.id}`,
        payload: {
          name: "Alpha Prime",
          appearance: { color: "#f97316", accessory: "cap", skinId: "chameleon-101" }
        }
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().appearance).toMatchObject({
        color: "#f97316",
        accessory: "cap",
        skinId: "chameleon-101"
      });

      const strategy = await app.inject({
        method: "POST",
        url: `/agents/${secondAgent.id}/strategy-versions`,
        payload: { sourceText: "激进追杀对手，看到机会就压制。" }
      });
      expect(strategy.statusCode).toBe(200);

      const match = await app.inject({
        method: "POST",
        url: "/matches",
        payload: {
          agentIds: [firstAgent.id, secondAgent.id, thirdAgent.id, fourthAgent.id],
          seed: "mvp-seed-0",
          mapId: "royale"
        }
      });
      expect(match.statusCode).toBe(200);
      const matchBody = match.json();
      expect(matchBody.record.mapId).toBe("royale");
      const finishedRecord = await waitForFinished(app, matchBody.matchId);
      expect(finishedRecord.status).toBe("finished");
      expect(finishedRecord.mapId).toBe("royale");
      expect(finishedRecord.finishReason).toBe("elimination");
      expect(finishedRecord.winnerAgentId).toBeTruthy();

      const replay = await app.inject({
        method: "GET",
        url: `/matches/${matchBody.matchId}/replay`
      });
      expect(replay.statusCode).toBe(200);
      const replayBody = replay.json();
      expect(replayBody.frames.length).toBeGreaterThan(0);
      expect(replayBody.initialState.mapId).toBe("royale");
      expect(replayBody.initialState.players[0].appearance.accessory).toBe("cap");
      expect(replayBody.initialState.players[0].appearance.skinId).toBe("chameleon-101");
      expect(replayBody.initialState.zone.enabled).toBe(true);

      const decisions = await app.inject({
        method: "GET",
        url: `/matches/${matchBody.matchId}/decisions`
      });
      expect(decisions.statusCode).toBe(200);
      expect(decisions.json().length).toBeGreaterThan(0);

      const leaderboard = await app.inject({ method: "GET", url: "/leaderboard" });
      expect(leaderboard.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  }, 90000);
});

async function waitForFinished(app: Awaited<ReturnType<typeof buildApp>>, matchId: string) {
  for (let attempt = 0; attempt < 5000; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/matches/${matchId}` });
    const body = response.json();
    if (body.record.status === "finished") {
      return body.record;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`Match ${matchId} did not finish in time`);
}
