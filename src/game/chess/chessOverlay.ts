// src/game/chess/chessOverlay.ts
//
// The PIXI.Graphics layers the board draws on.
//
// They all live in the tile system's worldContainer, which the game builds with
// `sortableChildren: true`, so zIndex alone decides what covers what. The
// terrain is unaffected: it lives in a separate groundContainer.
//
// Shared by chessBoardRender.ts and chessBoardMarks.ts, which both create and
// drop these layers on every redraw - and a teardown that misses a step leaks a
// Graphics into the world container each time.

import { tos } from "@/game/tileObjectSystem";
import { findGraphicsCtor } from "@/game/pixiGraphics";

export type Overlay = { gfx: any; parent: any };

function getWorldContainer(): any {
  return (tos.getStatus().tos as any)?.worldContainer ?? null;
}

function resolveGraphicsCtor(): any {
  const stage = (tos.getStatus().engine as any)?.app?.stage;
  return findGraphicsCtor(stage);
}

/**
 * A fresh Graphics parented to the world at that depth, or null when Pixi isn't
 * reachable - which is what every caller checks to know it can't draw yet.
 */
export function createOverlay(zIndex: number): Overlay | null {
  const worldContainer = getWorldContainer();
  const Graphics = resolveGraphicsCtor();
  if (!worldContainer?.addChild || !Graphics) return null;

  const gfx = new Graphics();
  gfx.zIndex = zIndex;
  worldContainer.addChild(gfx);
  return { gfx, parent: worldContainer };
}

/** Detaches and destroys an overlay. Returns null, to empty the slot it held. */
export function removeOverlay(overlay: Overlay | null): null {
  if (!overlay) return null;
  try {
    overlay.parent?.removeChild?.(overlay.gfx);
  } catch {
    /* ignore */
  }
  try {
    overlay.gfx?.destroy?.();
  } catch {
    /* ignore */
  }
  return null;
}
