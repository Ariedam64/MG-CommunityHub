// scripts/checkBugReport.ts
//
// The hub's side of the bug report system. The protocol itself lives in
// src/bugReport/core/, copied as it is from Arie's Mod, whose own suite pins
// the redaction, the size limits and the two-step send. This one pins what
// the hub plugs into it:
//   - the core still imports nothing from outside its folder;
//   - the transport keeps the body of a refusal on both paths (GM inside the
//     Discord activity, fetch elsewhere), so a duplicate still names the
//     report already sent; it falls back to GM when fetch cannot connect,
//     never sends again after a timeout, and carries the player's key;
//   - the sent reports live in GM storage, newest first, at most 50;
//   - the draft survives a reload and is gone once cleared;
//   - the console capture installed at boot records the page's errors.
//
// Run with: npm run check:bugreport

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { bugReportClient } from "../src/api/endpoints/bugReports";
import { listMyReports, submitBugReport, type BugReportHttpRequest } from "../src/bugReport/core/client";
import { prepareContext } from "../src/bugReport/core/prepare";
import type { BugReportPayload } from "../src/bugReport/core/types";
import { clearDraft, readDraft, rememberContact, saveDraftSoon } from "../src/bugReport/draft";
import { readSentReports, rememberSentReport } from "../src/bugReport/sentStore";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── A browser, as far as the hub's glue looks at it ─────────────────────────

const local = new Map<string, string>();
const gm = new Map<string, string>();
const listeners = new Map<string, Array<(event: unknown) => void>>();
const g = globalThis as any;
g.window = g;
g.location = { hostname: "magicgarden.gg", origin: "https://magicgarden.gg", search: "" };
g.localStorage = {
  getItem: (key: string) => local.get(key) ?? null,
  setItem: (key: string, value: string) => void local.set(key, value),
  removeItem: (key: string) => void local.delete(key),
};
g.addEventListener = (type: string, cb: (event: unknown) => void) => {
  listeners.set(type, [...(listeners.get(type) ?? []), cb]);
};
g.removeEventListener = () => {};
const installGM = () => {
  g.GM_getValue = (key: string, fallback: string | null) => (gm.has(key) ? gm.get(key) : fallback);
  g.GM_setValue = (key: string, value: string) => void gm.set(key, value);
};
installGM();

const API_KEY = "0123456789abcdef0123456789abcdef";
const TOKEN = "ab".repeat(32);

// Answers queued per transport, and what each transport was asked.
type Reply = { status: number; body?: unknown } | "network" | "hang";
let gmReplies: Reply[] = [];
let fetchReplies: Reply[] = [];
let gmCalls: any[] = [];
let fetchCalls: any[] = [];

const bodyText = (reply: { body?: unknown }) =>
  reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);

g.GM_xmlhttpRequest = (details: any) => {
  gmCalls.push(details);
  const reply = gmReplies.shift() ?? { status: 500 };
  setTimeout(() => {
    if (reply === "network") details.onerror?.({});
    else if (reply === "hang") details.ontimeout?.();
    else details.onload?.({ status: reply.status, responseText: bodyText(reply) });
  }, 0);
  return { abort() {} };
};

g.fetch = (url: string, init: any) => {
  fetchCalls.push({ url, ...init });
  const reply = fetchReplies.shift() ?? { status: 500 };
  if (reply === "network") return Promise.reject(new TypeError("Failed to fetch"));
  if (reply === "hang") {
    return new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  }
  return Promise.resolve({ status: reply.status, text: () => Promise.resolve(bodyText(reply)) });
};

function reset(hostname: string): void {
  g.location.hostname = hostname;
  gmReplies = [];
  fetchReplies = [];
  gmCalls = [];
  fetchCalls = [];
}

function payload(): BugReportPayload {
  return {
    project: "community-hub",
    modName: "Community Hub",
    modVersion: "1.0.8",
    gameVersion: "1727",
    playerId: "123456789012345678",
    playerName: "Romann",
    contact: null,
    category: "bug",
    title: "Friend requests never arrive",
    description: "Since this morning nobody gets my friend requests.",
    steps: null,
    expected: null,
    actual: null,
    frequency: "always",
    withoutMod: "unknown",
    feature: "Friends",
    includeAccountState: true,
    attachmentsExpected: 0,
    context: {},
  };
}

const request = (timeoutMs = 1_000): BugReportHttpRequest => ({
  method: "POST",
  url: "https://ariesmod-api.ariedam.fr/bug-reports",
  headers: { "Content-Type": "application/json" },
  body: "{}",
  timeoutMs,
});

