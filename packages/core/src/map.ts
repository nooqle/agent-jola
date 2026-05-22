import type { CellType, Direction, GameMap, MapPresetId, Position } from "./types.js";
import { hashSeed, rngFloat } from "./rng.js";

export const DIRECTIONS: Direction[] = ["up", "right", "down", "left"];

export const DIRECTION_DELTAS: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}

export function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

export function movePosition(position: Position, direction: Direction): Position {
  const delta = DIRECTION_DELTAS[direction];
  return {
    x: position.x + delta.x,
    y: position.y + delta.y,
  };
}

export function cellIndex(map: GameMap, position: Position): number {
  return position.y * map.width + position.x;
}

export function inBounds(map: GameMap, position: Position): boolean {
  return position.x >= 0 && position.y >= 0 && position.x < map.width && position.y < map.height;
}

export function getCell(map: GameMap, position: Position): CellType | undefined {
  if (!inBounds(map, position)) {
    return undefined;
  }
  return map.cells[cellIndex(map, position)];
}

export function setCell(map: GameMap, position: Position, cell: CellType): GameMap {
  if (!inBounds(map, position)) {
    return map;
  }
  const cells = [...map.cells];
  cells[cellIndex(map, position)] = cell;
  return {
    ...map,
    cells,
  };
}

export function isWalkableCell(map: GameMap, position: Position): boolean {
  return getCell(map, position) === "empty";
}

export function createEmptyMap(width: number, height: number): GameMap {
  return {
    id: "classic",
    name: "Classic Yard",
    width,
    height,
    cells: Array.from<CellType>({ length: width * height }).fill("empty"),
  };
}

export interface MapPreset {
  id: MapPresetId;
  name: string;
  description: string;
  spawns: Position[];
}

const MAP_WIDTH = 13;
const MAP_HEIGHT = 11;
const ROYALE_WIDTH = 39;
const ROYALE_HEIGHT = 31;
const DEFAULT_SPAWNS: Position[] = [
  { x: 1, y: 1 },
  { x: 11, y: 9 },
  { x: 1, y: 9 },
  { x: 11, y: 1 },
];
const ROYALE_SPAWNS: Position[] = [
  { x: 2, y: 2 },
  { x: 36, y: 28 },
  { x: 2, y: 28 },
  { x: 36, y: 2 },
];

const SAFE_CELLS = new Set([
  "1,1",
  "2,1",
  "3,1",
  "1,2",
  "1,3",
  "11,9",
  "10,9",
  "9,9",
  "11,8",
  "11,7",
  "1,9",
  "2,9",
  "3,9",
  "1,8",
  "1,7",
  "11,1",
  "10,1",
  "9,1",
  "11,2",
  "11,3",
]);

export const MAP_PRESETS: readonly MapPreset[] = [
  {
    id: "classic",
    name: "Classic Yard",
    description: "Balanced soft walls and familiar corner starts.",
    spawns: DEFAULT_SPAWNS,
  },
  {
    id: "open-court",
    name: "Open Court",
    description: "Fewer soft walls, faster contact, more direct duels.",
    spawns: DEFAULT_SPAWNS,
  },
  {
    id: "crossfire",
    name: "Crossfire",
    description: "A clear central cross creates early lane pressure.",
    spawns: DEFAULT_SPAWNS,
  },
  {
    id: "maze",
    name: "Maze",
    description: "Dense destructible cover for slower scouting and traps.",
    spawns: DEFAULT_SPAWNS,
  },
  {
    id: "royale",
    name: "Royale Ruins",
    description: "Large four-agent arena with a shrinking danger zone.",
    spawns: ROYALE_SPAWNS,
  },
];

export function normalizeMapPresetId(mapId: string | undefined): MapPresetId {
  return MAP_PRESETS.some((preset) => preset.id === mapId) ? (mapId as MapPresetId) : "classic";
}

export function getMapPreset(mapId: string | undefined): MapPreset {
  const normalized = normalizeMapPresetId(mapId);
  return MAP_PRESETS.find((preset) => preset.id === normalized) ?? (MAP_PRESETS[0] as MapPreset);
}

export function getMapPresetSpawns(mapId: string | undefined): Position[] {
  return getMapPreset(mapId).spawns.map((spawn) => ({ ...spawn }));
}

export function createMapFromPreset(mapId: string | undefined = "classic", seed = "preset"): GameMap {
  const preset = getMapPreset(mapId);
  const width = preset.id === "royale" ? ROYALE_WIDTH : MAP_WIDTH;
  const height = preset.id === "royale" ? ROYALE_HEIGHT : MAP_HEIGHT;
  const layoutSeed = hashSeed(`${preset.id}:${seed}:layout`);
  const cells: CellType[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const pillar = preset.id === "royale" ? isRoyaleHardCover(x, y) : x % 2 === 0 && y % 2 === 0;
      const spawnSafeCell = isSpawnSafeCell(preset.id, x, y);
      if (border) {
        cells.push("solid");
      } else if (spawnSafeCell) {
        cells.push("empty");
      } else if (pillar) {
        cells.push("solid");
      } else if (shouldPlaceSoftWall(preset.id, x, y, layoutSeed)) {
        cells.push("soft");
      } else {
        cells.push("empty");
      }
    }
  }

  return {
    id: preset.id,
    name: preset.name,
    width,
    height,
    cells,
  };
}

