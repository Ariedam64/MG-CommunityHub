// src/services/editor/chessRules.ts
//
// Standard chess rules, as a pure module: no Pixi, no game data, no DOM. It
// owns the position and answers "which moves are legal here", the renderer only
// mirrors it onto tiles.
//
// Board coordinates match the painted grid: row 0 is the top row (black's back
// rank), row 7 the bottom one (white's), col 0 is the a-file. White therefore
// moves towards row 0.
//
// Implemented: piece movement, captures, castling (both sides, with all the
// path/attack conditions), en passant, promotion, check, pinned pieces,
// checkmate and stalemate. Not implemented: the fifty-move rule, threefold
// repetition, and insufficient-material draws.

export type ChessPieceKind =
  | "pawn"
  | "rook"
  | "knight"
  | "bishop"
  | "queen"
  | "king";

export type ChessSide = "white" | "black";

export type ChessPiece = { kind: ChessPieceKind; side: ChessSide };

export type Square = { col: number; row: number };

export type ChessMove = {
  from: Square;
  to: Square;
  piece: ChessPiece;
  captured: ChessPiece | null;
  /** Where the captured piece stands - differs from `to` on en passant. */
  capturedSquare: Square | null;
  /** The rook's own trip when this move is a castle. */
  castleRook: { from: Square; to: Square } | null;
  promotion: ChessPieceKind | null;
};

export type CastlingRights = Record<
  ChessSide,
  { kingSide: boolean; queenSide: boolean }
>;

export type ChessGame = {
  board: Array<Array<ChessPiece | null>>;
  turn: ChessSide;
  castling: CastlingRights;
  /** Square a pawn may land on to capture en passant. Valid for one ply only. */
  enPassant: Square | null;
};

export type GameStatus = "playing" | "check" | "checkmate" | "stalemate";

export const BOARD_SIZE = 8;

const BACK_RANK: ChessPieceKind[] = [
  "rook",
  "knight",
  "bishop",
  "queen",
  "king",
  "bishop",
  "knight",
  "rook",
];

const PROMOTION_KINDS: ChessPieceKind[] = ["queen", "rook", "bishop", "knight"];

/** Direction vectors as [dCol, dRow]. */
const ROOK_DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const BISHOP_DIRS: Array<[number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const KNIGHT_STEPS: Array<[number, number]> = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

const KING_STEPS: Array<[number, number]> = [...ROOK_DIRS, ...BISHOP_DIRS];

const KING_HOME_COL = 4;
const KING_SIDE_ROOK_COL = BOARD_SIZE - 1;
const QUEEN_SIDE_ROOK_COL = 0;

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                           */
/* -------------------------------------------------------------------------- */

function isOnBoard(square: Square): boolean {
  return (
    square.col >= 0 &&
    square.col < BOARD_SIZE &&
    square.row >= 0 &&
    square.row < BOARD_SIZE
  );
}

function sameSquare(a: Square, b: Square): boolean {
  return a.col === b.col && a.row === b.row;
}

/** Algebraic name of a square, for logs: col 0/row 0 is a8. */
export function squareName(square: Square): string {
  return `${String.fromCharCode(97 + square.col)}${BOARD_SIZE - square.row}`;
}

export function opponentOf(side: ChessSide): ChessSide {
  return side === "white" ? "black" : "white";
}

/** White sits on the bottom rows and advances towards row 0. */
function forwardStep(side: ChessSide): number {
  return side === "white" ? -1 : 1;
}

function homeRow(side: ChessSide): number {
  return side === "white" ? BOARD_SIZE - 1 : 0;
}

function pawnStartRow(side: ChessSide): number {
  return side === "white" ? BOARD_SIZE - 2 : 1;
}

function promotionRow(side: ChessSide): number {
  return side === "white" ? 0 : BOARD_SIZE - 1;
}

type Board = ChessGame["board"];

function at(board: Board, square: Square): ChessPiece | null {
  return isOnBoard(square) ? board[square.row][square.col] : null;
}

function setAt(board: Board, square: Square, piece: ChessPiece | null): void {
  if (isOnBoard(square)) board[square.row][square.col] = piece;
}

function cloneBoard(board: Board): Board {
  return board.map((row) => row.slice());
}

/* -------------------------------------------------------------------------- */
/* Setup                                                                      */
/* -------------------------------------------------------------------------- */

export function createGame(): ChessGame {
  const board: Board = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null),
  );

  for (let col = 0; col < BOARD_SIZE; col++) {
    board[0][col] = { kind: BACK_RANK[col], side: "black" };
    board[1][col] = { kind: "pawn", side: "black" };
    board[BOARD_SIZE - 2][col] = { kind: "pawn", side: "white" };
    board[BOARD_SIZE - 1][col] = { kind: BACK_RANK[col], side: "white" };
  }

  return {
    board,
    turn: "white",
    castling: {
      white: { kingSide: true, queenSide: true },
      black: { kingSide: true, queenSide: true },
    },
    enPassant: null,
  };
}

