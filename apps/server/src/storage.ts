import { mkdir } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { customAlphabet, nanoid } from "nanoid";
import { ENGINE_VERSION, RULES_VERSION, normalizeMapPresetId, type MatchRecord } from "@agent-bomber/core";
import {
  AGENT_PROTOCOL_VERSION,
  type AgentDetail,
  type LeaderboardEntry,
  type PortalAuthProvider,
  type PortalProfile,
  type PortalUser,
  type ProductApiKeyRecord,
  type ProductApiKeyStatus,
  type ProductApiQuotaKey,
  type RoomParticipant,
  type RoomRecord,
  type RoomStatus,
} from "@agent-bomber/protocol";
import {
  createStrategyVersion,
  type AgentAccessory,
  type AgentAppearance,
  type AgentProfile,
  type AgentStrategyVersion,
} from "@agent-bomber/strategy";
import { HttpError } from "./errors.js";

interface AgentRow {
  id: string;
  name: string;
  appearance_color: string;
  appearance_accessory: AgentAccessory;
  appearance_skin_id: string | null;
  created_at: string;
  current_strategy_version_id: string | null;
}

interface StrategyVersionRow {
  id: string;
  agent_id: string;
  version: number;
  source_text: string;
  strategy_json: string;
  created_at: string;
}

interface MatchRow {
  id: string;
  seed: string;
  engine_version: string | null;
  rules_version: string | null;
  agent_protocol_version: string | null;
  map_id: string | null;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ticks: number;
  winner_agent_id: string | null;
  finish_reason: string | null;
  participants_json: string;
}

interface RoomRow {
  id: string;
  invite_code: string | null;
  mode: string;
  status: string;
  map_id: string;
  created_at: string;
  updated_at: string;
  max_participants: number;
  host_agent_id: string | null;
  match_id: string | null;
  participants_json: string;
}

interface ProductApiKeyRow {
  id: string;
  user_id: string;
  handle: string;
  scopes_json: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

interface ProductApiQuotaUsageRow {
  used: number;
}

interface PortalUserRow {
  id: string;
  provider: string;
  provider_subject: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

interface PortalProfileRow {
  user_id: string;
  agent_name: string;
  appearance_color: string;
  appearance_accessory: AgentAccessory;
  appearance_skin_id: string | null;
  strategy_text: string;
  updated_at: string;
}

interface PortalOAuthStateRow {
  state_hash: string;
  return_to: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

const createInviteCodeSuffix = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

export class Storage {
  readonly dataDir: string;
  readonly replayDir: string;
  readonly decisionDir: string;
  private readonly db: DatabaseSync;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.replayDir = join(dataDir, "replays");
    this.decisionDir = join(dataDir, "decisions");
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, "agent-bomber.sqlite"));
  }

  async init(): Promise<void> {
    await mkdir(this.replayDir, { recursive: true });
    await mkdir(this.decisionDir, { recursive: true });
    this.db.exec(`
      create table if not exists agents (
        id text primary key,
        name text not null,
        appearance_color text not null default '#f97316',
        appearance_accessory text not null default 'none',
        appearance_skin_id text,
        created_at text not null,
        current_strategy_version_id text
      );

      create table if not exists strategy_versions (
        id text primary key,
        agent_id text not null references agents(id),
        version integer not null,
        source_text text not null,
        strategy_json text not null,
        created_at text not null
      );

      create table if not exists matches (
        id text primary key,
        seed text not null,
        engine_version text not null default '${ENGINE_VERSION}',
        rules_version text not null default '${RULES_VERSION}',
        agent_protocol_version text not null default '${AGENT_PROTOCOL_VERSION}',
        map_id text not null default 'classic',
        status text not null,
        created_at text not null,
        started_at text,
        finished_at text,
        duration_ticks integer not null,
        winner_agent_id text,
        finish_reason text,
        participants_json text not null
      );

      create table if not exists rooms (
        id text primary key,
        invite_code text,
        mode text not null,
        status text not null,
        map_id text not null default 'royale',
        created_at text not null,
        updated_at text not null,
        max_participants integer not null default 4,
        host_agent_id text,
        match_id text,
        participants_json text not null
      );

      create table if not exists product_api_keys (
        id text primary key,
        user_id text not null,
        handle text not null,
        scopes_json text not null,
        created_at text not null,
        expires_at text,
        revoked_at text,
        last_used_at text
      );

      create table if not exists product_api_quota_usage (
        user_id text not null,
        quota_key text not null,
        used integer not null,
        updated_at text not null,
        primary key (user_id, quota_key)
      );

      create table if not exists portal_users (
        id text primary key,
        provider text not null,
        provider_subject text not null,
        email text not null,
        display_name text not null,
        avatar_url text,
        created_at text not null,
        updated_at text not null,
        unique(provider, provider_subject)
      );

      create table if not exists portal_sessions (
        token_hash text primary key,
        user_id text not null references portal_users(id),
        created_at text not null,
        expires_at text not null,
        revoked_at text
      );

      create table if not exists portal_oauth_states (
        state_hash text primary key,
        return_to text,
        created_at text not null,
        expires_at text not null,
        used_at text
      );

      create table if not exists portal_profiles (
        user_id text primary key references portal_users(id),
        agent_name text not null,
        appearance_color text not null,
        appearance_accessory text not null,
        appearance_skin_id text not null,
        strategy_text text not null,
        updated_at text not null
      );
    `);
    this.ensureAgentAppearanceColumns();
    this.ensureMatchMapColumn();
    this.ensureMatchMetadataColumns();
    this.ensureRoomInviteCodeColumn();
  }

