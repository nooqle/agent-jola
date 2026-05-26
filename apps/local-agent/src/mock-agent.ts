import { getStrategyPromptTemplate } from "@agent-poppy/strategy";
import {
  maxPollsFromEnv,
  openAIWaitResponse,
  pollIntervalFromEnv,
  runProviderLoop
} from "./client.js";

const defaultTemplate = getStrategyPromptTemplate("survivor");

await runProviderLoop({
  provider: "openai-responses",
  model: "mock-local-agent",
  label: "mock-local-agent",
  defaultAgentName: "Local Mock Agent",
  defaultStrategy: defaultTemplate?.prompt ?? "优先生存，保留逃生路线；安全时再靠近对手放泡。",
  maxPolls: maxPollsFromEnv(),
  pollIntervalMs: pollIntervalFromEnv(),
  decide: async () =>
    openAIWaitResponse("Mock client keeps the Agent safe while testing the API loop.")
});
