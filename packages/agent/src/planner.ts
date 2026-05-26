import {
  DIRECTIONS,
  getCell,
  movePosition,
  positionKey,
  samePosition,
  isInsideZone,
  isInsideZoneCircle,
  type AgentAction,
  type BubbleState,
  type DecisionLogEntry,
  type Direction,
  type MatchState,
  type PlayerState,
  type Position,
} from "@agent-poppy/core";
import { defaultStrategy, type AgentStrategy, type StrategyTactics } from "@agent-poppy/strategy";
import {
  blastThreatCells,
  buildDangerWindows,
  cloneWithHypotheticalBubble,
  dangerAt,
  earliestDangerTick,
  type DangerWindow,
} from "./danger.js";
import { adjacentOpenDirections, findNearestPath, findSafePath } from "./pathfinding.js";
import type { PathResult } from "./pathfinding.js";

const LATE_GAME_START_PROGRESS = 0.35;
const FINAL_CHASE_START_PROGRESS = 0.7;
const FUTURE_DANGER_HIGH_TICKS = 6;
const DEFAULT_TACTICS = defaultStrategy().tactics;

interface BombOpportunity {
  enemy: PlayerState;
  escapeOptions: number;
}

export interface PlannerOutput {
  action: AgentAction;
  decision: DecisionLogEntry;
}

export interface PlannerContext {
  dangerWindows: readonly DangerWindow[];
  softWallTargets: ReadonlySet<string>;
}

export function createPlannerContext(state: MatchState): PlannerContext {
  return {
    dangerWindows: buildDangerWindows(state),
    softWallTargets: softWallAdjacencyKeys(state),
  };
}

function tacticsFor(strategy: AgentStrategy): StrategyTactics {
  return {
    ...DEFAULT_TACTICS,
    ...strategy.tactics,
  };
}

function upgradeCount(player: PlayerState): number {
  return (
    Math.max(0, player.blastRange - 2) +
    Math.max(0, player.bubbleCapacity - 1) +
    player.shieldCharges +
    player.pierceCharges +
    player.quickFuseCharges
  );
}

function riskFor(
  state: MatchState,
  position: Position,
  windows: readonly DangerWindow[],
  tactics: StrategyTactics = DEFAULT_TACTICS,
): DecisionLogEntry["risk"] {
  if (dangerAt(windows, position, state.tick)) {
    return "high";
  }
  const earliest = earliestDangerTick(windows, position);
  if (earliest === undefined) {
    return "none";
  }
  const delta = earliest - state.tick;
  const highThreshold = Math.max(FUTURE_DANGER_HIGH_TICKS, Math.floor(tactics.dangerLookaheadTicks / 3));
  if (delta <= highThreshold) {
    return "high";
  }
  if (delta <= tactics.dangerLookaheadTicks) {
    return "medium";
  }
  return "low";
}

function decision(
  state: MatchState,
  player: PlayerState,
  action: AgentAction,
  reason: string,
  risk: DecisionLogEntry["risk"],
  target?: Position,
  evidence: string[] = [],
): DecisionLogEntry {
  const entry: DecisionLogEntry = {
    matchId: state.matchId,
    tick: state.tick,
    agentId: player.id,
    action,
    reason,
    risk,
  };
  if (player.strategyVersionId) {
    entry.strategyVersionId = player.strategyVersionId;
  }
  if (target) {
    entry.target = target;
  }
  if (evidence.length > 0) {
    entry.evidence = evidence;
  }
  return entry;
}

function moveAction(player: PlayerState, direction: Direction): AgentAction {
  return {
    agentId: player.id,
    type: "move",
    direction,
  };
}

function waitAction(player: PlayerState): AgentAction {
  return {
    agentId: player.id,
    type: "wait",
  };
}

function placeAction(player: PlayerState): AgentAction {
  return {
    agentId: player.id,
    type: "place_bubble",
  };
}

function actionFromPath(player: PlayerState, path: PathResult): AgentAction | undefined {
  if (path.waitFirst) {
    return waitAction(player);
  }
  if (path.firstDirection) {
    return moveAction(player, path.firstDirection);
  }
  return undefined;
}

function moveCooldownAfterMove(player: PlayerState): number {
  return player.speedBoostTicks > 0 ? 0 : 1;
}

function mapSearchHorizon(state: MatchState, minimum = 35): number {
  return Math.max(minimum, Math.ceil(Math.max(state.map.width, state.map.height) * 0.75));
}

function matchProgress(state: MatchState): number {
  return state.maxTicks <= 0 ? 0 : Math.max(0, Math.min(1, state.tick / state.maxTicks));
}