  close(): void {
    this.db.close();
  }

  listAgents(): AgentProfile[] {
    const rows = this.db
      .prepare(
        "select id, name, appearance_color, appearance_accessory, appearance_skin_id, created_at, current_strategy_version_id from agents order by created_at asc",
      )
      .all() as unknown as AgentRow[];
    return rows.map(agentFromRow);
  }

  getAgent(agentId: string): AgentProfile {
    const row = this.db
      .prepare(
        "select id, name, appearance_color, appearance_accessory, appearance_skin_id, created_at, current_strategy_version_id from agents where id = ?",
      )
      .get(agentId) as AgentRow | undefined;
    if (!row) {
      throw new HttpError(404, `Agent not found: ${agentId}`, "AGENT_NOT_FOUND");
    }
    return agentFromRow(row);
  }

  getAgentDetail(agentId: string): AgentDetail {
    const agent = this.getAgent(agentId);
    const strategyVersions = this.listStrategyVersions(agentId);
    const detail: AgentDetail = {
      ...agent,
      strategyVersions,
    };
    const currentStrategyVersion = strategyVersions.find((version) => version.id === agent.currentStrategyVersionId);
    if (currentStrategyVersion) {
      detail.currentStrategyVersion = currentStrategyVersion;
    }
    return detail;
  }

  createAgent(name: string, strategyText?: string, appearance?: Partial<AgentAppearance>): AgentDetail {
    const now = new Date().toISOString();
    const id = `agent_${nanoid(8)}`;
    const normalizedAppearance = normalizeAppearance(appearance, this.listAgents().length);
    this.db
      .prepare(
        `insert into agents (id, name, appearance_color, appearance_accessory, appearance_skin_id, created_at, current_strategy_version_id)
         values (?, ?, ?, ?, ?, ?, null)`,
      )
      .run(
        id,
        cleanName(name) || `Agent ${this.listAgents().length + 1}`,
        normalizedAppearance.color,
        normalizedAppearance.accessory,
        normalizedAppearance.skinId,
        now,
      );
    this.createStrategyVersion(id, strategyText || "平衡策略：先确保逃生，再炸墙吃道具。");
    return this.getAgentDetail(id);
  }

  updateAgent(
    agentId: string,
    updates: { name?: string; appearance?: Partial<AgentAppearance> },
  ): AgentProfile {
    const current = this.getAgent(agentId);
    const nextName = updates.name === undefined ? current.name : cleanName(updates.name) || current.name;
    const nextAppearance = normalizeAppearance(updates.appearance, 0, current.appearance);
    this.db
      .prepare("update agents set name = ?, appearance_color = ?, appearance_accessory = ?, appearance_skin_id = ? where id = ?")
      .run(nextName, nextAppearance.color, nextAppearance.accessory, nextAppearance.skinId, agentId);
    return this.getAgent(agentId);
  }

  listStrategyVersions(agentId: string): AgentStrategyVersion[] {
    this.getAgent(agentId);
    const rows = this.db
      .prepare("select * from strategy_versions where agent_id = ? order by version desc")
      .all(agentId) as unknown as StrategyVersionRow[];
    return rows.map(strategyVersionFromRow);
  }

  getStrategyVersion(versionId: string): AgentStrategyVersion {
    const row = this.db.prepare("select * from strategy_versions where id = ?").get(versionId) as
      | StrategyVersionRow
      | undefined;
    if (!row) {
      throw new HttpError(404, `Strategy version not found: ${versionId}`, "STRATEGY_NOT_FOUND");
    }
    return strategyVersionFromRow(row);
  }

  getActiveStrategyVersion(agentId: string): AgentStrategyVersion {
    const agent = this.getAgent(agentId);
    if (agent.currentStrategyVersionId) {
      return this.getStrategyVersion(agent.currentStrategyVersionId);
    }
    const [latest] = this.listStrategyVersions(agentId);
    if (latest) {
      return latest;
    }
    return this.createStrategyVersion(agentId, "平衡策略：先确保逃生，再炸墙吃道具。");
  }

  createStrategyVersion(agentId: string, sourceText: string): AgentStrategyVersion {
    const latest = this.listStrategyVersions(agentId)[0]?.version ?? 0;
    const generated = createStrategyVersion(agentId, sourceText, latest + 1);
    const id = `strategy_${nanoid(8)}`;
    const version: AgentStrategyVersion = {
      ...generated,
      id,
      strategy: {
        ...generated.strategy,
        id,
      },
    };
    this.db
      .prepare(
        `insert into strategy_versions (id, agent_id, version, source_text, strategy_json, created_at)
         values (?, ?, ?, ?, ?, ?)`,
      )
      .run(version.id, agentId, version.version, version.sourceText, JSON.stringify(version.strategy), version.createdAt);
    this.db.prepare("update agents set current_strategy_version_id = ? where id = ?").run(version.id, agentId);
    return version;
  }

