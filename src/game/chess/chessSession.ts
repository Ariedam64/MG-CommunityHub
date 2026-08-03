// src/game/chess/chessSession.ts
//
// Owner of the chess board.
//
// The garden is an exclusive resource: there is one place a board can be drawn,
// and its tiles must be restored whatever happens. So one module holds it, and
// everything else — the player view, the challenge prompts, the stream — goes
// through here. Nothing else calls paintChessBoard.
//
//   idle ── match started / welcome ──▶ arming ── tiles ready ──▶ playing
//   idle ── watch(matchId) ───────────▶ arming ── tiles ready ──▶ spectating
//   playing | spectating ── ended / leave ──▶ idle

import {
  acceptChessChallenge,
  claimChessTimeout,
  fetchChessMatch,
  fetchChessMovesSince,
  postChessDraw,
  postChessMove,
  resignChessMatch,
  sendChessChallenge,
} from "@/api/endpoints/chess";
import { getCurrentPlayerId } from "@/api/init";
import { addCachedChessChallenge, invalidateFriendChessMatches } from "@/api/cache/chess";
import { isDiscordActivityContext } from "@/platform/discordCsp";
import { toastSimple } from "@/ui/toast";
import { createChessHud, type ChessHudController } from "@/ui/hub/chessHud";
import { CH_EVENTS } from "@/ui/hub/shared";
import { tos } from "@/game/tileObjectSystem";
import type {
  ChessChallenge,
  ChessColor,
  ChessColorChoice,
  ChessMatch,
  ChessMatchEndedEvent,
  ChessMoveEvent,
  ChessMoveRecord,
  ChessPromotion,
} from "@/api/types";
import {
  applyRemoteMove,
  bindChessNet,
  clearChessBoard,
  getChessClaimedPly,
  getChessPly,
  paintChessBoard,
  resetPositionFromMoves,
  setChessBoardFrozen,
} from "./chessBoard";
import { playChessSound } from "./chessBoardSounds";
import { resetChessClock, readChessClock, stopChessClock, syncChessClock } from "./chessClock";
import { parseSquare, squareToName } from "./chessNotation";
import type { ChessPieceKind } from "./chessRules";

/** How often we retry mounting while the tile system is not ready yet. */
const ARM_RETRY_MS = 500;

/** Grace before claiming a win on time, to absorb network jitter. */
const TIMEOUT_CLAIM_GRACE_MS = 2000;

/**
 * Spectator polling. Spectators get no events by design, so they ask. Slower
 * under Discord, where every HTTP request pauses the long-poll that carries
 * this player's own messages.
 */
const SPECTATE_POLL_MS = 3000;
const SPECTATE_POLL_MS_DISCORD = 5000;

/** Set while a board is mounted, so a second mod cannot paint over ours. */
const BOARD_OWNER_FLAG = "__MG_CHESS_BOARD_OWNER__";

export type ChessSessionState = "idle" | "arming" | "playing" | "spectating";

type Session = {
  state: ChessSessionState;
  match: ChessMatch;
  role: "player" | "spectator";
  myColor: ChessColor | null;
  hud: ChessHudController | null;
  armTimer: ReturnType<typeof setTimeout> | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  /** Suppresses the clock/flag logic once the game is over. */
  finished: boolean;
  /** Set while a resync is in flight, so moves are not applied on a stale board. */
  resyncing: boolean;
};

let session: Session | null = null;
const listeners = new Set<() => void>();

// ── Public state ─────────────────────────────────────────────────────────────

export function getChessSessionState(): ChessSessionState {
  return session?.state ?? "idle";
}

export function getActiveChessMatch(): ChessMatch | null {
  return session?.match ?? null;
}

/** True while the garden is taken — a second board cannot be mounted. */
export function isChessBoardBusy(): boolean {
  return session != null;
}

export function onChessSessionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* one broken listener must not stop the others */
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function myColorIn(match: ChessMatch): ChessColor | null {
  const me = getCurrentPlayerId();
  if (!me) return null;
  if (match.white.playerId === me) return "white";
  if (match.black.playerId === me) return "black";
  return null;
}

function opponentName(match: ChessMatch, myColor: ChessColor | null): string {
  return (myColor === "white" ? match.black.name : match.white.name) ?? "Opponent";
}

function toBoardMoves(moves: ChessMoveRecord[] | undefined) {
  const parsed: { from: any; to: any; promotion?: ChessPieceKind | null }[] = [];
  for (const move of moves ?? []) {
    const from = parseSquare(move.from);
    const to = parseSquare(move.to);
    if (!from || !to) {
      console.log("[ChessSession] unparsable square in move list", move);
      return null;
    }
    parsed.push({ from, to, promotion: (move.promotion as ChessPieceKind) ?? null });
  }
  return parsed;
}

