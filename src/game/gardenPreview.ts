// src/game/gardenPreview.ts
// Friend garden preview — minimal extract of Arie's Mod EditorService.
//
// Shows another player's garden in place of yours: swaps your slot's garden
// in the jotai state (backing up the original) and syncs the tiles visually
// through the tile object system (tos). clearFriendGardenPreview restores
// the backup.
//
// When Arie's Mod runs alongside, callers should prefer its
// window.qwsEditorPreviewFriendGarden / qwsEditorClearFriendGardenPreview
// globals (its editor coordinates with its own state freeze); this module is
// the standalone fallback.

import { Atoms } from "@/store/atoms";
import type { GardenState } from "@/store/atoms";
import { readSlotId, resolveMyAccountId } from "@/api/identity";
import { tos } from "./tileObjectSystem";

const EMPTY_GARDEN: GardenState = { tileObjects: {}, boardwalkTileObjects: {} };

type SlotMatch = {
  isArray: boolean;
  matchSlot: any;
  matchIndex: number;
  entries: Array<[string, any]> | null;
  slotsArray: any[] | null;
};

let friendGardenPreviewActive = false;
let friendGardenBackup: { garden: GardenState; userSlotIdx: number } | null = null;

function makeEmptyGarden(): GardenState {
  return { ...EMPTY_GARDEN };
}

function sanitizeGarden(val: any): GardenState {
  const tileObjects = val && typeof val === "object" && typeof val.tileObjects === "object" ? val.tileObjects : {};
  const boardwalkTileObjects =
    val && typeof val === "object" && typeof val.boardwalkTileObjects === "object"
      ? val.boardwalkTileObjects
      : {};
  return {
    tileObjects: { ...tileObjects },
    boardwalkTileObjects: { ...boardwalkTileObjects },
  };
}

function compareSlotKeys(a: string, b: string): number {
  const ai = Number(a);
  const bi = Number(b);
  if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
  return a.localeCompare(b);
}

function findPlayerSlot(
  slots: any,
  playerId: string,
  opts: { sortObject?: boolean } = {},
): SlotMatch | null {
  if (!slots || typeof slots !== "object") return null;

  // readSlotId plutôt que `slot.playerId || slot.id` : les slots sont clés par
  // `userId` depuis le renommage, et l'ancienne lecture ne trouvait plus rien.
  const isMatch = (slot: any) => readSlotId(slot) === String(playerId);

  if (Array.isArray(slots)) {
    const arr = slots as any[];
    for (let i = 0; i < arr.length; i++) {
      if (isMatch(arr[i])) {
        return { isArray: true, matchSlot: arr[i], matchIndex: i, entries: null, slotsArray: arr };
      }
    }
    return null;
  }

  const entries = Object.entries(slots as Record<string, any>);
  if (opts.sortObject) entries.sort(([a], [b]) => compareSlotKeys(a, b));

  for (let i = 0; i < entries.length; i++) {
    const [, s] = entries[i];
    if (isMatch(s)) {
      return { isArray: false, matchSlot: s, matchIndex: i, entries, slotsArray: null };
    }
  }

  return null;
}

function slotMatchToIndex(meta: SlotMatch): number {
  if (meta.isArray) return meta.matchIndex;
  const entry = meta.entries?.[meta.matchIndex];
  const k = entry ? entry[0] : null;
  const n = Number(k);
  return Number.isFinite(n) ? n : 0;
}

function rebuildUserSlots(meta: SlotMatch, buildSlot: (slot: any) => any): any {
  if (meta.isArray) {
    const nextSlots = (meta.slotsArray || []).slice();
    nextSlots[meta.matchIndex] = buildSlot(meta.matchSlot);
    return nextSlots;
  }

  const nextEntries = (meta.entries || []).map(([k, s], idx) =>
    idx === meta.matchIndex ? [k, buildSlot(s)] : [k, s],
  );
  return Object.fromEntries(nextEntries);
}

function buildStateWithUserSlots(cur: any, userSlots: any) {
  return {
    ...(cur || {}),
    child: {
      ...(cur?.child || {}),
      data: {
        ...(cur?.child?.data || {}),
        userSlots,
      },
    },
  };
}

/**
 * Notre id de compte, celui qui clé les userSlots. On passe par
 * resolveMyAccountId au lieu de lire `playerAtom.id` en direct : le champ a déjà
 * changé de sens une fois, et un id de room ne matcherait aucun slot.
 */
async function getPlayerId(): Promise<string | null> {
  try {
    const me = await Atoms.player.player.get();
    const state = (await Atoms.root.state.get().catch(() => null)) as any;
    const players = Array.isArray(state?.data?.players) ? state.data.players : [];
    return resolveMyAccountId(me, players);
  } catch {
    return null;
  }
}

function injectTileObjectRaw(tx: number, ty: number, obj: any): boolean {
  try {
    const info = tos.getTileObject(tx, ty, { ensureView: true });
    const tv = (info as any)?.tileView;
    if (!tv || typeof tv.onDataChanged !== "function") return false;
    const cloned = (() => { try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; } })();
    tv.onDataChanged(cloned);

    const status = tos.getStatus();
    const ctx = (status.engine as any)?.reusableContext;
    if (ctx && typeof tv.update === "function") {
      try { tv.update(ctx); } catch {}
    }
    return true;
  } catch {
    return false;
  }
}