  createMatchRecord(record: MatchRecord): MatchRecord {
    this.db
      .prepare(
        `insert into matches (
          id, seed, engine_version, rules_version, agent_protocol_version, map_id, status, created_at, started_at, finished_at, duration_ticks,
          winner_agent_id, finish_reason, participants_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.seed,
        record.engineVersion ?? ENGINE_VERSION,
        record.rulesVersion ?? RULES_VERSION,
        record.agentProtocolVersion ?? AGENT_PROTOCOL_VERSION,
        record.mapId,
        record.status,
        record.createdAt,
        record.startedAt ?? null,
        record.finishedAt ?? null,
        record.durationTicks,
        record.winnerAgentId ?? null,
        record.finishReason ?? null,
        JSON.stringify(record.participants),
      );
    return record;
  }

  updateMatchRecord(record: MatchRecord): MatchRecord {
    this.db
      .prepare(
        `update matches
         set engine_version = ?, rules_version = ?, agent_protocol_version = ?, map_id = ?, status = ?, started_at = ?,
             finished_at = ?, duration_ticks = ?, winner_agent_id = ?, finish_reason = ?, participants_json = ?
         where id = ?`,
      )
      .run(
        record.engineVersion ?? ENGINE_VERSION,
        record.rulesVersion ?? RULES_VERSION,
        record.agentProtocolVersion ?? AGENT_PROTOCOL_VERSION,
        record.mapId,
        record.status,
        record.startedAt ?? null,
        record.finishedAt ?? null,
        record.durationTicks,
        record.winnerAgentId ?? null,
        record.finishReason ?? null,
        JSON.stringify(record.participants),
        record.id,
      );
    return record;
  }

  listMatches(): MatchRecord[] {
    return (this.db.prepare("select * from matches order by created_at desc").all() as unknown as MatchRow[]).map(matchFromRow);
  }

  getMatch(matchId: string): MatchRecord {
    const row = this.db.prepare("select * from matches where id = ?").get(matchId) as MatchRow | undefined;
    if (!row) {
      throw new HttpError(404, `Match not found: ${matchId}`, "MATCH_NOT_FOUND");
    }
    return matchFromRow(row);
  }

  getReplayPath(matchId: string): string {
    return join(this.replayDir, `${matchId}.json`);
  }

  getDecisionPath(matchId: string): string {
    return join(this.decisionDir, `${matchId}.jsonl`);
  }

  getLeaderboard(): LeaderboardEntry[] {
    const agents = this.listAgents();
    const stats = new Map<string, LeaderboardEntry>();
    for (const agent of agents) {
      stats.set(agent.id, {
        agentId: agent.id,
        name: agent.name,
        matches: 0,
        wins: 0,
        winRate: 0,
        score: 0,
      });
    }

    for (const match of this.listMatches()) {
      if (match.status !== "finished") {
        continue;
      }
      for (const participant of match.participants) {
        const entry = stats.get(participant.agentId);
        if (!entry) {
          continue;
        }
        entry.matches += 1;
        entry.score += participant.score;
        if (match.winnerAgentId === participant.agentId) {
          entry.wins += 1;
        }
      }
    }

    return [...stats.values()]
      .map((entry) => ({
        ...entry,
        winRate: entry.matches > 0 ? Number((entry.wins / entry.matches).toFixed(3)) : 0,
      }))
      .sort((a, b) => b.wins - a.wins || b.score - a.score || a.name.localeCompare(b.name));
  }

  createProductApiKey(record: ProductApiKeyRecord): ProductApiKeyRecord {
    this.db
      .prepare(
        `insert into product_api_keys (
          id, user_id, handle, scopes_json, created_at, expires_at, revoked_at, last_used_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.userId,
        record.handle,
        JSON.stringify(record.scopes),
        record.createdAt,
        record.expiresAt ?? null,
        record.revokedAt ?? null,
        record.lastUsedAt ?? null,
      );
    return record;
  }

  listProductApiKeys(): ProductApiKeyRecord[] {
    const rows = this.db
      .prepare("select * from product_api_keys order by created_at desc")
      .all() as unknown as ProductApiKeyRow[];
    return rows.map(productApiKeyFromRow);
  }

  listProductApiKeysForUser(userId: string): ProductApiKeyRecord[] {
    const rows = this.db
      .prepare("select * from product_api_keys where user_id = ? order by created_at desc")
      .all(userId) as unknown as ProductApiKeyRow[];
    return rows.map(productApiKeyFromRow);
  }

  revokeProductApiKey(keyId: string): ProductApiKeyRecord {
    const current = this.getProductApiKey(keyId);
    if (current.revokedAt) {
      return current;
    }
    const revokedAt = new Date().toISOString();
    this.db
      .prepare("update product_api_keys set revoked_at = ? where id = ?")
      .run(revokedAt, keyId);
    return this.getProductApiKey(keyId);
  }

  revokeProductApiKeyForUser(userId: string, keyId: string): ProductApiKeyRecord {
    const current = this.getProductApiKey(keyId);
    if (current.userId !== userId) {
      throw new HttpError(404, `Product API key not found: ${keyId}`, "PRODUCT_API_KEY_NOT_FOUND");
    }
    return this.revokeProductApiKey(keyId);
  }

  getProductApiKeyStatus(keyId: string): ProductApiKeyStatus {
    const row = this.db
      .prepare("select expires_at, revoked_at from product_api_keys where id = ?")
      .get(keyId) as { expires_at: string | null; revoked_at: string | null } | undefined;
    if (!row) {
      return "missing";
    }
    if (row.revoked_at) {
      return "revoked";
    }
    if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
      return "expired";
    }
    return "active";
  }

