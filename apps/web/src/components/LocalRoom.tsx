import {
  AlertTriangle,
  Check,
  Copy,
  DoorOpen,
  KeyRound,
  LoaderCircle,
  Play,
  RefreshCcw,
  ShieldCheck,
  Swords,
  UsersRound,
  Wifi,
  WifiOff
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  AgentDetail,
  LocalAgentControllerStatus,
  RoomParticipant,
  RoomRecord
} from "@agent-poppy/protocol";
import {
  ApiRequestError,
  clearLocalProductApiKey,
  DEFAULT_LOCAL_PRODUCT_API_KEY,
  localAgentStatus,
  localAgents,
  localCreateAgent,
  localCreateRoom,
  localGetRoom,
  localJoinRoom,
  localRooms,
  localSetRoomReady,
  localStartRoom,
  loadLocalProductApiKey,
  productCreateRoom,
  productGetRoom,
  productJoinRoom,
  productLocalAgentStatus,
  productMe,
  productProfile,
  productRooms,
  productSetRoomReady,
  productStartRoom,
  productUpsertProfileAgent,
  saveLocalProductApiKey,
  type ProductMeData
} from "../api";
import { getAgentSkin, getSkinSignature, normalizeAgentSkinId } from "../skins";
import type { MatchRecord } from "../types";

const defaultLocalStrategy =
  "毒圈生存：开局破墙吃道具，毒圈收缩前提前进安全区，确认逃生路线后再压制最近对手。";

type LocalRoomPhase = "loading" | "key" | "ready" | "error";
type LocalRoomAuthMode = "product-api" | "local-web";
type LocalRoomAgent = Pick<
  AgentDetail,
  "id" | "name" | "appearance" | "createdAt" | "currentStrategyVersionId"
> &
  Partial<AgentDetail>;

interface ResolvedLocalRoom {
  me: ProductMeData | null;
  agent: LocalRoomAgent;
  room: RoomRecord;
  bridgeStatus: LocalAgentControllerStatus | null;
  authMode: LocalRoomAuthMode;
}

