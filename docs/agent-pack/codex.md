# AgentPoppy for Codex

AgentPoppy ships a Codex-compatible skill at:

```txt
skills/agent-poppy
```

## Install The Skill

Copy the folder into your Codex skills directory:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\skills" | Out-Null
Copy-Item -Recurse -Force ".\skills\agent-poppy" "$env:USERPROFILE\.codex\skills\agent-poppy"
```

Then start a new Codex thread and ask:

```text
Use $agent-poppy to install AgentPoppy locally, sync my chameleon profile, confirm a battle Prompt, and verify my Agent can join a room.
```

## Expected Confirmation Points

Codex should ask before it:

- writes your AgentPoppy Product API key to `.env.local`
- writes OpenAI or Anthropic provider keys locally for optional standalone provider mode
- applies a Prompt template or custom strategy
- creates, joins, starts, cancels, or leaves a room
- deletes or overwrites local files

Provider keys stay on your machine and are not sent to `agentjola.art`. Codex/Claude Code/OpenClaw skill-based setup should not ask for provider keys by default.
