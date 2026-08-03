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
};

let config: RenderConfig | null = null;

export function setLayout(next: RenderConfig | null): void {
  config = next;
}

export function getLayout(): RenderConfig | null {
  return config;
}

export function squareToTile(square: Square): { tx: number; ty: number } {
  if (!config) return { tx: square.col, ty: square.row };
  return { tx: config.originX + square.col, ty: config.originY + square.row };
}

/** The board square a map tile stands on, or null when it is off the board. */
export function tileToSquare(tx: number, ty: number): Square | null {
  if (!config) return null;

  const col = tx - config.originX;
  const row = ty - config.originY;
  if (col < 0 || col >= BOARD_SIZE || row < 0 || row >= BOARD_SIZE) return null;

  return { col, row };
}
