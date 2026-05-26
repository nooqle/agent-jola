import { nanoid } from "nanoid";
import { createPlannerContext, planAgentAction } from "@agent-poppy/agent";
import {
  ENGINE_VERSION,
  RULES_VERSION,
  applyTick,
  createInitialMatchState,
  normalizeMapPresetId,
  type DecisionLogEntry,
  type MapPresetId,
  type MatchRecord,
  type MatchState,
  type PlayerState,
} from "@agent-poppy/core";
import { ReplayRecorder, writeDecisionLogFile, writeReplayFile, type ReplayFile } from "@agent-poppy/replay";
import type { AgentProfile, AgentStrategyVersion } from "@agent-poppy/strategy";
import {
  AGENT_PROTOCOL_VERSION,
  createAgentObservation,
  validateAgentAction,
  type AgentActionRequest,
  type AgentActionResponse,
  type LocalAgentControllerStatus,
  type LocalAgentObserveResponse,
  type MatchWebSocketMessage,
  type SubmitLocalAgentActionRequest,
  type SubmitLocalAgentActionResponse,
} from "@agent-poppy/protocol";
import { Storage } from "./storage.js";
import { HttpError } from "./errors.js";

type ClientSocket = {
  send(data: string): void;
  close?(): void;
};

interface RuntimeParticipant {
  agent: AgentProfile;
  strategy: AgentStrategyVersion;
}

interface RunningMatch {
  record: MatchRecord;
  state: MatchState;
  strategies: Map<string, AgentStrategyVersion>;
  recorder: ReplayRecorder;
  decisions: DecisionLogEntry[];
  timer?: NodeJS.Timeout;
  clients: Set<ClientSocket>;
  finishing: boolean;
}

interface LocalAgentController {
  agentId: string;
  label?: string;
  latestRequest?: AgentActionRequest;
  submitted?: AgentActionResponse;
}

export class MatchRuntimeManager {
  private readonly running = new Map<string, RunningMatch>();
  private readonly localControllers = new Map<string, LocalAgentController>();

  constructor(
    private readonly storage: Storage,
    private readonly tickIntervalMs = 100,
  ) {}

  shutdown(): void {
    for (const runtime of this.running.values()) {
      if (runtime.timer) {
        clearInterval(runtime.timer);
      }
      for (const client of runtime.clients) {
        client.close?.();
      }
    }
    this.running.clear();
    this.localControllers.clear();
  }

  connectLocalAgent(agentId: string, label?: string): LocalAgentControllerStatus {
    this.storage.getAgent(agentId);
    const controller: LocalAgentController = { agentId };
    if (label?.trim()) {
      controller.label = label.trim().slice(0, 80);
    }
    this.localControllers.set(agentId, controller);
    this.publishLocalAgentRequest(agentId);
    return this.localAgentStatus(agentId);
  }

  disconnectLocalAgent(agentId: string): LocalAgentControllerStatus {
    this.storage.getAgent(agentId);
    this.localControllers.delete(agentId);
    return this.localAgentStatus(agentId);
  }

  localAgentStatus(agentId: string): LocalAgentControllerStatus {
    const controller = this.localControllers.get(agentId);
    const status: LocalAgentControllerStatus = {
      agentId,
      connected: Boolean(controller),
      fallback: "internal-planner",
    };
    if (controller?.label) {
      status.label = controller.label;
    }
    if (controller?.latestRequest) {
      status.activeMatchId = controller.latestRequest.observation.matchId;
      status.latestRequestId = controller.latestRequest.requestId;
      status.latestTick = controller.latestRequest.observation.tick;
    }
    if (controller?.submitted) {
      status.submittedRequestId = controller.submitted.requestId;
    }
    return status;
  }

  observeLocalAgent(agentId: string): LocalAgentObserveResponse {
    this.storage.getAgent(agentId);
    const controller = this.requireLocalController(agentId);
    this.publishLocalAgentRequest(agentId);
    const response: LocalAgentObserveResponse = {
      status: this.localAgentStatus(agentId),
    };
    if (controller.latestRequest) {
      response.request = controller.latestRequest;
    }
    return response;
  }

