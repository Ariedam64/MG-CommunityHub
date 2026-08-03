// src/services/editor/chessBoard.ts
//
// Test feature: turns the player's own garden into a playable chess board.
// Everything is local and reversible - nothing is written to the game state,
// the inventory or the WebSocket.
//
// The work is split by responsibility:
//   - chessRules.ts       the position and what is legal from it,
//   - chessBoardLayout.ts where the board sits, and board <-> map coordinates,
//   - chessBoardTiles.ts  reading and writing tile views, and undoing that,
//   - chessBoardRender.ts squares, pieces, move hints and animations,
//   - chessBoardTint.ts   keeping the black side dark,
//   - chessBoardInput.ts  click-to-select and drag-and-drop on the board,
//   - chessBoardSounds.ts the sound effects,
//   - this file           options, setup, and the move loop joining them.
//
// Rules are complete: piece movement, castling, en passant, promotion (always
// to a queen - there is no under-promotion prompt), check, pinned pieces,
// checkmate and stalemate, with strict turn alternation. Draws by repetition,
// the fifty-move rule and insufficient material are not detected.

import { decorCatalog } from "@/data";
import { tos } from "@/game/tileObjectSystem";
import { emptyTile, hasTouchedTiles, readOwnGarden, restoreAllTiles } from "./chessBoardTiles";
import {
  animatePieceSlide,
  clearMoveHints,
  flashIllegalSquare,
  paintBoard,
  refreshTints,
  renderPosition,
  renderSquare,
  settlePendingSlide,
  showLastMove,
  showMoveHints,
  teardownRender,
  tileToSquare,
  type RenderConfig,
} from "./chessBoardRender";
import {
  clearChessSelection,
  startChessInput,
  stopChessInput,
  type ChessSquare,
} from "./chessBoardInput";
import {
  playChessSound,
  preloadChessSounds,
  stopChessSounds,
  type ChessSoundName,
} from "./chessBoardSounds";
import {
  BOARD_SIZE,
  affectedSquares,
  applyMove,
  attemptMove,
  createGame,
  findKingSquare,
  findMove,
  generateLegalMoves,
  getStatus,
  opponentOf,
  pieceAt,
  squareName,
  type ChessGame,
  type ChessMove,
  type ChessPieceKind,
  type ChessSide,
  type GameStatus,
  type Square,
} from "./chessRules";

/**
 * Tiles between the garden's own corner and the grid, so the 8x8 sits centred
 * in the left 10x10 area of the 20x10 garden.
 */
const DEFAULT_GRID_INSET = 1;

const DEFAULT_LIGHT_COLOR = 0xf0e6d2;
const DEFAULT_DARK_COLOR = 0xc9a87c;
const DEFAULT_ALPHA = 1;

/**
 * Black side: a plain tint, which multiplies. Kept grey rather than near-black -
 * the pieces are small and a hard multiply swallows their relief against the
 * board. The white side is left untouched: tint can only darken.
 */
const DEFAULT_BLACK_TINT = 0x6a6a76;

/** Decor sprite standing in for each piece. */
const DEFAULT_PIECE_DECOR_IDS: Record<ChessPieceKind, string> = {
  pawn: "StoneGnome",
  rook: "StonePedestal",
  knight: "StoneCaribou",
  bishop: "StoneBirdbath",
  queen: "StoneGnomess",
  king: "StoneBench",
};

