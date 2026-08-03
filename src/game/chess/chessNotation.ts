// src/game/chess/chessNotation.ts
//
// Algebraic square names, the format the wire uses.
//
// This deliberately does not live in chessRules.ts: that file is byte-identical
// to the server's copy, and every rule fix is recopied wholesale between the
// two. Anything the wire needs but the rules do not stays outside it — the
// server does exactly the same on its side.
//
// Squares are { col, row } with col 0 = file a and row 0 = rank 8 (the top of
// the board, Black's back rank). White advances towards row 0.

import type { Square } from "./chessRules";

const FILE_A_CHAR_CODE = 97; // "a"
const BOARD_SIZE = 8;

/** "e2" → { col: 4, row: 6 }. Null for anything that is not a real square. */
export function parseSquare(name: string): Square | null {
  if (typeof name !== "string" || !/^[a-h][1-8]$/.test(name)) return null;
  return {
    col: name.charCodeAt(0) - FILE_A_CHAR_CODE,
    row: BOARD_SIZE - Number(name[1]),
  };
}

/** { col: 4, row: 6 } → "e2". */
export function squareToName(square: Square): string {
  return `${String.fromCharCode(FILE_A_CHAR_CODE + square.col)}${BOARD_SIZE - square.row}`;
}
