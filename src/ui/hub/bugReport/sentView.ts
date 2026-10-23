// src/ui/hub/bugReport/sentView.ts
// What the New report tab shows once a report went through: its reference to
// copy, a word on screenshots that did not make it, and the way on.

import { describeBugReportError, type SubmitResult } from "@/bugReport/core/client";
import { button, copyText, el } from "./dom";

type Sent = Extract<SubmitResult, { ok: true }>;

const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

export function showSentView(
  container: HTMLElement,
  result: Sent,
  actions: { onMyReports: () => void; onNewReport: () => void },
): void {
  const { report, attachmentFailures } = result;
  const root = el("div", "qws-ch-bug-success");
  const icon = el("div", "qws-ch-bug-success-icon");
  icon.innerHTML = CHECK_SVG;
  root.append(icon, el("div", "qws-ch-bug-success-title", "Thanks, your report was sent."));
  if (result.resumed) {
    // The answer to an earlier try was lost, but that try had arrived: the server kept its text.
    root.appendChild(el("p", "qws-ch-bug-note", "Your earlier try had already arrived, so the report keeps the text you sent then."));
  }

  const ref = el("div", "qws-ch-bug-ref");
  const copy = button("Copy", {
    title: "Copy the reference",
    lockWhilePending: true,
    onClick: async () => {
      copy.textContent = (await copyText(report.ref)) ? "Copied" : "Copy failed";
    },
  });
  ref.append(el("span", "qws-ch-bug-ref-code", report.ref), copy);
  root.append(
    ref,
    el(
      "p",
      "qws-ch-bug-note",
      "Mention this reference if you talk about it on Discord. Its status, and any reply, show up in My reports.",
    ),
  );

  if (attachmentFailures.length) {
    const count = attachmentFailures.length;
    const reason = describeBugReportError(attachmentFailures[0].error);
    const warning = el("div", "qws-ch-bug-notice");
    warning.appendChild(
      el("span", undefined, `${count} screenshot${count > 1 ? "s" : ""} could not be uploaded, but the report itself arrived. ${reason}`),
    );
    root.appendChild(warning);
  }

  const buttons = el("div", "qws-ch-bug-actions");
  buttons.append(
    button("See my reports", { onClick: actions.onMyReports }),
    button("New report", { variant: "primary", onClick: actions.onNewReport }),
  );
  root.appendChild(buttons);
  container.replaceChildren(root);
}
