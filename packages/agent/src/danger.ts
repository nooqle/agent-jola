import { DIRECTIONS, getCell, movePosition, positionKey, samePosition } from "@agent-poppy/core";
import type { BubbleState, MatchState, Position } from "@agent-poppy/core";

export interface DangerWindow {
  position: Position;
  startsAtTick: number;
  expiresAtTick: number;
  sourceId: string;
}

function cellsForBubble(state: MatchState, bubble: BubbleState): Position[] {
  const cells: Position[] = [{ x: bubble.x, y: bubble.y }];
  for (const direction of DIRECTIONS) {
    let cursor: Position = { x: bubble.x, y: bubble.y };
    let pierceLeft = bubble.pierce;
    for (let distance = 0; distance < bubble.range; distance += 1) {
      cursor = movePosition(cursor, direction);
      const cell = getCell(state.map, cursor);
      if (!cell || cell === "solid") {
        break;
      }
      cells.push({ x: cursor.x, y: cursor.y });
      if (cell === "soft") {
        if (pierceLeft <= 0) {
          break;
        }
        pierceLeft -= 1;
      }
    }
  }
  return cells;
}

function effectiveExplosionTicks(state: MatchState): Map<string, number> {
  const ticks = new Map(state.bubbles.map((bubble) => [bubble.id, bubble.explodeAtTick]));
  const cellsByBubbleId = new Map(state.bubbles.map((bubble) => [bubble.id, cellsForBubble(state, bubble)]));
  let changed = true;

  while (changed) {
    changed = false;
    for (const source of state.bubbles) {
      const sourceTick = ticks.get(source.id);
      const cells = cellsByBubbleId.get(source.id);
      if (sourceTick === undefined || !cells) {
        continue;
      }
      for (const target of state.bubbles) {
        const targetTick = ticks.get(target.id);
        if (targetTick === undefined || sourceTick >= targetTick) {
          continue;
        }
        if (cells.some((cell) => samePosition(cell, target))) {
          ticks.set(target.id, sourceTick);
          changed = true;
        }
      }
    }
  }

  return ticks;
}

export function buildDangerWindows(state: MatchState, blastDurationTicks = 3): DangerWindow[] {
  const windows: DangerWindow[] = [];
  const bubbleExplosionTicks = effectiveExplosionTicks(state);

  for (const blast of state.blasts) {
    windows.push({
      position: { x: blast.x, y: blast.y },
      startsAtTick: state.tick,
      expiresAtTick: blast.expiresAtTick,
      sourceId: blast.sourceBubbleId,
    });
  }

  for (const bubble of state.bubbles) {
    const startsAtTick = bubbleExplosionTicks.get(bubble.id) ?? bubble.explodeAtTick;
    for (const position of cellsForBubble(state, bubble)) {
      windows.push({
        position,
        startsAtTick,
        expiresAtTick: startsAtTick + blastDurationTicks,
        sourceId: bubble.id,
      });
    }
  }

  return windows;
}

export function dangerAt(windows: readonly DangerWindow[], position: Position, tick: number): DangerWindow | undefined {
  return windows.find(
    (window) =>
      samePosition(window.position, position) && tick >= window.startsAtTick && tick < window.expiresAtTick,
  );
}

export function earliestDangerTick(windows: readonly DangerWindow[], position: Position): number | undefined {
  let earliest: number | undefined;
  for (const window of windows) {
    if (!samePosition(window.position, position)) {
      continue;
    }
    earliest = earliest === undefined ? window.startsAtTick : Math.min(earliest, window.startsAtTick);
  }
  return earliest;
}

export function dangerKey(position: Position, tick: number): string {
  return `${positionKey(position)}@${tick}`;
}

export function cloneWithHypotheticalBubble(state: MatchState, bubble: BubbleState): MatchState {
  return {
    ...state,
    bubbles: [...state.bubbles, bubble],
  };
}

export function blastThreatCells(state: MatchState, bubble: BubbleState): Position[] {
  return cellsForBubble(state, bubble);
}
