import assert from "node:assert/strict";
import { test } from "node:test";
import type { SceneView } from "../../client/scene/view.ts";
import { entriesOf, entryText, mergeEntries, turnsOf, turnsTaken, turnText, type Entry } from "./record.ts";

const KELL_LINE = "Kell looks up. “You’re the King’s man?” She snaps the notebook shut.";

/** A scene's view as the client makes it, with what the record reads of it. */
function view(entries: SceneView["entries"], present = [{ key: "kell", name: "Sergeant Agnes Kell" }, { key: "cob", name: "the boy in the too-big boots" }]): SceneView {
  return { title: "The Hanged Clerk", game: "1", player: { name: "Nell Quickfingers" }, present, entries, phase: "done", mayType: true, over: false, suggestions: [], suggestionsComing: false, suggestionsOn: false };
}

test("the entries as the player saw them: each spoken line's speaker by the name the player knows them by, their own words by their name, someone no one can place", () => {
  const start = KELL_LINE.indexOf("“");
  const entries = entriesOf(view([
    { turn: 0, speaker: "gm", kind: "narration", text: KELL_LINE, markup: { speech: [{ start, end: start + 23, speaker: "kell" }] } },
    { turn: 1, speaker: "player:1", kind: "player", text: "Who found him?" },
    { turn: 1, speaker: "dice", kind: "roll", text: "Insight check, DC 12: d20 14 + 1 = 15. A success." },
    { turn: 1, speaker: "gm", kind: "narration", text: "“Mine!” “Yours?” “Ours.”", markup: { speech: [{ start: 0, end: 7, speaker: "cob" }, { start: 8, end: 16, speaker: "you" }, { start: 17, end: 24, tag: "a porter" }] } },
    { turn: 1, speaker: "moll", kind: "dialogue", name: "the girl in the shawl", text: "Sod off." },
  ]));

  assert.deepEqual(entries[0], { turn: 0, kind: "narration", text: KELL_LINE, speech: [{ start, end: start + 23, who: "Sergeant Agnes Kell" }] });
  assert.deepEqual(entries[3]!.speech!.map(s => s.who), ["the boy in the too-big boots", "Nell Quickfingers", "a porter"]);
  assert.equal(entries[4]!.who, "the girl in the shawl");

  assert.equal(entryText(entries[0]!), "Kell looks up. Sergeant Agnes Kell: “You’re the King’s man?” She snaps the notebook shut.");
  assert.equal(entryText(entries[1]!), "> Who found him?");
  assert.equal(entryText(entries[2]!), "🎲 Insight check, DC 12: d20 14 + 1 = 15. A success.");
  assert.equal(entryText(entries[3]!), "the boy in the too-big boots: “Mine!” Nell Quickfingers: “Yours?” a porter: “Ours.”");
  assert.equal(entryText(entries[4]!), "the girl in the shawl: Sod off.");
  assert.equal(entryText({ turn: 2, kind: "system", text: "Scene ends: Murder by persons unknown" }), "— Scene ends: Murder by persons unknown —");
});

test("by turn: the opening, then each line and what answered it; the reply alone leaves the player's line out", () => {
  const entries: Entry[] = [
    { turn: 0, kind: "narration", text: "The yard." },
    { turn: 1, kind: "player", text: "Hello." },
    { turn: 1, kind: "narration", text: "Nobody answers." },
    { turn: 2, kind: "player", text: "Again." },
  ];
  assert.deepEqual(turnsOf(entries).map(([n, es]) => [n, es.length]), [[0, 1], [1, 2], [2, 1]]);
  assert.equal(turnText(turnsOf(entries)[1]![1]), "> Hello.\n\nNobody answers.");
  assert.equal(turnText(turnsOf(entries)[1]![1], { player: false }), "Nobody answers.");
  assert.equal(turnsTaken({ entries }), 2);
});

test("kept up to date: what was recorded stays as the player knew it then (a name heard later doesn't rewrite it); new entries are added", () => {
  const kept: Entry[] = [{ turn: 0, kind: "narration", text: "“Hm.”", speech: [{ start: 0, end: 5, who: "the boy in the too-big boots" }] }];
  const seen: Entry[] = [{ turn: 0, kind: "narration", text: "“Hm.”", speech: [{ start: 0, end: 5, who: "Cob" }] }, { turn: 1, kind: "player", text: "Cob?" }];
  const merged = mergeEntries(kept, seen);
  assert.equal(merged[0]!.speech![0]!.who, "the boy in the too-big boots");
  assert.equal(merged[1]!.text, "Cob?");
  assert.equal(mergeEntries(seen, kept), seen, "nothing new: as it was");
});
