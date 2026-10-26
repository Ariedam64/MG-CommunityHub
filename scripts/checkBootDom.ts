// scripts/checkBootDom.ts
//
// The hub starts at document-start, when the page may have a <head> but no
// <body> yet. The hub mounted behind a head guard threw on
// document.body.appendChild and never showed its button for the session.
//
// Run with: npm run check:bootdom

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let failures = 0;

function check(label: string, isOk: boolean, detail = ""): void {
  if (isOk) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${label}${detail ? `\n  ${detail}` : ""}`);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
  });
}

for (const file of walk("src")) {
  const rel = file.replace(/\\/g, "/");
  const headGuards = readFileSync(file, "utf8").match(/if \(document\.head\)/g) ?? [];
  check(`${rel} does not wait for the head to use the body`, headGuards.length === 0, `${headGuards.length} "if (document.head)"`);
}

const main = readFileSync(join("src", "main.ts"), "utf8");
check("main boots the hub once the body exists", /if \(document\.body\) \{\s*void bootHub\(\);/.test(main));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