function tempoPressure(state: MatchState): number {
  const progress = matchProgress(state);
  const zone = state.zone;
  const zonePressure = zone.enabled
    ? Math.min(0.55, zone.phase * 0.1 + (zone.status === "shrinking" ? 0.18 : 0) + (zone.radius <= 5 ? 0.24 : 0))
    : 0;
  if (progress <= LATE_GAME_START_PROGRESS) {
    return zonePressure;
  }
  const openingPressure = Math.min(0.45, (progress - LATE_GAME_START_PROGRESS) * 0.75);
  const finalPressure =
    progress > FINAL_CHASE_START_PROGRESS ? Math.min(0.25, (progress - FINAL_CHASE_START_PROGRESS) * 0.9) : 0;
  return Math.min(0.9, openingPressure + finalPressure + zonePressure);
}

function livingEnemies(state: MatchState, player: PlayerState): PlayerState[] {
  return state.players.filter((candidate) => candidate.alive && candidate.id !== player.id);
}

function nearestEnemyDistance(state: MatchState, player: PlayerState): number | undefined {
  let nearest: number | undefined;
  for (const enemy of livingEnemies(state, player)) {
    const distance = Math.abs(enemy.x - player.x) + Math.abs(enemy.y - player.y);
    nearest = nearest === undefined ? distance : Math.min(nearest, distance);
  }
  return nearest;
}

function hasAdjacentSoftWall(state: MatchState, player: PlayerState): Position | undefined {
  for (const direction of DIRECTIONS) {
    const target = movePosition(player, direction);
    if (getCell(state.map, target) === "soft") {
      return target;
    }
  }
  return undefined;
}

function canPlaceBubble(state: MatchState, player: PlayerState): boolean {
  return (
    player.alive &&
    player.activeBubbleCount < player.bubbleCapacity &&
    !state.bubbles.some((bubble) => samePosition(bubble, player))
  );
}

function hasActiveOwnBubble(state: MatchState, player: PlayerState): boolean {
  return state.bubbles.some((bubble) => bubble.ownerId === player.id);
}

function hypotheticalBubbleAt(state: MatchState, player: PlayerState, position: Position): BubbleState {
  const quickFuse = player.quickFuseCharges > 0;
  return {
    id: `hypothetical-${state.tick}-${player.id}-${position.x}-${position.y}`,
    ownerId: player.id,
    x: position.x,
    y: position.y,
    placedAtTick: state.tick,
    explodeAtTick: state.tick + (quickFuse ? 15 : 25),
    range: player.blastRange,
    ownerCanPass: true,
    pierce: player.pierceCharges > 0 ? 1 : 0,
    quickFuse,
  };
}

function playerAtPosition(player: PlayerState, position: Position): PlayerState {
  return {
    ...player,
    x: position.x,
    y: position.y,
    moveCooldown: 0,
  };
}

function attackTileKeys(state: MatchState, player: PlayerState): Set<string> {
  const keys = new Set<string>();
  for (const enemy of livingEnemies(state, player)) {
    for (const direction of DIRECTIONS) {
      let cursor: Position = { x: enemy.x, y: enemy.y };
      let pierceLeft = player.pierceCharges > 0 ? 1 : 0;
      for (let distance = 0; distance < player.blastRange; distance += 1) {
        cursor = movePosition(cursor, direction);
        const cell = getCell(state.map, cursor);
        if (!cell || cell === "solid") {
          break;
        }
        if (cell === "empty") {
          keys.add(positionKey(cursor));
          continue;
        }
        if (pierceLeft <= 0) {
          break;
        }
        pierceLeft -= 1;
      }
    }
  }
  return keys;
}

function softWallAdjacencyKeys(state: MatchState): Set<string> {
  const keys = new Set<string>();
  for (let y = 1; y < state.map.height - 1; y += 1) {
    for (let x = 1; x < state.map.width - 1; x += 1) {
      const position = { x, y };
      if (getCell(state.map, position) !== "empty") {
        continue;
      }
      if (DIRECTIONS.some((direction) => getCell(state.map, movePosition(position, direction)) === "soft")) {
        keys.add(positionKey(position));
      }
    }
  }
  return keys;
}