export function createDefaultMap(): GameMap {
  return createMapFromPreset("classic");
}

export function cloneMap(map: GameMap): GameMap {
  return {
    ...map,
    cells: [...map.cells],
  };
}

function shouldPlaceSoftWall(mapId: MapPresetId, x: number, y: number, layoutSeed = 0): boolean {
  if (mapId === "royale") {
    if (isRoyalePermanentLane(x, y)) {
      return false;
    }
    const roll = seededCellRoll(layoutSeed, x, y);
    const sector = (Math.floor(x / 6) + Math.floor(y / 6)) % 3;
    const center = royaleCenter();
    const centerDistance = Math.abs(x - center.x) + Math.abs(y - center.y);
    const density = sector === 0 ? 0.46 : sector === 1 ? 0.39 : 0.32;
    const centerAdjustment = centerDistance < 8 ? -0.1 : centerDistance > 23 ? 0.08 : 0;
    return roll < density + centerAdjustment;
  }
  if (mapId === "open-court") {
    const centralLane = x === 6 || y === 5;
    return !centralLane && (x * 11 + y * 7) % 6 === 0;
  }
  if (mapId === "crossfire") {
    const centralCross = x === 6 || y === 5;
    const outerLoop = x === 1 || x === 11 || y === 1 || y === 9;
    const pressurePocket = x === 3 || x === 9 || y === 3 || y === 7;
    return !centralCross && !outerLoop && pressurePocket && (x * 13 + y * 19) % 4 <= 1;
  }
  if (mapId === "maze") {
    const outerLane = x === 1 || x === 11 || y === 1 || y === 9;
    const centralSpine = x === 6 || y === 5;
    const connector = ((x === 3 || x === 9) && y % 2 === 1) || ((y === 3 || y === 7) && x % 2 === 1);
    return !outerLane && !centralSpine && !connector && (x * 17 + y * 23) % 7 <= 3;
  }
  return (x * 17 + y * 29) % 5 <= 2;
}

function isRoyaleHardCover(x: number, y: number): boolean {
  if (isRoyalePermanentLane(x, y)) {
    return false;
  }
  const center = royaleCenter();
  const innerPillar = x % 4 === 0 && y % 4 === 0;
  const shortWall =
    ((x === center.x - 6 || x === center.x + 6) && y >= center.y - 6 && y <= center.y + 6 && y !== center.y) ||
    ((y === center.y - 5 || y === center.y + 5) && x >= center.x - 7 && x <= center.x + 7 && x !== center.x);
  const outpost =
    (x === Math.floor(ROYALE_WIDTH * 0.21) || x === Math.floor(ROYALE_WIDTH * 0.79)) &&
    (y === Math.floor(ROYALE_HEIGHT * 0.23) || y === Math.floor(ROYALE_HEIGHT * 0.77));
  return innerPillar || shortWall || outpost;
}

function isSpawnSafeCell(mapId: MapPresetId, x: number, y: number): boolean {
  if (mapId !== "royale") {
    return SAFE_CELLS.has(`${x},${y}`);
  }
  return ROYALE_SPAWNS.some((spawn) => Math.abs(spawn.x - x) + Math.abs(spawn.y - y) <= 4);
}

function isRoyalePermanentLane(x: number, y: number): boolean {
  const center = royaleCenter();
  const leftGate = Math.floor(ROYALE_WIDTH * 0.24);
  const rightGate = ROYALE_WIDTH - 1 - leftGate;
  const topLane = Math.floor(ROYALE_HEIGHT * 0.23);
  const bottomLane = ROYALE_HEIGHT - 1 - topLane;
  const centralCross = x === center.x || y === center.y;
  const quadrantGate = (x === leftGate || x === rightGate) && y >= 5 && y <= ROYALE_HEIGHT - 6;
  const longConnector = (y === topLane || y === bottomLane) && x >= 5 && x <= ROYALE_WIDTH - 6;
  const diagonalCut = Math.abs(x - y - (center.x - center.y)) <= 1 || Math.abs(x + y - (center.x + center.y + 3)) <= 1;
  return centralCross || quadrantGate || longConnector || diagonalCut;
}

function seededCellRoll(layoutSeed: number, x: number, y: number): number {
  return rngFloat(hashSeed(`${layoutSeed}:${x}:${y}`)).value;
}

function royaleCenter(): Position {
  return {
    x: Math.floor(ROYALE_WIDTH / 2),
    y: Math.floor(ROYALE_HEIGHT / 2),
  };
}
