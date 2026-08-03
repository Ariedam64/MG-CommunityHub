// src/services/editor/chessBoardLayout.ts
//
// Where the board sits and how it looks. Shared by everything that draws, so
// the renderer and the tinting agree on which map tile a board square is,
// without either owning the other.

import { BOARD_SIZE, type ChessPieceKind, type Square } from "./chessRules";

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

export function squareToTile(square: Square): { tx: number; ty: number } {
  if (!config) return { tx: square.col, ty: square.row };

  const col = config.flipped ? flip(square.col) : square.col;
  const row = config.flipped ? flip(square.row) : square.row;

  return { tx: config.originX + col, ty: config.originY + row };
}

/** The board square a map tile stands on, or null when it is off the board. */
export function tileToSquare(tx: number, ty: number): Square | null {
  if (!config) return null;

  const col = tx - config.originX;
  const row = ty - config.originY;
  if (col < 0 || col >= BOARD_SIZE || row < 0 || row >= BOARD_SIZE) return null;

  return config.flipped ? { col: flip(col), row: flip(row) } : { col, row };
}