function canEscapeAfterBombAt(state: MatchState, player: PlayerState, position: Position): ReturnType<typeof findNearestPath> {
  const fakeBubble = hypotheticalBubbleAt(state, player, position);
  const threatCells = new Set(blastThreatCells(state, fakeBubble).map(positionKey));
  const future = cloneWithHypotheticalBubble(state, fakeBubble);
  const futureWindows = buildDangerWindows(future);
  const fuseTicks = fakeBubble.explodeAtTick - state.tick;
  return findNearestPath(
    future,
    playerAtPosition(player, position),
    (candidate) => !threatCells.has(positionKey(candidate)),
    {
      horizon: Math.max(8, fuseTicks - 2),
      dangerWindows: futureWindows,
      minSafeTicks: 5,
      moveCooldownAfterMove: moveCooldownAfterMove(player),
    },
  );
}

function strongEscapeAfterBomb(state: MatchState, player: PlayerState, tactics: StrategyTactics): PathResult | undefined {
  const bubble = hypotheticalBubbleAt(state, player, player);
  const escape = canEscapeAfterBombAt(state, player, player);
  if (!escape) {
    return undefined;
  }
  const fuseTicks = bubble.explodeAtTick - state.tick;
  if (escape.distance > Math.max(3, fuseTicks - tactics.escapeMarginTicks)) {
    return undefined;
  }
  if (state.zone.enabled && state.zone.radius <= 2.5) {
    const viableRadius = Math.max(state.zone.finalRadius, state.zone.radius - 0.2);
    if (!isInsideZoneCircle(state.zone.center, viableRadius, escape.target)) {
      return undefined;
    }
  }
  return escape;
}

function isOpenForEnemyEscape(state: MatchState, enemy: PlayerState, position: Position, bomber: PlayerState): boolean {
  if (getCell(state.map, position) !== "empty") {
    return false;
  }
  if (samePosition(position, bomber)) {
    return false;
  }
  if (state.bubbles.some((bubble) => samePosition(bubble, position))) {
    return false;
  }
  return !state.players.some(
    (candidate) => candidate.alive && candidate.id !== enemy.id && samePosition(candidate, position),
  );
}

function enemyEscapeOptionsAgainstBubble(
  state: MatchState,
  player: PlayerState,
  enemy: PlayerState,
  bubble: BubbleState,
): Position[] {
  const future = cloneWithHypotheticalBubble(state, bubble);
  const futureWindows = buildDangerWindows(future);
  return [{ x: enemy.x, y: enemy.y }, ...DIRECTIONS.map((direction) => movePosition(enemy, direction))].filter(
    (position) =>
      isOpenForEnemyEscape(state, enemy, position, player) &&
      !dangerAt(futureWindows, position, bubble.explodeAtTick),
  );
}

function directBombOpportunity(state: MatchState, player: PlayerState): BombOpportunity | undefined {
  const bubble = hypotheticalBubbleAt(state, player, player);
  const threatened = new Set(blastThreatCells(state, bubble).map(positionKey));
  const enemy = state.players.find(
    (candidate) => candidate.alive && candidate.id !== player.id && threatened.has(positionKey(candidate)),
  );
  if (!enemy) {
    return undefined;
  }
  return {
    enemy,
    escapeOptions: enemyEscapeOptionsAgainstBubble(state, player, enemy, bubble).length,
  };
}

function pressureBombTarget(state: MatchState, player: PlayerState): BombOpportunity | undefined {
  const bubble = hypotheticalBubbleAt(state, player, player);
  const threatCells = new Set(blastThreatCells(state, bubble).map(positionKey));
  const enemies = livingEnemies(state, player).filter((enemy) => {
    const distance = Math.abs(enemy.x - player.x) + Math.abs(enemy.y - player.y);
    return distance <= player.blastRange + 2 && !threatCells.has(positionKey(enemy));
  });

  for (const enemy of enemies) {
    const blastTouchesEscapeLane = DIRECTIONS.some((direction) => threatCells.has(positionKey(movePosition(enemy, direction))));
    if (!blastTouchesEscapeLane) {
      continue;
    }
    const escapeOptions = enemyEscapeOptionsAgainstBubble(state, player, enemy, bubble);
    if (escapeOptions.length <= 2) {
      return { enemy, escapeOptions: escapeOptions.length };
    }
  }
  return undefined;
}

function directBombEscapeLimitFor(
  strategy: AgentStrategy,
  tactics: StrategyTactics,
  tempo: number,
  carryingQuickFuse: boolean,
  zoneDuel: boolean,
): number {
  let bonus = 0;
  if (zoneDuel) {
    bonus += 2;
  } else {
    if (tempo >= 0.35 || carryingQuickFuse) {
      bonus += 1;
    }
    if (strategy.riskTolerance >= 0.65 && (tempo >= 0.25 || carryingQuickFuse)) {
      bonus += 1;
    }
  }

  if (strategy.safety >= 0.78 && tempo < 0.5 && !zoneDuel) {
    bonus -= 1;
  }

  return Math.max(0, Math.min(4, tactics.attackEnemyEscapeLimit + bonus));
}

