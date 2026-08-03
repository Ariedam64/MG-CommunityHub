// src/services/editor/chessBoardTint.ts
//
// Darkens the black side's pieces. The white side is left alone: Pixi's tint
// multiplies, so it can darken a sprite but never brighten one.
//
// Two things here are less obvious than they look, and both were bugs first.
//
// The tint goes on the *sprites*, never on the tile's container. The game moves
// a decor sprite out of that container when the avatar walks behind it, to draw
// it above the player - and a tint held by the container simply stops applying
// the moment the sprite leaves, while still reading back correctly.
//
// And it is re-asserted every frame from the game's own ticker, because the
// game rewrites these sprites itself; anything slower loses the race.

import { tos } from "@/game/tileObjectSystem";
import { resolveTileRoot } from "./chessBoardTiles";
import { getLayout, squareToTile } from "./chessBoardLayout";
import { BOARD_SIZE, type ChessGame } from "./chessRules";

/** Original tint of every node we recoloured, so clearing can undo it. */
const tintBaselines = new Map<any, number>();

/** Position the tint loop keeps asserting, kept in step with the last refresh. */
let tintedGame: ChessGame | null = null;

let tintFrame: number | null = null;
let tintTicker: (() => void) | null = null;

/**
 * Whether a node exposes a Pixi tint. Guarded: reading a property off a
 * destroyed display object can throw, and one stale node in a tile's subtree
 * would otherwise take the whole re-tint pass down with it.
 */
function hasTint(node: any): boolean {
  try {
    return typeof node?.tint === "number";
  } catch {
    return false;
  }
}

/** A node that actually draws pixels, as opposed to a grouping container. */
function isDrawable(node: any): boolean {
  try {
    return typeof node?.tint === "number" && node.texture != null;
  } catch {
    return false;
  }
}

/**
 * The outermost drawable nodes under `root` - the sprites themselves, not the
 * containers holding them. Once one is taken its subtree is skipped: Pixi v8
 * inherits tint down the tree and multiplies at each level, so tinting a sprite
 * *and* its parent would square the colour and turn the piece black.
 */
function collectTintTargets(root: any, cap = 900): any[] {
  const out: any[] = [];
  const stack = [root];

  while (stack.length && out.length < cap) {
    const node = stack.pop();
    if (!node) continue;

    if (isDrawable(node)) {
      out.push(node);
      continue;
    }

    let children: unknown;
    try {
      children = node.children;
    } catch {
      continue;
    }
    if (Array.isArray(children)) for (const child of children) stack.push(child);
  }

  // Nothing textured under this tile: fall back to the container, which at
  // least tints a tree that draws without sprites.
  if (!out.length && hasTint(root)) out.push(root);

  return out;
}

/**
 * Idempotent: a baseline is captured the first time a node is seen and the tint
 * is assigned, never accumulated, so running this every frame cannot darken
 * anything twice.
 */
function applyTints(game: ChessGame): void {
  const config = getLayout();
  if (!config?.tintPieces) return;

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const piece = game.board[row][col];
      if (piece?.side !== "black") continue;

      const { tx, ty } = squareToTile({ col, row });
      const root = resolveTileRoot(tx, ty);
      if (!root) continue;

      for (const node of collectTintTargets(root)) {
        if (!tintBaselines.has(node)) tintBaselines.set(node, node.tint);
        try {
          node.tint = config.blackTint;
        } catch {
          /* ignore */
        }
      }
    }
  }
}

function retintOnce(): void {
  if (!tintedGame) return;
  try {
    applyTints(tintedGame);
  } catch {
    /* ignore */
  }
}

/**
 * Joins the game's Pixi ticker. Pixi schedules its own render at
 * UPDATE_PRIORITY.LOW, so a callback added at the default priority always runs
 * after the game's update and before the frame is drawn - a plain
 * requestAnimationFrame is registered after the game's and can still be
 * overwritten within the frame. It stays as a fallback if the ticker is
 * unreachable.
 */
function startTintLoop(): void {
  if (tintTicker || tintFrame != null) return;

  const ticker = (tos.getStatus().engine as any)?.app?.ticker;
  if (typeof ticker?.add === "function") {
    tintTicker = retintOnce;
    ticker.add(tintTicker);
    return;
  }

  const tick = (): void => {
    // Queued before the work, so a throw can never kill the loop.
    tintFrame = requestAnimationFrame(tick);
    retintOnce();
  };
  tintFrame = requestAnimationFrame(tick);
}

function stopTintLoop(): void {
  if (tintTicker) {
    try {
      (tos.getStatus().engine as any)?.app?.ticker?.remove?.(tintTicker);
    } catch {
      /* ignore */
    }
    tintTicker = null;
  }
  if (tintFrame != null) {
    cancelAnimationFrame(tintFrame);
    tintFrame = null;
  }
}

/** Gives every tinted node its own tint back and forgets the baselines. */
function releaseTints(): void {
  for (const [node, tint] of tintBaselines) {
    try {
      node.tint = tint;
    } catch {
      /* ignore */
    }
  }
  tintBaselines.clear();
}

/**
 * Points the tint loop at a position. Tints are released first: vacated tiles
 * have their sprite nodes recycled by the tile system, and a stale tint left on
 * one would darken whatever object lands there next.
 */
export function refreshTints(game: ChessGame): void {
  releaseTints();
  tintedGame = game;
  applyTints(game);
  startTintLoop();
}

/** Stops the loop and restores every sprite we touched. */
export function teardownTints(): void {
  stopTintLoop();
  tintedGame = null;
  releaseTints();
}
