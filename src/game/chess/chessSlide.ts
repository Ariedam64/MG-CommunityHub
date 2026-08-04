// src/game/chess/chessSlide.ts
//
// A piece travelling from one square to another.
//
// This was private to chessBoardRender while there was only ever one board.
// Games happening elsewhere in the room now get boards of their own, and a
// single module-level "the move in flight" cannot serve several at once: two
// boards moving together would land each other's pieces.
//
// So it is a controller, one per board, each with its own trip.
//
// What it moves is the tile view itself, not a sprite of our own. The board is
// left untouched until the trip ends, so the piece stays visible on its old
// square for the whole journey and the position is only committed on arrival.

import { FARM_TILE_SIZE, resolveTileRoot } from "./chessBoardTiles";
import { squareToTileIn, type RenderConfig } from "./chessBoardLayout";
import type { Square } from "./chessRules";

/** Short enough not to delay the next move. */
const SLIDE_DURATION_MS = 200;

/** A piece in flight has to clear the pieces it passes over. */
const SLIDE_Z_INDEX = 999998;

export type SlideStep = { from: Square; to: Square };

type SlidePart = {
  root: any;
  baseX: number;
  baseY: number;
  baseZIndex: number;
  deltaX: number;
  deltaY: number;
};

type SlideState = {
  raf: number;
  parts: SlidePart[];
  onDone: () => void;
};

export type SlideController = {
  /**
   * Slides one or more pieces, then runs `onDone`. Several steps travel
   * together rather than in sequence, which is what a castle looks like: king
   * and rook cross at the same time.
   *
   * A move requested while another is still flying lands that one first, so the
   * position can never be committed out of order.
   */
  run(steps: SlideStep[], onDone: () => void): void;
  /** Lands the trip in flight, running its onDone. */
  settle(): void;
  /** Puts the pieces back where they started, without running onDone. */
  abort(): void;
};

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

/**
 * `getConfig` rather than a config: the playable board replaces its layout on
 * every setup, and a controller holding the old one would compute its trips
 * against a board that has moved.
 */
export function createSlideController(
  getConfig: () => RenderConfig | null,
): SlideController {
  let slide: SlideState | null = null;

  function abort(): void {
    if (!slide) return;
    const current = slide;
    slide = null;

    cancelAnimationFrame(current.raf);
    for (const part of current.parts) {
      try {
        part.root.position?.set?.(part.baseX, part.baseY);
        part.root.zIndex = part.baseZIndex;
      } catch {
        /* ignore */
      }
    }
  }

  function settle(): void {
    const current = slide;
    abort();
    current?.onDone();
  }

  /** Captures a trip's starting state, or null when its tile view is unreachable. */
  function prepareSlidePart(config: RenderConfig, step: SlideStep): SlidePart | null {
    const fromTile = squareToTileIn(config, step.from);
    const toTile = squareToTileIn(config, step.to);

    const root = resolveTileRoot(fromTile.tx, fromTile.ty);
    if (!root?.position) return null;

    return {
      root,
      baseX: root.position.x,
      baseY: root.position.y,
      baseZIndex: root.zIndex ?? 0,
      deltaX: (toTile.tx - fromTile.tx) * FARM_TILE_SIZE,
      deltaY: (toTile.ty - fromTile.ty) * FARM_TILE_SIZE,
    };
  }

  function run(steps: SlideStep[], onDone: () => void): void {
    settle();

    const config = getConfig();
    if (!config) {
      onDone();
      return;
    }

    const parts = steps
      .map((step) => prepareSlidePart(config, step))
      .filter((part): part is SlidePart => part != null);

    if (!parts.length) {
      onDone();
      return;
    }

    const startedAt = performance.now();

    const tick = (now: number): void => {
      if (!slide) return;

      const progress = Math.min(1, (now - startedAt) / SLIDE_DURATION_MS);
      const eased = easeOutCubic(progress);

      try {
        for (const part of parts) {
          part.root.position.set(
            part.baseX + part.deltaX * eased,
            part.baseY + part.deltaY * eased,
          );
          part.root.zIndex = SLIDE_Z_INDEX;
        }
      } catch {
        settle();
        return;
      }

      if (progress >= 1) {
        settle();
        return;
      }
      slide.raf = requestAnimationFrame(tick);
    };

    for (const part of parts) part.root.zIndex = SLIDE_Z_INDEX;
    slide = { raf: requestAnimationFrame(tick), parts, onDone };
  }

  return { run, settle, abort };
}
