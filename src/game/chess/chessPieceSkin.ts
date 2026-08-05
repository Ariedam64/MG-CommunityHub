// src/game/chess/chessPieceSkin.ts
//
// Dresses the board's pieces with real chess piece images instead of the
// game's decor props.
//
// The decor tiles are left exactly where they are and the image is added as a
// *child* of the tile's own display object. That is the whole trick: a child
// inherits the tile's position, so it follows the drag, follows the slide,
// sorts at the tile's depth and dies when the tile is emptied. Nothing in the
// input, the animation, the tinting or the teardown has to know this module
// exists.
//
// Everything here fails soft. If the images cannot be fetched, or the game's
// Sprite class cannot be found, the board simply keeps its decor pieces - a
// skin is never allowed to cost anyone a game.

import { getAudioUrlSafe } from "@/platform/discordCsp";
import { findAcrossBranches } from "@/game/pixiGraphics";
import { tos } from "@/game/tileObjectSystem";
import { readHubPath, writeHubPath } from "@/storage/storage";
import { FARM_TILE_SIZE, resolveTileRoot } from "./chessBoardTiles";
import type { ChessPiece, ChessPieceKind, ChessSide } from "./chessRules";

/** Remembered across sessions: a player who prefers one view always does. */
const STORAGE_ENABLED = "chess.flatPieces";

const SKIN_BASE = "https://assets-themes.chess.com/image/ejgfv/150";

/** chess.com names its files by side letter and piece letter, eg "wn"odd. */
const PIECE_LETTER: Record<ChessPieceKind, string> = {
  pawn: "p",
  knight: "n",
  bishop: "b",
  rook: "r",
  queen: "q",
  king: "k",
};

function pieceUrl(piece: ChessPiece): string {
  const side = piece.side === "white" ? "w" : "b";
  return `${SKIN_BASE}/${side}${PIECE_LETTER[piece.kind]}.png`;
}

/**
 * The same flat image the board uses, for anything outside the board that has
 * to match it - the HUD's captured strips, so far. Plain DOM, no Pixi and no
 * preload needed: an `<img>` fetches it itself.
 */
export function flatPieceImageUrl(kind: ChessPieceKind, side: ChessSide): string {
  return pieceUrl({ kind, side });
}

/** Marks the child we added, so a redress replaces it instead of stacking. */
const SKIN_FLAG = "__mgChessSkin";

/**
 * Slightly inside the tile, so a piece does not touch its neighbours. The
 * chess.com images already carry their own margin inside a square canvas, so
 * this can sit close to a full tile without pieces looking crowded.
 */
const PIECE_SCALE = 1;

type TextureCache = Map<string, any>;

const textures: TextureCache = new Map();
let spriteCtor: any = null;
let textureCtor: any = null;
let ready = false;
let loadFailed = false;

/** Flat images on by default: they are what makes the board read as a board. */
let enabled: boolean = readHubPath<boolean>(STORAGE_ENABLED) ?? true;

export function isFlatPiecesEnabled(): boolean {
  return enabled;
}

/**
 * Switches between the flat images and the game's own props. Takes effect on
 * the next render, which is why the caller remounts the board.
 */
export function setFlatPiecesEnabled(on: boolean): void {
  enabled = on;
  writeHubPath(STORAGE_ENABLED, on);
}

/* -------------------------------------------------------------------------- */
/* Pixi classes                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The game's Sprite class, found the same way pixiGraphics finds Graphics:
 * by a public API the minifier cannot rename. A Sprite is the thing that has
 * both a texture and an anchor.
 */
function resolveSpriteCtor(): any {
  if (spriteCtor) return spriteCtor;

  const stage = (tos.getStatus().engine as any)?.app?.stage;
  const found = findAcrossBranches(
    stage,
    (node: any) => !!node?.texture && !!node?.anchor && typeof node?.anchor?.set === "function",
  );

  spriteCtor = found?.constructor ?? null;
  // Any live texture gives us the class, and with it its `from` factory.
  textureCtor = found?.texture?.constructor ?? null;
  return spriteCtor;
}

