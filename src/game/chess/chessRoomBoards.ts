// src/game/chess/chessRoomBoards.ts
//
// The games being played by other people in your room, drawn on their gardens.
//
// You do not ask for these: walk into a room where two people are playing and
// both boards are there, on their own plots, moving as they move. They are
// read-only, so several can be up at once - and one more can be up alongside
// the board you are playing yourself.
//
// What this module owns:
//   - which matches deserve a board right now, and on whose garden,
//   - creating, updating and dropping those boards,
//   - swallowing clicks that land on them.
//
// That last one is not optional and does not come for free. chessBoardInput
// only exists while you are playing; with no game of your own there is nothing
// listening, and a click on someone else's board would walk your avatar onto it
// and make the game rebuild the tile view under their pieces.

import { fetchChessMatch, fetchChessMatches } from "@/api/endpoints/chess";
import { getCurrentPlayerId } from "@/api/init";
import { getActiveChessMatch } from "./chessSession";
import { triggerPlayerStateSyncNow } from "@/api/endpoints/state";
import { Atoms } from "@/store/atoms";
import { tos } from "@/game/tileObjectSystem";
import { shareGlobal } from "@/platform/page-context";
import type { ChessMatch } from "@/api/types";
import { createAmbientBoard, type AmbientBoard } from "./chessAmbientBoard";
import {
  AMBIENT_BOARD_CONFIG_DEFAULTS,
  buildGameFromRecords,
  gardenBoardOrigin,
} from "./chessBoardPresets";
import {
  findUserSlotIdx,
  readGarden,
  readSlotPlayerIdsForDebug,
  type OwnGarden,
} from "./chessBoardTiles";
import type { RenderConfig } from "./chessBoardLayout";
import type { ChessGame, Square } from "./chessRules";

/**
 * How often we check whether we have changed room. A local atom read, not a
 * request - the games themselves arrive on the stream and are never polled.
 */
const ROOM_WATCH_MS = 3000;

type RoomBoard = {
  matchId: number;
  board: AmbientBoard;
  game: ChessGame;
  ply: number;
  lastMove: { from: Square; to: Square } | null;
};

const boards = new Map<number, RoomBoard>();

/** Match ids the session is already showing itself, which we must not double up. */
let excludedMatchIds: number[] = [];

let roomWatchTimer: ReturnType<typeof setInterval> | null = null;
let detachClickGuard: (() => void) | null = null;
let syncing = false;
let syncPending = true;
let currentRoomId: string | null = null;

// ── Click guard ──────────────────────────────────────────────────────────────

function tileIsOnARoomBoard(tx: number, ty: number): boolean {
  for (const entry of boards.values()) {
    if (entry.board.coversTile(tx, ty)) return true;
  }
  return false;
}

/**
 * Eats any pointer event landing on one of these boards. Registered in the
 * capture phase so it runs before the game's own handlers rather than after
 * them, and on the canvas so the rest of the page is untouched.
 */