export type ChessBoardOptions = {
  /** Tile column of the grid's top-left corner, in map coords. Defaults to the garden's left edge + inset. */
  originX?: number;
  /** Tile row of the grid's top-left corner, in map coords. Defaults to the garden's top edge + inset. */
  originY?: number;
  lightColor?: number;
  darkColor?: number;
  /** 0..1, lower it to let the garden show through the squares. */
  alpha?: number;
  /** Override the decor id used for one or more piece kinds. */
  pieceDecorIds?: Partial<Record<ChessPieceKind, string>>;
  /** Tint multiplied onto the black side's sprites. */
  blackTint?: number;
  /** Empty every garden tile first. Defaults to true. */
  clearGarden?: boolean;
  /** Set the pieces up. Without them the board is just painted. Defaults to true. */
  placePieces?: boolean;
  /** Tint the black side. Defaults to true. */
  tintPieces?: boolean;
  /**
   * Turn the board round so Black is at the bottom. Defaults to whichever side
   * this client plays, so both players look at their own pieces from their own
   * end. Spectators get White's view.
   */
  flipped?: boolean;
  /** Allow moving the pieces by click or drag. Defaults to true. */
  enableInput?: boolean;
  /**
   * Online binding. Omit it for the local hotseat board, where both sides are
   * movable and nothing is sent anywhere.
   */
  net?: ChessNetBinding;
  /**
   * Replay these moves before handing the board over. Used when joining a game
   * already in progress — a reconnection, or watching someone else's.
   */
  startFromMoves?: { from: Square; to: Square; promotion?: ChessPieceKind | null }[];
};

export type ChessBoardResult = {
  originX: number;
  originY: number;
  size: number;
  tilesCleared: number;
  piecesPlaced: number;
  turn: string | null;
  inputEnabled: boolean;
};

/** The position on the board, or null when only the squares are painted. */
let game: ChessGame | null = null;

/* -------------------------------------------------------------------------- */
/* Network binding                                                            */
/* -------------------------------------------------------------------------- */

export type ChessNetBinding = {
  /**
   * The side this client is allowed to move. `null` means hotseat: both sides
   * are movable, which is the local-only board.
   */
  myColor: ChessSide | null;

  /**
   * Called as soon as a local move has been validated, with the half-move
   * number it claims. Fired before the slide lands so the request leaves
   * immediately — 200ms per move adds up on a 10-minute clock.
   */
  onLocalMove?: (move: ChessMove, ply: number) => void;

  /**
   * Resolves which piece a pawn promotes to. Returning null cancels the move
   * and puts the piece back.
   */
  requestPromotion?: (side: ChessSide) => Promise<ChessPieceKind | null>;
};

/** Half-moves played. 0 is the starting position, 1 is after White's first. */
let ply = 0;

/**
 * The highest half-move we have *claimed*, which runs ahead of `ply` for the
 * 200ms a local move spends sliding.
 *
 * Without this, a fast echo of our own move arrives while the piece is still in
 * flight: `ply` is still N-1, the event says N, so it looks like the opponent's
 * next move and gets played a second time — on top of the commit the animation
 * is about to run.
 */
let claimedPly = 0;

let binding: ChessNetBinding = { myColor: null };

/** Set while the game is over or a resync is in flight: nothing can be moved. */
let frozen = false;

/** Guards against a second move being started while a promotion prompt is open. */
let awaitingPromotion = false;

export function bindChessNet(next: ChessNetBinding): void {
  binding = next;
}

export function getChessGame(): ChessGame | null {
  return game;
}

export function getChessPly(): number {
  return ply;
}

/**
 * The half-move count including one still sliding. Compare incoming events
 * against this, never against `getChessPly()`.
 */
export function getChessClaimedPly(): number {
  return Math.max(ply, claimedPly);
}

/** Freezes or unfreezes the board's inputs without tearing anything down. */
export function setChessBoardFrozen(next: boolean): void {
  frozen = next;
  if (frozen) clearChessSelection();
}

/* -------------------------------------------------------------------------- */
/* Moves                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One sound per move, most significant first: a mate by capture is a mate, not
 * a capture. Layering them all would just be noise.
 */
function soundForMove(move: ChessMove, status: GameStatus): ChessSoundName {
  if (status === "checkmate" || status === "stalemate") return "gameEnd";
  if (status === "check") return "check";
  if (move.promotion) return "promote";
  if (move.castleRook) return "castle";
  if (move.captured) return "capture";
  // The two sides get the two "move" samples, so whose turn it was is audible.
  return move.piece.side === "white" ? "move" : "moveOpponent";
}

function logOutcome(
  movedSide: string,
  description: string,
  status: GameStatus,
): void {
  if (!game) return;

  console.log(`[ChessBoard] ${movedSide} plays ${description}`, {
    status,
    turn: game.turn,
  });

  if (status === "checkmate") {
    console.log(`[ChessBoard] checkmate - ${opponentOf(game.turn)} wins`);
  } else if (status === "stalemate") {
    console.log("[ChessBoard] stalemate - draw");
  } else if (status === "check") {
    console.log(`[ChessBoard] ${game.turn} is in check`);
  }
}

