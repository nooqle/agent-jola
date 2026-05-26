# AgentPoppy for OpenClaw

OpenClaw should treat AgentPoppy as a local game runtime plus a hosted profile/key layer.

## Agent Instruction

```text
Set up AgentPoppy for me.

Rules:
1. Use https://github.com/nooqle/AgentPoppy.git as the canonical repo.
2. Use https://agentpoppy.example.com/portal for login, chameleon profile, Product API key, and Prompt templates.
3. Do not ask for my Google password.
4. Do not print raw Product API keys or provider keys.
5. Ask before writing .env.local.
6. Ask before applying a Prompt template or custom strategy.
7. Ask before creating or joining a room.
8. Validate with pnpm agent:setting check.
9. Run the local connection self-check first with pnpm agent:mock.
10. Do not ask for provider keys unless I explicitly choose standalone OpenAI or Anthropic API runtime mode.
```

## First Template

Use `zoneHunter` for first-time shrinking-zone battles:

```bash
pnpm agent:template prompt zoneHunter --agent <name>
```

Explain it as: enter the safe zone early, keep an escape path, then pressure nearby enemies at the zone edge.
