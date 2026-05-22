import { cloneMatchState, defaultRules } from "./factory.js";
import { DIRECTIONS, getCell, inBounds, movePosition, positionKey, samePosition, setCell } from "./map.js";
import { chooseSeeded, rngFloat } from "./rng.js";
import { advanceZone, isInsideZone } from "./zone.js";
import type {
  AgentAction,
  BlastState,
  BubbleState,
  Direction,
  GameEvent,
  ItemType,
  ItemState,
  MatchState,
  PlayerState,
  Position,
  RulesConfig,
  TickResult,
} from "./types.js";

const ITEM_POOL: readonly ItemType[] = ["rangeUp", "capacityUp", "speedUp", "shield", "pierce", "quickFuse"];
const VALID_DIRECTIONS = new Set<string>(DIRECTIONS);

function actionFor(actions: readonly AgentAction[], agentId: string): AgentAction {
  return actions.find((action) => action.agentId === agentId) ?? { agentId, type: "wait" };
}

function normalizeActions(actions: readonly unknown[], state: MatchState): AgentAction[] {
  return state.players.map((player) => normalizeAction(actions.find((action) => actionBelongsTo(action, player.id)), player.id));
}

function actionBelongsTo(action: unknown, agentId: string): boolean {
  return isRecord(action) && action.agentId === agentId;
}

