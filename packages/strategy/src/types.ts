export type StrategyTone = "balanced" | "aggressive" | "defensive" | "collector" | "breaker";
export type AgentAccessory = "none" | "cap" | "visor" | "scarf" | "crown" | "antenna";

export interface AgentAppearance {
  color: string;
  accessory: AgentAccessory;
  skinId: string;
}

export interface StrategyTactics {
  dangerLookaheadTicks: number;
  ownBlastLookaheadTicks: number;
  escapeMarginTicks: number;
  attackEnemyEscapeLimit: number;
  pressureBombing: number;
  conserveQuickFuse: boolean;
  singleActiveBubble: boolean;
  minUpgradesBeforeChase: number;
}

export interface AgentStrategy {
  id: string;
  name: string;
  tone: StrategyTone;
  aggression: number;
  safety: number;
  itemBias: number;
  wallBias: number;
  riskTolerance: number;
  tactics: StrategyTactics;
  notes: string[];
}

export interface AgentStrategyVersion {
  id: string;
  agentId: string;
  version: number;
  sourceText: string;
  strategy: AgentStrategy;
  createdAt: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  appearance: AgentAppearance;
  createdAt: string;
  currentStrategyVersionId?: string;
}

export interface StrategyParseResult {
  sourceText: string;
  strategy: AgentStrategy;
  matchedKeywords: string[];
}
