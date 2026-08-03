// src/ui/hub/chessHud.ts
//
// The in-game chess panel: both clocks, the game controls, the promotion
// picker and the result banner.
//
// It is a plain fixed-position DOM element rather than anything in the game's
// Pixi tree — same reasoning as communityHubButtonFloating.ts, and the same
// drag-to-move behaviour, so a player whose board sits under it can push it
// aside. The position is persisted.

import { readHubPath, writeHubPath } from "@/storage/storage";
import { WIDGET_Z_INDEX } from "@/ui/communityHubButtonFloating";
import { CLOCK_URGENT_MS, formatClock, onChessClockTick } from "@/game/chess/chessClock";
import type { ChessColor } from "@/api/types";
import type { ChessPieceKind } from "@/game/chess/chessRules";

const POS_PATH = "chessHud.pos";

const PANEL_WIDTH = 232;
const SCREEN_MARGIN = 8;
const DEFAULT_LEFT_GAP = 16;
const DEFAULT_TOP_GAP = 96;
const DRAG_THRESHOLD_PX = 4;

/** Above the floating hub button, so it is never buried by it. */
const HUD_Z_INDEX = WIDGET_Z_INDEX + 10;

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
  /** Which side is mine — decides which row sits at the bottom. */
  myColor: ChessColor | null;
  onResign?: () => void;
  onOfferDraw?: () => void;
  onAcceptDraw?: () => void;
  onDeclineDraw?: () => void;
  onLeave: () => void;
};

export type ChessHudController = {
  /** Shows or hides the "X offers a draw" banner. */
  setDrawOffer(from: "me" | "them" | null): void;
  /** Shows the end-of-game banner and disables the game controls. */
  setResult(text: string): void;
  /**
   * Opens the promotion picker and resolves with the chosen piece, or null if
   * the player dismissed it.
   */
  askPromotion(): Promise<ChessPieceKind | null>;
  /** Spectator count. Hidden entirely while the server does not report one. */
  setSpectators(count: number | null): void;
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

function button(label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  Object.assign(el.style, {
    flex: "1",
    padding: "6px 8px",
    fontSize: "12px",
    fontFamily: "inherit",
    color: "#d8e2ec",
    background: "#1a2531",
    border: "1px solid #32404e",
    borderRadius: "6px",
    cursor: "pointer",
  } as CSSStyleDeclaration);
  el.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    onClick();
  });
  return el;
}

