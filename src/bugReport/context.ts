// src/bugReport/context.ts
// Everything a report carries that the player does not type: which hub and
// game build, where it runs, who sends it, what the session looked like.
// Each read is bounded in time, so a game that is not fully loaded (the very
// case worth reporting) still lets the report go out with what is known.
//
// No settings go along: the hub has nothing that would explain a bug the way
// Arie's Mod's feature switches do, and its storage holds the API key.

import { buildPlayerStatePayload, getMyAccountId } from "@/api/endpoints/state";
import { detectEnvironment } from "@/platform/api";
import { diagnostics } from "@/platform/diagnostics";
import { MGVersion } from "@/platform/mgVersion";
import { getUpdateState } from "@/platform/modUpdate";
import { getLocalVersion } from "@/platform/version";
import { hasApiKey } from "@/storage/storage";
import { Atoms } from "@/store/atoms";
import { isStoreCaptured } from "@/store/jotai";
import type { BugReportContext, BugReportPayload } from "./core/types";
import { BUG_REPORT_PROJECT } from "./project";

/** What the player agreed to attach. Technical info always goes. */
export type AttachedData = { logs: boolean; accountState: boolean };

export type AutoFields = Pick<
  BugReportPayload,
  "project" | "modName" | "modVersion" | "gameVersion" | "playerId" | "playerName" | "includeAccountState" | "context"
>;

const READ_TIMEOUT_MS = 2_500;

/** `promise`, or `fallback` once `ms` have passed or when it fails. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function scriptHandler(): string | null {
  try {
    if (typeof GM_info === "undefined") return null;
    return [GM_info.scriptHandler, GM_info.version].filter(Boolean).join(" ") || null;
  } catch {
    return null;
  }
}

function environment(): BugReportContext["environment"] {
  const env = detectEnvironment();
  return {
    surface: env.surface,
    host: env.host,
    platform: env.platform,
    inIframe: env.isInIframe,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: typeof screen !== "undefined" ? `${screen.width}x${screen.height}` : null,
    dpr: window.devicePixelRatio || 1,
    scriptHandler: scriptHandler(),
    language: navigator.language,
    uptimeSec: Math.round(performance.now() / 1000),
  };
}

/** The game build, from the page when it says, else from the game's version route. */
function gameVersion(): Promise<string | null> {
  const known = MGVersion.get();
  if (known) return Promise.resolve(known);
  return within(MGVersion.fetchGameVersion(), READ_TIMEOUT_MS, null);
}

export async function collectAutoFields(attached: AttachedData): Promise<AutoFields> {
  const [game, playerId, state, activeModal] = await Promise.all([
    gameVersion(),
    within(getMyAccountId(), READ_TIMEOUT_MS, null),
    within(buildPlayerStatePayload(), READ_TIMEOUT_MS, null),
    within(Atoms.ui.activeModal.get(), READ_TIMEOUT_MS, null),
  ]);

  // The last update check, from cache: no request while the player waits.
  const update = getUpdateState();
  const context: BugReportContext = {
    environment: environment(),
    mod: { latestVersion: update.latest, behind: update.status === "updateAvailable" },
    game: {
      roomId: state?.room.id ?? null,
      playersInRoom: state?.room.playersCount ?? null,
      activeModal: typeof activeModal === "string" ? activeModal : null,
      // Health signals: a store never captured explains a whole class of
      // "nothing loads" reports, and most of the hub needs the player signed in.
      storeCaptured: isStoreCaptured(),
      signedIn: hasApiKey(),
    },
  };
  if (attached.logs) {
    context.logs = diagnostics.logs();
    context.breadcrumbs = diagnostics.breadcrumbs();
  }

  return {
    project: BUG_REPORT_PROJECT.id,
    modName: BUG_REPORT_PROJECT.name,
    modVersion: getLocalVersion() ?? null,
    gameVersion: game,
    playerId,
    playerName: state?.playerName ?? null,
    includeAccountState: attached.accountState,
    context,
  };
}
