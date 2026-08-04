// src/game/chess/chessBoardMarks.ts
//
// Right-click annotations: a right click marks a square red, a right drag from
// one square to another draws a yellow arrow, and any left click on the board
// wipes the lot. Drawing the same mark twice removes it, so a right click is
// always its own undo.
//
// Nothing is drawn while the button is held: the arrow appears whole, on the
// release, once its destination is settled.
//
// These are private scribbles - nothing here reads the position, the rules or
// the network, the opponent never sees them, and they survive the opponent's
// move. They are stored as board squares rather than map tiles, so they follow
// the board when it is turned round for Black.
//
// Two layers, because they belong at different depths: the squares sit under
// the pieces like the rest of the board's tinting, the arrows above them.

import { createOverlay, removeOverlay, type Overlay } from "./chessOverlay";
import { FARM_TILE_SIZE } from "./chessBoardTiles";
import { OVERLAY_Z_INDEX, getLayout, squareCenter, squareToTile } from "./chessBoardLayout";
import { arrowOutline } from "./chessMarkShapes";
import type { Square } from "./chessRules";

/**
 * Laid over the board rather than covering it, so the checkerboard still shows
 * through. A marked square therefore comes out a slightly different red on a
 * light square than on a dark one - which is also what keeps two marked
 * squares side by side from reading as one block.
 */
const SQUARE_COLOR = 0xef4444;
const SQUARE_ALPHA = 0.5;

/** Yellow, so an arrow never reads as one of the red squares it crosses. */
const ARROW_COLOR = 0xfacc15;
const ARROW_ALPHA = 0.8;

type Arrow = { from: Square; to: Square };

/** Marked squares and arrows, keyed so the same one can't be added twice. */
const markedSquares = new Map<string, Square>();
const markedArrows = new Map<string, Arrow>();

let squareOverlay: Overlay | null = null;
let arrowOverlay: Overlay | null = null;

function squareKey(square: Square): string {
  return `${square.col},${square.row}`;
}

function arrowKey(from: Square, to: Square): string {
  return `${squareKey(from)}>${squareKey(to)}`;
}

/* -------------------------------------------------------------------------- */
/* Drawing                                                                    */
/* -------------------------------------------------------------------------- */

function drawSquares(): void {
  squareOverlay = removeOverlay(squareOverlay);
  if (!markedSquares.size) return;

  const overlay = createOverlay(OVERLAY_Z_INDEX.mark);
  if (!overlay) return;

  for (const square of markedSquares.values()) {
    const { tx, ty } = squareToTile(square);
    overlay.gfx
      .rect(tx * FARM_TILE_SIZE, ty * FARM_TILE_SIZE, FARM_TILE_SIZE, FARM_TILE_SIZE)
      .fill({ color: SQUARE_COLOR, alpha: SQUARE_ALPHA });
  }

  squareOverlay = overlay;
}

function drawArrow(gfx: any, arrow: Arrow): void {
  const outline = arrowOutline(
    squareCenter(arrow.from),
    squareCenter(arrow.to),
    FARM_TILE_SIZE,
  );
  if (!outline) return;
  gfx.poly(outline).fill({ color: ARROW_COLOR, alpha: ARROW_ALPHA });
}

function drawArrows(): void {
  arrowOverlay = removeOverlay(arrowOverlay);
  if (!markedArrows.size) return;

  const overlay = createOverlay(OVERLAY_Z_INDEX.arrow);
  if (!overlay) return;

  for (const arrow of markedArrows.values()) drawArrow(overlay.gfx, arrow);

  arrowOverlay = overlay;
}

/** Rebuilds both layers. Cheap: a handful of shapes, only on a real change. */
function redraw(): void {
  if (!getLayout()) return;
  drawSquares();
  drawArrows();
}

/* -------------------------------------------------------------------------- */
/* Marks                                                                      */
/* -------------------------------------------------------------------------- */

/** Adds the red square, or removes it when it was already marked. */
export function toggleMarkedSquare(square: Square): void {
  const key = squareKey(square);
  if (!markedSquares.delete(key)) markedSquares.set(key, square);
  redraw();
}

/** Adds the arrow, or removes it when that exact arrow was already drawn. */
export function toggleMarkedArrow(from: Square, to: Square): void {
  const key = arrowKey(from, to);
  if (!markedArrows.delete(key)) markedArrows.set(key, { from, to });
  redraw();
}

export function hasMarks(): boolean {
  return markedSquares.size > 0 || markedArrows.size > 0;
}

function dropEverything(): void {
  markedSquares.clear();
  markedArrows.clear();

  squareOverlay = removeOverlay(squareOverlay);
  arrowOverlay = removeOverlay(arrowOverlay);
}

/**
 * Wipes every annotation - what a left click on the board does. A no-op when
 * there was none, since that click happens on every single move.
 */
export function clearMarks(): void {
  if (!hasMarks()) return;
  dropEverything();
}

/** Drops the annotations and their layers, for when the board goes away. */
export function teardownMarks(): void {
  dropEverything();
}