export function pieceAt(game: ChessGame, square: Square): ChessPiece | null {
  return at(game.board, square);
}

/* -------------------------------------------------------------------------- */
/* Attacks                                                                    */
/* -------------------------------------------------------------------------- */

function isAttackedByRay(
  board: Board,
  target: Square,
  bySide: ChessSide,
  dirs: Array<[number, number]>,
  kinds: ChessPieceKind[],
): boolean {
  for (const [dCol, dRow] of dirs) {
    let square = { col: target.col + dCol, row: target.row + dRow };

    while (isOnBoard(square)) {
      const piece = at(board, square);
      if (piece) {
        if (piece.side === bySide && kinds.includes(piece.kind)) return true;
        break;
      }
      square = { col: square.col + dCol, row: square.row + dRow };
    }
  }
  return false;
}

function isAttackedByStep(
  board: Board,
  target: Square,
  bySide: ChessSide,
  steps: Array<[number, number]>,
  kind: ChessPieceKind,
): boolean {
  for (const [dCol, dRow] of steps) {
    const piece = at(board, {
      col: target.col + dCol,
      row: target.row + dRow,
    });
    if (piece && piece.side === bySide && piece.kind === kind) return true;
  }
  return false;
}

/** Whether `bySide` attacks `target`, ignoring whose turn it is. */
function isSquareAttacked(
  board: Board,
  target: Square,
  bySide: ChessSide,
): boolean {
  // A pawn of `bySide` sitting one step *back* from the target attacks it.
  const pawnRow = target.row - forwardStep(bySide);
  for (const dCol of [-1, 1]) {
    const piece = at(board, { col: target.col + dCol, row: pawnRow });
    if (piece && piece.side === bySide && piece.kind === "pawn") return true;
  }

  if (isAttackedByStep(board, target, bySide, KNIGHT_STEPS, "knight")) {
    return true;
  }
  if (isAttackedByStep(board, target, bySide, KING_STEPS, "king")) return true;
  if (isAttackedByRay(board, target, bySide, ROOK_DIRS, ["rook", "queen"])) {
    return true;
  }
  return isAttackedByRay(board, target, bySide, BISHOP_DIRS, [
    "bishop",
    "queen",
  ]);
}

function findKing(board: Board, side: ChessSide): Square | null {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const piece = board[row][col];
      if (piece?.kind === "king" && piece.side === side) return { col, row };
    }
  }
  return null;
}

export function isInCheck(game: ChessGame, side: ChessSide = game.turn): boolean {
  const king = findKing(game.board, side);
  return king ? isSquareAttacked(game.board, king, opponentOf(side)) : false;
}

/* -------------------------------------------------------------------------- */
/* Move generation                                                            */
/* -------------------------------------------------------------------------- */

