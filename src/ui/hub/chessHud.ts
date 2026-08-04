// src/ui/hub/chessHud.ts
//
// The in-game chess panel: both clocks, the captured pieces, the game controls,
// the promotion picker and the result banner.
//
// It is a plain fixed-position DOM element rather than anything in the game's
// Pixi tree, same reasoning as communityHubButtonFloating.ts, and it drags the
// same way so a player whose board sits under it can push it aside. The
// position is persisted.
//
// Look and behaviour are split: everything visual lives in chessHudStyles.ts,
// and this file only ever adds and removes classes. Hover states, transitions
// and the low-time pulse are not expressible inline, which is why.

import { readHubPath, writeHubPath } from "@/storage/storage";
import { WIDGET_Z_INDEX } from "@/ui/communityHubButtonFloating";
import { attachSpriteIcon } from "@/ui/spriteIcons";
import { ensureChessHudStyles } from "./chessHudStyles";
import { CLOCK_URGENT_MS, formatClock, onChessClockTick } from "@/game/chess/chessClock";
import { DEFAULT_PIECE_DECOR_IDS } from "@/game/chess/chessBoard";
import type { ChessColor } from "@/api/types";
import type { ChessPieceKind } from "@/game/chess/chessRules";

const POS_PATH = "chessHud.pos";

const PANEL_WIDTH = 244;
const SCREEN_MARGIN = 8;
const DEFAULT_LEFT_GAP = 16;
const DEFAULT_TOP_GAP = 96;
const DRAG_THRESHOLD_PX = 4;

/** Above the floating hub button, so it is never buried by it. */
const HUD_Z_INDEX = WIDGET_Z_INDEX + 10;

const CAPTURE_ICON_PX = 15;

/** How long an armed Resign stays armed before it forgets. */
const RESIGN_ARM_MS = 4000;

/**
 * Standard relative values. The king is never captured, so it has none, and
 * listing it at 0 keeps the record exhaustive rather than relying on it never
 * appearing.
 */
const PIECE_VALUES: Record<ChessPieceKind, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 0,
};

/** Heaviest first, so a strip reads like a chess site's rather than a log. */
const CAPTURE_ORDER: ChessPieceKind[] = ["queen", "rook", "bishop", "knight", "pawn", "king"];

const PROMOTION_CHOICES: { kind: ChessPieceKind; glyph: string; label: string }[] = [
  { kind: "queen", glyph: "♛", label: "Queen" },
  { kind: "rook", glyph: "♜", label: "Rook" },
  { kind: "bishop", glyph: "♝", label: "Bishop" },
  { kind: "knight", glyph: "♞", label: "Knight" },
];

export type ChessHudRole = "player" | "spectator";

export type ChessHudOptions = {
  role: ChessHudRole;
  /** Names shown next to each clock. */
  white: string;
  black: string;
  /** Which side is mine. Decides which row sits at the bottom. */
  myColor: ChessColor | null;
  onResign?: () => void;
  onOfferDraw?: () => void;
  onAcceptDraw?: () => void;
  onDeclineDraw?: () => void;
  /** Player only: put the garden back for a moment, then bring the board back. */
  onToggleHidden?: () => void;
  /** Spectator only: look at the board from the other side. */
  onFlip?: () => void;
  onLeave: () => void;
};

export type ChessHudController = {
  /**
   * The pieces each side has taken, keyed by the capturing side, so `white`
   * holds the black pieces White has won.
   */
  setCaptures(captures: Record<ChessColor, ChessPieceKind[]>): void;
  setDrawOffer(from: "me" | "them" | null): void;
  /** Shows the end-of-game banner and puts the game controls away. */
  setResult(text: string): void;
  /**
   * Opens the promotion picker and resolves with the chosen piece, or null if
   * it was dismissed.
   */
  askPromotion(): Promise<ChessPieceKind | null>;
  /** Spectator count. Hidden entirely while the server does not report one. */
  setSpectators(count: number | null): void;
  setHidden(hidden: boolean): void;
  setStatusText(text: string | null): void;
  destroy(): void;
};

type Position = { left: number; top: number };

