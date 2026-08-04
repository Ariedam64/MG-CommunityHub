// src/game/chess/chessWiring.ts
//
// Connects the chess feature to the hub's event stream and welcome payload.
//
// Kept apart from chessSession so the session stays a state machine with no
// opinion about where events come from, and so this file is the single place to
// look when asking "who reacts to chess_*?".

import {
  addCachedChessChallenge,
  invalidateFriendChessMatches,
  removeCachedChessChallenge,
  removeCachedChessChallengesWith,
  setCachedChessChallenges,
} from "@/api/cache/chess";
import { onWelcome } from "@/api/cache/welcome";
import { getCurrentPlayerId } from "@/api/init";
import { openChessStream } from "@/api/streams/chess";
import type { StreamHandle } from "@/api/types";
import { showIncomingChallenge, dismissIncomingChallenge } from "@/ui/hub/chessChallengeUi";
import {
  addRoomBoardForMatch,
  applyRoomBoardMove,
  dropRoomBoard,
  startRoomBoards,
  stopRoomBoards,
} from "./chessRoomBoards";
import {
  bindChessSessionLifecycle,
  handleChessDrawDeclined,
  handleChessDrawOffer,
  handleChessMatchEnded,
  handleChessMatchStarted,
  handleChessMoveEvent,
  reconcileChessFromWelcome,
} from "./chessSession";

let handle: StreamHandle | null = null;
let unsubscribeWelcome: (() => void) | null = null;

/** Starts listening for chess events. Safe to call more than once. */
export function startChessFeature(playerId: string): void {
  if (handle) return;

  bindChessSessionLifecycle();
  startRoomBoards();

  handle = openChessStream(playerId, {
    onChallenge: (challenge) => {
      const me = getCurrentPlayerId();
      const direction = challenge.to.playerId === me ? "incoming" : "outgoing";
      addCachedChessChallenge(challenge, direction);
      if (direction === "incoming") showIncomingChallenge(challenge);
    },

    onChallengeDeclined: (payload) => {
      removeCachedChessChallenge(payload.challengeId);
      dismissIncomingChallenge(payload.challengeId);
    },

    onChallengeCancelled: (payload) => {
      removeCachedChessChallenge(payload.challengeId);
      dismissIncomingChallenge(payload.challengeId);
    },

    onMatchStarted: (match) => {
      // An accepted challenge produces no challenge event, only this one - so
      // this is where the pending offer stops being pending. Without it the
      // player card keeps counting down "challenge sent" during the game.
      removeCachedChessChallengesWith([match.white.playerId, match.black.playerId]);
      invalidateFriendChessMatches();
      handleChessMatchStarted(match);
      // Broadcast to the whole room, so this also fires for the neighbours'
      // games: a board goes up on their garden the moment they start.
      addRoomBoardForMatch(match);
    },

    onMove: (payload) => {
      handleChessMoveEvent(payload);
      // The same event carries the neighbours' games, broadcast to the room.
      applyRoomBoardMove(
        payload.matchId,
        payload.ply,
        payload.from,
        payload.to,
        payload.promotion,
      );
    },

    onMatchEnded: (payload) => {
      handleChessMatchEnded(payload);
      dropRoomBoard(payload.matchId);
    },
    onDrawOffer: (payload) => handleChessDrawOffer(payload.matchId, payload.by),
    onDrawDeclined: (payload) => handleChessDrawDeclined(payload.matchId),
  });

  // The welcome arrives on every (re)connection and carries this player's
  // active games with their moves — that is the entire resync story.
  unsubscribeWelcome = onWelcome((data) => {
    setCachedChessChallenges(data.chess?.challenges);
    reconcileChessFromWelcome(data.chess?.matches ?? []);
  });
}

export function stopChessFeature(): void {
  stopRoomBoards();
  handle?.close();
  handle = null;
  unsubscribeWelcome?.();
  unsubscribeWelcome = null;
}