function attachClickGuard(): void {
  if (detachClickGuard) return;

  const canvas = tos.getCanvas?.();
  if (!canvas) return;

  const swallow = (ev: PointerEvent | MouseEvent): void => {
    if (boards.size === 0) return;
    try {
      const tile = tos.pointerToFarmTile(ev as PointerEvent);
      if (!tile || !tileIsOnARoomBoard(tile.tx, tile.ty)) return;
    } catch {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
  };

  const events: (keyof HTMLElementEventMap)[] = ["pointerdown", "pointerup", "click"];
  for (const name of events) {
    canvas.addEventListener(name, swallow as EventListener, true);
  }

  detachClickGuard = () => {
    for (const name of events) {
      canvas.removeEventListener(name, swallow as EventListener, true);
    }
  };
}

// ── Board lifecycle ──────────────────────────────────────────────────────────

function dropBoard(matchId: number): void {
  const entry = boards.get(matchId);
  if (!entry) return;
  entry.board.destroy();
  boards.delete(matchId);
}

function dropAllBoards(): void {
  for (const matchId of [...boards.keys()]) dropBoard(matchId);
}

/** The garden of whichever player of this match is here, or null. */
async function findHostGarden(
  match: ChessMatch,
): Promise<{ config: RenderConfig; garden: OwnGarden } | null> {
  const me = getCurrentPlayerId();

  for (const player of [match.white, match.black]) {
    if (!player.playerId || player.playerId === me) continue;

    const slotIdx = await findUserSlotIdx(player.playerId);
    if (slotIdx == null) continue;

    const garden = await readGarden(slotIdx);
    if (!garden) continue;

    const origin = gardenBoardOrigin(garden);
    return {
      garden,
      config: {
        ...AMBIENT_BOARD_CONFIG_DEFAULTS,
        originX: origin.originX,
        originY: origin.originY,
        // Onlookers all get the same view, so everyone in the room is looking
        // at the same board the same way up.
        flipped: false,
      },
    };
  }

  return null;
}

async function addBoard(match: ChessMatch): Promise<boolean> {
  const host = await findHostGarden(match);
  if (!host) {
    // Neither player could be placed in a garden here. Usually that just means
    // they are not in this room; when they are, it is the slot lookup failing,
    // which is silent and would otherwise look like "the feature is broken".
    console.log("[ChessRoomBoards] no garden for match", match.id, {
      white: match.white.playerId,
      black: match.black.playerId,
      slots: await readSlotPlayerIdsForDebug(),
    });
    return false;
  }

  // The list endpoint leaves the moves out, so the position has to be asked for.
  const full = await fetchChessMatch(match.id);
  if (!full?.moves) return false;
  if (boards.has(match.id)) return true;

  const built = buildGameFromRecords(full.moves);
  if (!built) return false;

  const board = createAmbientBoard({
    key: `room:${match.id}`,
    config: host.config,
    garden: host.garden,
    game: built.game,
    lastMove: built.lastMove,
  });
  if (!board) return false;

  boards.set(match.id, {
    matchId: match.id,
    board,
    game: built.game,
    ply: full.moves.length,
    lastMove: built.lastMove,
  });

  attachClickGuard();
  return true;
}

// ── Which boards should exist ────────────────────────────────────────────────

/** The room's current games, straight from the server. */
async function fetchRoomMatches(): Promise<ChessMatch[]> {
  const matches = await fetchChessMatches({ status: "active", scope: "room" });
  return matches.filter((match) => !excludedMatchIds.includes(match.id));
}

/**
 * Brings the set of boards in line with the room. Returns false when it could
 * not even try - the tile system not being up yet is the usual reason, and the
 * caller has to come back rather than assume it is done.
 */
async function syncBoards(): Promise<boolean> {
  if (syncing) return false;
  if (!tos.isReady()) return false;

  syncing = true;
  try {
    const wanted = await fetchRoomMatches();
    const wantedIds = new Set(wanted.map((match) => match.id));

    for (const matchId of [...boards.keys()]) {
      if (!wantedIds.has(matchId)) dropBoard(matchId);
    }

    let complete = true;
    for (const match of wanted) {
      if (boards.has(match.id)) continue;
      if (!(await addBoard(match))) complete = false;
    }

    return complete;
  } finally {
    syncing = false;
  }
}

/**
 * Our own room, as the game knows it. The server learns it from collect-state,
 * which is why changing room forces a report before anything is asked of it.
 */
async function readOwnRoomId(): Promise<string | null> {
  try {
    const state = (await Atoms.root.state.get().catch(() => null)) as any;
    const roomId = state?.data?.roomId ?? state?.fullState?.data?.roomId ?? state?.roomId;
    return typeof roomId === "string" ? roomId : null;
  } catch {
    return null;
  }
}

/**
 * Walking into a room where a game is already running produces no event - it
 * started before we got here. So the set is rebuilt on every room change, and
 * only then.
 *
 * The forced report matters: the server places us by our last collect-state,
 * which otherwise goes out on a 60s beat. Asking for `scope=room` before it
 * would answer for the room we just left.
 */
async function tick(): Promise<void> {
  const roomId = await readOwnRoomId();

  if (roomId !== currentRoomId) {
    currentRoomId = roomId;
    dropAllBoards();
    syncPending = true;
    await triggerPlayerStateSyncNow({ force: true }).catch(() => {});
  }

  // Retried until it actually lands. At startup the tile system is usually not
  // up yet, and the first attempt does nothing - committing the room id and
  // moving on would leave the room boardless until the player walked out and
  // back in again.
  if (!syncPending) return;
  if (await syncBoards()) syncPending = false;
}

// ── Keeping them up to date ──────────────────────────────────────────────────

/** A move broadcast to the room, for a board we are showing. */
export function applyRoomBoardMove(
  matchId: number,
  ply: number,
  from: string,
  to: string,
  promotion: string | null | undefined,
): void {
  const entry = boards.get(matchId);
  if (!entry || ply <= entry.ply) return;

  const built = buildGameFromRecords([{ from, to, promotion }], entry.game);
  if (!built) {
    // Our position and the server's have drifted; rebuilding is the only
    // honest answer, and it costs one request on a board nobody is playing.
    void rebuildBoard(matchId);
    return;
  }

  entry.game = built.game;
  entry.ply = ply;
  entry.lastMove = built.lastMove;

  // Slid rather than redrawn: the piece has to be seen leaving its square, the
  // same way it is on the board being played.
  if (built.lastMove && built.lastSteps.length) {
    entry.board.playMove(built.lastSteps, built.game, built.lastMove);
  } else {
    entry.board.update(built.game, built.lastMove);
  }
}

async function rebuildBoard(matchId: number): Promise<void> {
  const entry = boards.get(matchId);
  if (!entry) return;

  const full = await fetchChessMatch(matchId);
  if (!full?.moves || !boards.has(matchId)) return;

  const built = buildGameFromRecords(full.moves);
  if (!built) return;

  entry.game = built.game;
  entry.ply = full.moves.length;
  entry.lastMove = built.lastMove;
  entry.board.update(built.game, built.lastMove);
}

/** A game started in the room: put a board up if one of its players is here. */
export function addRoomBoardForMatch(match: ChessMatch): void {
  if (excludedMatchIds.includes(match.id) || boards.has(match.id)) return;
  void addBoard(match).then((added) => {
    // Could not place it yet; the loop keeps trying.
    if (!added) syncPending = true;
  });
}

export function dropRoomBoard(matchId: number): void {
  dropBoard(matchId);
}

// ── Public control ───────────────────────────────────────────────────────────

/** Match ids the session is drawing itself, so we do not draw them twice. */
export function setExcludedRoomMatches(matchIds: number[]): void {
  excludedMatchIds = matchIds;
  for (const matchId of matchIds) dropBoard(matchId);
}

export function startRoomBoards(): void {
  if (roomWatchTimer) return;

  // No polling of the games themselves: moves, ends and starts are all
  // broadcast to the room. This timer only watches for us changing room, which
  // the game gives us locally and costs nothing to read.
  syncPending = true;
  roomWatchTimer = setInterval(() => void tick(), ROOM_WATCH_MS);
  void tick();
}

/**
 * Console probe: window.__MG_CHESS_ROOM__(). Says what the room looks like from
 * here - our own id and room, who the game thinks is in each garden slot, which
 * matches the server is willing to show us, and which boards are up.
 *
 * Every one of those is a place the chain can break silently, and none of them
 * is visible from the screen.
 */
async function describeRoomBoards(): Promise<unknown> {
  const [roomMatches, myMatches] = await Promise.all([
    fetchChessMatches({ status: "active", scope: "room" }).catch(() => []),
    fetchChessMatches({ status: "active", scope: "me" }).catch(() => []),
  ]);

  const active = getActiveChessMatch();

  return {
    me: getCurrentPlayerId(),
    roomId: currentRoomId,
    /**
     * The ids the chess server uses for the two players of the game on screen.
     * Comparing these with slotPlayerIds is the whole question: if they are not
     * the same strings, no board can ever be placed on anyone's garden.
     */
    activeMatch: active
      ? {
          id: active.id,
          status: active.status,
          white: active.white.playerId,
          black: active.black.playerId,
        }
      : null,
    myActiveMatches: myMatches.map((m) => ({
      id: m.id,
      white: m.white.playerId,
      black: m.black.playerId,
    })),
    tosReady: tos.isReady(),
    syncPending,
    slotPlayerIds: await readSlotPlayerIdsForDebug(),
    roomMatches: roomMatches.map((m) => ({
      id: m.id,
      white: m.white.playerId,
      black: m.black.playerId,
    })),
    boardsUp: [...boards.keys()],
    excluded: excludedMatchIds,
  };
}

// Through shareGlobal, not window: the userscript can run in a sandbox whose
// window is not the page's, and the console reads the page's.
shareGlobal("__MG_CHESS_ROOM__", describeRoomBoards);

export function stopRoomBoards(): void {
  if (roomWatchTimer) clearInterval(roomWatchTimer);
  roomWatchTimer = null;
  currentRoomId = null;
  syncPending = true;

  dropAllBoards();
  detachClickGuard?.();
  detachClickGuard = null;
}
