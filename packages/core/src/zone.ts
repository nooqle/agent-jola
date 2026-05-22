import { rngFloat } from "./rng.js";
import type { GameMap, Position, RulesConfig, ZoneState } from "./types.js";

export function createInitialZoneState(map: GameMap, seed: string, rules: RulesConfig, enabled: boolean): ZoneState {
  const center = { x: (map.width - 1) / 2, y: (map.height - 1) / 2 };
  const radius = Math.ceil(Math.hypot(map.width, map.height) / 2);
  const rngState = hashZoneSeed(`${seed}:${map.id}:zone`);
  const targetRadius = Math.max(rules.zoneMinRadius, Math.floor(radius * 0.72));
  const target = chooseZoneTarget(map, center, radius, targetRadius, rngState);

  return {
    enabled,
    phase: 0,
    status: enabled ? "waiting" : "stable",
    center,
    radius,
    fromCenter: center,
    fromRadius: radius,
    targetCenter: target.center,
    targetRadius,
    shrinkStartTick: rules.zoneStartTick,
    shrinkEndTick: rules.zoneStartTick + rules.zoneShrinkDurationTicks,
    nextShrinkStartTick: rules.zoneStartTick + rules.zoneShrinkDurationTicks + rules.zoneShrinkIntervalTicks,
    finalRadius: rules.zoneMinRadius,
    damageGraceTicks: rules.zoneDamageGraceTicks,
    rngState: target.rngState,
  };
}

export function advanceZone(zone: ZoneState, map: GameMap, tick: number, rules: RulesConfig): ZoneState {
  if (!zone.enabled) {
    return zone;
  }

  const next = { ...zone };
  if (tick < next.shrinkStartTick) {
    next.status = "waiting";
    next.center = next.fromCenter;
    next.radius = next.fromRadius;
    return next;
  }

  if (tick <= next.shrinkEndTick) {
    const progress = clamp((tick - next.shrinkStartTick) / Math.max(1, next.shrinkEndTick - next.shrinkStartTick), 0, 1);
    next.status = "shrinking";
    next.center = lerpPosition(next.fromCenter, next.targetCenter, progress);
    next.radius = lerp(next.fromRadius, next.targetRadius, progress);
    return next;
  }

  next.status = "stable";
  next.center = next.targetCenter;
  next.radius = next.targetRadius;

  if (tick >= next.nextShrinkStartTick && next.radius > next.finalRadius + 0.1) {
    const targetRadius = Math.max(next.finalRadius, Math.floor(next.radius * 0.66));
    const target = chooseZoneTarget(map, next.center, next.radius, targetRadius, next.rngState);
    next.phase += 1;
    next.status = "shrinking";
    next.fromCenter = next.center;
    next.fromRadius = next.radius;
    next.targetCenter = target.center;
    next.targetRadius = targetRadius;
    next.shrinkStartTick = tick;
    next.shrinkEndTick = tick + rules.zoneShrinkDurationTicks;
    next.nextShrinkStartTick = next.shrinkEndTick + rules.zoneShrinkIntervalTicks;
    next.rngState = target.rngState;
  }

  return next;
}

export function isInsideZone(zone: ZoneState | undefined, position: Position): boolean {
  if (!zone?.enabled) {
    return true;
  }
  return isInsideZoneCircle(zone.center, zone.radius, position);
}

export function isInsideZoneCircle(center: Position, radius: number, position: Position): boolean {
  const dx = position.x - center.x;
  const dy = position.y - center.y;
  return Math.sqrt(dx * dx + dy * dy) <= radius;
}

export function zoneDistance(position: Position, center: Position): number {
  return Math.abs(position.x - center.x) + Math.abs(position.y - center.y);
}

function chooseZoneTarget(
  map: GameMap,
  currentCenter: Position,
  currentRadius: number,
  targetRadius: number,
  rngState: number,
): { center: Position; rngState: number } {
  let state = rngState;
  const maxCenterShift = Math.max(0, currentRadius - targetRadius - 0.05);
  let fallback = fallbackZoneTarget(map, currentCenter, currentRadius, targetRadius);

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const angleRoll = rngFloat(state);
    const distanceRoll = rngFloat(angleRoll.state);
    state = distanceRoll.state;

    const angle = angleRoll.value * Math.PI * 2;
    const distance = Math.sqrt(distanceRoll.value) * maxCenterShift;
    const rawCandidate = {
      x: currentCenter.x + Math.cos(angle) * distance,
      y: currentCenter.y + Math.sin(angle) * distance,
    };
    const mapCandidate = normalizeTargetForRadius(clampPositionToMap(rawCandidate, map, targetRadius), map, targetRadius);
    const candidate =
      targetRadius <= 1
        ? mapCandidate
        : constrainTargetInsideParent(currentCenter, currentRadius, mapCandidate, targetRadius);
    if (!isCircleContained(currentCenter, currentRadius, candidate, targetRadius)) {
      continue;
    }
    fallback = candidate;
    if (isWalkableCenter(map, candidate)) {
      return { center: candidate, rngState: state };
    }
  }

  return { center: fallback, rngState: state };
}

