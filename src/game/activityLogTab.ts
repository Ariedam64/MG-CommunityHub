// src/game/activityLogTab.ts
//
// Since v1396 the game's Stats and Activity Log modals are one: the
// `activityLog` modal with a Logs tab and a Stats tab, picked by
// `activityLogTabAtom`. The standalone `stats` modal no longer exists, so
// opening it does nothing. Same rule as Arie's Mod (utils/activityLogModalLayout.ts).

export const ACTIVITY_LOG_MODAL_ID = "activityLog";

export type ActivityLogTab = "logs" | "stats";

/**
 * What to write to show a tab: the tab first, then the modal, the order the
 * game uses. Stats included, since its own modal is gone.
 */
export function activityLogOpenTarget(tab: ActivityLogTab): { modal: string; tab: ActivityLogTab } {
  return { modal: ACTIVITY_LOG_MODAL_ID, tab };
}

/** The tab the modal is on, from the raw `activityLogTabAtom` value. Defaults to logs, as the game does. */
export function activityLogTabOf(value: unknown): ActivityLogTab {
  return value === "stats" ? "stats" : "logs";
}