function resultText(match: ChessMatch, myColor: ChessColor | null): string {
  const reason = {
    checkmate: "Checkmate",
    stalemate: "Stalemate",
    resign: "Resignation",
    timeout: "On time",
    agreement: "By agreement",
  }[match.reason ?? "checkmate"];

  if (match.result === "draw") return `Draw — ${reason?.toLowerCase() ?? "agreed"}`;
  if (!myColor) return `${match.result === "white" ? "White" : "Black"} wins — ${reason}`;
  return match.result === myColor ? `You win — ${reason}` : `You lose — ${reason}`;
}

// ── Mounting ─────────────────────────────────────────────────────────────────

function claimBoardOwnership(): boolean {
  const held = (window as any)[BOARD_OWNER_FLAG];
  if (held && held !== "mg-community-hub") return false;
  (window as any)[BOARD_OWNER_FLAG] = "mg-community-hub";
  return true;
}

function releaseBoardOwnership(): void {
  if ((window as any)[BOARD_OWNER_FLAG] === "mg-community-hub") {
    delete (window as any)[BOARD_OWNER_FLAG];
  }
}

/**
 * Starts a session for a match. The HUD comes up immediately, even if the board
 * cannot be drawn yet: the clock is already running on the server, and a player
 * staring at nothing while their time burns is the one outcome to avoid.
 */
function beginSession(match: ChessMatch, role: "player" | "spectator"): void {
  if (session) return;

  if (!claimBoardOwnership()) {
    void toastSimple("Chess", "Another mod is already using the garden board.", "warn");
    return;
  }

  const myColor = role === "player" ? myColorIn(match) : null;

  session = {
    state: "arming",
    match,
    role,
    myColor,
    hud: null,
    armTimer: null,
    pollTimer: null,
    timeoutTimer: null,
    finished: match.status === "finished",
    resyncing: false,
  };

  syncChessClock(match.clock, match.status === "active");
  session.hud = createChessHud({
    role,
    white: match.white.name ?? "White",
    black: match.black.name ?? "Black",
    myColor,
    onResign: () => void doResign(),
    onOfferDraw: () => void doDraw("offer"),
    onAcceptDraw: () => void doDraw("accept"),
    onDeclineDraw: () => void doDraw("decline"),
    onLeave: () => void leaveChessSession(),
  });

  if (match.drawOfferedBy) {
    const me = getCurrentPlayerId();
    session.hud.setDrawOffer(match.drawOfferedBy === me ? "me" : "them");
  }

  notify();
  void armBoard();
}

/** Retries painting until the tile system and the garden are both available. */
async function armBoard(): Promise<void> {
  if (!session || session.state !== "arming") return;

  if (!tos.isReady()) {
    session.hud?.setStatusText("Waiting for the garden…");
    session.armTimer = setTimeout(() => void armBoard(), ARM_RETRY_MS);
    return;
  }

  const boardMoves = toBoardMoves(session.match.moves);
  if (boardMoves == null) {
    session.hud?.setStatusText("Could not read the move list.");
    return;
  }

  const result = await paintChessBoard({
    startFromMoves: boardMoves,
    enableInput: session.role === "player",
    net:
      session.role === "player"
        ? {
            myColor: session.myColor,
            onLocalMove: (move, ply) => {
              void sendMove(ply, squareToName(move.from), squareToName(move.to), move.promotion ?? null);
            },
            requestPromotion: async () =>
              (await session?.hud?.askPromotion()) ?? null,
          }
        : { myColor: session.myColor },
  });

  // Torn down while we were awaiting.
  if (!session || session.state !== "arming") return;

  if (!result) {
    session.hud?.setStatusText("Could not draw the board — retrying…");
    session.armTimer = setTimeout(() => void armBoard(), ARM_RETRY_MS);
    return;
  }

  session.state = session.role === "player" ? "playing" : "spectating";
  session.hud?.setStatusText(null);

  // The panel covers the garden, and the garden is now the board. The floating
  // hub button stays, so reopening it during a game is one click away.
  window.dispatchEvent(new CustomEvent(CH_EVENTS.CLOSE));

  if (session.finished) {
    setChessBoardFrozen(true);
    session.hud?.setResult(resultText(session.match, session.myColor));
    stopChessClock();
  } else {
    scheduleTimeoutClaim();
    if (session.role === "spectator") startSpectatorPolling();
  }

  notify();
}

// ── Leaving ──────────────────────────────────────────────────────────────────

