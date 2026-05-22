import { describe, expect, it } from "vitest";
import { parseNaturalLanguageStrategy } from "../parser.js";
import {
  appendPromptSnippet,
  buildLocalAgentPromptFromTemplate,
  getStrategyPromptTemplate,
  listStrategyPromptTemplates
} from "../prompt-templates.js";

describe("strategy parser", () => {
  it("parses aggressive Chinese strategy text", () => {
    const result = parseNaturalLanguageStrategy("激进追杀，能压制就强攻，但先确认逃生路线");
    expect(result.strategy.aggression).toBeGreaterThan(0.6);
    expect(result.strategy.safety).toBeGreaterThan(0.4);
    expect(result.matchedKeywords).toContain("激进");
  });

  it("parses collector and wall breaker hints", () => {
    const result = parseNaturalLanguageStrategy("优先炸墙吃道具升级，别太冒险");
    expect(result.strategy.itemBias).toBeGreaterThan(0.7);
    expect(result.strategy.wallBias).toBeGreaterThan(0.7);
  });

  it("compiles action capability prompts into tactics", () => {
    const result = parseNaturalLanguageStrategy(
      "先确认两步逃生路线；只在同一行同一列覆盖线攻击；封锁路口压缩逃生；保留急爆给攻击；至少吃到 2 个强化后再主动靠近对手。"
    );
    expect(result.strategy.tactics.escapeMarginTicks).toBeGreaterThan(6);
    expect(result.strategy.tactics.attackEnemyEscapeLimit).toBeLessThan(2);
    expect(result.strategy.tactics.pressureBombing).toBeGreaterThan(0.7);
    expect(result.strategy.tactics.conserveQuickFuse).toBe(true);
    expect(result.strategy.tactics.minUpgradesBeforeChase).toBe(2);
  });

  it("exposes prompt templates for web and local agent clients", () => {
    const templates = listStrategyPromptTemplates();
    expect(templates.map((template) => template.id)).toEqual([
      "safeAttack",
      "farmControl",
      "survivor",
      "zoneHunter"
    ]);
    expect(getStrategyPromptTemplate("zoneHunter")?.prompt).toContain("毒圈追猎");

    const prompt = buildLocalAgentPromptFromTemplate("safeAttack", { agentName: "Ember" });
    expect(prompt).toContain("Ember");
    expect(prompt).toContain("行动约束");
  });

  it("appends snippets without duplicate prompt lines", () => {
    const first = appendPromptSnippet("先保命", "放泡前确认两步逃生路线。");
    expect(first).toContain("先保命\n放泡前确认两步逃生路线。");
    expect(appendPromptSnippet(first, "放泡前确认两步逃生路线。")).toBe(first);
  });
});
