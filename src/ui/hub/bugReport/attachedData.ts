// src/ui/hub/bugReport/attachedData.ts
// "Attached data": what goes with the report besides the player's words, each
// part with its own switch and a sentence saying what it is. Technical info
// always goes, and says so. The preview shows the exact body before sending.

import type { AttachedData } from "@/bugReport/context";
import { BUG_REPORT_PROJECT } from "@/bugReport/project";
import { button, el, openDialog, switchInput } from "./dom";

export type AttachedDataSection = {
  root: HTMLElement;
  read(): AttachedData;
  reset(): void;
};

function dataRow(title: string, description: string, control: HTMLElement): HTMLElement {
  const row = el("div", "qws-ch-bug-data-row");
  const text = el("div", "qws-ch-bug-data-text");
  text.append(el("div", "qws-ch-bug-data-title", title), el("div", "qws-ch-bug-data-desc", description));
  row.append(text, control);
  return row;
}

export function buildAttachedData(onPreview: () => Promise<void>): AttachedDataSection {
  const logs = switchInput(true, "Recent console errors");
  const accountState = switchInput(true, "Account state");
  const technical = switchInput(true, "Technical info");
  technical.input.disabled = true;
  technical.root.title = "Always included";

  const section = el("div", "qws-ch-bug-section");
  section.append(
    el("div", "qws-ch-bug-section-title", "Attached data"),
    el("div", "qws-ch-bug-section-sub", "Sent with your report, only to the mod's developer."),
    dataRow(
      "Recent console errors",
      "The last errors and warnings in this tab, and which hub tabs and game windows you opened just before.",
      logs.root,
    ),
    dataRow(
      "Account state",
      `Lets the developer see the garden and inventory ${BUG_REPORT_PROJECT.name} already syncs, as they are when you send this.`,
      accountState.root,
    ),
    dataRow(
      "Technical info",
      "Hub and game versions, browser and screen size, room and player count. Always included.",
      technical.root,
    ),
  );
  const previewRow = el("div", "qws-ch-bug-actions");
  previewRow.appendChild(button("Preview what will be sent", { lockWhilePending: true, onClick: onPreview }));
  section.appendChild(previewRow);

  return {
    root: section,
    read: () => ({ logs: logs.input.checked, accountState: accountState.input.checked }),
    reset() {
      logs.input.checked = true;
      accountState.input.checked = true;
    },
  };
}

/** The exact JSON body, and what the screenshots that follow it weigh. */
export function showPreviewDialog(
  host: HTMLElement,
  body: unknown,
  screenshots: Array<{ kind: string; width: number; height: number; bytes: number }>,
  note: string | null,
): void {
  const dialog = openDialog(host, "What will be sent");
  dialog.body.appendChild(
    el(
      "p",
      "qws-ch-bug-note",
      "This is the report exactly as it goes to the server, with anything that looks like a password or a key already hidden.",
    ),
  );
  if (note) dialog.body.appendChild(el("p", "qws-ch-bug-hint", note));
  // textContent, never markup: the player's text is shown as typed.
  dialog.body.appendChild(el("pre", "qws-ch-bug-json", JSON.stringify(body, null, 2)));
  const shots = screenshots.length
    ? `Then ${screenshots.length} screenshot${screenshots.length > 1 ? "s" : ""}, one request each: ${screenshots
        .map((shot) => `${shot.kind} ${shot.width} x ${shot.height}, ${Math.round(shot.bytes / 1024)} KB`)
        .join("; ")}.`
    : "No screenshot.";
  dialog.body.appendChild(el("p", "qws-ch-bug-hint", shots));
  dialog.footer.appendChild(button("Close", { variant: "primary", onClick: () => dialog.close() }));
}
