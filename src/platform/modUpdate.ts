// src/platform/modUpdate.ts
// Tracks whether a newer published build of the mod exists.
//
// The last result is persisted, so the "update available" dot comes back
// immediately on the next page load without waiting for a network round trip.

import { fetchRemoteVersion, getLocalVersion, getDownloadUrl } from "./version";
import { readHubPath, writeHubPath } from "@/storage/storage";

const STORAGE_LATEST_VERSION = "update.latestVersion";
const STORAGE_LAST_CHECK_AT = "update.lastCheckAt";

/** Automatic checks are throttled to this; the manual button ignores it. */
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const MOD_UPDATE_EVENT = "qws:mod-update";

export type ModUpdateStatus =
  | "unknown"
  | "checking"
  | "upToDate"
  | "updateAvailable"
  | "error";

export interface ModUpdateState {
  /** Version currently running, when the script manager exposes it. */
  installed: string | null;
  /** Latest published version, from the last successful check. */
  latest: string | null;
  status: ModUpdateStatus;
}

let checking = false;
let lastError = false;
let inFlight: Promise<ModUpdateState> | null = null;

/**
 * Compare two dot-separated versions.
 * Returns a negative number when `a` is older, 0 when equal, positive when newer.
 * Non-numeric parts count as 0, so "1.2.0-beta" ranks with "1.2.0".
 */
export function compareVersions(a: string, b: string): number {
  const partsA = splitVersion(a);
  const partsB = splitVersion(b);
  const length = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < length; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }

  return 0;
}

function splitVersion(version: string): number[] {
  return String(version ?? "")
    .trim()
    .split(".")
    .map((part) => {
      const numeric = parseInt(part, 10);
      return Number.isFinite(numeric) ? numeric : 0;
    });
}

/** True when `latest` is strictly newer than `installed`. */
export function isNewerVersion(installed: string | null, latest: string | null): boolean {
  if (!installed || !latest) return false;
  return compareVersions(latest, installed) > 0;
}

function readCachedLatest(): string | null {
  const cached = readHubPath<string>(STORAGE_LATEST_VERSION);
  return typeof cached === "string" && cached.length > 0 ? cached : null;
}

function readLastCheckAt(): number {
  const value = readHubPath<number>(STORAGE_LAST_CHECK_AT);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Current state, from cache only — never hits the network. */
export function getUpdateState(): ModUpdateState {
  const installed = getLocalVersion() ?? null;
  const latest = readCachedLatest();

  let status: ModUpdateStatus;
  if (checking) status = "checking";
  else if (isNewerVersion(installed, latest)) status = "updateAvailable";
  else if (lastError && !latest) status = "error";
  else if (latest) status = "upToDate";
  else status = "unknown";

  return { installed, latest, status };
}

export function isUpdateAvailable(): boolean {
  return getUpdateState().status === "updateAvailable";
}

function emitChange(): void {
  window.dispatchEvent(new CustomEvent(MOD_UPDATE_EVENT, { detail: getUpdateState() }));
}

export interface CheckOptions {
  /** Skip the throttle. Set by the manual "Check for updates" button. */
  force?: boolean;
}

/**
 * Look up the published version. Never throws — failures surface as the
 * "error" status so the UI can say so and move on.
 */
export async function checkForUpdates(options: CheckOptions = {}): Promise<ModUpdateState> {
  if (inFlight) return await inFlight;

  if (!options.force) {
    const elapsed = Date.now() - readLastCheckAt();
    if (elapsed >= 0 && elapsed < AUTO_CHECK_INTERVAL_MS) return getUpdateState();
  }

  checking = true;
  lastError = false;
  emitChange();

  inFlight = (async () => {
    try {
      const remote = await fetchRemoteVersion();
      const version = remote?.version?.trim();

      if (version) {
        writeHubPath(STORAGE_LATEST_VERSION, version);
        writeHubPath(STORAGE_LAST_CHECK_AT, Date.now());
      } else {
        lastError = true;
      }
    } catch {
      lastError = true;
    } finally {
      checking = false;
      inFlight = null;
    }

    const state = getUpdateState();
    // A failed check keeps the cached version, so surface the failure here
    // rather than letting a stale "up to date" pass for a fresh answer.
    const result: ModUpdateState = lastError ? { ...state, status: "error" } : state;
    window.dispatchEvent(new CustomEvent(MOD_UPDATE_EVENT, { detail: result }));
    return result;
  })();

  return await inFlight;
}

/** Kick off the throttled background check. Fire and forget. */
export function startUpdateWatch(): void {
  void checkForUpdates().catch(() => {
    /* checkForUpdates already swallows its own failures */
  });
}

export type OpenUpdateResult = "opened" | "blocked";

/**
 * Send the user to the published script so their manager offers the update.
 * A userscript cannot replace itself, so this is as far as we can take it.
 *
 * GM_openInTab is the path that matters: the script manager opens the tab
 * from the extension, so it is not subject to the sandbox of whatever frame
 * we happen to be running in. That is what makes this work inside the
 * Discord activity iframe, where window.open is likely to be refused.
 *
 * Returns "blocked" when no tab could be opened, so the caller can fall
 * back to showing the address.
 */
export function openUpdatePage(): OpenUpdateResult {
  const url = getDownloadUrl();

  if (typeof GM_openInTab === "function") {
    try {
      GM_openInTab(url, { active: true, insert: true });
      return "opened";
    } catch {
      /* fall through to window.open */
    }
  }

  // A blocked popup returns null; a sandboxed frame can also throw outright.
  try {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    return opened ? "opened" : "blocked";
  } catch {
    return "blocked";
  }
}

/** The address of the published script, for the copy fallback. */
export function getUpdateUrl(): string {
  return getDownloadUrl();
}
