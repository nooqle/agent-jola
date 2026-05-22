import { getStrategyPromptTemplate } from "@agent-bomber/strategy";
import {
  callAnthropicMessages,
  envValue,
  maxPollsFromEnv,
  pollIntervalFromEnv,
  runProviderLoop
} from "./client.js";

const defaultTemplate = getStrategyPromptTemplate("safeAttack");

await runProviderLoop({
  provider: "anthropic-messages",
  model: envValue("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
  label: "anthropic-local-agent",
  defaultAgentName: "Local Claude Agent",
  defaultStrategy:
    defaultTemplate?.prompt ?? "优先生存，先判断毒圈和泡泡危险；安全窗口出现后攻击最近对手。",
  maxPolls: maxPollsFromEnv(),
  pollIntervalMs: pollIntervalFromEnv(),
  decide: callAnthropicMessages
});
