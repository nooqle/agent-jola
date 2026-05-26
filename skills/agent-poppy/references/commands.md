# AgentPoppy Commands

Use these commands from the AgentPoppy repository root.

## Baseline Checks

```bash
node --version
pnpm --version
git --version
pnpm doctor
pnpm build
pnpm agent:setting status
pnpm agent:setting check
```

`pnpm agent:setting check` should report base URL, cloud URL, masked Product key, Agent name, provider, provider key presence, `.env.local` status, server connectivity, scopes, profile Agent, and quotas.

## Local Settings

Local self-check provider, using the internal value `mock`:

```bash
pnpm agent:setting write --yes --base-url http://127.0.0.1:3001 --cloud-url https://agentjola.art --api-key <api-key> --agent <name> --provider mock
pnpm agent:setting sync
pnpm agent:setting check
```

Standalone OpenAI API provider:

```bash
pnpm agent:setting write --yes --cloud-url https://agentjola.art --api-key <api-key> --agent <name> --provider openai --model gpt-4.1 --openai-key <local-provider-key>
pnpm agent:setting sync
pnpm agent:setting check
```

Standalone Anthropic API provider:

```bash
pnpm agent:setting write --yes --cloud-url https://agentjola.art --api-key <api-key> --agent <name> --provider anthropic --model claude-sonnet-4-20250514 --anthropic-key <local-provider-key>
pnpm agent:setting sync
pnpm agent:setting check
```

Do not use `--openai-key` or `--anthropic-key` unless the user explicitly chooses standalone provider mode and confirms local provider key storage. Claude Code/Codex/OpenClaw setup should run the local connection self-check first and does not need `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.

## Runtime

```bash
pnpm dev
pnpm agent:mock
pnpm agent:openai
pnpm agent:anthropic
```

`pnpm agent:openai` and `pnpm agent:anthropic` are optional standalone-provider checks. They are not required when an already-authenticated Agent such as Claude Code is operating the project through the AgentPoppy skill.

If a Claude Code/Codex/OpenClaw setup shows `provider=anthropic` or `provider=openai` unintentionally, switch it back to local self-check after user confirmation:

```bash
pnpm agent:setting write --yes --cloud-url https://agentjola.art --api-key <api-key> --agent <name> --provider mock
pnpm agent:setting sync
pnpm agent:setting check
```

Default URLs:

- Web: `http://127.0.0.1:5173/`
- API: `http://127.0.0.1:3001`
- Docker/release single-port UI: `http://127.0.0.1:3001/`

## Prompt Templates

```bash
pnpm agent:templates
pnpm agent:template show zoneHunter
pnpm agent:template prompt zoneHunter --agent <name>
pnpm agent:template apply zoneHunter --agent <name>
pnpm agent:template apply --strategy "先保命，进圈后再压制最近对手" --agent <name>
```

Known template IDs:

- `safeAttack`
- `farmControl`
- `survivor`
- `zoneHunter`

## Release Smoke

```bash
pnpm smoke:release
pnpm smoke:install
pnpm audit:security
```

Run smoke checks before claiming a clean production/developer-preview install path.
