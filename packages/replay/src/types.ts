import type { DecisionLogEntry, GameEvent, MatchRecord, MatchState, PlayerAppearance } from "@agent-poppy/core";
import type { AgentStrategyVersion } from "@agent-poppy/strategy";

export interface ReplayFrame {
  tick: number;
  state: MatchState;
  events: GameEvent[];
}

export interface ReplayFile {
  version: 1;
  matchId: string;
  seed: string;
  engineVersion: string;
  rulesVersion: string;
  agentProtocolVersion?: string;
  createdAt: string;
  participants: Array<{
    agentId: string;
    name: string;
    appearance?: PlayerAppearance;
    strategyVersionId?: string;
  }>;
  strategies: AgentStrategyVersion[];
  initialState: MatchState;
  frames: ReplayFrame[];
  decisions: DecisionLogEntry[];
  record?: MatchRecord;
}

export interface KeyEvent {
  tick: number;
  type: string;
  label: string;
  agentId?: string;
}
