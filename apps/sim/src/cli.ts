import { createPlannerContext, planAgentAction } from "@agent-poppy/agent";
import { pathToFileURL } from "node:url";
import {
  applyTick,
  createInitialMatchState,
  defaultRules,
  ENGINE_VERSION,
  RULES_VERSION,
  normalizeMapPresetId,
  validateMatchState,
  type DecisionLogEntry,
  type GameEvent,
  type MapPresetId,
  type MatchState,
} from "@agent-poppy/core";
import { parseNaturalLanguageStrategy, type AgentStrategy } from "@agent-poppy/strategy";

export interface CliOptions {
  seed: string;
  count: number;
  maxTicks: number;
  agents: number;
  mapId: MapPresetId;
  assertState: boolean;
}

export interface SimResult {
  matchId: string;
  seed: string;
  winnerAgentId?: string;
  finishReason?: string;
  safetyStopped: boolean;
  ticks: number;
  eventCount: number;
  decisionCount: number;
  selfEliminations: number;
  opponentEliminations: number;
  zoneEliminations: number;
}

export interface AgentBenchmarkStats {
  agentId: string;
  matches: number;
  wins: number;
  survived: number;
  selfEliminations: number;
  opponentEliminations: number;
  zoneEliminations: number;
  itemsCollected: number;
  bubblesPlaced: number;
  wallsDestroyed: number;
  decisions: number;
  highRiskDecisions: number;
  waitActions: number;
}

export interface BenchmarkReport {
  version: 1;
  engineVersion: string;
  rulesVersion: string;
  seed: string;
  count: number;
  agentCount: number;
  maxTicks: number;
  mapId: MapPresetId;
  assertState: boolean;
  elapsedMs: number;
  averageTicks: number;
  finishReasons: Record<string, number>;
  safetyStops: number;
  totals: {
    selfEliminations: number;
    opponentEliminations: number;
    zoneEliminations: number;
    itemsCollected: number;
    bubblesPlaced: number;
    wallsDestroyed: number;
    highRiskDecisions: number;
    waitActions: number;
  };
  rates: {
    selfEliminationsPerMatch: number;
    opponentEliminationsPerMatch: number;
    zoneEliminationsPerMatch: number;
    highRiskDecisionRate: number;
    waitActionRate: number;
  };
  agentStats: AgentBenchmarkStats[];
}

function parseArgs(argv: string[]): { command: string; options: CliOptions } {
  const [command = "run-once", ...rest] = argv;
  const options: CliOptions = {
    seed: "mvp-seed",
    count: 100,
    maxTicks: defaultRules.maxTicks,
    agents: 4,
    mapId: "royale",
    assertState: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (key === "--assert") {
      options.assertState = true;
      continue;
    }
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      continue;
    }
    index += 1;
    if (key === "--seed") {
      options.seed = value;
    } else if (key === "--count") {
      options.count = Number(value);
    } else if (key === "--maxTicks") {
      options.maxTicks = Number(value);
    } else if (key === "--agents") {
      options.agents = Number(value);
    } else if (key === "--map") {
      options.mapId = normalizeMapPresetId(value);
    }
  }

  return { command, options };
}

function strategiesFor(count: number): AgentStrategy[] {
  const prompts = [
    "平衡策略，先确认逃生路线，再炸墙吃道具。",
    "激进追杀对手，看到机会就压制。",
    "保守生存，优先远离危险和保命。",
    "优先炸墙吃道具升级，慢慢扩大优势。",
  ];
  return prompts.slice(0, count).map((prompt) => parseNaturalLanguageStrategy(prompt).strategy);
}

export function runSimulation(seed: string, options: Pick<CliOptions, "agents" | "maxTicks" | "mapId" | "assertState">): {
  state: MatchState;
  events: GameEvent[];
  decisions: DecisionLogEntry[];
} {
  let state = createInitialMatchState({
    matchId: `sim-${seed}`,
    seed,
    mapId: options.mapId,
    maxTicks: options.maxTicks,
    agents: Array.from({ length: Math.max(2, Math.min(4, options.agents)) }).map((_, index) => ({
      id: `agent-${index + 1}`,
      name: `Agent ${index + 1}`,
      strategyVersionId: `agent-${index + 1}-strategy-v1`,
    })),
  });
  const strategies = strategiesFor(state.players.length);
  const events: GameEvent[] = [];
  const decisions: DecisionLogEntry[] = [];
  assertStateValidIfRequested(state, options.assertState);

  while (state.status === "running" && state.tick < options.maxTicks) {
    const plannerContext = createPlannerContext(state);
    const planned = state.players.flatMap((player, index) =>
      player.alive
        ? [
            planAgentAction(
              state,
              player,
              strategies[index] ?? strategies[0] ?? parseNaturalLanguageStrategy("").strategy,
              plannerContext,
            ),
          ]
        : [],
    );
    decisions.push(...planned.map((entry) => entry.decision));
    const result = applyTick(
      state,
      planned.map((entry) => entry.action),
    );
    events.push(...result.events);
    state = result.state;
    assertStateValidIfRequested(state, options.assertState);
  }

  return {
    state,
    events,
    decisions,
  };
}

