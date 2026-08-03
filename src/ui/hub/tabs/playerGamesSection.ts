// src/ui/hub/tabs/playerGamesSection.ts
//
// The "Games" block on a friend's card: challenge them to chess, answer a
// challenge of theirs, or watch the game they are already in.
//
// It renders from cache — challenges arrive in the welcome payload and are kept
// up to date by events, so opening a player's card costs no request. Only the
// list of friends' *games* needs fetching, and that is behind a 30s TTL.

import {
  findChessChallengeWith,
  findFriendChessMatch,
  getFriendChessMatches,
  onChessCacheChange,
  removeCachedChessChallenge,
} from "@/api/cache/chess";
import { cancelChessChallenge, declineChessChallenge } from "@/api/endpoints/chess";
import {
  acceptChallengeAndPlay,
  challengePlayer,
  isChessBoardBusy,
  onChessSessionChange,
  watchChessMatch,
} from "@/game/chess/chessSession";
import type { PlayerView } from "@/api/types";
import { style } from "../shared";

function actionButton(label: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = label;
  style(button, {
    padding: "10px 14px",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "10px",
    background: "rgba(255,255,255,0.03)",
    color: "#e7eef7",
    fontSize: "13px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 120ms ease",
  });

  button.onmouseenter = () => {
    if (button.disabled) return;
    style(button, {
      background: "rgba(94,234,212,0.1)",
      borderColor: "rgba(94,234,212,0.3)",
      color: "#5eead4",
    });
  };
  button.onmouseleave = () => {
    if (button.disabled) return;
    style(button, {
      background: "rgba(255,255,255,0.03)",
      borderColor: "rgba(255,255,255,0.08)",
      color: "#e7eef7",
    });
  };

  button.onclick = async () => {
    button.disabled = true;
    style(button, { opacity: "0.6", cursor: "not-allowed" });
    try {
      await onClick();
    } finally {
      button.disabled = false;
      style(button, { opacity: "1", cursor: "pointer" });
    }
  };

  return button;
}

function hint(text: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = text;
  style(el, { fontSize: "12px", color: "rgba(226,232,240,0.55)" });
  return el;
}

/**
 * Builds the Games section. Returns the element plus a teardown, because it
 * subscribes to two caches and would otherwise keep repainting a detached node.
 */
export function createGamesSection(player: PlayerView): {
  element: HTMLElement;
  destroy: () => void;
} {
  const section = document.createElement("div");
  style(section, { display: "flex", flexDirection: "column", gap: "12px" });

  const title = document.createElement("div");
  style(title, { fontSize: "14px", fontWeight: "700", color: "#e7eef7", paddingLeft: "4px" });
  title.textContent = "Games";

  const body = document.createElement("div");
  style(body, {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "14px",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "12px",
    background: "rgba(255,255,255,0.02)",
  });

  section.append(title, body);

  let countdownTimer: ReturnType<typeof setInterval> | null = null;

  function stopCountdown(): void {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
  }

  function render(): void {
    stopCountdown();
    body.replaceChildren();

    const heading = document.createElement("div");
    heading.textContent = "♞  Chess";
    style(heading, { fontSize: "13px", fontWeight: "600", color: "#e7eef7" });
    body.appendChild(heading);

    const pending = findChessChallengeWith(player.playerId);
    const theirMatch = findFriendChessMatch(player.playerId);

    // 1. They challenged me.
    if (pending?.direction === "incoming") {
      body.appendChild(hint("They challenged you."));

      const row = document.createElement("div");
      style(row, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" });
      row.append(
        actionButton("Accept", async () => {
          removeCachedChessChallenge(pending.challenge.id);
          await acceptChallengeAndPlay(pending.challenge.id);
        }),
        actionButton("Decline", async () => {
          removeCachedChessChallenge(pending.challenge.id);
          await declineChessChallenge(pending.challenge.id);
        }),
      );
      body.appendChild(row);
      return;
    }

    // 2. I challenged them — the button becomes the pending offer, counting
    // itself down. It goes back to "Challenge" on expiry or on a decline; the
    // decline arrives as an event, the expiry is noticed here because the
    // server's sweep can be up to ten seconds behind the clock.
    if (pending?.direction === "outgoing") {
      const waiting = actionButton("Cancel", async () => {
        removeCachedChessChallenge(pending.challenge.id);
        await cancelChessChallenge(pending.challenge.id);
      });
      body.appendChild(waiting);

      const expiresAt = Date.parse(pending.challenge.expiresAt);
      const tick = () => {
        const remaining = Number.isFinite(expiresAt) ? expiresAt - Date.now() : 0;
        if (remaining <= 0) {
          stopCountdown();
          // Drops it from the cache, which repaints us back to "Challenge".
          removeCachedChessChallenge(pending.challenge.id);
          return;
        }
        const seconds = Math.ceil(remaining / 1000);
        waiting.textContent = `Waiting for an answer  ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}  ✕`;
      };
      tick();
      countdownTimer = setInterval(tick, 500);
      return;
    }

    // 3. They are already playing — offer to watch.
    if (theirMatch) {
      const them = theirMatch.white.playerId === player.playerId ? theirMatch.black : theirMatch.white;
      body.appendChild(hint(`Playing against ${them.name ?? "someone"} right now`));

      const watch = actionButton("Watch", async () => {
        await watchChessMatch(theirMatch.id);
      });
      if (isChessBoardBusy()) {
        watch.disabled = true;
        style(watch, { opacity: "0.5", cursor: "not-allowed" });
        body.append(watch, hint("Finish your own game first."));
      } else {
        body.appendChild(watch);
      }
      return;
    }

    // 4. Free — offer the challenge. Colours are always drawn at random, so
    // there is nothing to pick.
    const challenge = actionButton("Challenge", async () => {
      await challengePlayer(player.playerId, "random");
    });

    if (isChessBoardBusy()) {
      challenge.disabled = true;
      style(challenge, { opacity: "0.5", cursor: "not-allowed" });
      body.append(challenge, hint("You are already in a game."));
    } else {
      body.appendChild(challenge);
    }
  }

  render();

  // Knowing whether they are busy avoids sending a challenge that can only come
  // back as a 409.
  void getFriendChessMatches().then(() => {
    if (section.isConnected) render();
  });

  let disposed = false;

  /**
   * Repaints, unless the card has been closed — in which case this is the last
   * thing the section does. The player view has no unmount hook, so detachment
   * is what we have to notice, and a cache event is when we can notice it.
   */
  function renderIfAttached(): void {
    if (disposed) return;
    if (!section.isConnected) {
      destroy();
      return;
    }
    render();
    // A chess event invalidates the friends' games list; refetching here is
    // TTL-guarded, so an event storm still costs one request.
    void getFriendChessMatches().then((matches) => {
      if (!disposed && section.isConnected && matches.length) render();
    });
  }

  const unsubscribeCache = onChessCacheChange(renderIfAttached);
  const unsubscribeSession = onChessSessionChange(renderIfAttached);

  function destroy(): void {
    if (disposed) return;
    disposed = true;
    stopCountdown();
    unsubscribeCache();
    unsubscribeSession();
  }

  return { element: section, destroy };
}
