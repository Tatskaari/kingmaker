import assert from "node:assert/strict";
import { test } from "node:test";
import { clerkEnded, heronFought, LEAD, OPEN_CASE, ratOpening, ratWaiting, storyOf, storyOver, yardOver } from "../check/story.ts";
import type { Line } from "../scene/view.ts";
import { storyViewOf } from "./rows.ts";
import talks from "./talk-between.json" with { type: "json" };
import { betweenOf, epilogueOf, fightOf, questLine, wayOnOf } from "./view.ts";
import { STANDIN, talkBetween } from "./words.ts";

/**
 * The story's views from rows (story-design §4.5): the way on in each of its states, the moment
 * between scenes (Kell's talk, word for word the prototype's talkBetween; the card), the fight's
 * card, the notebook, the quests and The End.
 */

test("Kell's talk is word for word the prototype's talkBetween, for the same inputs (talk-between.json: its output, recorded from src/app/game.ts at 44c6d4a)", () => {
  assert.ok(talks.length >= 4);
  for (const { what, friend, args, lines } of talks) {
    assert.deepEqual(talkBetween(friend, args as Parameters<typeof talkBetween>[1]), lines as Line[], what);
  }
});

test("the story from rows: the lead is the waiting scene, Kell walks with the lead, the notebook has how things stood, the bar tab every turn and boundary", () => {
  const moving = storyOf(clerkEnded());
  assert.equal(moving.onward, "moving");
  assert.equal(moving.lead, undefined, "no waiting scene yet");
  assert.deepEqual(moving.with, [{ key: "kell", name: "Sergeant Agnes Kell" }]);
  assert.deepEqual(moving.notebook, [{ sceneId: "7", title: "The Hanged Clerk", ending: OPEN_CASE.ending, lines: [OPEN_CASE.journal], chapter: true }]);

  const ready = storyOf(ratWaiting("The afternoon goes in statements."));
  assert.equal(ready.onward, undefined);
  assert.deepEqual(ready.lead, { key: "drowned-rat", title: "The Drowned Rat", text: "The afternoon goes in statements." });
  assert.equal(ready.notebook[0]!.stood, "- Prout was murdered, and the watch has it down as persons unknown.\n- Sergeant Kell walks with the investigator.");
  assert.equal(ready.time, "evening");
  assert.equal(ready.spentUsd, 0.024, "three turns at $0.004 and the boundary's $0.012");
  assert.deepEqual(ready.flags, [{ name: "prout_death", value: "murder, unnamed" }]);
  assert.deepEqual(ready.attitudes, [{ who: "Sergeant Agnes Kell", attitude: "friendly", reason: "The King's investigator took the case seriously." }]);
  assert.equal(questLine(ready.quests[0]!), `The Hanged Clerk (active): ${OPEN_CASE.quest}`);

  // A spectator's story is the lead's: Kell walks with the one who has the lead.
  assert.deepEqual(storyViewOf(ratWaiting(), LEAD).with.map(w => w.key), ["kell"]);
  // A boundary waiting on the GM, and one stuck: the note says why.
  const waiting = storyOf({ ...clerkEnded(), game: { ...clerkEnded().game, onward: "waiting", onwardNote: "The GM has lost the thread for a moment: trying again." } });
  assert.deepEqual([waiting.onward, waiting.note], ["waiting", "The GM has lost the thread for a moment: trying again."]);
});

test("the notebook: a scene still being played with the fight's line in it is noted as a fight, after the chapters", () => {
  const story = storyOf(heronFought());
  assert.deepEqual(story.notebook.map(n => `${n.title}: ${n.ending} (${n.lines.join(" / ")})`), [
    `The Hanged Clerk: ${OPEN_CASE.ending} (${OPEN_CASE.journal})`,
    "The Drowned Rat: What Big Hobb knows (Big Hobb named the Heron Warehouse.)",
    "The Heron Warehouse: A fight (The fight wasn't played: it's told as won.)",
  ]);
  assert.deepEqual(story.notebook.map(n => n.chapter), [true, true, false]);
});