  touchProductApiKey(keyId: string): void {
    this.db
      .prepare("update product_api_keys set last_used_at = ? where id = ? and revoked_at is null")
      .run(new Date().toISOString(), keyId);
  }

  getProductApiQuotaUsage(userId: string, key: ProductApiQuotaKey): number {
    const row = this.db
      .prepare("select used from product_api_quota_usage where user_id = ? and quota_key = ?")
      .get(userId, key) as ProductApiQuotaUsageRow | undefined;
    return row?.used ?? 0;
  }

  consumeProductApiQuota(userId: string, key: ProductApiQuotaKey, limit: number | null): void {
    if (limit === null) {
      return;
    }
    const used = this.getProductApiQuotaUsage(userId, key);
    if (used >= limit) {
      throw new HttpError(
        429,
        `Agent Jola quota exceeded: ${key}`,
        "PRODUCT_API_QUOTA_EXCEEDED",
      );
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `insert into product_api_quota_usage (user_id, quota_key, used, updated_at)
         values (?, ?, 1, ?)
         on conflict(user_id, quota_key)
         do update set used = used + 1, updated_at = excluded.updated_at`,
      )
      .run(userId, key, now);
  }

  upsertPortalUser(input: {
    provider: PortalAuthProvider;
    providerSubject: string;
    email: string;
    displayName: string;
    avatarUrl?: string;
  }): PortalUser {
    const provider = normalizePortalProvider(input.provider);
    const providerSubject = input.providerSubject.trim().slice(0, 240);
    const email = input.email.trim().toLowerCase().slice(0, 320);
    const displayName = cleanName(input.displayName) || email.split("@")[0] || "Agent Jola User";
    const avatarUrl = input.avatarUrl?.trim().slice(0, 500) || null;
    const existing = this.db
      .prepare("select * from portal_users where provider = ? and provider_subject = ?")
      .get(provider, providerSubject) as PortalUserRow | undefined;
    const now = new Date().toISOString();
    if (existing) {
      this.db
        .prepare(
          `update portal_users
           set email = ?, display_name = ?, avatar_url = ?, updated_at = ?
           where id = ?`,
        )
        .run(email, displayName, avatarUrl, now, existing.id);
      return this.getPortalUser(existing.id);
    }

    const id = `user_${nanoid(10)}`;
    this.db
      .prepare(
        `insert into portal_users (
          id, provider, provider_subject, email, display_name, avatar_url, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, provider, providerSubject, email, displayName, avatarUrl, now, now);
    return this.getPortalUser(id);
  }

  getPortalUser(userId: string): PortalUser {
    const row = this.db
      .prepare("select * from portal_users where id = ?")
      .get(userId) as PortalUserRow | undefined;
    if (!row) {
      throw new HttpError(404, `Portal user not found: ${userId}`, "PORTAL_USER_NOT_FOUND");
    }
    return portalUserFromRow(row);
  }

  createPortalSession(userId: string, tokenHash: string, expiresAt: string): void {
    this.getPortalUser(userId);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `insert into portal_sessions (token_hash, user_id, created_at, expires_at, revoked_at)
         values (?, ?, ?, ?, null)`,
      )
      .run(tokenHash, userId, now, expiresAt);
  }

  revokePortalSession(tokenHash: string): void {
    this.db
      .prepare("update portal_sessions set revoked_at = ? where token_hash = ? and revoked_at is null")
      .run(new Date().toISOString(), tokenHash);
  }

  getPortalUserBySessionTokenHash(tokenHash: string): PortalUser | undefined {
    const row = this.db
      .prepare(
        `select u.*
         from portal_sessions s
         join portal_users u on u.id = s.user_id
         where s.token_hash = ?
           and s.revoked_at is null
           and s.expires_at > ?`,
      )
      .get(tokenHash, new Date().toISOString()) as PortalUserRow | undefined;
    return row ? portalUserFromRow(row) : undefined;
  }

  createPortalOAuthState(stateHash: string, expiresAt: string, returnTo?: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `insert into portal_oauth_states (state_hash, return_to, created_at, expires_at, used_at)
         values (?, ?, ?, ?, null)`,
      )
      .run(stateHash, normalizeReturnTo(returnTo), now, expiresAt);
  }

  consumePortalOAuthState(stateHash: string): { returnTo?: string } | undefined {
    const now = new Date().toISOString();
    const row = this.db
      .prepare("select * from portal_oauth_states where state_hash = ?")
      .get(stateHash) as PortalOAuthStateRow | undefined;
    if (!row || row.used_at || row.expires_at <= now) {
      return undefined;
    }
    this.db
      .prepare("update portal_oauth_states set used_at = ? where state_hash = ?")
      .run(now, stateHash);
    return row.return_to ? { returnTo: row.return_to } : {};
  }

  upsertPortalProfile(
    userId: string,
    input: {
      agentName: string;
      appearance?: Partial<AgentAppearance>;
      strategyText: string;
    },
  ): PortalProfile {
    this.getPortalUser(userId);
    const current = this.getPortalProfile(userId);
    const normalizedAppearance = normalizeAppearance(input.appearance, 0, current?.appearance);
    const agentName = cleanName(input.agentName) || "Agent Jola";
    const strategyText = input.strategyText.trim().slice(0, 2000);
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `insert into portal_profiles (
          user_id, agent_name, appearance_color, appearance_accessory, appearance_skin_id, strategy_text, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?)
        on conflict(user_id) do update set
          agent_name = excluded.agent_name,
          appearance_color = excluded.appearance_color,
          appearance_accessory = excluded.appearance_accessory,
          appearance_skin_id = excluded.appearance_skin_id,
          strategy_text = excluded.strategy_text,
          updated_at = excluded.updated_at`,
      )
      .run(
        userId,
        agentName,
        normalizedAppearance.color,
        normalizedAppearance.accessory,
        normalizedAppearance.skinId,
        strategyText || "毒圈生存：先进入安全区，保留逃生路线，再压制最近对手。",
        updatedAt,
      );
    return this.getPortalProfile(userId) as PortalProfile;
  }

  getPortalProfile(userId: string): PortalProfile | undefined {
    const row = this.db
      .prepare("select * from portal_profiles where user_id = ?")
      .get(userId) as PortalProfileRow | undefined;
    return row ? portalProfileFromRow(row) : undefined;
  }

  createRoom(hostAgentId?: string, mapId = "royale"): RoomRecord {
    const now = new Date().toISOString();
    const participants: RoomParticipant[] = [];
    if (hostAgentId) {
      participants.push(this.createRoomParticipant(hostAgentId, now));
    }
    const room: RoomRecord = {
      id: `room_${nanoid(10)}`,
      inviteCode: this.createUniqueRoomInviteCode(),
      mode: "royale-4",
      status: "draft",
      mapId: normalizeMapPresetId(mapId),
      createdAt: now,
      updatedAt: now,
      maxParticipants: 4,
      participants,
    };
    if (hostAgentId) {
      room.hostAgentId = hostAgentId;
    }
    return this.insertRoom(room);
  }

  listRooms(): RoomRecord[] {
    const rows = this.db.prepare("select * from rooms order by updated_at desc").all() as unknown as RoomRow[];
    return rows.map((row) => this.syncRoomWithMatch(roomFromRow(row)));
  }

  getRoom(roomId: string): RoomRecord {
    const row = this.db.prepare("select * from rooms where id = ?").get(roomId) as RoomRow | undefined;
    if (!row) {
      throw new HttpError(404, `Room not found: ${roomId}`, "ROOM_NOT_FOUND");
    }
    return this.syncRoomWithMatch(roomFromRow(row));
  }

  getRoomByInviteCode(inviteCode: string): RoomRecord {
    const normalized = normalizeRoomInviteCode(inviteCode);
    const row = this.db.prepare("select * from rooms where invite_code = ?").get(normalized) as RoomRow | undefined;
    if (!row) {
      throw new HttpError(404, `Room invite code not found: ${inviteCode}`, "ROOM_INVITE_CODE_NOT_FOUND");
    }
    return this.syncRoomWithMatch(roomFromRow(row));
  }

  joinRoom(roomId: string, agentId: string): RoomRecord {
    const room = this.requireEditableRoom(roomId);
    if (room.participants.some((participant) => participant.agentId === agentId)) {
      return room;
    }
    if (room.participants.length >= room.maxParticipants) {
      throw new HttpError(409, "Room is full.", "ROOM_FULL");
    }
    const now = new Date().toISOString();
    const next: RoomRecord = {
      ...room,
      status: "draft",
      updatedAt: now,
      participants: [...room.participants, this.createRoomParticipant(agentId, now)],
    };
    if (!next.hostAgentId) {
      next.hostAgentId = agentId;
    }
    return this.updateRoom(next);
  }

  joinRoomByInviteCode(inviteCode: string, agentId: string): RoomRecord {
    const room = this.getRoomByInviteCode(inviteCode);
    return this.joinRoom(room.id, agentId);
  }

  leaveRoom(roomId: string, agentId: string): RoomRecord {
    const room = this.requireEditableRoom(roomId);
    if (!room.participants.some((participant) => participant.agentId === agentId)) {
      return room;
    }
    const now = new Date().toISOString();
    const participants = room.participants.filter((participant) => participant.agentId !== agentId);
    const next: RoomRecord = {
      ...room,
      status: roomStatusForParticipants(participants),
      updatedAt: now,
      participants,
    };
    if (room.hostAgentId === agentId) {
      delete next.hostAgentId;
      const [nextHost] = participants;
      if (nextHost) {
        next.hostAgentId = nextHost.agentId;
      }
    }
    return this.updateRoom(next);
  }

  setRoomReady(roomId: string, agentId: string, ready: boolean): RoomRecord {
    const room = this.requireEditableRoom(roomId);
    if (!room.participants.some((participant) => participant.agentId === agentId)) {
      throw new HttpError(404, `Agent is not in room: ${agentId}`, "ROOM_PARTICIPANT_NOT_FOUND");
    }
    const participants = room.participants.map((participant) =>
      participant.agentId === agentId ? { ...participant, ready } : participant,
    );
    const next: RoomRecord = {
      ...room,
      status: roomStatusForParticipants(participants),
      updatedAt: new Date().toISOString(),
      participants,
    };
    return this.updateRoom(next);
  }

  cancelRoom(roomId: string): RoomRecord {
    const room = this.getRoom(roomId);
    if (room.status === "running") {
      throw new HttpError(409, "Running rooms cannot be cancelled.", "ROOM_ALREADY_RUNNING");
    }
    if (room.status === "finished") {
      return room;
    }
    const next: RoomRecord = {
      ...room,
      status: "cancelled",
      updatedAt: new Date().toISOString(),
    };
    return this.updateRoom(next);
  }

  markRoomRunning(roomId: string, matchId: string): RoomRecord {
    const room = this.getRoom(roomId);
    if (room.status !== "ready") {
      throw new HttpError(409, "Room is not ready to start.", "ROOM_NOT_READY");
    }
    const next: RoomRecord = {
      ...room,
      status: "running",
      updatedAt: new Date().toISOString(),
      matchId,
    };
    return this.updateRoom(next);
  }

  private insertRoom(room: RoomRecord): RoomRecord {
    this.db
      .prepare(
        `insert into rooms (
          id, invite_code, mode, status, map_id, created_at, updated_at,
          max_participants, host_agent_id, match_id, participants_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        room.id,
        room.inviteCode,
        room.mode,
        room.status,
        room.mapId,
        room.createdAt,
        room.updatedAt,
        room.maxParticipants,
        room.hostAgentId ?? null,
        room.matchId ?? null,
        JSON.stringify(room.participants),
      );
    return room;
  }

  private getProductApiKey(keyId: string): ProductApiKeyRecord {
    const row = this.db
      .prepare("select * from product_api_keys where id = ?")
      .get(keyId) as ProductApiKeyRow | undefined;
    if (!row) {
      throw new HttpError(404, `Product API key not found: ${keyId}`, "PRODUCT_API_KEY_NOT_FOUND");
    }
    return productApiKeyFromRow(row);
  }

  private updateRoom(room: RoomRecord): RoomRecord {
    this.db
      .prepare(
        `update rooms
         set invite_code = ?, mode = ?, status = ?, map_id = ?, updated_at = ?, max_participants = ?,
             host_agent_id = ?, match_id = ?, participants_json = ?
         where id = ?`,
      )
      .run(
        room.inviteCode,
        room.mode,
        room.status,
        room.mapId,
        room.updatedAt,
        room.maxParticipants,
        room.hostAgentId ?? null,
        room.matchId ?? null,
        JSON.stringify(room.participants),
        room.id,
      );
    return room;
  }

  private requireEditableRoom(roomId: string): RoomRecord {
    const room = this.getRoom(roomId);
    if (room.status === "running") {
      throw new HttpError(409, "Running rooms cannot be edited.", "ROOM_ALREADY_RUNNING");
    }
    if (room.status === "finished") {
      throw new HttpError(409, "Finished rooms cannot be edited.", "ROOM_ALREADY_FINISHED");
    }
    if (room.status === "cancelled") {
      throw new HttpError(409, "Cancelled rooms cannot be edited.", "ROOM_CANCELLED");
    }
    return room;
  }

  private createRoomParticipant(agentId: string, joinedAt: string): RoomParticipant {
    const agent = this.getAgent(agentId);
    const strategy = this.getActiveStrategyVersion(agentId);
    const participant: RoomParticipant = {
      agentId: agent.id,
      name: agent.name,
      appearance: agent.appearance,
      ready: false,
      joinedAt,
    };
    if (strategy.id) {
      participant.strategyVersionId = strategy.id;
    }
    return participant;
  }

  private syncRoomWithMatch(room: RoomRecord): RoomRecord {
    if (room.status !== "running" || !room.matchId) {
      return room;
    }
    const match = this.db.prepare("select status from matches where id = ?").get(room.matchId) as
      | { status: string }
      | undefined;
    if (match?.status !== "finished") {
      return room;
    }
    return this.updateRoom({
      ...room,
      status: "finished",
      updatedAt: new Date().toISOString(),
    });
  }

  private createUniqueRoomInviteCode(): string {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const inviteCode = `AP-${createInviteCodeSuffix()}`;
      const existing = this.db.prepare("select id from rooms where invite_code = ?").get(inviteCode);
      if (!existing) {
        return inviteCode;
      }
    }
    throw new HttpError(500, "Could not allocate a room invite code.", "ROOM_INVITE_CODE_EXHAUSTED");
  }

