// src/game/chess/chessBoardPresets.ts
//
// The look of a board, and how to rebuild a position from a move list.
//
// Both were private to chessBoard.ts while there was only ever one board. Now
// that games elsewhere in the room get drawn too, they are needed by code that
// has nothing to do with playing, so they live here rather than being reached
// for through the playable board.

import { DEFAULT_PIECE_DECOR_IDS } from "./chessBoard";
import type { RenderConfig } from "./chessBoardLayout";
import type { OwnGarden } from "./chessBoardTiles";
import { parseSquare } from "./chessNotation";
import {
  applyMove,
  attemptMove,
  createGame,
  type ChessGame,
  type ChessPieceKind,
  type Square,
} from "./chessRules";

/**
 * Tiles between the garden's own corner and the grid, so the 8x8 sits centred
 * in the left 10x10 block. Same inset the playable board uses, so a board drawn
 * by an onlooker lands exactly where its player sees it.
 */
export const BOARD_GRID_INSET = 1;

/** Everything about a board's look that does not depend on where it sits. */
export const AMBIENT_BOARD_CONFIG_DEFAULTS: Omit<RenderConfig, "originX" | "originY"> = {
  lightColor: 0xf0e6d2,
  darkColor: 0xc9a87c,
  alpha: 1,
  blackTint: 0x6a6a76,
  tintPieces: true,
  decorIds: DEFAULT_PIECE_DECOR_IDS,
  flipped: false,
};

export function gardenBoardOrigin(garden: OwnGarden): { originX: number; originY: number } {
  return {
    originX: garden.originX + BOARD_GRID_INSET,
    originY: garden.originY + BOARD_GRID_INSET,
  };
}

export type BuiltPosition = {
  game: ChessGame;
  lastMove: { from: Square; to: Square } | null;
  /**
   * The trips the last move is made of: one normally, two for a castle where
   * the king and the rook travel together. Empty when nothing was replayed.
   */
  lastSteps: Array<{ from: Square; to: Square }>;
};

/**
 * Replays a move list onto a position. Starting from `base` continues a game
 * already on screen; starting from nothing rebuilds it from the first move.
 *
 * Null when any move does not fit, which means the list and the position had
 * already diverged - the caller then rebuilds from scratch rather than showing
 * a board that is half right.
 */
export function buildGameFromRecords(
  records: Array<{ from: string; to: string; promotion?: string | null }>,
  base?: ChessGame,
): BuiltPosition | null {
  let game = base ?? createGame();
  let lastMove: { from: Square; to: Square } | null = null;
  let lastSteps: Array<{ from: Square; to: Square }> = [];

  for (const record of records) {
    const from = parseSquare(record.from);
    const to = parseSquare(record.to);
    if (!from || !to) return null;

    const { move } = attemptMove(game, from, to, (record.promotion as ChessPieceKind) ?? "queen");
    if (!move) return null;

    game = applyMove(game, move);
    lastMove = { from: move.from, to: move.to };
    lastSteps = move.castleRook
      ? [{ from: move.from, to: move.to }, move.castleRook]
      : [{ from: move.from, to: move.to }];
  }

  return { game, lastMove, lastSteps };
}
