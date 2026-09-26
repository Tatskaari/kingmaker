// Wall rules adapted from Peter Kiš's MIT-licensed TiSu Tiny Dungeon example.
// See docs/autotiling.md and public/assets/tisu.LICENSE.txt for provenance.
// Values are zero-based Kenney sprite indexes, not Tiled's one-based GIDs.
type Pattern = readonly (readonly number[])[];
interface Rule { input: Pattern; output: Pattern }

const walls: readonly Rule[] = [
  { input: [[48], [0]], output: [[48], [26]] },
  { input: [[0], [0], [48]], output: [[2], [40], [48]] },
  { input: [[0, 48]], output: [[13, 48]] },
  { input: [[48, 0]], output: [[48, 15]] },
  { input: [[48, 48], [48, 0]], output: [[48, 48], [48, 4]] },
  { input: [[48, 48], [0, 48]], output: [[48, 48], [5, 48]] },
  { input: [[48, 0], [48, 48]], output: [[48, 57], [48, 48]] },
  { input: [[0, 48], [48, 48]], output: [[59, 48], [48, 48]] },
];

const corners: readonly Rule[] = [
  { input: [[15, 2]], output: [[16, 2]] },
  { input: [[2, 13]], output: [[2, 17]] },
  { input: [[0, 2]], output: [[1, 2]] },
  { input: [[2, 0]], output: [[2, 3]] },
  { input: [[0, 17]], output: [[1, 17]] },
  { input: [[16, 0]], output: [[16, 3]] },
  { input: [[0, 40]], output: [[13, 40]] },
  { input: [[40, 0]], output: [[40, 15]] },
  { input: [[0, 26]], output: [[25, 26]] },
  { input: [[26, 0]], output: [[26, 27]] },
  { input: [[40, 2]], output: [[40, 16]] },
  { input: [[2, 40]], output: [[17, 40]] },
  { input: [[57, 2]], output: [[57, 16]] },
  { input: [[2, 59]], output: [[17, 59]] },
  { input: [[15], [57]], output: [[16], [57]] },
  { input: [[13], [59]], output: [[17], [59]] },
];

function applyRules(source: readonly number[], output: number[], width: number, height: number, rules: readonly Rule[], evolving: boolean): void {
  for (const rule of rules) {
    const rows = rule.input.length;
    const columns = rule.input[0]!.length;
    // A snapshot per rule makes matches independent of traversal order.
    const input = evolving ? output.slice() : source;
    for (let y = 0; y <= height - rows; y += 1) {
      for (let x = 0; x <= width - columns; x += 1) {
        if (!rule.input.every((row, dy) => row.every((id, dx) => input[(y + dy) * width + x + dx] === id))) continue;
        rule.output.forEach((row, dy) => row.forEach((id, dx) => {
          // Preserve edits from other matching rules where this rule has no change.
          if (id !== rule.input[dy]![dx]) output[(y + dy) * width + x + dx] = id;
        }));
      }
    }
  }
}

/** Compile a floor mask into scenery. Walkability remains the authored mask;
 * visual correction passes never open or obstruct a passage. */
export function autotileDungeon(floor: readonly boolean[], width: number, height: number): number[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || floor.length !== width * height) {
    throw new Error("Dungeon dimensions must match its floor mask");
  }
  // Solid padding lets rules finish corners along map edges without row wrap.
  const padding = 3;
  const stride = width + padding * 2;
  const rows = height + padding * 2;
  const source = Array<number>(stride * rows).fill(0);
  floor.forEach((value, index) => {
    source[(Math.floor(index / width) + padding) * stride + index % width + padding] = value ? 48 : 0;
  });
  const output = source.slice();
  applyRules(source, output, stride, rows, walls, false);
  for (let pass = 0; pass < 2; pass += 1) applyRules(source, output, stride, rows, corners, true);
  // North-wall floor shadow (sprite 50). Other shadow orientations require
  // sprite transforms and can be added independently of the wall rules.
  return floor.map((value, index) => {
    const offset = (Math.floor(index / width) + padding) * stride + index % width + padding;
    return value && !floor[index - width] && index >= width ? 50 : output[offset]!;
  });
}
