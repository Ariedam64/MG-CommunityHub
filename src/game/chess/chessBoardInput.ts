// src/services/editor/chessBoardInput.ts
//
// Board interaction: a piece can be moved either by dragging it, or by clicking
// it once to select and clicking a highlighted square to play. Both share one
// state machine, so they never fight: a press becomes a drag only once the
// pointer travels past a small threshold, and stays a click otherwise.
//
// Display only - the module decides *what was pointed at*, never whether a move
// is legal; that is the caller's job through `isLegalTarget`.
//
// The pointer plumbing mirrors editorPointerControls.ts: capture-phase window
// listeners gated on `ev.target === canvas`, so HUD panels stacked above the
// canvas keep swallowing their own clicks.

import { tos } from "@/game/tileObjectSystem";
import { resolveTileRoot } from "./chessBoardTiles";

export type ChessSquare = { tx: number; ty: number };

export type ChessBoardInteraction = {
  /** True when the square holds a piece its owner is allowed to move now. */
  canPickUp(square: ChessSquare): boolean;
  /** True when the square belongs to the board. */
  isBoardSquare(square: ChessSquare): boolean;
  /** True when moving from one square to the other is a legal move. */
  isLegalTarget(from: ChessSquare, to: ChessSquare): boolean;
  /** Show where the piece on this square may go. */
  showHints(square: ChessSquare): void;
  clearHints(): void;
  /**
   * Attempt a move - the caller validates it and reports a refusal itself. Only
   * ever called for a square change. `animate` is true when the request came
   * from a click, where the piece still has to travel; a dragged piece was
   * already carried there by hand.
   */
  playMove(from: ChessSquare, to: ChessSquare, animate: boolean): void;
};

/** While dragged, the piece must float above the other pieces. */
const DRAG_Z_INDEX = 999999;

/**
 * Travel in CSS pixels past which a press stops being a click and becomes a
 * drag. Small enough that a deliberate drag is picked up immediately, large
 * enough that a click with a shaky hand still selects.
 */
const DRAG_THRESHOLD_PX = 8;

type PressState = {
  square: ChessSquare;
  /** The piece's tile view, kept so the drag can offset it. */
  root: any;
  baseX: number;
  baseY: number;
  baseZIndex: number;
  startWorldX: number;
  startWorldY: number;
  startClientX: number;
  startClientY: number;
  /** True once the pointer travelled far enough to count as a drag. */
  dragging: boolean;
  /** Whether this square was the selected one when the press began. */
  wasSelected: boolean;
};

let interaction: ChessBoardInteraction | null = null;
let press: PressState | null = null;
let selected: ChessSquare | null = null;
let listenersInstalled = false;

function sameSquare(a: ChessSquare, b: ChessSquare): boolean {
  return a.tx === b.tx && a.ty === b.ty;
}

/**
 * Continuous pointer position in worldContainer space - the same projection
 * tos.pointerToFarmTile uses, but keeping the sub-tile precision the drag needs.
 */
function pointerToWorld(ev: PointerEvent): { x: number; y: number } | null {
  const status = tos.getStatus();
  const renderer = (status.engine as any)?.app?.renderer;
  const worldContainer = (status.tos as any)?.worldContainer;
  const canvas = tos.getCanvas();
  if (!canvas || !renderer?.screen || !worldContainer?.toLocal) return null;

  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const global = {
    x: ((ev.clientX - rect.left) * renderer.screen.width) / rect.width,
    y: ((ev.clientY - rect.top) * renderer.screen.height) / rect.height,
  };

  const world = worldContainer.toLocal(global);
  return { x: world.x, y: world.y };
}

/** The tile under the pointer, or null when the pointer isn't on the canvas. */
function hitSquare(ev: PointerEvent): ChessSquare | null {
  if (!tos.isReady()) return null;
  const canvas = tos.getCanvas();
  if (!canvas || ev.target !== canvas) return null;

  const info = tos.pointerToFarmTile(ev);
  return info ? { tx: info.tx, ty: info.ty } : null;
}

/* -------------------------------------------------------------------------- */
/* Selection                                                                  */
/* -------------------------------------------------------------------------- */

function select(square: ChessSquare): void {
  selected = square;
  interaction?.showHints(square);
}

function clearSelection(): void {
  if (!selected) return;
  selected = null;
  interaction?.clearHints();
}

/* -------------------------------------------------------------------------- */
/* Press lifecycle                                                            */
/* -------------------------------------------------------------------------- */

/** Puts the pressed piece's tile view back where it belongs. */
function releaseRoot(): void {
  if (!press?.dragging) return;
  try {
    press.root.position?.set?.(press.baseX, press.baseY);
    press.root.zIndex = press.baseZIndex;
  } catch {
    /* ignore */
  }
}

function endPress(): void {
  releaseRoot();
  press = null;
}

function cancelInteraction(): void {
  endPress();
  clearSelection();
}