function buildMove(
  board: Board,
  from: Square,
  to: Square,
  piece: ChessPiece,
  overrides: Partial<ChessMove> = {},
): ChessMove {
  const captured = at(board, to);
  return {
    from,
    to,
    piece,
    captured,
    capturedSquare: captured ? to : null,
    castleRook: null,
    promotion: null,
    ...overrides,
  };
}

/** Pushes a pawn move, expanding it into one move per piece when it promotes. */
function pushPawnMove(
  moves: ChessMove[],
  board: Board,
  from: Square,
  to: Square,
  piece: ChessPiece,
  overrides: Partial<ChessMove> = {},
): void {
  if (to.row !== promotionRow(piece.side)) {
    moves.push(buildMove(board, from, to, piece, overrides));
    return;
  }
  for (const kind of PROMOTION_KINDS) {
    moves.push(buildMove(board, from, to, piece, { ...overrides, promotion: kind }));
  }
}

function pawnMoves(game: ChessGame, from: Square, piece: ChessPiece): ChessMove[] {
  const moves: ChessMove[] = [];
  const board = game.board;
  const step = forwardStep(piece.side);

  const ahead = { col: from.col, row: from.row + step };
  if (isOnBoard(ahead) && !at(board, ahead)) {
    pushPawnMove(moves, board, from, ahead, piece);

    const twoAhead = { col: from.col, row: from.row + step * 2 };
    if (from.row === pawnStartRow(piece.side) && !at(board, twoAhead)) {
      moves.push(buildMove(board, from, twoAhead, piece));
    }
  }

  for (const dCol of [-1, 1]) {
    const target = { col: from.col + dCol, row: from.row + step };
    if (!isOnBoard(target)) continue;

    const occupant = at(board, target);
    if (occupant) {
      if (occupant.side !== piece.side) {
        pushPawnMove(moves, board, from, target, piece);
      }
      continue;
    }

    // En passant: the captured pawn stands beside us, not on the target square.
    if (game.enPassant && sameSquare(target, game.enPassant)) {
      const capturedSquare = { col: target.col, row: from.row };
      pushPawnMove(moves, board, from, target, piece, {
        captured: at(board, capturedSquare),
        capturedSquare,
      });
    }
  }

  return moves;
}

function stepMoves(
  board: Board,
  from: Square,
  piece: ChessPiece,
  steps: Array<[number, number]>,
): ChessMove[] {
  const moves: ChessMove[] = [];

  for (const [dCol, dRow] of steps) {
    const target = { col: from.col + dCol, row: from.row + dRow };
    if (!isOnBoard(target)) continue;

    const occupant = at(board, target);
    if (occupant && occupant.side === piece.side) continue;
    moves.push(buildMove(board, from, target, piece));
  }

  return moves;
}

function rayMoves(
  board: Board,
  from: Square,
  piece: ChessPiece,
  dirs: Array<[number, number]>,
): ChessMove[] {
  const moves: ChessMove[] = [];

  for (const [dCol, dRow] of dirs) {
    let target = { col: from.col + dCol, row: from.row + dRow };

    while (isOnBoard(target)) {
      const occupant = at(board, target);
      if (occupant) {
        if (occupant.side !== piece.side) {
          moves.push(buildMove(board, from, target, piece));
        }
        break;
      }
      moves.push(buildMove(board, from, target, piece));
      target = { col: target.col + dCol, row: target.row + dRow };
    }
  }

  return moves;
}

/**
 * Castling. The king may not start in check, cross an attacked square, or land
 * on one, and everything between king and rook must be empty.
 */
