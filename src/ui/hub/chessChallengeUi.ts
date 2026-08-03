// src/ui/hub/chessChallengeUi.ts
//
// The prompt shown when someone challenges you to a game.
//
// A floating card rather than something inside the hub panel: a challenge
// expires in two minutes, and it has to be answerable without hunting for the
// panel first. It sits at the top centre, above the game, and counts itself
// down.

import { WIDGET_Z_INDEX } from "@/ui/communityHubButtonFloating";
import { playNotificationSound } from "@/ui/hub/notificationSound";
import { declineChessChallenge } from "@/api/endpoints/chess";
import { removeCachedChessChallenge } from "@/api/cache/chess";
import { acceptChallengeAndPlay } from "@/game/chess/chessSession";
import type { ChessChallenge } from "@/api/types";

const CARD_Z_INDEX = WIDGET_Z_INDEX + 20;
const TICK_MS = 250;

type ActiveCard = {
  challengeId: number;
  element: HTMLElement;
  timer: ReturnType<typeof setInterval>;
};

let active: ActiveCard | null = null;

function styledButton(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  Object.assign(el.style, {
    flex: "1",
    padding: "7px 10px",
    fontSize: "13px",
    fontFamily: "inherit",
    color: primary ? "#0b131c" : "#d8e2ec",
    background: primary ? "#7fd1a6" : "#1a2531",
    border: primary ? "1px solid #7fd1a6" : "1px solid #32404e",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: primary ? "600" : "400",
  } as CSSStyleDeclaration);
  el.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    onClick();
  });
  return el;
}

/** Tears down whatever card is showing. */
export function dismissIncomingChallenge(challengeId?: number): void {
  if (!active) return;
  if (challengeId != null && active.challengeId !== challengeId) return;

  clearInterval(active.timer);
  try {
    active.element.remove();
  } catch {
    /* ignore */
  }
  active = null;
}

/**
 * Shows an incoming challenge. Only one is ever on screen: the server refuses a
 * second pending challenge between the same pair anyway, and stacking cards over
 * the game would be worse than replacing them.
 */
export function showIncomingChallenge(challenge: ChessChallenge): void {
  dismissIncomingChallenge();

  const card = document.createElement("div");
  card.setAttribute("data-community-hub-chess-challenge", "1");
  Object.assign(card.style, {
    position: "fixed",
    left: "50%",
    top: "24px",
    transform: "translateX(-50%)",
    width: "300px",
    zIndex: String(CARD_Z_INDEX),
    padding: "12px 14px",
    borderRadius: "10px",
    border: "1px solid #32404e",
    background: "linear-gradient(180deg, #111923, #0b131c)",
    boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
    color: "#d8e2ec",
    font: "13px/1.4 system-ui, sans-serif",
  } as CSSStyleDeclaration);

  const title = document.createElement("div");
  title.textContent = `♞ ${challenge.from.name ?? "A player"} challenges you`;
  Object.assign(title.style, { fontWeight: "600", marginBottom: "3px" } as CSSStyleDeclaration);

  const colorLabel = {
    white: "they play White",
    black: "they play Black",
    random: "colours drawn at random",
  }[challenge.requestedColor];

  const subtitle = document.createElement("div");
  subtitle.textContent = `Chess — 10 min each, ${colorLabel}`;
  Object.assign(subtitle.style, { fontSize: "12px", color: "#8fa2b5" } as CSSStyleDeclaration);

  const countdown = document.createElement("div");
  Object.assign(countdown.style, {
    fontSize: "11px",
    color: "#8fa2b5",
    margin: "8px 0 0",
  } as CSSStyleDeclaration);

  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", gap: "8px", margin: "10px 0 0" } as CSSStyleDeclaration);

  row.append(
    styledButton("Accept", true, () => {
      dismissIncomingChallenge(challenge.id);
      removeCachedChessChallenge(challenge.id);
      void acceptChallengeAndPlay(challenge.id);
    }),
    styledButton("Decline", false, () => {
      dismissIncomingChallenge(challenge.id);
      removeCachedChessChallenge(challenge.id);
      void declineChessChallenge(challenge.id);
    }),
  );

  card.append(title, subtitle, countdown, row);
  document.body.appendChild(card);

  const expiresAt = Date.parse(challenge.expiresAt);

  const tick = () => {
    const remaining = Number.isFinite(expiresAt) ? expiresAt - Date.now() : 0;
    if (remaining <= 0) {
      // The server's own sweep emits chess_challenge_cancelled, but the card
      // should not sit there looking answerable until it arrives.
      dismissIncomingChallenge(challenge.id);
      removeCachedChessChallenge(challenge.id);
      return;
    }
    const seconds = Math.ceil(remaining / 1000);
    countdown.textContent = `Expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };

  tick();
  active = { challengeId: challenge.id, element: card, timer: setInterval(tick, TICK_MS) };

  try {
    playNotificationSound();
  } catch {
    /* a missing sound must not block the prompt */
  }
}
