export const STRATEGY_PROMPT_TEMPLATE_IDS = [
  "safeAttack",
  "farmControl",
  "survivor",
  "zoneHunter"
] as const;

export type StrategyPromptTemplateId = (typeof STRATEGY_PROMPT_TEMPLATE_IDS)[number];

export interface StrategyPromptTemplate {
  id: StrategyPromptTemplateId;
  tag: string;
  title: string;
  summary: string;
  prompt: string;
}

export const STRATEGY_PROMPT_TEMPLATES: Record<StrategyPromptTemplateId, StrategyPromptTemplate> = {
  safeAttack: {
    id: "safeAttack",
    tag: "均衡",
    title: "稳健进攻",
    summary: "先保命，再找覆盖线压制对手。",
    prompt: "稳健进攻：先保命和吃道具，毒圈收缩前进安全区，确认逃生路线后再用直线火力攻击。"
  },
  farmControl: {
    id: "farmControl",
    tag: "发育",
    title: "发育控图",
    summary: "开局破墙吃道具，能力成型后进攻。",
    prompt: "发育控图：开局炸墙吃护盾、火力和泡数，拿到两个强化后再靠近对手。"
  },
  survivor: {
    id: "survivor",
    tag: "保命",
    title: "保守生存",
    summary: "危险倒计时内提前撤离，少冒险。",
    prompt: "保守生存：毒圈收缩和危险倒计时内先撤离，只炸安全软墙，优先拿护盾和疾行。"
  },
  zoneHunter: {
    id: "zoneHunter",
    tag: "毒圈",
    title: "毒圈追猎",
    summary: "先进圈，再压缩最近对手逃生格。",
    prompt:
      "毒圈追猎：毒圈压力升高时优先移动到安全区内，等对手被圈边压缩后，用路口封锁和直线火力压制最近目标。"
  }
};

export const PROMPT_SNIPPET_IDS = ["escape", "lineAttack", "trap", "quickFuse", "upgrade"] as const;

export type PromptSnippetId = (typeof PROMPT_SNIPPET_IDS)[number];

export interface PromptSnippet {
  id: PromptSnippetId;
  label: string;
  text: string;
}

export const PROMPT_SNIPPETS: Record<PromptSnippetId, PromptSnippet> = {
  escape: {
    id: "escape",
    label: "撤离约束",
    text: "放泡前确认两步逃生路线；危险倒计时 12 tick 内优先撤离。"
  },
  lineAttack: {
    id: "lineAttack",
    label: "覆盖线攻击",
    text: "只有对手在同一行/同一列且处于火力范围内时才主动放泡攻击。"
  },
  trap: {
    id: "trap",
    label: "封锁压制",
    text: "优先封锁路口；只有对手逃生格少于 2 个时才主动压制。"
  },
  quickFuse: {
    id: "quickFuse",
    label: "急爆保留",
    text: "急爆泡保留给攻击或封锁，不用于普通破墙。"
  },
  upgrade: {
    id: "upgrade",
    label: "发育门槛",
    text: "至少拿到 2 个强化后再主动靠近对手。"
  }
};

export interface LocalAgentPromptOptions {
  agentName?: string;
  battlePlan: string;
  runtimeHint?: string;
  languageNote?: string;
}

export const DEFAULT_LOCAL_AGENT_RUNTIME_HINT =
  "你可以通过 Agent Jola 本地 SDK 或 /api/bridge 拉取观察、提交动作；如果只是在网站里配置，把下面“当前推荐战术”复制到作战准备即可。";

export const DEFAULT_LOCAL_AGENT_LANGUAGE_NOTE =
  "请保持输出简洁，优先返回可执行策略，不要解释无关背景。";

export function listStrategyPromptTemplates(): StrategyPromptTemplate[] {
  return STRATEGY_PROMPT_TEMPLATE_IDS.map((id) => STRATEGY_PROMPT_TEMPLATES[id]);
}

export function getStrategyPromptTemplate(id: string): StrategyPromptTemplate | undefined {
  return isStrategyPromptTemplateId(id) ? STRATEGY_PROMPT_TEMPLATES[id] : undefined;
}

export function isStrategyPromptTemplateId(id: string): id is StrategyPromptTemplateId {
  return STRATEGY_PROMPT_TEMPLATE_IDS.includes(id as StrategyPromptTemplateId);
}

export function appendPromptSnippet(current: string, snippet: string): string {
  const trimmed = current.trim();
  if (!trimmed) return snippet;
  if (trimmed.includes(snippet)) return trimmed;
  return `${trimmed}\n${snippet}`;
}

export function buildLocalAgentPrompt({
  agentName = "Local Agent",
  battlePlan,
  runtimeHint = DEFAULT_LOCAL_AGENT_RUNTIME_HINT,
  languageNote = DEFAULT_LOCAL_AGENT_LANGUAGE_NOTE
}: LocalAgentPromptOptions): string {
  return [
    `你是 Agent Jola 的本地对战 Agent：${agentName}。`,
    runtimeHint,
    "",
    "作战目标：在 4 人毒圈乱斗里成为最后存活者。",
    "你不能手动控制角色，只能把策略写成自然语言战术，交给本地运行时编译成行动参数。",
    "",
    "当前推荐战术：",
    battlePlan.trim(),
    "",
    "行动约束：",
    "1. 生存优先级高于追击；毒圈收缩、爆炸倒计时、无逃生路线时先撤离。",
    "2. 放泡前必须确认至少一条安全逃生路线。",
    "3. 只有对手在同一行/列、火力覆盖或逃生格很少时才主动放泡攻击。",
    "4. 开局优先炸安全软墙，拾取护盾、火力、泡数、穿透火和急爆泡。",
    "5. 进入安全区后再压制最近对手，避免在毒圈外恋战。",
    "",
    languageNote
  ].join("\n");
}

export function buildLocalAgentPromptFromTemplate(
  id: StrategyPromptTemplateId,
  options: Omit<LocalAgentPromptOptions, "battlePlan"> = {}
): string {
  return buildLocalAgentPrompt({
    ...options,
    battlePlan: STRATEGY_PROMPT_TEMPLATES[id].prompt
  });
}