/* -------------------------------------------------------------------------- */
/* Textures                                                                   */
/* -------------------------------------------------------------------------- */

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed: ${url}`));
    img.src = url;
  });
}

async function loadTexture(url: string): Promise<any> {
  const cached = textures.get(url);
  if (cached) return cached;

  // Under the Discord activity the CSP refuses the host outright, so the bytes
  // come back through GM as a blob: URL. Off Discord this hands the URL back
  // untouched.
  const safeUrl = await getAudioUrlSafe(url);
  const image = await loadImage(safeUrl);

  const from = textureCtor?.from;
  if (typeof from !== "function") throw new Error("Texture.from unavailable");

  const texture = from.call(textureCtor, image);
  textures.set(url, texture);
  return texture;
}

/**
 * Fetches all twelve images up front, so pieces never pop in one by one as a
 * game unfolds. Safe to call repeatedly; only the first call does work.
 */
export async function preloadPieceSkin(): Promise<boolean> {
  if (ready) return true;
  if (loadFailed) return false;

  if (!resolveSpriteCtor() || !textureCtor?.from) {
    loadFailed = true;
    console.log("[ChessBoard] piece skin off: the game's Sprite class was not found");
    return false;
  }

  const sides: ChessSide[] = ["white", "black"];
  const kinds = Object.keys(PIECE_LETTER) as ChessPieceKind[];

  try {
    await Promise.all(
      sides.flatMap((side) => kinds.map((kind) => loadTexture(pieceUrl({ kind, side })))),
    );
    ready = true;
    return true;
  } catch (error) {
    loadFailed = true;
    console.log("[ChessBoard] piece skin off, falling back to decor:", error);
    return false;
  }
}

export function isPieceSkinReady(): boolean {
  return ready;
}

/* -------------------------------------------------------------------------- */
/* Dressing tiles                                                             */
/* -------------------------------------------------------------------------- */

function existingSkin(root: any): any {
  return (root?.children ?? []).find((child: any) => child?.[SKIN_FLAG]) ?? null;
}

function decorChildren(root: any): any[] {
  return (root?.children ?? []).filter((child: any) => !child?.[SKIN_FLAG]);
}

/** Hides whatever the game drew for the decor, without removing it. */
function hideDecor(root: any): void {
  for (const child of decorChildren(root)) child.visible = false;
}

/** Puts the game's own prop back and takes our image away. */
function showDecor(root: any): void {
  for (const child of decorChildren(root)) child.visible = true;
  const skin = existingSkin(root);
  if (skin) skin.visible = false;
}

type LocalPoint = { x: number; y: number };

/**
 * The centre of the tile, expressed in the tile's own coordinates.
 *
 * Two wrong answers came before this one. Assuming the local origin was the
 * tile's top left put every piece half a square out. Measuring the decor
 * instead made the placement - and the size - follow the shape of whichever
 * prop the game happened to use, so a rook came out bigger than a pawn.
 *
 * This asks Pixi to do the conversion rather than working it out: the tile
 * sits in the World container, where a tile centre is simply
 * (tx + 0.5) * FARM_TILE_SIZE, so toLocal turns that into whatever the tile's
 * own space calls the same spot. No assumption left to get wrong.
 *
 * Returns null when the conversion is unavailable, and the caller falls back
 * to the middle of the tile.
 */
function tileCentreLocal(root: any, tx: number, ty: number): LocalPoint | null {
  const world = root?.parent;
  if (!world || typeof root.toLocal !== "function") return null;

  try {
    const centre = root.toLocal(
      { x: (tx + 0.5) * FARM_TILE_SIZE, y: (ty + 0.5) * FARM_TILE_SIZE },
      world,
    );
    if (!Number.isFinite(centre?.x) || !Number.isFinite(centre?.y)) return null;
    return { x: centre.x, y: centre.y };
  } catch {
    return null;
  }
}

/**
 * Puts the piece's image on that tile. Silent no-op until the textures are
 * loaded, which is what keeps the caller from having to check.
 */
export function dressTile(tx: number, ty: number, piece: ChessPiece): void {
  const root = resolveTileRoot(tx, ty, false);
  if (!root?.addChild) return;

  // Switched to the game's props: undo the dressing rather than skip it, or a
  // tile that was already dressed would keep its image.
  if (!enabled) {
    showDecor(root);
    return;
  }

  if (!ready) return;

  const texture = textures.get(pieceUrl(piece));
  if (!texture) return;

  hideDecor(root);

  // One size for every piece. Deriving it from the decor was what made a rook
  // come out bigger than a pawn: the props are not all the same size, but the
  // images are, and a chess set has to look like a set.
  const size = FARM_TILE_SIZE * PIECE_SCALE;
  const centre = tileCentreLocal(root, tx, ty);
  let sprite = existingSkin(root);

  if (!sprite) {
    const Sprite = resolveSpriteCtor();
    if (!Sprite) return;
    sprite = new Sprite(texture);
    sprite[SKIN_FLAG] = true;
    sprite.anchor?.set?.(0.5, 0.5);
    root.addChild(sprite);
  } else {
    sprite.texture = texture;
  }

  // The tile's own transform does the rest, which is why this needs no
  // knowledge of the board's origin or of the flip.
  sprite.x = centre?.x ?? FARM_TILE_SIZE / 2;
  sprite.y = centre?.y ?? FARM_TILE_SIZE / 2;
  sprite.width = size;
  sprite.height = size;
  sprite.visible = true;
}

/**
 * Takes our image off a square.
 *
 * Emptying a tile clears the decor it holds but reuses the view, and our image
 * is a child of that view - so without this it outlives the piece and sits on
 * the square the piece just left, looking like a shadow of it.
 */
export function undressTile(tx: number, ty: number): void {
  const root = resolveTileRoot(tx, ty, false);
  const skin = existingSkin(root);
  if (!skin) return;

  try {
    root.removeChild?.(skin);
  } catch {
    /* ignore */
  }
  try {
    // Never the texture: it is shared by every piece of that kind and the
    // board still needs it.
    skin.destroy?.({ texture: false, textureSource: false });
  } catch {
    /* ignore */
  }
}

/**
 * Forgets the loaded textures. The sprites themselves are children of the
 * tiles, so tearing the board down takes them with it.
 */
export function clearPieceSkin(): void {
  for (const texture of textures.values()) {
    try {
      texture?.destroy?.(true);
    } catch {
      /* ignore */
    }
  }
  textures.clear();
  ready = false;
}
