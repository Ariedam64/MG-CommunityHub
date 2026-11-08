// scripts/checkPlayersCount.ts
//
// The room counter the hub reports in POST /collect-state. Game build 1973
// no longer has numPlayersAtom. Store.select gives undefined for a missing
// atom without throwing, and clampPlayers(undefined) gave 1, so every room
// showed 1/6 in the Rooms tab whatever its occupants. This suite builds the
// payload against a stub jotai store and pins that:
//   - a room with 5 players reports playersCount 5 when numPlayersAtom is gone;
//   - a room with 3 players reports 3 when numPlayersAtom is gone;
//   - a room with 5 players and numPlayersAtom at 5 still reports 5.
//
// The store is handed over through the cross-mod bridge, the way Arie's Mod
// shares it, so no fiber scan or write-once capture runs.
//
// Run with: npm run check:playerscount

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

// ── A browser tab, as far as the payload builder looks at it ───────────────

const local = new Map<string, string>();
const g = globalThis as any;
g.window = g;
g.location = { hostname: "magicgarden.gg", origin: "https://magicgarden.gg", search: "" };
g.localStorage = {
  getItem: (key: string) => local.get(key) ?? null,
  setItem: (key: string, value: string) => void local.set(key, value),
  removeItem: (key: string) => void local.delete(key),
};
g.GM_getValue = (_key: string, fallback: unknown) => fallback;
g.GM_setValue = () => {};
g.addEventListener = () => {};
g.removeEventListener = () => {};
g.dispatchEvent = () => true;
g.fetch = () => Promise.reject(new Error("no network in this check"));

// ── The game's atoms and store ──────────────────────────────────────────────

type FakeAtom = { debugLabel: string; value: unknown };

const atomCache = new Map<string, FakeAtom>();
g.jotaiAtomCache = { cache: atomCache };

function setAtom(label: string, value: unknown): void {
  atomCache.set(label, { debugLabel: label, value });
}

function dropAtom(label: string): void {
  atomCache.delete(label);
}

const fakeStore = {
  get: (atom: FakeAtom) => atom.value,
  set: (atom: FakeAtom, value: unknown) => {
    atom.value = value;
  },
  sub: () => () => {},
};
g.__MG_STORE_BRIDGE__ = { version: 1, owner: "check", promise: Promise.resolve(fakeStore) };

const ACCOUNTS = [
  "128202956574162945",
  "228202956574162945",
  "328202956574162945",
  "428202956574162945",
  "528202956574162945",
];
const ME = ACCOUNTS[0];

/** A stateAtom value with `count` players, in a 6 slot room. */
function roomState(count: number): unknown {
  const ids = ACCOUNTS.slice(0, count);
  const players = ids.map((id, i) => ({ id, name: `Player${i + 1}`, cosmetic: { avatar: [] } }));
  const userSlots: Array<unknown> = ids.map((id) => ({
    userId: id,
    data: { coinsCount: 100, garden: null, inventory: null },
  }));
  while (userSlots.length < 6) userSlots.push(null);
  return {
    data: { roomId: "PEPPERTON", players },
    child: { data: { userSlots } },
  };
}

async function main(): Promise<void> {
  const { buildPlayerStatePayload } = await import("../src/api/endpoints/state");

  setAtom("playerAtom", { id: ME, name: "Player1" });

  // ── Game 1973: numPlayersAtom is gone ────────────────────────────────────
  dropAtom("numPlayersAtom");

  setAtom("stateAtom", roomState(5));
  const five = await buildPlayerStatePayload();
  check("a payload is built for a room of 5", five !== null, true);
  check("the 5 occupants are listed", five?.room.userSlots.length, 5);
  check("a room of 5 without numPlayersAtom reports playersCount 5", five?.room.playersCount, 5);

  setAtom("stateAtom", roomState(3));
  const three = await buildPlayerStatePayload();
  check("a room of 3 without numPlayersAtom reports playersCount 3", three?.room.playersCount, 3);

  // ── Older game: numPlayersAtom still there ───────────────────────────────
  setAtom("numPlayersAtom", 5);
  setAtom("stateAtom", roomState(5));
  const withAtom = await buildPlayerStatePayload();
  check("a room of 5 with numPlayersAtom at 5 reports playersCount 5", withAtom?.room.playersCount, 5);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall players count checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
