# Product API key local runtime

This is the first product-shaped API layer for local Agent clients.
It is still a local development version, not a hosted account system.

## What this solves

There are three separate keys/protocols:

- `AGENT_POPPY_API_KEY`: authenticates a local client to AgentPoppy's product API.
- `OPENAI_API_KEY`: lets a local client call OpenAI.
- `ANTHROPIC_API_KEY`: lets a local client call Anthropic.

AgentPoppy never stores OpenAI or Anthropic keys.
The local Agent client owns those provider calls and submits only the model's selected game action back to AgentPoppy.

## Local key

For local development, the server accepts this default key unless `NODE_ENV=production`:

```txt
agent-poppy-local-dev-key
```

You can override it:

```powershell
$env:AGENT_POPPY_API_KEY="your-local-product-key"
pnpm --filter @agent-poppy/server start
```

You can limit a key with scopes by appending `|scope+scope`:

```powershell
$env:AGENT_POPPY_API_KEY="viewer-key|profile:read+rooms:read"
```

Supported scopes:

- `profile:read`
- `profile:write`
- `templates:read`
- `rooms:read`
- `rooms:write`
- `bridge`
- `leaderboard:read`

## Issued keys

For the local Alpha, the server can also issue signed Product API keys. Configure:

```powershell
$env:AGENT_POPPY_ADMIN_KEY="agent-poppy-local-admin-key"
$env:AGENT_POPPY_KEY_ISSUER_SECRET="replace-with-a-long-random-local-secret"
```

Issue a key:

```http
POST /api/admin/product-keys
X-Agent-Poppy-Admin-Key: agent-poppy-local-admin-key
Content-Type: application/json

{
  "handle": "openclaw-local",
  "scopes": ["profile:read", "templates:read", "rooms:write", "bridge"],
  "ttlSeconds": 2592000
}
```

The response contains an `id` plus a signed `ap_issued_...` key. Use the key through `X-Agent-Poppy-Key` or `Authorization: Bearer ...` like any other Product API key.

List issued keys:

```http
GET /api/admin/product-keys
X-Agent-Poppy-Admin-Key: agent-poppy-local-admin-key
```

Revoke an issued key:

```http
POST /api/admin/product-keys/key_xxx/revoke
X-Agent-Poppy-Admin-Key: agent-poppy-local-admin-key
```

Revoked keys are rejected immediately by `/api/*` endpoints. Issued keys are recorded in local SQLite; configured env keys still work for simple local development.

This admin issuer is still useful for local self-hosting. The hosted product path now lives in [`hosted-product-api.md`](./hosted-product-api.md): the website creates a portal session, stores one user-owned profile, issues a key, and provides an Agent handoff task for the local runtime.

Clients may pass the key through either:

```http
X-Agent-Poppy-Key: your-local-product-key
```

or:

```http
Authorization: Bearer your-local-product-key
```

## Quotas

Quotas are intentionally unlimited by default for the local MVP. `/api/me` exposes the policy shape and current usage:

```json
{
  "quotas": [
    {
      "key": "character_randomize",
      "label": "Character randomization",
      "limit": null,
      "remaining": null,
      "used": 0
    },
    { "key": "room_create", "label": "Room creation", "limit": null, "remaining": null },
    {
      "key": "template_read",
      "label": "Strategy template reads",
      "limit": null,
      "remaining": null
    },
    {
      "key": "template_apply",
      "label": "Strategy template applies",
      "limit": null,
      "remaining": null
    },
    { "key": "bridge_prompt", "label": "Provider bridge prompts", "limit": null, "remaining": null }
  ]
}
```

`null` means unlimited. You can override the policy for local testing:

```powershell
$env:AGENT_POPPY_QUOTAS="room_create=100,template_apply=20,bridge_prompt=unlimited"
```

Finite quotas are enforced by the local server and stored in SQLite. When a quota is exhausted, the API returns `429 PRODUCT_API_QUOTA_EXCEEDED`.

Current quota mapping:

- `character_randomize`: `POST /api/profile/agent` when an appearance payload is submitted.
- `room_create`: `POST /api/rooms`.
- `template_read`: strategy template list/detail reads.
- `template_apply`: applying a strategy template to the local profile.
- `bridge_prompt`: provider prompt generation for OpenAI/Anthropic-compatible local Agents.

## Product API facade

All endpoints below require the AgentPoppy API key.
The older local Web/API endpoints remain unchanged so the current UI keeps working.

```http
GET  /api/me
GET  /api/profile
POST /api/profile/agent
POST /api/profile/agent/strategy-template
GET  /api/strategy-templates
GET  /api/strategy-templates/:templateId
GET  /api/agents
GET  /api/agents/:agentId
GET  /api/rooms
POST /api/rooms
POST /api/rooms/join
GET  /api/rooms/invite/:inviteCode
GET  /api/rooms/:roomId
POST /api/rooms/:roomId/join
POST /api/rooms/:roomId/leave
POST /api/rooms/:roomId/ready
POST /api/rooms/:roomId/cancel
POST /api/rooms/:roomId/start
GET  /api/leaderboard
```

