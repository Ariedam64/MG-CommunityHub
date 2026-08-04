// src/game/chess/chessScenery.ts
//
// The setting the board is played in: a bench-and-lamppost frame around the
// 8x8, and a decorated gallery filling the rest of the garden.
//
// This is purely visual, like everything else the board draws. The tile objects
// are pushed onto the tile views only, never to the game state, the inventory or
// the WebSocket, and chessBoardTiles' restore registry puts the real garden back
// when the board comes down.
//
// The layout was captured from a garden built by hand and is kept here as a
// grid rather than as the raw export: the export is 2200 lines, 95% of it the
// same eight Camellia slots repeated 24 times.

import { decorCatalog, plantCatalog } from "@/data";
import {
  ACTIVE_TILE_OWNER,
  placeTileObject,
  readTileObject,
  type OwnGarden,
} from "./chessBoardTiles";

/** Width and height the layout was drawn for. */
const SCENERY_COLS = 20;
const SCENERY_ROWS = 10;

/**
 * One character per plantable tile, '.' meaning "leave it empty".
 *
 * These are garden-local columns, not map columns. The garden is two 10x10
 * blocks with a strip of unplantable ground between them, so column 10 here is
 * the first column of the right-hand block, not the gap. Reading these as map
 * offsets would slide the whole gallery one column left, onto it.
 *
 * The empty 8x8 at columns 1-8, rows 1-8 is the board itself: the frame is
 * drawn around it and the pieces land inside. That is the same inset chessBoard
 * uses to place the grid, so the two agree by construction.
 */
const SCENERY_GRID: readonly string[] = [
  "abbbbbbbbcdddddddddd",
  "e........fgggggggggd",
  "e........fhi.i.i.ijd",
  "e........fhi.i.i.ijk",
  "e........fhi.i.i.i.g",
  "e........fhi.i.i.i.l",
  "e........fhi.i.i.ijm",
  "e........fhi.i.i.ijd",
  "e........fllllllllld",
  "annnnnnnnadddddddddd",
];

type SceneryPiece =
  | { kind: "decor"; decorId: string; rotation: number }
  | { kind: "plant"; species: string };

const SCENERY_LEGEND: Record<string, SceneryPiece> = {
  a: { kind: "decor", decorId: "WoodLampPost", rotation: 180 },
  b: { kind: "decor", decorId: "WoodBench", rotation: 0 },
  c: { kind: "decor", decorId: "WoodLampPost", rotation: 90 },
  d: { kind: "plant", species: "Camellia" },
  e: { kind: "decor", decorId: "WoodBench", rotation: 270 },
  f: { kind: "decor", decorId: "WoodBench", rotation: 90 },
  g: { kind: "decor", decorId: "ColoredStringLights", rotation: 0 },
  h: { kind: "decor", decorId: "StringLights", rotation: 270 },
  i: { kind: "decor", decorId: "MarbleBench", rotation: 90 },
  j: { kind: "decor", decorId: "ColoredStringLights", rotation: 90 },
  k: { kind: "decor", decorId: "MarbleKnight", rotation: 180 },
  l: { kind: "decor", decorId: "ColoredStringLights", rotation: 180 },
  m: { kind: "decor", decorId: "MarbleKnight", rotation: 90 },
  n: { kind: "decor", decorId: "WoodBench", rotation: 180 },
};

/**
 * Plant timings, as offsets from the moment the scenery is laid down rather
 * than the absolute timestamps of the capture. Every one of the 24 plants in
 * the original shares these exactly.
 *
 * Anchoring on "now" is what keeps them looking freshly grown: absolute
 * timestamps from the day of the capture would put the whole gallery months
 * into the past, and the fruit timers with it.
 */
const PLANT_GROWTH_MS = 86_400_000;
const PLANT_SLOT_COUNT = 8;
const PLANT_SLOT_START_OFFSET_MS = 450_000;
const PLANT_SLOT_END_OFFSET_MS = 2_020_059;