export function LocalRoom({ onOpenMatch }: { onOpenMatch: (match: MatchRecord) => void }) {
  const [apiKey, setApiKey] = useState(() => loadLocalProductApiKey());
  const [draftApiKey, setDraftApiKey] = useState(() =>
    apiKey === DEFAULT_LOCAL_PRODUCT_API_KEY ? "" : apiKey
  );
  const [phase, setPhase] = useState<LocalRoomPhase>("loading");
  const [me, setMe] = useState<ProductMeData | null>(null);
  const [agent, setAgent] = useState<LocalRoomAgent | null>(null);
  const [room, setRoom] = useState<RoomRecord | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<LocalAgentControllerStatus | null>(null);
  const [authMode, setAuthMode] = useState<LocalRoomAuthMode>("product-api");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "ready" | "start" | "refresh">("");
  const [copied, setCopied] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let disposed = false;
    setPhase("loading");
    setError("");
    void resolveLocalRoom(apiKey)
      .then((next) => {
        if (disposed) return;
        setMe(next.me);
        setAgent(next.agent);
        setRoom(next.room);
        setBridgeStatus(next.bridgeStatus);
        setAuthMode(next.authMode);
        setPhase("ready");
      })
      .catch((loadError) => {
        if (disposed) return;
        if (loadError instanceof ApiRequestError && loadError.status === 401) {
          setPhase("key");
          setError("这个本地 API key 没有通过校验。");
          return;
        }
        setPhase("error");
        setError(errorMessage(loadError));
      });
    return () => {
      disposed = true;
    };
  }, [apiKey, reloadToken]);

  useEffect(() => {
    if (phase !== "ready" || !room || !agent) return;
    const id = window.setInterval(() => {
      void Promise.all([
        authMode === "product-api" ? productGetRoom(apiKey, room.id) : localGetRoom(room.id),
        (authMode === "product-api"
          ? productLocalAgentStatus(apiKey, agent.id)
          : localAgentStatus(agent.id)
        ).catch(() => null)
      ])
        .then(([nextRoom, nextStatus]) => {
          setRoom(nextRoom);
          setBridgeStatus(nextStatus);
        })
        .catch((pollError) => {
          if (pollError instanceof ApiRequestError && pollError.status === 404) {
            setReloadToken((current) => current + 1);
          }
        });
    }, 3000);
    return () => window.clearInterval(id);
  }, [agent?.id, apiKey, authMode, phase, room?.id]);

  const readyCount = room?.participants.filter((participant) => participant.ready).length ?? 0;
  const myParticipant = agent
    ? room?.participants.find((participant) => participant.agentId === agent.id)
    : undefined;
  const canEditRoom = Boolean(room && roomCanBeEdited(room));
  const canStartRoom = Boolean(room && room.status === "ready");

  const copyInvite = async () => {
    if (!room) return;
    await navigator.clipboard.writeText(room.inviteCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const refresh = useCallback(() => {
    setBusy("refresh");
    setReloadToken((current) => current + 1);
    window.setTimeout(() => setBusy(""), 300);
  }, []);

  const submitApiKey = () => {
    const trimmed = draftApiKey.trim();
    if (!trimmed) {
      setError("请粘贴 AgentPoppy Product API key。");
      return;
    }
    saveLocalProductApiKey(trimmed);
    setApiKey(trimmed);
  };

  const useDefaultKey = () => {
    clearLocalProductApiKey();
    setDraftApiKey("");
    setApiKey(DEFAULT_LOCAL_PRODUCT_API_KEY);
    setReloadToken((current) => current + 1);
  };

  const setReady = async (ready: boolean) => {
    if (!room || !agent || !canEditRoom) return;
    setBusy("ready");
    setError("");
    try {
      const nextRoom =
        authMode === "product-api"
          ? await productSetRoomReady(apiKey, room.id, ready, agent.id)
          : await localSetRoomReady(room.id, agent.id, ready);
      setRoom(nextRoom);
    } catch (readyError) {
      setError(errorMessage(readyError));
    } finally {
      setBusy("");
    }
  };

  const startRoom = async () => {
    if (!room || !canStartRoom) return;
    setBusy("start");
    setError("");
    try {
      const started =
        authMode === "product-api"
          ? await productStartRoom(apiKey, room.id)
          : await localStartRoom(room.id);
      setRoom(started.room);
      onOpenMatch(started.record);
    } catch (startError) {
      setError(errorMessage(startError));
    } finally {
      setBusy("");
    }
  };

  if (phase === "key") {
    return (
      <LocalApiKeyGate
        apiKey={draftApiKey}
        error={error}
        onApiKeyChange={setDraftApiKey}
        onSubmit={submitApiKey}
        onUseDefault={useDefaultKey}
      />
    );
  }

  if (phase === "loading") {
    return (
      <section className="local-room-shell local-room-loading">
        <div className="local-room-loading-mark">
          <LoaderCircle size={34} />
        </div>
        <p className="eyebrow">Local runtime</p>
        <h1>正在进入本地房间</h1>
        <p>正在连接本机运行时，不需要 Portal 登录。</p>
      </section>
    );
  }

  if (phase === "error" || !room || !agent) {
    return (
      <section className="local-room-shell local-room-error">
        <AlertTriangle size={34} />
        <p className="eyebrow">Local runtime</p>
        <h1>房间状态暂时不可用</h1>
        <p>{error || "没有拿到本地房间状态。"}</p>
        <div className="local-room-actions">
          <button type="button" className="primary-button" onClick={refresh}>
            <RefreshCcw size={17} />
            重试
          </button>
          <button type="button" className="secondary-button" onClick={() => setPhase("key")}>
            <KeyRound size={17} />
            更换 API key
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="local-room-shell">
      <div className="local-room-topline">
        <div>
          <p className="eyebrow">Local Room</p>
          <h1>当前房间等待中</h1>
          <p>
            本地页面优先用 Product API key 访问运行时；没有浏览器保存 key 时，会直连同一台本地运行时。
            打开 `/local` 会恢复或创建默认房间，不再要求用户登录 Portal。
          </p>
        </div>
        <div className="local-room-status-stack">
          <span className="local-runtime-pill">
            <ShieldCheck size={16} />
            {authMode === "product-api" ? "API key 已接入" : "本地运行时直连"}
          </span>
          <small>
            {authMode === "product-api"
              ? me?.auth.source === "local-dev-default"
                ? "local-dev-default"
                : maskKey(apiKey)
              : "local-web"}
          </small>
        </div>
      </div>

      {error ? <div className="portal-alert local-room-alert">{error}</div> : null}

      <div className="local-room-grid">
        <main className="local-room-panel">
          <header className="local-room-panel-head">
            <div>
              <span>邀请码</span>
              <strong>{room.inviteCode}</strong>
            </div>
            <small className={`room-state room-state-${room.status}`}>{roomStatusLabel(room.status)}</small>
          </header>

          <div className="local-room-metrics" aria-label="房间状态">
            <span>
              <UsersRound size={17} />
              {room.participants.length}/{room.maxParticipants} 人
            </span>
            <span>
              <Check size={17} />
              {readyCount}/{room.maxParticipants} Ready
            </span>
            <span>
              <Swords size={17} />
              royale-4
            </span>
          </div>

          <div className="local-room-board-row">
            <RoomPreviewMap room={room} />
            <RoomRoster room={room} />
          </div>

          <div className="local-room-actions">
            <button type="button" className="primary-button" onClick={() => void copyInvite()}>
              {copied ? <Check size={17} /> : <Copy size={17} />}
              {copied ? "邀请码已复制" : "复制邀请码"}
            </button>
            <button type="button" className="secondary-button" onClick={refresh} disabled={busy === "refresh"}>
              <RefreshCcw size={17} />
              刷新
            </button>
            <button
              type="button"
              className={myParticipant?.ready ? "secondary-button" : "primary-button"}
              disabled={!canEditRoom || busy === "ready"}
              onClick={() => void setReady(!myParticipant?.ready)}
            >
              {myParticipant?.ready ? <Check size={17} /> : <DoorOpen size={17} />}
              {myParticipant?.ready ? "取消 Ready" : "标记 Ready"}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!canStartRoom || busy === "start"}
              onClick={() => void startRoom()}
            >
              <Play size={17} />
              开始对战
            </button>
          </div>
        </main>

        <aside className="local-agent-card">
          <AgentIdentity agent={agent} bridgeStatus={bridgeStatus} />
          <dl className="local-room-facts">
            <div>
              <dt>Room ID</dt>
              <dd>{room.id}</dd>
            </div>
            <div>
              <dt>更新</dt>
              <dd>{formatClock(room.updatedAt)}</dd>
            </div>
            <div>
              <dt>地图</dt>
              <dd>毒圈废墟</dd>
            </div>
          </dl>
          <button type="button" className="ghost-button local-key-switch" onClick={() => setPhase("key")}>
            <KeyRound size={16} />
            更换本地 API key
          </button>
        </aside>
      </div>
    </section>
  );
}

function LocalApiKeyGate({
  apiKey,
  error,
  onApiKeyChange,
  onSubmit,
  onUseDefault
}: {
  apiKey: string;
  error: string;
  onApiKeyChange: (apiKey: string) => void;
  onSubmit: () => void;
  onUseDefault: () => void;
}) {
  return (
    <section className="local-room-shell local-room-key-gate">
      <div>
        <p className="eyebrow">Product API key</p>
        <h1>连接本地运行时</h1>
        <p>这里不走 Portal 登录。粘贴本地 Product API key 后，会直接进入默认房间等待页。</p>
      </div>
      <div className="local-key-card">
        <label className="field-label">
          <span>本地 API key</span>
          <input
            value={apiKey}
            type="password"
            autoComplete="off"
            placeholder="ap_issued_... 或 agent-poppy-local-dev-key"
            onChange={(event) => onApiKeyChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onSubmit();
              }
            }}
          />
        </label>
        {error ? <small className="danger-copy">{error}</small> : null}
        <div className="local-room-actions">
          <button type="button" className="primary-button" onClick={onSubmit}>
            <KeyRound size={17} />
            进入本地房间
          </button>
          <button type="button" className="secondary-button" onClick={onUseDefault}>
            使用本地默认 key
          </button>
        </div>
      </div>
    </section>
  );
}

