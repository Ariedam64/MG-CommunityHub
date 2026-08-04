// scripts/checkModUpdate.ts
//
// Verifies the two pure parts of the update check: version comparison and
// userscript header parsing. The network paths are exercised in the browser.
//
// Run with: npm run check:update

import { compareVersions, isNewerVersion } from "../src/platform/modUpdate";
import { extractUserscriptMetadata } from "../src/platform/version";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
}

/** Normalise to -1 / 0 / 1 so the sign is what gets asserted, not the gap. */
function cmp(a: string, b: string): number {
  const result = compareVersions(a, b);
  return result < 0 ? -1 : result > 0 ? 1 : 0;
}

console.log("compareVersions");
check("equal", cmp("0.3.0", "0.3.0"), 0);
check("patch older", cmp("0.3.0", "0.3.1"), -1);
check("patch newer", cmp("0.3.1", "0.3.0"), 1);
check("minor newer", cmp("0.4.0", "0.3.9"), 1);
check("major newer", cmp("1.0.0", "0.99.99"), 1);
// The reason a string compare will not do.
check("0.10 beats 0.9", cmp("0.10.0", "0.9.0"), 1);
check("0.3 beats 0.21 is false", cmp("0.3.0", "0.21.0"), -1);
// Ragged lengths: missing parts count as zero.
check("short equals padded", cmp("1.2", "1.2.0"), 0);
check("short older than patch", cmp("1.2", "1.2.1"), -1);
check("long newer", cmp("1.2.0.1", "1.2.0"), 1);
// Garbage must not throw or produce NaN ordering.
check("suffix ignored", cmp("1.2.0-beta", "1.2.0"), 0);
check("empty equals empty", cmp("", ""), 0);
check("empty older", cmp("", "0.0.1"), -1);
check("nonsense equals zero", cmp("abc", "0"), 0);

console.log("isNewerVersion");
check("update available", isNewerVersion("0.3.0", "0.4.0"), true);
check("same version", isNewerVersion("0.3.0", "0.3.0"), false);
check("remote older", isNewerVersion("0.4.0", "0.3.0"), false);
check("missing installed", isNewerVersion(null, "0.4.0"), false);
check("missing latest", isNewerVersion("0.3.0", null), false);

console.log("extractUserscriptMetadata");

const HEADER = [
  "// ==UserScript==",
  "// @name         MG Community Hub",
  "// @version      0.3.0",
  "// @connect      raw.githubusercontent.com",
  "// @connect      github.com",
  "// @downloadURL  https://example.test/mg-community-hub.user.js",
  "// ==/UserScript==",
  "(function(){/* truncated body */",
].join("\n");

const meta = extractUserscriptMetadata(HEADER);
check("header found", meta !== null, true);
check("version", meta?.get("version")?.[0], "0.3.0");
// Keys are lowercased, so @downloadURL reads back as "downloadurl".
check("downloadurl", meta?.get("downloadurl")?.[0], "https://example.test/mg-community-hub.user.js");
// Repeated keys accumulate rather than overwrite.
check("repeated connect count", meta?.get("connect")?.length, 2);
check("missing key", meta?.get("updateurl"), undefined);

// A truncated Range response that cut off mid-header must not half-parse.
const TRUNCATED = "// ==UserScript==\n// @name MG Community Hub\n// @version 0.3.0";
check("truncated header rejected", extractUserscriptMetadata(TRUNCATED), null);
check("empty body rejected", extractUserscriptMetadata(""), null);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
