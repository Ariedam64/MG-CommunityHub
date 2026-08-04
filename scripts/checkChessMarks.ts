// scripts/checkChessMarks.ts
//
// Verifies src/game/chess/chessMarkShapes.ts - the only part of the annotations
// that is maths rather than something you can see at a glance in the game.
//
// Run with: npm run check:marks

import { arrowOutline, type MarkPoint } from "../src/game/chess/chessMarkShapes";

const TILE = 256;

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
}

function checkClose(label: string, actual: number, expected: number): void {
  check(label, Math.abs(actual - expected) < 0.001 ? expected : actual, expected);
}

/** Board square centre, columns and rows counted in tiles from the origin. */
function centre(col: number, row: number): MarkPoint {
  return { x: (col + 0.5) * TILE, y: (row + 0.5) * TILE };
}

function points(outline: number[]): MarkPoint[] {
  const out: MarkPoint[] = [];
  for (let i = 0; i < outline.length; i += 2) out.push({ x: outline[i], y: outline[i + 1] });
  return out;
}

/** Whether the outline passes through that point, within a pixel. */
function has(outline: number[], point: MarkPoint): boolean {
  return points(outline).some(
    (p) => Math.abs(p.x - point.x) < 1 && Math.abs(p.y - point.y) < 1,
  );
}

console.log("Arrow outlines");

// A zero-length arrow has no direction to point in: the caller draws a marked
// square instead, and must not be handed a degenerate polygon.
check("same square yields nothing", arrowOutline(centre(4, 4), centre(4, 4), TILE), null);

const straight = arrowOutline(centre(4, 6), centre(4, 4), TILE)!;
check("straight arrow has 7 corners", straight.length / 2, 7);
check("straight arrow ends on the destination centre", has(straight, centre(4, 4)), true);

// The tip is the only point on the destination's centre line ahead of the head:
// everything else sits back at the head's base or along the shaft.
const straightYs = points(straight).map((p) => p.y);
checkClose("tip is the furthest point travelled", Math.min(...straightYs), centre(4, 4).y);

// Symmetry about the shaft: a vertical arrow's outline must mirror left/right.
const straightXs = points(straight).map((p) => p.x);
checkClose(
  "straight arrow is symmetric about its shaft",
  (Math.min(...straightXs) + Math.max(...straightXs)) / 2,
  centre(4, 4).x,
);

// A knight's jump bends: two squares along one axis, then one along the other.
const knight = arrowOutline(centre(6, 7), centre(7, 5), TILE)!;
check("knight arrow has 9 corners", knight.length / 2, 9);
check("knight arrow ends on the destination centre", has(knight, centre(7, 5)), true);

// The long leg is travelled first, so this one goes up two rows before turning
// right. The shaft's two sides pass either side of that bend by the same
// amount, so their midpoint lands exactly on it - which is what says the
// corner is square and in the right place, whatever the shaft's width.
const knightBend = points(knight);
checkClose("knight bend stays on the origin file", (knightBend[1].x + knightBend[7].x) / 2, centre(6, 7).x);
checkClose("knight bend turns on the destination row", (knightBend[1].y + knightBend[7].y) / 2, centre(7, 5).y);

// Same jump the other way round: two columns then one row, so the bend sits on
// the origin's row rather than its file.
const knightFlat = arrowOutline(centre(4, 4), centre(6, 5), TILE)!;
const flatBend = points(knightFlat);
check("flat knight arrow has 9 corners", knightFlat.length / 2, 9);
check("flat knight arrow ends on the destination centre", has(knightFlat, centre(6, 5)), true);
checkClose("flat knight bend turns on the destination file", (flatBend[1].x + flatBend[7].x) / 2, centre(6, 5).x);
checkClose("flat knight bend stays on the origin row", (flatBend[1].y + flatBend[7].y) / 2, centre(4, 4).y);

// A queen's diagonal is not a knight's jump, however far it runs.
const diagonal = arrowOutline(centre(0, 7), centre(3, 4), TILE)!;
check("diagonal arrow stays straight", diagonal.length / 2, 7);

// Two tiles on both axes is a bishop's move, not a knight's.
const twoByTwo = arrowOutline(centre(0, 0), centre(2, 2), TILE)!;
check("2x2 diagonal stays straight", twoByTwo.length / 2, 7);

console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
