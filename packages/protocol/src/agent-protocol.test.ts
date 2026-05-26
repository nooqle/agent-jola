import { describe, expect, it } from "vitest";
import { applyTick, createInitialMatchState } from "@agent-poppy/core";
import {
  AGENT_ACTION_TOOL_NAME,
  AGENT_PROTOCOL_VERSION,
  createAgentObservation,
  createAnthropicMessagesAgentRequest,
  createOpenAIChatAgentRequest,
  createOpenAIResponsesAgentRequest,
  extractAnthropicMessagesAgentAction,
  extractOpenAIChatAgentAction,
  extractOpenAIResponsesAgentAction,
  validateAgentAction,
} from "./index.js";

function makeState() {
  return createInitialMatchState({
    matchId: "protocol-test",
    seed: "protocol-seed",
    mapId: "classic",
    agents: [
      { id: "agent-1", name: "Agent 1" },
      { id: "agent-2", name: "Agent 2" },
    ],
  });
}

describe("agent protocol", () => {
  it("creates a versioned observation with legal actions", () => {
    const state = makeState();
    const observation = createAgentObservation(state, "agent-1");

    expect(observation.protocolVersion).toBe(AGENT_PROTOCOL_VERSION);
    expect(observation.engineVersion).toBe(state.engineVersion);
    expect(observation.rulesVersion).toBe(state.rulesVersion);
    expect(observation.you.id).toBe("agent-1");
    expect(observation.legalActions).toContainEqual({ agentId: "agent-1", type: "wait" });
    expect(observation.legalActions).toContainEqual({ agentId: "agent-1", type: "place_bubble" });
  });

  it("falls back to wait for illegal or cross-agent actions", () => {
    const state = makeState();

    expect(validateAgentAction(state, "agent-1", { agentId: "agent-2", type: "place_bubble" })).toEqual({
      agentId: "agent-1",
      type: "wait",
    });
    expect(validateAgentAction(state, "agent-1", { agentId: "agent-1", type: "move", direction: "up" })).toEqual({
      agentId: "agent-1",
      type: "wait",
    });
    expect(validateAgentAction(state, "agent-1", { agentId: "agent-1", type: "place_bubble" })).toEqual({
      agentId: "agent-1",
      type: "place_bubble",
    });
    expect(validateAgentAction(state, "agent-1", "move right")).toEqual({
      agentId: "agent-1",
      type: "wait",
    });
  });

  it("does not advertise moves into occupied player cells", () => {
    const state = makeState();
    const blocker = state.players[1];
    if (!blocker) {
      throw new Error("missing blocker");
    }
    state.players[1] = { ...blocker, x: 2, y: 1 };

    const observation = createAgentObservation(state, "agent-1");

    expect(observation.legalActions).not.toContainEqual({ agentId: "agent-1", type: "move", direction: "right" });
    expect(validateAgentAction(state, "agent-1", { agentId: "agent-1", type: "move", direction: "right" })).toEqual({
      agentId: "agent-1",
      type: "wait",
    });
  });

  it("projects future bubble danger into the observation", () => {
    const state = applyTick(makeState(), [{ agentId: "agent-1", type: "place_bubble" }]).state;
    const observation = createAgentObservation(state, "agent-1");

    expect(observation.dangerCells.some((cell) => cell.source === "bubble" && cell.ownerId === "agent-1")).toBe(true);
    expect(Math.min(...observation.dangerCells.map((cell) => cell.earliestTick))).toBeGreaterThan(state.tick);
  });

  it("creates an OpenAI Chat tool-call payload and parses the tool call back to an action", () => {
    const observation = createAgentObservation(makeState(), "agent-1");
    const request = { type: "observe" as const, requestId: "request-openai-chat", observation, deadlineMs: 250 };
    const payload = createOpenAIChatAgentRequest(request, "gpt-test");

    expect(payload.model).toBe("gpt-test");
    expect(payload.tools[0]?.function.name).toBe(AGENT_ACTION_TOOL_NAME);
    expect(payload.tool_choice).toEqual({ type: "function", function: { name: AGENT_ACTION_TOOL_NAME } });
    expect(payload.parallel_tool_calls).toBe(false);
    expect(payload.messages[1]?.content).toContain("legalActions");

    const extracted = extractOpenAIChatAgentAction("agent-1", {
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: "function",
                function: {
                  name: AGENT_ACTION_TOOL_NAME,
                  arguments: JSON.stringify({ action: { type: "move", direction: "right" }, reason: "Move toward an open cell." }),
                },
              },
            ],
          },
        },
      ],
    });

    expect(extracted).toMatchObject({
      action: { agentId: "agent-1", type: "move", direction: "right" },
      reason: "Move toward an open cell.",
    });
  });

  it("creates an OpenAI Responses tool-call payload and parses the function call back to an action", () => {
    const observation = createAgentObservation(makeState(), "agent-1");
    const request = { type: "observe" as const, requestId: "request-openai-responses", observation, deadlineMs: 250 };
    const payload = createOpenAIResponsesAgentRequest(request, "gpt-responses-test");

    expect(payload.model).toBe("gpt-responses-test");
    expect(payload.tools[0]?.name).toBe(AGENT_ACTION_TOOL_NAME);
    expect(payload.tool_choice).toEqual({ type: "function", name: AGENT_ACTION_TOOL_NAME });
    expect(payload.parallel_tool_calls).toBe(false);
    expect(payload.input[1]?.content).toContain("legalActions");

    const extracted = extractOpenAIResponsesAgentAction("agent-1", {
      output: [
        {
          type: "function_call",
          name: AGENT_ACTION_TOOL_NAME,
          arguments: JSON.stringify({ action: { type: "place_bubble" }, reason: "Attack adjacent terrain while safe." }),
        },
      ],
    });

    expect(extracted).toMatchObject({
      action: { agentId: "agent-1", type: "place_bubble" },
      reason: "Attack adjacent terrain while safe.",
    });
  });

  it("creates an Anthropic Messages tool-use payload and parses the tool_use block back to an action", () => {
    const observation = createAgentObservation(makeState(), "agent-1");
    const request = { type: "observe" as const, requestId: "request-anthropic", observation, deadlineMs: 250 };
    const payload = createAnthropicMessagesAgentRequest(request, "claude-test");

    expect(payload.model).toBe("claude-test");
    expect(payload.tools[0]?.name).toBe(AGENT_ACTION_TOOL_NAME);
    expect(payload.tools[0]?.input_schema).toMatchObject({ type: "object" });
    expect(payload.tool_choice).toEqual({ type: "tool", name: AGENT_ACTION_TOOL_NAME });
    expect(payload.messages[0]?.content[0]?.text).toContain("legalActions");

    const extracted = extractAnthropicMessagesAgentAction("agent-1", {
      content: [
        { type: "text", text: "I will wait safely." },
        {
          type: "tool_use",
          name: AGENT_ACTION_TOOL_NAME,
          input: { action: { type: "wait" }, reason: "No safe attack window yet." },
        },
      ],
    });

    expect(extracted).toMatchObject({
      action: { agentId: "agent-1", type: "wait" },
      reason: "No safe attack window yet.",
    });
  });
});
