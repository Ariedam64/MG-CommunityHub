// src/game/chess/chessClock.ts
//
// The two clocks, counted down locally between server updates.
//
// Only the side to move burns time; the other is frozen. Every payload carrying
// a `clock` also carries `serverTime`, which is what makes this possible: we
// take the offset between their clock and ours at reception, so a player whose
// system time is wrong still sees the right numbers.

import type { ChessClock, ChessColor } from "@/api/types";

/** Below this, the display switches to tenths and turns urgent. */
export const CLOCK_URGENT_MS = 20_000;

const TICK_MS = 200;

export type ClockReading = {
  whiteMs: number;
  blackMs: number;
  turn: ChessColor;
  /** True once the side to move has run out, by our reckoning. */
  flagged: boolean;
  flaggedSide: ChessColor | null;
};

type ClockState = {
  base: ChessClock;
  /** serverTime - Date.now() at reception. */
  offsetMs: number;
  turnStartedAtMs: number;
  running: boolean;
};

let state: ClockState | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(reading: ClockReading) => void>();

/**
 * Adopts a clock payload. Called on every match, move and end event — each one
 * re-derives the offset, so drift never accumulates.
 */
export function syncChessClock(clock: ChessClock | null | undefined, running = true): void {
  if (!clock) return;

  const serverNow = Date.parse(clock.serverTime);
  const turnStartedAt = Date.parse(clock.turnStartedAt);
  if (!Number.isFinite(serverNow) || !Number.isFinite(turnStartedAt)) return;

  state = {
    base: clock,
    offsetMs: serverNow - Date.now(),
    turnStartedAtMs: turnStartedAt,
    running,
  };

  emit();
}

/** Freezes the countdown where it stands — the game is over. */
export function stopChessClock(): void {
  if (state) state.running = false;
  emit();
}

export function readChessClock(): ClockReading | null {
  if (!state) return null;

  const { base, offsetMs, turnStartedAtMs, running } = state;
  const elapsed = running ? Math.max(0, Date.now() + offsetMs - turnStartedAtMs) : 0;

  const whiteMs = base.turn === "white" ? Math.max(0, base.whiteMs - elapsed) : base.whiteMs;
  const blackMs = base.turn === "black" ? Math.max(0, base.blackMs - elapsed) : base.blackMs;

  const activeMs = base.turn === "white" ? whiteMs : blackMs;
  const flagged = running && activeMs <= 0;

  return { whiteMs, blackMs, turn: base.turn, flagged, flaggedSide: flagged ? base.turn : null };
}

function emit(): void {
  const reading = readChessClock();
  if (!reading) return;
  for (const listener of listeners) {
    try {
      listener(reading);
    } catch {
      /* a broken listener must not stop the clock */
    }
  }
}

/**
 * Subscribes to the countdown. The ticker only runs while someone is watching,
 * and 200ms is plenty for an mm:ss readout — a requestAnimationFrame here would
 * cost a wake-up every frame for a display that changes ten times a second at
 * most.
 */
export function onChessClockTick(listener: (reading: ClockReading) => void): () => void {
  listeners.add(listener);

  if (!timer) timer = setInterval(emit, TICK_MS);
  emit();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function resetChessClock(): void {
  state = null;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  listeners.clear();
}

/** `9:07`, or `0:08.4` once the clock is urgent. */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (clamped < CLOCK_URGENT_MS) {
    const tenths = Math.floor((clamped % 1000) / 100);
    return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
