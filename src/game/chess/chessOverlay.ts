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
 * A fresh Graphics parented to `parent` at that depth, or null when Pixi isn't
 * reachable - which is what every caller checks to know it can't draw yet.
 */
export function createOverlayIn(parent: any, zIndex: number): Overlay | null {
  const Graphics = resolveGraphicsCtor();
  if (!parent?.addChild || !Graphics) return null;

  const gfx = new Graphics();

  // Parent first, set the depth second. Pixi's zIndex setter marks the
  // *parent* as needing a re-sort, so setting it on an orphan marks nothing:
  // the container quietly stays on insertion order and the value is ignored.
  // That is what kept annotations under the pieces - the other layers only
  // looked correct because the order they happen to be created in matches the
  // order they belong in, and a piece redrawn after a move is added last.
  parent.addChild(gfx);
  gfx.zIndex = zIndex;

  // Belt and braces: a container that never had sorting turned on ignores
  // zIndex outright, and the dirty flag is what makes the sort actually run
  // on the next frame.
  if (!parent.sortableChildren) parent.sortableChildren = true;
  parent.sortDirty = true;

  return { gfx, parent };
}

/** The same, in the world container - where everything under the pieces goes. */
export function createOverlay(zIndex: number): Overlay | null {
  return createOverlayIn(getWorldContainer(), zIndex);
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