function readSavedPosition(): Position | null {
  const raw = readHubPath<unknown>(POS_PATH);
  if (!raw || typeof raw !== "object") return null;
  const left = Number((raw as Record<string, unknown>).left);
  const top = Number((raw as Record<string, unknown>).top);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { left, top };
}

function clampCoord(value: number, min: number, max: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return value;
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void, variant = ""): HTMLButtonElement {
  const node = el("button", `mgchess-btn${variant ? ` ${variant}` : ""}`, label);
  node.type = "button";
  node.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    onClick();
  });
  return node;
}

export function createChessHud(options: ChessHudOptions): ChessHudController {
  ensureChessHudStyles();

  const panel = el("div", "mgchess");
  panel.setAttribute("data-community-hub-chess-hud", "1");
  panel.style.zIndex = String(HUD_Z_INDEX);
  panel.style.left = "-9999px";
  panel.style.top = "-9999px";

  // ── Header ─────────────────────────────────────────────────────────────────

  const header = el("div", "mgchess-header");
  const watchers = el("span", "mgchess-watchers");
  watchers.style.display = "none";
  header.append(
    el("span", "mgchess-grip", "⠿"),
    el("span", "mgchess-title", options.role === "player" ? "Chess" : "Watching"),
    watchers,
  );

  // ── Sides ──────────────────────────────────────────────────────────────────

  function sideBlock(side: ChessColor, name: string) {
    const block = el("div", "mgchess-side");
    const row = el("div", "mgchess-side-row");
    const dot = el("span", `mgchess-dot is-${side}`);
    const label = el("span", "mgchess-name", name);
    const time = el("span", "mgchess-time", "0:00");
    row.append(dot, label, time);

    const caps = el("div", "mgchess-caps");
    block.append(row, caps);
    return { block, time, caps };
  }

  const whiteSide = sideBlock("white", options.white);
  const blackSide = sideBlock("black", options.black);

  // My side at the bottom, matching the board, which turns round for Black. A
  // spectator's board is not turned, so neither is this.
  const blackAtBottom = options.myColor === "black";

  const sides = el("div", "mgchess-sides");
  sides.append(
    blackAtBottom ? whiteSide.block : blackSide.block,
    blackAtBottom ? blackSide.block : whiteSide.block,
  );

  // ── Banner, status, controls ───────────────────────────────────────────────

  const banner = el("div", "mgchess-banner");
  const status = el("div", "mgchess-status");
  const controls = el("div", "mgchess-controls");

  const leaveButton = button(
    options.role === "player" ? "Close" : "Stop watching",
    () => options.onLeave(),
  );

  const drawButton =
    options.role === "player" ? button("Draw", () => options.onOfferDraw?.()) : null;

  // Two-step rather than a confirm() dialog: inside the Discord Activity iframe
  // a native modal is unreliable, and resigning by misclick is unforgivable.
  let resignArmed = false;
  let resignTimer: ReturnType<typeof setTimeout> | null = null;

  const disarmResign = (): void => {
    resignArmed = false;
    if (resignTimer) clearTimeout(resignTimer);
    resignTimer = null;
    if (resignButton) {
      resignButton.textContent = "Resign";
      resignButton.classList.remove("is-danger");
    }
  };

  const resignButton: HTMLButtonElement | null =
    options.role === "player"
      ? button("Resign", () => {
          if (!resignArmed) {
            resignArmed = true;
            resignButton!.textContent = "Sure?";
            resignButton!.classList.add("is-danger");
            resignTimer = setTimeout(disarmResign, RESIGN_ARM_MS);
            return;
          }
          disarmResign();
          options.onResign?.();
        })
      : null;

  const hideButton =
    options.role === "player" && options.onToggleHidden
      ? button("Hide", () => options.onToggleHidden?.())
      : null;

  const flipButton =
    options.role === "spectator" && options.onFlip
      ? button("Flip", () => options.onFlip?.())
      : null;

  if (drawButton) controls.appendChild(drawButton);
  if (resignButton) controls.appendChild(resignButton);
  if (hideButton) controls.appendChild(hideButton);
  if (flipButton) controls.appendChild(flipButton);
  if (options.role === "spectator") controls.appendChild(leaveButton);

  // ── Promotion ──────────────────────────────────────────────────────────────

  const promotion = el("div", "mgchess-promo");
  const promotionRow = el("div", "mgchess-promo-row");
  promotion.append(el("div", "mgchess-promo-label", "Promote to"), promotionRow);

  let resolvePromotion: ((kind: ChessPieceKind | null) => void) | null = null;

  function settlePromotion(kind: ChessPieceKind | null): void {
    promotion.classList.remove("is-shown");
    const resolve = resolvePromotion;
    resolvePromotion = null;
    resolve?.(kind);
  }

  for (const choice of PROMOTION_CHOICES) {
    const node = el("button", "mgchess-promo-btn", choice.glyph);
    node.type = "button";
    node.title = choice.label;
    node.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      settlePromotion(choice.kind);
    });
    promotionRow.appendChild(node);
  }

  panel.append(header, sides, banner, status, controls, promotion);

  // ── Clock painting ─────────────────────────────────────────────────────────

  const unsubscribeClock = onChessClockTick((reading) => {
    whiteSide.time.textContent = formatClock(reading.whiteMs);
    blackSide.time.textContent = formatClock(reading.blackMs);

    for (const [side, entry] of [
      ["white", whiteSide] as const,
      ["black", blackSide] as const,
    ]) {
      const active = reading.turn === side;
      const ms = side === "white" ? reading.whiteMs : reading.blackMs;
      entry.block.classList.toggle("is-active", active);
      entry.time.classList.toggle("is-urgent", ms < CLOCK_URGENT_MS);
    }
  });

  // ── Captures ───────────────────────────────────────────────────────────────

  function paintCaptures(strip: HTMLElement, taken: ChessPieceKind[], edge: number): void {
    strip.replaceChildren();

    if (!taken.length && edge <= 0) {
      strip.classList.remove("is-shown");
      return;
    }
    strip.classList.add("is-shown");

    const counts = new Map<ChessPieceKind, number>();
    for (const kind of taken) counts.set(kind, (counts.get(kind) ?? 0) + 1);

    for (const kind of CAPTURE_ORDER) {
      for (let i = 0; i < (counts.get(kind) ?? 0); i++) {
        const slot = el("span", "mgchess-cap");
        strip.appendChild(slot);
        attachSpriteIcon(slot, ["decor"], DEFAULT_PIECE_DECOR_IDS[kind], CAPTURE_ICON_PX, "chessHud");
      }
    }

    // Only the leader shows a number: two of them would be the same fact
    // written twice, with a minus sign.
    if (edge > 0) strip.appendChild(el("span", "mgchess-edge", `+${edge}`));
  }

  // ── Drag ───────────────────────────────────────────────────────────────────

  const applyPosition = (left: number, top: number): Position => {
    const height = panel.offsetHeight || 130;
    const boundedLeft = clampCoord(left, SCREEN_MARGIN, window.innerWidth - PANEL_WIDTH - SCREEN_MARGIN);
    const boundedTop = clampCoord(top, SCREEN_MARGIN, window.innerHeight - height - SCREEN_MARGIN);
    panel.style.left = `${Math.round(boundedLeft)}px`;
    panel.style.top = `${Math.round(boundedTop)}px`;
    return { left: boundedLeft, top: boundedTop };
  };

  let dragState: {
    pointerId: number;
    startX: number;
    startY: number;
    baseLeft: number;
    baseTop: number;
    lastPos: Position;
    dragged: boolean;
  } | null = null;

  const onDragMove = (ev: PointerEvent) => {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    const dx = ev.clientX - dragState.startX;
    const dy = ev.clientY - dragState.startY;
    if (!dragState.dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    dragState.dragged = true;
    dragState.lastPos = applyPosition(dragState.baseLeft + dx, dragState.baseTop + dy);
  };

  const stopDrag = (ev?: PointerEvent) => {
    if (!dragState) return;
    if (ev && ev.pointerId !== dragState.pointerId) return;
    document.removeEventListener("pointermove", onDragMove);
    document.removeEventListener("pointerup", stopDrag);
    document.removeEventListener("pointercancel", stopDrag);
    try {
      panel.releasePointerCapture(dragState.pointerId);
    } catch {
      /* ignore */
    }
    if (dragState.dragged) {
      writeHubPath(POS_PATH, {
        left: Math.round(dragState.lastPos.left),
        top: Math.round(dragState.lastPos.top),
      });
    }
    dragState = null;
  };

  const onPointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    // Buttons keep their clicks; only the panel's own chrome drags.
    if ((ev.target as HTMLElement)?.closest("button")) return;
    if (dragState) stopDrag();

    const rect = panel.getBoundingClientRect();
    dragState = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      baseLeft: rect.left,
      baseTop: rect.top,
      lastPos: { left: rect.left, top: rect.top },
      dragged: false,
    };
    try {
      panel.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    document.addEventListener("pointermove", onDragMove);
    document.addEventListener("pointerup", stopDrag);
    document.addEventListener("pointercancel", stopDrag);
    ev.preventDefault();
    ev.stopPropagation();
  };

  const onWindowResize = () => {
    const rect = panel.getBoundingClientRect();
    applyPosition(rect.left, rect.top);
  };

  panel.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("resize", onWindowResize);
  document.body.appendChild(panel);

  const saved = readSavedPosition();
  if (saved) applyPosition(saved.left, saved.top);
  else applyPosition(DEFAULT_LEFT_GAP, DEFAULT_TOP_GAP);

  // ── Controller ─────────────────────────────────────────────────────────────

  let destroyed = false;

  return {
    setCaptures(captures) {
      const material = (list: ChessPieceKind[]) =>
        list.reduce((sum, kind) => sum + PIECE_VALUES[kind], 0);

      const whiteMaterial = material(captures.white ?? []);
      const blackMaterial = material(captures.black ?? []);

      paintCaptures(whiteSide.caps, captures.white ?? [], whiteMaterial - blackMaterial);
      paintCaptures(blackSide.caps, captures.black ?? [], blackMaterial - whiteMaterial);
    },

    setDrawOffer(from) {
      banner.replaceChildren();
      banner.classList.remove("is-result");

      if (!from) {
        banner.classList.remove("is-shown");
        return;
      }

      if (from === "me") {
        banner.textContent = "You offered a draw. Waiting for a reply.";
        banner.classList.add("is-shown");
        return;
      }

      const row = el("div", "mgchess-promo-row");
      row.append(
        button("Accept", () => options.onAcceptDraw?.(), "is-primary"),
        button("Decline", () => options.onDeclineDraw?.()),
      );

      banner.append(el("div", "mgchess-banner-text", "Your opponent offers a draw"), row);
      banner.classList.add("is-shown");
    },

    setResult(text) {
      disarmResign();
      banner.replaceChildren();
      banner.textContent = text;
      banner.classList.add("is-shown", "is-result");

      // The game is over: swap the game controls for a way out.
      controls.replaceChildren(leaveButton);
      leaveButton.textContent = "Close";

      settlePromotion(null);
    },

    async askPromotion() {
      settlePromotion(null);
      promotion.classList.add("is-shown");
      return new Promise<ChessPieceKind | null>((resolve) => {
        resolvePromotion = resolve;
      });
    },

    setHidden(hidden) {
      if (hideButton) hideButton.textContent = hidden ? "Show" : "Hide";
      status.textContent = hidden ? "Board put away, your garden is back." : "";
      status.classList.toggle("is-shown", hidden);
    },

    setSpectators(count) {
      if (count == null) {
        watchers.style.display = "none";
        return;
      }
      watchers.textContent = `👁 ${count}`;
      watchers.style.display = "inline";
    },

    setStatusText(text) {
      status.textContent = text ?? "";
      status.classList.toggle("is-shown", !!text);
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      disarmResign();
      settlePromotion(null);
      unsubscribeClock();
      stopDrag();
      window.removeEventListener("resize", onWindowResize);
      panel.removeEventListener("pointerdown", onPointerDown);
      try {
        panel.remove();
      } catch {
        /* ignore */
      }
    },
  };
}