/** Advances the position and redraws only the squares the move touched. */
function commitMove(move: ChessMove): void {
  if (!game) return;

  const movedSide = move.piece.side;
  const description = `${move.piece.kind} ${squareName(move.from)}-${squareName(
    move.to,
  )}${move.castleRook ? " (castle)" : ""}${
    move.promotion ? ` (=${move.promotion})` : ""
  }`;

  game = applyMove(game, move);
  ply += 1;
  claimedPly = Math.max(claimedPly, ply);

  for (const square of affectedSquares(move)) {
    renderSquare(square, pieceAt(game, square));
  }
  refreshTints(game);
  showLastMove(move.from, move.to);
  clearChessSelection();

  const status = getStatus(game);
  playChessSound(soundForMove(move, status));
  logOutcome(movedSide, description, status);
}

/**
 * Validates a requested move against the rules and, when it is legal, plays it.
 * A clicked move slides across first and is only committed once it lands, so
 * the piece stays visible on its old square for the whole trip.
 */
function tryMove(
  fromTile: ChessSquare,
  toTile: ChessSquare,
  animate: boolean,
): void {
  if (!game || frozen || awaitingPromotion) return;

  const from = tileToSquare(fromTile.tx, fromTile.ty);
  const to = tileToSquare(toTile.tx, toTile.ty);
  if (!from || !to) return;

  void playLocalMove(from, to, animate);
}

/**
 * Validates a local move, asks for the promotion piece when there is one, then
 * commits it optimistically and hands it to the network binding.
 *
 * The request goes out as soon as the move is known to be legal — not once the
 * slide lands. The animation is 200ms, and on a 10-minute clock that is eight
 * seconds given away over a full game.
 */
async function playLocalMove(from: Square, to: Square, animate: boolean): Promise<void> {
  if (!game) return;

  const first = attemptMove(game, from, to);

  // A promotion is offered as a queen by default; ask before settling on one.
  if (first.move?.promotion && binding.requestPromotion) {
    const side = first.move.piece.side;
    awaitingPromotion = true;
    let chosen: ChessPieceKind | null = null;
    try {
      chosen = await binding.requestPromotion(side);
    } finally {
      awaitingPromotion = false;
    }

    // The position can have moved on while the prompt was open (a resync, or
    // the board being torn down): drop the move rather than apply it blind.
    if (!chosen || !game || frozen) {
      clearChessSelection();
      return;
    }

    const promoted = attemptMove(game, from, to, chosen);
    if (promoted.move) {
      dispatchLocalMove(promoted.move, animate);
      return;
    }
  }

  const { move, leavesKingInCheck } = first;
  if (!move) {
    // A square the piece simply cannot reach is not worth a fuss - the piece
    // just goes back. But a move refused *because of the king* looks arbitrary
    // unless it is pointed out, so the king itself blinks: it is the reason,
    // whether it was walking into an attack or holding a piece pinned.
    if (leavesKingInCheck) {
      const king = findKingSquare(game, game.turn);
      if (king) flashIllegalSquare(king);
      playChessSound("illegal");
    }

    console.log(
      `[ChessBoard] refused: ${squareName(from)} to ${squareName(to)}`,
      { leavesKingInCheck },
    );
    return;
  }

  dispatchLocalMove(move, animate);
}

/** Announces a validated local move, then plays it. */
function dispatchLocalMove(move: ChessMove, animate: boolean): void {
  claimedPly = ply + 1;
  binding.onLocalMove?.(move, claimedPly);
  playMoveOnBoard(move, animate);
}

/** Slides the piece, then commits — never the other way round (see §4.6). */
function playMoveOnBoard(move: ChessMove, animate: boolean): void {
  if (!animate) {
    commitMove(move);
    return;
  }

  // A castle moves two pieces, and they travel together.
  const steps = [{ from: move.from, to: move.to }];
  if (move.castleRook) steps.push(move.castleRook);

  animatePieceSlide(steps, () => commitMove(move));
}