Bridge endpoints:

```http
POST   /api/bridge/agents/:agentId/connect
DELETE /api/bridge/agents/:agentId/connect
GET    /api/bridge/agents/:agentId/status
GET    /api/bridge/agents/:agentId/prompt/openai-responses
GET    /api/bridge/agents/:agentId/prompt/anthropic-messages
POST   /api/bridge/agents/:agentId/action/openai-responses
POST   /api/bridge/agents/:agentId/action/anthropic-messages
```

## Run the local connection self-check Agent

Start server and web:

```powershell
pnpm dev
```

In another terminal:

```powershell
$env:AGENT_POPPY_API_KEY="agent-poppy-local-dev-key"
pnpm agent:mock
```

The self-check client proves the product API and bridge loop without spending model tokens.
It creates a local profile Agent if one does not exist, connects it to the bridge, waits for a running match, and submits `wait` actions.

## Prompt templates for local Agents

The same strategy templates used in the Web battle-prep screen are available from the local CLI.

List templates:

```powershell
pnpm agent:templates
```

Show one template:

```powershell
pnpm agent:template show zoneHunter
```

Generate a full prompt that can be pasted into Codex, Claude Code, OpenClaw, or another local Agent:

```powershell
pnpm agent:template prompt zoneHunter --agent Ember
```

Apply a template to the local profile Agent through the product API:

```powershell
$env:AGENT_POPPY_API_KEY="agent-poppy-local-dev-key"
pnpm agent:template apply zoneHunter --agent Ember
```

Apply a custom one-line strategy without using a preset:

```powershell
pnpm agent:template apply --strategy "先保命，进圈后再压制最近对手" --agent Ember
```

Current template IDs:

- `safeAttack`: balanced survival-first pressure
- `farmControl`: early wall breaking and item growth
- `survivor`: low-risk survival and shield/speed pickup
- `zoneHunter`: enter safe zone first, then pressure enemies at the edge

Template API:

```http
GET /api/strategy-templates
GET /api/strategy-templates/zoneHunter?agentName=Ember
POST /api/profile/agent/strategy-template
```

The detail endpoint returns the template plus a full `localAgentPrompt` string. The apply endpoint accepts:

```json
{
  "templateId": "zoneHunter",
  "name": "Ember"
}
```

## Use the local SDK

The `@agent-poppy/local-agent` package now exposes a small TypeScript client wrapper around the product API:

```ts
import { AgentPoppyClient } from "@agent-poppy/local-agent";

const client = new AgentPoppyClient({
  baseUrl: "http://127.0.0.1:3001",
  apiKey: "agent-poppy-local-dev-key"
});

const profile = await client.profile();
const room = await client.createRoom({ mapId: "royale" });

console.log(room.inviteCode);
```

Joining by invite code:

```ts
await client.joinRoomByInviteCode("AP-ABC123");
await client.setRoomReady(room.id, true);
```

## Run an OpenAI local Agent

```powershell
$env:AGENT_POPPY_API_KEY="agent-poppy-local-dev-key"
$env:OPENAI_API_KEY="sk-..."
$env:OPENAI_MODEL="gpt-4.1"
pnpm agent:openai
```

The client calls the OpenAI Responses API with the payload from:

```http
GET /api/bridge/agents/:agentId/prompt/openai-responses
```

Then it submits the full provider response to:

```http
POST /api/bridge/agents/:agentId/action/openai-responses
```

## Run an Anthropic local Agent

```powershell
$env:AGENT_POPPY_API_KEY="agent-poppy-local-dev-key"
$env:ANTHROPIC_API_KEY="<local-anthropic-key>"
$env:ANTHROPIC_MODEL="claude-sonnet-4-20250514"
pnpm agent:anthropic
```

The client calls the Anthropic Messages API with the payload from:

```http
GET /api/bridge/agents/:agentId/prompt/anthropic-messages
```

Then it submits the full provider response to:

```http
POST /api/bridge/agents/:agentId/action/anthropic-messages
```

## Runtime knobs

```powershell
$env:AGENT_POPPY_BASE_URL="http://127.0.0.1:3001"
$env:AGENT_POPPY_MAX_POLLS="240"
$env:AGENT_POPPY_POLL_MS="150"
```

## Production direction

This local API key shape now has a matching hosted service contract:

- hosted signup/login issues a scoped `AGENT_POPPY_API_KEY`
- local runtime uses that key to pull the user's character and strategy from `/api/runtime/profile`
- room creation and joining become cloud-authorized
- actual simulation can still run locally or move to a low-cost relay later


