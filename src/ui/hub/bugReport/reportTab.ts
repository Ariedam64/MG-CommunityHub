// src/ui/hub/bugReport/reportTab.ts
// The New report tab: the form, its screenshots and attached data, and what
// happens on Send. A report that cannot be sent is never lost: the draft
// stays with its follow token, so sending again gets the report back if the
// failed try did reach the server, and it can be saved to a file (copied,
// inside Discord) to share by hand.

import {
  describeBugReportError,
  type BugReportAttachment,
  type BugReportError,
  type SubmitProgress,
} from "@/bugReport/core/client";
import { descriptionProblem, prepareBugReport, prepareContext, titleProblem } from "@/bugReport/core/prepare";
import type { BugReportPayload } from "@/bugReport/core/types";
import { collectAutoFields, type AutoFields } from "@/bugReport/context";
import { clearDraft, draftHasText, readDraft, rememberContact, saveDraftSoon, type Draft } from "@/bugReport/draft";
import { BUG_REPORT_PROJECT } from "@/bugReport/project";
import { sendBugReport } from "@/bugReport/send";
import { isDiscordActivityContext } from "@/platform/discordCsp";
import { MOD_UPDATE_EVENT, getUpdateState, openUpdatePage } from "@/platform/modUpdate";
import { buildAttachedData, showPreviewDialog } from "./attachedData";
import { button, copyText, downloadTextFile, el, notice } from "./dom";
import { buildReportFields, type FormValues } from "./formFields";
import { buildScreenshotStrip } from "./screenshots";
import { showSentView } from "./sentView";

/** Errors after which the report is worth keeping in a file. */
const SAVE_WORTHY: ReadonlySet<BugReportError["kind"]> = new Set(["offline", "timeout", "server", "rate_limited", "too_large", "bad_response"]);

/** How long Send waits for screenshots still being shrunk. */
const SHOTS_WAIT_MS = 15_000;

export type ReportTabHost = {
  /** The modal card: dialogs open over it, and it hides during a tab capture. */
  card: HTMLElement;
  hideForCapture(hidden: boolean): void;
  showMyReports(): void;
  /** Brings the top of the tab back into view. */
  scrollTop(): void;
};

export type ReportTab = {
  root: HTMLElement;
  handlePaste(event: ClipboardEvent): void;
  destroy(): void;
};

function toPayload(values: FormValues, auto: AutoFields, attachments: number): BugReportPayload {
  return {
    ...auto,
    contact: values.contact || null,
    category: values.category,
    title: values.title,
    description: values.description,
    steps: values.steps || null,
    expected: values.expected || null,
    actual: values.actual || null,
    frequency: values.frequency,
    withoutMod: values.withoutMod,
    feature: values.feature || null,
    attachmentsExpected: attachments,
  };
}

const toDraft = (values: FormValues): Draft => ({ ...values });

function progressText(progress: SubmitProgress): string {
  if (progress.stage === "report") return "Sending report...";
  return `Uploading screenshot ${progress.index + 1}/${progress.total}...`;
}

function section(title: string, subtitle: string, ...children: HTMLElement[]): HTMLElement {
  const root = el("div", "qws-ch-bug-section");
  root.append(el("div", "qws-ch-bug-section-title", title), el("div", "qws-ch-bug-section-sub", subtitle), ...children);
  return root;
}

