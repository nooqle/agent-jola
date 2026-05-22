import { getStrategyPromptTemplate } from "@agent-bomber/strategy";
import {
  callOpenAIResponses,
  envValue,
  maxPollsFromEnv,
  pollIntervalFromEnv,
  runProviderLoop
} from "./client.js";

const defaultTemplate = getStrategyPromptTemplate("zoneHunter");

await runProviderLoop({
  provider: "openai-responses",
  model: envValue("OPENAI_MODEL", "gpt-4.1"),
  label: "openai-local-agent",
  defaultAgentName: "Local OpenAI Agent",
  defaultStrategy: defaultTemplate?.prompt ?? "优先生存，避免毒圈和爆炸；有退路时压迫最近对手。",
  maxPolls: maxPollsFromEnv(),
  pollIntervalMs: pollIntervalFromEnv(),
  decide: callOpenAIResponses
});
