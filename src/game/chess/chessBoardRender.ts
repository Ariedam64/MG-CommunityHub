// src/services/editor/chessBoardRender.ts
//
// Draws a chess position onto the garden: the pieces as decor tile objects, and
// four PIXI.Graphics overlays - the squares, the last move, the move hints and
// the refusal blink. It holds no rules; it is handed a position and mirrors it.
// Piece tinting is its own module, chessBoardTint.ts.
//
// The overlays live in the tile system's worldContainer, which the game builds
// with `sortableChildren: true`; zIndex is what orders them there. They all sit
// below every tile object so the pieces stay on top, stacked in that order, and
// the terrain is unaffected since it lives in a separate groundContainer.

import { tos } from "@/game/tileObjectSystem";
import { findGraphicsCtor } from "@/game/pixiGraphics";
import {
  FARM_TILE_SIZE,
  emptyTile,
  placeDecorTile,
  resolveTileRoot,
} from "./chessBoardTiles";
import {
  getLayout,
  setLayout,
  squareToTile,
  type RenderConfig,
} from "./chessBoardLayout";
import { refreshTints, teardownTints } from "./chessBoardTint";
import {
  BOARD_SIZE,
  type ChessGame,
  type ChessMove,
  type ChessPiece,
  type Square,
} from "./chessRules";

const BOARD_Z_INDEX = -999999;
const LAST_MOVE_Z_INDEX = BOARD_Z_INDEX + 1;
const HINT_Z_INDEX = BOARD_Z_INDEX + 2;
const FLASH_Z_INDEX = BOARD_Z_INDEX + 3;

/** Refusal feedback: the square blinks red a few times, then clears. */
const ILLEGAL_FLASH_COLOR = 0xef4444;
const ILLEGAL_FLASH_ALPHA = 0.55;
const ILLEGAL_FLASH_PULSES = 3;
const ILLEGAL_FLASH_DURATION_MS = 660;

/** A piece in flight has to clear the pieces it passes over. */
const SLIDE_Z_INDEX = 999998;

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

/** Slide of a piece moved by clicking. Short enough not to delay the next move. */
const SLIDE_DURATION_MS = 200;

type Overlay = { gfx: any; parent: any };

type SlidePart = {
  root: any;
  baseX: number;
  baseY: number;
  baseZIndex: number;
  deltaX: number;
  deltaY: number;
};

type SlideState = {
  raf: number;
  parts: SlidePart[];
  onDone: () => void;
};

let boardOverlay: Overlay | null = null;
let hintOverlay: Overlay | null = null;
let lastMoveOverlay: Overlay | null = null;
let flashOverlay: Overlay | null = null;
let slide: SlideState | null = null;
let flashRaf: number | null = null;

/* -------------------------------------------------------------------------- */
/* Overlays                                                                   */
/* -------------------------------------------------------------------------- */

function getWorldContainer(): any {
  return (tos.getStatus().tos as any)?.worldContainer ?? null;
}

function resolveGraphicsCtor(): any {
  const stage = (tos.getStatus().engine as any)?.app?.stage;
  return findGraphicsCtor(stage);
}

function removeOverlay(overlay: Overlay | null): null {
  if (!overlay) return null;
  try {
    overlay.parent?.removeChild?.(overlay.gfx);
  } catch {
    /* ignore */
  }
  try {
    overlay.gfx?.destroy?.();
  } catch {
    /* ignore */
  }
  return null;
}

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
  const worldContainer = getWorldContainer();
  const Graphics = resolveGraphicsCtor();
  if (!worldContainer?.addChild || !Graphics) return false;

  setLayout(next);
  boardOverlay = removeOverlay(boardOverlay);

  const gfx = new Graphics();
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      // Rows grow downwards, so the bottom-left square lands dark, like a1.
      const isDark = (col + row) % 2 === 1;
      fillSquare(
        gfx,
        { col, row },
        isDark ? next.darkColor : next.lightColor,
        next.alpha,
      );
    }
  }

  gfx.zIndex = BOARD_Z_INDEX;
  worldContainer.addChild(gfx);
  boardOverlay = { gfx, parent: worldContainer };
  return true;
}

