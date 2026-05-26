# Local Agent Bridge

This bridge is the first local-agent integration slice. It lets an external process, such as Codex, Claude Code, OpenClaw, or a custom script, control one existing in-game Agent through HTTP while the local server still owns the authoritative match runtime.

The bridge is intentionally small:

- The game remains deterministic and server-authoritative.
- External Agents can only submit legal `AgentAction` values.
- If an external Agent misses the current tick, the internal planner is used as fallback.
- No cloud API key, account, or remote room authority is implemented in this slice.

## Endpoints

Base URL during local development:

```txt
http://127.0.0.1:3001
```

Connect a local controller:

```http
POST /bridge/agents/:agentId/connect
Content-Type: application/json

{ "label": "codex-local-agent" }
```

Response:

```json
{
  "status": {
    "agentId": "agent_x",
    "connected": true,
    "label": "codex-local-agent",
    "fallback": "internal-planner"
  },
  "observeUrl": "/bridge/agents/agent_x/observe",
  "actionUrl": "/bridge/agents/agent_x/action"
}
```

Read the latest observation:

```http
GET /bridge/agents/:agentId/observe
```

The response includes:

- `status`: connection and active request metadata.
- `request`: the current `AgentActionRequest`, when the Agent is alive in a running match.
- `request.observation.legalActions`: the only actions the local Agent should choose from.

Submit an action:

```http
POST /bridge/agents/:agentId/action
Content-Type: application/json

{
  "requestId": "local_match_x_agent_x_42",
  "matchId": "match_x",
  "tick": 42,
  "action": { "agentId": "agent_x", "type": "move", "direction": "left" },
  "reason": "Move toward the safe zone while keeping distance from active bubbles."
}
```

Disconnect:

```http
DELETE /bridge/agents/:agentId/connect
```

Check status:

```http
GET /bridge/agents/:agentId/status
```

Provider-specific helpers are documented in [`provider-bridge-adapters.md`](./provider-bridge-adapters.md).
They wrap the same native request/action contract for OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages tool use.

The product-shaped API key facade is documented in [`product-api-key-local-runtime.md`](./product-api-key-local-runtime.md).
Use `/api/*` endpoints when building a local client that should behave like an installed AgentPoppy runtime.

## Minimal Client Loop

1. Create or load an Agent through the normal app API.
2. `POST /bridge/agents/:agentId/connect`.
3. Start a 4-agent match with that Agent included.
4. Poll `GET /bridge/agents/:agentId/observe`.
5. If `request` exists, choose one action from `request.observation.legalActions`.
6. Submit it to `POST /bridge/agents/:agentId/action` with the same `requestId`, `matchId`, and `tick`.
7. Repeat until the match finishes.

If the local client is slow, stale submissions are rejected with `409`, and the match continues through the fallback planner.

## Action Shape

```ts
type AgentAction =
  | { agentId: string; type: "wait" }
  | { agentId: string; type: "place_bubble" }
  | { agentId: string; type: "move"; direction: "up" | "down" | "left" | "right" };
```

## Next Steps

This bridge is enough to prototype local Agent clients. The next production slice should add:

- room lifecycle APIs: create, join, ready, cancel, start
- signed or short-lived bridge tokens
- WebSocket observation streaming instead of polling
- reference local clients for Codex, Claude Code, and OpenAI SDK workflows

