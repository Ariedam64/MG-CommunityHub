// src/platform/diagnostics.ts
// What a bug report says about the moments before it was sent: the page's
// last console errors and warnings, uncaught errors, and a trail of what the
// player did. All of it stays in memory and only leaves with a report the
// player chose to send.
//
// Installed first thing at startup so the earliest errors are caught. Under
// `@inject-into page` the hub shares the game's console, so the game's own
// errors land here too, which is often what a diagnosis needs. With Arie's
// Mod on the same page, each mod wraps the console in turn and both keep
// their own copy.

import { createLogCapture } from "@/bugReport/core/logCapture";
import { pageWindow } from "./page-context";

export const diagnostics = createLogCapture({ maxLogs: 200, maxBreadcrumbs: 100 });

let installed = false;

export function installDiagnostics(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  diagnostics.install(pageWindow);
  // A manager that sandboxes the script gives it a console and events of its
  // own; the capture skips whatever it already wraps.
  if (pageWindow !== window) diagnostics.install(window);
}

/** Notes something worth knowing in a report, e.g. "opened hub tab messages". */
export function recordBreadcrumb(message: string): void {
  diagnostics.breadcrumb(message);
}