function summarize(result: ReturnType<typeof runSimulation>): SimResult {
  const summary: SimResult = {
    matchId: result.state.matchId,
    seed: result.state.seed,
    safetyStopped: result.state.status === "running",
    ticks: result.state.tick,
    eventCount: result.events.length,
    decisionCount: result.decisions.length,
    selfEliminations: result.events.filter(
      (event) => event.type === "eliminated" && event.ownerId !== undefined && event.ownerId === event.agentId,
    ).length,
    opponentEliminations: result.events.filter(
      (event) => event.type === "eliminated" && event.ownerId !== undefined && event.ownerId !== event.agentId,
    ).length,
    zoneEliminations: result.events.filter((event) => event.type === "eliminated" && event.reason === "zone").length,
  };
  if (result.state.winnerAgentId !== undefined) {
    summary.winnerAgentId = result.state.winnerAgentId;
  }
  if (result.state.finishReason !== undefined) {
    summary.finishReason = result.state.finishReason;
  }
  return summary;
}

function runOnce(options: CliOptions): void {
  const result = runSimulation(options.seed, options);
  console.log(JSON.stringify({ summary: summarize(result), finalState: result.state }, null, 2));
}

function runBatch(options: CliOptions): void {
  const summaries: SimResult[] = [];
  const startedAt = Date.now();
  for (let index = 0; index < options.count; index += 1) {
    const result = runSimulation(`${options.seed}-${index}`, options);
    summaries.push(summarize(result));
  }
  const wins = new Map<string, number>();
  for (const summary of summaries) {
    if (summary.winnerAgentId) {
      wins.set(summary.winnerAgentId, (wins.get(summary.winnerAgentId) ?? 0) + 1);
    }
  }
  const averageTicks = summaries.reduce((total, summary) => total + summary.ticks, 0) / summaries.length;
  const selfEliminations = summaries.reduce((total, summary) => total + summary.selfEliminations, 0);
  const opponentEliminations = summaries.reduce((total, summary) => total + summary.opponentEliminations, 0);
  const zoneEliminations = summaries.reduce((total, summary) => total + summary.zoneEliminations, 0);
  const safetyStops = summaries.filter((summary) => summary.safetyStopped).length;
  console.log(
    JSON.stringify(
      {
        count: summaries.length,
        averageTicks,
        elapsedMs: Date.now() - startedAt,
        wins: Object.fromEntries(wins),
        selfEliminations,
        opponentEliminations,
        zoneEliminations,
        safetyStops,
        failures: 0,
      },
      null,
      2,
    ),
  );
}

function createAgentStats(agentId: string): AgentBenchmarkStats {
  return {
    agentId,
    matches: 0,
    wins: 0,
    survived: 0,
    selfEliminations: 0,
    opponentEliminations: 0,
    zoneEliminations: 0,
    itemsCollected: 0,
    bubblesPlaced: 0,
    wallsDestroyed: 0,
    decisions: 0,
    highRiskDecisions: 0,
    waitActions: 0,
  };
}

