import { ENGINE_VERSION, RULES_VERSION, type DecisionLogEntry, type GameEvent, type MatchRecord, type MatchState } from "@agent-poppy/core";
import type { AgentStrategyVersion } from "@agent-poppy/strategy";
import type { KeyEvent, ReplayFile, ReplayFrame } from "./types.js";

export interface ReplayRecorderOptions {
  matchId: string;
  seed: string;
  participants: ReplayFile["participants"];
  strategies: AgentStrategyVersion[];
  initialState: MatchState;
  agentProtocolVersion?: string;
  createdAt?: string;
}

export class ReplayRecorder {
  private readonly replay: ReplayFile;

  constructor(options: ReplayRecorderOptions) {
    this.replay = {
      version: 1,
      matchId: options.matchId,
      seed: options.seed,
      engineVersion: options.initialState.engineVersion ?? ENGINE_VERSION,
      rulesVersion: options.initialState.rulesVersion ?? RULES_VERSION,
      createdAt: options.createdAt ?? new Date().toISOString(),
      participants: options.participants,
      strategies: options.strategies,
      initialState: options.initialState,
      frames: [],
      decisions: [],
    };
    if (options.agentProtocolVersion) {
      this.replay.agentProtocolVersion = options.agentProtocolVersion;
    }
  }

  appendFrame(tick: number, state: MatchState, events: GameEvent[]): ReplayFrame {
    const frame = { tick, state, events };
    this.replay.frames.push(frame);
    return frame;
  }

  appendDecision(decision: DecisionLogEntry): DecisionLogEntry {
    this.replay.decisions.push(decision);
    return decision;
  }

  finish(record: MatchRecord): ReplayFile {
    this.replay.record = record;
    return this.snapshot();
  }

  snapshot(): ReplayFile {
    return JSON.parse(JSON.stringify(this.replay)) as ReplayFile;
  }
}

export function extractKeyEvents(replay: ReplayFile): KeyEvent[] {
  const keyEvents: KeyEvent[] = [];
  for (const frame of replay.frames) {
    for (const event of frame.events) {
      if (event.type === "bubble_placed") {
        keyEvents.push({
          tick: event.tick,
          type: event.type,
          label: `${event.bubble.ownerId} 放置水泡`,
          agentId: event.bubble.ownerId,
        });
      } else if (event.type === "bubble_exploded") {
        keyEvents.push({
          tick: event.tick,
          type: event.type,
          label: `${event.ownerId} 的水泡爆炸，影响 ${event.cells.length} 格`,
          agentId: event.ownerId,
        });
      } else if (event.type === "eliminated") {
        keyEvents.push({
          tick: event.tick,
          type: event.type,
          label: `${event.agentId} 被淘汰`,
          agentId: event.agentId,
        });
      } else if (event.type === "item_collected") {
        keyEvents.push({
          tick: event.tick,
          type: event.type,
          label: `${event.agentId} 拾取 ${event.item.type}`,
          agentId: event.agentId,
        });
      } else if (event.type === "shield_absorbed") {
        keyEvents.push({
          tick: event.tick,
          type: event.type,
          label: `${event.agentId} 护盾抵消爆炸`,
          agentId: event.agentId,
        });
      } else if (event.type === "finished") {
        const keyEvent: KeyEvent = {
          tick: event.tick,
          type: event.type,
          label: event.winnerAgentId ? `${event.winnerAgentId} 获胜` : "对局平局",
        };
        if (event.winnerAgentId) {
          keyEvent.agentId = event.winnerAgentId;
        }
        keyEvents.push(keyEvent);
      }
    }
  }
  return keyEvents;
}

export function compactReplayFrames(frames: readonly ReplayFrame[], every = 1): ReplayFrame[] {
  return frames.filter((frame, index) => index % every === 0 || frame.events.some((event) => event.type !== "tick"));
}
