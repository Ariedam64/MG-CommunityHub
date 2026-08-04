// src/game/chess/chessMarkShapes.ts
//
// The outline of an annotation arrow, as a flat point list ready for
// Graphics.poly(). Pure geometry: no Pixi, no game, no board - it takes two
// centres in world pixels and gives back a polygon, which is what makes it
// checkable outside the browser (npm run check:marks).
//
// One polygon rather than a shaft plus a head, because the arrows are drawn
// semi-transparent: two overlapping shapes would leave a darker patch where
// they meet.

export type MarkPoint = { x: number; y: number };

/** Ratios of one tile, so an arrow scales with the board. */
const SHAFT_WIDTH_RATIO = 0.17;
const HEAD_LENGTH_RATIO = 0.34;
const HEAD_WIDTH_RATIO = 0.46;

/**
 * How far from the origin's centre the arrow starts. Enough to leave the piece
 * it points from visible underneath.
 */
const TAIL_INSET_RATIO = 0.3;

type Vector = { x: number; y: number };

function subtract(a: MarkPoint, b: MarkPoint): Vector {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(v: Vector, factor: number): Vector {
  return { x: v.x * factor, y: v.y * factor };
}

function add(point: MarkPoint, v: Vector): MarkPoint {
  return { x: point.x + v.x, y: point.y + v.y };
}

function normalize(v: Vector): Vector | null {
  const length = Math.hypot(v.x, v.y);
  if (length <= 0) return null;
  return { x: v.x / length, y: v.y / length };
}

/** The unit vector 90 degrees off `v` - the "left" side of a travel direction. */
function perpendicular(v: Vector): Vector {
  return { x: -v.y, y: v.x };
}

function flatten(points: MarkPoint[]): number[] {
  const out: number[] = [];
  for (const point of points) out.push(point.x, point.y);
  return out;
}

/**
 * Whether the two centres are a knight's jump apart - two tiles on one axis and
 * one on the other. Read off the pixel distance rather than passed in, since
 * board squares always sit a whole number of tiles apart.
 */
function isKnightJump(delta: Vector, tileSize: number): boolean {
  const cols = Math.round(Math.abs(delta.x) / tileSize);
  const rows = Math.round(Math.abs(delta.y) / tileSize);
  return (cols === 1 && rows === 2) || (cols === 2 && rows === 1);
}

/**
 * The corner a knight arrow turns at: the long leg is travelled first, so the
 * bend sits two squares from the origin.
 */
function knightCorner(from: MarkPoint, to: MarkPoint): MarkPoint {
  const horizontalIsLong = Math.abs(to.x - from.x) > Math.abs(to.y - from.y);
  return horizontalIsLong ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}

/** Outline of a straight arrow, walking the left side out and the right back. */
function straightOutline(
  from: MarkPoint,
  to: MarkPoint,
  tileSize: number,
): number[] | null {
  const direction = normalize(subtract(to, from));
  if (!direction) return null;

  const halfShaft = (tileSize * SHAFT_WIDTH_RATIO) / 2;
  const halfHead = (tileSize * HEAD_WIDTH_RATIO) / 2;
  const side = perpendicular(direction);

  const tail = add(from, scale(direction, tileSize * TAIL_INSET_RATIO));
  const base = add(to, scale(direction, -tileSize * HEAD_LENGTH_RATIO));

  return flatten([
    add(tail, scale(side, halfShaft)),
    add(base, scale(side, halfShaft)),
    add(base, scale(side, halfHead)),
    to,
    add(base, scale(side, -halfHead)),
    add(base, scale(side, -halfShaft)),
    add(tail, scale(side, -halfShaft)),
  ]);
}

/**
 * Outline of an L-shaped arrow, the way a knight's move is drawn.
 *
 * The two legs are at right angles, so the shaft's offset lines meet at
 * `corner + halfShaft * (sideOfLeg1 + sideOfLeg2)` - no general mitre maths
 * needed, and the bend comes out square.
 */
function knightOutline(
  from: MarkPoint,
  to: MarkPoint,
  tileSize: number,
): number[] | null {
  const corner = knightCorner(from, to);
  const firstLeg = normalize(subtract(corner, from));
  const secondLeg = normalize(subtract(to, corner));
  if (!firstLeg || !secondLeg) return null;

  const halfShaft = (tileSize * SHAFT_WIDTH_RATIO) / 2;
  const halfHead = (tileSize * HEAD_WIDTH_RATIO) / 2;
  const firstSide = perpendicular(firstLeg);
  const secondSide = perpendicular(secondLeg);
  const bend = {
    x: firstSide.x + secondSide.x,
    y: firstSide.y + secondSide.y,
  };

  const tail = add(from, scale(firstLeg, tileSize * TAIL_INSET_RATIO));
  const base = add(to, scale(secondLeg, -tileSize * HEAD_LENGTH_RATIO));

  return flatten([
    add(tail, scale(firstSide, halfShaft)),
    add(corner, scale(bend, halfShaft)),
    add(base, scale(secondSide, halfShaft)),
    add(base, scale(secondSide, halfHead)),
    to,
    add(base, scale(secondSide, -halfHead)),
    add(base, scale(secondSide, -halfShaft)),
    add(corner, scale(bend, -halfShaft)),
    add(tail, scale(firstSide, -halfShaft)),
  ]);
}

/**
 * The arrow joining two square centres, as [x0, y0, x1, y1, ...] in the same
 * space the centres were given in. Null when the two points are the same.
 */
export function arrowOutline(
  from: MarkPoint,
  to: MarkPoint,
  tileSize: number,
): number[] | null {
  const delta = subtract(to, from);
  if (delta.x === 0 && delta.y === 0) return null;

  return isKnightJump(delta, tileSize)
    ? knightOutline(from, to, tileSize)
    : straightOutline(from, to, tileSize);
}
