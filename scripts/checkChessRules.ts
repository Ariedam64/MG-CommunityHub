// scripts/checkChessRules.ts
//
// Verifies src/game/chess/chessRules.ts against known-good results.
//
// The core check is perft: counting every leaf of the move tree to a given
// depth from the starting position. The reference numbers are the standard
// published ones, and they only match if movement, captures, check evasion,
// pinned pieces and en passant are all exactly right - one wrong move
// anywhere and the totals diverge.
//
// Castling, promotion and the end-of-game states are covered separately, from
// positions built by hand: castling is out of reach at these perft depths.
//
// Run with: npm run check:chess

import {
  applyMove,
  attemptMove,
  createGame,
  findMove,
  generateLegalMoves,
  getStatus,
  isInCheck,
  pieceAt,
  type ChessGame,
  type ChessPieceKind,
  type ChessSide,
  type Square,
} from "../src/game/chess/chessRules";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) failures++;
  const mark = ok ? "OK  " : "FAIL";
  const detail = ok ? `${actual}` : `${actual} (expected ${expected})`;
  console.log(`  ${mark} ${label}: ${detail}`);
}

/** "e2" -> { col: 4, row: 6 }. Row 0 is rank 8, as in chessRules. */
function sq(name: string): Square {
  return { col: name.charCodeAt(0) - 97, row: 8 - Number(name[1]) };
}

function play(game: ChessGame, from: string, to: string): ChessGame {
  const move = findMove(game, sq(from), sq(to));
  if (!move) throw new Error(`illegal move in fixture: ${from}-${to}`);
  return applyMove(game, move);
}

function emptyBoard(): ChessGame {
  const game = createGame();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) game.board[row][col] = null;
  }
  return game;
}

function put(game: ChessGame, name: string, kind: ChessPieceKind, side: ChessSide): void {
  const square = sq(name);
  game.board[square.row][square.col] = { kind, side };
}

function perft(game: ChessGame, depth: number): number {
  const moves = generateLegalMoves(game);
  if (depth <= 1) return moves.length;

  let total = 0;
  for (const move of moves) total += perft(applyMove(game, move), depth - 1);
  return total;
}

/* -------------------------------------------------------------------------- */