/* -------------------------------------------------------------------------- */
/* Remote moves and resynchronisation                                         */
/* -------------------------------------------------------------------------- */

/**
 * Plays a move that arrived from the server. Returns false when it does not fit
 * the local position — the caller then has to resynchronise, because the two
 * sides have diverged.
 */
export function applyRemoteMove(
  from: Square,
  to: Square,
  promotion?: ChessPieceKind | null,
): boolean {
  if (!game) return false;

  const { move } = attemptMove(game, from, to, promotion ?? "queen");
  if (!move) return false;

  playMoveOnBoard(move, true);
  return true;
}

/**
 * Replays a whole game from the start and redraws it. This is the resync path:
 * the server's move list is the source of truth, and rebuilding from it is
 * cheaper than reasoning about how the two positions drifted apart.
 *
 * Returns false if any move in the list is illegal, which would mean the list
 * itself is corrupt — the board is then left alone rather than half-applied.
 */
export function resetPositionFromMoves(
  moves: { from: Square; to: Square; promotion?: ChessPieceKind | null }[],
): boolean {
  // Land anything still flying first, so its commit cannot overwrite what we
  // are about to draw.
  settlePendingSlide();

  let next = createGame();
  for (const entry of moves) {
    const { move } = attemptMove(next, entry.from, entry.to, entry.promotion ?? "queen");
    if (!move) {
      console.log("[ChessBoard] resync failed: illegal move in server list", entry);
      return false;
    }
    next = applyMove(next, move);
  }

  game = next;
  ply = moves.length;
  claimedPly = ply;

  renderPosition(game);
  refreshTints(game);
  clearChessSelection();
  clearMoveHints();

  const last = moves[moves.length - 1];
  if (last) showLastMove(last.from, last.to);

  return true;
}

function enableInput(): void {
  startChessInput({
    // Strict alternation: only the side to move can be picked up — and online,
    // only if that side is mine. `myColor: null` is the local hotseat board.
    canPickUp: (tile) => {
      if (!game || frozen || awaitingPromotion) return false;
      const square = tileToSquare(tile.tx, tile.ty);
      if (!square) return false;

      const side = pieceAt(game, square)?.side;
      if (side !== game.turn) return false;
      return binding.myColor == null || side === binding.myColor;
    },

    // Every square of the board swallows its clicks, even the ones we refuse to
    // move from: otherwise the game reads them as a walk order and rebuilds the
    // tile view under our pieces.
    isBoardSquare: (tile) => tileToSquare(tile.tx, tile.ty) != null,

    isLegalTarget: (fromTile, toTile) => {
      if (!game || frozen) return false;
      const from = tileToSquare(fromTile.tx, fromTile.ty);
      const to = tileToSquare(toTile.tx, toTile.ty);
      return !!from && !!to && findMove(game, from, to) != null;
    },

    showHints: (tile) => {
      if (!game) return;
      const square = tileToSquare(tile.tx, tile.ty);
      if (!square) return;
      showMoveHints(square, generateLegalMoves(game, square));
    },

    clearHints: clearMoveHints,

    playMove: tryMove,
  });
}

/* -------------------------------------------------------------------------- */
/* Setup / teardown                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Warns about decor ids MGData doesn't know, listing plausible matches - the
 * catalog is live game data, so the ids used here can drift.
 */
function warnAboutUnknownDecor(unknownIds: string[]): void {
  const catalogKeys = Object.keys(decorCatalog);
  const suggestions = unknownIds.map((id) => {
    const stem = id.replace(/^(Stone|Marble|Wood)/, "").slice(0, 5);
    const similar = catalogKeys.filter((key) =>
      stem ? key.toLowerCase().includes(stem.toLowerCase()) : false,
    );
    return { id, similar: similar.length ? similar : "(none)" };
  });
  console.log(
    "[ChessBoard] decor id(s) unknown to MGData, those pieces may render empty:",
    suggestions,
  );
}

