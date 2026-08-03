// src/game/chess/chessBoardSounds.ts
//
// Chess sound effects, using chess.com's own sample set.
//
// We own the audio elements rather than routing through any of the game's
// helpers: those match already-loaded samples by file name, and the matching
// strips long suffixes — "move-opponent.mp3" reduces to "move.mp3", which can
// collide with one of the game's own assets and play the wrong sample.
//
// The volume still follows the player's SFX slider (see gameSfxVolume below),
// so muting the game mutes the board.

import { getAudioUrlSafe } from "@/platform/discordCsp";

export type ChessSoundName =
  | "move"
  | "moveOpponent"
  | "capture"
  | "castle"
  | "check"
  | "promote"
  | "gameEnd"
  | "gameStart"
  | "illegal";

const SOUND_BASE = "https://images.chesscomfiles.com/chess-themes/sounds";

const SOUND_URLS: Record<ChessSoundName, string> = {
  move: `${SOUND_BASE}/_MP3_/default/move-self.mp3`,
  moveOpponent: `${SOUND_BASE}/_MP3_/default/move-opponent.mp3`,
  capture: `${SOUND_BASE}/_MP3_/default/capture.mp3`,
  castle: `${SOUND_BASE}/_MP3_/default/castle.mp3`,
  check: `${SOUND_BASE}/_MP3_/default/move-check.mp3`,
  promote: `${SOUND_BASE}/_MP3_/default/promote.mp3`,
  gameEnd: `${SOUND_BASE}/_WEBM_/default/game-end.webm`,
  gameStart: `${SOUND_BASE}/_MP3_/default/game-start.mp3`,
  illegal: `${SOUND_BASE}/_MP3_/default/illegal.mp3`,
};

// ── Volume ───────────────────────────────────────────────────────────────────

/** localStorage key holding the game's SFX slider value. */
const SFX_ATOM_KEY = "soundEffectsVolumeAtom";

/** Bottom of the game's SFX scale. The slider bottoms out here, meaning mute. */
const GAME_SFX_SCALE_MIN = 0.001;

/**
 * Top of the game's SFX volume scale. That scale is meant for Howler, not for
 * HTMLAudioElement.volume which expects 0..1 — so the value has to be
 * normalised against this, otherwise a slider at maximum still plays at a
 * fifth of the volume.
 */
const GAME_SFX_SCALE_MAX = 0.2;

/** Applied after normalising. Lower it if the samples sit above the game's own. */
const CHESS_SOUND_GAIN = 1;

function readSfxAtomRaw(): number | null {
  try {
    const raw = localStorage.getItem(SFX_ATOM_KEY);
    if (raw == null) return null;
    try {
      const value = JSON.parse(raw);
      if (typeof value === "number") return value;
      const match = JSON.stringify(value).match(/-?\d+(?:\.\d+)?/);
      return match ? parseFloat(match[0]) : null;
    } catch {
      const match = String(raw).match(/-?\d+(?:\.\d+)?/);
      return match ? parseFloat(match[0]) : null;
    }
  } catch {
    return null;
  }
}

function howlerMaster(): number {
  try {
    const howler = (window as any).Howler;
    return howler && typeof howler.volume === "function" ? Number(howler.volume()) : 1;
  } catch {
    return 1;
  }
}

/**
 * The player's SFX volume, normalised to the 0..1 that HTMLAudioElement wants.
 * A slider sitting at the very bottom of the scale is a real mute, not a very
 * quiet sound.
 */
function gameSfxVolume(): number {
  const raw = readSfxAtomRaw() ?? GAME_SFX_SCALE_MAX;
  const clamped = Math.max(GAME_SFX_SCALE_MIN, Math.min(GAME_SFX_SCALE_MAX, raw));
  const muted = Math.abs(clamped - GAME_SFX_SCALE_MIN) < 1e-6;
  if (muted) return 0;

  const normalised = (clamped / GAME_SFX_SCALE_MAX) * howlerMaster() * CHESS_SOUND_GAIN;
  return Math.max(0, Math.min(1, normalised));
}

// ── Playback ─────────────────────────────────────────────────────────────────

const elements = new Map<ChessSoundName, HTMLAudioElement>();

/** Logged once: a blocked host would otherwise spam the console on every move. */
let playbackWarned = false;

function element(name: ChessSoundName): HTMLAudioElement | null {
  return elements.get(name) ?? null;
}

/**
 * Warms the cache so the first move doesn't wait on a download.
 *
 * Under Discord Activity the CSP blocks images.chesscomfiles.com outright, so
 * every URL has to go through getAudioUrlSafe, which refetches it via
 * GM_xmlhttpRequest and hands back a blob: URL. That is why this is async and
 * why playChessSound stays silent until it has run.
 */
export async function preloadChessSounds(): Promise<void> {
  await Promise.all(
    (Object.keys(SOUND_URLS) as ChessSoundName[]).map(async (name) => {
      if (elements.has(name)) return;
      try {
        const url = await getAudioUrlSafe(SOUND_URLS[name]);
        const audio = new Audio();
        audio.preload = "auto";
        audio.src = url;
        elements.set(name, audio);
        audio.load();
      } catch {
        /* a missing sample must never break the board */
      }
    }),
  );
}

export function playChessSound(name: ChessSoundName): void {
  // Read on every play so the slider is followed live; 0 means the player muted.
  const volume = gameSfxVolume();
  if (!(volume > 0)) return;

  const audio = element(name);
  if (!audio) return;

  try {
    audio.volume = volume;
    audio.currentTime = 0;
    void audio.play().catch((error: unknown) => {
      if (playbackWarned) return;
      playbackWarned = true;
      console.log("[ChessBoard] sound playback blocked", error);
    });
  } catch {
    /* ignore */
  }
}

/** Silences anything still playing. The cache is kept for the next board. */
export function stopChessSounds(): void {
  for (const audio of elements.values()) {
    try {
      audio.pause();
    } catch {
      /* ignore */
    }
  }
}
