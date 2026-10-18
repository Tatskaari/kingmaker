import { test } from "node:test";
import assert from "node:assert/strict";
import { configureDocs } from "./config.ts";
import { readDoc } from "./docs.ts";
import { gmNotes, isNotesPath, LONGEST_LINE, note, notesPath, notesText, readNotes, SECTIONS } from "./notes.ts";
import { memoryVolume } from "./volumes.ts";

/**
 * The GM's notes on a person (notes.ts), on docs in memory: a lore with Kell's entry, and an authored
 * doc where her notes would be (which is never hers), and each game's own copy.
 */

const LORE = new Map<string, string>([
  ["Cast/Kell/private.md", `---\nsummary: "Kell."\nvisibility: "private"\nreaders: ["character:kell"]\ncharacter: "kell"\n---\n# Kell\n\nA sergeant of the watch.`],
  ["Cast/Kell/notes.md", `---\nsummary: "An author's page."\nvisibility: "gm"\n---\n# Kell\n\n## Learned\n- Something the author wrote.`],
]);
const GAMES = new Map<string, Map<string, string>>();
const copyOf = (game: string) => GAMES.get(game) ?? GAMES.set(game, new Map()).get(game)!;
configureDocs({ lore: memoryVolume(LORE), overlay: game => memoryVolume(copyOf(game)) });

const KELL = { id: "kell", name: "Sergeant Agnes Kell" };
const at = { scene: "hanged-clerk", turn: 3 };

test("a person's notes are the game's, beside their lore entry, in five parts; another game's are its own, and the authored doc there is never theirs", () => {
  assert.equal(notesPath("kell"), "Cast/Kell/notes.md");
  assert.equal(notesPath("tull"), "characters/tull/notes.md", "someone with no lore entry");
  assert.equal(gmNotes("g1", "kell"), undefined, "no notes yet: the authored page at the path isn't hers");

  note("g1", KELL, "standing", "Warming: the investigator read the body right and kept Cob's name out of it.", { origin: at });
  note("g1", KELL, "seen", "Pressed a silver crown into Cob's hand and asked nothing for it.", { origin: at });
  note("g1", KELL, "learned", "Prout was killed in the loft and hung after: the cord mark under the rope burn.");
  note("g1", KELL, "promises", "Agreed with the investigator that Cob's name stays out of her notebook.");
  note("g1", KELL, "did", "Wrote the cord mark into the record, word for word.");

  assert.equal(gmNotes("g1", "kell"), [
    "Standing with the player: Warming: the investigator read the body right and kept Cob's name out of it.",
    "Seen the player do:\n- Pressed a silver crown into Cob's hand and asked nothing for it.",
    "Learned:\n- Prout was killed in the loft and hung after: the cord mark under the rope burn.",
    "Promises:\n- Agreed with the investigator that Cob's name stays out of her notebook.",
    "Did:\n- Wrote the cord mark into the record, word for word.",
  ].join("\n"));
  const doc = readDoc("g1", "Cast/Kell/notes.md")!;
  assert.deepEqual([doc.meta.visibility, doc.meta.type, doc.meta.scene, doc.meta.turn], ["gm", "notes", "hanged-clerk", 3], "the GM's, and where it was last brought up to date");
  assert.match(doc.body, /^# Sergeant Agnes Kell: notes from play\n\n## Standing with the player\n- Warming/);
  assert.equal(LORE.get("Cast/Kell/notes.md")!.includes("Something the author wrote."), true, "the authored lore untouched");
  assert.equal(gmNotes("g2", "kell"), undefined, "another game's copy is its own");
  assert.ok(isNotesPath("Cast/Kell/notes.md") && isNotesPath("characters/tull/notes.md") && !isNotesPath("Cast/Kell/private.md") && !isNotesPath("notes.md"));
});

test("an update rewrites a line rather than adding one: named by its words or enough of them; an empty line takes it out; the standing is set, never added to", () => {
  const g = "g-rewrite";
  note(g, KELL, "promises", "The investigator promised Cob his name stays out of the book.");
  note(g, KELL, "promises", "Kell owes the investigator a look at the watch's night book.");
  // Kept: the investigator kept it. Rewritten in place, not a second line beside the first.
  const kept = note(g, KELL, "promises", "The investigator promised Cob his name stays out of the book, and kept it: Kell wrote 'a boy'.", { replaces: "The investigator promised Cob his name stays out of the book." });
  assert.deepEqual([kept.did, kept.was], ["rewrote", "The investigator promised Cob his name stays out of the book."]);
  // Enough of the words to find just that line.
  assert.equal(note(g, KELL, "promises", "Kell showed the investigator the watch's night book.", { replaces: "a look at the watch's night book" }).did, "rewrote");
  assert.deepEqual(readNotes(g, "kell").promises, [
    "The investigator promised Cob his name stays out of the book, and kept it: Kell wrote 'a boy'.",
    "Kell showed the investigator the watch's night book.",
  ]);
  // A line it has is kept as it is; one whose `replaces` isn't there is added; an empty line takes its line out.
  assert.equal(note(g, KELL, "promises", "kell showed the investigator the watch's night book.").did, "kept");
  assert.equal(note(g, KELL, "promises", "Kell promised to read the entry back at the river stairs.", { replaces: "Nothing like this is in her notes at all." }).did, "added");
  assert.deepEqual(note(g, KELL, "promises", "", { replaces: "Kell showed the investigator the watch's night book." }), { did: "removed", line: "", was: "Kell showed the investigator the watch's night book." });
  assert.equal(readNotes(g, "kell").promises.length, 2);

  note(g, KELL, "standing", "Wary: the investigator turned up with a coin and no questions.");
  const set = note(g, KELL, "standing", "Warming: the investigator kept their word to the boy.");
  assert.deepEqual([set.did, set.was, readNotes(g, "kell").standing], ["set", "Wary: the investigator turned up with a coin and no questions.", ["Warming: the investigator kept their word to the boy."]]);
  assert.equal(note(g, KELL, "standing", "Warming: the investigator kept their word to the boy.").did, "kept");
});

test("a part that's full gives up its oldest line for a new one, so the note never grows past its parts' limits; a long line is cut at a word", () => {
  const g = "g-full";
  const most = SECTIONS.find(s => s.key === "seen")!.most;
  const noted = Array.from({ length: most + 2 }, (_, i) => note(g, KELL, "seen", `Saw the investigator do thing number ${i + 1} in the yard.`));
  assert.deepEqual(readNotes(g, "kell").seen, Array.from({ length: most }, (_, i) => `Saw the investigator do thing number ${i + 3} in the yard.`));
  assert.deepEqual(noted.slice(-2).map(n => n.dropped), ["Saw the investigator do thing number 1 in the yard.", "Saw the investigator do thing number 2 in the yard."]);
  const long = note(g, KELL, "did", `Followed the big porter ${"down the lane and ".repeat(40)}to the Rat.`).line;
  assert.ok(long.length <= LONGEST_LINE && long.endsWith("…") && !long.includes("  "), long);
});

test("the review's reading names each part by its key; a person with no notes reads as none", () => {
  const g = "g-keys";
  assert.equal(notesText(readNotes(g, "kell"), { keys: true }), undefined);
  note(g, KELL, "standing", "Friendly: the investigator made Prout's case properly.");
  note(g, KELL, "learned", "Big Hobb Mallory was at the granary that night.");
  assert.equal(notesText(readNotes(g, "kell"), { keys: true }), "standing (Standing with the player): Friendly: the investigator made Prout's case properly.\nlearned (Learned):\n- Big Hobb Mallory was at the granary that night.");
});
