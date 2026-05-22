export function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function nextRngState(state: number): number {
  let next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

export function rngFloat(state: number): { value: number; state: number } {
  const next = nextRngState(state);
  return {
    value: next / 4294967296,
    state: next,
  };
}

export function rngInt(state: number, minInclusive: number, maxExclusive: number): { value: number; state: number } {
  const roll = rngFloat(state);
  const span = Math.max(1, maxExclusive - minInclusive);
  return {
    value: minInclusive + Math.floor(roll.value * span),
    state: roll.state,
  };
}

export function chooseSeeded<T>(state: number, values: readonly T[]): { value: T; state: number } {
  if (values.length === 0) {
    throw new Error("chooseSeeded requires at least one value");
  }
  const roll = rngInt(state, 0, values.length);
  return {
    value: values[roll.value] as T,
    state: roll.state,
  };
}
