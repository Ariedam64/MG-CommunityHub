// src/services/editor/chessBoardRender.ts
//
// Draws a chess position onto the garden: the pieces as decor tile objects, and
// four PIXI.Graphics overlays - the squares, the last move, the move hints and
// the refusal blink. It holds no rules; it is handed a position and mirrors it.
// Piece tinting is its own module, chessBoardTint.ts, and the right-click
// annotations another, chessBoardMarks.ts.
//
// The overlays are created through chessOverlay.ts and ordered by
// OVERLAY_Z_INDEX, which is where the whole stack is written down.

import { createOverlay, removeOverlay, type Overlay } from "./chessOverlay";
import { createSlideController, type SlideStep } from "./chessSlide";
import {
  FARM_TILE_SIZE,
  emptyTile,
  placeDecorTile,
  resolveTileRoot,
} from "./chessBoardTiles";
import {
  OVERLAY_Z_INDEX,
  getLayout,
  setLayout,
  squareCenter,
  squareToTile,
  type RenderConfig,
} from "./chessBoardLayout";
import { ACTIVE_BOARD_KEY, clearTintedBoard, refreshTints } from "./chessBoardTint";
import { dressTile, undressTile } from "./chessPieceSkin";
import {
  BOARD_SIZE,
  type ChessGame,
  type ChessMove,
  type ChessPiece,
  type Square,
} from "./chessRules";

/** Refusal feedback: the square blinks red a few times, then clears. */
const ILLEGAL_FLASH_COLOR = 0xef4444;
const ILLEGAL_FLASH_ALPHA = 0.55;
const ILLEGAL_FLASH_PULSES = 3;
const ILLEGAL_FLASH_DURATION_MS = 660;

/**
 * Move hints, drawn as marks rather than filled squares: a dot in the middle of
 * an empty destination, a ring around a piece that can be taken. Both share one
 * neutral grey - the shape already says which is which, so colour would only
 * add noise over the board's own two tones.
 *
 * Radii and widths are ratios of a tile so the marks scale with it.
 */
const HINT_MARK_COLOR = 0x3f3f46;

const HINT_DOT_ALPHA = 0.26;
const HINT_DOT_RADIUS_RATIO = 0.16;

const HINT_RING_ALPHA = 0.34;
const HINT_RING_RADIUS_RATIO = 0.42;
const HINT_RING_WIDTH_RATIO = 0.075;

const HINT_ORIGIN_COLOR = 0xfacc15;
const HINT_ORIGIN_ALPHA = 0.3;

/** Faint green on the squares the last move joined, so it stays readable after. */
const LAST_MOVE_COLOR = 0x4ade80;
const LAST_MOVE_ALPHA = 0.3;

let boardOverlay: Overlay | null = null;
let hintOverlay: Overlay | null = null;
let lastMoveOverlay: Overlay | null = null;
let flashOverlay: Overlay | null = null;
let flashRaf: number | null = null;

/* -------------------------------------------------------------------------- */
/* Overlays                                                                   */
/* -------------------------------------------------------------------------- */

/** Fills one board square on `gfx`, in world coordinates. */
function fillSquare(
  gfx: any,
  square: Square,
  color: number,
  alpha: number,
): void {
  const { tx, ty } = squareToTile(square);
  gfx
    .rect(tx * FARM_TILE_SIZE, ty * FARM_TILE_SIZE, FARM_TILE_SIZE, FARM_TILE_SIZE)
    .fill({ color, alpha });
}

/** Paints the 64 squares. Returns false when Pixi isn't reachable. */
export function paintBoard(next: RenderConfig): boolean {
  boardOverlay = removeOverlay(boardOverlay);

  const overlay = createOverlay(OVERLAY_Z_INDEX.board);
  if (!overlay) return false;

  // Only once the layer exists: fillSquare projects through the layout, so
  // storing a config we then failed to draw would leave the board half set up.
  setLayout(next);

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      // Rows grow downwards, so the bottom-left square lands dark, like a1.
      const isDark = (col + row) % 2 === 1;
      fillSquare(
        overlay.gfx,
        { col, row },
        isDark ? next.darkColor : next.lightColor,
        next.alpha,
      );
    }
  }

  boardOverlay = overlay;
  return true;
}

/** A quiet move: a dot in the middle of the empty square. */
function drawMoveDot(gfx: any, square: Square): void {
  const centre = squareCenter(square);
  gfx
    .circle(centre.x, centre.y, FARM_TILE_SIZE * HINT_DOT_RADIUS_RATIO)
    .fill({ color: HINT_MARK_COLOR, alpha: HINT_DOT_ALPHA });
}

/**
 * A capture: a ring around the piece. Kept wide enough to sit near the tile
 * edge, since the hint layer renders below the pieces and a centred mark would
 * disappear behind the sprite.
 */
function drawCaptureRing(gfx: any, square: Square): void {
  const centre = squareCenter(square);
  gfx
    .circle(centre.x, centre.y, FARM_TILE_SIZE * HINT_RING_RADIUS_RATIO)
    .stroke({
      width: FARM_TILE_SIZE * HINT_RING_WIDTH_RATIO,
      color: HINT_MARK_COLOR,
      alpha: HINT_RING_ALPHA,
    });
}

