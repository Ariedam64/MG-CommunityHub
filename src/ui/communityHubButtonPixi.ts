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

// Same "two people" glyph as the old DOM button, rasterized at 128×128 (well
// above its 24×24 viewBox) so it stays crisp once Pixi scales the resulting
// texture up to icon size, including on hi-DPI displays.
const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
const DEFAULT_SLOT_SIZE = 45;
const DEFAULT_SLOT_SPACING = 52;
const ICON_SIZE_RATIO = 0.55;

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
  /** Icon SVG markup, rendered as a real Pixi sprite. Defaults to a "people" icon. */
  iconSvg?: string;
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

  const iconSvg = opts.iconSvg ?? DEFAULT_ICON_SVG;
  const iconDataUrl = `data:image/svg+xml;base64,${btoa(iconSvg)}`;

  let running = true;
  let rail: any = null;
  let buttonContainer: any = null;
  let buttonIcon: any = null;
  let lastSize = DEFAULT_SLOT_SIZE;

  // The icon is loaded once (decoding an SVG data URL is effectively
  // synchronous, no network involved) and reused as a texture across
  // rail re-attachments — only the Sprite instance needs recreating.
  let iconImage: HTMLImageElement | null = null;
  let iconImageLoading = false;
  let iconImageFailed = false;
  let iconTexture: any = null;

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
    buttonIcon = null;
    debugState.hasButton = false;
  };

  const ensureIconImage = (): void => {
    if (iconImage || iconImageLoading || iconImageFailed) return;
    iconImageLoading = true;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      iconImage = img;
      iconImageLoading = false;
      sync();
    };
    img.onerror = () => {
      iconImageLoading = false;
      iconImageFailed = true;
      console.warn("[communityHubButtonPixi] icon image failed to load");
    };
    img.src = iconDataUrl;
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

    if (!siblings.length) return { size, nextY: 0 };

    const ys = siblings.map((c: any) => Number(c?.y) || 0).sort((a, b) => a - b);
    let spacing = DEFAULT_SLOT_SPACING;
    if (ys.length >= 2) {
      const diffs: number[] = [];
      for (let i = 1; i < ys.length; i++) diffs.push(ys[i] - ys[i - 1]);
      diffs.sort((a, b) => a - b);
      const median = diffs[Math.floor(diffs.length / 2)];
      if (Number.isFinite(median) && median > 0) spacing = median;
    }
    return { size, nextY: ys[ys.length - 1] + spacing };
  };

  const syncGeometry = () => {
    const { size, nextY } = computeSlot();
    lastSize = size;
    buttonContainer.position.set(0, nextY);
    if (buttonIcon) {
      const iconSize = Math.round(size * ICON_SIZE_RATIO);
      buttonIcon.width = iconSize;
      buttonIcon.height = iconSize;
      buttonIcon.position.set(size / 2, size / 2);
    }
  };

  const syncUnsafe = () => {
    if (!running || !rail || rail.destroyed) {
      removeButton();
      return;
    }
    const state = getPixiCaptureState();
    if (!state?.ctors?.Sprite || !state?.ctors?.Texture) return;

    ensureIconImage();
    if (!iconImage) return; // sync() re-runs once the icon image (onload) is ready

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

    if (!buttonIcon) {
      if (!iconTexture) iconTexture = state.ctors.Texture.from(iconImage);
      buttonIcon = new state.ctors.Sprite(iconTexture);
      if (typeof buttonIcon.anchor?.set === "function") buttonIcon.anchor.set(0.5);
      // Sized to the last known slot immediately, not left at the texture's
      // native (larger) pixel size — syncGeometry() below refines this, but
      // computeSlot() also runs before that on later syncs and must never
      // see this sprite at its raw texture size.
      buttonIcon.width = lastSize * ICON_SIZE_RATIO;
      buttonIcon.height = lastSize * ICON_SIZE_RATIO;
      buttonContainer.addChild(buttonIcon);
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