  private ensureAgentAppearanceColumns(): void {
    const rows = this.db.prepare("pragma table_info(agents)").all() as unknown as Array<{ name: string }>;
    const names = new Set(rows.map((row) => row.name));
    if (!names.has("appearance_color")) {
      this.db.exec("alter table agents add column appearance_color text not null default '#f97316'");
    }
    if (!names.has("appearance_accessory")) {
      this.db.exec("alter table agents add column appearance_accessory text not null default 'none'");
    }
    if (!names.has("appearance_skin_id")) {
      this.db.exec("alter table agents add column appearance_skin_id text");
    }
  }

  private ensureMatchMapColumn(): void {
    const rows = this.db.prepare("pragma table_info(matches)").all() as unknown as Array<{ name: string }>;
    const names = new Set(rows.map((row) => row.name));
    if (!names.has("map_id")) {
      this.db.exec("alter table matches add column map_id text not null default 'classic'");
    }
  }

  private ensureMatchMetadataColumns(): void {
    const rows = this.db.prepare("pragma table_info(matches)").all() as unknown as Array<{ name: string }>;
    const names = new Set(rows.map((row) => row.name));
    if (!names.has("engine_version")) {
      this.db.exec(`alter table matches add column engine_version text not null default '${ENGINE_VERSION}'`);
    }
    if (!names.has("rules_version")) {
      this.db.exec(`alter table matches add column rules_version text not null default '${RULES_VERSION}'`);
    }
    if (!names.has("agent_protocol_version")) {
      this.db.exec(
        `alter table matches add column agent_protocol_version text not null default '${AGENT_PROTOCOL_VERSION}'`,
      );
    }
  }