test("the way on: moving, queued, waiting, stuck, on with Kell, on with nobody, a spectator's, a summons, the fight, The End; none while played", () => {
  const shown = yardOver();
  assert.deepEqual(wayOnOf(shown, storyOf(clerkEnded())), { title: OPEN_CASE.ending, go: "Continue, once the story has moved on", ready: false, to: "wait" });
  assert.equal(wayOnOf(shown, storyOf(clerkEnded()), { queued: true })?.go, "Going on as soon as the story's ready");
  const stuck = storyOf({ ...clerkEnded(), game: { ...clerkEnded().game, onward: "failed", onwardNote: "The story got stuck on the way: the AI service refused it." } });
  assert.deepEqual(wayOnOf(shown, stuck), { title: OPEN_CASE.ending, go: "The story got stuck on the way: try again", ready: true, to: "carry_on" });
  assert.deepEqual(wayOnOf(shown, storyOf(ratWaiting())), { title: OPEN_CASE.ending, go: "On, with Sergeant Agnes Kell", ready: true, to: "between" });
  assert.equal(wayOnOf(shown, storyOf({ ...ratWaiting(), followers: [] }))?.go, "Go on");

  // A spectator: the lead goes on; once their seat has moved on, so can they.
  const watching = yardOver(ratWaiting(), { watching: "Pell Marrow" });
  assert.deepEqual(wayOnOf(watching, watching.story), { title: OPEN_CASE.ending, go: "Watching: Pell Marrow goes on when ready", ready: false, to: "wait" });
  assert.deepEqual(wayOnOf(watching, watching.story, { next: { title: "The Drowned Rat" } }), { title: OPEN_CASE.ending, go: "On to The Drowned Rat", ready: true, to: "next" });
  // A summons: the next scene has come for the player while the last is on screen.
  assert.deepEqual(wayOnOf(shown, storyOf(ratWaiting()), { next: { title: "The King's Morning" } }), { title: OPEN_CASE.ending, go: "On to The King's Morning", ready: true, to: "next" });

  // The fight: in red, before any ending; a spectator's waits for the lead.
  const fighting = { ...yardOver(heronFought()), over: false, fighting: true };
  assert.deepEqual(wayOnOf(fighting, fighting.story), { title: "Roll for initiative!", go: "To the fight", ready: true, to: "fight", fight: true });
  assert.deepEqual(wayOnOf({ ...fighting, watching: "Pell Marrow" }, fighting.story), { title: "Roll for initiative!", go: "Watching: Pell Marrow goes on when ready", ready: false, to: "wait", fight: true });

  assert.deepEqual(wayOnOf(shown, storyOf(storyOver())), { title: OPEN_CASE.ending, go: "The End", ready: true, to: "end" });
  assert.equal(wayOnOf({ ...shown, over: false }, storyOf(ratWaiting())), undefined, "played");
  assert.equal(wayOnOf(shown, undefined), undefined, "no story yet");
});

test("between: Kell's talk (her three lines), the card, the button; no way to draw, so she writes it down", () => {
  const between = betweenOf(storyOf(ratWaiting()), "7")!;
  assert.equal(between.title, "Evening, on the eve of the Assembly");
  assert.equal(between.with, "Sergeant Agnes Kell");
  assert.equal(between.go, "On to The Drowned Rat");
  assert.deepEqual(between.talk!.map(l => l.text), [
    `“For the record.” She reads the entry back to you, in the words of the record: “${OPEN_CASE.journal}” She looks at it a moment longer. “Noted.”`,
    "The afternoon goes in paperwork. By the time it’s done, the lamplighters are out along the quay.",
    "“The Drowned Rat, then.” She writes it down. “I’ll walk with you: somebody has to write it down.”",
  ]);
  assert.deepEqual(between.card, ["Your notebook:", OPEN_CASE.journal, "", "The lead: The Drowned Rat.", "", "Press Enter to go on."]);

  // The boundary's own words for the lead, in the talk and on the card; with nobody walking with them, only the card.
  const told = betweenOf(storyOf({ ...ratWaiting("Dusk finds you on the river stairs."), followers: [] }), "7")!;
  assert.equal(told.talk, undefined);
  assert.deepEqual(told.card.slice(3, 5), ["Dusk finds you on the river stairs.", ""]);
  assert.equal(betweenOf(storyOf(clerkEnded()), "7"), undefined, "no lead yet");
});

test("the fight's card: the stand-in's word on itself and Fight it out; once fought, how it went and back to the scene", () => {
  assert.deepEqual(fightOf(false), { title: "Roll for initiative!", lines: [STANDIN.observe], go: "Fight it out", hint: "the stand-in resolves it, as won", done: false });
  assert.deepEqual(fightOf(true).lines, [STANDIN.act]);
  assert.equal(fightOf(true).go, "See what comes of it");
});

test("The End: the closing is the last narration, each chapter with its notebook lines, and the GM's bar tab", () => {
  const shown = yardOver(storyOver(), { title: "The King's Morning", sceneId: "11" });
  const end = epilogueOf(shown, shown.story!);
  assert.equal(end.who, "Pell Marrow");
  assert.match(end.closing, /^Kell's pencil stops/, "the last narration on screen");
  assert.deepEqual(end.chapters.map(c => `${c.title}: ${c.ending}`), ["The Hanged Clerk: Murder by persons unknown", "The Drowned Rat: What Big Hobb knows", "The Heron Warehouse: Caught in the act", "The King's Morning: Done right by"]);
  assert.deepEqual(end.chapters[2]!.lines, ["The fight wasn't played: it's told as won."]);
  assert.equal(end.tab, "The GM's bar tab this sitting: $0.05. The King has graciously declined to pay it.");
  // A scene the rows have no chapter for yet ends the list with its own ending; nothing said, the prototype's closing.
  const bare = epilogueOf({ ...ratOpening(), entries: [{ turn: 1, speaker: "system", kind: "system", text: "Scene ends: What Big Hobb knows" }] }, storyOf(ratWaiting()));
  assert.equal(bare.closing, "And that, as they say in Caerwyn, was that.");
  assert.deepEqual(bare.chapters.map(c => c.ending), ["Murder by persons unknown", "What Big Hobb knows"]);
});
