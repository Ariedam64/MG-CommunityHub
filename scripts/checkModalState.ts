// scripts/checkModalState.ts
//
// Since v1342 `activeModalStateAtom` holds `{ modal, openId }` instead of the
// modal name. Every shortcut that opens a game panel (shops, pet hutch, decor
// shed, seed silo, feeding trough, journal, weather station) wrote a bare name
// into it and stopped working, and every read compared an object to a name.
//
// Run with: npm run check:modalstate

import { modalNameOf, nextModalState } from "../src/game/modalState";
import { activityLogOpenTarget, activityLogTabOf } from "../src/game/activityLogTab";

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

// v1342 shape
check("opening a shop bumps openId", nextModalState({ modal: null, openId: 4 }, "seedShop"), { modal: "seedShop", openId: 5 });
check("switching modal bumps openId", nextModalState({ modal: "inventory", openId: 5 }, "petHutch"), { modal: "petHutch", openId: 6 });
check("closing keeps the object shape", nextModalState({ modal: "journal", openId: 9 }, null), { modal: null, openId: 10 });
check("opening the modal already open writes nothing", nextModalState({ modal: "seedShop", openId: 5 }, "seedShop"), undefined);
check("the name is read from the object", modalNameOf({ modal: "toolShop", openId: 2 }), "toolShop");
check("no modal open reads as null", modalNameOf({ modal: null, openId: 2 }), null);

// pre-1342 shape, still handled
check("old shape: opening writes the name", nextModalState(null, "seedShop"), "seedShop");
check("old shape: closing writes null", nextModalState("journal", null), null);
check("old shape: the name reads as is", modalNameOf("inventory"), "inventory");

// v1396: Stats is a tab of the activityLog modal, the stats modal is gone.
check("stats opens the activityLog modal on its Stats tab", activityLogOpenTarget("stats"), { modal: "activityLog", tab: "stats" });
check("logs opens the activityLog modal on its Logs tab", activityLogOpenTarget("logs"), { modal: "activityLog", tab: "logs" });
check("the tab defaults to logs", activityLogTabOf(undefined), "logs");
check("the stats tab reads as stats", activityLogTabOf("stats"), "stats");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall modal state checks passed");
