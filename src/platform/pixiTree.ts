// src/platform/pixiTree.ts
// Generic search helpers over a PIXI scene graph. Used wherever a feature
// needs to find a node by its `.label` (Pixi's stable-ish container name)
// or by an arbitrary predicate, without depending on any one feature.

/**
 * Depth-first search that gives each top-level branch of `root` its own
 * search budget instead of pooling one `limitPerBranch` across the whole
 * tree. The game's world/tile layer alone can hold tens of thousands of
 * sprite nodes — a single shared budget starting there exhausts before ever
 * reaching sibling UI layers, making anything only found there unreachable
 * once the world grows large enough. That's a race against world size, not
 * a real "not found".
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
    let n = 0;
    while (stack.length && n++ < limitPerBranch) {
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

export function findByLabel(root: any, label: string, limitPerBranch = 25000): any {
  return findAcrossBranches(root, (node: any) => node?.label === label, limitPerBranch);
}