function shouldCommitDirectBomb(
  strategy: AgentStrategy,
  tactics: StrategyTactics,
  opportunity: BombOpportunity | undefined,
  safeToCommit: boolean,
  tempo: number,
  carryingQuickFuse: boolean,
  zoneDuel: boolean,
): boolean {
  if (!safeToCommit || !opportunity || strategy.aggression < 0.4) {
    return false;
  }
  return opportunity.escapeOptions <= directBombEscapeLimitFor(strategy, tactics, tempo, carryingQuickFuse, zoneDuel);
}

function ownFutureBlastKeys(state: MatchState, player: PlayerState, lookaheadTicks: number): Set<string> {
  const keys = new Set<string>();
  for (const bubble of state.bubbles) {
    if (bubble.ownerId !== player.id || bubble.explodeAtTick <= state.tick) {
      continue;
    }
    if (bubble.explodeAtTick - state.tick > lookaheadTicks) {
      continue;
    }
    for (const cell of blastThreatCells(state, bubble)) {
      keys.add(positionKey(cell));
    }
  }
  return keys;
}

function pathAwayFromOwnBlast(
  state: MatchState,
  player: PlayerState,
  windows: readonly DangerWindow[],
  tactics: StrategyTactics,
): { path: PathResult; ticksToExplode: number } | undefined {
  const ownBubbles = state.bubbles.filter(
    (bubble) =>
      bubble.ownerId === player.id &&
      bubble.explodeAtTick > state.tick &&
      bubble.explodeAtTick - state.tick <= tactics.ownBlastLookaheadTicks,
  );
  if (ownBubbles.length === 0) {
    return undefined;
  }

  const threatCells = new Set<string>();
  let currentTileThreatened = false;
  let nearestExplosionTick = Number.POSITIVE_INFINITY;
  for (const bubble of ownBubbles) {
    const cells = blastThreatCells(state, bubble);
    for (const cell of cells) {
      threatCells.add(positionKey(cell));
      if (samePosition(cell, player)) {
        currentTileThreatened = true;
        nearestExplosionTick = Math.min(nearestExplosionTick, bubble.explodeAtTick);
      }
    }
  }

  if (!currentTileThreatened) {
    return undefined;
  }

  const ticksToExplode = nearestExplosionTick - state.tick;
  const path = findNearestPath(state, player, (position) => !threatCells.has(positionKey(position)), {
    horizon: Math.max(6, Math.min(35, ticksToExplode - 1)),
    dangerWindows: windows,
    minSafeTicks: 5,
    moveCooldownAfterMove: moveCooldownAfterMove(player),
  });

  return path ? { path, ticksToExplode } : undefined;
}

function pathToAttackTile(
  state: MatchState,
  player: PlayerState,
  windows: readonly DangerWindow[],
  avoidPositions?: ReadonlySet<string>,
): ReturnType<typeof findNearestPath> {
  const targets = attackTileKeys(state, player);
  if (targets.size === 0) {
    return undefined;
  }
  return findNearestPath(
    state,
    player,
    (position) => targets.has(positionKey(position)),
    {
      horizon: mapSearchHorizon(state, 34),
      avoidPositions,
      dangerWindows: windows,
      minSafeTicks: 3,
      moveCooldownAfterMove: moveCooldownAfterMove(player),
    },
  );
}

function pathToItem(
  state: MatchState,
  player: PlayerState,
  windows: readonly DangerWindow[],
  avoidPositions?: ReadonlySet<string>,
): ReturnType<typeof findNearestPath> {
  const itemKeys = new Set(state.items.map(positionKey));
  if (itemKeys.size === 0) {
    return undefined;
  }
  return findNearestPath(state, player, (position) => itemKeys.has(positionKey(position)), {
    horizon: mapSearchHorizon(state, 34),
    avoidPositions,
    dangerWindows: windows,
    minSafeTicks: 3,
    moveCooldownAfterMove: moveCooldownAfterMove(player),
  });
}

function pathToSoftWallAdjacency(
  state: MatchState,
  player: PlayerState,
  windows: readonly DangerWindow[],
  avoidPositions?: ReadonlySet<string>,
  knownTargets?: ReadonlySet<string>,
): ReturnType<typeof findNearestPath> {
  const targets = knownTargets ?? softWallAdjacencyKeys(state);
  if (targets.size === 0) {
    return undefined;
  }
  return findNearestPath(
    state,
    player,
    (position) => targets.has(positionKey(position)),
    {
      horizon: mapSearchHorizon(state, 34),
      avoidPositions,
      dangerWindows: windows,
      minSafeTicks: 3,
      moveCooldownAfterMove: moveCooldownAfterMove(player),
    },
  );
}