export function runBenchmark(options: CliOptions): BenchmarkReport {
  const startedAt = Date.now();
  const agentStats = new Map<string, AgentBenchmarkStats>();
  const finishReasons = new Map<string, number>();
  let totalTicks = 0;
  let selfEliminations = 0;
  let opponentEliminations = 0;
  let zoneEliminations = 0;
  let itemsCollected = 0;
  let bubblesPlaced = 0;
  let wallsDestroyed = 0;
  let highRiskDecisions = 0;
  let waitActions = 0;
  let totalDecisions = 0;

  for (let index = 0; index < options.count; index += 1) {
    const result = runSimulation(`${options.seed}-${index}`, options);
    const summary = summarize(result);
    totalTicks += summary.ticks;
    const finishReason = summary.safetyStopped ? "safety_stop" : (summary.finishReason ?? "unknown");
    finishReasons.set(finishReason, (finishReasons.get(finishReason) ?? 0) + 1);

    for (const player of result.state.players) {
      const stats = agentStats.get(player.id) ?? createAgentStats(player.id);
      stats.matches += 1;
      if (player.alive) {
        stats.survived += 1;
      }
      if (result.state.winnerAgentId === player.id) {
        stats.wins += 1;
      }
      agentStats.set(player.id, stats);
    }

    const wallOwners = wallOwnersFor(result.events);
    for (const event of result.events) {
      if (event.type === "eliminated" && event.ownerId !== undefined) {
        if (event.ownerId === event.agentId) {
          selfEliminations += 1;
          const stats = agentStats.get(event.agentId) ?? createAgentStats(event.agentId);
          stats.selfEliminations += 1;
          agentStats.set(event.agentId, stats);
        } else {
          opponentEliminations += 1;
          const stats = agentStats.get(event.ownerId) ?? createAgentStats(event.ownerId);
          stats.opponentEliminations += 1;
          agentStats.set(event.ownerId, stats);
        }
      } else if (event.type === "eliminated" && event.reason === "zone") {
        zoneEliminations += 1;
        const stats = agentStats.get(event.agentId) ?? createAgentStats(event.agentId);
        stats.zoneEliminations += 1;
        agentStats.set(event.agentId, stats);
      } else if (event.type === "item_collected") {
        itemsCollected += 1;
        const stats = agentStats.get(event.agentId) ?? createAgentStats(event.agentId);
        stats.itemsCollected += 1;
        agentStats.set(event.agentId, stats);
      } else if (event.type === "bubble_placed") {
        bubblesPlaced += 1;
        const stats = agentStats.get(event.bubble.ownerId) ?? createAgentStats(event.bubble.ownerId);
        stats.bubblesPlaced += 1;
        agentStats.set(event.bubble.ownerId, stats);
      } else if (event.type === "wall_destroyed") {
        wallsDestroyed += 1;
        const ownerId = wallOwners.get(`${event.tick}:${event.position.x},${event.position.y}`);
        if (ownerId) {
          const stats = agentStats.get(ownerId) ?? createAgentStats(ownerId);
          stats.wallsDestroyed += 1;
          agentStats.set(ownerId, stats);
        }
      }
    }

    for (const decision of result.decisions) {
      totalDecisions += 1;
      const stats = agentStats.get(decision.agentId) ?? createAgentStats(decision.agentId);
      stats.decisions += 1;
      if (decision.risk === "high") {
        highRiskDecisions += 1;
        stats.highRiskDecisions += 1;
      }
      if (decision.action.type === "wait") {
        waitActions += 1;
        stats.waitActions += 1;
      }
      agentStats.set(decision.agentId, stats);
    }
  }

  return {
    version: 1,
    engineVersion: ENGINE_VERSION,
    rulesVersion: RULES_VERSION,
    seed: options.seed,
    count: options.count,
    agentCount: Math.max(2, Math.min(4, options.agents)),
    maxTicks: options.maxTicks,
    mapId: options.mapId,
    assertState: options.assertState,
    elapsedMs: Date.now() - startedAt,
    averageTicks: round(totalTicks / options.count),
    finishReasons: Object.fromEntries(finishReasons),
    safetyStops: finishReasons.get("safety_stop") ?? 0,
    totals: {
      selfEliminations,
      opponentEliminations,
      zoneEliminations,
      itemsCollected,
      bubblesPlaced,
      wallsDestroyed,
      highRiskDecisions,
      waitActions,
    },
    rates: {
      selfEliminationsPerMatch: round(selfEliminations / options.count),
      opponentEliminationsPerMatch: round(opponentEliminations / options.count),
      zoneEliminationsPerMatch: round(zoneEliminations / options.count),
      highRiskDecisionRate: round(rate(highRiskDecisions, totalDecisions)),
      waitActionRate: round(rate(waitActions, totalDecisions)),
    },
    agentStats: [...agentStats.values()].sort((left, right) => left.agentId.localeCompare(right.agentId)),
  };
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function rate(value: number, total: number): number {
  return total === 0 ? 0 : value / total;
}

function wallOwnersFor(events: readonly GameEvent[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const event of events) {
    if (event.type !== "bubble_exploded") {
      continue;
    }
    for (const cell of event.cells) {
      owners.set(`${event.tick}:${cell.x},${cell.y}`, event.ownerId);
    }
  }
  return owners;
}

function assertStateValidIfRequested(state: MatchState, enabled: boolean): void {
  if (!enabled) {
    return;
  }
  const issues = validateMatchState(state);
  if (issues.length > 0) {
    throw new Error(`Invalid simulated state at ${state.matchId} tick ${state.tick}:\n${issues.join("\n")}`);
  }
}

function printBenchmark(options: CliOptions): void {
  console.log(JSON.stringify(runBenchmark(options), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === "run-batch") {
    runBatch(parsed.options);
  } else if (parsed.command === "benchmark") {
    printBenchmark(parsed.options);
  } else {
    runOnce(parsed.options);
  }
}