/** Removes the board and restores every tile. Safe to call when nothing is painted. */
export function clearChessBoard(): boolean {
  const had = hasTouchedTiles();

  stopChessInput();
  stopChessSounds();
  teardownRender();
  game = null;
  ply = 0;
  claimedPly = 0;
  frozen = false;
  awaitingPromotion = false;
  binding = { myColor: null };
  restoreAllTiles();

  return had;
}

/**
 * Clears the garden, paints the board, sets the pieces up and enables dragging.
 * Re-running it restores the previous board first, so it can be called
 * repeatedly - and is how a finished game is reset.
 */
export async function paintChessBoard(
  options: ChessBoardOptions = {},
): Promise<ChessBoardResult | null> {
  if (!tos.isReady()) {
    console.log("[ChessBoard] tile system not ready yet");
    return null;
  }

  const garden = await readOwnGarden();
  if (!garden && (options.originX == null || options.originY == null)) {
    console.log("[ChessBoard] could not locate your garden tiles");
    return null;
  }

  const decorIds = { ...DEFAULT_PIECE_DECOR_IDS, ...options.pieceDecorIds };
  const shouldClearGarden = options.clearGarden !== false;
  const shouldPlacePieces = options.placePieces !== false;
  const shouldEnableInput = options.enableInput !== false && shouldPlacePieces;

  const config: RenderConfig = {
    originX: options.originX ?? garden!.originX + DEFAULT_GRID_INSET,
    originY: options.originY ?? garden!.originY + DEFAULT_GRID_INSET,
    lightColor: options.lightColor ?? DEFAULT_LIGHT_COLOR,
    darkColor: options.darkColor ?? DEFAULT_DARK_COLOR,
    alpha: options.alpha ?? DEFAULT_ALPHA,
    blackTint: options.blackTint ?? DEFAULT_BLACK_TINT,
    tintPieces: options.tintPieces !== false,
    decorIds,
    flipped: options.flipped ?? options.net?.myColor === "black",
  };

  const unknownIds = [...new Set(Object.values(decorIds))].filter(
    (id) => !(id in decorCatalog),
  );
  if (shouldPlacePieces && unknownIds.length) warnAboutUnknownDecor(unknownIds);

  clearChessBoard();

  let tilesCleared = 0;
  if (shouldClearGarden && garden) {
    for (const { tx, ty } of garden.tiles) {
      if (emptyTile(tx, ty)) tilesCleared++;
    }
  }

  if (!paintBoard(config)) {
    console.log("[ChessBoard] could not reach Pixi to paint the board");
    return null;
  }

  // Set after clearChessBoard(), which resets it — the board owns no binding
  // between games.
  if (options.net) binding = options.net;

  let piecesPlaced = 0;
  if (shouldPlacePieces) {
    game = createGame();
    ply = 0;
    claimedPly = 0;

    if (options.startFromMoves?.length) {
      for (const entry of options.startFromMoves) {
        const { move } = attemptMove(game, entry.from, entry.to, entry.promotion ?? "queen");
        if (!move) {
          console.log("[ChessBoard] illegal move in the replayed list", entry);
          break;
        }
        game = applyMove(game, move);
        ply += 1;
      }
      claimedPly = ply;
    }

    renderPosition(game);
    refreshTints(game);
    piecesPlaced = game.board.flat().filter(Boolean).length;

    const last = options.startFromMoves?.[options.startFromMoves.length - 1];
    if (last) showLastMove(last.from, last.to);

    // Warmed here so the first move doesn't wait on a download. Under Discord
    // this is a GM_xmlhttpRequest round trip per sample, so the opening chime
    // waits for it rather than playing into an empty cache.
    void preloadChessSounds().then(() => {
      if (game && ply === 0) playChessSound("gameStart");
    });
  }

  if (shouldEnableInput) enableInput();

  const result: ChessBoardResult = {
    originX: config.originX,
    originY: config.originY,
    size: BOARD_SIZE,
    tilesCleared,
    piecesPlaced,
    turn: game?.turn ?? null,
    inputEnabled: shouldEnableInput,
  };

  console.log("[ChessBoard] ready", {
    ...result,
    gardenSize: garden ? `${garden.cols}x${garden.rows}` : "unknown",
    decorIds,
  });

  return result;
}