function fallbackZoneTarget(
  map: GameMap,
  currentCenter: Position,
  currentRadius: number,
  targetRadius: number,
): Position {
  if (targetRadius <= 1) {
    const contained = nearestContainedWalkableIntegerPosition(map, currentCenter, currentRadius, targetRadius, currentCenter);
    if (contained) {
      return contained;
    }
  }
  const clamped = clampPositionToMap(currentCenter, map, targetRadius);
  const candidate = normalizeTargetForRadius(clamped, map, targetRadius);
  if (isCircleContained(currentCenter, currentRadius, candidate, targetRadius)) {
    return candidate;
  }
  return constrainTargetInsideParent(currentCenter, currentRadius, clamped, targetRadius);
}

function nearestContainedWalkableIntegerPosition(
  map: GameMap,
  parentCenter: Position,
  parentRadius: number,
  targetRadius: number,
  preferred: Position,
): Position | undefined {
  let best: Position | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let y = 1; y < map.height - 1; y += 1) {
    for (let x = 1; x < map.width - 1; x += 1) {
      const candidate = { x, y };
      if (!isWalkableCenter(map, candidate) || !isCircleContained(parentCenter, parentRadius, candidate, targetRadius)) {
        continue;
      }
      const distance = Math.abs(candidate.x - preferred.x) + Math.abs(candidate.y - preferred.y);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function isWalkableCenter(map: GameMap, position: Position): boolean {
  const x = clamp(Math.round(position.x), 0, map.width - 1);
  const y = clamp(Math.round(position.y), 0, map.height - 1);
  return map.cells[y * map.width + x] === "empty";
}

function normalizeTargetForRadius(position: Position, map: GameMap, targetRadius: number): Position {
  if (targetRadius > 1) {
    return position;
  }
  return nearestWalkableIntegerPosition(map, position);
}

function nearestWalkableIntegerPosition(map: GameMap, position: Position): Position {
  const origin = {
    x: clamp(Math.round(position.x), 1, map.width - 2),
    y: clamp(Math.round(position.y), 1, map.height - 2),
  };
  if (isWalkableCenter(map, origin)) {
    return origin;
  }

  let best: Position = origin;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let radius = 1; radius <= 5; radius += 1) {
    for (let y = origin.y - radius; y <= origin.y + radius; y += 1) {
      for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
        const candidate = { x, y };
        if (!isWalkableCenter(map, candidate)) {
          continue;
        }
        const distance = Math.abs(candidate.x - position.x) + Math.abs(candidate.y - position.y);
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }
    }
    if (bestDistance < Number.POSITIVE_INFINITY) {
      return best;
    }
  }

  return best;
}

function constrainTargetInsideParent(
  parentCenter: Position,
  parentRadius: number,
  targetCenter: Position,
  targetRadius: number,
): Position {
  const maxDistance = Math.max(0, parentRadius - targetRadius - 0.05);
  const dx = targetCenter.x - parentCenter.x;
  const dy = targetCenter.y - parentCenter.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance <= maxDistance || distance === 0) {
    return targetCenter;
  }
  const scale = maxDistance / distance;
  return {
    x: parentCenter.x + dx * scale,
    y: parentCenter.y + dy * scale,
  };
}

function isCircleContained(parentCenter: Position, parentRadius: number, childCenter: Position, childRadius: number): boolean {
  const dx = childCenter.x - parentCenter.x;
  const dy = childCenter.y - parentCenter.y;
  return Math.sqrt(dx * dx + dy * dy) + childRadius <= parentRadius + 0.001;
}

function clampPositionToMap(position: Position, map: GameMap, radius: number): Position {
  const maxUsefulMargin = Math.max(2, Math.floor((Math.min(map.width, map.height) - 2) / 2));
  const margin = Math.max(2, Math.min(Math.floor(radius), maxUsefulMargin));
  return {
    x: clamp(Math.round(position.x), margin, Math.max(margin, map.width - 1 - margin)),
    y: clamp(Math.round(position.y), margin, Math.max(margin, map.height - 1 - margin)),
  };
}

function lerpPosition(from: Position, to: Position, progress: number): Position {
  return {
    x: lerp(from.x, to.x, progress),
    y: lerp(from.y, to.y, progress),
  };
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashZoneSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
