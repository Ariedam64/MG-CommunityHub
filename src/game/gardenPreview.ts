// src/game/gardenPreview.ts
// Friend garden preview.
//
// L'aperçu est en lecture seule : on détourne ce que le jeu lit et peint, on
// n'écrit jamais dans le state jotai.
//
// L'implémentation précédente écrivait le jardin de l'ami dans notre userSlot
// puis peignait les tuiles. Mesuré en jeu, le serveur repousse l'état complet
// toutes les ~730 ms et le jeu repeint depuis cet état : l'aperçu ne tenait
// qu'une seconde. Le réécrire à chaque push ne faisait que déplacer le problème
// en clignotement, les deux camps se disputant la même donnée.
//
// On tient donc la couche qui peint réellement. Pour chaque tuile de notre
// parcelle, `tileView.onDataChanged` est remplacé par une version qui ignore ce
// que le jeu lui passe et réimpose l'objet de l'ami. Le jeu peut resynchroniser
// autant qu'il veut, l'image ne bouge plus.
//
// Ne pas écrire dans le state a un second bénéfice : la donnée de l'ami ne peut
// pas se retrouver uploadée sous notre compte, et la restauration se contente de
// relire la vérité serveur, toujours à jour.

import { Atoms } from "@/store/atoms";
import type { GardenState } from "@/store/atoms";
import { readSlotId, resolveMyAccountId } from "@/api/identity";
import { fakeShow, fakeHide, type FakeConfig } from "./fakeAtoms";
import { tos } from "./tileObjectSystem";

/**
 * Le panneau d'infos de la tuile courante lit `myOwnCurrentGardenObjectAtom`,
 * lui-même dérivé de `myDataAtom.garden` (vérifié en jeu : retirer une tuile de
 * myData la fait disparaître de l'autre atom). Patcher la lecture de myData
 * suffit donc à ce que le panneau décrive le jardin de l'ami.
 *
 * Pas de gate ici : myData se recalcule à chaque push serveur, ce qui réinjecte
 * notre valeur tout seul.
 *
 * L'entrée du registre de fakeAtoms est partagée avec les modales (même label).
 * Le payload `{ garden }` traverse indifféremment les deux fonctions de merge,
 * et l'UI rend les deux aperçus mutuellement exclusifs : un aperçu de jardin
 * ferme le panneau du hub et impose sa barre Stop.
 */
const MY_DATA_GARDEN_PATCH: FakeConfig<any> = {
  label: Atoms.data.myData.label,
  merge: (real: any, fake: any) => ({ ...(real || {}), ...(fake || {}) }),
};

type SlotMatch = {
  isArray: boolean;
  matchSlot: any;
  matchIndex: number;
  entries: Array<[string, any]> | null;
  slotsArray: any[] | null;
};

/** Une tuile dont on a détourné `onDataChanged`, avec de quoi la rendre. */
type TileHold = {
  tileView: any;
  hadOwnProperty: boolean;
  original: (obj: any) => void;
};

type TileTarget = {
  gidx: number;
  tx: number;
  ty: number;
  /** L'objet à afficher sur cette tuile, ou null si elle doit rester vide. */
  desired: any;
};

let friendGardenPreviewActive = false;
let previewUserSlotIdx: number | null = null;
let previewPlayerId: string | null = null;
const holds = new Map<number, TileHold>();

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

