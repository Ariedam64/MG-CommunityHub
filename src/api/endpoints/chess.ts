// ariesModAPI/endpoints/chess.ts
// Endpoints échecs — défis et parties.
//
// Deux réponses d'erreur portent un corps utile et ne doivent pas être avalées :
// le 409 de désynchronisation renvoie le match courant (on se recale sans second
// aller-retour) et le 422 renvoie `leavesKingInCheck` (on affiche le bon message
// sans recalculer). Les fonctions ci-dessous rendent donc le statut brut plutôt
// qu'un booléen.

import { httpDelete, httpGet, httpPost } from "../client/http";
import type {
  ChessChallenge,
  ChessChallengeList,
  ChessColorChoice,
  ChessMatch,
  ChessMoveRecord,
  ChessClock,
  ChessPromotion,
} from "../types";

// ── Défis ────────────────────────────────────────────────────────────────────

export type ChallengeOutcome =
  | { ok: true; challenge: ChessChallenge }
  | { ok: false; status: number; error: string };

/** Erreur JSON du module échecs : `{ "error": "not_your_turn" }`. */
function readError(data: unknown, fallback: string): string {
  const value = (data as { error?: unknown } | null)?.error;
  return typeof value === "string" ? value : fallback;
}

export async function sendChessChallenge(
  opponentId: string,
  color: ChessColorChoice = "random",
): Promise<ChallengeOutcome> {
  const res = await httpPost<ChessChallenge>("chess/challenges", { opponentId, color });
  if (res.status === 201 && res.data) return { ok: true, challenge: res.data };
  return { ok: false, status: res.status, error: readError(res.data, "challenge_failed") };
}

export async function fetchChessChallenges(): Promise<ChessChallengeList | null> {
  const res = await httpGet<ChessChallengeList>("chess/challenges");
  return res.status === 200 ? res.data : null;
}

export async function acceptChessChallenge(
  challengeId: number,
): Promise<{ ok: true; match: ChessMatch } | { ok: false; status: number; error: string }> {
  const res = await httpPost<ChessMatch>(`chess/challenges/${challengeId}/accept`, {});
  if (res.status === 200 && res.data) return { ok: true, match: res.data };
  return { ok: false, status: res.status, error: readError(res.data, "accept_failed") };
}

export async function declineChessChallenge(challengeId: number): Promise<boolean> {
  const res = await httpPost<null>(`chess/challenges/${challengeId}/decline`, {});
  return res.status === 204 || res.status === 200;
}

export async function cancelChessChallenge(challengeId: number): Promise<boolean> {
  const res = await httpDelete<null>(`chess/challenges/${challengeId}`);
  return res.status === 204 || res.status === 200;
}

// ── Parties ──────────────────────────────────────────────────────────────────

export type ChessMatchScope = "me" | "friends" | "room";
export type ChessMatchStatusFilter = "active" | "finished" | "all";

export async function fetchChessMatches(options: {
  status?: ChessMatchStatusFilter;
  scope?: ChessMatchScope;
  limit?: number;
} = {}): Promise<ChessMatch[]> {
  const res = await httpGet<{ matches: ChessMatch[] }>("chess/matches", {
    status: options.status,
    scope: options.scope,
    limit: options.limit,
  });
  return res.status === 200 ? res.data?.matches ?? [] : [];
}

export async function fetchChessMatch(matchId: number): Promise<ChessMatch | null> {
  const res = await httpGet<ChessMatch>(`chess/matches/${matchId}`);
  return res.status === 200 ? res.data : null;
}

/**
 * Result of posting a move.
 *
 * `desync` carries the server's current match so the caller can rebuild the
 * position on the spot; `illegal` carries `leavesKingInCheck` so it can say
 * *why* without asking the engine again.
 */
export type MoveOutcome =
  | { kind: "ok"; match: ChessMatch }
  | { kind: "desync"; error: string; match: ChessMatch | null }
  | { kind: "illegal"; leavesKingInCheck: boolean }
  | { kind: "error"; status: number; error: string };

export async function postChessMove(
  matchId: number,
  move: { ply: number; from: string; to: string; promotion?: ChessPromotion | null },
): Promise<MoveOutcome> {
  const res = await httpPost<any>(`chess/matches/${matchId}/moves`, {
    ply: move.ply,
    from: move.from,
    to: move.to,
    promotion: move.promotion ?? null,
  });

  if (res.status === 200 && res.data) return { kind: "ok", match: res.data as ChessMatch };

  if (res.status === 409) {
    return {
      kind: "desync",
      error: readError(res.data, "conflict"),
      match: (res.data?.match as ChessMatch) ?? null,
    };
  }

  if (res.status === 422) {
    return { kind: "illegal", leavesKingInCheck: res.data?.leavesKingInCheck === true };
  }

  return { kind: "error", status: res.status, error: readError(res.data, "move_failed") };
}

export async function fetchChessMovesSince(
  matchId: number,
  sincePly: number,
): Promise<{ moves: ChessMoveRecord[]; ply: number; clock: ChessClock } | null> {
  const res = await httpGet<{ moves: ChessMoveRecord[]; ply: number; clock: ChessClock }>(
    `chess/matches/${matchId}/moves`,
    { since: sincePly },
  );
  return res.status === 200 ? res.data : null;
}

export async function resignChessMatch(matchId: number): Promise<ChessMatch | null> {
  const res = await httpPost<ChessMatch>(`chess/matches/${matchId}/resign`, {});
  return res.status === 200 ? res.data : null;
}

export type DrawAction = "offer" | "accept" | "decline";

export async function postChessDraw(
  matchId: number,
  action: DrawAction,
  ply: number,
): Promise<{ ok: true; match: ChessMatch | null } | { ok: false; status: number; error: string }> {
  const res = await httpPost<any>(`chess/matches/${matchId}/draw`, { action, ply });
  if (res.status === 200 || res.status === 204) {
    return { ok: true, match: (res.data as ChessMatch) ?? null };
  }
  return { ok: false, status: res.status, error: readError(res.data, "draw_failed") };
}

/**
 * Registers as a spectator, and renews that registration: the server expires an
 * entry after 60s, so this doubles as the ping. A 409 means the game is over and
 * nothing more will be sent, which is not an error worth surfacing.
 */
export async function postChessWatch(matchId: number): Promise<boolean> {
  const res = await httpPost<null>(`chess/matches/${matchId}/watch`, {});
  return res.status === 204 || res.status === 200;
}

export async function deleteChessWatch(matchId: number): Promise<boolean> {
  const res = await httpDelete<null>(`chess/matches/${matchId}/watch`);
  return res.status === 204 || res.status === 200;
}

/**
 * Claims the win on time. A 409 means our clock was running ahead of the
 * server's — the body carries the real match, so we recalibrate rather than
 * asking again.
 */
export async function claimChessTimeout(
  matchId: number,
): Promise<{ ok: true; match: ChessMatch } | { ok: false; match: ChessMatch | null }> {
  const res = await httpPost<any>(`chess/matches/${matchId}/claim-timeout`, {});
  if (res.status === 200 && res.data) return { ok: true, match: res.data as ChessMatch };
  return { ok: false, match: (res.data?.match as ChessMatch) ?? null };
}
