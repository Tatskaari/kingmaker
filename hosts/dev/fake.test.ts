import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATEGORIES } from "../../ai/docs/reviews.ts";
import { devFake, fakeOptions, onTop, quietGm, wholeStory } from "./fake.ts";

const file = JSON.parse(readFileSync(join(import.meta.dirname, "fake.json"), "utf8"));
const fake = devFake();

test("the dev host's fake is fake.json's options: four replies with no notes in them, twelve lines, the delays", () => {
  const { about, ...options } = file;

  assert.match(about, /^What npm run dev -- --fake plays/);
  assert.deepEqual(fake, options);
  assert.equal(fake.replies!.length, 4);
  assert.match(fake.replies![0]!, /^Behind the King’s Granary/);
  assert.ok(fake.replies!.every(r => !/\[(?:why|know|you):/.test(r)), "the notes on marked words went in M2");
  assert.equal((fake.byName as Record<string, unknown>).notes, undefined);
  assert.deepEqual(String(fake.suggestions).split("\n").map(l => l.split(":")[0]), ["say", "say", "do", "try", "say", "say", "do", "try", "leave", "say", "say", "say"]);
  assert.deepEqual([fake.streamMs, fake.byNameDelayMs, fake.suggestDelayMs], [2000, undefined, 800]);
});

test("--fake plays fake.json's options, KM_AI_FAKE's on top, and says so when KM_AI_FAKE isn't JSON", () => {
  assert.deepEqual(fakeOptions(undefined), fake);
  assert.deepEqual(fakeOptions("{}"), fake);
  assert.deepEqual(fakeOptions('{"streamMs":0,"suggestions":""}'), { ...fake, streamMs: 0, suggestions: "" });
  assert.throws(() => fakeOptions("{ streamMs: 0"), /^Error: KM_AI_FAKE isn't JSON: \{ streamMs: 0$/);
});

test("KM_AI_FAKE's answers, delays and choices by name go beside fake.json's: creation's answers keep the others', a choice keeps the quiet defaults", () => {
  const options = fakeOptions('{"byName":{"draft_backstory":{"backstory":"I kept the palace books."}},"byNameDelayMs":{"world_ops":12000},"choices":{"attempt":"examine-body","seen":"not_flagged"},"toolCalls":{"search_lore":[]}}');

  assert.deepEqual(Object.keys(options.byName!).sort(), ["draft_backstory", "gm_notes", "looks", "talk"]);
  assert.deepEqual(options.byName!.looks, fake.byName!.looks);
  assert.deepEqual(options.byNameDelayMs, { world_ops: 12000 });
  assert.deepEqual(options.choices, { ...fake.choices, attempt: "examine-body", seen: "not_flagged" });
  assert.deepEqual(Object.keys((options as { toolCalls?: object }).toolCalls ?? {}), ["search_lore"]);
  assert.deepEqual(options.replies, fake.replies);
});

test("the full GM's quiet defaults (full-gm-design §4.4): only seen flagged, and a line in Kell's notes", () => {
  // Every attention category (ai/docs/reviews.ts) has a choice, and only seen is flagged.
  const attention = Object.fromEntries(Object.entries(fake.choices!).filter(([k]) => !k.startsWith("react_")));
  assert.deepEqual(Object.keys(attention).sort(), Object.keys(CATEGORIES).sort());
  assert.deepEqual(Object.entries(attention).filter(([, c]) => c === "flagged").map(([k]) => k), ["seen"]);
  const notes = fake.byName!.gm_notes as { updates: Array<Record<string, string>>; summary: string };
  assert.deepEqual(notes.updates.map(u => [u.characterId, u.section, u.replaces]), [["kell", "seen", ""]]);
  assert.ok(notes.updates.every(u => u.line?.trim()) && notes.summary.trim());
  assert.equal((fake as { toolCalls?: unknown }).toolCalls, undefined, "no tool loop's calls: the lore agent answers as a reply does");
  assert.deepEqual([fake.byName!.ruling, fake.byName!.co_gm_notes], [undefined, undefined], "no ruling and no old co-GM: they went with the old pipeline");
});

test("a test's recipe on the quiet full GM: its choices beside the attention filter's, its own replies and answers on top", () => {
  const quiet = quietGm();
  const options = onTop(quiet, { replies: ["Kell nods."], choices: { outcome: "make-case" }, byName: { world_ops: { ops: [] } } });

  assert.deepEqual(Object.keys(quiet).sort(), ["byName", "choices", "coGm"]);
  assert.deepEqual(quiet.coGm, { still: true }, "the two-part co-GM kept still");
  assert.deepEqual(options.replies, ["Kell nods."]);
  assert.deepEqual(options.choices, { ...fake.choices, outcome: "make-case" });
  assert.deepEqual(options.byName, { gm_notes: fake.byName!.gm_notes, world_ops: { ops: [] } });
});

test("a choice that's a list goes in as it is, beside the quiet ones (the old pipeline's whole story's recipe, story-design §1.1)", () => {
  const options = fakeOptions('{"choices":{"ending":["open-case","hobb-talks","fight","caught-in-the-act","justice"],"own_exit":"theirs"}}');

  assert.deepEqual(options.choices, { ...fake.choices, ending: ["open-case", "hobb-talks", "fight", "caught-in-the-act", "justice"], own_exit: "theirs" });
});

test("the whole story's recipe on the two-part GM: its co-GM walks each scene to the first of its endings; the page's ?fake=arc plays what README.md gives KM_AI_FAKE", () => {
  const options = fakeOptions('{"coGm":{"endings":["murder-unknown","hobb-talks","proof-taken","justice"]}}');

  assert.deepEqual(onTop(devFake(), wholeStory()), options);
  assert.deepEqual(options.coGm, { endings: ["murder-unknown", "hobb-talks", "proof-taken", "justice"] });
  assert.equal(fake.coGm, undefined, "fake.json's own co-GM walks to each scene's first good ending");
});

test("the world bridge's quiet reactions (world-bridge-design §1.4): in the granary yard nobody fights the player's violence", () => {
  const reactions = Object.fromEntries(Object.entries(fake.choices!).filter(([k]) => k.startsWith("react_")));

  assert.deepEqual(reactions, { react_kell: "intervene", react_cob: "cower", react_moll: "cower", react_tull: "unmoved" });
});

test("the town's answers (town-design §3.6-3.7): Kell's talk opens ready to tell the door at the Rat, with lines of its own, and a swan gets a look", () => {
  const talk = fake.byName!.talk as { note: string; topic: string; ready: string; willing: string; suggestions: string[] };
  assert.deepEqual([talk.note, talk.topic, talk.ready, talk.willing], ["Cast/Sergeant Agnes Kell/knowledge/Nan Quill.md", "the door at the Drowned Rat", "when_asked", "yes"]);
  assert.equal(talk.suggestions.length, 3);
  // A talk's lines are plain, apart from a scene's (which have their kinds).
  const lines = String(fake.talkSuggestions).split("\n");
  assert.equal(lines.length, 4);
  assert.ok(lines.every(l => !/^(say|do|try|leave):/.test(l) && !/[[\]]/.test(l)));
  const looks = (fake.byName!.looks as { looks: Array<{ key: string; glyph: string; letter: string; color: string; being: boolean }> }).looks;
  assert.deepEqual(looks.map(l => l.key), ["a disgruntled swan", "disgruntled swan", "swan"]);
  assert.ok(looks.every(l => l.glyph === "letter" && l.letter === "S" && l.color === "white" && l.being));
});
