import { test } from "node:test";
import assert from "node:assert/strict";
import { describeRoll, rng, rollCheck, rollFrom } from "./dice.ts";

test("the same seed rolls the same, and nearby seeds don't share a first roll", () => {
  const first = (seed: number) => Array.from({ length: 5 }, rng(seed));
  assert.deepEqual(first(42), first(42));
  assert.notDeepEqual(first(1000)[0], first(1007)[0]);
});

test("rollFrom rolls as the prototype's rollFor does without a sheet, and counts the roll", () => {
  const dice = { seed: 11, rolls: 2 };
  const { roll, dice: after } = rollFrom(dice, "persuasion", 12, 3);

  assert.deepEqual(roll, rollCheck(rng(11 + 7919 * 3), "persuasion", 12, 3));
  assert.deepEqual(after, { seed: 11, rolls: 3 });
  assert.deepEqual(rollFrom(dice, "persuasion", 12, 3), { roll, dice: after });
});

test("a game's checks replay from its dice", () => {
  const play = () => {
    let dice = { seed: 123_456_789, rolls: 0 };
    const lines: string[] = [];
    for (const [skill, dc] of [["medicine", 12], ["persuasion", 14], ["athletics", 10]] as const) {
      const next = rollFrom(dice, skill, dc, 2);
      lines.push(describeRoll(next.roll, "to see"));
      dice = next.dice;
    }
    return lines;
  };

  assert.deepEqual(play(), play());
  assert.match(play()[0]!, /^Medicine check to see: \d+ \+ 2 = \d+ vs DC 12: (success|failure)/);
});
