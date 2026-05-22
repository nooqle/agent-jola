# Agent Jola Relay Spike

The current recommendation is not to build full official internet relay before the Developer Preview. The product can launch as open-source local runtime plus hosted identity/profile/API key, then add networking in controlled stages.

## Option A: LAN Direct Connect

How it works:

- One player hosts the local Agent Jola server.
- Other players on the same LAN join by local IP and invite code.
- Every player still uses their own Product API key to pull profile and authorize local Agent participation.

Cost:

- Lowest server cost. The official service only handles login, profile, key, quotas, and templates.

Complexity:

- Low backend complexity.
- Medium UX complexity because users need the host IP and same-network access.

Security boundary:

- The host machine is authoritative for match runtime.
- The official service should not receive provider API keys or high-frequency game state.

Recommended for:

- Developer Preview, demos, small groups, cafes, office LANs.

## Option B: User-Owned Tunnel

How it works:

- Host runs Agent Jola locally and exposes it through Cloudflare Tunnel, Tailscale Funnel, ngrok, or similar.
- Friends join the tunnel URL plus room code.

Cost:

- Low official cost. Bandwidth and tunnel limits are mostly on the user/tool provider.

Complexity:

- Medium. Requires clear docs and warnings around exposing local ports.

Security boundary:

- Require Product API keys on room/bridge APIs.
- Recommend HTTPS tunnel providers.
- Do not expose admin endpoints without admin key.

Recommended for:

- Early external testing with technical users.

## Option C: Official Light Relay

How it works:

- Official service provides room rendezvous and low-rate WebSocket relay.
- Local host still runs simulation; relay forwards participant readiness, profile sync, and viewer events.

Cost:

- Moderate and controllable if limited to signaling and low-frequency state.
- Becomes expensive if full simulation snapshots or replay streams are relayed at high frequency for many rooms.

Complexity:

- High enough to defer. Needs abuse prevention, quotas, reconnect logic, room ownership, and observability.

Security boundary:

- Product API key required for every participant.
- Relay must not receive provider API keys.
- Server-side quotas should limit room creation, concurrent relays, bridge prompt count, and upload size.

Recommended for:

- Post-preview alpha after local install and Portal activation are proven.

## MVP Recommendation

Ship Developer Preview with Option A plus documented Option B. Build only the data contracts needed for Option C:

- room owner id
- participant user id
- invite code
- ready state
- optional match result upload
- quota counters

This keeps official infrastructure cost low while preserving a path to hosted relay later.
