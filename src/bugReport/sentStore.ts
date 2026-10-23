// src/bugReport/sentStore.ts
// The reports sent from this browser: newest first, at most 50, each with the
// follow token that reads its status back. Kept by the storage module, in GM
// storage.

import { addSentReport, parseSentReports, type SentReport } from "./core/sentReports";
import { readSentBugReports, writeSentBugReports } from "@/storage/storage";

const listeners = new Set<() => void>();

export function readSentReports(): SentReport[] {
  return parseSentReports(readSentBugReports());
}

export function rememberSentReport(entry: SentReport): void {
  writeSentBugReports(addSentReport(readSentReports(), entry));
  for (const cb of listeners) {
    try {
      cb();
    } catch {}
  }
}

/** Fires after a report is added, so My reports can fetch its status. Returns the undo. */
export function onSentReportsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
