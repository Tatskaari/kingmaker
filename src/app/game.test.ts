import assert from "node:assert/strict";
import { test } from "node:test";
process.env.KM_LOOK_MODEL = "off";
const { commandNamed, isRoll, talkBetween } = await import("./game.ts");

/**
 * The scene screen's small judgements: which rules lines are dice and which are news, which command
 * was typed, and what Kell says between scenes. No model calls, no terminal.
 */

test("the rules' lines with a roll in them keep the dice; the rest are news", () => {
  const dice = [
    "Medicine check to examine Prout for signs he was killed before he was hanged: 11 + 1 = 12 vs DC 12: success",
    "Dilly Sparrow's Dexterity save: 10 +0 = 10 vs DC 13: failed",
    "Longsword: your attack on the talking Crake: 14 +5 = 19 vs AC 13: hit",
    "Dilly Sparrow takes 29 fire damage (down)",
    "Damage to things in it: 8d6 (4+4+4+1+2+1+1+3) fire (things don't dodge)",
    "Cast Fireball (3rd-level slot): a 20-foot sphere on Big Hobb Mallory, catching Dilly Sparrow",
    "Fall: 1d6 (6) bludgeoning",
    "You take 6 bludgeoning damage (HP 14/20)",
    "Hit Die: d10 (7) +2 = 9 HP",
    "You regain 9 HP (HP 20/20)",
    "3 darts at Hep: 11 force",
    "The blue driftwood fire: unharmed by the fire",
  ];
  const news = [
    "You no longer have your javelin",
    "You have your javelin again",
    "You no longer have your chain mail (AC now 11)",
    "The fire spreads to the hay bales",
    "The fire on the crates burns out",
    "The dust in the loft goes up: an explosion",
    "You are prone",
    "You come to: HP 1/20",
    "Vesper: HP 37/37, spell slots 1st 4/4, 2nd 3/3, 3rd 1/2",
    "(No spell slots left for Fireball: a long rest restores them.)",
  ];
  for (const line of dice) assert.equal(isRoll(line), true, line);
  for (const line of news) assert.equal(isRoll(line), false, line);
});

test("commands by name, by alias, and by the start of one; the old # forms are the input's to strip", () => {
  assert.equal(commandNamed("sheet"), "sheet");
  assert.equal(commandNamed("SHEET"), "sheet");
  assert.equal(commandNamed("sh"), "sheet");
  assert.equal(commandNamed("c"), "sheet");
  assert.equal(commandNamed("j"), "journal");
  assert.equal(commandNamed("notebook"), "journal");
  assert.equal(commandNamed("?"), "help");
  assert.equal(commandNamed("m"), "map");
  assert.equal(commandNamed("ex"), "exits");
  assert.equal(commandNamed("end"), "end");
  // "s" could be the sheet or a save; "e" could be the exits or the end.
  assert.equal(commandNamed("s"), undefined);
  assert.equal(commandNamed("e"), undefined);
  assert.equal(commandNamed(""), undefined);
  assert.equal(commandNamed("dance"), undefined);
});

test("between scenes, Kell reads the entry back, the time passes, and she points the way", () => {
  const lines = talkBetween({ id: "kell", name: "Sergeant Kell" }, {
    notebook: ["Wendell Prout didn't hang himself."], next: { id: "drowned-rat", title: "The Drowned Rat" }, where: "the Drowned Rat", pointing: "south-west", time: "evening",
  });
  assert.deepEqual(lines.map(l => l.kind), ["dialogue", "narration", "dialogue"]);
  assert.match(lines[0]!.text, /in the words of the record: “Wendell Prout didn't hang himself\.”.*“Noted\.”/);
  // No word from the story's hand-off on how the time went: the evening says it.
  assert.match(lines[1]!.text, /lamplighters/);
  assert.match(lines[2]!.text, /“The Drowned Rat, then\.” She points her pencil south-west/);
  assert.ok(lines.every(l => l.kind === "narration" || (l.speaker === "kell" && l.name === "Sergeant Kell")));
});

test("with nothing in the notebook and nowhere to point, Kell still says where next", () => {
  const lines = talkBetween({ id: "kell", name: "Sergeant Kell" }, { notebook: [], lead: "A runner finds you with a message.", next: { id: "kings-morning", title: "The King's Morning" }, time: "next-morning" });
  assert.deepEqual(lines.map(l => l.kind), ["narration", "dialogue"]);
  assert.equal(lines[0]!.text, "A runner finds you with a message.");
  assert.match(lines[1]!.text, /“The King's Morning, then\.” She writes it down\./);
});

test("someone else walking with the player just says it", () => {
  const lines = talkBetween({ id: "hep", name: "Hep" }, { notebook: ["We have the true book."], next: { id: "heron-warehouse", title: "The Heron Warehouse" }, where: "the Heron", pointing: "east", time: "night" });
  assert.match(lines[0]!.text, /“So,” says Hep\. “We have the true book\.”/);
  assert.match(lines.at(-1)!.text, /“The Heron Warehouse next: the Heron\.” Hep points east\./);
});