function cloneTileObject(obj: any): any {
  if (!obj) return null;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
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

/** Le slot et l'index de notre parcelle, ou null. */
async function resolveMySlot(): Promise<{ playerId: string; userSlotIdx: number; garden: GardenState } | null> {
  const playerId = await getPlayerId();
  if (!playerId) return null;
  const cur = (await Atoms.root.state.get().catch(() => null)) as any;
  if (!cur) return null;
  const slotMatch = findPlayerSlot(cur?.child?.data?.userSlots, playerId, { sortObject: true });
  if (!slotMatch || !slotMatch.matchSlot) return null;
  return {
    playerId,
    userSlotIdx: slotMatchToIndex(slotMatch),
    garden: sanitizeGarden(slotMatch.matchSlot?.data?.garden),
  };
}

/**
 * Les tuiles de la parcelle `userSlotIdx`, chacune associée à l'objet de
 * `garden` qui doit s'y afficher. Une tuile sans objet vaut null (tuile vide).
 */
async function collectSlotTiles(garden: GardenState, userSlotIdx: number): Promise<TileTarget[]> {
  const mapData = (await Atoms.root.map.get().catch(() => null)) as any;
  const cols = Number(mapData?.cols);
  if (!mapData || !Number.isFinite(cols) || cols <= 0) return [];

  const out: TileTarget[] = [];

  const collect = (record: any, localIdxKey: string, source: Record<string, any>) => {
    for (const [gidxStr, meta] of Object.entries(record || {})) {
      if ((meta as any)?.userSlotIdx !== userSlotIdx) continue;
      const gidx = Number(gidxStr);
      if (!Number.isFinite(gidx)) continue;
      const localIdx = Number((meta as any)?.[localIdxKey] ?? -1);
      out.push({
        gidx,
        tx: gidx % cols,
        ty: Math.floor(gidx / cols),
        desired: (source || {})[String(localIdx)] ?? null,
      });
    }
  };

  collect(mapData.globalTileIdxToDirtTile, "dirtTileIdx", garden.tileObjects);
  collect(mapData.globalTileIdxToBoardwalk, "boardwalkTileIdx", garden.boardwalkTileObjects);

  return out;
}

function tileViewAt(target: TileTarget): any | null {
  try {
    return tos.getTileObject(target.tx, target.ty, { ensureView: true })?.tileView ?? null;
  } catch {
    return null;
  }
}

function renderContext(): any {
  try {
    return (tos.getStatus().engine as any)?.reusableContext ?? null;
  } catch {
    return null;
  }
}

function pushToView(tileView: any, obj: any, ctx: any): void {
  try {
    tileView.onDataChanged(cloneTileObject(obj));
  } catch {
    return;
  }
  if (ctx && typeof tileView.update === "function") {
    try { tileView.update(ctx); } catch {}
  }
}

/**
 * Détourne `onDataChanged` pour que la tuile réaffiche toujours `desired`, quoi
 * que le jeu lui envoie. C'est ce qui remplace l'ancienne écriture dans le
 * state, qui se faisait écraser au push suivant.
 */
function installHold(tileView: any, desired: any): TileHold | null {
  if (!tileView || typeof tileView.onDataChanged !== "function") return null;

  const hadOwnProperty = Object.prototype.hasOwnProperty.call(tileView, "onDataChanged");
  const original = tileView.onDataChanged as (obj: any) => void;
  const pinned = cloneTileObject(desired);

  tileView.onDataChanged = function (this: any) {
    return original.call(this, cloneTileObject(pinned));
  };

  return { tileView, hadOwnProperty, original };
}

function releaseHold(hold: TileHold): void {
  try {
    if (hold.hadOwnProperty) {
      hold.tileView.onDataChanged = hold.original;
    } else {
      delete hold.tileView.onDataChanged;
    }
  } catch {
    try { hold.tileView.onDataChanged = hold.original; } catch {}
  }
}

function releaseAllHolds(): void {
  for (const hold of holds.values()) releaseHold(hold);
  holds.clear();
}

export async function applyFriendGardenPreview(garden: GardenState | null): Promise<boolean> {
  if (!garden || typeof garden !== "object") return false;

  try {
    // Un aperçu déjà en cours (changement d'ami) : on rend la main d'abord.
    releaseAllHolds();

    if (!tos.isReady()) return false;

    const mine = await resolveMySlot();
    if (!mine) return false;

    const targets = await collectSlotTiles(sanitizeGarden(garden), mine.userSlotIdx);
    if (!targets.length) return false;

    const ctx = renderContext();
    for (const target of targets) {
      const tileView = tileViewAt(target);
      if (!tileView) continue;
      const hold = installHold(tileView, target.desired);
      if (hold) holds.set(target.gidx, hold);
      pushToView(tileView, target.desired, ctx);
    }

    if (holds.size === 0) return false;

    // La peinture est posée ; on aligne aussi la donnée lue par le panneau
    // d'infos de la tuile courante. Un échec ici ne doit pas annuler l'aperçu
    // visuel, qui lui est déjà en place.
    try {
      await fakeShow(MY_DATA_GARDEN_PATCH, { garden: sanitizeGarden(garden) });
    } catch (error) {
      console.warn("[GardenPreview] tile info patch unavailable", error);
    }

    previewUserSlotIdx = mine.userSlotIdx;
    previewPlayerId = mine.playerId;
    friendGardenPreviewActive = true;
    return true;
  } catch (error) {
    console.error("[GardenPreview] applyFriendGardenPreview failed", error);
    releaseAllHolds();
    try { await fakeHide(MY_DATA_GARDEN_PATCH.label); } catch {}
    friendGardenPreviewActive = false;
    return false;
  }
}

export async function clearFriendGardenPreview(): Promise<boolean> {
  if (!friendGardenPreviewActive) return false;

  friendGardenPreviewActive = false;
  const userSlotIdx = previewUserSlotIdx;
  const playerId = previewPlayerId;
  previewUserSlotIdx = null;
  previewPlayerId = null;

  releaseAllHolds();

  try { await fakeHide(MY_DATA_GARDEN_PATCH.label); } catch {}

  try {
    // Le state n'a jamais été modifié : il porte la vérité serveur, y compris
    // ce qui a poussé pendant l'aperçu. On repeint simplement depuis lui.
    if (userSlotIdx == null || !playerId) return true;

    const cur = (await Atoms.root.state.get().catch(() => null)) as any;
    const slotMatch = findPlayerSlot(cur?.child?.data?.userSlots, playerId, { sortObject: true });
    const realGarden = sanitizeGarden(slotMatch?.matchSlot?.data?.garden);

    const targets = await collectSlotTiles(realGarden, userSlotIdx);
    const ctx = renderContext();
    for (const target of targets) {
      const tileView = tileViewAt(target);
      if (!tileView) continue;
      pushToView(tileView, target.desired, ctx);
    }

    return true;
  } catch (error) {
    console.error("[GardenPreview] clearFriendGardenPreview failed", error);
    return false;
  }
}