function beginPress(ev: PointerEvent, square: ChessSquare): boolean {
  const root = resolveTileRoot(square.tx, square.ty);
  const world = pointerToWorld(ev);
  if (!root?.position || !world) return false;

  press = {
    square,
    root,
    baseX: root.position.x,
    baseY: root.position.y,
    baseZIndex: root.zIndex ?? 0,
    startWorldX: world.x,
    startWorldY: world.y,
    startClientX: ev.clientX,
    startClientY: ev.clientY,
    dragging: false,
    wasSelected: selected != null && sameSquare(selected, square),
  };
  return true;
}

function travelledFarEnough(ev: PointerEvent): boolean {
  if (!press) return false;
  const dx = ev.clientX - press.startClientX;
  const dy = ev.clientY - press.startClientY;
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

/* -------------------------------------------------------------------------- */
/* Pointer handlers                                                           */
/* -------------------------------------------------------------------------- */

function handlePointerDown(ev: PointerEvent): void {
  if (!interaction || press || ev.button !== 0) return;

  const square = hitSquare(ev);
  if (!square) return;

  // Second click of a click-to-move: the selected piece goes to this square.
  if (
    selected &&
    !sameSquare(selected, square) &&
    interaction.isLegalTarget(selected, square)
  ) {
    const from = selected;
    clearSelection();
    ev.preventDefault();
    ev.stopPropagation();
    interaction.playMove(from, square, true);
    return;
  }

  if (!interaction.canPickUp(square)) {
    // Off the board the game keeps its click, so the player can still walk.
    if (!interaction.isBoardSquare(square)) return;

    // On the board every click is swallowed, even one that does nothing here:
    // letting it through makes the avatar walk onto the square, and the game
    // then rebuilds that tile's view - dropping the piece's tint with it.
    ev.preventDefault();
    ev.stopPropagation();

    if (!selected) return;

    // Reported as an attempt rather than a silent deselect: only the caller
    // knows whether the square was merely out of reach, or refused for a reason
    // worth showing.
    const from = selected;
    clearSelection();
    interaction.playMove(from, square, true);
    return;
  }

  // The hints are re-shown on click or on drag start, so the previous
  // selection can go now - keeping it would leave two sets of hints lit.
  const started = beginPress(ev, square);
  clearSelection();
  if (!started) return;

  ev.preventDefault();
  ev.stopPropagation();
}

function handlePointerMove(ev: PointerEvent): void {
  if (!press) return;

  if (!press.dragging) {
    if (!travelledFarEnough(ev)) return;
    press.dragging = true;
    press.root.zIndex = DRAG_Z_INDEX;
    interaction?.showHints(press.square);
  }

  const world = pointerToWorld(ev);
  if (!world) return;

  ev.preventDefault();
  ev.stopPropagation();

  // Re-assigned from the captured base every frame rather than accumulated, so
  // a tile view rebuild mid-drag can't leave the sprite drifting.
  try {
    press.root.position.set(
      press.baseX + (world.x - press.startWorldX),
      press.baseY + (world.y - press.startWorldY),
    );
    press.root.zIndex = DRAG_Z_INDEX;
  } catch {
    endPress();
    interaction?.clearHints();
  }
}

function handlePointerUp(ev: PointerEvent): void {
  if (!press || !interaction) return;

  const { square: from, dragging, wasSelected } = press;
  const target = hitSquare(ev);

  // The tile view goes back first: the move rebuilds both squares' views, and a
  // lingering offset would then apply to whatever lands there next.
  endPress();

  ev.preventDefault();
  ev.stopPropagation();

  if (!dragging) {
    // A plain click toggles the selection on that piece.
    interaction.clearHints();
    if (!wasSelected) select(from);
    return;
  }

  interaction.clearHints();

  if (!target || sameSquare(target, from)) return;
  if (!interaction.isBoardSquare(target)) return;

  interaction.playMove(from, target, false);
}

/* -------------------------------------------------------------------------- */
/* Wiring                                                                     */
/* -------------------------------------------------------------------------- */

function installListeners(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;

  window.addEventListener("pointerdown", handlePointerDown, true);
  window.addEventListener("pointermove", handlePointerMove, true);
  window.addEventListener("pointerup", handlePointerUp, true);
  window.addEventListener("pointercancel", cancelInteraction, true);
}

function removeListeners(): void {
  if (!listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = false;

  window.removeEventListener("pointerdown", handlePointerDown, true);
  window.removeEventListener("pointermove", handlePointerMove, true);
  window.removeEventListener("pointerup", handlePointerUp, true);
  window.removeEventListener("pointercancel", cancelInteraction, true);
}

/** Enables board input. Calling it again swaps the handlers, never stacks listeners. */
export function startChessInput(next: ChessBoardInteraction): void {
  interaction = next;
  installListeners();
}

/** Disables board input, dropping any held piece and any selection. */
export function stopChessInput(): void {
  cancelInteraction();
  interaction = null;
  removeListeners();
}

/** Drops the current selection, e.g. after a move was played. */
export function clearChessSelection(): void {
  clearSelection();
}
