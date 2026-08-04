// src/services/editor/chessBoardLayout.ts
//
// Where the board sits and how it looks. Shared by everything that draws, so
// the renderer and the tinting agree on which map tile a board square is,
// without either owning the other.

import { FARM_TILE_SIZE } from "./chessBoardTiles";
import { BOARD_SIZE, type ChessPieceKind, type Square } from "./chessRules";

/**
 * What covers what, in one place: the overlays are siblings in the same
 * container, so these numbers are the only thing keeping them in order.
 *
 * Everything the board draws sits below the tile objects, so the pieces stay on
 * top - except the annotation arrows, which would be useless hidden behind a
 * piece. They still pass under a piece in flight (slide 999998, drag 999999).
 */
export const OVERLAY_Z_INDEX = {
  board: -999999,
  lastMove: -999998,
  /** Right-click squares, above the last move so they stay readable over it. */
  mark: -999997,
  hint: -999996,
  flash: -999995,
  arrow: 999000,
} as const;

export type RenderConfig = {
  /** Tile column of the board's top-left corner, in map coords. */
  originX: number;
  /** Tile row of the board's top-left corner, in map coords. */
  originY: number;
  lightColor: number;
  darkColor: number;
  alpha: number;
  blackTint: number;
  tintPieces: boolean;
  decorIds: Record<ChessPieceKind, string>;
  /**
   * Turns the board a half-turn, so Black sits at the bottom. Each player looks
   * at their own pieces from their own side, the way a physical board works.
   */
  flipped: boolean;
};

let config: RenderConfig | null = null;

export function setLayout(next: RenderConfig | null): void {
  config = next;
}

export function getLayout(): RenderConfig | null {
  return config;
}

/**
 * The half-turn that puts Black at the bottom. Applied in one place, on the
 * board <-> tile boundary, so rendering, tinting, hints, animation and input
 * all agree without any of them knowing the board is turned round at all.
 *
 * A half-turn keeps the checkerboard identical: a square's colour follows the
 * parity of col + row, and (7 - col) + (7 - row) has the same parity.
 */
function flip(value: number): number {
  return BOARD_SIZE - 1 - value;
}

/* -------------------------------------------------------------------------- */
/* Against a given board                                                      */
/* -------------------------------------------------------------------------- */
//
// The board being played on is one of possibly several on screen: other games
// happening in the room are drawn on their own players' gardens. Those have
// their own origin and orientation, so the projection has to be answerable for
// a config that is not the active one.
//
// The functions below take that config; the ones after them are the same
// questions asked of the active board, which is all most callers ever want.

export function squareToTileIn(
  config: RenderConfig,
  square: Square,
): { tx: number; ty: number } {
  const col = config.flipped ? flip(square.col) : square.col;
  const row = config.flipped ? flip(square.row) : square.row;

  return { tx: config.originX + col, ty: config.originY + row };
}

/** Centre of a board square, in worldContainer coordinates. */
export function squareCenterIn(
  config: RenderConfig,
  square: Square,
): { x: number; y: number } {
  const { tx, ty } = squareToTileIn(config, square);
  return {
    x: (tx + 0.5) * FARM_TILE_SIZE,
    y: (ty + 0.5) * FARM_TILE_SIZE,
  };
}

/** The board square a map tile stands on, or null when it is off that board. */
export function tileToSquareIn(
  config: RenderConfig,
  tx: number,
  ty: number,
): Square | null {
  const col = tx - config.originX;
  const row = ty - config.originY;
  if (col < 0 || col >= BOARD_SIZE || row < 0 || row >= BOARD_SIZE) return null;

  return config.flipped ? { col: flip(col), row: flip(row) } : { col, row };
}

/* -------------------------------------------------------------------------- */
/* Against the active board                                                   */
/* -------------------------------------------------------------------------- */

export function squareToTile(square: Square): { tx: number; ty: number } {
  if (!config) return { tx: square.col, ty: square.row };
  return squareToTileIn(config, square);
}

export function squareCenter(square: Square): { x: number; y: number } {
  const { tx, ty } = squareToTile(square);
  return {
    x: (tx + 0.5) * FARM_TILE_SIZE,
    y: (ty + 0.5) * FARM_TILE_SIZE,
  };
}

export function tileToSquare(tx: number, ty: number): Square | null {
  if (!config) return null;
  return tileToSquareIn(config, tx, ty);
}