  submitLocalAgentAction(agentId: string, input: SubmitLocalAgentActionRequest): SubmitLocalAgentActionResponse {
    this.storage.getAgent(agentId);
    const controller = this.requireLocalController(agentId);
    const runtime = this.running.get(input.matchId);
    if (!runtime || runtime.state.status !== "running") {
      throw new HttpError(409, "No running match is waiting for this local Agent action.", "NO_ACTIVE_AGENT_REQUEST");
    }
    const latest = controller.latestRequest;
    if (!latest || latest.requestId !== input.requestId || latest.observation.tick !== input.tick) {
      throw new HttpError(409, "Local Agent action request is stale.", "STALE_AGENT_REQUEST");
    }
    const player = runtime.state.players.find((candidate) => candidate.id === agentId);
    if (!player?.alive || runtime.state.tick !== input.tick) {
      throw new HttpError(409, "Local Agent action no longer matches the current tick.", "STALE_AGENT_TICK");
    }
    const action = validateAgentAction(runtime.state, agentId, input.action);
    const response: AgentActionResponse = {
      protocolVersion: AGENT_PROTOCOL_VERSION,
      requestId: input.requestId,
      matchId: input.matchId,
      tick: input.tick,
      agentId,
      action,
    };
    if (input.reason) {
      response.reason = input.reason.slice(0, 240);
    }
    controller.submitted = response;
    return {
      accepted: true,
      status: this.localAgentStatus(agentId),
      action,
    };
  }

  createMatch(
    agentIds: string[],
    seed = `seed_${nanoid(8)}`,
    mapId: MapPresetId = "royale",
  ): MatchRecord {
    const uniqueAgentIds = [...new Set(agentIds)].slice(0, 4);
    if (uniqueAgentIds.length !== 4) {
      throw new HttpError(400, "Royale mode requires exactly 4 agents.", "MATCH_NEEDS_AGENTS");
    }

    const participants: RuntimeParticipant[] = uniqueAgentIds.map((agentId) => ({
      agent: this.storage.getAgent(agentId),
      strategy: this.storage.getActiveStrategyVersion(agentId),
    }));
    const matchId = `match_${nanoid(10)}`;
    const normalizedMapId = normalizeMapPresetId(mapId);
    const createdAt = new Date().toISOString();
    const state = createInitialMatchState({
      matchId,
      seed,
      mapId: normalizedMapId,
      agents: participants.map((participant) => ({
        id: participant.agent.id,
        name: participant.agent.name,
        appearance: participant.agent.appearance,
        strategyVersionId: participant.strategy.id,
      })),
    });

    const record: MatchRecord = {
      id: matchId,
      seed,
      engineVersion: ENGINE_VERSION,
      rulesVersion: RULES_VERSION,
      agentProtocolVersion: AGENT_PROTOCOL_VERSION,
      mapId: normalizedMapId,
      status: "running",
      createdAt,
      startedAt: createdAt,
      durationTicks: 0,
      participants: state.players.map((player) => participantFromPlayer(player, true)),
    };
    this.storage.createMatchRecord(record);

    const recorder = new ReplayRecorder({
      matchId,
      seed,
      initialState: state,
      participants: record.participants.map((participant) => {
        const replayParticipant: ReplayFile["participants"][number] = {
          agentId: participant.agentId,
          name: participant.name,
        };
        if (participant.appearance) {
          replayParticipant.appearance = participant.appearance;
        }
        if (participant.strategyVersionId) {
          replayParticipant.strategyVersionId = participant.strategyVersionId;
        }
        return replayParticipant;
      }),
      strategies: participants.map((participant) => participant.strategy),
      agentProtocolVersion: AGENT_PROTOCOL_VERSION,
      createdAt,
    });
    recorder.appendFrame(0, state, [{ type: "tick", tick: 0 }]);

    const runtime: RunningMatch = {
      record,
      state,
      strategies: new Map(participants.map((participant) => [participant.agent.id, participant.strategy])),
      recorder,
      decisions: [],
      clients: new Set(),
      finishing: false,
    };
    runtime.timer = setInterval(() => {
      void this.step(matchId);
    }, this.tickIntervalMs);
    this.running.set(matchId, runtime);
    this.publishLocalAgentRequests(runtime);
    return record;
  }