/** Tears the board down and restores the garden. Safe to call repeatedly. */
export function leaveChessSession(): void {
  if (!session) return;

  if (session.armTimer) clearTimeout(session.armTimer);
  if (session.pollTimer) clearInterval(session.pollTimer);
  if (session.timeoutTimer) clearTimeout(session.timeoutTimer);
  session.hud?.destroy();
  session = null;

  clearChessBoard();
  resetChessClock();
  releaseBoardOwnership();
  notify();
}

// ── Outgoing actions ─────────────────────────────────────────────────────────

export async function challengePlayer(
  opponentId: string,
  color: ChessColorChoice = "random",
): Promise<boolean> {
  if (isChessBoardBusy()) {
    void toastSimple("Chess", "Finish your current game first.", "warn");
    return false;
  }

  const outcome = (await sendChessChallenge(opponentId, color)) as {
    ok: boolean;
    status?: number;
    challenge?: ChessChallenge;
  };

  if (outcome.ok) {
    // chess_challenge only goes to the opponent, so the sender never hears
    // about its own challenge. Cache it here or the button never flips to
    // "sent" until the next welcome.
    if (outcome.challenge) addCachedChessChallenge(outcome.challenge, "outgoing");
    return true;
  }

  const message: string =
    (
      {
        403: "You can only challenge friends.",
        409: "There is already a challenge pending, or one of you is in a game.",
        404: "That player was not found.",
      } as Record<number, string>
    )[outcome.status] ?? "Could not send the challenge.";

  void toastSimple("Chess", message, "error");
  invalidateFriendChessMatches();
  return false;
}

export async function acceptChallengeAndPlay(challengeId: number): Promise<boolean> {
  const outcome = await acceptChessChallenge(challengeId);
  if (outcome.ok) {
    // The board is mounted from chess_match_started, which both players get —
    // not from this response, so the two sides follow the exact same path.
    return true;
  }

  void toastSimple("Chess", "That challenge is no longer available.", "warn");
  return false;
}

/** Opens a board in spectator mode. */
export async function watchChessMatch(matchId: number): Promise<boolean> {
  if (isChessBoardBusy()) {
    void toastSimple("Chess", "Leave your current board first.", "warn");
    return false;
  }

  const match = await fetchChessMatch(matchId);
  if (!match) {
    void toastSimple("Chess", "Could not open that game.", "error");
    return false;
  }

  beginSession(match, "spectator");
  return true;
}

async function doResign(): Promise<void> {
  // The HUD asks for confirmation itself (two-step button), so by the time this
  // runs the player has already said yes twice.
  if (!session || session.role !== "player" || session.finished) return;

  const match = await resignChessMatch(session.match.id);
  if (match) applyMatchState(match);
}

async function doDraw(action: "offer" | "accept" | "decline"): Promise<void> {
  if (!session || session.role !== "player" || session.finished) return;

  const outcome = await postChessDraw(session.match.id, action, session.match.ply);
  if (!outcome.ok) {
    // The position moved on since the offer — the server refuses, we recalibrate.
    void toastSimple("Chess", "That draw offer is no longer valid.", "warn");
    await resyncFromServer();
    return;
  }

  if (outcome.match) applyMatchState(outcome.match);
  else if (action === "offer") session.hud?.setDrawOffer("me");
  else session.hud?.setDrawOffer(null);
}

// ── Moves ────────────────────────────────────────────────────────────────────

/**
 * Sends a move that has already been played locally. A ply conflict or a
 * rejected move both mean the two positions had drifted, and both are answered
 * the same way: rebuild from what the server says.
 */
async function sendMove(
  ply: number,
  from: string,
  to: string,
  promotion: ChessPieceKind | null,
): Promise<void> {
  if (!session || session.role !== "player") return;

  const matchId = session.match.id;
  const outcome = await postChessMove(matchId, {
    ply,
    from,
    to,
    promotion: (promotion as ChessPromotion) ?? null,
  });

  if (!session || session.match.id !== matchId) return;

  switch (outcome.kind) {
    case "ok":
      applyMatchState(outcome.match);
      break;

    case "desync":
      if (outcome.match) applyMatchState(outcome.match, { replay: true });
      else await resyncFromServer();
      break;

    case "illegal":
      void toastSimple("Chess", "The server refused that move.", "warn");
      await resyncFromServer();
      break;

    case "error":
      void toastSimple("Chess", "Your move did not reach the server.", "error");
      await resyncFromServer();
      break;
  }
}

