// ariesModAPI/cache/chess.ts
// Cache des défis en attente et des parties d'amis en cours.
//
// Les défis arrivent dans le `welcome` puis sont maintenus par les événements :
// ouvrir la fiche d'un joueur ne coûte donc aucune requête. Les parties **des
// amis**, elles, ne sont pas dans le `welcome` (il ne porte que les miennes) et
// demandent GET /chess/matches?scope=friends — d'où le TTL ci-dessous.

import { fetchChessMatches } from "../endpoints/chess";
import type { ChessChallenge, ChessChallengeList, ChessMatch } from "../types";

const FRIEND_MATCHES_TTL_MS = 30_000;

let _challenges: ChessChallengeList = { incoming: [], outgoing: [] };
let _friendMatches: ChessMatch[] = [];
let _friendMatchesFetchedAt = 0;
let _friendMatchesInFlight: Promise<ChessMatch[]> | null = null;

const _listeners = new Set<() => void>();

/** Notifié à chaque changement de défi ou de partie d'ami. */
export function onChessCacheChange(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function notify(): void {
  for (const listener of _listeners) {
    try {
      listener();
    } catch {
      /* un abonné qui jette ne doit pas empêcher les autres */
    }
  }
}

// ── Défis ────────────────────────────────────────────────────────────────────

export function setCachedChessChallenges(list: ChessChallengeList | null | undefined): void {
  _challenges = {
    incoming: list?.incoming ?? [],
    outgoing: list?.outgoing ?? [],
  };
  notify();
}

export function getCachedChessChallenges(): ChessChallengeList {
  return _challenges;
}

export function addCachedChessChallenge(challenge: ChessChallenge, direction: "incoming" | "outgoing"): void {
  const others = _challenges[direction].filter((c) => c.id !== challenge.id);
  _challenges = { ..._challenges, [direction]: [...others, challenge] };
  notify();
}

export function removeCachedChessChallenge(challengeId: number): void {
  _challenges = {
    incoming: _challenges.incoming.filter((c) => c.id !== challengeId),
    outgoing: _challenges.outgoing.filter((c) => c.id !== challengeId),
  };
  notify();
}

/**
 * Retire tout défi en attente avec ces joueurs, quel que soit le sens.
 *
 * Un défi accepté ne produit aucun événement de défi : le serveur émet
 * `chess_match_started`. Sans ce nettoyage, la fiche du joueur continue à
 * décompter « défi envoyé » pendant qu'on joue déjà contre lui.
 */
export function removeCachedChessChallengesWith(playerIds: string[]): void {
  const ids = playerIds.filter(Boolean);
  if (!ids.length) return;

  const touches = (challenge: ChessChallenge) =>
    ids.includes(challenge.from.playerId) || ids.includes(challenge.to.playerId);

  const incoming = _challenges.incoming.filter((c) => !touches(c));
  const outgoing = _challenges.outgoing.filter((c) => !touches(c));

  if (incoming.length === _challenges.incoming.length && outgoing.length === _challenges.outgoing.length) {
    return;
  }

  _challenges = { incoming, outgoing };
  notify();
}

/** Le défi en attente avec ce joueur, dans un sens ou dans l'autre. */
export function findChessChallengeWith(
  playerId: string,
): { challenge: ChessChallenge; direction: "incoming" | "outgoing" } | null {
  const incoming = _challenges.incoming.find((c) => c.from.playerId === playerId);
  if (incoming) return { challenge: incoming, direction: "incoming" };

  const outgoing = _challenges.outgoing.find((c) => c.to.playerId === playerId);
  if (outgoing) return { challenge: outgoing, direction: "outgoing" };

  return null;
}

// ── Parties d'amis ───────────────────────────────────────────────────────────

/**
 * Les parties d'amis en cours, rafraîchies au plus une fois par TTL. Un appel
 * concurrent partage la requête en vol plutôt que d'en lancer une seconde.
 */
export async function getFriendChessMatches(force = false): Promise<ChessMatch[]> {
  const fresh = Date.now() - _friendMatchesFetchedAt < FRIEND_MATCHES_TTL_MS;
  if (!force && fresh) return _friendMatches;
  if (_friendMatchesInFlight) return _friendMatchesInFlight;

  _friendMatchesInFlight = fetchChessMatches({ status: "active", scope: "friends" })
    .then((matches) => {
      _friendMatches = matches;
      _friendMatchesFetchedAt = Date.now();
      notify();
      return matches;
    })
    .catch(() => _friendMatches)
    .finally(() => {
      _friendMatchesInFlight = null;
    });

  return _friendMatchesInFlight;
}

export function getCachedFriendChessMatches(): ChessMatch[] {
  return _friendMatches;
}

/** La partie en cours d'un joueur, s'il en a une dans le cache. */
export function findFriendChessMatch(playerId: string): ChessMatch | null {
  return (
    _friendMatches.find(
      (match) => match.white.playerId === playerId || match.black.playerId === playerId,
    ) ?? null
  );
}

/** Force le prochain accès à refetch. À appeler sur tout événement chess_*. */
export function invalidateFriendChessMatches(): void {
  _friendMatchesFetchedAt = 0;
}

export function clearChessCache(): void {
  _challenges = { incoming: [], outgoing: [] };
  _friendMatches = [];
  _friendMatchesFetchedAt = 0;
  notify();
}