  getState(matchId: string): MatchState | undefined {
    return this.running.get(matchId)?.state;
  }

  subscribe(matchId: string, socket: ClientSocket): () => void {
    const runtime = this.running.get(matchId);
    if (!runtime) {
      const record = this.storage.getMatch(matchId);
      socket.send(JSON.stringify({ type: "finished", matchId, record } satisfies Partial<MatchWebSocketMessage>));
      return () => undefined;
    }
    runtime.clients.add(socket);
    socket.send(
      JSON.stringify({
        type: "snapshot",
        matchId,
        tick: runtime.state.tick,
        state: runtime.state,
        events: [],
      } satisfies MatchWebSocketMessage),
    );
    return () => {
      runtime.clients.delete(socket);
    };
  }

  private async step(matchId: string): Promise<void> {
    const runtime = this.running.get(matchId);
    if (!runtime || runtime.finishing || runtime.state.status !== "running") {
      return;
    }

    const plannerContext = createPlannerContext(runtime.state);
    const planned = runtime.state.players.filter((player) => player.alive).map((player) => {
      const local = this.consumeLocalAgentAction(runtime, player);
      if (local) {
        return local;
      }
      return planAgentAction(runtime.state, player, runtime.strategies.get(player.id)?.strategy, plannerContext);
    });
    for (const output of planned) {
      runtime.decisions.push(output.decision);
      runtime.recorder.appendDecision(output.decision);
      this.broadcast(runtime, {
        type: "decision",
        matchId,
        decision: output.decision,
      });
    }

    const result = applyTick(
      runtime.state,
      planned.map((output) => output.action),
    );
    runtime.state = result.state;
    runtime.recorder.appendFrame(runtime.state.tick, runtime.state, result.events);
    this.broadcast(runtime, {
      type: "snapshot",
      matchId,
      tick: runtime.state.tick,
      state: runtime.state,
      events: result.events,
    });

    if (runtime.state.status === "finished") {
      runtime.finishing = true;
      await this.finish(matchId, runtime);
    } else {
      this.publishLocalAgentRequests(runtime);
    }
  }

  private async finish(matchId: string, runtime: RunningMatch): Promise<void> {
    if (runtime.timer) {
      clearInterval(runtime.timer);
    }

    const finishedAt = new Date().toISOString();
    const record: MatchRecord = {
      ...runtime.record,
      status: "finished",
      engineVersion: runtime.state.engineVersion,
      rulesVersion: runtime.state.rulesVersion,
      agentProtocolVersion: AGENT_PROTOCOL_VERSION,
      finishedAt,
      durationTicks: runtime.state.tick,
      participants: runtime.state.players.map((player) => participantFromPlayer(player, player.alive)),
    };
    if (runtime.state.winnerAgentId) {
      record.winnerAgentId = runtime.state.winnerAgentId;
    } else {
      delete record.winnerAgentId;
    }
    if (runtime.state.finishReason) {
      record.finishReason = runtime.state.finishReason;
    }
    const replay: ReplayFile = runtime.recorder.finish(record);
    await writeReplayFile(this.storage.getReplayPath(matchId), replay);
    await writeDecisionLogFile(this.storage.getDecisionPath(matchId), runtime.decisions);
    this.storage.updateMatchRecord(record);
    this.broadcast(runtime, {
      type: "finished",
      matchId,
      record,
      replay,
    });
    for (const client of runtime.clients) {
      client.close?.();
    }
    this.clearLocalAgentRequests(runtime);
    this.running.delete(matchId);
  }