/** A move that arrived on the stream, for either player. */
export function handleChessMoveEvent(event: ChessMoveEvent): void {
  invalidateFriendChessMatches();
  if (!session || session.match.id !== event.matchId || session.resyncing) return;

  syncChessClock(event.clock, true);
  session.match = { ...session.match, ply: event.ply, turn: event.turn, drawOfferedBy: null };
  session.hud?.setDrawOffer(null);

  // Claimed, not played: our own move is echoed back to us and can arrive while
  // its piece is still sliding. Comparing against the committed count would make
  // it look like the opponent's reply and play it twice.
  const localPly = getChessClaimedPly();

  // Our own move coming back, or one we already applied.
  if (event.ply <= localPly) {
    scheduleTimeoutClaim();
    return;
  }

  // Exactly the next move: play it.
  if (event.ply === localPly + 1) {
    const from = parseSquare(event.from);
    const to = parseSquare(event.to);
    const applied =
      from && to && applyRemoteMove(from, to, (event.promotion as ChessPieceKind) ?? null);

    if (!applied) void resyncFromServer();
    scheduleTimeoutClaim();
    return;
  }

  // We missed something — under Discord the long-poll pauses during every HTTP
  // request, so this is not hypothetical.
  void catchUpMoves();
}

export function handleChessMatchEnded(event: ChessMatchEndedEvent): void {
  invalidateFriendChessMatches();
  if (!session || session.match.id !== event.matchId) return;

  session.match = {
    ...session.match,
    status: "finished",
    result: event.result,
    reason: event.reason,
  };
  finishSession();
}

export function handleChessMatchStarted(match: ChessMatch): void {
  invalidateFriendChessMatches();

  // Already on this board (a duplicate event, or the welcome after it).
  if (session?.match.id === match.id) {
    applyMatchState(match);
    return;
  }
  if (session) return;

  if (!myColorIn(match)) return;
  beginSession(match, "player");
}

export function handleChessDrawOffer(matchId: number, by: string): void {
  if (!session || session.match.id !== matchId) return;
  session.match = { ...session.match, drawOfferedBy: by };
  session.hud?.setDrawOffer(by === getCurrentPlayerId() ? "me" : "them");
}

export function handleChessDrawDeclined(matchId: number): void {
  if (!session || session.match.id !== matchId) return;
  session.match = { ...session.match, drawOfferedBy: null };
  session.hud?.setDrawOffer(null);
  void toastSimple("Chess", "Your draw offer was declined.", "info");
}

/**
 * Adopts a match payload. `replay` rebuilds the position from its move list —
 * used when we know we had drifted.
 */
function applyMatchState(match: ChessMatch, options: { replay?: boolean } = {}): void {
  if (!session || session.match.id !== match.id) return;

  session.match = { ...session.match, ...match };
  syncChessClock(match.clock, match.status === "active");

  if (options.replay && match.moves) {
    const boardMoves = toBoardMoves(match.moves);
    if (boardMoves) resetPositionFromMoves(boardMoves);
  }

  const me = getCurrentPlayerId();
  session.hud?.setDrawOffer(
    match.drawOfferedBy ? (match.drawOfferedBy === me ? "me" : "them") : null,
  );

  if (match.status === "finished") finishSession();
  else scheduleTimeoutClaim();
}

function finishSession(): void {
  if (!session || session.finished) return;

  session.finished = true;
  if (session.pollTimer) clearInterval(session.pollTimer);
  if (session.timeoutTimer) clearTimeout(session.timeoutTimer);
  session.pollTimer = null;
  session.timeoutTimer = null;

  stopChessClock();
  setChessBoardFrozen(true);
  playChessSound("gameEnd");
  session.hud?.setResult(resultText(session.match, session.myColor));
  notify();
}

// ── Resynchronisation ────────────────────────────────────────────────────────

/** Pulls the whole match and rebuilds from it. The blunt, always-correct path. */
async function resyncFromServer(): Promise<void> {
  if (!session || session.resyncing) return;

  const matchId = session.match.id;
  session.resyncing = true;

  try {
    const match = await fetchChessMatch(matchId);
    if (!session || session.match.id !== matchId || !match) return;
    applyMatchState(match, { replay: true });
  } finally {
    if (session) session.resyncing = false;
  }
}

/**
 * Plays a run of moves onto the board. Returns false the moment one does not
 * fit, which means the list and the board had already diverged.
 */
function applyMoveRecords(records: ChessMoveRecord[]): boolean {
  for (const record of records) {
    if (record.ply <= getChessPly()) continue;

    const from = parseSquare(record.from);
    const to = parseSquare(record.to);
    if (!from || !to) return false;
    if (!applyRemoteMove(from, to, (record.promotion as ChessPieceKind) ?? null)) return false;
  }
  return true;
}