  private ensureRoomInviteCodeColumn(): void {
    const rows = this.db.prepare("pragma table_info(rooms)").all() as unknown as Array<{ name: string }>;
    const names = new Set(rows.map((row) => row.name));
    if (!names.has("invite_code")) {
      this.db.exec("alter table rooms add column invite_code text");
    }

    const missing = this.db
      .prepare("select id from rooms where invite_code is null or invite_code = ''")
      .all() as unknown as Array<{ id: string }>;
    const update = this.db.prepare("update rooms set invite_code = ? where id = ?");
    for (const row of missing) {
      update.run(this.createUniqueRoomInviteCode(), row.id);
    }
  }
}

function cleanName(name: string): string {
  return name.trim().slice(0, 80);
}

function agentFromRow(row: AgentRow): AgentProfile {
  const agent: AgentProfile = {
    id: row.id,
    name: row.name,
    appearance: {
      color: normalizeColor(row.appearance_color),
      accessory: normalizeAccessory(row.appearance_accessory),
      skinId: normalizeSkinId(row.appearance_skin_id ?? defaultSkinIdFromSeed(row.id)),
    },
    createdAt: row.created_at,
  };
  if (row.current_strategy_version_id) {
    agent.currentStrategyVersionId = row.current_strategy_version_id;
  }
  return agent;
}