function castlingMoves(game: ChessGame, from: Square, piece: ChessPiece): ChessMove[] {
  const rights = game.castling[piece.side];
  const row = homeRow(piece.side);
  if (from.row !== row || from.col !== KING_HOME_COL) return [];

  const enemy = opponentOf(piece.side);
  if (isSquareAttacked(game.board, from, enemy)) return [];

  const moves: ChessMove[] = [];

  const tryCastle = (
    allowed: boolean,
    rookCol: number,
    kingTargetCol: number,
    rookTargetCol: number,
    emptyCols: number[],
  ): void => {
    if (!allowed) return;

    const rook = at(game.board, { col: rookCol, row });
    if (rook?.kind !== "rook" || rook.side !== piece.side) return;

    for (const col of emptyCols) {
      if (at(game.board, { col, row })) return;
    }

    // Every square the king travels through, landing square included.
    const stepDir = kingTargetCol > from.col ? 1 : -1;
    for (let col = from.col + stepDir; ; col += stepDir) {
      if (isSquareAttacked(game.board, { col, row }, enemy)) return;
      if (col === kingTargetCol) break;
    }

    moves.push(
      buildMove(game.board, from, { col: kingTargetCol, row }, piece, {
        castleRook: {
          from: { col: rookCol, row },
          to: { col: rookTargetCol, row },
        },
      }),
    );
  };

  tryCastle(rights.kingSide, KING_SIDE_ROOK_COL, 6, 5, [5, 6]);
  tryCastle(rights.queenSide, QUEEN_SIDE_ROOK_COL, 2, 3, [1, 2, 3]);

  return moves;
}

/** Every move the piece's pattern allows, ignoring whether the king is left in check. */
function pseudoMovesFrom(game: ChessGame, from: Square): ChessMove[] {
  const piece = at(game.board, from);
  if (!piece) return [];

  switch (piece.kind) {
    case "pawn":
      return pawnMoves(game, from, piece);
    case "knight":
      return stepMoves(game.board, from, piece, KNIGHT_STEPS);
    case "bishop":
      return rayMoves(game.board, from, piece, BISHOP_DIRS);
    case "rook":
      return rayMoves(game.board, from, piece, ROOK_DIRS);
    case "queen":
      return rayMoves(game.board, from, piece, [...ROOK_DIRS, ...BISHOP_DIRS]);
    case "king":
      return [
        ...stepMoves(game.board, from, piece, KING_STEPS),
        ...castlingMoves(game, from, piece),
      ];
  }
}

/** The board as it stands after `move`, without touching `game`. */
function boardAfter(game: ChessGame, move: ChessMove): Board {
  const board = cloneBoard(game.board);

  if (move.capturedSquare) setAt(board, move.capturedSquare, null);
  setAt(board, move.from, null);
  setAt(board, move.to, {
    kind: move.promotion ?? move.piece.kind,
    side: move.piece.side,
  });

  if (move.castleRook) {
    const rook = at(board, move.castleRook.from);
    setAt(board, move.castleRook.from, null);
    setAt(board, move.castleRook.to, rook);
  }

  return board;
}

/** A move is legal when it doesn't leave (or put) its own king in check. */
function isLegal(game: ChessGame, move: ChessMove): boolean {
  const board = boardAfter(game, move);
  const king = findKing(board, move.piece.side);
  return !king || !isSquareAttacked(board, king, opponentOf(move.piece.side));
}

/**
 * Every legal move for the side to move, or only those leaving `from` when it
 * is given. Pieces of the other side never generate moves.
 */
export function generateLegalMoves(game: ChessGame, from?: Square): ChessMove[] {
  const origins: Square[] = [];

  if (from) {
    origins.push(from);
  } else {
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) origins.push({ col, row });
    }
  }

  const moves: ChessMove[] = [];
  for (const origin of origins) {
    const piece = at(game.board, origin);
    if (piece?.side !== game.turn) continue;
    for (const move of pseudoMovesFrom(game, origin)) {
      if (isLegal(game, move)) moves.push(move);
    }
  }

  return moves;
}

export type MoveAttempt = {
  /** The move to play, or null when it was refused. */
  move: ChessMove | null;
  /**
   * True when the piece's own pattern allowed the move but the rules refused it
   * because it would leave its king in check - a king walking into an attack,
   * or a piece pinned against it. Worth telling the player about, unlike a
   * square the piece simply cannot reach.
   */
  leavesKingInCheck: boolean;
};