function RoomPreviewMap({ room }: { room: RoomRecord }) {
  const hardTiles = useMemo(
    () => new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 26, 39, 52, 65, 78, 91, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116]),
    []
  );
  const softTiles = useMemo(
    () => new Set([18, 19, 20, 31, 33, 43, 45, 47, 58, 59, 70, 72, 83, 85, 96, 97, 98]),
    []
  );

  return (
    <div className="local-room-map" aria-label="毒圈废墟房间预览">
      {Array.from({ length: 117 }).map((_, index) => (
        <span
          key={index}
          className={`local-room-tile ${hardTiles.has(index) ? "hard" : softTiles.has(index) ? "soft" : ""}`}
        />
      ))}
      <span className="local-room-safe-zone" />
      {room.participants.slice(0, 4).map((participant, index) => (
        <span
          key={participant.agentId}
          className={`local-room-map-agent agent-${index + 1} ${participant.ready ? "ready" : ""}`}
          style={{ "--agent-color": participant.appearance?.color ?? "#f6c453" } as CSSProperties}
        />
      ))}
    </div>
  );
}

function RoomRoster({ room }: { room: RoomRecord }) {
  const slots: Array<RoomParticipant | null> = [
    ...room.participants,
    ...Array.from({ length: Math.max(0, room.maxParticipants - room.participants.length) }, () => null)
  ].slice(0, room.maxParticipants);

  return (
    <div className="local-room-roster" aria-label="房间参与者">
      {slots.map((participant, index) =>
        participant ? (
          <ParticipantSlot key={participant.agentId} participant={participant} index={index} />
        ) : (
          <div key={`empty-${index}`} className="local-room-slot waiting">
            <span className="local-room-empty-slot">{index + 1}</span>
            <div>
              <strong>等待加入</strong>
              <small>分享邀请码进入</small>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function ParticipantSlot({
  participant,
  index
}: {
  participant: RoomParticipant;
  index: number;
}) {
  const skin = getAgentSkin(normalizeAgentSkinId(participant.appearance?.skinId, index));

  return (
    <div className={`local-room-slot ${participant.ready ? "ready" : ""}`}>
      <img src={skin.src} alt="" />
      <div>
        <strong>{participant.name}</strong>
        <small>{participant.ready ? "Ready" : "Not ready"}</small>
      </div>
    </div>
  );
}

function AgentIdentity({
  agent,
  bridgeStatus
}: {
  agent: LocalRoomAgent;
  bridgeStatus: LocalAgentControllerStatus | null;
}) {
  const skin = getAgentSkin(normalizeAgentSkinId(agent.appearance.skinId));
  const connected = Boolean(bridgeStatus?.connected);

  return (
    <div className="local-agent-identity">
      <span className={`local-bridge-pill ${connected ? "connected" : ""}`}>
        {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
        {connected ? "Agent bridge 在线" : "等待 Agent 连接"}
      </span>
      <img src={skin.src} alt="" />
      <div>
        <p className="eyebrow">My Agent</p>
        <h2>{agent.name}</h2>
        <small>{getSkinSignature(skin)}</small>
      </div>
    </div>
  );
}

async function resolveLocalRoom(apiKey: string): Promise<ResolvedLocalRoom> {
  if (apiKey === DEFAULT_LOCAL_PRODUCT_API_KEY && canUseLocalWebFallback()) {
    try {
      return await resolveLegacyLocalRoom();
    } catch {
      return resolveProductLocalRoom(apiKey);
    }
  }

  return resolveProductLocalRoom(apiKey);
}

async function resolveProductLocalRoom(apiKey: string): Promise<ResolvedLocalRoom> {
  const me = await productMe(apiKey);
  const profile = await productProfile(apiKey);
  const agent =
    profile.agent ??
    (await productUpsertProfileAgent(apiKey, {
      name: "Local Agent",
      strategyText: defaultLocalStrategy
    }));
  const rooms = await productRooms(apiKey);
  let room = chooseCurrentRoom(rooms, agent.id);

  if (!room) {
    room = await productCreateRoom(apiKey, { mapId: "royale" });
  }
  if (!room.participants.some((participant) => participant.agentId === agent.id)) {
    room = await productJoinRoom(apiKey, room.id, agent.id);
  }

  const participant = room.participants.find((candidate) => candidate.agentId === agent.id);
  if (roomCanBeEdited(room) && participant && !participant.ready) {
    room = await productSetRoomReady(apiKey, room.id, true, agent.id);
  }

  const bridgeStatus = await productLocalAgentStatus(apiKey, agent.id).catch(() => null);
  return { me, agent, room, bridgeStatus, authMode: "product-api" };
}

async function resolveLegacyLocalRoom(): Promise<ResolvedLocalRoom> {
  const agents = await localAgents();
  const agent =
    agents[0] ??
    (await localCreateAgent({
      name: "Local Agent",
      strategyText: defaultLocalStrategy
    }));
  const rooms = await localRooms();
  let room = chooseCurrentRoom(rooms, agent.id);

  if (!room) {
    room = await localCreateRoom({ hostAgentId: agent.id, mapId: "royale" });
  }
  if (!room.participants.some((participant) => participant.agentId === agent.id)) {
    room = await localJoinRoom(room.id, agent.id);
  }

  const participant = room.participants.find((candidate) => candidate.agentId === agent.id);
  if (roomCanBeEdited(room) && participant && !participant.ready) {
    room = await localSetRoomReady(room.id, agent.id, true);
  }

  const bridgeStatus = await localAgentStatus(agent.id).catch(() => null);
  return { me: null, agent, room, bridgeStatus, authMode: "local-web" };
}

function chooseCurrentRoom(rooms: RoomRecord[], agentId: string): RoomRecord | undefined {
  const activeRooms = rooms.filter((room) => ["draft", "ready", "running"].includes(room.status));
  return (
    activeRooms.find((room) => room.participants.some((participant) => participant.agentId === agentId)) ??
    activeRooms.find(
      (room) => room.status !== "running" && room.participants.length < room.maxParticipants
    )
  );
}

function canUseLocalWebFallback(): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function roomCanBeEdited(room: RoomRecord): boolean {
  return room.status === "draft" || room.status === "ready";
}

function roomStatusLabel(status: RoomRecord["status"]): string {
  switch (status) {
    case "draft":
      return "等待中";
    case "ready":
      return "可开局";
    case "running":
      return "对战中";
    case "finished":
      return "已结束";
    case "cancelled":
      return "已取消";
  }
}

function formatClock(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function maskKey(apiKey: string): string {
  if (apiKey === DEFAULT_LOCAL_PRODUCT_API_KEY) {
    return "local-dev-default";
  }
  return apiKey.length > 10 ? `...${apiKey.slice(-6)}` : "已保存 key";
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return `${error.message} (${error.status})`;
  }
  return error instanceof Error ? error.message : "Unknown error";
}
