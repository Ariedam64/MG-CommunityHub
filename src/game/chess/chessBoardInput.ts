// src/services/editor/chessBoardInput.ts
//
// Board interaction: a piece can be moved either by dragging it, or by clicking
// it once to select and clicking a highlighted square to play. Both share one
// state machine, so they never fight: a press becomes a drag only once the
// pointer travels past a small threshold, and stays a click otherwise.
//
// The right button never moves anything: it draws the annotations, on its own
// small state machine, and the two can't run at the same time.
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

  /**
   * Annotations. Display only, and always allowed - a player thinks about the
   * position on the opponent's clock too, and a finished board is still worth
   * drawing on.
   */
  markSquare(square: ChessSquare): void;
  markArrow(from: ChessSquare, to: ChessSquare): void;
  clearMarks(): void;
};

/** While dragged, the piece must float above the other pieces. */
const DRAG_Z_INDEX = 999999;

const LEFT_BUTTON = 0;
const RIGHT_BUTTON = 2;

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
/** The square a held right button started on. Nothing is drawn until it lifts. */
let markPress: ChessSquare | null = null;
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

/**
 * The tile under the pointer, or null when the pointer isn't on the canvas.
 * Takes any mouse event: the projection only reads the coordinates, and the
 * context menu has to be resolved to a square the same way a press is.
 */
function hitSquare(ev: MouseEvent): ChessSquare | null {
  if (!tos.isReady()) return null;
  const canvas = tos.getCanvas();
  if (!canvas || ev.target !== canvas) return null;

  const info = tos.pointerToFarmTile(ev as PointerEvent);
  return info ? { tx: info.tx, ty: info.ty } : null;
}

/** A square that belongs to the board, or null for anything else. */
function hitBoardSquare(ev: MouseEvent): ChessSquare | null {
  const square = hitSquare(ev);
  if (!square || !interaction?.isBoardSquare(square)) return null;
  return square;
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
  markPress = null;
  clearSelection();
}

/* -------------------------------------------------------------------------- */
/* Annotations                                                                */
/* -------------------------------------------------------------------------- */

/** A right press on the board opens an annotation; anywhere else is ignored. */
function beginMarkPress(ev: PointerEvent): void {
  if (!interaction || press || markPress) return;

  const square = hitBoardSquare(ev);
  if (!square) return;

  markPress = square;

  ev.preventDefault();
  ev.stopPropagation();
}

/**
 * Releasing decides which annotation it was: on the square it started from it
 * marks that square, on another it draws the arrow, and off the board it
 * cancels. Only here does anything appear - the drag itself draws nothing.
 */
function finishMarkPress(ev: PointerEvent): void {
  const from = markPress;
  markPress = null;
  if (!from || !interaction) return;

  ev.preventDefault();
  ev.stopPropagation();

  const square = hitBoardSquare(ev);
  if (!square) return;

  if (sameSquare(square, from)) interaction.markSquare(square);
  else interaction.markArrow(from, square);
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
  if (!interaction) return;

  if (ev.button === RIGHT_BUTTON) {
    beginMarkPress(ev);
    return;
  }

  if (press || ev.button !== LEFT_BUTTON) return;

  const square = hitSquare(ev);
  if (!square) return;

  // Any left click on the board wipes the annotations, whatever it goes on to
  // do - which is how a move clears them too, since a move starts with one.
  if (interaction.isBoardSquare(square)) {
    markPress = null;
    interaction.clearMarks();
  }

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
  // A right button dragging out an arrow draws nothing on the way, but the
  // board still swallows the move: the game must not read it as anything.
  if (markPress) {
    ev.preventDefault();
    ev.stopPropagation();
    return;
  }

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
  if (markPress && ev.button === RIGHT_BUTTON) {
    finishMarkPress(ev);
    return;
  }

  // Only the button that picked the piece up can drop it: releasing the other
  // one mid-drag would land the move somewhere the player never aimed at.
  // Touch and pen both report 0 here, so they still go through.
  if (ev.button !== LEFT_BUTTON) return;

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

/**
 * Only over the board: a right click anywhere else on the canvas keeps its
 * menu. It needs its own listener because the menu is not opened by the press
 * or the release - browsers pick one or the other - and preventing it there
 * would only work on half of them.
 */
function handleContextMenu(ev: MouseEvent): void {
  if (!interaction || !hitBoardSquare(ev)) return;
  ev.preventDefault();
  ev.stopPropagation();
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
  window.addEventListener("contextmenu", handleContextMenu, true);
}

function removeListeners(): void {
  if (!listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = false;

  window.removeEventListener("pointerdown", handlePointerDown, true);
  window.removeEventListener("pointermove", handlePointerMove, true);
  window.removeEventListener("pointerup", handlePointerUp, true);
  window.removeEventListener("pointercancel", cancelInteraction, true);
  window.removeEventListener("contextmenu", handleContextMenu, true);
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