/** Centre of a board square, in world coordinates. */
function squareCenter(square: Square): { x: number; y: number } {
  const { tx, ty } = squareToTile(square);
  return {
    x: (tx + 0.5) * FARM_TILE_SIZE,
    y: (ty + 0.5) * FARM_TILE_SIZE,
  };
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
  const worldContainer = getWorldContainer();
  const Graphics = resolveGraphicsCtor();
  if (!worldContainer?.addChild || !Graphics || !getLayout()) return;

  hintOverlay = removeOverlay(hintOverlay);

  const gfx = new Graphics();
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

  gfx.zIndex = HINT_Z_INDEX;
  worldContainer.addChild(gfx);
  hintOverlay = { gfx, parent: worldContainer };
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

  const worldContainer = getWorldContainer();
  const Graphics = resolveGraphicsCtor();
  if (!worldContainer?.addChild || !Graphics || !getLayout()) return;

  const gfx = new Graphics();
  fillSquare(gfx, square, ILLEGAL_FLASH_COLOR, ILLEGAL_FLASH_ALPHA);
  gfx.zIndex = FLASH_Z_INDEX;
  gfx.alpha = 0;
  worldContainer.addChild(gfx);
  flashOverlay = { gfx, parent: worldContainer };

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
  const worldContainer = getWorldContainer();
  const Graphics = resolveGraphicsCtor();
  if (!worldContainer?.addChild || !Graphics || !getLayout()) return;

  lastMoveOverlay = removeOverlay(lastMoveOverlay);

  const gfx = new Graphics();
  fillSquare(gfx, from, LAST_MOVE_COLOR, LAST_MOVE_ALPHA);
  fillSquare(gfx, to, LAST_MOVE_COLOR, LAST_MOVE_ALPHA);

  gfx.zIndex = LAST_MOVE_Z_INDEX;
  worldContainer.addChild(gfx);
  lastMoveOverlay = { gfx, parent: worldContainer };
}

/* -------------------------------------------------------------------------- */
/* Move animation                                                             */
/* -------------------------------------------------------------------------- */

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** One square-to-square trip. A castle needs two: the king and its rook. */
export type SlideStep = { from: Square; to: Square };

/** Puts every sliding tile view back, without running the callback. */
function abortSlide(): void {
  if (!slide) return;
  const current = slide;
  slide = null;

  cancelAnimationFrame(current.raf);
  for (const part of current.parts) {
    try {
      part.root.position?.set?.(part.baseX, part.baseY);
      part.root.zIndex = part.baseZIndex;
    } catch {
      /* ignore */
    }
  }
}

/** Ends the slide where it was headed and commits the move it was showing. */
function finishSlide(): void {
  const current = slide;
  abortSlide();
  current?.onDone();
}

/** Captures a trip's starting state, or null when its tile view is unreachable. */
function prepareSlidePart(step: SlideStep): SlidePart | null {
  const fromTile = squareToTile(step.from);
  const toTile = squareToTile(step.to);

  const root = resolveTileRoot(fromTile.tx, fromTile.ty);
  if (!root?.position) return null;

  return {
    root,
    baseX: root.position.x,
    baseY: root.position.y,
    baseZIndex: root.zIndex ?? 0,
    deltaX: (toTile.tx - fromTile.tx) * FARM_TILE_SIZE,
    deltaY: (toTile.ty - fromTile.ty) * FARM_TILE_SIZE,
  };
}

/**
 * Slides one or more pieces to their destinations, then runs `onDone` - which
 * is what actually commits the move. The board is untouched until then, so each
 * piece stays visible on its old square for the whole trip.
 *
 * Several steps move together rather than in sequence, which is what a castle
 * looks like: king and rook cross at the same time.
 *
 * A move requested while another is still flying lands that one first, so the
 * position can never be committed out of order.
 */
export function animatePieceSlide(steps: SlideStep[], onDone: () => void): void {
  finishSlide();

  const parts = steps
    .map(prepareSlidePart)
    .filter((part): part is SlidePart => part != null);

  if (!parts.length) {
    onDone();
    return;
  }

  const startedAt = performance.now();

  const tick = (now: number): void => {
    if (!slide) return;

    const progress = Math.min(1, (now - startedAt) / SLIDE_DURATION_MS);
    const eased = easeOutCubic(progress);

    try {
      for (const part of parts) {
        part.root.position.set(
          part.baseX + part.deltaX * eased,
          part.baseY + part.deltaY * eased,
        );
        part.root.zIndex = SLIDE_Z_INDEX;
      }
    } catch {
      finishSlide();
      return;
    }

    if (progress >= 1) {
      finishSlide();
      return;
    }
    slide.raf = requestAnimationFrame(tick);
  };

  for (const part of parts) part.root.zIndex = SLIDE_Z_INDEX;
  slide = { raf: requestAnimationFrame(tick), parts, onDone };
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
  finishSlide();
}

export function renderSquare(square: Square, piece: ChessPiece | null): void {
  const config = getLayout();
  if (!config) return;

  const { tx, ty } = squareToTile(square);
  if (!piece) {
    emptyTile(tx, ty);
    return;
  }
  placeDecorTile(tx, ty, config.decorIds[piece.kind]);
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
  abortSlide();
  stopIllegalFlash();
  teardownTints();

  boardOverlay = removeOverlay(boardOverlay);
  hintOverlay = removeOverlay(hintOverlay);
  lastMoveOverlay = removeOverlay(lastMoveOverlay);
  setLayout(null);
}

export { refreshTints };
export { squareToTile, tileToSquare, type RenderConfig } from "./chessBoardLayout";
