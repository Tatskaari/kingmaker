import assert from "node:assert/strict";
import { test } from "node:test";
import { PACE } from "../../shared/fight/pace.ts";
import type { FightEvent } from "../../shared/fight/types.ts";
import { frameOf, wolvesAt } from "../check/fight.ts";
import { TINT } from "../look/fight.ts";
import { marksOf } from "./draw.ts";
import { FightModel } from "./model.ts";

/**
 * The board's tints (M6's screen, docs/combat-design.md §2 and §3), on the recorded wolf run: whose
 * turn it is lit on their tile; on the player's turn the tiles they can walk to, and those that draw a
 * swing; while aiming, the reach's ring, the targets and an area; and a spell's area lit as it plays.
 */

function staged(frame: number) {
  let now = 10_000;
  const model = new FightModel(wolvesAt(frame), { move: async () => undefined, turn: async () => undefined, out: async () => undefined, quit: () => {} }, { now: () => now, timers: false });
  return { model, at: (ms: number) => { now = 10_000 + ms; }, marks: () => marksOf(model, model.frame(), now) };
}
const key = (m: { at: { x: number; y: number } }) => `${m.at.x},${m.at.y}`;

test("on the player's turn: the tiles they can walk to, those drawing a swing in their own tint, and their own tile lit as it's their turn", () => {
  const s = staged(frameOf("step: wolf-3", 1));
  const o = s.model.options!;
  const marks = new Map(s.marks().map(m => [key(m), m.color]));
  for (const t of o.moves.filter(m => !(o.swings ?? []).some(w => w.x === m.x && w.y === m.y))) assert.equal(marks.get(`${t.x},${t.y}`), TINT.reach);
  for (const t of o.swings ?? []) assert.equal(marks.get(`${t.x},${t.y}`), TINT.swing);
  const me = s.model.view.board.units["player"]!.at;
  assert.ok(marks.get(`${me.x},${me.y}`)?.startsWith("#"), "their tile lit");
});

test("aiming: the reach's ring and the targets, the walking tiles put away", () => {
  const s = staged(frameOf("step: wolf-3", 1));
  s.model.openMenu();
  s.model.chooseFromMenu(s.model.menu!.entries.findIndex(e => e.name === "Attack"));
  const marks = new Map(s.marks().map(m => [key(m), m.color]));
  for (const target of s.model.aim!.entry.options) assert.equal(marks.get(key({ at: target.at! })), TINT.target);
  assert.ok([...marks.values()].includes(TINT.ring), "the reach's edge");
  assert.ok(![...marks.values()].includes(TINT.reach), "no walking tiles while aiming");
});

test("a spell's area lit as it plays, from its beat to the blast's landing", () => {
  const s = staged(frameOf("you: end_turn"));
  const view = wolvesAt(frameOf("you: end_turn"));
  const area = [{ x: 3, y: 3 }, { x: 4, y: 3 }];
  const cast: FightEvent = {
    seq: view.events.length + 1, round: 1, turn: "wolf-1", kind: "cast", actor: "wolf-1", caption: "A grey wolf casts Burning Hands, catching nobody.",
    detail: { at: { x: 3, y: 3 }, with: "Burning Hands", element: "fire", area, rolls: [], hits: [], lines: [] },
  };
  s.model.update({ ...view, events: [...view.events, cast] });
  s.at(PACE.area / 2);
  const lit = new Map(s.marks().map(m => [key(m), m.color]));
  for (const a of area) assert.ok(lit.has(`${a.x},${a.y}`), "lit as it plays");
  s.at(PACE.area + 500);
  const after = new Map(s.marks().map(m => [key(m), m.color]));
  assert.ok(!after.has("4,3"), "and not after");
});
