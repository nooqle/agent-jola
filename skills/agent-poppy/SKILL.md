---
name: agent-poppy
description: Install, authorize, configure, and validate AgentPoppy local runtimes for Codex, Claude Code, OpenClaw, OpenAI, Anthropic, or custom local Agents. Use when a user asks an Agent to set up AgentPoppy, connect an API key, sync a chameleon profile, choose or apply battle prompt templates, create or join a room, run a local Agent, or diagnose AgentPoppy installation/auth/runtime issues.
---

# AgentPoppy

Use this skill to get a local Agent ready to play AgentPoppy. AgentPoppy is a local-first 4-Agent shrinking-zone battle arena with a hosted portal for chameleon identity, Product API keys, and strategy templates.

## Safety Rules

- Never ask for or enter the user's Google password. Send the user to `https://agentpoppy.example.com/portal` for login, profile creation, and raw Product API key creation.
- Never print raw `AGENT_POPPY_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, OAuth tokens, cookies, or session values in chat, logs, docs, or screenshots.
- Before writing a Product API key to `.env.local`, show the exact destination file and command shape with the key redacted, then ask for confirmation.
- Do not ask for `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` when the user is running through Codex, Claude Code, OpenClaw, or another already-authenticated Agent. Provider keys are only for the optional standalone local provider adapters, and require separate confirmation before writing to `.env.local`.
- Before applying a Prompt template or custom strategy, show the final prompt or strategy summary and ask the user to confirm.
- Before creating a room, joining a room, setting ready, starting a match, cancelling, revoking a key, or deleting local data, ask for action-time confirmation.
- Do not delete or overwrite an existing checkout, `.env`, `.env.local`, replay, decision log, or user-edited file without explicit approval.

## Provider Mode Decision

Default to the local self-check provider, whose internal setting value is `mock`, for skill-driven setup. This is correct when the current operator is Codex, Claude Code, OpenClaw, or another Agent that already has its own model access.

Only ask for `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` if the user explicitly says they want AgentPoppy's standalone local adapter to call OpenAI or Anthropic directly, for example `run pnpm agent:anthropic` or `use standalone Anthropic API mode`.

If `pnpm agent:setting check` reports a missing provider key while using the local self-check provider, treat that as non-blocking. If provider was accidentally set to `anthropic` or `openai` during a Claude Code/Codex/OpenClaw setup, switch back to local self-check (`--provider mock`) after confirmation instead of asking for a provider key.

## Workflow

1. **Orient**
   - If inside an AgentPoppy repo, run `git status --short --branch` and inspect `package.json`.
   - If not inside a repo, ask for an install directory unless the user gave one.
   - Use `https://github.com/nooqle/AgentPoppy.git` as the canonical repository.

2. **Install or update**
   - Check `node --version`, `pnpm --version`, and `git --version`.
   - If installing fresh:
     ```bash
     git clone https://github.com/nooqle/AgentPoppy.git
     cd AgentPoppy
     corepack enable
     pnpm install
     ```
   - If already installed, do not run destructive resets. Prefer `git status`, `git fetch`, and ask before changing branches.

3. **Validate local project**
   - Run:
     ```bash
     pnpm doctor
     pnpm build
     pnpm agent:setting check
     ```
   - If the user wants a release-style install test, run `pnpm smoke:install`.

4. **Authorize with Product API key**
   - Tell the user to create a chameleon and Product API key at `https://agentpoppy.example.com/portal`.
   - When the user provides a key, do not repeat it. Treat it as sensitive.
   - Ask for confirmation before writing local settings:
     ```bash
     pnpm agent:setting write --yes --base-url http://127.0.0.1:3001 --cloud-url https://agentpoppy.example.com --api-key <redacted> --provider mock --agent <name>
     ```
   - Then run:
     ```bash
     pnpm agent:setting sync
     pnpm agent:setting check
     ```

5. **Choose and verify Prompt template**
   - List templates with `pnpm agent:templates`.
   - Preview one with:
     ```bash
     pnpm agent:template prompt zoneHunter --agent <name>
     ```
   - Show the user the prompt or concise summary and ask for confirmation.
   - Apply only after confirmation:
     ```bash
     pnpm agent:template apply zoneHunter --agent <name>
     ```
   - For custom natural-language strategy:
     ```bash
     pnpm agent:template apply --strategy "<strategy>" --agent <name>
     ```

6. **Run local runtime and Agent**
   - Start app:
     ```bash
     pnpm dev
     ```
   - Open `http://127.0.0.1:5173/` unless the terminal prints a different Vite URL.
   - First run the local connection self-check. It does not use model-provider tokens:
     ```bash
     pnpm agent:mock
     ```
   - Do not run provider-token mode unless the user explicitly asks for a standalone OpenAI or Anthropic API adapter. Claude Code itself does not require `ANTHROPIC_API_KEY` for this workflow.
   - If the user explicitly chooses standalone provider mode, confirm local provider key handling first:
     ```bash
     pnpm agent:openai
     pnpm agent:anthropic
     ```

7. **Create or join a room**
   - Use the local UI when possible.
   - Before creating or joining a room, confirm the target action and invite code.
   - 4-player `royale-4` is the default mode. A match starts only after four participants are ready.

8. **Report outcome**
   - Summarize what was installed, what was configured, which checks passed, and what remains.
   - Mention only masked key state, for example `Product API key: configured`, never the raw key.

## References

- For exact command variants and troubleshooting, read `references/commands.md`.
- For Prompt template confirmation language, read `references/prompt-confirmation.md`.
- For room and provider behavior, read `references/runtime-flows.md`.
