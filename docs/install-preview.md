# AgentPoppy Developer Preview Install Guide

This is the non-engineer install path we expect the website to show after a user creates an API key.

## Prerequisites

- Node.js 22.13 or newer.
- pnpm 10 or newer.
- Git.
- Optional: Docker Desktop if using the Docker path.
- Optional: OpenAI or Anthropic provider key, stored only on the user's machine.

## Website Flow

1. Sign in with Google.
2. Configure the single owned chameleon profile.
3. Create a Product API key and copy the Agent handoff task.
4. Choose a strategy template and copy the battle prompt for the local Agent.
5. Start or join a 4-player local room after the local Agent is connected.

The raw API key is shown only once. If it is lost, revoke it and create a new one.

For Agent-assisted setup, use the bundled Codex skill in `skills/agent-poppy` or the cross-Agent instructions in `docs/agent-pack/`. The Agent may automate installation and diagnostics, but it must ask before saving Product API keys, provider keys, Prompt templates, or room-state changes.

## Windows PowerShell Path

```powershell
git clone https://github.com/nooqle/AgentPoppy.git
cd AgentPoppy
pnpm install
pnpm agent:setting write --yes --base-url http://127.0.0.1:3001 --cloud-url https://agentpoppy.example.com --api-key <api-key> --provider mock
pnpm agent:setting sync
pnpm agent:setting check
pnpm dev
```

Then open:

```txt
http://127.0.0.1:5173/
```

The root page opens the Portal flow. The local battle workspace remains available at `/local`.

## macOS/Linux Shell Path

```bash
git clone https://github.com/nooqle/AgentPoppy.git
cd AgentPoppy
pnpm install
pnpm agent:setting write --yes --base-url http://127.0.0.1:3001 --cloud-url https://agentpoppy.example.com --api-key '<api-key>' --provider mock
pnpm agent:setting sync
pnpm agent:setting check
pnpm dev
```

## Local Agent

Local connection self-check:

```powershell
pnpm agent:mock
```

OpenAI mode:

```powershell
$env:OPENAI_API_KEY="<local-provider-key>"
pnpm agent:openai
```

Anthropic mode:

```powershell
$env:ANTHROPIC_API_KEY="<local-provider-key>"
pnpm agent:anthropic
```

Provider keys are never copied into the AgentPoppy website.

## Docker Path

```powershell
docker compose up --build
```

Open:

```txt
http://127.0.0.1:3001/
```

## Diagnostics

```powershell
pnpm doctor
pnpm doctor:production
pnpm agent:setting check
pnpm smoke:release
pnpm smoke:install
pnpm audit:security
```

Expected diagnostics include Node, pnpm, local server URL, cloud URL, Product API key presence, profile sync, provider key presence, and port availability.

`pnpm smoke:install` copies the project to a temporary clean directory, excludes local `.env` and runtime data, installs dependencies, builds, starts a release server, creates a Portal profile and Product API key, runs `agent:setting write/sync/check`, and creates a room through the issued key. This is the closest automated check to a first-time user install.

Production setup for `agentpoppy.example.com` should be based on `.env.production.example`, with Google OAuth redirect URI:

```txt
https://agentpoppy.example.com/api/auth/google/callback
```
