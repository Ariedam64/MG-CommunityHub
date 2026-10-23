// src/ui/hub/bugReport/myReportsTab.ts
// The My reports tab: the reports sent from this browser, with their status,
// the version that fixes them, the developer's reply and the conversation,
// where the player can answer. Read with the follow tokens kept at sending
// time, so it works without any account.

import { bugReportClient } from "@/api/endpoints/bugReports";
import { addReportComment, describeBugReportError, listMyReports, type FollowedReport } from "@/bugReport/core/client";
import { BUG_REPORT_LIMITS } from "@/bugReport/core/limits";
import type { SentReport } from "@/bugReport/core/sentReports";
import { acceptsComments, statusLabel } from "@/bugReport/core/status";
import type { MyBugReport } from "@/bugReport/core/types";
import { isVersionBelow } from "@/bugReport/core/version";
import { onSentReportsChange, readSentReports } from "@/bugReport/sentStore";
import { openUpdatePage } from "@/platform/modUpdate";
import { getLocalVersion } from "@/platform/version";
import { hasApiKey } from "@/storage/storage";
import { button, el, formatDate, notice } from "./dom";

/** Not more often than this unless asked, or a new report was sent. */
const MIN_REFRESH_MS = 30_000;
const AUTO_REFRESH_MS = 5 * 60_000;

export type MyReportsTab = {
  root: HTMLElement;
  /** The tab came into view: refresh unless it did very recently. */
  show(): void;
  destroy(): void;
};

type Row = { local: SentReport | null; remote: MyBugReport | null; id: number };

function toneOf(status: string): string {
  if (status === "fixed") return " ok";
  if (status === "needs_info") return " warn";
  return "";
}

function pill(text: string, tone = ""): HTMLElement {
  return el("span", `qws-ch-bug-pill${tone}`, text);
}