export function createChessHud(options: ChessHudOptions): ChessHudController {
  const panel = document.createElement("div");
  panel.setAttribute("data-community-hub-chess-hud", "1");
  Object.assign(panel.style, {
    position: "fixed",
    left: "-9999px",
    top: "-9999px",
    width: `${PANEL_WIDTH}px`,
    zIndex: String(HUD_Z_INDEX),
    padding: "10px",
    borderRadius: "10px",
    border: "1px solid #32404e",
    background: "linear-gradient(180deg, #111923, #0b131c)",
    boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
    color: "#d8e2ec",
    font: "13px/1.4 system-ui, sans-serif",
    userSelect: "none",
    touchAction: "none",
    cursor: "grab",
  } as CSSStyleDeclaration);

  // ── Clock rows ─────────────────────────────────────────────────────────────

  function clockRow(side: ChessColor, name: string) {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "5px 6px",
      borderRadius: "6px",
    } as CSSStyleDeclaration);

    const dot = document.createElement("span");
    Object.assign(dot.style, {
      width: "10px",
      height: "10px",
      borderRadius: "50%",
      flex: "0 0 auto",
      background: side === "white" ? "#e8e3d6" : "#2b3440",
      border: "1px solid #5a6675",
    } as CSSStyleDeclaration);

    const label = document.createElement("span");
    label.textContent = name;
    Object.assign(label.style, {
      flex: "1 1 auto",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    } as CSSStyleDeclaration);

    const time = document.createElement("span");
    Object.assign(time.style, {
      fontVariantNumeric: "tabular-nums",
      fontWeight: "600",
      flex: "0 0 auto",
    } as CSSStyleDeclaration);

    row.append(dot, label, time);
    return { row, time };
  }

  const whiteRow = clockRow("white", options.white);
  const blackRow = clockRow("black", options.black);

  // My side at the bottom, the way a physical board faces me.
  const topRow = options.myColor === "white" ? blackRow : whiteRow;
  const bottomRow = options.myColor === "white" ? whiteRow : blackRow;

  const clocks = document.createElement("div");
  clocks.append(topRow.row, bottomRow.row);

  // ── Banners ────────────────────────────────────────────────────────────────

  const banner = document.createElement("div");
  Object.assign(banner.style, {
    display: "none",
    margin: "8px 0 0",
    padding: "7px 8px",
    borderRadius: "6px",
    background: "#1b2735",
    border: "1px solid #3a4b5e",
    fontSize: "12px",
  } as CSSStyleDeclaration);

  const status = document.createElement("div");
  Object.assign(status.style, {
    display: "none",
    margin: "8px 0 0",
    fontSize: "11px",
    color: "#8fa2b5",
  } as CSSStyleDeclaration);

  // ── Controls ───────────────────────────────────────────────────────────────

  const controls = document.createElement("div");
  Object.assign(controls.style, {
    display: "flex",
    gap: "6px",
    margin: "9px 0 0",
    alignItems: "center",
  } as CSSStyleDeclaration);

  const drawButton = options.role === "player" ? button("Draw", () => options.onOfferDraw?.()) : null;

  // Two-step rather than a confirm() dialog: inside the Discord Activity iframe
  // a native modal is unreliable, and resigning by misclick is unforgivable.
  let resignArmed = false;
  let resignTimer: ReturnType<typeof setTimeout> | null = null;

  const disarmResign = () => {
    resignArmed = false;
    if (resignTimer) clearTimeout(resignTimer);
    resignTimer = null;
    if (resignButton) {
      resignButton.textContent = "Resign";
      resignButton.style.color = "#d8e2ec";
      resignButton.style.borderColor = "#32404e";
    }
  };

  const resignButton: HTMLButtonElement | null =
    options.role === "player"
      ? button("Resign", () => {
          if (!resignArmed) {
            resignArmed = true;
            resignButton!.textContent = "Sure?";
            resignButton!.style.color = "#ff6b6b";
            resignButton!.style.borderColor = "#5c2b2b";
            resignTimer = setTimeout(disarmResign, 4000);
            return;
          }
          disarmResign();
          options.onResign?.();
        })
      : null;
  const leaveButton = button(options.role === "player" ? "Close" : "Stop watching", () => options.onLeave());

  // While the game runs, only the game controls show; Close replaces them once
  // it is over, so the two can never be confused.
  if (drawButton) controls.appendChild(drawButton);
  if (resignButton) controls.appendChild(resignButton);
  if (options.role === "spectator") controls.appendChild(leaveButton);

  const spectators = document.createElement("span");
  Object.assign(spectators.style, {
    display: "none",
    flex: "0 0 auto",
    fontSize: "11px",
    color: "#8fa2b5",
    paddingLeft: "2px",
  } as CSSStyleDeclaration);
  controls.appendChild(spectators);

  // ── Promotion picker ───────────────────────────────────────────────────────

  const promotion = document.createElement("div");
  Object.assign(promotion.style, {
    display: "none",
    margin: "9px 0 0",
    paddingTop: "8px",
    borderTop: "1px solid #26313d",
  } as CSSStyleDeclaration);

  const promotionLabel = document.createElement("div");
  promotionLabel.textContent = "Promote to";
  Object.assign(promotionLabel.style, {
    fontSize: "11px",
    color: "#8fa2b5",
    marginBottom: "6px",
  } as CSSStyleDeclaration);

  const promotionRow = document.createElement("div");
  Object.assign(promotionRow.style, { display: "flex", gap: "6px" } as CSSStyleDeclaration);
  promotion.append(promotionLabel, promotionRow);

  let resolvePromotion: ((kind: ChessPieceKind | null) => void) | null = null;

  function settlePromotion(kind: ChessPieceKind | null): void {
    promotion.style.display = "none";
    const resolve = resolvePromotion;
    resolvePromotion = null;
    resolve?.(kind);
  }

  for (const choice of PROMOTION_CHOICES) {
    const el = button(choice.glyph, () => settlePromotion(choice.kind));
    el.title = choice.label;
    el.style.fontSize = "18px";
    el.style.padding = "2px 0";
    promotionRow.appendChild(el);
  }

  panel.append(clocks, banner, status, controls, promotion);

  // ── Clock painting ─────────────────────────────────────────────────────────

  const unsubscribeClock = onChessClockTick((reading) => {
    whiteRow.time.textContent = formatClock(reading.whiteMs);
    blackRow.time.textContent = formatClock(reading.blackMs);

    for (const [side, row] of [
      ["white", whiteRow] as const,
      ["black", blackRow] as const,
    ]) {
      const active = reading.turn === side;
      const ms = side === "white" ? reading.whiteMs : reading.blackMs;
      row.row.style.background = active ? "#1b2735" : "transparent";
      row.time.style.color = active && ms < CLOCK_URGENT_MS ? "#ff6b6b" : "#d8e2ec";
    }
  });

  // ── Drag ───────────────────────────────────────────────────────────────────

  const applyPosition = (left: number, top: number): Position => {
    const height = panel.offsetHeight || 120;
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
    panel.style.cursor = "grab";
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
    panel.style.cursor = "grabbing";
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
    setDrawOffer(from) {
      banner.replaceChildren();

      if (!from) {
        banner.style.display = "none";
        return;
      }

      if (from === "me") {
        banner.textContent = "Draw offered — waiting for a reply";
        banner.style.display = "block";
        return;
      }

      const text = document.createElement("div");
      text.textContent = "Your opponent offers a draw";
      text.style.marginBottom = "6px";

      const row = document.createElement("div");
      Object.assign(row.style, { display: "flex", gap: "6px" } as CSSStyleDeclaration);
      row.append(
        button("Accept", () => options.onAcceptDraw?.()),
        button("Decline", () => options.onDeclineDraw?.()),
      );

      banner.append(text, row);
      banner.style.display = "block";
    },

    setResult(text) {
      disarmResign();
      banner.replaceChildren();
      banner.textContent = text;
      banner.style.display = "block";
      banner.style.fontWeight = "600";

      // The game is over: swap the game controls for a way out.
      controls.replaceChildren();
      controls.append(leaveButton, spectators);
      leaveButton.textContent = "Close";

      settlePromotion(null);
    },

    async askPromotion() {
      settlePromotion(null);
      promotion.style.display = "block";
      return new Promise<ChessPieceKind | null>((resolve) => {
        resolvePromotion = resolve;
      });
    },

    setSpectators(count) {
      if (count == null) {
        spectators.style.display = "none";
        return;
      }
      spectators.textContent = `👁 ${count}`;
      spectators.style.display = "inline";
    },

    setStatusText(text) {
      status.textContent = text ?? "";
      status.style.display = text ? "block" : "none";
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
