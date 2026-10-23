// src/bugReport/breadcrumbs.ts
// The trail a bug report carries: when the hub was opened or closed, which
// game window was up. The hub's own tabs note themselves when they switch
// (ui/hub/index.ts). The lines stay in memory (platform/diagnostics) and only
// leave with a report.

import { recordBreadcrumb } from "@/platform/diagnostics";
import { Atoms } from "@/store/atoms";
import { CH_EVENTS } from "@/ui/hub/shared";

let started = false;

export function startBugReportBreadcrumbs(): void {
  if (started) return;
  started = true;
  window.addEventListener(CH_EVENTS.OPEN, () => recordBreadcrumb("opened the Community Hub"));
  window.addEventListener(CH_EVENTS.CLOSE, () => recordBreadcrumb("closed the Community Hub"));
  // The modal atom may never resolve (a renamed label): no trail then, and no
  // rejection left unhandled either.
  Atoms.ui.activeModal
    .onChange((modal) => recordBreadcrumb(modal ? `game window ${modal}` : "game window closed"))
    .catch(() => undefined);
}
