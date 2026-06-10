// src/storage/storage.ts
// Persistence for the standalone Community Hub.
// - API key / auth flags reuse the same keys as Arie's Mod so existing users
//   keep their Discord auth when switching to (or running alongside) this mod.
// - Hub-owned settings live in their own "mgch_hub" blob (one-time migration
//   of the notifications subtree from the legacy "aries_mod" blob).
// - readAriesPath stays available as a READ-ONLY view of Arie's Mod data
//   (pet teams, activity log history) when that mod is installed too.

declare const GM_getValue:
  | ((name: string, defaultValue?: string | null) => string | null | undefined)
  | undefined;
declare const GM_setValue: ((name: string, value: string) => void) | undefined;
declare const GM_deleteValue: ((name: string) => void) | undefined;

const HUB_STORAGE_KEY = "mgch_hub";
const ARIES_STORAGE_KEY = "aries_mod";
const API_KEY_STORAGE_KEY = "aries_api_key";
const AUTH_DECLINED_STORAGE_KEY = "aries_auth_declined";
const SEEN_ROOM_PRIVACY_NOTICE_KEY = "aries_seen_room_privacy_notice";

type AnyRecord = Record<string, any>;

function getHostStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    if (typeof window.localStorage === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function parseSafe(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getValueAtPath(obj: any, path: string[]): any {
  let cur = obj;
  for (const segment of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[segment];
  }
  return cur;
}

function setValueAtPath(obj: AnyRecord, path: string[], value: unknown): void {
  let cur: AnyRecord = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i]!;
    if (!cur[segment] || typeof cur[segment] !== "object") cur[segment] = {};
    cur = cur[segment];
  }
  const last = path[path.length - 1];
  if (last === undefined) return;
  if (value === undefined) delete cur[last];
  else cur[last] = value;
}

/* ------------------------------ Hub blob ------------------------------ */

function loadHubStorage(): AnyRecord {
  const storage = getHostStorage();
  if (!storage) return {};
  const parsed = parseSafe(storage.getItem(HUB_STORAGE_KEY));
  if (parsed && typeof parsed === "object") return parsed as AnyRecord;
  return migrateFromAriesBlob();
}

/** First run without a hub blob: import hub-owned settings from Arie's Mod. */
function migrateFromAriesBlob(): AnyRecord {
  const result: AnyRecord = {};
  const aries = readAriesBlob();
  if (aries?.notifications && typeof aries.notifications === "object") {
    result.notifications = { ...aries.notifications };
  }
  persistHubStorage(result);
  return result;
}

function persistHubStorage(data: AnyRecord): void {
  try {
    getHostStorage()?.setItem(HUB_STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore persistence errors */
  }
}

export function readHubPath<T = unknown>(path: string, fallback?: T): T | undefined {
  const value = getValueAtPath(loadHubStorage(), path.split(".").filter(Boolean));
  if (value === undefined) return fallback;
  return value as T;
}

export function writeHubPath<T = unknown>(path: string, value: T | undefined): void {
  const data = loadHubStorage();
  setValueAtPath(data, path.split(".").filter(Boolean), value);
  persistHubStorage(data);
}

/* ----------------------- Arie's Mod blob (read-only) ----------------------- */

function readAriesBlob(): AnyRecord | null {
  const storage = getHostStorage();
  if (!storage) return null;
  const parsed = parseSafe(storage.getItem(ARIES_STORAGE_KEY));
  return parsed && typeof parsed === "object" ? (parsed as AnyRecord) : null;
}

/**
 * Read-only access to Arie's Mod persisted data (e.g. "pets.teams",
 * "activityLog.history"). Returns the fallback when Arie's Mod is absent.
 */
export function readAriesPath<T = unknown>(path: string, fallback?: T): T | undefined {
  const blob = readAriesBlob();
  if (!blob) return fallback;
  const value = getValueAtPath(blob, path.split(".").filter(Boolean));
  if (value === undefined) return fallback;
  return value as T;
}

/* ------------------------------ API key ------------------------------ */

export function setApiKey(apiKey: string): void {
  try {
    if (typeof GM_setValue === "function") {
      GM_setValue(API_KEY_STORAGE_KEY, apiKey);
      return;
    }
    getHostStorage()?.setItem(API_KEY_STORAGE_KEY, apiKey);
  } catch (e) {
    console.error("Failed to store API key:", e);
  }
}

export function getApiKey(): string | null {
  try {
    if (typeof GM_getValue === "function") {
      return GM_getValue(API_KEY_STORAGE_KEY, null) ?? null;
    }
    return getHostStorage()?.getItem(API_KEY_STORAGE_KEY) ?? null;
  } catch (e) {
    console.error("Failed to retrieve API key:", e);
    return null;
  }
}

export function clearApiKey(): void {
  try {
    if (typeof GM_deleteValue === "function") {
      GM_deleteValue(API_KEY_STORAGE_KEY);
      return;
    }
    getHostStorage()?.removeItem(API_KEY_STORAGE_KEY);
  } catch (e) {
    console.error("Failed to clear API key:", e);
  }
}

export function hasApiKey(): boolean {
  const key = getApiKey();
  return key !== null && key.length > 0;
}

/* --------------------------- Auth declined flag --------------------------- */

function readAuthDeclinedRaw(): string | null {
  try {
    if (typeof GM_getValue === "function") {
      const raw = GM_getValue(AUTH_DECLINED_STORAGE_KEY, null);
      if (raw == null) return null;
      if (typeof raw === "string") return raw;
      if (typeof raw === "boolean") return raw ? "1" : null;
      return String(raw);
    }
    return getHostStorage()?.getItem(AUTH_DECLINED_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function hasDeclinedApiAuth(): boolean {
  const raw = readAuthDeclinedRaw();
  if (!raw) return false;
  const val = String(raw).trim().toLowerCase();
  return val === "1" || val === "true" || val === "yes";
}

export function setDeclinedApiAuth(declined: boolean): void {
  try {
    if (declined) {
      if (typeof GM_setValue === "function") {
        GM_setValue(AUTH_DECLINED_STORAGE_KEY, "1");
        return;
      }
      getHostStorage()?.setItem(AUTH_DECLINED_STORAGE_KEY, "1");
      return;
    }
    if (typeof GM_deleteValue === "function") {
      GM_deleteValue(AUTH_DECLINED_STORAGE_KEY);
      return;
    }
    getHostStorage()?.removeItem(AUTH_DECLINED_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/* ----------------------- Room privacy notice flag ----------------------- */

export function hasSeenRoomPrivacyNotice(): boolean {
  try {
    if (typeof GM_getValue === "function") {
      const raw = GM_getValue(SEEN_ROOM_PRIVACY_NOTICE_KEY, null);
      if (raw == null) return false;
      if (typeof raw === "boolean") return raw;
      return String(raw).trim() === "1";
    }
    return getHostStorage()?.getItem(SEEN_ROOM_PRIVACY_NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markRoomPrivacyNoticeSeen(): void {
  try {
    if (typeof GM_setValue === "function") {
      GM_setValue(SEEN_ROOM_PRIVACY_NOTICE_KEY, "1");
      return;
    }
    getHostStorage()?.setItem(SEEN_ROOM_PRIVACY_NOTICE_KEY, "1");
  } catch {
    /* ignore */
  }
}