function pathTowardEnemy(
  state: MatchState,
  player: PlayerState,
  windows: readonly DangerWindow[],
  avoidPositions?: ReadonlySet<string>,
): ReturnType<typeof findNearestPath> {
  const enemies = state.players.filter((candidate) => candidate.alive && candidate.id !== player.id);
  if (enemies.length === 0) {
    return undefined;
  }
  return findNearestPath(
    state,
    player,
    (position) => enemies.some((enemy) => Math.abs(enemy.x - position.x) + Math.abs(enemy.y - position.y) <= 2),
    {
      horizon: mapSearchHorizon(state, 34),
      avoidPositions,
      dangerWindows: windows,
      minSafeTicks: 2,
      moveCooldownAfterMove: moveCooldownAfterMove(player),
    },
  );
}

function zoneTargetRadiusForPlanner(state: MatchState): number {
  const zone = state.zone;
  if (!zone.enabled) {
    return Number.POSITIVE_INFINITY;
  }
  if (zone.targetRadius <= zone.finalRadius + 0.25) {
    return zone.targetRadius + 0.05;
  }
  if (zone.targetRadius <= 1.5) {
    return zone.targetRadius + 0.15;
  }
  return zone.targetRadius + 0.5;
}

function zoneUrgencyFor(state: MatchState, player: PlayerState): number {
  const zone = state.zone;
  if (!zone.enabled) {
    return 0;
  }
  if (!isInsideZone(zone, player)) {
    return 1;
  }
  const targetRadius = zoneTargetRadiusForPlanner(state);
  if (zone.status === "shrinking" && !isInsideZoneCircle(zone.targetCenter, targetRadius, player)) {
    return zone.targetRadius <= zone.finalRadius + 0.25 ? 0.95 : 0.8;
  }
  if (zone.radius <= 2.5 && !isInsideZoneCircle(zone.targetCenter, targetRadius, player)) {
    return 0.9;
  }
  if (zone.radius <= 5 && !isInsideZoneCircle(zone.targetCenter, targetRadius, player)) {
    return 0.65;
  }
  const distanceToEdge = zone.radius - euclideanDistance(player, zone.center);
  return distanceToEdge <= 1.6 ? 0.45 : 0;
}

function pathToZoneSafety(
  state: MatchState,
  player: PlayerState,
  windows: readonly DangerWindow[],
  avoidPositions?: ReadonlySet<string>,
): ReturnType<typeof findNearestPath> {
  const zone = state.zone;
  if (!zone.enabled) {
    return undefined;
  }
  const outsideCurrentZone = !isInsideZone(zone, player);
  const center = outsideCurrentZone ? zone.center : zone.targetCenter;
  const radius = outsideCurrentZone ? Math.max(zone.finalRadius, zone.radius - 1) : zoneTargetRadiusForPlanner(state);
  return findNearestPath(state, player, (position) => isInsideZoneCircle(center, radius, position), {
    horizon: mapSearchHorizon(state, 58),
    avoidPositions,
    dangerWindows: windows,
    minSafeTicks: 3,
    moveCooldownAfterMove: moveCooldownAfterMove(player),
  });
}