async function waitForShots(pending: () => number, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (pending() > 0 && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export function createReportTab(host: ReportTabHost): ReportTab {
  const root = el("div", "qws-ch-bug-view");
  const form = el("div", "qws-ch-bug-view");
  const sent = el("div", "qws-ch-bug-view");
  sent.hidden = true;
  root.append(form, sent);

  const updateNotice = notice("warn");
  const draftNotice = notice("info");
  const errors = notice("error");
  const fields = buildReportFields();
  const shots = buildScreenshotStrip({ dialogHost: () => host.card, hideForCapture: host.hideForCapture });
  const attached = buildAttachedData(preview);
  const progress = el("span", "qws-ch-bug-progress");
  progress.setAttribute("role", "status");

  const details = section("Your report", "In English or your own language, as you prefer.", fields.root);
  const pictures = section(
    "Screenshots",
    "A picture of the problem helps a lot. Check that nothing private shows before you send it.",
    shots.root,
  );
  shots.acceptDrops(pictures);

  let lastAttempt: { payload: BugReportPayload; attachments: BugReportAttachment[] } | null = null;
  // The Discord activity's frame may not allow downloads: there the report goes to the clipboard.
  const inDiscord = isDiscordActivityContext();
  const saveButton = button(inDiscord ? "Copy report" : "Save report to a file", { lockWhilePending: true, onClick: () => saveReport() });
  saveButton.hidden = true;
  const sendButton = button("Send report", { variant: "primary", big: true, lockWhilePending: true, onClick: () => send() });
  const actions = el("div", "qws-ch-bug-actions");
  actions.append(progress, saveButton, sendButton);

  form.append(updateNotice.el, draftNotice.el, details, pictures, attached.root, errors.el, actions);

  // Newer release out: a gentle nudge, sending stays possible. Read from the
  // hub's own update check, which already runs in the background.
  const showUpdateNotice = () => {
    const state = getUpdateState();
    if (state.status !== "updateAvailable" || !state.latest) {
      updateNotice.hide();
      return;
    }
    updateNotice.show(
      `You have v${state.installed ?? "?"} and v${state.latest} is out. Please update first: the problem may already be fixed.`,
      button("Update", { onClick: () => openUpdatePage() }),
    );
  };
  showUpdateNotice();
  window.addEventListener(MOD_UPDATE_EVENT, showUpdateNotice);

  const draft = readDraft();
  fields.fill(draft);
  if (draftHasText(draft)) {
    const discard = button("Discard", {
      onClick: () => {
        fields.reset(true);
        clearDraft();
        draftNotice.hide();
      },
    });
    draftNotice.show("Your unsent report was restored.", discard);
  }
  fields.onChange(() => {
    saveDraftSoon(toDraft(fields.read()));
    errors.hide();
  });

  function validate(values: FormValues): boolean {
    fields.markInvalid(null);
    if (titleProblem(values.title)) {
      fields.markInvalid("title", "Give it a short title, 3 to 140 characters.");
      fields.focus("title");
      return false;
    }
    if (descriptionProblem(values.description)) {
      fields.markInvalid("description", "Describe what happened in at least 10 characters.");
      fields.focus("description");
      return false;
    }
    return true;
  }

  async function send(): Promise<void> {
    errors.hide();
    saveButton.hidden = true;
    const values = fields.read();
    if (!validate(values)) return;
    try {
      if (shots.pending()) {
        progress.textContent = "Preparing screenshots...";
        await waitForShots(shots.pending, SHOTS_WAIT_MS);
      }
      progress.textContent = "Sending report...";
      const attachments = shots.attachments();
      const payload = toPayload(values, await collectAutoFields(attached.read()), attachments.length);
      lastAttempt = { payload, attachments };
      // Sent with the follow token kept next to the draft: a retry of this
      // report after a lost answer gets the same report back. On success the
      // report joins My reports, and the draft and its token are gone.
      const result = await sendBugReport(payload, attachments, (step) => {
        progress.textContent = progressText(step);
      });
      progress.textContent = "";
      // `=== false` rather than `!result.ok`: without strictNullChecks, as the
      // hub compiles, only a comparison narrows the result.
      if (result.ok === false) {
        errors.show(describeBugReportError(result.error));
        saveButton.hidden = !SAVE_WORTHY.has(result.error.kind);
        return;
      }
      rememberContact(values.contact);
      draftNotice.hide();
      form.hidden = true;
      sent.hidden = false;
      showSentView(sent, result, { onMyReports: host.showMyReports, onNewReport: startOver });
      host.scrollTop();
    } catch (error) {
      progress.textContent = "";
      errors.show(`Something went wrong while sending (${error instanceof Error ? error.message : String(error)}).`);
      saveButton.hidden = false;
    }
  }

  function startOver(): void {
    fields.reset(true);
    attached.reset();
    shots.clear();
    errors.hide();
    saveButton.hidden = true;
    lastAttempt = null;
    sent.hidden = true;
    form.hidden = false;
    host.scrollTop();
  }

  async function preview(): Promise<void> {
    const values = fields.read();
    const attachments = shots.attachments();
    const payload = toPayload(values, await collectAutoFields(attached.read()), attachments.length);
    const prepared = prepareBugReport(payload);
    // Before the title and description are filled in, the rest is still worth seeing.
    const body = prepared.ok === false ? { ...payload, context: prepareContext(payload.context) } : prepared.payload;
    const note = prepared.ok === false ? `The ${prepared.field} is not filled in yet: it is checked when you send.` : null;
    showPreviewDialog(host.card, body, shots.summary(), note);
  }

  async function saveReport(): Promise<void> {
    if (!lastAttempt) return;
    const prepared = prepareBugReport(lastAttempt.payload);
    const report = prepared.ok === true ? prepared.payload : lastAttempt.payload;
    if (inDiscord) {
      // The text alone: screenshots as base64 would not paste anywhere useful.
      const copied = await copyText(JSON.stringify(report, null, 2));
      progress.textContent = copied
        ? "Copied. You can paste it on the mod's Discord, or try sending again later."
        : "The report could not be copied. Please try sending again later.";
      return;
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const file = { report, screenshots: lastAttempt.attachments };
    downloadTextFile(`${BUG_REPORT_PROJECT.id}-bug-report-${stamp}.json`, JSON.stringify(file, null, 2));
    progress.textContent = "Saved. You can share the file on the mod's Discord, or try sending again later.";
  }

  return {
    root,
    handlePaste: (event) => {
      if (!form.hidden) shots.handlePaste(event);
    },
    destroy() {
      window.removeEventListener(MOD_UPDATE_EVENT, showUpdateNotice);
      shots.clear();
    },
  };
}