async function main(): Promise<void> {
  // ── The core stays portable ────────────────────────────────────────────────
  const coreDir = join(process.cwd(), "src", "bugReport", "core");
  const coreFiles = readdirSync(coreDir).filter((name) => name.endsWith(".ts")).sort();
  check("the core holds its 12 files", coreFiles.length, 12);
  const outside = coreFiles.flatMap((name) => {
    const source = readFileSync(join(coreDir, name), "utf8");
    const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
    return specifiers.filter((spec) => !spec.startsWith("./")).map((spec) => `${name}: ${spec}`);
  });
  check("the core imports nothing from outside its folder", outside, []);

  // ── Transport: the web goes through fetch ──────────────────────────────────
  gm.set("aries_api_key", API_KEY);
  reset("magicgarden.gg");
  fetchReplies = [{ status: 409, body: { error: "duplicate", id: 42, ref: "BR-42" } }];
  let sent = await submitBugReport(bugReportClient, payload());
  check("web: one fetch, no GM", [fetchCalls.length, gmCalls.length], [1, 0]);
  check("web: the route", fetchCalls[0]?.url, "https://ariesmod-api.ariedam.fr/bug-reports");
  check("web: no cookie goes along", fetchCalls[0]?.credentials, "omit");
  check("web: the player's key goes along", fetchCalls[0]?.headers?.Authorization, `Bearer ${API_KEY}`);
  check("web: a JSON string body", typeof fetchCalls[0]?.body, "string");
  check(
    "web: a duplicate names the report already sent",
    sent.ok === false ? sent.error : null,
    { kind: "duplicate", id: 42, ref: "BR-42" },
  );

  reset("magicgarden.gg");
  fetchReplies = [{ status: 201, body: { id: 7, ref: "BR-7", followToken: TOKEN, status: "new" } }];
  sent = await submitBugReport(bugReportClient, payload());
  check("web: a created report comes back with its token", sent.ok ? sent.report : null, {
    id: 7,
    ref: "BR-7",
    followToken: TOKEN,
    status: "new",
  });

  reset("magicgarden.gg");
  fetchReplies = ["network"];
  gmReplies = [{ status: 429, body: { error: "rate_limited", retryAfter: 1200 } }];
  sent = await submitBugReport(bugReportClient, payload());
  check("web: fetch cannot connect, GM takes over", [fetchCalls.length, gmCalls.length], [1, 1]);
  check("web: the GM answer is read whole", sent.ok === false ? sent.error : null, { kind: "rate_limited", retryAfterSec: 1200 });

  reset("magicgarden.gg");
  fetchReplies = ["hang"];
  const timedOut = await bugReportClient.request(request(30)).then(
    () => "answered",
    (error: Error) => error.message,
  );
  check("web: a fetch past its time rejects as a timeout", /timed out/.test(timedOut), true);
  check("web: and is never sent again through GM", gmCalls.length, 0);

  reset("magicgarden.gg");
  fetchReplies = [
    {
      status: 200,
      body: {
        reports: [
          {
            id: 7,
            ref: "BR-7",
            project: "community-hub",
            title: "Friend requests never arrive",
            status: "needs_info",
            statusLabel: "Need more info",
            comments: [{ author: "admin", message: "Which browser?", createdAt: "2026-10-23T12:00:00Z" }],
            canComment: true,
          },
        ],
      },
    },
  ];
  const mine = await listMyReports(bugReportClient, [{ id: 7, followToken: TOKEN }]);
  check("web: my reports are read back", mine.ok ? mine.reports.map((r) => [r.ref, r.status, r.comments.length]) : null, [
    ["BR-7", "needs_info", 1],
  ]);
  check("web: my reports ask with the follow token", JSON.parse(fetchCalls[0]?.body ?? "{}"), {
    reports: [{ id: 7, followToken: TOKEN }],
  });

  // ── Transport: the Discord activity goes through GM ────────────────────────
  reset("1227719606223765687.discordsays.com");
  gmReplies = [{ status: 409, body: { error: "duplicate", id: 42, ref: "BR-42" } }];
  sent = await submitBugReport(bugReportClient, payload());
  check("discord: GM only, the page CSP blocks fetch", [fetchCalls.length, gmCalls.length], [0, 1]);
  check("discord: the request has a timeout", typeof gmCalls[0]?.timeout, "number");
  check("discord: the player's key goes along", gmCalls[0]?.headers?.Authorization, `Bearer ${API_KEY}`);
  // httpPost drops this body on the GM path, which is why the routes have their own transport.
  check(
    "discord: a duplicate still names the report already sent",
    sent.ok === false ? sent.error : null,
    { kind: "duplicate", id: 42, ref: "BR-42" },
  );

  reset("1227719606223765687.discordsays.com");
  gmReplies = ["hang", "hang"];
  const gmTimeout = await bugReportClient.request(request()).then(
    () => "answered",
    (error: Error) => error.message,
  );
  check("discord: a GM timeout rejects as a timeout", /timed out/.test(gmTimeout), true);

  gm.delete("aries_api_key");
  reset("magicgarden.gg");
  fetchReplies = [{ status: 201, body: { id: 8, ref: "BR-8", followToken: TOKEN, status: "new" } }];
  await submitBugReport(bugReportClient, payload());
  check("signed out: no Authorization header", fetchCalls[0]?.headers?.Authorization, undefined);

  // ── Sent reports: GM storage, newest first, at most 50 ────────────────────
  check("nothing sent yet", readSentReports(), []);
  for (let id = 1; id <= 55; id++) {
    rememberSentReport({ id, ref: `BR-${id}`, followToken: TOKEN, title: `Report ${id}`, createdAt: "2026-10-23T12:00:00.000Z" });
  }
  let list = readSentReports();
  check("at most 50 kept", list.length, 50);
  check("newest first, oldest dropped", [list[0]?.id, list[49]?.id], [55, 6]);
  check("kept in GM storage, as a string", typeof gm.get("mgch_bug_reports_sent"), "string");
  check("not in the page's localStorage", local.has("mgch_bug_reports_sent"), false);
  rememberSentReport({ id: 30, ref: "BR-30", followToken: TOKEN, title: "Report 30 again", createdAt: "2026-10-23T13:00:00.000Z" });
  list = readSentReports();
  check("sent again moves to the top without a copy", [list[0]?.title, list.filter((r) => r.id === 30).length, list.length], [
    "Report 30 again",
    1,
    50,
  ]);
  gm.set("mgch_bug_reports_sent", "{not json");
  check("a broken list reads as empty", readSentReports(), []);
  gm.set("mgch_bug_reports_sent", JSON.stringify([{ id: 3, followToken: "short" }, { id: 4, ref: "BR-4", followToken: TOKEN, title: "ok" }]));
  check("malformed entries are skipped", readSentReports().map((r) => r.id), [4]);
  delete g.GM_getValue;
  delete g.GM_setValue;
  rememberSentReport({ id: 9, ref: "BR-9", followToken: TOKEN, title: "No GM", createdAt: "2026-10-23T12:00:00.000Z" });
  check("without GM storage, the page's storage stands in", readSentReports().map((r) => r.id), [9]);
  installGM();

  // ── Draft ──────────────────────────────────────────────────────────────────
  saveDraftSoon({ category: "visual", title: "Leaderboard overlaps", description: "The leaderboard covers the chat." });
  check("not saved while the player is typing", readDraft().title, undefined);
  await sleep(700);
  check("saved once the player pauses", [readDraft().category, readDraft().title], ["visual", "Leaderboard overlaps"]);
  saveDraftSoon({ category: "crash" });
  await sleep(700);
  check("a draft with no text is not kept", readDraft().category, undefined);
  rememberContact("  romann#0000 ");
  check("the contact is offered on the next report", readDraft().contact, "romann#0000");
  saveDraftSoon({ title: "Typing..." });
  clearDraft();
  await sleep(700);
  check("cleared before it was saved stays cleared", readDraft().title, undefined);

  // ── Console capture installed at boot ──────────────────────────────────────
  // The page window is read when the module loads, so it comes after the stubs.
  const { diagnostics, installDiagnostics, recordBreadcrumb } = await import("../src/platform/diagnostics");
  const pageConsole = { error: (..._args: unknown[]) => {}, warn: (..._args: unknown[]) => {} };
  const realConsole = g.console;
  g.console = pageConsole;
  try {
    installDiagnostics();
    installDiagnostics();
    pageConsole.error("[CommunityHub] renderCommunityHub failed:", new TypeError("x is undefined"));
    pageConsole.warn("headers", { Authorization: `Bearer ${API_KEY}` });
  } finally {
    g.console = realConsole;
  }
  for (const cb of listeners.get("unhandledrejection") ?? []) cb({ reason: new Error("stream closed") });
  recordBreadcrumb("opened hub tab messages");
  const logs = diagnostics.logs();
  check("installed once, each line recorded once", logs.length, 3);
  check("an error is recorded with its message", logs[0]?.msg.startsWith("[CommunityHub] renderCommunityHub failed: TypeError: x is undefined"), true);
  check("a rejected promise is recorded", logs[2]?.msg.startsWith("Unhandled rejection: Error: stream closed"), true);
  check("breadcrumbs are kept", diagnostics.breadcrumbs().map((c) => c.msg), ["opened hub tab messages"]);
  const prepared = JSON.stringify(prepareContext({ logs }));
  check("a key logged by mistake never leaves", prepared.includes(API_KEY), false);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall bug report checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