async function applyGardenToTos(garden: GardenState, userSlotIdx: number) {
  if (!tos.isReady()) return;
  const mapData = await Atoms.root.map.get().catch(() => null);
  const cols = Number((mapData as any)?.cols);
  if (!mapData || !Number.isFinite(cols)) return;

  const dirtEntries = Object.entries((mapData as any)?.globalTileIdxToDirtTile || {}).filter(
    ([, v]) => (v as any)?.userSlotIdx === userSlotIdx,
  );
  const boardEntries = Object.entries((mapData as any)?.globalTileIdxToBoardwalk || {}).filter(
    ([, v]) => (v as any)?.userSlotIdx === userSlotIdx,
  );

  const applyEntry = (entry: [string, any], type: "Dirt" | "Boardwalk") => {
    const [gidxStr, v] = entry;
    const gidx = Number(gidxStr);
    if (!Number.isFinite(gidx)) return;
    const x = gidx % cols;
    const y = Math.floor(gidx / cols);
    const localIdx =
      type === "Dirt"
        ? Number((v as any)?.dirtTileIdx ?? -1)
        : Number((v as any)?.boardwalkTileIdx ?? -1);
    const obj =
      type === "Dirt"
        ? (garden.tileObjects || {})[String(localIdx)]
        : (garden.boardwalkTileObjects || {})[String(localIdx)];

    if (!obj) {
      tos.setTileEmpty(x, y, { ensureView: true, forceUpdate: true });
      return;
    }

    injectTileObjectRaw(x, y, obj);

    const typ = obj.objectType;
    if (typ === "plant") {
      tos.setTilePlant(x, y, {
        species: obj.species,
        plantedAt: obj.plantedAt,
        maturedAt: obj.maturedAt,
        slots: obj.slots,
      }, { ensureView: true, forceUpdate: true });
    } else if (typ === "decor") {
      tos.setTileDecor(x, y, { rotation: obj.rotation }, { ensureView: true, forceUpdate: true });
    } else if (typ === "egg") {
      tos.setTileEgg(x, y, { plantedAt: obj.plantedAt, maturedAt: obj.maturedAt }, { ensureView: true, forceUpdate: true });
    } else {
      tos.setTileEmpty(x, y, { ensureView: true, forceUpdate: true });
    }
  };

  dirtEntries.forEach((e) => applyEntry(e as any, "Dirt"));
  boardEntries.forEach((e) => applyEntry(e as any, "Boardwalk"));
}

async function setStateAtom(next: any) {
  await Atoms.root.state.set(next);
}

export async function applyFriendGardenPreview(garden: GardenState | null): Promise<boolean> {
  if (!garden || typeof garden !== "object") return false;
  try {
    const pid = await getPlayerId();
    if (!pid) return false;
    const cur = await Atoms.root.state.get().catch(() => null) as any;
    if (!cur) return false;
    const slots = cur?.child?.data?.userSlots;
    const slotMatch = findPlayerSlot(slots, pid, { sortObject: true });
    if (!slotMatch || !slotMatch.matchSlot) return false;
    const userSlotIdx = slotMatchToIndex(slotMatch);

    const prevGarden = slotMatch.matchSlot?.data?.garden
      ? sanitizeGarden(slotMatch.matchSlot.data.garden)
      : makeEmptyGarden();
    friendGardenBackup = { garden: prevGarden, userSlotIdx };

    const updatedSlot = {
      ...(slotMatch.matchSlot as any),
      data: {
        ...(slotMatch.matchSlot?.data || {}),
        garden: sanitizeGarden(garden),
      },
    };

    const nextUserSlots = rebuildUserSlots(slotMatch, () => updatedSlot);
    const nextState = buildStateWithUserSlots(cur, nextUserSlots);

    await setStateAtom(nextState);
    try { await applyGardenToTos(garden, userSlotIdx); } catch {}
    friendGardenPreviewActive = true;
    return true;
  } catch (error) {
    console.error("[GardenPreview] applyFriendGardenPreview failed", error);
    friendGardenPreviewActive = false;
    return false;
  }
}

export async function clearFriendGardenPreview(): Promise<boolean> {
  if (!friendGardenPreviewActive) return false;
  friendGardenPreviewActive = false;
  try {
    const backup = friendGardenBackup;
    friendGardenBackup = null;
    if (backup) {
      const pid = await getPlayerId();
      if (pid) {
        const cur = await Atoms.root.state.get().catch(() => null) as any;
        const slots = cur?.child?.data?.userSlots;
        const slotMatch = findPlayerSlot(slots, pid, { sortObject: true });
        if (slotMatch && slotMatch.matchSlot) {
          const updatedSlot = {
            ...(slotMatch.matchSlot as any),
            data: {
              ...(slotMatch.matchSlot?.data || {}),
              garden: sanitizeGarden(backup.garden),
            },
          };
          const nextUserSlots = rebuildUserSlots(slotMatch, () => updatedSlot);
          const nextState = buildStateWithUserSlots(cur, nextUserSlots);
          await setStateAtom(nextState);
          try { await applyGardenToTos(backup.garden, backup.userSlotIdx); } catch {}
        }
      }
    }
    return true;
  } catch (error) {
    console.error("[GardenPreview] clearFriendGardenPreview failed", error);
    return false;
  }
}
