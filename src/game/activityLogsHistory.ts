// src/game/activityLogsHistory.ts
// Cross-mod shim. Arie's Mod runs a watcher that re-renders the activity log
// modal from its locally persisted history whenever that modal opens. When the
// hub shows a FRIEND's activity log, that watcher must skip one reopen.
//
// The flag is published on the page window so the (hub-less) Arie's Mod
// release can consume it from its own bundle; without Arie's Mod the flag is
// simply never read and the fake modal works on its own.

import { pageWindow } from "@/platform/page-context";

export const SKIP_NEXT_ACTIVITY_LOG_REOPEN_GLOBAL = "__MG_SKIP_NEXT_ACTIVITY_LOG_REOPEN__";

export function skipNextActivityLogHistoryReopen(): void {
  (pageWindow as unknown as Record<string, unknown>)[SKIP_NEXT_ACTIVITY_LOG_REOPEN_GLOBAL] = true;
}
