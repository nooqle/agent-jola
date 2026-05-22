import { z } from "zod";
import type {
  AgentStrategy,
  AgentStrategyVersion,
  StrategyParseResult,
  StrategyTactics,
  StrategyTone,
} from "./types.js";

const TacticsSchema = z.object({
  dangerLookaheadTicks: z.number().int().min(6).max(30),
  ownBlastLookaheadTicks: z.number().int().min(10).max(40),
  escapeMarginTicks: z.number().int().min(2).max(12),
  attackEnemyEscapeLimit: z.number().int().min(0).max(4),
  pressureBombing: z.number().min(0).max(1),
  conserveQuickFuse: z.boolean(),
  singleActiveBubble: z.boolean(),
  minUpgradesBeforeChase: z.number().int().min(0).max(4),
});

const StrategySchema = z.object({
  id: z.string(),
  name: z.string(),
  tone: z.enum(["balanced", "aggressive", "defensive", "collector", "breaker"]),
  aggression: z.number().min(0).max(1),
  safety: z.number().min(0).max(1),
  itemBias: z.number().min(0).max(1),
  wallBias: z.number().min(0).max(1),
  riskTolerance: z.number().min(0).max(1),
  tactics: TacticsSchema,
  notes: z.array(z.string()),
});

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function includesAny(text: string, keywords: readonly string[]): string[] {
  return keywords.filter((keyword) => text.includes(keyword));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function firstNumber(text: string): number | undefined {
  const match = text.match(/\d+/);
  if (match?.[0]) {
    return Number(match[0]);
  }
  if (text.includes("一")) return 1;
  if (text.includes("两") || text.includes("二")) return 2;
  if (text.includes("三")) return 3;
  if (text.includes("四")) return 4;
  return undefined;
}

function defaultTactics(): StrategyTactics {
  return {
    dangerLookaheadTicks: 18,
    ownBlastLookaheadTicks: 30,
    escapeMarginTicks: 6,
    attackEnemyEscapeLimit: 2,
    pressureBombing: 0.45,
    conserveQuickFuse: true,
    singleActiveBubble: true,
    minUpgradesBeforeChase: 0,
  };
}

export function defaultStrategy(name = "Balanced Bomber"): AgentStrategy {
  return {
    id: "strategy-balanced",
    name,
    tone: "balanced",
    aggression: 0.45,
    safety: 0.65,
    itemBias: 0.5,
    wallBias: 0.55,
    riskTolerance: 0.35,
    tactics: defaultTactics(),
    notes: ["默认平衡策略：先确保逃生，再寻找破墙和进攻机会。"],
  };
}

export function parseNaturalLanguageStrategy(sourceText: string, base: AgentStrategy = defaultStrategy()): StrategyParseResult {
  const normalized = sourceText.trim().toLowerCase();
  const strategy: AgentStrategy = {
    ...base,
    id: `strategy-${slug(normalized || base.name) || "balanced"}`,
    name: normalized ? sourceText.trim().slice(0, 42) : base.name,
    tactics: {
      ...defaultTactics(),
      ...base.tactics,
    },
    notes: [],
  };
  const matchedKeywords: string[] = [];

  const aggressive = includesAny(normalized, [
    "激进",
    "攻击",
    "追杀",
    "追击",
    "压制",
    "攻击位",
    "覆盖",
    "同一行",
    "同一列",
    "kill",
    "attack",
    "hunt",
    "chase",
    "pressure",
    "aggressive",
  ]);
  const defensive = includesAny(normalized, [
    "保守",
    "逃生",
    "逃生路线",
    "安全",
    "生存",
    "撤离",
    "倒计时",
    "两步",
    "躲",
    "defensive",
    "safe",
    "survive",
    "escape",
    "retreat",
  ]);
  const collector = includesAny(normalized, [
    "道具",
    "升级",
    "吃",
    "资源",
    "护盾",
    "穿透",
    "急爆",
    "加速",
    "火力",
    "泡数",
    "item",
    "power",
    "upgrade",
    "collect",
    "shield",
    "pierce",
    "quick",
  ]);
  const breaker = includesAny(normalized, ["炸墙", "破墙", "开路", "清墙", "开局", "wall", "break", "clear", "opening"]);
  const risk = includesAny(normalized, ["冒险", "赌博", "强攻", "risk", "risky"]);
  const escapePolicy = includesAny(normalized, [
    "两步逃生",
    "2步逃生",
    "2 步逃生",
    "逃生路线",
    "撤离路线",
    "退路",
    "escape lane",
    "escape route",
  ]);
  const lineAttack = includesAny(normalized, ["同一行", "同一列", "覆盖线", "火力覆盖", "same row", "same column", "blast line"]);
  const trapPressure = includesAny(normalized, [
    "封路",
    "封锁",
    "卡位",
    "路口",
    "压缩逃生",
    "死路",
    "choke",
    "trap",
    "lock",
  ]);
  const quickFuseReserve = includesAny(normalized, ["保留急爆", "急爆留给攻击", "急爆突袭", "quick fuse attack"]);
  const quickFuseBreaker = includesAny(normalized, ["急爆开墙", "快速炸墙", "quick wall"]);
  const multiBubble = includesAny(normalized, ["连环泡", "连续放泡", "多泡", "连锁", "chain bomb", "multi bomb"]);
  const oneBubble = includesAny(normalized, ["只放一个泡", "单泡", "不连续放泡", "one bomb"]);
  const upgradeGate = includesAny(normalized, ["强化后", "升级后", "拿到两个", "两个以上", "至少2", "至少 2", "after collecting"]);

  matchedKeywords.push(
    ...aggressive,
    ...defensive,
    ...collector,
    ...breaker,
    ...risk,
    ...escapePolicy,
    ...lineAttack,
    ...trapPressure,
    ...quickFuseReserve,
    ...quickFuseBreaker,
    ...multiBubble,
    ...oneBubble,
    ...upgradeGate,
  );

  if (aggressive.length > 0) {
    strategy.aggression = clamp(strategy.aggression + 0.35);
    strategy.riskTolerance = clamp(strategy.riskTolerance + 0.2);
    strategy.safety = clamp(strategy.safety - 0.12);
    strategy.tone = "aggressive";
    strategy.notes.push("检测到攻击倾向：更愿意靠近对手并寻找安全放泡窗口。");
  }

  if (defensive.length > 0) {
    strategy.safety = clamp(strategy.safety + 0.3);
    strategy.riskTolerance = clamp(strategy.riskTolerance - 0.22);
    strategy.aggression = clamp(strategy.aggression - 0.12);
    strategy.tactics.dangerLookaheadTicks = clampInt(strategy.tactics.dangerLookaheadTicks + 4, 6, 30);
    strategy.tactics.attackEnemyEscapeLimit = clampInt(strategy.tactics.attackEnemyEscapeLimit - 1, 0, 4);
    strategy.tone = "defensive";
    strategy.notes.push("检测到安全/生存倾向：危险区域优先级高于追击和破墙。");
  }

  if (collector.length > 0) {
    strategy.itemBias = clamp(strategy.itemBias + 0.35);
    strategy.wallBias = clamp(strategy.wallBias + 0.08);
    strategy.tone = strategy.tone === "balanced" ? "collector" : strategy.tone;
    strategy.notes.push("检测到道具倾向：更重视拾取升级和长期能力。");
  }

  if (breaker.length > 0) {
    strategy.wallBias = clamp(strategy.wallBias + 0.35);
    strategy.tone = strategy.tone === "balanced" ? "breaker" : strategy.tone;
    strategy.notes.push("检测到破墙倾向：会主动寻找软墙相邻位置放泡。");
  }

  if (risk.length > 0) {
    strategy.riskTolerance = clamp(strategy.riskTolerance + 0.28);
    strategy.safety = clamp(strategy.safety - 0.1);
    strategy.tactics.escapeMarginTicks = clampInt(strategy.tactics.escapeMarginTicks - 2, 2, 12);
    strategy.tactics.attackEnemyEscapeLimit = clampInt(strategy.tactics.attackEnemyEscapeLimit + 1, 0, 4);
    strategy.notes.push("检测到冒险倾向：允许更接近爆炸窗口，但仍要求基本逃生路线。");
  }

  if (escapePolicy.length > 0) {
    strategy.safety = clamp(strategy.safety + 0.12);
    strategy.tactics.escapeMarginTicks = clampInt(strategy.tactics.escapeMarginTicks + 2, 2, 12);
    strategy.tactics.dangerLookaheadTicks = clampInt(strategy.tactics.dangerLookaheadTicks + 2, 6, 30);
    strategy.notes.push("检测到撤离约束：放泡前会保留更大的逃生余量。");
  }

  if (lineAttack.length > 0) {
    strategy.tactics.attackEnemyEscapeLimit = clampInt(strategy.tactics.attackEnemyEscapeLimit - 1, 0, 4);
    strategy.notes.push("检测到覆盖线攻击：只有对手退路受限时才提交攻击放泡。");
  }

  if (trapPressure.length > 0) {
    strategy.aggression = clamp(strategy.aggression + 0.16);
    strategy.tactics.pressureBombing = clamp(strategy.tactics.pressureBombing + 0.35);
    strategy.notes.push("检测到封锁/路口压制：会寻找能压缩对手逃生格的放泡点。");
  }

  if (quickFuseReserve.length > 0) {
    strategy.tactics.conserveQuickFuse = true;
    strategy.notes.push("检测到急爆保留：急爆泡优先用于攻击或封锁，不用于普通开墙。");
  }

  if (quickFuseBreaker.length > 0) {
    strategy.tactics.conserveQuickFuse = false;
    strategy.notes.push("检测到快速开墙：允许把急爆泡用于破墙节奏。");
  }

  if (multiBubble.length > 0) {
    strategy.tactics.singleActiveBubble = false;
    strategy.riskTolerance = clamp(strategy.riskTolerance + 0.12);
    strategy.notes.push("检测到连续放泡：允许在已有水泡未爆时继续寻找放泡机会。");
  }

  if (oneBubble.length > 0) {
    strategy.tactics.singleActiveBubble = true;
    strategy.notes.push("检测到单泡约束：会等自己的水泡结算后再放下一颗。");
  }

  if (upgradeGate.length > 0) {
    const gate = firstNumber(normalized) ?? 2;
    strategy.tactics.minUpgradesBeforeChase = clampInt(gate, 0, 4);
    strategy.itemBias = clamp(strategy.itemBias + 0.15);
    strategy.notes.push(`检测到发育门槛：至少拿到 ${strategy.tactics.minUpgradesBeforeChase} 个强化后再主动接战。`);
  }

  const countdownMatch = normalized.match(/(?:倒计时|danger|countdown)[^\d]*(\d+)\s*tick/);
  if (countdownMatch?.[1]) {
    strategy.tactics.dangerLookaheadTicks = clampInt(Number(countdownMatch[1]), 6, 30);
    strategy.notes.push(`检测到危险倒计时阈值：${strategy.tactics.dangerLookaheadTicks} tick 内优先撤离。`);
  }

  if (strategy.notes.length === 0) {
    strategy.notes.push("未检测到强偏好，使用平衡策略。");
  }

  return {
    sourceText,
    strategy: StrategySchema.parse(strategy),
    matchedKeywords,
  };
}

export function createStrategyVersion(
  agentId: string,
  sourceText: string,
  version: number,
  createdAt = new Date().toISOString(),
): AgentStrategyVersion {
  const parsed = parseNaturalLanguageStrategy(sourceText);
  return {
    id: `${agentId}-strategy-v${version}`,
    agentId,
    version,
    sourceText,
    strategy: parsed.strategy,
    createdAt,
  };
}

export function strategyTone(strategy: AgentStrategy): StrategyTone {
  return strategy.tone;
}
