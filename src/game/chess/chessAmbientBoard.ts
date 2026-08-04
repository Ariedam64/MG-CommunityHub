// src/game/chess/chessAmbientBoard.ts
//
// A game happening elsewhere in the room, drawn on its own player's garden.
//
// Read-only on purpose, and that is what makes several of them possible at
// once. The playable board keeps state at module level - one layout, one set of
// overlays, one input handler - because there is only ever one of it. An
// ambient board carries all of its own state instead, so a room with three
// games running has three of these and no argument about whose turn it is.
//
// Two things here are not obvious.
//
// It dresses the whole garden, not just the eight-by-eight: clearing it and
// laying the scenery is what makes the board read as a board rather than as
// pieces standing between someone's eggs and carrots.
//
// And it re-asserts its tiles on a timer. Writing a tile view is not durable -
// the game rebuilds those views on its own, and a *neighbour's* garden is
// refreshed from the server far more often than your own, because their plants
// grow and they harvest. Without the re-assert the board is quietly eaten
// within seconds of being drawn.

import { createOverlay, removeOverlay, type Overlay } from "./chessOverlay";
import {
  FARM_TILE_SIZE,
  emptyTile,
  placeDecorTile,
  readTileObject,
  restoreTilesOf,
  type OwnGarden,
} from "./chessBoardTiles";
import {
  OVERLAY_Z_INDEX,
  squareToTileIn,
  type RenderConfig,
} from "./chessBoardLayout";
import { clearTintedBoard, setTintedBoard } from "./chessBoardTint";
import { createSlideController, type SlideStep } from "./chessSlide";
import { applyChessScenery } from "./chessScenery";
import { BOARD_SIZE, pieceAt, type ChessGame, type Square } from "./chessRules";

/** Matches the playable board's own last-move highlight. */
const LAST_MOVE_COLOR = 0x4ade80;
const LAST_MOVE_ALPHA = 0.3;

/**
 * How often the tiles are checked against what they should hold. Only the ones
 * that drifted are rewritten, so a quiet board costs 64 reads and no writes.
 */
const REASSERT_MS = 700;

export type AmbientBoardOptions = {
  /** Distinguishes this board's tiles and tint from every other board's. */
  key: string;
  config: RenderConfig;
  /** The garden it is drawn on, cleared and dressed before the board goes down. */
  garden: OwnGarden;
  game: ChessGame;
  lastMove?: { from: Square; to: Square } | null;
};

export type AmbientBoard = {
  readonly key: string;
  readonly config: RenderConfig;
  update(game: ChessGame, lastMove?: { from: Square; to: Square } | null): void;
  /**
   * Slides the pieces of a move, then adopts the position it leads to. Same
   * order as the playable board: the position is only written once the piece
   * has landed, or the square empties before anything appears to move.
   */
  playMove(steps: SlideStep[], next: ChessGame, lastMove: { from: Square; to: Square }): void;
  /** True while the tile at these map coords belongs to this board. */
  coversTile(tx: number, ty: number): boolean;
  destroy(): void;
};

function fillSquare(
  gfx: any,
  config: RenderConfig,
  square: Square,
  color: number,
  alpha: number,
): void {
  const { tx, ty } = squareToTileIn(config, square);
  gfx
    .rect(tx * FARM_TILE_SIZE, ty * FARM_TILE_SIZE, FARM_TILE_SIZE, FARM_TILE_SIZE)
    .fill({ color, alpha });
}

/** Whether a tile already holds the decor we want, so we can skip rewriting it. */
function tileHoldsDecor(tx: number, ty: number, decorId: string | null): boolean {
  const current = readTileObject(tx, ty);
  if (decorId == null) return current == null;
  return current?.objectType === "decor" && current?.decorId === decorId;
}

export function createAmbientBoard(options: AmbientBoardOptions): AmbientBoard | null {
  const { key, config, garden } = options;

  const squares = createOverlay(OVERLAY_Z_INDEX.board);
  if (!squares) return null;

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const isDark = (col + row) % 2 === 1;
      fillSquare(
        squares.gfx,
        config,
        { col, row },
        isDark ? config.darkColor : config.lightColor,
        config.alpha,
      );
    }
  }

  let lastMoveOverlay: Overlay | null = null;
  let position: ChessGame = options.game;
  let destroyed = false;
  let reassertTimer: ReturnType<typeof setInterval> | null = null;
  const slide = createSlideController(() => config);
  let sliding = false;

  /** Empties the host's garden and lays the chess setting over it. */
  function dressGarden(): void {
    for (const tile of garden.tiles) emptyTile(tile.tx, tile.ty, key);
    applyChessScenery(garden, key);
  }

  /** Writes only the squares that are not already showing the right piece. */
  function drawPieces(game: ChessGame, force: boolean): void {
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const { tx, ty } = squareToTileIn(config, { col, row });
        const piece = pieceAt(game, { col, row });
        const decorId = piece ? config.decorIds[piece.kind] : null;

        if (!force && tileHoldsDecor(tx, ty, decorId)) continue;

        if (decorId) placeDecorTile(tx, ty, decorId, key);
        else emptyTile(tx, ty, key);
      }
    }
  }

  function drawLastMove(move: { from: Square; to: Square } | null | undefined): void {
    lastMoveOverlay = removeOverlay(lastMoveOverlay);
    if (!move) return;

    const overlay = createOverlay(OVERLAY_Z_INDEX.lastMove);
    if (!overlay) return;

    fillSquare(overlay.gfx, config, move.from, LAST_MOVE_COLOR, LAST_MOVE_ALPHA);
    fillSquare(overlay.gfx, config, move.to, LAST_MOVE_COLOR, LAST_MOVE_ALPHA);
    lastMoveOverlay = overlay;
  }

  function update(game: ChessGame, lastMove?: { from: Square; to: Square } | null): void {
    if (destroyed) return;
    position = game;
    drawPieces(game, true);
    drawLastMove(lastMove);
    setTintedBoard(key, game, config);
  }

  /**
   * Puts back whatever the game has overwritten since the last pass. The
   * scenery goes through the same check, so a plant that grew back over a bench
   * is caught too.
   */
  function reassert(): void {
    if (destroyed || sliding) return;
    // Never during a trip: the piece in flight is a tile view we have moved out
    // of place, and rewriting it mid-journey snaps it back.
    drawPieces(position, false);
    applyChessScenery(garden, key, { onlyIfChanged: true });
  }

  dressGarden();
  update(options.game, options.lastMove);
  reassertTimer = setInterval(reassert, REASSERT_MS);

  return {
    key,
    config,
    update,

    playMove(steps, next, lastMove): void {
      if (destroyed) return;

      sliding = true;
      slide.run(steps, () => {
        sliding = false;
        if (destroyed) return;
        update(next, lastMove);
      });
    },

    coversTile(tx: number, ty: number): boolean {
      const col = tx - config.originX;
      const row = ty - config.originY;
      return col >= 0 && col < BOARD_SIZE && row >= 0 && row < BOARD_SIZE;
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;

      if (reassertTimer) clearInterval(reassertTimer);
      reassertTimer = null;
      slide.abort();

      removeOverlay(squares);
      lastMoveOverlay = removeOverlay(lastMoveOverlay);
      clearTintedBoard(key);

      // Only ours. A neighbour's board may still be up on another garden, and
      // the board you are playing certainly is.
      restoreTilesOf(key);
    },
  };
}
