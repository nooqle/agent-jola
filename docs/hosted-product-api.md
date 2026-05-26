# AgentPoppy Hosted Product API Foundation

AgentPoppy is open source, but the default product loop needs a hosted API:

1. The website owns login, character/profile configuration, API key issuance, quotas, and Agent handoff tasks.
2. The local open-source runtime owns local rooms, match execution, replay, and Agent bridge calls.
3. A Product API key connects the two: it lets the local install pull the user's hosted character and strategy, then run locally.

This is the current minimum contract. Google OAuth start/callback/logout endpoints are wired for production credentials, while `/api/portal/dev-login` remains a local-development stand-in and is disabled in production by default. Public environment variables and headers use `AGENT_POPPY_*` / `X-Agent-Poppy-*`.

## Google OAuth

```http
GET /api/auth/google/start
GET /api/auth/google/callback
POST /api/auth/logout
```

OAuth uses a one-time server-side state token to protect callback CSRF. Successful login sets the `agent_poppy_portal` httpOnly cookie with `SameSite=Lax`; production cookies are `Secure`.

## Portal session

Development login:

```http
POST /api/portal/dev-login
Content-Type: application/json

{
  "email": "player@example.com",
  "displayName": "Ember"
}
```

The response returns a `portalToken`. Website calls should send it through:

```http
X-Agent-Poppy-Portal-Token: pt_xxx
```

or:

```http
Authorization: Bearer pt_xxx
```

In production, dev login is disabled unless `AGENT_POPPY_ENABLE_DEV_PORTAL_LOGIN=true`.

## Hosted profile

```http
GET /api/portal/me
GET /api/portal/profile
PUT /api/portal/profile
```

`PUT /api/portal/profile` stores the one user-owned chameleon and strategy text:

```json
{
  "agentName": "Ember",
  "appearance": {
    "color": "#f97316",
    "accessory": "visor",
    "skinId": "chameleon-101"
  },
  "strategyText": "毒圈优先生存，确认安全路线后再压制最近对手。"
}
```

## Product API keys

```http
POST /api/portal/product-keys
GET /api/portal/product-keys
POST /api/portal/product-keys/:keyId/revoke
GET /api/portal/install-command/:keyId
```

Key issuance requires `AGENT_POPPY_KEY_ISSUER_SECRET` and an existing hosted profile for the logged-in user. This keeps the product flow strict: create the chameleon first, then issue the local runtime key.

The raw `ap_issued_...` API key is returned only when created. Later list/install endpoints show metadata and placeholder commands, but not the secret key.

Example issue request:

```json
{
  "handle": "Ember Runtime",
  "provider": "openai",
  "scopes": ["profile:read", "profile:write", "rooms:read", "rooms:write", "bridge"]
}
```

The response can still include local setup commands for API clients, but the hosted UI prefers the AgentPoppy skill handoff:

```json
{
  "commands": {
    "configure": "pnpm agent:setting write --yes --base-url http://127.0.0.1:3001 --cloud-url https://agentjola.art --api-key ap_issued_xxx --provider openai",
    "syncProfile": "pnpm agent:setting sync",
    "runServer": "pnpm dev",
    "runAgent": "pnpm agent:openai"
  }
}
```

## Runtime profile sync

Local installs pull the hosted profile through:

```http
GET /api/runtime/profile
X-Agent-Poppy-Key: ap_issued_xxx
```

The CLI wraps that flow:

```powershell
pnpm agent:setting write --yes `
  --base-url http://127.0.0.1:3001 `
  --cloud-url https://agentjola.art `
  --api-key ap_issued_xxx `
  --provider mock

pnpm agent:setting sync
```

`sync` reads the hosted profile from `AGENT_POPPY_CLOUD_BASE_URL` and applies it to the local runtime at `AGENT_POPPY_BASE_URL`.

## Self-hosting

Forks can run the same API locally and issue their own keys by configuring:

```powershell
$env:AGENT_POPPY_KEY_ISSUER_SECRET="replace-with-a-long-random-secret"
$env:AGENT_POPPY_PUBLIC_API_BASE_URL="https://your-api.example.com"
```

That makes the open-source project usable without our hosted service, while the official site can still commercialize API keys, quotas, and character limits.

