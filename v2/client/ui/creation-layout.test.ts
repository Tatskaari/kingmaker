// Copied from the prototype's src/app/ui/creation-layout.test.ts at 44c6d4a: their own build is a recorded fixture's (the offer's bard, a caster, and the orc rogue), not one the engine makes here.
import assert from "node:assert/strict";
import { test } from "node:test";
import { OFFER, OWN } from "../check/rows.ts";
import { issueRows, ownRows } from "./creation-layout.ts";
import type { Row } from "./sheet-layout.ts";

/**
 * Character creation's layout, as rows: what the lore check says of an issue in the room the screen
 * has (the fix, which Accept puts in, kept whole before the rest; said when it can't be), and the
 * player's own build in a few rows (a caster's spells and their DC before the rest).
 */

const plain = (rows: Row[]) => rows.map(r => r.map(s => s.text).join("")).join("\n");
const flat = (rows: Row[]) => plain(rows).replace(/\s+/g, " ");

// A real issue, as a live lore check returned it: a two-sentence quote, problem and fix.
const ISSUE = {
  quote: "I clerked for two years under Master Josiah Sallow at the Royal Purveyor's office. He's a fussy, honest man who never once fiddled a figure, and he'd vouch for me to anyone.",
  problem: "Sallow is a named officer of the Royal Purveyor's office; a former clerk who worked under him for two years would be a recorded connection, and the story's named people do not know Tamsin yet.",
  fix: "I clerked for two years in the Royal Purveyor's office, where I learned to check every figure twice. I left before I could learn whether anyone there would vouch for me.",
};

test("an issue with room: all of it, the story's words, what the world says, then the fix", () => {
  const { rows, whole } = issueRows(ISSUE, 74, 20);
  assert.ok(whole);
  const text = flat(rows);
  for (const part of [ISSUE.quote, ISSUE.problem, ISSUE.fix]) assert.ok(text.includes(part), part);
  assert.ok(text.indexOf("Your story says") < text.indexOf("The world says") && text.indexOf("The world says") < text.indexOf("A fix that keeps its spirit"));
});

test("an issue short of room: the fix whole, the quote then the problem cut to give it room, never more rows than there are", () => {
  for (const room of [9, 7, 5]) {
    const { rows, whole } = issueRows(ISSUE, 74, room);
    assert.ok(whole, `room ${room}`);
    assert.ok(rows.length <= room, `${rows.length} rows in ${room}`);
    assert.ok(flat(rows).includes(`A fix that keeps its spirit: "${ISSUE.fix}"`), `the fix whole in ${room} rows`);
    assert.match(plain(rows), /^Your story says:/, "the quote keeps a row");
    assert.match(plain(rows), /\nThe world says:/, "and the problem");
  }
});

test("a fix longer than the room: as much as fits, and not whole (Accept waits for a bigger screen)", () => {
  const long = { ...ISSUE, fix: "I clerked in the Royal Purveyor's office. ".repeat(30).trim() };
  const { rows, whole } = issueRows(long, 74, 8);
  assert.equal(whole, false);
  assert.equal(rows.length, 8);
  assert.match(plain(rows), /…$/, "cut, and saying so");
});

test("their own build: a caster's DC and spells come before the rest, even in three rows", () => {
  const bard = OFFER.options.find(o => o.card.className === "Bard")!;
  const rows = plain(ownRows(bard, 74, 3)).split("\n");
  assert.equal(rows.length, 3);
  assert.match(rows[0]!, /^Human Bard 3 · College of Lore · Sage/);
  assert.match(rows[1]!, /HP \d+ · AC \d+ · 30 ft · Spells DC \d+ \+\d/);
  assert.match(rows[2]!, /Fire Bolt, .*…$/, "the spells by name");
  assert.match(plain(ownRows(OWN, 74, 3)).split("\n")[1]!, /HP \d+ · AC \d+ · \d+ ft · Rapier/, "a rogue's weapon first");
});
