// src/bugReport/project.ts
// Which mod sends the bug reports, as docs/bug-reports.md in aries-mod-backend
// lists it.
//
// src/bugReport/core/ is Arie's Mod's portable core (src/lib/bugReport there),
// copied as it is: never edit it here, copy it again from Arie's Mod.

import type { BugReportProject } from "./core/types";

export const BUG_REPORT_PROJECT = { id: "community-hub", name: "Community Hub" } as const satisfies { id: BugReportProject; name: string };