function normalizeAppearance(
  appearance: Partial<AgentAppearance> | undefined,
  index: number,
  fallback?: AgentAppearance,
): AgentAppearance {
  return {
    color: normalizeColor(appearance?.color ?? fallback?.color ?? defaultColor(index)),
    accessory: normalizeAccessory(appearance?.accessory ?? fallback?.accessory ?? "none"),
    skinId: normalizeSkinId(appearance?.skinId ?? fallback?.skinId ?? defaultSkinId(index)),
  };
}

function normalizeColor(color: string): string {
  const trimmed = color.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : "#f97316";
}

function normalizeAccessory(accessory: string): AgentAccessory {
  const allowed = new Set<AgentAccessory>(["none", "cap", "visor", "scarf", "crown", "antenna"]);
  return allowed.has(accessory as AgentAccessory) ? (accessory as AgentAccessory) : "none";
}

function normalizeSkinId(skinId: string): string {
  return availableSkinIds.has(skinId) ? skinId : "chameleon-1";
}

function defaultColor(index: number): string {
  const palette = ["#f97316", "#84cc16", "#38bdf8", "#eab308", "#fb7185", "#a3e635", "#22c55e", "#facc15"];
  return palette[index % palette.length] ?? "#f97316";
}

function defaultSkinId(index: number): string {
  return availableSkinList[Math.abs(index) % availableSkinList.length] ?? "chameleon-1";
}

function defaultSkinIdFromSeed(seed: string): string {
  const index = [...seed].reduce((total, char) => total + char.charCodeAt(0), 0);
  return defaultSkinId(index);
}

