// src/ui/communityHubButtonPixi.ts
// Adds a Pixi-rendered "Community Hub" button as an extra slot on the
// game's own `RightSideRail` (the vertical icon rail — Chat, Leaderboard,
// Stats, Notifications, ...). That rail used to be a real DOM toolbar
// (buttons with aria-labels), which is what the old DOM-cloning injector
// (`ui/toolbarButton.ts`) anchored next to. A game build moved it entirely
// to native Pixi rendering, so there is no DOM button left to anchor next
// to anymore — this button lives directly in the Pixi scene graph instead.
//
// The rest of the hub UI (badge, panel) stays plain DOM; only the anchor
// point moves from `document.querySelector('button[...]')` to this
// controller's `getScreenRect()`.
import { getPixiCaptureState, getStage, startPixiCapture, type PixiCaptureState } from "@/platform/pixiCapture";
import { findByLabel } from "@/platform/pixiTree";
import { pageWindow, shareGlobal } from "@/platform/page-context";

const RAIL_LABEL = "RightSideRail";
const RAIL_FIND_RETRY_MS = 1000;
const RAIL_FIND_LOG_EVERY = 30;

// Arie's Mod's own notification bell, when present, adds itself directly to
// the rail under this label (see notificationBellPixi.ts in that project).
// Anchoring below it — when it's there — keeps both mods' buttons grouped
// together instead of scattered across the rail.
const ARIES_MOD_BELL_LABEL = "GeminiNotificationBell";
// The rail's icon slots aren't individually labeled, so there's no direct
// way to say "the Chat slot" by name — but only the Chat slot carries this
// unread-badge child, which makes it identifiable. Used as the fallback
// anchor when Arie's Mod isn't running.
const CHAT_SLOT_MARKER_LABEL = "RightSideRailChatBadge";

const DEFAULT_ICON_GLYPH = "\u{1F465}"; // 👥
const DEFAULT_SLOT_SIZE = 45;
const DEFAULT_SLOT_SPACING = 52;

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface CommunityHubButtonPixiOptions {
  onClick: () => void;
  /** Glyph drawn as the icon. Defaults to a people emoji. */
  iconGlyph?: string;
  /** Fired whenever the button's on-screen position/size may have changed. */
  onGeometryChanged?: () => void;
}

export interface CommunityHubButtonPixiController {
  stop(): void;
  /** Current on-screen bounding box of the button, in page (client) coordinates. */
  getScreenRect(): ScreenRect | null;
}

interface CommunityHubButtonPixiDebugState {
  attached: boolean;
  findAttempts: number;
  hasButton: boolean;
  lastError: string | null;
}

