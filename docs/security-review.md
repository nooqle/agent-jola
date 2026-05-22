# Agent Jola Developer Preview Security Review

This review records the security posture for the current Developer Preview implementation. The release target is not "no theoretical bugs"; it is "no known exploitable high-risk issue before public preview."

## Scope

- Hosted Portal auth: Google OAuth, dev-login guard, session cookie, logout.
- Product API key issue/list/revoke and runtime profile sync.
- Local install commands and local Agent provider keys.
- Prompt templates, replay/decision upload boundaries, quota placeholders.
- Legacy Agent Poppy compatibility aliases.

## Current Controls

- OAuth callback state is stored server-side as a one-time SHA-256 hash with a short TTL.
- Portal sessions are stored server-side and sent as `agent_jola_portal` httpOnly cookies with `SameSite=Lax`; production cookies are `Secure`.
- `POST /api/portal/dev-login` is disabled in production unless explicitly enabled.
- Raw Product API keys are returned only at creation time. List/install endpoints return metadata and placeholders, not the secret.
- Portal Product API key creation requires an existing hosted chameleon profile; unauthenticated or unconfigured users cannot issue runtime keys.
- Key revoke marks the server-side key record revoked and runtime auth rejects subsequent calls immediately.
- `/api/runtime/profile` is scoped to the authenticated Product API key owner.
- Product key default scopes are restricted to `profile:read/write`, `templates:read`, `rooms:read/write`, and `bridge`.
- Provider keys for OpenAI/Anthropic are local environment variables and are not uploaded to Portal APIs.
- Server logs redact authorization, portal token, product key, admin key, and cookie headers.
- Production CORS is restricted by `AGENT_JOLA_CORS_ORIGINS`; local development remains permissive.
- Server responses set baseline browser safety headers: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, and `Permissions-Policy`.
- OAuth start, Portal key issue, Product API room creation, and bridge prompt/action endpoints have lightweight in-memory rate limits for the Developer Preview.
- Profile writes validate lengths, color format, and bounded appearance fields.
- Legacy `AGENT_POPPY_*` and `X-Agent-Poppy-*` aliases are accepted only for compatibility and are not used in primary install commands.

## Threat Notes

- OAuth CSRF: mitigated by one-time state storage; callback rejects missing, expired, reused, or mismatched state.
- Session theft by frontend JS: mitigated by httpOnly cookie; Portal token header remains supported for local tooling but is not required by the hosted UI.
- API key leakage through list endpoints: blocked; the raw key is not persisted as a retrievable plaintext field.
- API key replay after revoke: covered by storage-backed status checks.
- Provider secret leakage: install commands never include provider API keys; local setting sync writes only Agent Jola runtime config.
- Prompt-template injection: templates are copied as user-facing text and are not executed as system instructions by the website.
- Replay/decision upload: official upload is not enabled by default; future upload must scrub absolute paths, env vars, and secret-like tokens before sending.
- Dev-login exposure: production disables it by default; release config must keep `AGENT_JOLA_ENABLE_DEV_PORTAL_LOGIN=false`.

## Required Release Checks

Run before tagging a public preview:

```powershell
pnpm build
pnpm lint
pnpm test
pnpm smoke:release
pnpm smoke:install
pnpm doctor:production
pnpm audit:security
pnpm verify:alpha
```

Manual acceptance:

- New user completes Google login, profile save, strategy save, key creation, and logout.
- Reusing the same Google account returns the same Portal user.
- Unauthenticated Portal calls cannot create keys or save profile.
- A logged-in user without a profile receives `PORTAL_PROFILE_REQUIRED` when trying to create a key.
- Raw key appears only once after creation.
- Revoke blocks `/api/runtime/profile` immediately.
- Production dev-login returns unavailable.
- Install command does not print OpenAI or Anthropic keys.
- `agent:setting sync` pulls only the key owner's profile.
- Clean install smoke succeeds without copying local `.env`, `.env.local`, runtime data, logs, screenshots, or built artifacts.

## Remaining Production Work

- Validate Google OAuth with real production credentials after `agentjola.tech` is deployed.
- Replace Developer Preview in-memory rate limits with shared store limits before multi-instance deployment.
- Add replay/decision upload scrubbing tests before enabling official upload.
- Review dependency advisories before opening the repository publicly.
