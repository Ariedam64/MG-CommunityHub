// ariesModAPI/streams/chess.ts
// Événements échecs sur le stream unifié.
//
// C'est un abonné de plus, pas une connexion de plus : openUnifiedEvents
// déduplique par playerId, donc SSE (web) et long-polling (Discord) restent
// partagés avec les messages, la présence et les groupes.

import { openUnifiedEvents } from "../client/events";
import type {
  ChessChallenge,
  ChessChallengeClosedEvent,
  ChessDrawEvent,
  ChessMatch,
  ChessMatchEndedEvent,
  ChessMoveEvent,
  StreamHandle,
} from "../types";

export type ChessStreamHandlers = {
  onChallenge?: (challenge: ChessChallenge) => void;
  onChallengeDeclined?: (payload: ChessChallengeClosedEvent) => void;
  onChallengeCancelled?: (payload: ChessChallengeClosedEvent) => void;
  onMatchStarted?: (match: ChessMatch) => void;
  onMove?: (payload: ChessMoveEvent) => void;
  onMatchEnded?: (payload: ChessMatchEndedEvent) => void;
  onDrawOffer?: (payload: ChessDrawEvent) => void;
  onDrawDeclined?: (payload: ChessDrawEvent) => void;
};

function safeJsonParse(value: any): any {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * `chess_challenge` porte `{ challenge, from }` ou directement le challenge
 * selon la route qui l'émet ; on accepte les deux formes.
 */
function readChallenge(parsed: any): ChessChallenge | null {
  const candidate = parsed?.challenge ?? parsed;
  return candidate && typeof candidate.id === "number" ? (candidate as ChessChallenge) : null;
}

export function openChessStream(
  playerId: string,
  handlers: ChessStreamHandlers = {},
): StreamHandle | null {
  if (!playerId) return null;

  return openUnifiedEvents(playerId, {
    onEvent: (eventName, data) => {
      const parsed = safeJsonParse(data);

      switch (eventName) {
        case "chess_challenge": {
          const challenge = readChallenge(parsed);
          if (challenge) handlers.onChallenge?.(challenge);
          break;
        }
        case "chess_challenge_declined":
          handlers.onChallengeDeclined?.(parsed as ChessChallengeClosedEvent);
          break;
        case "chess_challenge_cancelled":
          handlers.onChallengeCancelled?.(parsed as ChessChallengeClosedEvent);
          break;
        case "chess_match_started":
          handlers.onMatchStarted?.((parsed?.match ?? parsed) as ChessMatch);
          break;
        case "chess_move":
          handlers.onMove?.(parsed as ChessMoveEvent);
          break;
        case "chess_match_ended":
          handlers.onMatchEnded?.(parsed as ChessMatchEndedEvent);
          break;
        case "chess_draw_offer":
          handlers.onDrawOffer?.(parsed as ChessDrawEvent);
          break;
        case "chess_draw_declined":
          handlers.onDrawDeclined?.(parsed as ChessDrawEvent);
          break;
        default:
          break;
      }
    },
  });
}
