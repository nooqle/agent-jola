import {
  DIRECTIONS,
  getCell,
  movePosition,
  positionKey,
  samePosition,
  type Direction,
  type MatchState,
  type Position,
} from "@agent-poppy/core";
import { buildDangerWindows, type DangerWindow } from "./danger.js";

const SAFE_ESCAPE_HOLD_TICKS = 5;

export interface PathStep {
  x: number;
  y: number;
  t: number;
  cooldown: number;
  firstDirection?: Direction;
  waitFirst?: boolean;
}

export interface PathResult {
  firstDirection?: Direction;
  waitFirst?: boolean;
  target: Position;
  distance: number;
}

interface PathOptions {
  horizon?: number;
  allowUnsafeTarget?: boolean;
  avoidPositions?: ReadonlySet<string> | undefined;
  dangerWindows?: readonly DangerWindow[];
  minSafeTicks?: number;
  moveCooldownAfterMove?: number;
}

interface SearchIndex {
  occupied: ReadonlySet<string>;
  dangerByPosition: ReadonlyMap<string, readonly DangerWindow[]>;
}

function occupiedByBubble(state: MatchState, position: Position, allowStart: Position): boolean {
  return state.bubbles.some((bubble) => samePosition(bubble, position) && !samePosition(position, allowStart));
}

function occupiedByPlayer(state: MatchState, position: Position, allowStart: Position): boolean {
  return state.players.some((player) => player.alive && samePosition(player, position) && !samePosition(position, allowStart));
}

export function isPassableForPlanner(state: MatchState, position: Position, start: Position): boolean {
  if (getCell(state.map, position) !== "empty") {
    return false;
  }
  return !occupiedByBubble(state, position, start) && !occupiedByPlayer(state, position, start);
}

function buildSearchIndex(
  state: MatchState,
  start: Position,
  windows: readonly DangerWindow[],
): SearchIndex {
  const occupied = new Set<string>();
  for (const bubble of state.bubbles) {
    if (!samePosition(bubble, start)) {
      occupied.add(positionKey(bubble));
    }
  }
  for (const player of state.players) {
    if (player.alive && !samePosition(player, start)) {
      occupied.add(positionKey(player));
    }
  }

  const dangerByPosition = new Map<string, DangerWindow[]>();
  for (const window of windows) {
    const key = positionKey(window.position);
    const entries = dangerByPosition.get(key);
    if (entries) {
      entries.push(window);
    } else {
      dangerByPosition.set(key, [window]);
    }
  }

  return { occupied, dangerByPosition };
}

function isPassableWithIndex(state: MatchState, position: Position, index: SearchIndex): boolean {
  return getCell(state.map, position) === "empty" && !index.occupied.has(positionKey(position));
}

function isSafeForSeveralTicks(
  position: Position,
  fromTick: number,
  duration: number,
  index: SearchIndex,
): boolean {
  const windows = index.dangerByPosition.get(positionKey(position));
  if (!windows) {
    return true;
  }
  for (let tick = fromTick; tick <= fromTick + duration; tick += 1) {
    if (windows.some((window) => tick >= window.startsAtTick && tick < window.expiresAtTick)) {
      return false;
    }
  }
  return true;
}

function cooldownFromPosition(position: Position): number {
  if ("moveCooldown" in position && typeof position.moveCooldown === "number") {
    return Math.max(0, position.moveCooldown);
  }
  return 0;
}

export function findNearestPath(
  state: MatchState,
  start: Position,
  accepts: (position: Position, distance: number) => boolean,
  options: PathOptions = {},
): PathResult | undefined {
  const horizon = options.horizon ?? 30;
  const windows = options.dangerWindows ?? buildDangerWindows(state);
  const moveCooldownAfterMove = options.moveCooldownAfterMove ?? 1;
  const index = buildSearchIndex(state, start, windows);
  const queue: PathStep[] = [{ x: start.x, y: start.y, t: 0, cooldown: cooldownFromPosition(start) }];
  const visited = new Set<string>([`${positionKey(start)}@0:${queue[0]?.cooldown ?? 0}`]);
  let readIndex = 0;

  while (readIndex < queue.length) {
    const current = queue[readIndex];
    readIndex += 1;
    if (!current) {
      break;
    }
    const position = { x: current.x, y: current.y };
    const currentAvoided = options.avoidPositions?.has(positionKey(position)) ?? false;
    if (current.t > 0 && !currentAvoided && accepts(position, current.t)) {
      const safeTicks = Math.max(current.cooldown, options.minSafeTicks ?? 0);
      if (options.allowUnsafeTarget || isSafeForSeveralTicks(position, state.tick + current.t, safeTicks, index)) {
        const result: PathResult = {
          target: position,
          distance: current.t,
        };
        if (current.firstDirection) {
          result.firstDirection = current.firstDirection;
        }
        if (current.waitFirst) {
          result.waitFirst = true;
        }
        return result;
      }
    }
    if (current.t >= horizon) {
      continue;
    }

    const candidates: Array<{ position: Position; direction?: Direction }> = DIRECTIONS.map((direction) => ({
      position: movePosition(position, direction),
      direction,
    }));
    if (current.cooldown > 0 || current.t === 0) {
      candidates.unshift({ position });
    }

    for (const candidate of candidates) {
      if (candidate.direction && current.cooldown > 0) {
        continue;
      }
      if (!isPassableWithIndex(state, candidate.position, index)) {
        continue;
      }
      const avoided = options.avoidPositions?.has(positionKey(candidate.position)) ?? false;
      if (avoided) {
        continue;
      }
      const nextTick = current.t + 1;
      const nextCooldown = candidate.direction ? moveCooldownAfterMove : Math.max(0, current.cooldown - 1);
      if (!isSafeForSeveralTicks(candidate.position, state.tick + nextTick, nextCooldown, index)) {
        continue;
      }
      const key = `${positionKey(candidate.position)}@${nextTick}:${nextCooldown}`;
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);
      const nextStep: PathStep = {
        x: candidate.position.x,
        y: candidate.position.y,
        t: nextTick,
        cooldown: nextCooldown,
      };
      if (current.firstDirection) {
        nextStep.firstDirection = current.firstDirection;
      } else if (current.waitFirst) {
        nextStep.waitFirst = true;
      } else if (current.t === 0 && !candidate.direction) {
        nextStep.waitFirst = true;
      } else if (candidate.direction) {
        nextStep.firstDirection = candidate.direction;
      }
      queue.push(nextStep);
    }
  }

  return undefined;
}

export function findSafePath(
  state: MatchState,
  start: Position,
  horizon = 30,
  dangerWindows: readonly DangerWindow[] = buildDangerWindows(state),
  moveCooldownAfterMove = 1,
  avoidPositions?: ReadonlySet<string>,
): PathResult | undefined {
  const index = buildSearchIndex(state, start, dangerWindows);
  return findNearestPath(
    state,
    start,
    (position, distance) =>
      !samePosition(position, start) &&
      isSafeForSeveralTicks(position, state.tick + distance, SAFE_ESCAPE_HOLD_TICKS, index),
    { horizon, avoidPositions, dangerWindows, moveCooldownAfterMove, minSafeTicks: SAFE_ESCAPE_HOLD_TICKS },
  );
}

export function adjacentOpenDirections(state: MatchState, start: Position): Direction[] {
  const index = buildSearchIndex(state, start, []);
  return DIRECTIONS.filter((direction) => isPassableWithIndex(state, movePosition(start, direction), index));
}
