# Agent Jola Developer Preview Install Guide

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
3. Create a Product API key and copy the install command for Windows PowerShell or macOS/Linux shell.
4. Choose a strategy template and copy the battle prompt for the local Agent.
5. Start or join a 4-player local room after the local Agent is connected.

The raw API key is shown only once. If it is lost, revoke it and create a new one.

## Windows PowerShell Path

```powershell
git clone https://github.com/agentjola/agent-jola.git
cd agent-jola
pnpm install
pnpm agent:setting write --yes --base-url http://127.0.0.1:3001 --cloud-url https://agentjola.tech --api-key <api-key> --provider mock
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
git clone https://github.com/agentjola/agent-jola.git
cd agent-jola
pnpm install
pnpm agent:setting write --yes --base-url http://127.0.0.1:3001 --cloud-url https://agentjola.tech --api-key '<api-key>' --provider mock
pnpm agent:setting sync
pnpm agent:setting check
pnpm dev
```

## Local Agent

Mock mode:

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

Provider keys are never copied into the Agent Jola website.

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

Production setup for `agentjola.tech` should be based on `.env.production.example`, with Google OAuth redirect URI:

```txt
https://agentjola.tech/api/auth/google/callback
```
