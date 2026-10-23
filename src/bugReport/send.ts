// src/bugReport/send.ts
// Sending a report from the New report tab, with the bookkeeping around it.
// Every try of the same report carries the follow token kept next to the
// draft, so a retry after a lost answer gets back the report the first try
// created, with only the screenshots the server lacks still to go. The draft
// is saved with the token, before anything goes out. Once a try goes through,
// the report joins the sent list, and the draft and its token are forgotten:
// the next report gets a token of its own.

import { bugReportClient } from "@/api/endpoints/bugReports";
import { submitBugReport, type BugReportAttachment, type SubmitProgress, type SubmitResult } from "./core/client";
import { sentReportFrom } from "./core/sentReports";
import type { BugReportPayload } from "./core/types";
import { clearDraft, pendingReport, type Draft } from "./draft";
import { rememberSentReport } from "./sentStore";

/** `draft` is the form's text that `payload` was made from. */
export async function sendBugReport(
  payload: BugReportPayload,
  draft: Draft,
  attachments: readonly BugReportAttachment[],
  onProgress?: (progress: SubmitProgress) => void,
): Promise<SubmitResult> {
  const result = await submitBugReport(bugReportClient, payload, attachments, onProgress, pendingReport(draft));
  if (result.ok === true) {
    rememberSentReport(sentReportFrom(result.report, payload.title.trim()));
    clearDraft();
  }
  return result;
}