function openDirectionTowardZone(
  state: MatchState,
  player: PlayerState,
  windows: readonly DangerWindow[],
  avoidPositions?: ReadonlySet<string>,
): Direction | undefined {
  const zone = state.zone;
  if (!zone.enabled) {
    return undefined;
  }
  const target = isInsideZone(zone, player) ? zone.targetCenter : zone.center;
  const currentDistance = euclideanDistance(player, target);
  return adjacentOpenDirections(state, player)
    .map((direction) => {
      const position = movePosition(player, direction);
      return { direction, position, distance: euclideanDistance(position, target) };
    })
    .filter((candidate) => {
      if (avoidPositions?.has(positionKey(candidate.position))) {
        return false;
      }
      if (candidate.distance >= currentDistance) {
        return false;
      }
      const forcedTicks = moveCooldownAfterMove(player);
      for (let tick = state.tick + 1; tick <= state.tick + 1 + forcedTicks; tick += 1) {
        if (dangerAt(windows, candidate.position, tick)) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => a.distance - b.distance)[0]?.direction;
}

function softWallTowardZone(state: MatchState, player: PlayerState): Position | undefined {
  const zone = state.zone;
  if (!zone.enabled) {
    return undefined;
  }
  const target = isInsideZone(zone, player) ? zone.targetCenter : zone.center;
  const currentDistance = euclideanDistance(player, target);
  return DIRECTIONS.map((direction) => movePosition(player, direction)).find(
    (position) => getCell(state.map, position) === "soft" && euclideanDistance(position, target) <= currentDistance,
  );
}

function fallbackMove(
  state: MatchState,
  player: PlayerState,
  windows: readonly DangerWindow[],
  avoidPositions?: ReadonlySet<string>,
): Direction | undefined {
  const openDirections = adjacentOpenDirections(state, player);
  return openDirections.find((direction) => {
    const target = movePosition(player, direction);
    if (avoidPositions?.has(positionKey(target))) {
      return false;
    }
    const forcedTicks = moveCooldownAfterMove(player);
    for (let tick = state.tick + 1; tick <= state.tick + 1 + forcedTicks; tick += 1) {
      if (dangerAt(windows, target, tick)) {
        return false;
      }
    }
    return true;
  });
}

export function planAgentAction(
  state: MatchState,
  player: PlayerState,
  strategy: AgentStrategy = defaultStrategy(player.name),
  context?: PlannerContext,
): PlannerOutput {
  if (!player.alive) {
    const action = waitAction(player);
    return {
      action,
      decision: decision(state, player, action, "Agent 已淘汰，保持等待。", "high"),
    };
  }

  if (player.moveCooldown > 0) {
    const action = waitAction(player);
    const risk: DecisionLogEntry["risk"] =
      state.blasts.some((blast) => samePosition(blast, player)) || !isInsideZone(state.zone, player) ? "high" : "low";
    return {
      action,
      decision: decision(state, player, action, "移动冷却中，等待下一次可执行移动窗口。", risk),
    };
  }

  const windows = context?.dangerWindows ?? buildDangerWindows(state);
  const tactics = tacticsFor(strategy);
  const currentRisk = riskFor(state, player, windows, tactics);
  const zoneUrgency = zoneUrgencyFor(state, player);
  const zoneRisk = zoneUrgency >= 0.95 ? "high" : zoneUrgency >= 0.6 ? "medium" : currentRisk;
  const tempo = tempoPressure(state);
  const ownBlastAvoidance = ownFutureBlastKeys(state, player, Math.max(12, tactics.ownBlastLookaheadTicks));
  const zonePath = zoneUrgency > 0 ? pathToZoneSafety(state, player, windows, ownBlastAvoidance) : undefined;
  if (zonePath && zoneUrgency >= 0.6) {
    const action = actionFromPath(player, zonePath);
    if (action) {
      return {
        action,
        decision: decision(
          state,
          player,
          action,
          action.type === "wait" ? "安全区正在收缩，先等待危险窗口结束再进圈。" : "毒圈压力升高，优先移动到安全区内。",
          zoneRisk,
          zonePath.target,
          [
            `zonePhase=${state.zone.phase}`,
            `zoneRadius=${state.zone.radius.toFixed(1)}`,
            `targetRadius=${state.zone.targetRadius.toFixed(1)}`,
          ],
        ),
      };
    }
  }
  if (zoneUrgency >= 0.6) {
    const direction =
      openDirectionTowardZone(state, player, windows, ownBlastAvoidance) ??
      (zoneUrgency >= 0.95 ? openDirectionTowardZone(state, player, windows) : undefined);
    if (direction) {
      const target = movePosition(player, direction);
      const action = moveAction(player, direction);
      return {
        action,
        decision: decision(
          state,
          player,
          action,
          "安全区完整路径暂不可达，先朝圈心移动并避开当前爆炸窗口。",
          zoneRisk,
          target,
          [`zonePhase=${state.zone.phase}`, `zoneRadius=${state.zone.radius.toFixed(1)}`],
        ),
      };
    }

    const blocker = softWallTowardZone(state, player);
    const zoneEscape = blocker && canPlaceBubble(state, player) ? strongEscapeAfterBomb(state, player, tactics) : undefined;
    if (blocker && zoneEscape) {
      const action = placeAction(player);
      return {
        action,
        decision: decision(
          state,
          player,
          action,
          "通往安全区的方向被软墙阻挡，确认退路后放泡开路。",
          zoneRisk,
          blocker,
          [`escapeDistance=${zoneEscape.distance}`, `zonePhase=${state.zone.phase}`],
        ),
      };
    }
  }
  const ownBlastEscape = pathAwayFromOwnBlast(state, player, windows, tactics);
  if (ownBlastEscape) {
    const action = actionFromPath(player, ownBlastEscape.path);
    if (action) {
      const reason =
        action.type === "wait"
          ? "已在自己水泡的未来爆炸线上，但当前路口需要等待危险窗口结束。"
          : "已在自己水泡的未来爆炸线上，优先离开覆盖线再继续进攻。";
      return {
        action,
        decision: decision(state, player, action, reason, currentRisk, ownBlastEscape.path.target, [
          `escapeDistance=${ownBlastEscape.path.distance}`,
          `ticksToExplode=${ownBlastEscape.ticksToExplode}`,
          `ownBlastLookahead=${tactics.ownBlastLookaheadTicks}`,
        ]),
      };
    }
  }

  if (currentRisk === "high" || currentRisk === "medium") {
    const escape = findSafePath(state, player, 30, windows, moveCooldownAfterMove(player), ownBlastAvoidance);
    if (escape) {
      const action = actionFromPath(player, escape);
      if (action) {
        const reason =
          action.type === "wait"
            ? "安全路线需要先等待当前爆炸窗口结束，避免提前冲入火力格。"
            : "危险窗口接近，提前撤离到可停留的安全格。";
        return {
          action,
          decision: decision(state, player, action, reason, currentRisk, escape.target, [
            `escapeDistance=${escape.distance}`,
          ]),
        };
      }
    }

    const direction = fallbackMove(state, player, windows);
    if (direction) {
      const target = movePosition(player, direction);
      const action = moveAction(player, direction);
      return {
        action,
        decision: decision(
          state,
          player,
          action,
          "完整撤离路线暂不可达，先离开当前高风险格，给下一次搜索争取空间。",
          currentRisk,
          target,
        ),
      };
    }
  }

  const softWall = hasAdjacentSoftWall(state, player);
  const enemyOpportunity = directBombOpportunity(state, player);
  const pressureOpportunity = enemyOpportunity ? undefined : pressureBombTarget(state, player);
  const closestEnemy = nearestEnemyDistance(state, player);
  const safeToCommit = currentRisk === "none" || currentRisk === "low";
  const adjustedAggression = Math.min(1, strategy.aggression + tempo);
  const carryingQuickFuse = player.quickFuseCharges > 0;
  const zoneDuel = state.zone.enabled && state.zone.radius <= 4;
  const directBombEscapeLimit = directBombEscapeLimitFor(strategy, tactics, tempo, carryingQuickFuse, zoneDuel);
  const pressureBombThreshold = zoneDuel ? 0.15 : tempo >= 0.35 ? 0.35 : 0.45;
  const proximityEnemy =
    zoneDuel && closestEnemy !== undefined && closestEnemy <= player.blastRange + 1
      ? livingEnemies(state, player).sort(
          (left, right) =>
            Math.abs(left.x - player.x) +
            Math.abs(left.y - player.y) -
            (Math.abs(right.x - player.x) + Math.abs(right.y - player.y)),
        )[0]
      : undefined;
  const shouldBombEnemy =
    adjustedAggression >= 0.4 &&
    shouldCommitDirectBomb(strategy, tactics, enemyOpportunity, safeToCommit, tempo, carryingQuickFuse, zoneDuel);
  const shouldPressureBomb =
    safeToCommit &&
    (Boolean(pressureOpportunity) || Boolean(proximityEnemy)) &&
    (zoneDuel || tactics.pressureBombing >= pressureBombThreshold) &&
    adjustedAggression + tactics.pressureBombing * 0.25 >= 0.58;
  const shouldBombWall =
    safeToCommit &&
    Boolean(softWall) &&
    (!tactics.conserveQuickFuse || !carryingQuickFuse) &&
    strategy.wallBias >= 0.45 &&
    !(tempo > 0.15 && closestEnemy !== undefined && closestEnemy <= 5);
  const bombEscape =
    shouldBombEnemy || shouldPressureBomb || shouldBombWall ? strongEscapeAfterBomb(state, player, tactics) : undefined;
  if (
    (shouldBombEnemy || shouldPressureBomb || shouldBombWall) &&
    canPlaceBubble(state, player) &&
    (!tactics.singleActiveBubble || !hasActiveOwnBubble(state, player)) &&
    bombEscape
  ) {
    const action = placeAction(player);
    const targetOpportunity = enemyOpportunity ?? pressureOpportunity;
    return {
      action,
      decision: decision(
        state,
        player,
        action,
        shouldBombEnemy
          ? "对手处在当前爆炸覆盖线上，且已验证撤离路线，放泡压制。"
          : shouldPressureBomb
            ? "安全区压缩后对手距离过近，且已验证撤离路线，放泡封锁。"
          : "相邻软墙可破坏，且撤离路线能覆盖移动冷却，放泡开路。",
        currentRisk,
        (shouldBombEnemy || shouldPressureBomb) && targetOpportunity
          ? { x: targetOpportunity.enemy.x, y: targetOpportunity.enemy.y }
          : shouldPressureBomb && proximityEnemy
            ? { x: proximityEnemy.x, y: proximityEnemy.y }
          : softWall,
        [
          `aggression=${strategy.aggression}`,
          `tempo=${tempo.toFixed(2)}`,
          `wallBias=${strategy.wallBias}`,
          `escapeDistance=${bombEscape.distance}`,
          `enemyEscapeOptions=${targetOpportunity?.escapeOptions ?? "n/a"}`,
          `attackEscapeLimit=${directBombEscapeLimit}`,
          `pressureBombing=${tactics.pressureBombing}`,
          `conserveQuickFuse=${tactics.conserveQuickFuse}`,
        ],
      ),
    };
  }

  const duelBonus = (livingEnemies(state, player).length <= 1 ? 0.18 : 0) + (zoneDuel ? 0.25 : 0);
  const upgrades = upgradeCount(player);
  const needsMoreUpgrades = upgrades < tactics.minUpgradesBeforeChase;
  const itemScore = Math.max(
    0,
    strategy.itemBias * (1 - tempo * 0.9) - duelBonus * 0.6 + (needsMoreUpgrades ? 0.25 : 0),
  );
  const wallScore = Math.max(
    0,
    strategy.wallBias * (1 - tempo * 1.15) - duelBonus * 0.5 + (needsMoreUpgrades ? 0.15 : 0),
  );
  const attackScore = Math.min(1.25, strategy.aggression + 0.2 + tempo + duelBonus) * (needsMoreUpgrades ? 0.35 : 1);
  const enemyScore = Math.min(1.1, strategy.aggression - 0.1 + tempo * 0.8 + duelBonus) * (needsMoreUpgrades ? 0.25 : 1);
  const priorities: Array<{ label: string; score: number; resolve: () => ReturnType<typeof findNearestPath> }> = [
    { label: "道具", score: itemScore, resolve: () => pathToItem(state, player, windows, ownBlastAvoidance) },
    {
      label: "安全区",
      score: zoneUrgency >= 0.45 ? 1.05 : 0,
      resolve: () => (zoneUrgency >= 0.45 ? pathToZoneSafety(state, player, windows, ownBlastAvoidance) : undefined),
    },
    { label: "攻击位", score: attackScore, resolve: () => pathToAttackTile(state, player, windows, ownBlastAvoidance) },
    {
      label: "软墙",
      score: wallScore,
      resolve: () => pathToSoftWallAdjacency(state, player, windows, ownBlastAvoidance, context?.softWallTargets),
    },
    { label: "对手", score: enemyScore, resolve: () => pathTowardEnemy(state, player, windows, ownBlastAvoidance) },
  ].sort((a, b) => b.score - a.score);

  for (const priority of priorities) {
    const path = priority.resolve();
    if (path) {
      const action = actionFromPath(player, path);
      if (!action) {
        continue;
      }
      if (action.type === "wait" && priority.label !== "安全区" && currentRisk === "none" && !dangerAt(windows, path.target, state.tick)) {
        continue;
      }
      const reason =
        action.type === "wait"
          ? `前往${priority.label}目标前需要等待危险窗口结束。`
          : `按策略权重前往${priority.label}目标。`;
      return {
        action,
        decision: decision(
          state,
          player,
          action,
          reason,
          currentRisk,
          path.target,
          [
            `score=${priority.score}`,
            `distance=${path.distance}`,
            `upgrades=${upgrades}`,
            `minUpgradesBeforeChase=${tactics.minUpgradesBeforeChase}`,
          ],
        ),
      };
    }
  }

  const direction = fallbackMove(state, player, windows, ownBlastAvoidance);
  if (direction) {
    const target = movePosition(player, direction);
    const action = moveAction(player, direction);
    return {
      action,
      decision: decision(state, player, action, "没有高价值目标，选择一个低风险可行移动。", currentRisk, target),
    };
  }

  const action = waitAction(player);
  return {
    action,
    decision: decision(state, player, action, "没有安全移动或放泡机会，等待下一 tick。", currentRisk),
  };
}

function euclideanDistance(left: Position, right: Position): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return Math.sqrt(dx * dx + dy * dy);
}