  private broadcast(runtime: RunningMatch, message: MatchWebSocketMessage): void {
    const payload = JSON.stringify(message);
    for (const client of runtime.clients) {
      try {
        client.send(payload);
      } catch {
        runtime.clients.delete(client);
      }
    }
  }

  private requireLocalController(agentId: string): LocalAgentController {
    const controller = this.localControllers.get(agentId);
    if (!controller) {
      throw new HttpError(404, `Local Agent is not connected: ${agentId}`, "LOCAL_AGENT_NOT_CONNECTED");
    }
    return controller;
  }

  private publishLocalAgentRequests(runtime: RunningMatch): void {
    for (const player of runtime.state.players) {
      if (!player.alive) {
        this.clearLocalAgentRequest(player.id, runtime.state.matchId);
        continue;
      }
      this.publishLocalAgentRequest(player.id, runtime);
    }
  }

  private publishLocalAgentRequest(agentId: string, runtime?: RunningMatch): void {
    const controller = this.localControllers.get(agentId);
    if (!controller) {
      return;
    }
    const activeRuntime = runtime ?? [...this.running.values()].find((candidate) =>
      candidate.state.players.some((player) => player.id === agentId && player.alive),
    );
    if (!activeRuntime || activeRuntime.state.status !== "running") {
      this.clearLocalAgentRequest(agentId, runtime?.state.matchId);
      return;
    }
    if (!activeRuntime.state.players.some((player) => player.id === agentId && player.alive)) {
      this.clearLocalAgentRequest(agentId, activeRuntime.state.matchId);
      return;
    }
    const requestId = localRequestId(activeRuntime.state.matchId, agentId, activeRuntime.state.tick);
    if (controller.latestRequest?.requestId === requestId) {
      return;
    }
    delete controller.submitted;
    controller.latestRequest = {
      type: "observe",
      requestId,
      observation: createAgentObservation(activeRuntime.state, agentId),
      deadlineMs: this.tickIntervalMs,
    };
  }

  private consumeLocalAgentAction(runtime: RunningMatch, player: PlayerState): ReturnType<typeof planAgentAction> | undefined {
    const controller = this.localControllers.get(player.id);
    if (!controller) {
      return undefined;
    }
    const requestId = localRequestId(runtime.state.matchId, player.id, runtime.state.tick);
    const submitted = controller.submitted;
    if (!submitted || submitted.requestId !== requestId || submitted.tick !== runtime.state.tick) {
      return undefined;
    }
    const action = validateAgentAction(runtime.state, player.id, submitted.action);
    delete controller.submitted;
    return {
      action,
      decision: {
        matchId: runtime.state.matchId,
        tick: runtime.state.tick,
        agentId: player.id,
        action,
        reason: submitted.reason ?? "本地 Agent bridge 提交动作。",
        risk: "none",
        evidence: [`bridgeRequestId=${submitted.requestId}`],
      },
    };
  }

  private clearLocalAgentRequests(runtime: RunningMatch): void {
    const participantIds = new Set(runtime.state.players.map((player) => player.id));
    for (const controller of this.localControllers.values()) {
      if (!participantIds.has(controller.agentId)) {
        continue;
      }
      this.clearLocalAgentRequest(controller.agentId, runtime.state.matchId);
    }
  }

  private clearLocalAgentRequest(agentId: string, matchId?: string): void {
    const controller = this.localControllers.get(agentId);
    if (!controller) {
      return;
    }
    if (matchId && controller.latestRequest?.observation.matchId !== matchId) {
      return;
    }
    delete controller.latestRequest;
    delete controller.submitted;
  }
}

function localRequestId(matchId: string, agentId: string, tick: number): string {
  return `local_${matchId}_${agentId}_${tick}`;
}

function participantFromPlayer(player: PlayerState, survived: boolean): MatchRecord["participants"][number] {
  const participant: MatchRecord["participants"][number] = {
    agentId: player.id,
    name: player.name,
    appearance: player.appearance,
    survived,
    score: player.score,
  };
  if (player.strategyVersionId) {
    participant.strategyVersionId = player.strategyVersionId;
  }
  return participant;
}
