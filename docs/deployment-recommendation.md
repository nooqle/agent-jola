# Agent Jola Deployment Recommendation

Last reviewed: 2026-05-22

## Short Answer

Google Cloud is enough for Agent Jola, but the first hosted preview should not start with the full Cloud Run plus Cloud SQL plus Redis architecture unless we are ready to migrate storage away from local SQLite.

Recommended sequence:

1. **Developer Preview / first public beta:** one small Google Compute Engine VM running Docker Compose.
2. **Hosted production after traffic proves out:** Cloud Run for the web/API container, Cloud SQL for durable data, and Redis or Firestore-style synchronization only when multi-instance real-time room traffic needs it.
3. **Static marketing pages:** Firebase Hosting is fine if we later split the static site from the API.

## Why Not Cloud Run First

Cloud Run is attractive because it is managed, supports containers, supports WebSockets, and can scale down. However, Agent Jola currently uses SQLite plus local replay files. Cloud Run container file writes are in-memory and do not persist after the instance stops, so using the current storage layer on Cloud Run would risk losing portal users, API keys, rooms, replay files, and decision logs.

Cloud Run can support WebSockets, but a WebSocket connection keeps an instance active and billed. Multi-instance WebSockets also need external state synchronization because reconnects can land on a different instance. That means Cloud Run becomes a good production architecture only after we add a shared database and a shared real-time coordination path.

## Recommended P0 Hosting Shape

Use a small Compute Engine VM:

- Ubuntu VM.
- Docker Compose from this repo.
- Persistent disk for `data/`.
- Nginx or Caddy in front for HTTPS.
- `agentjola.tech` points to the VM.
- Google OAuth callback: `https://agentjola.tech/api/auth/google/callback`.
- Nightly backup of `data/agent-bomber.sqlite`, `data/replays`, and `data/decisions`.

This matches the current application design and keeps server cost and engineering complexity low.

## Recommended Next Architecture

When the product loop is validated:

- Move Portal/product data from SQLite to PostgreSQL.
- Move replay/decision artifacts to object storage.
- Keep local rooms local-first until real hosted multiplayer is explicitly needed.
- If hosted WebSocket rooms become important, add Redis Pub/Sub or another shared event channel before scaling Cloud Run beyond one instance.

## Sources To Recheck Before Launch

- Cloud Run pricing and free tier: https://cloud.google.com/run/pricing
- Cloud Run WebSockets behavior: https://docs.cloud.google.com/run/docs/triggering/websockets
- Cloud Run container filesystem behavior: https://cloud.google.com/run/docs/container-contract
- Compute Engine free tier: https://cloud.google.com/free/docs/compute-getting-started
- Cloud Run to Cloud SQL for PostgreSQL: https://cloud.google.com/sql/docs/postgres/connect-run
- Firebase Hosting quotas: https://firebase.google.com/docs/hosting/usage-quotas-pricing
