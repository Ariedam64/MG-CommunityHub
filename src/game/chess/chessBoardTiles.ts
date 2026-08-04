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

export type GardenTile = {
  tx: number;
  ty: number;
  /**
   * The tile's index within its own garden, as the game numbers them. This is
   * what a garden export is keyed by, and it steps over the unplantable strip
   * between the two halves on its own — unlike anything derived from tx/ty.
   */
  dirtIdx: number;
};

export type OwnGarden = {
  tiles: GardenTile[];
  originX: number;
  originY: number;
  cols: number;
  rows: number;
};

type TouchedTile = {
  tx: number;
  ty: number;
  previous: any;
  /**
   * Which board wrote here. Boards come and go independently - a neighbour's
   * game can end while yours carries on - so restoring has to be able to undo
   * one of them without touching the others.
   */
  owner: string;
};

/** The board you are playing or watching, as opposed to a neighbour's. */
export const ACTIVE_TILE_OWNER = "active";

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
 * The playerId sitting in each garden slot, indexed by slot.
 *
 * Slots come back either as an array or as an object keyed by index, so the
 * object form is sorted numerically first - the position *is* the slot index,
 * and getting it wrong would paint the board on a stranger's garden.
 */
async function readSlotPlayerIds(): Promise<(string | null)[]> {
  try {
    const state = (await Atoms.root.state.get().catch(() => null)) as any;
    const raw =
      state?.child?.data?.userSlots ??
      state?.fullState?.child?.data?.userSlots ??
      state?.data?.userSlots;

    const slots: any[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object"
        ? Object.entries(raw as Record<string, any>)
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([, value]) => value)
        : [];

    return slots.map((slot) => {
      const data = slot?.data ?? slot;
      const id = data?.databaseUserId ?? data?.playerId ?? slot?.databaseUserId ?? slot?.playerId;
      return id == null ? null : String(id);
    });
  } catch {
    return [];
  }
}

/**
 * The playerId in each garden slot, for diagnostics. The slot lookup failing is
 * silent by nature - a board simply never appears - so this is what says whether
 * the ids we are matching against are the ones we expect.
 */
export async function readSlotPlayerIdsForDebug(): Promise<(string | null)[]> {
  return readSlotPlayerIds();
}

/** The garden slot a player occupies in this room, or null if they are not here. */
export async function findUserSlotIdx(playerId: string): Promise<number | null> {
  if (!playerId) return null;
  const ids = await readSlotPlayerIds();
  const index = ids.indexOf(String(playerId));
  return index >= 0 ? index : null;
}

/** The player's own garden. */
export async function readOwnGarden(): Promise<OwnGarden | null> {
  return readGarden(await readUserSlotIdx());
}

/**
 * A garden slot's dirt tiles in map coords, plus the bounding box they form.
 * The garden is a contiguous rectangle, so its min x/y is its top-left corner -
 * no hardcoded map layout needed.
 */
export async function readGarden(userSlotIdx: number): Promise<OwnGarden | null> {
  const mapData = await Atoms.root.map.get().catch(() => null);

  const cols = Number((mapData as any)?.cols);
  if (!mapData || !Number.isFinite(cols) || cols <= 0) return null;

  const dirtTiles = (mapData as any)?.globalTileIdxToDirtTile || {};
  const tiles: GardenTile[] = [];

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
    tiles.push({ tx, ty, dirtIdx: Number((info as any).dirtTileIdx ?? -1) });

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

/**
 * Remembers a tile's current object once, before we overwrite it. Written once
 * on purpose: the first value seen is the real garden, anything after it is
 * something a board already put there.
 */
function rememberTile(tx: number, ty: number, previous: any, owner: string): void {
  const key = tileKey(tx, ty);
  if (touchedTiles.has(key)) return;
  touchedTiles.set(key, { tx, ty, previous, owner });
}

/** Empties a tile view and returns whether it worked. */
export function emptyTile(tx: number, ty: number, owner = ACTIVE_TILE_OWNER): boolean {
  try {
    const result = tos.setTileEmpty(tx, ty, {
      ensureView: true,
      forceUpdate: true,
    });
    rememberTile(tx, ty, result.before, owner);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pushes any tile object onto a tile view and forces a redraw, the same way the
 * editor paints its planned garden onto Pixi.
 *
 * The redraw goes through the view's own update rather than one of the typed
 * tos.setTileX helpers: those assert the tile already holds that type, which is
 * false by definition here — we are replacing whatever was there.
 */
export function placeTileObject(
  tx: number,
  ty: number,
  object: unknown,
  owner = ACTIVE_TILE_OWNER,
): boolean {
  try {
    const info = tos.getTileObject(tx, ty, { ensureView: true });
    const tileView = (info as any)?.tileView;
    if (!tileView || typeof tileView.onDataChanged !== "function") return false;

    rememberTile(tx, ty, info.tileObject, owner);

    tileView.onDataChanged(object);

    const ctx = (tos.getStatus().engine as any)?.reusableContext;
    if (ctx && typeof tileView.update === "function") tileView.update(ctx);

    return true;
  } catch {
    return false;
  }
}

/** Pieces are decor sprites, dropped upright. */
export function placeDecorTile(
  tx: number,
  ty: number,
  decorId: string,
  owner = ACTIVE_TILE_OWNER,
): boolean {
  return placeTileObject(tx, ty, { objectType: "decor", decorId, rotation: 0 }, owner);
}

/** What a tile holds right now, for deciding whether it still needs rewriting. */
export function readTileObject(tx: number, ty: number): any {
  try {
    return (tos.getTileObject(tx, ty, { ensureView: false }) as any)?.tileObject ?? null;
  } catch {
    return null;
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

/** Restores only what one board wrote, leaving the others alone. */
export function restoreTilesOf(owner: string): void {
  const mine: TouchedTile[] = [];

  for (const [key, tile] of [...touchedTiles]) {
    if (tile.owner !== owner) continue;
    mine.push(tile);
    touchedTiles.delete(key);
  }

  for (const tile of mine) restoreTile(tile);
}
