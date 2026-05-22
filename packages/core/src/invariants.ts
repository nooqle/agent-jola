import { getCell, inBounds, positionKey } from "./map.js";
import { isInsideZoneCircle } from "./zone.js";
import type { MatchState, Position } from "./types.js";

export function validateMatchState(state: MatchState): string[] {
  const issues: string[] = [];
  if (state.map.cells.length !== state.map.width * state.map.height) {
    issues.push(`map cell count mismatch: ${state.map.cells.length} != ${state.map.width * state.map.height}`);
  }

  const livePositions = new Set<string>();
  for (const player of state.players) {
    const label = `player ${player.id}`;
    validatePosition(state, player, label, issues);
    if (player.alive) {
      if (getCell(state.map, player) !== "empty") {
        issues.push(`${label} is alive on non-empty cell ${positionKey(player)}`);
      }
      const key = positionKey(player);
      if (livePositions.has(key)) {
        issues.push(`multiple live players occupy ${key}`);
      }
      livePositions.add(key);
    }
    const actualBubbles = state.bubbles.filter((bubble) => bubble.ownerId === player.id).length;
    if (player.activeBubbleCount !== actualBubbles) {
      issues.push(`${label} activeBubbleCount ${player.activeBubbleCount} != ${actualBubbles}`);
    }
    if (player.bubbleCapacity < 1) {
      issues.push(`${label} has invalid bubbleCapacity ${player.bubbleCapacity}`);
    }
    if (player.blastRange < 1) {
      issues.push(`${label} has invalid blastRange ${player.blastRange}`);
    }
  }

  const bubblePositions = new Set<string>();
  for (const bubble of state.bubbles) {
    validatePosition(state, bubble, `bubble ${bubble.id}`, issues);
    if (getCell(state.map, bubble) !== "empty") {
      issues.push(`bubble ${bubble.id} is on non-empty cell ${positionKey(bubble)}`);
    }
    const key = positionKey(bubble);
    if (bubblePositions.has(key)) {
      issues.push(`multiple bubbles occupy ${key}`);
    }
    bubblePositions.add(key);
    if (!state.players.some((player) => player.id === bubble.ownerId)) {
      issues.push(`bubble ${bubble.id} references missing owner ${bubble.ownerId}`);
    }
    if (bubble.explodeAtTick <= bubble.placedAtTick) {
      issues.push(`bubble ${bubble.id} has non-positive fuse`);
    }
  }

  for (const blast of state.blasts) {
    validatePosition(state, blast, `blast ${blast.id}`, issues);
    if (blast.expiresAtTick <= state.tick) {
      issues.push(`blast ${blast.id} should have expired at tick ${blast.expiresAtTick}`);
    }
  }

  for (const item of state.items) {
    validatePosition(state, item, `item ${item.id}`, issues);
    if (getCell(state.map, item) !== "empty") {
      issues.push(`item ${item.id} is on non-empty cell ${positionKey(item)}`);
    }
  }

  if (state.zone.enabled) {
    const targetContained = isInsideZoneCircle(
      state.zone.fromCenter,
      Math.max(0, state.zone.fromRadius - state.zone.targetRadius),
      state.zone.targetCenter,
    );
    if (!targetContained) {
      issues.push("zone target is not fully contained by previous zone");
    }
    if (state.zone.radius < state.zone.finalRadius - 0.001) {
      issues.push(`zone radius ${state.zone.radius} is smaller than final radius ${state.zone.finalRadius}`);
    }
  }

  return issues;
}

export function assertMatchStateValid(state: MatchState): void {
  const issues = validateMatchState(state);
  if (issues.length > 0) {
    throw new Error(`Invalid match state:\n${issues.join("\n")}`);
  }
}

function validatePosition(state: MatchState, position: Position, label: string, issues: string[]): void {
  if (!Number.isInteger(position.x) || !Number.isInteger(position.y)) {
    issues.push(`${label} has non-integer position ${position.x},${position.y}`);
    return;
  }
  if (!inBounds(state.map, position)) {
    issues.push(`${label} is out of bounds at ${positionKey(position)}`);
  }
}