function normalizeAction(action: unknown, agentId: string): AgentAction {
  if (!isRecord(action) || action.agentId !== agentId || typeof action.type !== "string") {
    return { agentId, type: "wait" };
  }
  if (action.type === "place_bubble") {
    return { agentId, type: "place_bubble" };
  }
  if (action.type === "move" && typeof action.direction === "string" && isDirection(action.direction)) {
    return {
      agentId,
      type: "move",
      direction: action.direction,
    };
  }
  return { agentId, type: "wait" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDirection(value: string): value is Direction {
  return VALID_DIRECTIONS.has(value);
}

function bubbleAt(state: MatchState, position: Position): BubbleState | undefined {
  return state.bubbles.find((bubble) => samePosition(bubble, position));
}

function playerAt(state: MatchState, position: Position): PlayerState | undefined {
  return state.players.find((player) => player.alive && samePosition(player, position));
}

function isBlockedByBubble(state: MatchState, position: Position): boolean {
  return Boolean(bubbleAt(state, position));
}

function movementBlockReason(state: MatchState, position: Position): "wall" | "bubble" | "bounds" | undefined {
  if (!inBounds(state.map, position)) {
    return "bounds";
  }
  if (getCell(state.map, position) !== "empty") {
    return "wall";
  }
  if (isBlockedByBubble(state, position)) {
    return "bubble";
  }
  return undefined;
}

function updatePlayer(state: MatchState, playerId: string, patch: Partial<PlayerState>): void {
  const index = state.players.findIndex((player) => player.id === playerId);
  if (index >= 0) {
    state.players[index] = {
      ...(state.players[index] as PlayerState),
      ...patch,
    };
  }
}

function activeBlastAt(state: MatchState, position: Position): BlastState | undefined {
  return state.blasts.find((blast) => samePosition(blast, position));
}

function placeBubbles(state: MatchState, actions: readonly AgentAction[], rules: RulesConfig, events: GameEvent[]): void {
  for (const player of state.players) {
    if (!player.alive) {
      continue;
    }
    const action = actionFor(actions, player.id);
    if (action.type !== "place_bubble") {
      continue;
    }
    const occupied = state.bubbles.some((bubble) => samePosition(bubble, player));
    if (occupied || player.activeBubbleCount >= player.bubbleCapacity) {
      events.push({
        type: "blocked",
        tick: state.tick,
        agentId: player.id,
        reason: occupied ? "bubble" : "cooldown",
        from: { x: player.x, y: player.y },
      });
      continue;
    }
    const quickFuse = player.quickFuseCharges > 0;
    const pierce = player.pierceCharges > 0 ? 1 : 0;
    const bubble: BubbleState = {
      id: `bubble-${state.tick}-${player.id}-${state.bubbles.length}`,
      ownerId: player.id,
      x: player.x,
      y: player.y,
      placedAtTick: state.tick,
      explodeAtTick: state.tick + (quickFuse ? rules.quickFuseTicks : rules.bubbleFuseTicks),
      range: player.blastRange,
      ownerCanPass: true,
      pierce,
      quickFuse,
    };
    state.bubbles.push(bubble);
    const patch: Partial<PlayerState> = {
      activeBubbleCount: player.activeBubbleCount + 1,
    };
    if (quickFuse) {
      patch.quickFuseCharges = Math.max(0, player.quickFuseCharges - 1);
    }
    if (pierce > 0) {
      patch.pierceCharges = Math.max(0, player.pierceCharges - 1);
    }
    updatePlayer(state, player.id, patch);
    events.push({
      type: "bubble_placed",
      tick: state.tick,
      bubble,
    });
  }
}

interface MoveIntent {
  player: PlayerState;
  from: Position;
  to: Position;
}

function movementConflictRank(state: MatchState, intent: MoveIntent): number {
  const value = `${state.seed}:${state.tick}:${positionKey(intent.to)}:${intent.player.id}`;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function resolveMovement(state: MatchState, actions: readonly AgentAction[], rules: RulesConfig, events: GameEvent[]): void {
  const intents: MoveIntent[] = [];
  const targetIntents = new Map<string, MoveIntent[]>();

  for (const player of state.players) {
    if (!player.alive) {
      continue;
    }

    if (player.moveCooldown > 0) {
      updatePlayer(state, player.id, {
        moveCooldown: player.moveCooldown - 1,
        speedBoostTicks: Math.max(0, player.speedBoostTicks - 1),
      });
      const action = actionFor(actions, player.id);
      if (action.type === "move") {
        events.push({
          type: "blocked",
          tick: state.tick,
          agentId: player.id,
          reason: "cooldown",
          from: { x: player.x, y: player.y },
          to: movePosition(player, action.direction),
        });
      }
      continue;
    }

    const action = actionFor(actions, player.id);
    if (action.type !== "move") {
      updatePlayer(state, player.id, {
        speedBoostTicks: Math.max(0, player.speedBoostTicks - 1),
      });
      continue;
    }

    const target = movePosition(player, action.direction);
    const reason = movementBlockReason(state, target);
    updatePlayer(state, player.id, { direction: action.direction });
    if (reason) {
      events.push({
        type: "blocked",
        tick: state.tick,
        agentId: player.id,
        reason,
        from: { x: player.x, y: player.y },
        to: target,
      });
      continue;
    }

    intents.push({
      player,
      from: { x: player.x, y: player.y },
      to: target,
    });
    const key = positionKey(target);
    targetIntents.set(key, [...(targetIntents.get(key) ?? []), intents[intents.length - 1] as MoveIntent]);
  }

  const blocked = new Set<string>();
  for (const competingIntents of targetIntents.values()) {
    if (competingIntents.length <= 1) {
      continue;
    }
    const winner = [...competingIntents].sort(
      (left, right) => movementConflictRank(state, left) - movementConflictRank(state, right),
    )[0];
    for (const intent of competingIntents) {
      if (intent.player.id !== winner?.player.id) {
        blocked.add(intent.player.id);
      }
    }
  }

  for (const a of intents) {
    for (const b of intents) {
      if (a.player.id === b.player.id) {
        continue;
      }
      if (samePosition(a.from, b.to) && samePosition(a.to, b.from)) {
        blocked.add(a.player.id);
        blocked.add(b.player.id);
      }
    }
  }

  const intentByPlayerId = new Map(intents.map((intent) => [intent.player.id, intent]));
  for (const intent of intents) {
    const occupant = playerAt(state, intent.to);
    if (!occupant || occupant.id === intent.player.id) {
      continue;
    }
    const occupantIntent = intentByPlayerId.get(occupant.id);
    if (!occupantIntent) {
      blocked.add(intent.player.id);
      continue;
    }
    if (samePosition(occupantIntent.to, intent.from)) {
      blocked.add(intent.player.id);
      blocked.add(occupant.id);
    }
  }

  for (const intent of intents) {
    if (blocked.has(intent.player.id)) {
      events.push({
        type: "blocked",
        tick: state.tick,
        agentId: intent.player.id,
        reason: "conflict",
        from: intent.from,
        to: intent.to,
      });
      continue;
    }

    for (const bubble of state.bubbles) {
      if (bubble.ownerId === intent.player.id && bubble.ownerCanPass && samePosition(bubble, intent.from)) {
        bubble.ownerCanPass = false;
      }
    }

    const cooldown =
      intent.player.speedBoostTicks > 0 ? rules.boostedMoveCooldownTicks - 1 : rules.normalMoveCooldownTicks - 1;
    updatePlayer(state, intent.player.id, {
      x: intent.to.x,
      y: intent.to.y,
      moveCooldown: Math.max(0, cooldown),
      speedBoostTicks: Math.max(0, intent.player.speedBoostTicks - 1),
    });
    events.push({
      type: "moved",
      tick: state.tick,
      agentId: intent.player.id,
      from: intent.from,
      to: intent.to,
    });
  }
}

function blastCellsFor(state: MatchState, bubble: BubbleState): Position[] {
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

function maybeSpawnItem(state: MatchState, position: Position, events: GameEvent[], rules: RulesConfig): void {
  const roll = rngFloat(state.rngState);
  state.rngState = roll.state;
  if (roll.value >= rules.itemDropChance) {
    return;
  }
  const choice = chooseSeeded(state.rngState, ITEM_POOL);
  state.rngState = choice.state;
  const item: ItemState = {
    id: `item-${state.tick}-${position.x}-${position.y}`,
    type: choice.value,
    x: position.x,
    y: position.y,
  };
  state.items.push(item);
  events.push({
    type: "item_spawned",
    tick: state.tick,
    item,
  });
}

function explodeBubbles(state: MatchState, rules: RulesConfig, events: GameEvent[]): void {
  const pending = new Set(state.bubbles.filter((bubble) => bubble.explodeAtTick <= state.tick).map((bubble) => bubble.id));
  const exploded = new Set<string>();

  while (pending.size > 0) {
    const bubbleId = pending.values().next().value as string;
    pending.delete(bubbleId);
    if (exploded.has(bubbleId)) {
      continue;
    }
    const bubble = state.bubbles.find((entry) => entry.id === bubbleId);
    if (!bubble) {
      continue;
    }
    exploded.add(bubbleId);
    state.bubbles = state.bubbles.filter((entry) => entry.id !== bubble.id);
    const owner = state.players.find((player) => player.id === bubble.ownerId);
    if (owner) {
      updatePlayer(state, owner.id, {
        activeBubbleCount: Math.max(0, owner.activeBubbleCount - 1),
        score: owner.score + 1,
      });
    }

    const cells = blastCellsFor(state, bubble);
    for (const cell of cells) {
      const chained = bubbleAt(state, cell);
      if (chained) {
        pending.add(chained.id);
      }
      if (getCell(state.map, cell) === "soft") {
        state.items = state.items.filter((item) => !samePosition(item, cell));
        state.map = setCell(state.map, cell, "empty");
        const owningPlayer = state.players.find((player) => player.id === bubble.ownerId);
        if (owningPlayer) {
          updatePlayer(state, owningPlayer.id, { score: owningPlayer.score + 5 });
        }
        events.push({
          type: "wall_destroyed",
          tick: state.tick,
          position: cell,
        });
        maybeSpawnItem(state, cell, events, rules);
      } else {
        state.items = state.items.filter((item) => !samePosition(item, cell));
      }
      state.blasts.push({
        id: `blast-${state.tick}-${bubble.id}-${cell.x}-${cell.y}`,
        sourceBubbleId: bubble.id,
        ownerId: bubble.ownerId,
        x: cell.x,
        y: cell.y,
        expiresAtTick: state.tick + rules.blastDurationTicks,
      });
    }

    events.push({
      type: "bubble_exploded",
      tick: state.tick,
      bubbleId: bubble.id,
      ownerId: bubble.ownerId,
      cells,
    });
  }
}

function collectItems(state: MatchState, rules: RulesConfig, events: GameEvent[]): void {
  for (const player of state.players) {
    if (!player.alive) {
      continue;
    }
    const item = state.items.find((entry) => samePosition(entry, player));
    if (!item) {
      continue;
    }
    state.items = state.items.filter((entry) => entry.id !== item.id);
    const patch: Partial<PlayerState> = {
      score: player.score + 10,
    };
    if (item.type === "rangeUp") {
      patch.blastRange = Math.min(6, player.blastRange + 1);
    } else if (item.type === "capacityUp") {
      patch.bubbleCapacity = Math.min(4, player.bubbleCapacity + 1);
    } else if (item.type === "speedUp") {
      patch.speedBoostTicks = Math.max(player.speedBoostTicks, 80);
    } else if (item.type === "shield") {
      patch.shieldCharges = Math.min(rules.maxShieldCharges, player.shieldCharges + 1);
    } else if (item.type === "pierce") {
      patch.pierceCharges = Math.min(rules.maxPierceCharges, player.pierceCharges + 1);
    } else {
      patch.quickFuseCharges = Math.min(rules.maxQuickFuseCharges, player.quickFuseCharges + 1);
    }
    updatePlayer(state, player.id, patch);
    events.push({
      type: "item_collected",
      tick: state.tick,
      agentId: player.id,
      item,
    });
  }
}

function eliminatePlayers(state: MatchState, rules: RulesConfig, events: GameEvent[]): void {
  for (const player of state.players) {
    if (!player.alive) {
      continue;
    }
    if (player.invulnerableUntilTick > state.tick) {
      continue;
    }
    const blast = activeBlastAt(state, player);
    if (!blast) {
      continue;
    }
    if (player.shieldCharges > 0) {
      const remainingCharges = Math.max(0, player.shieldCharges - 1);
      updatePlayer(state, player.id, {
        shieldCharges: remainingCharges,
        invulnerableUntilTick: state.tick + rules.blastDurationTicks + 1,
        score: player.score + 3,
      });
      events.push({
        type: "shield_absorbed",
        tick: state.tick,
        agentId: player.id,
        byBubbleId: blast.sourceBubbleId,
        remainingCharges,
      });
      continue;
    }
    updatePlayer(state, player.id, {
      alive: false,
    });
    const ownerId = blast.ownerId;
    if (ownerId && ownerId !== player.id) {
      const owner = state.players.find((entry) => entry.id === ownerId);
      if (owner) {
        updatePlayer(state, owner.id, {
          score: owner.score + 25,
        });
      }
    }
    events.push({
      type: "eliminated",
      tick: state.tick,
      agentId: player.id,
      ownerId,
      byBubbleId: blast.sourceBubbleId,
    });
  }
}

function applyZonePressure(state: MatchState, events: GameEvent[]): void {
  if (!state.zone.enabled) {
    return;
  }
  for (const player of state.players) {
    if (!player.alive) {
      continue;
    }
    if (isInsideZone(state.zone, player)) {
      if (player.zoneExposureTicks > 0) {
        updatePlayer(state, player.id, { zoneExposureTicks: 0 });
      }
      continue;
    }

    const exposure = player.zoneExposureTicks + 1;
    if (exposure < state.zone.damageGraceTicks) {
      updatePlayer(state, player.id, { zoneExposureTicks: exposure });
      continue;
    }

    updatePlayer(state, player.id, {
      alive: false,
      zoneExposureTicks: exposure,
    });
    events.push({
      type: "eliminated",
      tick: state.tick,
      agentId: player.id,
      reason: "zone",
    });
  }
}

function finishIfNeeded(state: MatchState, events: GameEvent[]): void {
  if (state.status !== "running") {
    return;
  }

  const alive = state.players.filter((player) => player.alive);
  if (alive.length <= 1) {
    const winnerAgentId = alive[0]?.id ?? tiebreakWinner(state)?.id;
    state.status = "finished";
    state.finishReason = winnerAgentId ? "elimination" : "draw";
    if (winnerAgentId) {
      state.winnerAgentId = winnerAgentId;
    } else {
      delete state.winnerAgentId;
    }
    const event: GameEvent = {
      type: "finished",
      tick: state.tick,
      reason: state.finishReason,
    };
    if (winnerAgentId) {
      event.winnerAgentId = winnerAgentId;
    }
    events.push(event);
    return;
  }

}

function tiebreakWinner(state: MatchState): PlayerState | undefined {
  return [...state.players].sort((left, right) => {
    const scoreDelta = right.score - left.score;
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    const exposureDelta = left.zoneExposureTicks - right.zoneExposureTicks;
    if (exposureDelta !== 0) {
      return exposureDelta;
    }
    return finishTiebreakRank(state, left.id) - finishTiebreakRank(state, right.id);
  })[0];
}

function finishTiebreakRank(state: MatchState, agentId: string): number {
  const value = `${state.seed}:${state.tick}:finish:${agentId}`;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function applyTick(current: MatchState, actions: readonly AgentAction[], config: Partial<RulesConfig> = {}): TickResult {
  const rules = {
    ...defaultRules,
    ...config,
  };
  const state = cloneMatchState(current);
  if (state.status !== "running") {
    return { state, events: [] };
  }

  state.tick += 1;
  state.zone = advanceZone(state.zone, state.map, state.tick, rules);
  state.blasts = state.blasts.filter((blast) => blast.expiresAtTick > state.tick);
  const events: GameEvent[] = [{ type: "tick", tick: state.tick }];
  const normalizedActions = normalizeActions(actions, state);

  placeBubbles(state, normalizedActions, rules, events);
  resolveMovement(state, normalizedActions, rules, events);
  explodeBubbles(state, rules, events);
  collectItems(state, rules, events);
  eliminatePlayers(state, rules, events);
  applyZonePressure(state, events);
  finishIfNeeded(state, events);

  return {
    state,
    events,
  };
}

export function summarizePublicState(state: MatchState): MatchState {
  return cloneMatchState(state);
}

export function isTileOccupiedByPlayer(state: MatchState, position: Position): boolean {
  return Boolean(playerAt(state, position));
}