console.log("\nperft from the starting position");
{
  const start = createGame();
  const started = Date.now();
  check("depth 1", perft(start, 1), 20);
  check("depth 2", perft(start, 2), 400);
  check("depth 3", perft(start, 3), 8902);
  check("depth 4", perft(start, 4), 197281);
  check("depth 5", perft(start, 5), 4865609);
  console.log(`  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

console.log("\ncastling");
{
  // White king and both rooks home, everything between them cleared.
  const game = emptyBoard();
  put(game, "e1", "king", "white");
  put(game, "a1", "rook", "white");
  put(game, "h1", "rook", "white");
  put(game, "e8", "king", "black");

  const targets = generateLegalMoves(game, sq("e1")).map((m) => m.to.col);
  check("king side available (g1)", targets.includes(6), true);
  check("queen side available (c1)", targets.includes(2), true);

  const castled = play(game, "e1", "g1");
  check("king landed on g1", pieceAt(castled, sq("g1"))?.kind, "king");
  check("rook jumped to f1", pieceAt(castled, sq("f1"))?.kind, "rook");
  check("h1 vacated", pieceAt(castled, sq("h1")), null);
  check("rights spent", castled.castling.white.kingSide, false);

  // A rook eyeing f1 means the king would cross an attacked square.
  const throughCheck = emptyBoard();
  put(throughCheck, "e1", "king", "white");
  put(throughCheck, "h1", "rook", "white");
  put(throughCheck, "f8", "rook", "black");
  put(throughCheck, "e8", "king", "black");
  const blocked = generateLegalMoves(throughCheck, sq("e1")).map((m) => m.to.col);
  check("refused through an attacked square", blocked.includes(6), false);

  // A knight on b1 blocks the queen-side path.
  const blockedPath = emptyBoard();
  put(blockedPath, "e1", "king", "white");
  put(blockedPath, "a1", "rook", "white");
  put(blockedPath, "b1", "knight", "white");
  put(blockedPath, "e8", "king", "black");
  const paths = generateLegalMoves(blockedPath, sq("e1")).map((m) => m.to.col);
  check("refused through an occupied square", paths.includes(2), false);
}

console.log("\nen passant");
{
  let game = createGame();
  game = play(game, "e2", "e4");
  game = play(game, "a7", "a6");
  game = play(game, "e4", "e5");
  game = play(game, "d7", "d5");

  check("target square offered", game.enPassant?.row, 2);

  const captures = generateLegalMoves(game, sq("e5")).map((m) => m.to);
  check("e5 pawn may take on d6", captures.some((t) => t.col === 3 && t.row === 2), true);

  const after = play(game, "e5", "d6");
  check("pawn arrived on d6", pieceAt(after, sq("d6"))?.kind, "pawn");
  check("captured pawn removed from d5", pieceAt(after, sq("d5")), null);
  check("offer expires", after.enPassant, null);

  // The offer must not survive an intervening move.
  let stale = createGame();
  stale = play(stale, "e2", "e4");
  stale = play(stale, "a7", "a6");
  stale = play(stale, "e4", "e5");
  stale = play(stale, "d7", "d5");
  stale = play(stale, "h2", "h3");
  stale = play(stale, "h7", "h6");
  const late = generateLegalMoves(stale, sq("e5")).map((m) => m.to);
  check("offer gone a move later", late.some((t) => t.col === 3 && t.row === 2), false);
}

console.log("\npromotion");
{
  const game = emptyBoard();
  put(game, "a7", "pawn", "white");
  put(game, "e1", "king", "white");
  put(game, "e8", "king", "black");

  const moves = generateLegalMoves(game, sq("a7"));
  check("four promotion choices", moves.length, 4);

  const promoted = play(game, "a7", "a8");
  check("defaults to a queen", pieceAt(promoted, sq("a8"))?.kind, "queen");
  check("keeps its side", pieceAt(promoted, sq("a8"))?.side, "white");
}

console.log("\ncheck, mate and stalemate");
{
  // Fool's mate: 1. f3 e5 2. g4 Qh4#
  let mate = createGame();
  mate = play(mate, "f2", "f3");
  mate = play(mate, "e7", "e5");
  mate = play(mate, "g2", "g4");
  mate = play(mate, "d8", "h4");
  check("fool's mate detected", getStatus(mate), "checkmate");
  check("white is in check", isInCheck(mate, "white"), true);
  check("white has no move", generateLegalMoves(mate).length, 0);

  // Black king on h8, white queen g6, white king h6: no legal move, no check.
  const stale = emptyBoard();
  put(stale, "h8", "king", "black");
  put(stale, "g6", "queen", "white");
  put(stale, "h6", "king", "white");
  stale.turn = "black";
  check("stalemate detected", getStatus(stale), "stalemate");
  check("black is not in check", isInCheck(stale, "black"), false);

  // A pinned knight cannot leave the file between its king and a rook.
  const pin = emptyBoard();
  put(pin, "e1", "king", "white");
  put(pin, "e2", "knight", "white");
  put(pin, "e8", "rook", "black");
  put(pin, "a8", "king", "black");
  check("pinned knight is frozen", generateLegalMoves(pin, sq("e2")).length, 0);
}

console.log("\nwhy a move was refused");
{
  // Pinned piece: the pattern allows it, the king forbids it.
  const pin = emptyBoard();
  put(pin, "e1", "king", "white");
  put(pin, "e2", "knight", "white");
  put(pin, "e8", "rook", "black");
  put(pin, "a8", "king", "black");
  check(
    "pinned piece blames the king",
    attemptMove(pin, sq("e2"), sq("c3")).leavesKingInCheck,
    true,
  );
  check(
    "unreachable square does not",
    attemptMove(pin, sq("e2"), sq("h8")).leavesKingInCheck,
    false,
  );

  // A king stepping onto a square the enemy rook covers.
  const walk = emptyBoard();
  put(walk, "e1", "king", "white");
  put(walk, "d8", "rook", "black");
  put(walk, "a8", "king", "black");
  check(
    "king walking into check blames the king",
    attemptMove(walk, sq("e1"), sq("d1")).leavesKingInCheck,
    true,
  );
  check(
    "a step it may take is not refused",
    attemptMove(walk, sq("e1"), sq("f1")).move != null,
    true,
  );

  // Moving out of turn is refused, but not because of any king.
  const turn = createGame();
  check(
    "wrong side is refused quietly",
    attemptMove(turn, sq("e7"), sq("e5")).leavesKingInCheck,
    false,
  );
}

console.log(
  failures === 0
    ? "\nAll chess rule checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);

process.exit(failures === 0 ? 0 : 1);
