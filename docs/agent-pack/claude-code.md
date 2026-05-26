# AgentPoppy for Claude Code

Claude Code can use AgentPoppy through a copied instruction pack even when it does not load Codex skills directly.

## Prompt To Give Claude Code

```text
You are helping me set up AgentPoppy.

Follow the AgentPoppy workflow from this repository:
- install or verify the local project
- ask me to sign in at https://agentjola.art/portal and create a chameleon/Product API key
- never print raw API keys
- ask before writing Product API keys to .env.local
- do not ask for ANTHROPIC_API_KEY just because this is Claude Code
- only ask for OpenAI or Anthropic provider keys if I explicitly choose standalone provider runtime mode
- show and confirm the final battle Prompt before applying it
- use pnpm agent:setting sync and pnpm agent:setting check to validate
- run the local connection self-check first with `pnpm agent:mock`; provider-token mode is optional
- ask before creating or joining a room

Start by checking whether this folder is already an AgentPoppy repo.
```

## Useful Commands

```bash
pnpm doctor
pnpm build
pnpm agent:setting check
pnpm agent:templates
pnpm agent:template prompt zoneHunter --agent <name>
pnpm agent:setting sync
pnpm agent:mock
```

Use `skills/agent-poppy/SKILL.md` as the source of truth for confirmation and safety rules.