function buildTileObject(piece: SceneryPiece, now: number): unknown {
  if (piece.kind === "decor") {
    return { objectType: "decor", decorId: piece.decorId, rotation: piece.rotation };
  }

  return {
    objectType: "plant",
    species: piece.species,
    plantedAt: now - PLANT_GROWTH_MS,
    maturedAt: now,
    slots: Array.from({ length: PLANT_SLOT_COUNT }, (_unused, slotId) => ({
      species: piece.species,
      startTime: now + PLANT_SLOT_START_OFFSET_MS,
      endTime: now + PLANT_SLOT_END_OFFSET_MS,
      targetScale: 1,
      mutations: [],
      slotId,
    })),
  };
}

/**
 * Warns once about ids the game does not know. The catalogs are live game data,
 * so a decor or species used here can be renamed or retired out from under us —
 * the tile then renders empty, and this says why.
 */
function warnAboutUnknownScenery(): void {
  const unknown: string[] = [];

  for (const piece of Object.values(SCENERY_LEGEND)) {
    if (piece.kind === "decor") {
      if (!(piece.decorId in decorCatalog)) unknown.push(piece.decorId);
    } else if (!(piece.species in plantCatalog)) {
      unknown.push(piece.species);
    }
  }

  if (unknown.length) {
    console.log("[ChessScenery] id(s) unknown to MGData, those tiles stay empty:", unknown);
  }
}

let warned = false;

/**
 * The layout, flattened to the garden-local tile indices it was captured
 * against: index = row * SCENERY_COLS + col, which is how the game numbers a
 * garden's own tiles and how a garden export is keyed.
 *
 * Going through that index rather than through map coordinates is what makes
 * the unplantable strip between the two halves a non-issue: the game's own
 * numbering already skips it, so nothing here has to know it exists.
 */
function sceneryByDirtIndex(): Map<number, SceneryPiece> {
  const byIndex = new Map<number, SceneryPiece>();

  for (let row = 0; row < SCENERY_ROWS; row++) {
    const line = SCENERY_GRID[row] ?? "";
    for (let col = 0; col < SCENERY_COLS; col++) {
      const symbol = line[col];
      if (!symbol || symbol === ".") continue;

      const piece = SCENERY_LEGEND[symbol];
      if (piece) byIndex.set(row * SCENERY_COLS + col, piece);
    }
  }

  return byIndex;
}

const SCENERY_BY_DIRT_INDEX = sceneryByDirtIndex();

/**
 * Lays the scenery over the garden. Tiles the layout says nothing about are
 * left as they are — which, after the clearing pass, means empty.
 *
 * Returns how many tiles were written.
 */
export function applyChessScenery(
  garden: OwnGarden,
  owner: string = ACTIVE_TILE_OWNER,
  options: { onlyIfChanged?: boolean } = {},
): number {
  if (!warned) {
    warned = true;
    warnAboutUnknownScenery();
  }

  const now = Date.now();
  let placed = 0;

  for (const tile of garden.tiles) {
    const piece = SCENERY_BY_DIRT_INDEX.get(tile.dirtIdx);
    if (!piece) continue;

    // A re-assert pass only rewrites what the game has taken back, so a garden
    // nobody is touching costs reads and no writes.
    if (options.onlyIfChanged && sceneryStillThere(tile.tx, tile.ty, piece)) continue;

    if (placeTileObject(tile.tx, tile.ty, buildTileObject(piece, now), owner)) placed++;
  }

  return placed;
}

/** Whether the tile still shows the scenery we put there. */
function sceneryStillThere(tx: number, ty: number, piece: SceneryPiece): boolean {
  const current = readTileObject(tx, ty);
  if (!current) return false;

  if (piece.kind === "decor") {
    return current.objectType === "decor" && current.decorId === piece.decorId;
  }
  return current.objectType === "plant" && current.species === piece.species;
}
