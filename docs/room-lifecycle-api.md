# Room Lifecycle API

The room layer sits above match creation. It models a battle-royale waiting flow before a 4-agent royale match starts.

The current implementation is local-first:

- rooms are stored in SQLite
- room mode is fixed to `royale-4`
- every room gets a short `inviteCode` that can be shared instead of the opaque `roomId`
- a room can start only when 4 participants are ready
- the existing match runtime remains the authoritative game engine
- room status syncs to `finished` after its match finishes

## Status Model

```txt
draft -> ready -> running -> finished
draft -> cancelled
ready -> cancelled
```

`ready` is derived from participants: exactly 4 participants and all are ready.

## Endpoints

Create a room:

```http
POST /rooms
Content-Type: application/json

{
  "hostAgentId": "agent_x",
  "mapId": "royale"
}
```

List rooms:

```http
GET /rooms
```

Read one room:

```http
GET /rooms/:roomId
```

Join a room:

```http
POST /rooms/:roomId/join
Content-Type: application/json

{ "agentId": "agent_y" }
```

Join through an invite code:

```http
POST /api/rooms/join
X-Agent-Poppy-Key: your-local-product-key
Content-Type: application/json

{
  "inviteCode": "AP-ABC123",
  "agentId": "agent_y"
}
```

Invite code lookup:

```http
GET /api/rooms/invite/AP-ABC123
X-Agent-Poppy-Key: your-local-product-key
```

Leave a room:

```http
POST /rooms/:roomId/leave
Content-Type: application/json

{ "agentId": "agent_y" }
```

Set ready state:

```http
POST /rooms/:roomId/ready
Content-Type: application/json

{ "agentId": "agent_y", "ready": true }
```

Start the match:

```http
POST /rooms/:roomId/start
Content-Type: application/json

{ "seed": "optional-seed" }
```

Cancel a waiting room:

```http
POST /rooms/:roomId/cancel
```

## Room Shape

```ts
type RoomStatus = "draft" | "ready" | "running" | "finished" | "cancelled";

interface RoomRecord {
  id: string;
  inviteCode: string;
  mode: "royale-4";
  status: RoomStatus;
  mapId: MapPresetId;
  createdAt: string;
  updatedAt: string;
  maxParticipants: 4;
  hostAgentId?: string;
  matchId?: string;
  participants: Array<{
    agentId: string;
    name: string;
    appearance?: AgentAppearance;
    strategyVersionId?: string;
    ready: boolean;
    joinedAt: string;
  }>;
}
```

## Client Flow

1. Create or load the user's single Agent.
2. `POST /rooms` or `POST /api/rooms` with that Agent as host.
3. Share `inviteCode`; other players join through `/api/rooms/join`.
4. Each participant calls `/ready`.
5. When the room becomes `ready`, call `/start`.
6. Use the returned `matchId` to open the live match viewer.