/** `isShown` says whether the tab is on screen right now, for the periodic refresh. */
export function createMyReportsTab(isShown: () => boolean): MyReportsTab {
  const root = el("div", "qws-ch-bug-view");
  const refreshButton = button("Refresh", { lockWhilePending: true, onClick: () => refresh(true) });
  const head = el("div", "qws-ch-bug-list-head");
  head.append(el("p", "qws-ch-bug-note", "Reports sent from this browser, with their status and any reply."), refreshButton);
  const errors = notice("error");
  const list = el("div", "qws-ch-bug-list");
  root.append(head, errors.el, list);

  let remote = new Map<number, MyBugReport>();
  let fetched = false;
  /** The last fetch failed: statuses shown are from before, or unknown. */
  let failed = false;
  let stale = true;
  let lastFetch = 0;
  let inFlight: Promise<void> | null = null;
  /** Replies being typed, kept across refreshes. */
  const replyDrafts = new Map<number, string>();

  const offSent = onSentReportsChange(() => {
    stale = true;
  });
  const timer = setInterval(() => {
    if (isShown() && document.visibilityState === "visible") void refresh(false);
  }, AUTO_REFRESH_MS);

  function refresh(force: boolean): Promise<void> {
    if (inFlight) return inFlight;
    const local = readSentReports();
    const typing = list.contains(document.activeElement) && document.activeElement?.tagName === "TEXTAREA";
    if (!force && (typing || (!stale && Date.now() - lastFetch < MIN_REFRESH_MS))) {
      if (!typing) render(local);
      return Promise.resolve();
    }
    render(local);
    // Nothing to ask about: no token kept here, and no key for verified reports.
    if (!local.length && !hasApiKey()) return Promise.resolve();

    inFlight = (async () => {
      const result = await listMyReports(bugReportClient, local);
      lastFetch = Date.now();
      stale = false;
      // `=== false` rather than `!result.ok`: without strictNullChecks, as
      // the hub compiles, only a comparison narrows the result.
      if (result.ok === false) {
        failed = true;
        errors.show(`Could not load the latest status. ${describeBugReportError(result.error)}`);
      } else {
        remote = new Map(result.reports.map((report) => [report.id, report]));
        fetched = true;
        failed = false;
        errors.hide();
      }
      render(readSentReports());
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function render(local: SentReport[]): void {
    const rows: Row[] = local.map((entry) => ({ id: entry.id, local: entry, remote: remote.get(entry.id) ?? null }));
    // Reports verified with the player's key that this browser did not send.
    const extra = [...remote.values()].filter((report) => !local.some((entry) => entry.id === report.id));
    for (const report of extra.sort((a, b) => b.id - a.id)) rows.push({ id: report.id, local: null, remote: report });

    if (!rows.length) {
      list.replaceChildren(emptyState());
      return;
    }
    list.replaceChildren(...rows.map(reportCard));
  }

  function reportCard(row: Row): HTMLElement {
    const { local, remote: report } = row;
    const card = el("div", "qws-ch-bug-section");
    const title = report?.title || local?.title || "Untitled report";
    const headLine = el("div", "qws-ch-bug-report-head");
    headLine.append(el("div", "qws-ch-bug-report-title", title), pill(report?.ref ?? local?.ref ?? `BR-${row.id}`, " ref"));
    // Missing from an answer that came after it was sent: the server no longer has it.
    const gone = !report && fetched && !!local && Date.parse(local.createdAt) <= lastFetch;
    if (report) headLine.append(pill(statusLabel(report.status, report.statusLabel), toneOf(report.status)));
    else headLine.append(pill(gone ? "Not found" : failed ? "Status unavailable" : "Checking..."));
    card.appendChild(headLine);

    const sentAt = formatDate(report?.createdAt || local?.createdAt || "");
    const version = report?.modVersion ? ` with v${report.modVersion}` : "";
    if (sentAt || version) card.appendChild(el("div", "qws-ch-bug-meta", `Sent ${sentAt}${version}`.trim()));

    if (!report) {
      if (gone) card.appendChild(el("p", "qws-ch-bug-hint", "The server does not know this report any more. It may have been removed."));
      return card;
    }

    if (report.fixedInVersion) card.appendChild(fixLine(report.fixedInVersion));
    if (report.status === "needs_info") {
      const ask = el("div", "qws-ch-bug-notice");
      ask.appendChild(el("span", undefined, "The developer needs a little more information. Please answer below."));
      card.appendChild(ask);
    }

    const thread = el("div", "qws-ch-bug-thread");
    const reply = report.publicReply?.trim();
    // A published reply is also added to the comments; show it alone only when it is not there.
    if (reply && !report.comments.some((comment) => comment.author === "admin" && comment.message.trim() === reply)) {
      thread.appendChild(commentBubble("admin", reply, report.publicReplyAt ?? ""));
    }
    for (const comment of report.comments) thread.appendChild(commentBubble(comment.author, comment.message, comment.createdAt));
    if (thread.childElementCount) card.appendChild(thread);

    if (report.canComment && acceptsComments(report.status)) {
      if (local) card.appendChild(replyBox({ id: local.id, followToken: local.followToken }));
      else card.appendChild(el("p", "qws-ch-bug-hint", "Reply from the browser you sent this report from."));
    }
    return card;
  }

  function fixLine(version: string): HTMLElement {
    const local = getLocalVersion();
    if (!isVersionBelow(local, version)) {
      return el("div", "qws-ch-bug-fix", local ? `Fixed in v${version}, which you already have.` : `Fixed in v${version}.`);
    }
    const line = el("div", "qws-ch-bug-fix update");
    line.append(
      el("span", undefined, `Fixed in v${version}. Update to v${version} to get the fix.`),
      button("Update", { onClick: () => openUpdatePage() }),
    );
    return line;
  }

  function commentBubble(author: "admin" | "reporter", message: string, createdAt: string): HTMLElement {
    const bubble = el("div", `qws-ch-bug-comment ${author === "admin" ? "admin" : "reporter"}`);
    const when = formatDate(createdAt);
    bubble.appendChild(el("span", "qws-ch-bug-comment-who", `${author === "admin" ? "Developer" : "You"}${when ? `, ${when}` : ""}`));
    // Text nodes only: neither side's message is ever read as markup.
    bubble.appendChild(document.createTextNode(message));
    return bubble;
  }

  function replyBox(report: FollowedReport): HTMLElement {
    const box = el("div", "qws-ch-bug-reply");
    const area = el("textarea", "qws-ch-bug-input short");
    area.placeholder = "Add a detail or answer a question";
    area.maxLength = BUG_REPORT_LIMITS.commentMessage;
    area.rows = 2;
    area.value = replyDrafts.get(report.id) ?? "";
    area.addEventListener("input", () => replyDrafts.set(report.id, area.value));
    const status = el("span", "qws-ch-bug-progress");
    status.setAttribute("role", "status");
    const sendReply = button("Send reply", {
      variant: "primary",
      lockWhilePending: true,
      onClick: async () => {
        if (!area.value.trim()) {
          status.textContent = "Write something first.";
          return;
        }
        status.textContent = "Sending...";
        const result = await addReportComment(bugReportClient, report, area.value);
        if (result.ok === false) {
          status.textContent = describeBugReportError(result.error);
          return;
        }
        replyDrafts.delete(report.id);
        area.value = "";
        status.textContent = "";
        await refresh(true);
      },
    });
    const actions = el("div", "qws-ch-bug-actions");
    actions.append(status, sendReply);
    box.append(area, actions);
    return box;
  }

  return {
    root,
    show: () => void refresh(false),
    destroy() {
      clearInterval(timer);
      offSent();
    },
  };
}

function emptyState(): HTMLElement {
  const box = el("div", "qws-ch-bug-empty");
  box.append(
    el("div", "qws-ch-bug-empty-title", "No reports yet"),
    el(
      "div",
      undefined,
      "Reports you send from the New report tab show up here. Each one is read: you will see its status change as it is looked at, any question or reply from the developer, and the version that fixes it.",
    ),
  );
  return box;
}