export function startCommunityHubButtonPixi(
  opts: CommunityHubButtonPixiOptions,
): CommunityHubButtonPixiController {
  startPixiCapture();

  const iconGlyph = opts.iconGlyph ?? DEFAULT_ICON_GLYPH;

  let running = true;
  let rail: any = null;
  let buttonContainer: any = null;
  let buttonText: any = null;
  let lastSize = DEFAULT_SLOT_SIZE;

  let findAttempts = 0;
  let findRafId: number | null = null;
  let lastFindCheckAt = 0;

  // Pixi's own EventSystem never dispatches real clicks to anything we add
  // to this rail — confirmed the same way the notification bell needed to
  // work around it — so clicks are hit-tested from a native DOM listener on
  // the canvas instead of relying on `eventMode`.
  let canvasEl: any = null;
  let canvasListenersAttached = false;
  let weSetPointerCursor = false;

  const debugState: CommunityHubButtonPixiDebugState = {
    attached: false,
    findAttempts: 0,
    hasButton: false,
    lastError: null,
  };
  shareGlobal("__MG_CH_HUB_BUTTON_PIXI_DEBUG__", debugState);

  const raf: (cb: (t: number) => void) => number = (pageWindow as any).requestAnimationFrame.bind(pageWindow);
  const cancelRaf: (id: number) => void = (pageWindow as any).cancelAnimationFrame.bind(pageWindow);

  const forgetButtonRefs = () => {
    buttonContainer = null;
    buttonText = null;
    debugState.hasButton = false;
  };

  const removeButton = () => {
    if (buttonContainer) {
      try {
        buttonContainer.destroy({ children: true });
      } catch {
        /* ignore */
      }
    }
    forgetButtonRefs();
  };

  const onClick = () => {
    try {
      opts.onClick();
    } catch (error) {
      console.error("[communityHubButtonPixi] onClick error:", error);
    }
  };

  const computeScreenRect = (): ScreenRect | null => {
    if (!buttonContainer || buttonContainer.destroyed) return null;
    const state = getPixiCaptureState();
    const canvas = state?.renderer?.canvas || state?.renderer?.view?.canvas || state?.renderer?.view;
    if (!canvas) return null;
    try {
      const rect = canvas.getBoundingClientRect();
      const topLeft = buttonContainer.toGlobal({ x: 0, y: 0 });
      const bottomRight = buttonContainer.toGlobal({ x: lastSize, y: lastSize });
      return {
        left: rect.left + topLeft.x,
        top: rect.top + topLeft.y,
        right: rect.left + bottomRight.x,
        bottom: rect.top + bottomRight.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      };
    } catch {
      return null;
    }
  };

  const hitTestButton = (clientX: number, clientY: number): boolean => {
    const rect = computeScreenRect();
    if (!rect) return false;
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  };

  // Capture-phase, on `window` rather than a bubble listener on the canvas:
  // the game's own pointerdown handler (movement) is already attached
  // directly on the canvas, so a bubble listener on that same element would
  // run too late to stop it — a capturing listener higher up the tree runs
  // first, so `stopPropagation` here actually prevents the game from seeing
  // the click (which would otherwise move the character under the button).
  const onWindowPointerDownCapture = (ev: PointerEvent) => {
    if (!hitTestButton(ev.clientX, ev.clientY)) return;
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    ev.preventDefault();
    onClick();
  };

  const onCanvasPointerMove = (ev: PointerEvent) => {
    if (!canvasEl) return;
    const isHovering = hitTestButton(ev.clientX, ev.clientY);
    if (isHovering && !weSetPointerCursor) {
      canvasEl.style.cursor = "pointer";
      weSetPointerCursor = true;
    } else if (!isHovering && weSetPointerCursor) {
      canvasEl.style.cursor = "";
      weSetPointerCursor = false;
    }
  };

  const onCanvasPointerLeave = () => {
    if (weSetPointerCursor && canvasEl) {
      canvasEl.style.cursor = "";
      weSetPointerCursor = false;
    }
  };

  const ensureCanvasListeners = (state: PixiCaptureState) => {
    if (canvasListenersAttached) return;
    const canvas = state.renderer?.canvas || state.renderer?.view?.canvas || state.renderer?.view;
    if (!canvas) return;
    canvasEl = canvas;
    (pageWindow as any).addEventListener("pointerdown", onWindowPointerDownCapture, true);
    canvas.addEventListener("pointermove", onCanvasPointerMove);
    canvas.addEventListener("pointerleave", onCanvasPointerLeave);
    canvasListenersAttached = true;
  };

  // Finds the rail child to stack our button below: Arie's Mod's own bell
  // when it's running alongside us, otherwise the Chat icon. Both are found
  // by searching each rail child's own subtree for a known marker label —
  // not by tracking an "is Arie's Mod running" flag — so this stays correct
  // even if Arie's Mod loads after us (or unloads) and the rail updates.
  const findAnchorSlot = (): any | null => {
    if (!Array.isArray(rail?.children)) return null;
    for (const child of rail.children) {
      if (child === buttonContainer) continue;
      if (findByLabel(child, ARIES_MOD_BELL_LABEL)) return child;
    }
    for (const child of rail.children) {
      if (child === buttonContainer) continue;
      if (findByLabel(child, CHAT_SLOT_MARKER_LABEL)) return child;
    }
    return null;
  };

  // Reads the real spacing/size of the rail's existing icons instead of
  // hardcoding them, so this keeps working if the game changes the rail's
  // slot size or icon count in a future build.
  const computeSlot = (): { size: number; nextY: number } => {
    const siblings: any[] = Array.isArray(rail?.children)
      ? rail.children.filter((c: any) => c !== buttonContainer)
      : [];

    // Derived from sibling icons' own widths, never from `rail.width` (the
    // rail's *aggregate* bounds): on the frame our sprite is first added,
    // it still carries its native (larger, kept crisp) texture size until
    // this same call resizes it below — reading the aggregate at that
    // moment would fold our own oversized sprite back into `size`, which
    // then inflates every other rail measurement derived from it.
    let size = DEFAULT_SLOT_SIZE;
    const siblingWidths = siblings
      .map((c: any) => Number(c?.width))
      .filter((w: number) => Number.isFinite(w) && w > 0)
      .sort((a: number, b: number) => a - b);
    if (siblingWidths.length) size = siblingWidths[Math.floor(siblingWidths.length / 2)];

    const ys = siblings.map((c: any) => Number(c?.y) || 0).sort((a, b) => a - b);
    let spacing = DEFAULT_SLOT_SPACING;
    if (ys.length >= 2) {
      const diffs: number[] = [];
      for (let i = 1; i < ys.length; i++) diffs.push(ys[i] - ys[i - 1]);
      diffs.sort((a, b) => a - b);
      const median = diffs[Math.floor(diffs.length / 2)];
      if (Number.isFinite(median) && median > 0) spacing = median;
    }

    const anchorSlot = findAnchorSlot();
    if (anchorSlot) {
      return { size, nextY: (Number(anchorSlot.y) || 0) + spacing };
    }

    // Neither Arie's Mod's bell nor Chat has loaded into the rail yet —
    // stack after whatever exists so far; the next resync (rail's
    // childAdded/childRemoved) re-anchors as soon as one of them appears.
    if (!ys.length) return { size, nextY: 0 };
    return { size, nextY: ys[ys.length - 1] + spacing };
  };

  const syncGeometry = () => {
    const { size, nextY } = computeSlot();
    lastSize = size;
    buttonContainer.position.set(0, nextY);
    if (buttonText) {
      buttonText.style.fontSize = Math.round(size * 0.6);
      if (typeof buttonText.anchor?.set === "function") buttonText.anchor.set(0.5);
      buttonText.position.set(size / 2, size / 2);
    }
  };

  const syncUnsafe = () => {
    if (!running || !rail || rail.destroyed) {
      removeButton();
      return;
    }
    const state = getPixiCaptureState();
    if (!state?.ctors?.Text) return;

    if (!buttonContainer) {
      const ContainerCtor = state.ctors.Container ?? rail.constructor;
      buttonContainer = new ContainerCtor();
      buttonContainer.label = "CommunityHubButton";
      const thisContainer = buttonContainer;
      // Mirrors the rest of the mod's Pixi-attached buttons: the game can
      // destroy/rebuild the rail's whole subtree without telling us — drop
      // our stale reference instead of crashing the next time we touch it.
      thisContainer.once("destroyed", () => {
        if (buttonContainer === thisContainer) forgetButtonRefs();
      });
      rail.addChild(buttonContainer);
    }

    if (!buttonText) {
      buttonText = new state.ctors.Text({ text: iconGlyph, style: { fontSize: DEFAULT_SLOT_SIZE } });
      buttonContainer.addChild(buttonText);
    }

    ensureCanvasListeners(state);
    syncGeometry();
    debugState.hasButton = true;
    try {
      opts.onGeometryChanged?.();
    } catch {
      /* ignore */
    }
  };

  const sync = () => {
    try {
      syncUnsafe();
      debugState.lastError = null;
    } catch (error) {
      debugState.lastError = String((error as Error)?.message ?? error);
      console.warn("[communityHubButtonPixi] sync failed, clearing button", error);
      try {
        removeButton();
      } catch {
        /* ignore */
      }
    }
  };

  const onRailChildrenChanged = () => sync();

  const restartSearchIfNeeded = () => {
    if (!running || rail) return;
    tryFindRail();
    if (!rail && findRafId == null) findRafId = raf(scheduleFind);
  };

  const attachToRail = (node: any) => {
    rail = node;
    rail.on("childAdded", onRailChildrenChanged);
    rail.on("childRemoved", onRailChildrenChanged);
    rail.once("destroyed", () => {
      if (rail === node) {
        rail = null;
        debugState.attached = false;
        removeButton();
        restartSearchIfNeeded();
      }
    });
    debugState.attached = true;
    console.info(`[communityHubButtonPixi] attached to ${RAIL_LABEL} after ${findAttempts} attempt(s)`);
    sync();
  };

  const tryFindRail = () => {
    if (!running || rail) return;
    const state = getPixiCaptureState();
    if (!state) return;
    const stage = getStage(state);
    const found = findByLabel(stage, RAIL_LABEL);
    if (found) {
      attachToRail(found);
      return;
    }
    findAttempts += 1;
    debugState.findAttempts = findAttempts;
    if (findAttempts % RAIL_FIND_LOG_EVERY === 0) {
      console.info(`[communityHubButtonPixi] still searching for ${RAIL_LABEL} (${findAttempts} attempts so far)`);
    }
  };

  const scheduleFind = (now: number) => {
    findRafId = null;
    if (!running || rail) return;
    if (now - lastFindCheckAt >= RAIL_FIND_RETRY_MS) {
      lastFindCheckAt = now;
      tryFindRail();
    }
    if (!running || rail) return;
    findRafId = raf(scheduleFind);
  };

  tryFindRail();
  if (!rail) findRafId = raf(scheduleFind);

  return {
    stop() {
      if (!running) return;
      running = false;
      if (findRafId != null) {
        cancelRaf(findRafId);
        findRafId = null;
      }
      if (rail) {
        try {
          rail.off("childAdded", onRailChildrenChanged);
          rail.off("childRemoved", onRailChildrenChanged);
        } catch {
          /* ignore */
        }
      }
      if (canvasListenersAttached) {
        try {
          (pageWindow as any).removeEventListener("pointerdown", onWindowPointerDownCapture, true);
          if (canvasEl) {
            canvasEl.removeEventListener("pointermove", onCanvasPointerMove);
            canvasEl.removeEventListener("pointerleave", onCanvasPointerLeave);
            if (weSetPointerCursor) canvasEl.style.cursor = "";
          }
        } catch {
          /* ignore */
        }
      }
      removeButton();
      rail = null;
    },

    getScreenRect(): ScreenRect | null {
      return computeScreenRect();
    },
  };
}
