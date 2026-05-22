# Provider bridge adapters

The local Agent bridge keeps one native game protocol and adds provider adapters around it.
This keeps the match runtime independent from OpenAI or Anthropic SDK details.

## Boundary

The server is not an OpenAI-compatible or Anthropic-compatible model proxy.
Provider clients still call their own model API directly.

The server only does two things:

1. Convert the current `AgentActionRequest` into a provider-shaped tool-call payload.
2. Convert the provider's tool-call response back into the native `AgentAction`.

Reference shapes:

- OpenAI function calling: `tools`, function JSON schema, and `tool_choice`.
- Anthropic Messages tool use: `tools`, `input_schema`, `tool_choice`, and `tool_use` content blocks.

## Endpoints

Native bridge endpoints stay unchanged:

- `GET /bridge/agents/:agentId/observe`
- `POST /bridge/agents/:agentId/action`

Provider helper endpoints:

- `GET /bridge/agents/:agentId/prompt/openai-chat?model=gpt-4.1`
- `GET /bridge/agents/:agentId/prompt/openai-responses?model=gpt-4.1`
- `GET /bridge/agents/:agentId/prompt/anthropic-messages?model=claude-sonnet-4-20250514`
- `POST /bridge/agents/:agentId/action/openai-chat`
- `POST /bridge/agents/:agentId/action/openai-responses`
- `POST /bridge/agents/:agentId/action/anthropic-messages`

The prompt endpoints return:

```json
{
  "status": { "connected": true },
  "provider": "openai-chat",
  "request": { "type": "observe" },
  "payload": { "model": "gpt-4.1" },
  "actionUrl": "/bridge/agents/agent_123/action/openai-chat"
}
```

If there is no active match request, `payload` and `request` are omitted.

## Action tool

All providers use the same tool name:

```text
choose_agent_action
```

Tool input:

```json
{
  "action": {
    "type": "move",
    "direction": "right"
  },
  "reason": "Move to a safe route while keeping pressure on the nearest opponent."
}
```

Allowed actions:

- `{ "type": "wait" }`
- `{ "type": "place_bubble" }`
- `{ "type": "move", "direction": "up" | "down" | "left" | "right" }`

The server still validates the extracted native action against the live `MatchState`.
Illegal provider choices fall back through the existing native validation path instead of being trusted blindly.

## OpenAI Chat flow

1. Connect local Agent: `POST /bridge/agents/:agentId/connect`.
2. Fetch prompt: `GET /bridge/agents/:agentId/prompt/openai-chat`.
3. Send `payload` to OpenAI Chat Completions.
4. Submit the full provider response:

```json
{
  "requestId": "local_match_agent_0",
  "matchId": "match_abc",
  "tick": 0,
  "response": {
    "choices": [
      {
        "message": {
          "tool_calls": [
            {
              "type": "function",
              "function": {
                "name": "choose_agent_action",
                "arguments": "{\"action\":{\"type\":\"wait\"},\"reason\":\"No safe attack window yet.\"}"
              }
            }
          ]
        }
      }
    ]
  }
}
```

## OpenAI Responses flow

Fetch `GET /bridge/agents/:agentId/prompt/openai-responses`, call the Responses API with the returned `payload`,
then submit a response containing an `output` item like:

```json
{
  "type": "function_call",
  "name": "choose_agent_action",
  "arguments": "{\"action\":{\"type\":\"place_bubble\"},\"reason\":\"Break nearby soft wall with escape route.\"}"
}
```

## Anthropic Messages flow

Fetch `GET /bridge/agents/:agentId/prompt/anthropic-messages`, call the Messages API with the returned `payload`,
then submit a response containing a `tool_use` content block:

```json
{
  "type": "tool_use",
  "name": "choose_agent_action",
  "input": {
    "action": { "type": "wait" },
    "reason": "Safe zone is shrinking; wait one tick before moving."
  }
}
```

## Compatibility notes

- The adapter uses forced tool selection for predictable game actions.
- Clients can override the model with `?model=...`.
- The game server never stores provider API keys.
- The adapter extracts only `action` and `reason`; provider reasoning or extra text is ignored.
- The native bridge remains the stable contract for Codex, Claude Code, OpenClaw-style local agents, and future SDK wrappers.

