// src/game/pixiGraphics.ts
//
// Borrowing the game's own PIXI.Graphics constructor.
//
// The game does not publish PIXI as a global, and reaching for it through
// internal renderer fields is a bet on names the minifier is free to rewrite.
// What does survive minification is the *public* API of a class: so we look
// through the display tree for a node exposing `roundRect` and `clear`, and
// take its `.constructor`.
//
// Ported from Arie's Mod (src/utils/gardenInfoCardPixi.ts).

/**
 * Same walk as a plain depth-first search, but gives each top-level branch of
 * `root` its own search budget instead of pooling one limit across the whole
 * tree. The game's world/tile layer alone can hold tens of thousands of sprite
 * nodes — a single shared budget starting there exhausts before ever reaching
 * sibling UI layers, making anything only found there unreachable once the
 * world grows large enough. That's a race against world size, not a real
 * "not found".
 */
export function findAcrossBranches(
  root: any,
  pred: (node: any) => boolean,
  limitPerBranch = 25000,
): any {
  if (!root) return null;
  if (pred(root)) return root;

  const children = root.children;
  if (!Array.isArray(children)) return null;

  for (const child of children) {
    const stack = [child];
    const seen = new Set<any>();
    let visited = 0;

    while (stack.length && visited++ < limitPerBranch) {
      const node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      if (pred(node)) return node;
      const kids = node.children;
      if (Array.isArray(kids)) for (const kid of kids) stack.push(kid);
    }
  }

  return null;
}

// Cached at module level once found: it's a stable class reference for the
// whole page session, never per-caller state. Re-deriving it walks the entire
// stage including the world/tile layer, which is visibly slow while the player
// moves around.
let cachedGraphicsCtor: any = null;

/** The game's PIXI.Graphics class, found through its public API. */
export function findGraphicsCtor(root: any): any {
  if (cachedGraphicsCtor) return cachedGraphicsCtor;

  const found =
    findAcrossBranches(
      root,
      (node: any) => typeof node?.roundRect === "function" && typeof node?.clear === "function",
    )?.constructor ?? null;

  if (found) cachedGraphicsCtor = found;
  return found;
}