const availableSkinList = [
  "chameleon-1",
  "chameleon-4",
  "chameleon-8",
  "chameleon-12",
  "chameleon-17",
  "chameleon-23",
  "chameleon-37",
  "chameleon-42",
  "chameleon-58",
  "chameleon-73",
  "chameleon-88",
  "chameleon-101",
  "chameleon-128",
  "chameleon-144",
  "chameleon-169",
  "chameleon-196",
  "chameleon-233",
  "chameleon-277",
  "chameleon-314",
  "chameleon-377",
  "chameleon-512",
  "chameleon-777",
  "chameleon-1024",
  "chameleon-1337",
];

const availableSkinIds = new Set(availableSkinList);

function strategyVersionFromRow(row: StrategyVersionRow): AgentStrategyVersion {
  return {
    id: row.id,
    agentId: row.agent_id,
    version: row.version,
    sourceText: row.source_text,
    strategy: JSON.parse(row.strategy_json) as AgentStrategyVersion["strategy"],
    createdAt: row.created_at,
  };
}

function matchFromRow(row: MatchRow): MatchRecord {
  const record: MatchRecord = {
    id: row.id,
    seed: row.seed,
    engineVersion: row.engine_version ?? ENGINE_VERSION,
    rulesVersion: row.rules_version ?? RULES_VERSION,
    agentProtocolVersion: row.agent_protocol_version ?? AGENT_PROTOCOL_VERSION,
    mapId: normalizeMapPresetId(row.map_id ?? undefined),
    status: row.status as MatchRecord["status"],
    createdAt: row.created_at,
    durationTicks: row.duration_ticks,
    participants: JSON.parse(row.participants_json) as MatchRecord["participants"],
  };
  if (row.started_at) {
    record.startedAt = row.started_at;
  }
  if (row.finished_at) {
    record.finishedAt = row.finished_at;
  }
  if (row.winner_agent_id) {
    record.winnerAgentId = row.winner_agent_id;
  }
  if (row.finish_reason) {
    record.finishReason = row.finish_reason as NonNullable<MatchRecord["finishReason"]>;
  }
  return record;
}

function roomFromRow(row: RoomRow): RoomRecord {
  const record: RoomRecord = {
    id: row.id,
    inviteCode: row.invite_code ?? "",
    mode: "royale-4",
    status: normalizeRoomStatus(row.status),
    mapId: normalizeMapPresetId(row.map_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    maxParticipants: 4,
    participants: JSON.parse(row.participants_json) as RoomParticipant[],
  };
  if (row.host_agent_id) {
    record.hostAgentId = row.host_agent_id;
  }
  if (row.match_id) {
    record.matchId = row.match_id;
  }
  return record;
}

function productApiKeyFromRow(row: ProductApiKeyRow): ProductApiKeyRecord {
  const record: ProductApiKeyRecord = {
    id: row.id,
    userId: row.user_id,
    handle: row.handle,
    scopes: JSON.parse(row.scopes_json) as ProductApiKeyRecord["scopes"],
    createdAt: row.created_at,
  };
  if (row.expires_at) {
    record.expiresAt = row.expires_at;
  }
  if (row.revoked_at) {
    record.revokedAt = row.revoked_at;
  }
  if (row.last_used_at) {
    record.lastUsedAt = row.last_used_at;
  }
  return record;
}

function portalUserFromRow(row: PortalUserRow): PortalUser {
  const user: PortalUser = {
    id: row.id,
    provider: normalizePortalProvider(row.provider),
    providerSubject: row.provider_subject,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.avatar_url) {
    user.avatarUrl = row.avatar_url;
  }
  return user;
}

function portalProfileFromRow(row: PortalProfileRow): PortalProfile {
  return {
    userId: row.user_id,
    agentName: row.agent_name,
    appearance: {
      color: normalizeColor(row.appearance_color),
      accessory: normalizeAccessory(row.appearance_accessory),
      skinId: normalizeSkinId(row.appearance_skin_id ?? defaultSkinIdFromSeed(row.user_id)),
    },
    strategyText: row.strategy_text,
    updatedAt: row.updated_at,
  };
}

function normalizePortalProvider(provider: string): PortalAuthProvider {
  return provider === "google" ? "google" : "dev";
}

function normalizeRoomStatus(status: string): RoomStatus {
  const allowed = new Set<RoomStatus>(["draft", "ready", "running", "finished", "cancelled"]);
  return allowed.has(status as RoomStatus) ? (status as RoomStatus) : "draft";
}

function roomStatusForParticipants(participants: RoomParticipant[]): RoomStatus {
  return participants.length === 4 && participants.every((participant) => participant.ready) ? "ready" : "draft";
}

function normalizeRoomInviteCode(inviteCode: string): string {
  const compact = inviteCode.trim().toUpperCase().replace(/[\s-]/g, "");
  if (/^AP[A-Z2-9]{6}$/.test(compact)) {
    return `${compact.slice(0, 2)}-${compact.slice(2)}`;
  }
  return inviteCode.trim().toUpperCase();
}

function normalizeReturnTo(returnTo: string | undefined): string | null {
  const trimmed = returnTo?.trim();
  if (!trimmed || trimmed.length > 240) {
    return null;
  }
  return trimmed.startsWith("/") && !trimmed.startsWith("//") ? trimmed : null;
}
