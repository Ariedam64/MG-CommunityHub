// scripts/checkRoomPrivacy.ts
//
// The public room lists once the backend hides players who ask for it. With
// hideNameInRoomLists on, GET /rooms names such a player "Anonymous" with no
// avatar, and the public answer drops player_id and coins, and may drop
// last_updated_by_player_id too. This suite pins what the hub makes of it:
//   - a room read through fetchAvailableRooms keeps lastUpdatedByPlayerId a
//     null, never undefined, when the backend leaves the field out;
//   - an anonymous occupant comes out as { name: "Anonymous", avatarUrl: null };
//   - nothing named playerId or coins is carried over;
//   - players_count null reads as 0, and a filled avatar_url is kept.
//
// The transport is a stub of fetch, outside the Discord activity, so the
// request goes through the same path as in a browser tab.
//
// Run with: npm run check:roomprivacy

import type { Room } from "../src/api/types";

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

// ── A browser tab, as far as the HTTP client looks at it ───────────────────

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

let roomsReply: unknown = [];
const fetchCalls: string[] = [];
g.fetch = (url: string) => {
  fetchCalls.push(String(url));
  const text = JSON.stringify(roomsReply);
  return Promise.resolve({ status: 200, text: () => Promise.resolve(text) });
};

async function main(): Promise<void> {
  const { fetchAvailableRooms } = await import("../src/api/endpoints/rooms");

  // ── The public answer once the backend hides a player ─────────────────────
  // No player_id, no coins, no last_updated_by_player_id: only what the
  // backend still sends to anyone.
  roomsReply = [
    {
      id: "room-anon",
      is_private: false,
      players_count: 2,
      last_updated_at: "2026-11-02T10:00:00.000Z",
      user_slots: [
        { name: "Anonymous", avatar_url: null },
        { name: "Romann", avatar_url: "https://cdn.discordapp.com/avatars/1/a.png" },
      ],
    },
    {
      id: "room-null-count",
      is_private: false,
      players_count: null,
      last_updated_at: "2026-11-02T10:05:00.000Z",
      last_updated_by_player_id: null,
    },
  ];
  const rooms: Room[] = await fetchAvailableRooms(10);
  check("one GET /rooms went out", fetchCalls.length, 1);
  check("to the rooms route", /\/rooms\?limit=10$/.test(fetchCalls[0] ?? ""), true);
  check("both rooms come back", rooms.map((r) => r.id), ["room-anon", "room-null-count"]);

  const anon = rooms[0] as (Room & Record<string, unknown>) | undefined;
  check(
    "a room without last_updated_by_player_id has lastUpdatedByPlayerId null, not undefined",
    anon ? ["lastUpdatedByPlayerId" in anon, anon.lastUpdatedByPlayerId === null] : null,
    [true, true],
  );
  const anonSlot = anon?.userSlots?.[0];
  check("the anonymous occupant reads as Anonymous with no avatar", anonSlot, { name: "Anonymous", avatarUrl: null });
  check(
    "the anonymous occupant has avatarUrl null, not undefined",
    anonSlot ? ["avatarUrl" in anonSlot, anonSlot.avatarUrl === null] : null,
    [true, true],
  );
  check("a filled avatar_url is kept", anon?.userSlots?.[1]?.avatarUrl, "https://cdn.discordapp.com/avatars/1/a.png");
  check("playersCount is taken as sent", anon?.playersCount, 2);
  check("the room has no playerId key", anon ? "playerId" in anon : null, false);
  check("the room has no coins key", anon ? "coins" in anon : null, false);
  check(
    "no slot has a playerId or coins key",
    (anon?.userSlots ?? []).some((slot) => "playerId" in slot || "coins" in slot),
    false,
  );

  const nullCount = rooms[1];
  check("players_count null reads as 0", nullCount?.playersCount, 0);
  check("an explicit null last_updated_by_player_id stays null", nullCount?.lastUpdatedByPlayerId, null);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall room privacy checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