/**
 * Resolves an attempted move and, when refused, says whether the king is the
 * reason. `promotion` picks which piece a promoting pawn becomes.
 */
export function attemptMove(
  game: ChessGame,
  from: Square,
  to: Square,
  promotion: ChessPieceKind = "queen",
): MoveAttempt {
  const piece = at(game.board, from);
  if (piece?.side !== game.turn) return { move: null, leavesKingInCheck: false };

  const candidates = pseudoMovesFrom(game, from).filter((move) =>
    sameSquare(move.to, to),
  );
  if (!candidates.length) return { move: null, leavesKingInCheck: false };

  const legal = candidates.filter((move) => isLegal(game, move));
  if (!legal.length) return { move: null, leavesKingInCheck: true };

  return {
    move: legal.find((move) => move.promotion === promotion) ?? legal[0],
    leavesKingInCheck: false,
  };
}

/** The legal move joining two squares, picking `promotion` when it promotes. */
export function findMove(
  game: ChessGame,
  from: Square,
  to: Square,
  promotion: ChessPieceKind = "queen",
): ChessMove | null {
  return attemptMove(game, from, to, promotion).move;
}

/** Where a side's king stands, or null if it has none. */
export function findKingSquare(
  game: ChessGame,
  side: ChessSide,
): Square | null {
  return findKing(game.board, side);
}

/* -------------------------------------------------------------------------- */
/* Applying moves                                                             */
/* -------------------------------------------------------------------------- */

function updateCastlingRights(
  rights: CastlingRights,
  move: ChessMove,
): CastlingRights {
  const next: CastlingRights = {
    white: { ...rights.white },
    black: { ...rights.black },
  };

  const side = move.piece.side;
  if (move.piece.kind === "king") {
    next[side] = { kingSide: false, queenSide: false };
  }

  // A rook leaving its corner, or being captured on it, kills that right.
  const corners: Array<[ChessSide, number, "kingSide" | "queenSide"]> = [
    ["white", KING_SIDE_ROOK_COL, "kingSide"],
    ["white", QUEEN_SIDE_ROOK_COL, "queenSide"],
    ["black", KING_SIDE_ROOK_COL, "kingSide"],
    ["black", QUEEN_SIDE_ROOK_COL, "queenSide"],
  ];

  for (const [owner, col, flag] of corners) {
    const corner = { col, row: homeRow(owner) };
    if (sameSquare(move.from, corner) || sameSquare(move.to, corner)) {
      next[owner][flag] = false;
    }
  }

  return next;
}

/** The position after `move`. `game` is left untouched. */
export function applyMove(game: ChessGame, move: ChessMove): ChessGame {
  const isDoublePawnStep =
    move.piece.kind === "pawn" && Math.abs(move.to.row - move.from.row) === 2;

  return {
    board: boardAfter(game, move),
    turn: opponentOf(game.turn),
    castling: updateCastlingRights(game.castling, move),
    enPassant: isDoublePawnStep
      ? { col: move.from.col, row: (move.from.row + move.to.row) / 2 }
      : null,
  };
}

export function getStatus(game: ChessGame): GameStatus {
  const hasMove = generateLegalMoves(game).length > 0;
  const check = isInCheck(game);

  if (!hasMove) return check ? "checkmate" : "stalemate";
  return check ? "check" : "playing";
}

/** Squares touched by a move, so a renderer knows what to redraw. */
export function affectedSquares(move: ChessMove): Square[] {
  const squares = [move.from, move.to];
  if (move.capturedSquare && !sameSquare(move.capturedSquare, move.to)) {
    squares.push(move.capturedSquare);
  }
  if (move.castleRook) squares.push(move.castleRook.from, move.castleRook.to);
  return squares;
}
