import assert from "node:assert/strict";
import { test } from "node:test";
import { creationRow, LISTS, NEPHEW, NEPHEW_ISSUE, OFFER, OWN } from "../check/rows.ts";
import { creationOf, memoParse } from "./rows.ts";

const local = { index: 0, column: 0 };

test("a creation row as the prototype's Creation: its JSON columns read, the screen's own laid over them", () => {
  const row = creationRow({ step: "backstory", chosen: OFFER.options[1]!, story: NEPHEW, version: 4, issues: [NEPHEW_ISSUE], issue: 0, again: true, note: "It's yours now: change anything you like.", gameId: 7n });
  const c = creationOf(row, { index: 2, column: 1 });

  assert.equal(c.name, "Tamsin Vell");
  assert.deepEqual(c.offer, OFFER);
  assert.equal(c.index, 2, "the card picked out is the screen's");
  assert.deepEqual(c.chosen, OFFER.options[1]);
  assert.deepEqual([c.story, c.version, c.issue, c.again, c.note, c.made], [NEPHEW, 4, 0, true, "It's yours now: change anything you like.", 7n]);
  assert.deepEqual(c.issues, [NEPHEW_ISSUE]);
  assert.equal(c.own, undefined, "no picks of their own");
  assert.equal(c.busy, undefined);
});

test("the box's text as typed, until the row's story is replaced from outside (its version moves on)", () => {
  const row = creationRow({ step: "backstory", story: "As saved.", version: 3 });
  assert.equal(creationOf(row, { ...local, typed: { text: "As typed since.", version: 3 } }).story, "As typed since.");
  assert.equal(creationOf({ ...row, story: "A draft, taken.", version: 4 }, { ...local, typed: { text: "As typed since.", version: 3 } }).story, "A draft, taken.");
  assert.equal(creationOf(row, local).story, "As saved.");
});

test("their own build: picks on their way drawn at once, the last option on show while the engine makes the next, the lists once they've come", () => {
  const own = { picks: { speciesId: "orc", classId: "rogue", subclassId: "thief", backgroundId: "criminal" }, option: OWN, lists: LISTS };
  const made = creationOf(creationRow({ step: "custom", own }), { index: 3, column: 2 }).own!;
  assert.deepEqual([made.picks, made.option, made.lists, made.column, made.making], [own.picks, OWN, LISTS, 2, false]);

  const asked = { ...own.picks, classId: "wizard", subclassId: "evoker" };
  const making = creationOf(creationRow({ step: "custom", own }), { index: 3, column: 1, picks: asked }).own!;
  assert.deepEqual([making.picks, making.option, making.making], [asked, OWN, true]);

  const first = creationOf(creationRow({ step: "custom", busy: "own", own: { picks: own.picks } }), local).own!;
  assert.deepEqual([first.lists, first.option, first.making], [undefined, undefined, true], "before the engine's first answer: no lists yet");
});

test("a JSON column that won't read is left out; the memo gives the same object for the same text, so a screen's effect on it runs once", () => {
  const broken = creationOf({ ...creationRow(), offer: "{not json", rewriting: "" }, local);
  assert.equal(broken.offer, undefined);
  assert.equal(broken.rewriting, undefined);

  const parse = memoParse();
  const row = creationRow({ step: "backstory", rewriting: NEPHEW_ISSUE });
  const before = creationOf(row, local, parse).rewriting;
  const after = creationOf({ ...row, story: "Saved since." }, local, parse).rewriting;
  assert.deepEqual(before, NEPHEW_ISSUE);
  assert.equal(after, before, "the same object across a save");
  assert.notEqual(creationOf(row, local).rewriting, before, "jsonOf alone gives a new one each time");
});
