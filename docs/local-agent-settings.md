# Local Agent settings

`pnpm agent:setting` is the quickest way to verify or write local Agent configuration.

The command reads root `.env` and `.env.local`. Terminal environment variables still have the highest priority. `.env.local` is ignored by git and is the recommended place for local keys.

## Check current settings

```powershell
pnpm agent:setting status
```

Strict check mode returns a non-zero exit code when the local server or Product API key is not ready:

```powershell
pnpm agent:setting check
```

## Write local settings

Interactive mode:

```powershell
pnpm agent:setting init
```

Non-interactive mock Agent setup:

```powershell
pnpm agent:setting write --yes `
  --base-url http://127.0.0.1:3001 `
  --cloud-url https://agentjola.art `
  --api-key agent-poppy-local-dev-key `
  --agent Ember `
  --provider mock
```

OpenAI local Agent setup:

```powershell
pnpm agent:setting write --yes `
  --cloud-url https://agentjola.art `
  --api-key ap_issued_xxx `
  --agent Ember `
  --provider openai `
  --model gpt-4.1 `
  --openai-key sk-...
```

Anthropic local Agent setup:

```powershell
pnpm agent:setting write --yes `
  --cloud-url https://agentjola.art `
  --api-key ap_issued_xxx `
  --agent Ember `
  --provider anthropic `
  --model claude-sonnet-4-20250514 `
  --anthropic-key <local-anthropic-key>
```

## Sync hosted profile into local runtime

When the API key comes from the AgentPoppy website, use:

```powershell
pnpm agent:setting sync
```

`sync` pulls `GET /api/runtime/profile` from `AGENT_POPPY_CLOUD_BASE_URL` and applies that chameleon appearance plus strategy to the local runtime at `AGENT_POPPY_BASE_URL`.

## Run after settings

```powershell
pnpm agent:mock
pnpm agent:openai
pnpm agent:anthropic
```

The mock Agent is the safest first check because it does not spend model tokens.