/** Cheaper resync when we only missed a few moves. */
async function catchUpMoves(): Promise<void> {
  if (!session || session.resyncing) return;

  const matchId = session.match.id;
  const since = getChessPly();
  session.resyncing = true;

  let needsFullResync = false;
  try {
    const payload = await fetchChessMovesSince(matchId, since);
    if (!session || session.match.id !== matchId) return;

    if (!payload) {
      needsFullResync = true;
      return;
    }

    syncChessClock(payload.clock, true);

    if (!applyMoveRecords(payload.moves)) {
      needsFullResync = true;
      return;
    }

    session.match = { ...session.match, ply: payload.ply };
  } finally {
    if (session) session.resyncing = false;
  }

  if (needsFullResync) await resyncFromServer();
}

// ── Spectating ───────────────────────────────────────────────────────────────

function startSpectatorPolling(): void {
  if (!session || session.pollTimer) return;

  const interval = isDiscordActivityContext() ? SPECTATE_POLL_MS_DISCORD : SPECTATE_POLL_MS;
  session.pollTimer = setInterval(() => {
    if (!session || session.finished) return;
    void pollSpectatedMatch();
  }, interval);
}

async function pollSpectatedMatch(): Promise<void> {
  if (!session || session.resyncing) return;

  const matchId = session.match.id;
  const payload = await fetchChessMovesSince(matchId, getChessPly());
  if (!session || session.match.id !== matchId || !payload) return;

  syncChessClock(payload.clock, true);
  session.match = { ...session.match, ply: payload.ply };

  // Applied straight from this response — asking again for the same moves would
  // double the polling cost, and under Discord each request pauses the long-poll
  // carrying this player's own messages.
  if (!applyMoveRecords(payload.moves)) {
    await resyncFromServer();
    return;
  }

  // The move feed never says a game has ended, so ask once our own clock says
  // it must have.
  const reading = readChessClock();
  if (reading?.flagged) {
    const match = await fetchChessMatch(matchId);
    if (match && session?.match.id === matchId) applyMatchState(match);
  }
}

// ── Flag detection ───────────────────────────────────────────────────────────

/**
 * Claims the win when the opponent's clock runs out. The server sweeps for this
 * too, but only every 5 to 10 seconds — claiming is what makes the end of a game
 * feel instant.
 */
function scheduleTimeoutClaim(): void {
  if (!session || session.finished || session.role !== "player") return;
  if (session.timeoutTimer) clearTimeout(session.timeoutTimer);

  const reading = readChessClock();
  if (!reading) return;

  const opponentToMove = session.myColor != null && reading.turn !== session.myColor;
  if (!opponentToMove) return;

  const remaining = reading.turn === "white" ? reading.whiteMs : reading.blackMs;
  session.timeoutTimer = setTimeout(
    () => void claimTimeout(),
    Math.max(0, remaining) + TIMEOUT_CLAIM_GRACE_MS,
  );
}

async function claimTimeout(): Promise<void> {
  if (!session || session.finished || session.role !== "player") return;

  const matchId = session.match.id;
  const outcome = await claimChessTimeout(matchId);
  if (!session || session.match.id !== matchId) return;

  if (outcome.ok) {
    applyMatchState(outcome.match);
    return;
  }

  // Our clock was running ahead of the server's: the body carries the truth.
  if (outcome.match) applyMatchState(outcome.match);
  else await resyncFromServer();
}

// ── Welcome / reconnection ───────────────────────────────────────────────────

/**
 * Reconciles against the welcome payload, which carries this player's active
 * games with their moves. This is the whole reconnection story: no extra
 * request, and a page reload puts the board back exactly as it was.
 */
export function reconcileChessFromWelcome(matches: ChessMatch[]): void {
  invalidateFriendChessMatches();

  const mine = matches.find((match) => myColorIn(match) != null && match.status === "active");

  if (session?.role === "player") {
    if (!mine) {
      // The game we were on is gone (finished while we were away).
      leaveChessSession();
      return;
    }
    if (mine.id === session.match.id) applyMatchState(mine, { replay: true });
    return;
  }

  // Spectating, or nothing mounted: our own game wins the garden.
  if (mine && session?.role === "spectator") leaveChessSession();
  if (mine && !session) beginSession(mine, "player");
}

// ── Teardown on unload / room change ─────────────────────────────────────────

let unloadBound = false;

export function bindChessSessionLifecycle(): void {
  if (unloadBound) return;
  unloadBound = true;
  window.addEventListener("beforeunload", () => leaveChessSession());
}