/** Marks where the held piece may go, plus the square it came from. */
export function showMoveHints(from: Square, moves: ChessMove[]): void {
  hintOverlay = removeOverlay(hintOverlay);
  if (!getLayout()) return;

  const overlay = createOverlay(OVERLAY_Z_INDEX.hint);
  if (!overlay) return;

  const gfx = overlay.gfx;
  fillSquare(gfx, from, HINT_ORIGIN_COLOR, HINT_ORIGIN_ALPHA);

  // Promotion yields four moves onto the same square; one mark is enough.
  const marked = new Set<string>();
  for (const move of moves) {
    const key = `${move.to.col},${move.to.row}`;
    if (marked.has(key)) continue;
    marked.add(key);

    if (move.captured) drawCaptureRing(gfx, move.to);
    else drawMoveDot(gfx, move.to);
  }

  hintOverlay = overlay;
}

export function clearMoveHints(): void {
  hintOverlay = removeOverlay(hintOverlay);
}

function stopIllegalFlash(): void {
  if (flashRaf != null) {
    cancelAnimationFrame(flashRaf);
    flashRaf = null;
  }
  flashOverlay = removeOverlay(flashOverlay);
}

/** Blinks a square red, to show why a move was refused. */
export function flashIllegalSquare(square: Square): void {
  stopIllegalFlash();
  if (!getLayout()) return;

  const overlay = createOverlay(OVERLAY_Z_INDEX.flash);
  if (!overlay) return;

  const gfx = overlay.gfx;
  fillSquare(gfx, square, ILLEGAL_FLASH_COLOR, ILLEGAL_FLASH_ALPHA);
  gfx.alpha = 0;
  flashOverlay = overlay;

  const startedAt = performance.now();

  const tick = (now: number): void => {
    if (!flashOverlay) return;

    const progress = Math.min(1, (now - startedAt) / ILLEGAL_FLASH_DURATION_MS);

    // |sin| over the duration gives exactly PULSES fade in/out cycles, and
    // lands back on 0 - so the blink ends invisible whatever the frame rate.
    try {
      gfx.alpha = Math.abs(Math.sin(Math.PI * progress * ILLEGAL_FLASH_PULSES));
    } catch {
      stopIllegalFlash();
      return;
    }

    if (progress >= 1) {
      stopIllegalFlash();
      return;
    }
    flashRaf = requestAnimationFrame(tick);
  };

  flashRaf = requestAnimationFrame(tick);
}

/** Tints the two squares the last move joined, so it stays readable afterwards. */
export function showLastMove(from: Square, to: Square): void {
  lastMoveOverlay = removeOverlay(lastMoveOverlay);
  if (!getLayout()) return;

  const overlay = createOverlay(OVERLAY_Z_INDEX.lastMove);
  if (!overlay) return;

  fillSquare(overlay.gfx, from, LAST_MOVE_COLOR, LAST_MOVE_ALPHA);
  fillSquare(overlay.gfx, to, LAST_MOVE_COLOR, LAST_MOVE_ALPHA);

  lastMoveOverlay = overlay;
}

/* -------------------------------------------------------------------------- */
/* Move animation                                                             */
/* -------------------------------------------------------------------------- */

/** One square-to-square trip. A castle needs two: the king and its rook. */
export type { SlideStep } from "./chessSlide";

/**
 * The playable board's own trip. Delegated so that boards drawn for other
 * people's games can each have one of their own.
 */
const slideController = createSlideController(getLayout);

export function animatePieceSlide(steps: SlideStep[], onDone: () => void): void {
  slideController.run(steps, onDone);
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

/** Puts a piece on a square, or empties it when `piece` is null. */
/**
 * Lands any move still in flight, committing it. Call this before replacing the
 * position wholesale (a resync), so the pending commit can never land on top of
 * the freshly written position.
 */
export function settlePendingSlide(): void {
  slideController.settle();
}

export function renderSquare(square: Square, piece: ChessPiece | null): void {
  const config = getLayout();
  if (!config) return;

  const { tx, ty } = squareToTile(square);
  if (!piece) {
    // Before emptying, not after: the image is a child of the tile view, and
    // the view outlives the decor it held.
    undressTile(tx, ty);
    emptyTile(tx, ty);
    return;
  }
  placeDecorTile(tx, ty, config.decorIds[piece.kind]);
  // Dresses the decor we just placed with a real chess piece image. A no-op
  // until the images have loaded, and after a failed load, so the decor stays
  // the fallback rather than the board going empty.
  dressTile(tx, ty, piece);
}

/** Draws every piece of a position, emptying the squares that hold none. */
export function renderPosition(game: ChessGame): void {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      renderSquare({ col, row }, game.board[row][col]);
    }
  }
}

/** Drops every overlay, the running slide, all tints and the stored config. */
export function teardownRender(): void {
  slideController.abort();
  stopIllegalFlash();
  // Only ours: boards being watched elsewhere in the room keep their tint, and
  // keep needing it re-asserted every frame.
  clearTintedBoard(ACTIVE_BOARD_KEY);

  // Every square, while the layout still says which tiles they are - the
  // piece images are children of the tile views, and restoring the garden
  // puts the original objects back without touching what we added to them.
  // Skipping this leaves a whole position floating over the garden.
  if (getLayout()) {
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const { tx, ty } = squareToTile({ col, row });
        undressTile(tx, ty);
      }
    }
  }

  boardOverlay = removeOverlay(boardOverlay);
  hintOverlay = removeOverlay(hintOverlay);
  lastMoveOverlay = removeOverlay(lastMoveOverlay);
  setLayout(null);
}

export { refreshTints };
export { squareToTile, tileToSquare, type RenderConfig } from "./chessBoardLayout";
