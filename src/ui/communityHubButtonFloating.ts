// src/ui/communityHubButtonFloating.ts
// Floating, draggable DOM button for opening the Community Hub panel.
//
// This replaces an earlier approach that injected the button directly into
// the game's Pixi `RightSideRail` scene graph. That kept breaking: the rail
// isn't reliably found on some builds/screen sizes, and its layout depends
// on sibling icons (Chat, Arie's Mod's own bell, ...) that load in and
// reposition asynchronously, causing race conditions and misplacement. A
// plain fixed-position DOM element sidesteps the game's Pixi tree entirely,
// so it always shows up in the same place (draggable by the player if it
// ever overlaps something) — same pattern as Arie's Mod's own floating
// notification bell widget (notificationBellFloating.ts).
import { readHubPath, writeHubPath } from "@/storage/storage";

const POS_PATH = "hubButton.pos";

const ICON_GLYPH = "\u{1F465}"; // 👥
const BUTTON_SIZE = 44;
const ICON_FONT_SIZE = 22;
// Above the game's own UI, comfortably below the hub panel's own overlay.
// Exported so the badge (a plain DOM child of the hub, not of this widget)
// can be stacked above it.
export const WIDGET_Z_INDEX = 1_999_900;
const SCREEN_MARGIN = 8;
// Default spot: right edge, roughly half-way down — clear of where the
// game's icon rail (and Arie's Mod's own floating bell, if enabled) usually
// sit, without assuming anything about either.
const DEFAULT_RIGHT_GAP = 16;
const DEFAULT_TOP_RATIO = 0.5;
// Pointer travel below this stays a click; beyond it the gesture is a drag
// and releasing does not open the panel.
const DRAG_THRESHOLD_PX = 4;

type WidgetPosition = { left: number; top: number };

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface CommunityHubButtonFloatingOptions {
  onClick: () => void;
  /** Called whenever the widget moves (drag, viewport clamp). */
  onMoved?: () => void;
}

export interface CommunityHubButtonFloatingController {
  stop(): void;
  getScreenRect(): ScreenRect | null;
}

function readSavedPosition(): WidgetPosition | null {
  const raw = readHubPath<unknown>(POS_PATH);
  if (!raw || typeof raw !== "object") return null;
  const left = Number((raw as Record<string, unknown>).left);
  const top = Number((raw as Record<string, unknown>).top);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { left, top };
}

function persistPosition(pos: WidgetPosition): void {
  writeHubPath(POS_PATH, { left: Math.round(pos.left), top: Math.round(pos.top) });
}

function clampCoord(value: number, min: number, max: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return value;
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function startCommunityHubButtonFloating(
  opts: CommunityHubButtonFloatingOptions,
): CommunityHubButtonFloatingController {
  let running = true;

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("data-community-hub-widget", "1");
  button.title = "Community Hub";
  button.setAttribute("aria-label", "Community Hub");
  Object.assign(button.style, {
    position: "fixed",
    left: "-9999px",
    top: "-9999px",
    width: `${BUTTON_SIZE}px`,
    height: `${BUTTON_SIZE}px`,
    zIndex: String(WIDGET_Z_INDEX),
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
    borderRadius: "50%",
    border: "1px solid #32404e",
    background: "linear-gradient(180deg, #111923, #0b131c)",
    boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
    cursor: "grab",
    userSelect: "none",
    touchAction: "none",
  } as CSSStyleDeclaration);

  const icon = document.createElement("span");
  icon.textContent = ICON_GLYPH;
  Object.assign(icon.style, {
    fontSize: `${ICON_FONT_SIZE}px`,
    lineHeight: "1",
    pointerEvents: "none",
    display: "inline-block",
  } as CSSStyleDeclaration);
  button.appendChild(icon);

  const applyPosition = (left: number, top: number): WidgetPosition => {
    const boundedLeft = clampCoord(left, SCREEN_MARGIN, window.innerWidth - BUTTON_SIZE - SCREEN_MARGIN);
    const boundedTop = clampCoord(top, SCREEN_MARGIN, window.innerHeight - BUTTON_SIZE - SCREEN_MARGIN);
    button.style.left = `${Math.round(boundedLeft)}px`;
    button.style.top = `${Math.round(boundedTop)}px`;
    try {
      opts.onMoved?.();
    } catch {
      /* ignore */
    }
    return { left: boundedLeft, top: boundedTop };
  };

  const applyInitialPosition = () => {
    const saved = readSavedPosition();
    if (saved) {
      applyPosition(saved.left, saved.top);
      return;
    }
    applyPosition(window.innerWidth - BUTTON_SIZE - DEFAULT_RIGHT_GAP, window.innerHeight * DEFAULT_TOP_RATIO);
  };

  const clampIntoViewport = () => {
    const rect = button.getBoundingClientRect();
    applyPosition(rect.left, rect.top);
  };

  const onWindowResize = () => {
    if (!running) return;
    clampIntoViewport();
  };

  // Drag to move; a press that never travels past the threshold is a click.
  let dragState: {
    pointerId: number;
    startX: number;
    startY: number;
    baseLeft: number;
    baseTop: number;
    lastPos: WidgetPosition;
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
      button.releasePointerCapture(dragState.pointerId);
    } catch {
      /* ignore */
    }
    const wasDrag = dragState.dragged;
    if (wasDrag) persistPosition(dragState.lastPos);
    dragState = null;
    button.style.cursor = "grab";
    if (!wasDrag && ev?.type === "pointerup") {
      try {
        opts.onClick();
      } catch (error) {
        console.error("[communityHubButtonFloating] onClick error:", error);
      }
    }
  };

  const onPointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    if (dragState) stopDrag();
    const rect = button.getBoundingClientRect();
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
      button.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    document.addEventListener("pointermove", onDragMove);
    document.addEventListener("pointerup", stopDrag);
    document.addEventListener("pointercancel", stopDrag);
    button.style.cursor = "grabbing";
    ev.preventDefault();
    ev.stopPropagation();
  };

  button.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("resize", onWindowResize);
  document.body.appendChild(button);
  applyInitialPosition();

  return {
    stop() {
      if (!running) return;
      running = false;
      stopDrag();
      window.removeEventListener("resize", onWindowResize);
      button.removeEventListener("pointerdown", onPointerDown);
      try {
        button.remove();
      } catch {
        /* ignore */
      }
    },

    getScreenRect(): ScreenRect | null {
      if (!running || !button.isConnected) return null;
      const rect = button.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    },
  };
}
