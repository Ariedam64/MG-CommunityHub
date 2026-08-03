// src/services/editor/chessBoardTiles.ts
//
// Tile-level plumbing for the chess board: locating the player's garden,
// reading/writing tile views, and remembering what each touched tile held so
// the board can be undone. Nothing here writes to the game state, the inventory
// or the WebSocket - tile objects are pushed straight onto the tile views the
// way the editor paints its planned garden.

import { Atoms } from "@/store/atoms";
import { ensureStore, getAtomByLabel } from "@/store/jotai";
import { tos } from "@/game/tileObjectSystem";

/** World size of one farm tile, in worldContainer local pixels. */
export const FARM_TILE_SIZE = 256;

export type OwnGarden = {
  tiles: Array<{ tx: number; ty: number }>;
  originX: number;
  originY: number;
  cols: number;
  rows: number;
};

type TouchedTile = {
  tx: number;
  ty: number;
  previous: any;
};

/** Every tile we changed, keyed "tx,ty", holding the object it had before. */
const touchedTiles = new Map<string, TouchedTile>();

function tileKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

/** Reads the player's own garden slot index (same lookup the editor uses). */
async function readUserSlotIdx(): Promise<number> {
  try {
    const store = await ensureStore().catch(() => null);
    const atom = store ? getAtomByLabel("myUserSlotIdxAtom") : null;
    const raw = atom ? store?.get(atom) : null;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  } catch {
    /* ignore */
  }
  return 0;
}

/**
 * The player's own dirt tiles in map coords, plus the bounding box they form.
 * The garden is a contiguous rectangle, so its min x/y is its top-left corner -
 * no hardcoded map layout needed.
 */
export async function readOwnGarden(): Promise<OwnGarden | null> {
  const [mapData, userSlotIdx] = await Promise.all([
    Atoms.root.map.get().catch(() => null),
    readUserSlotIdx(),
  ]);

  const cols = Number((mapData as any)?.cols);
  if (!mapData || !Number.isFinite(cols) || cols <= 0) return null;

  const dirtTiles = (mapData as any)?.globalTileIdxToDirtTile || {};
  const tiles: Array<{ tx: number; ty: number }> = [];

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [gidxStr, info] of Object.entries(dirtTiles)) {
    if (!info || typeof info !== "object") continue;
    if (Number((info as any).userSlotIdx) !== userSlotIdx) continue;

    const gidx = Number(gidxStr);
    if (!Number.isFinite(gidx)) continue;

    const tx = gidx % cols;
    const ty = Math.floor(gidx / cols);
    tiles.push({ tx, ty });

    if (tx < minX) minX = tx;
    if (ty < minY) minY = ty;
    if (tx > maxX) maxX = tx;
    if (ty > maxY) maxY = ty;
  }

  if (!tiles.length) return null;

  return {
    tiles,
    originX: minX,
    originY: minY,
    cols: maxX - minX + 1,
    rows: maxY - minY + 1,
  };
}

/**
 * The display container holding a tile's own sprites, or null.
 *
 * `ensureView` matters more than it looks: the game drops and rebuilds a tile's
 * view on its own (the avatar stepping onto it, culling, a server update), and
 * a lookup that refuses to recreate one silently returns null for exactly the
 * tiles that just lost their styling.
 */
export function resolveTileRoot(
  tx: number,
  ty: number,
  ensureView = true,
): any {
  try {
    const tileView = (tos.getTileObject(tx, ty, { ensureView }) as any)
      ?.tileView;
    if (!tileView) return null;
    return (
      tileView.displayObject || tileView.root || tileView.container || tileView
    );
  } catch {
    return null;
  }
}

/** Remembers a tile's current object once, before we overwrite it. */
function rememberTile(tx: number, ty: number, previous: any): void {
  const key = tileKey(tx, ty);
  if (touchedTiles.has(key)) return;
  touchedTiles.set(key, { tx, ty, previous });
}

/** Empties a tile view and returns whether it worked. */
export function emptyTile(tx: number, ty: number): boolean {
  try {
    const result = tos.setTileEmpty(tx, ty, {
      ensureView: true,
      forceUpdate: true,
    });
    rememberTile(tx, ty, result.before);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pushes a decor tile object onto a tile view and forces a redraw, the same way
 * the editor paints its planned garden onto Pixi.
 */
export function placeDecorTile(tx: number, ty: number, decorId: string): boolean {
  try {
    const info = tos.getTileObject(tx, ty, { ensureView: true });
    const tileView = (info as any)?.tileView;
    if (!tileView || typeof tileView.onDataChanged !== "function") return false;

    rememberTile(tx, ty, info.tileObject);

    tileView.onDataChanged({ objectType: "decor", decorId, rotation: 0 });
    tos.setTileDecor(
      tx,
      ty,
      { rotation: 0 },
      { ensureView: true, forceUpdate: true },
    );
    return true;
  } catch {
    return false;
  }
}

export function hasTouchedTiles(): boolean {
  return touchedTiles.size > 0;
}

/** Puts a tile view back to whatever object it held before we touched it. */
function restoreTile(tile: TouchedTile): void {
  try {
    const info = tos.getTileObject(tile.tx, tile.ty, { ensureView: true });
    const tileView = (info as any)?.tileView;
    if (!tileView || typeof tileView.onDataChanged !== "function") return;

    tileView.onDataChanged(tile.previous ?? null);

    const ctx = (tos.getStatus().engine as any)?.reusableContext;
    if (ctx && typeof tileView.update === "function") tileView.update(ctx);
  } catch {
    /* ignore */
  }
}

/** Restores every tile we ever touched and forgets them. */
export function restoreAllTiles(): void {
  const tiles = [...touchedTiles.values()];
  touchedTiles.clear();
  for (const tile of tiles) restoreTile(tile);
}
