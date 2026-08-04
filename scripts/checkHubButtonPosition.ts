// scripts/checkHubButtonPosition.ts
//
// Verifies where the floating hub button lands, which is the part that had a
// bug worth a regression test: a viewport that is briefly narrow at startup
// used to drag a right-edge button permanently towards the middle.
//
// Run with: npm run check:hubpos

import { resolveDisplayPosition } from "../src/ui/communityHubButtonFloating";

const BUTTON_SIZE = 44;
const SCREEN_MARGIN = 8;

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
}

const WIDE = { w: 1920, h: 1080 };
// What the game's iframe often reports before it has been sized.
const NARROW = { w: 800, h: 600 };

console.log("default position (player never dragged it)");
{
  const wide = resolveDisplayPosition(null, WIDE.w, WIDE.h);
  check("hugs the right edge", wide.left, WIDE.w - BUTTON_SIZE - 16);
  check("sits half way down", wide.top, WIDE.h * 0.5);

  // The default has to follow the viewport, not stay where a narrow startup
  // put it.
  const narrow = resolveDisplayPosition(null, NARROW.w, NARROW.h);
  check("follows a narrow viewport", narrow.left, NARROW.w - BUTTON_SIZE - 16);
  const backToWide = resolveDisplayPosition(null, WIDE.w, WIDE.h);
  check("returns to the right edge", backToWide.left, WIDE.w - BUTTON_SIZE - 16);
}

console.log("saved position survives a narrow viewport (the regression)");
{
  // Player parked it at the right edge of a 1920 screen.
  const desired = { left: 1860, top: 300 };

  // Startup in a not-yet-sized iframe: it has to be bounded to stay visible.
  const duringStartup = resolveDisplayPosition(desired, NARROW.w, NARROW.h);
  check("bounded while narrow", duringStartup.left, NARROW.w - BUTTON_SIZE - SCREEN_MARGIN);
  check("top untouched", duringStartup.top, 300);

  // The bug: the bounded value used to be read back as the new desired
  // position, so widening the viewport left the button at 748, mid-screen.
  // Resolving from `desired` every time is what fixes it.
  const afterResize = resolveDisplayPosition(desired, WIDE.w, WIDE.h);
  check("restored after the viewport grows", afterResize.left, 1860);
  check("not stranded mid-screen", afterResize.left === NARROW.w - BUTTON_SIZE - SCREEN_MARGIN, false);

  // Feeding the bounded value back in is what the old code effectively did.
  const regression = resolveDisplayPosition(duringStartup, WIDE.w, WIDE.h);
  check("bounding is not idempotent-safe", regression.left, 748);
}

console.log("bounds");
{
  const offLeft = resolveDisplayPosition({ left: -500, top: -500 }, WIDE.w, WIDE.h);
  check("clamped to the left margin", offLeft.left, SCREEN_MARGIN);
  check("clamped to the top margin", offLeft.top, SCREEN_MARGIN);

  const offRight = resolveDisplayPosition({ left: 99999, top: 99999 }, WIDE.w, WIDE.h);
  check("clamped to the right margin", offRight.left, WIDE.w - BUTTON_SIZE - SCREEN_MARGIN);
  check("clamped to the bottom margin", offRight.top, WIDE.h - BUTTON_SIZE - SCREEN_MARGIN);
}

console.log("degenerate viewport");
{
  // innerWidth/innerHeight can be 0 before layout. Must not produce NaN or a
  // negative offset that parks the button off screen for good.
  const zero = resolveDisplayPosition({ left: 1860, top: 300 }, 0, 0);
  check("left stays finite", Number.isFinite(zero.left), true);
  check("top stays finite", Number.isFinite(zero.top), true);
  check("falls back to the margin", zero.left, SCREEN_MARGIN);
  check("top falls back to the margin", zero.top, SCREEN_MARGIN);

  // And the saved position must still be recoverable afterwards.
  const recovered = resolveDisplayPosition({ left: 1860, top: 300 }, WIDE.w, WIDE.h);
  check("recovers once laid out", recovered.left, 1860);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
