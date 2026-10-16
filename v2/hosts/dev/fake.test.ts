import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATEGORIES } from "../../ai/docs/reviews.ts";
import { devFake, fakeOptions, onTop, quietGm } from "./fake.ts";

const file = JSON.parse(readFileSync(join(import.meta.dirname, "fake.json"), "utf8"));
const fake = devFake();
const notes = (fake.byName!.notes as { notes: Array<{ on: string; words: string; kind: string; turn: number; lore: string }> }).notes;

test("the dev host's fake is fake.json's options: four replies, the notes' answer, twelve lines, the delays", () => {
  const { about, ...options } = file;

  assert.match(about, /^What npm run dev -- --fake plays/);
  assert.deepEqual(fake, options);
  assert.equal(fake.replies!.length, 4);
  assert.match(fake.replies![0]!, /^Behind the King’s Granary/);
  assert.deepEqual(notes.map(n => n.kind), ["know", "why", "why", "you", "why", "know"]);
  assert.deepEqual(String(fake.suggestions).split("\n").map(l => l.split(":")[0]), ["say", "say", "do", "try", "say", "say", "do", "try", "leave", "say", "say", "say"]);
  assert.deepEqual([fake.streamMs, fake.byNameDelayMs, fake.suggestDelayMs], [2000, { notes: 1500 }, 800]);
});

test("each note is on free words of its own reply, so the same answer gives each reply its own notes", () => {
  const inReplies = (words: string) => fake.replies!.flatMap((r, i) => (r.includes(words) ? [i] : []));

  assert.ok(notes.every(n => n.on === ""));
  assert.deepEqual(Object.fromEntries(notes.map(n => [n.words, inReplies(n.words)])), {
    "King’s Granary": [0],
    "I haven’t written that down.": [0, 1],
    "And Cob don’t talk to bluebottles.": [1],
    "Moll’s smirk thins at your question": [2],
    "The rest is not yet stated.": [2],
    "the Royal Purveyor’s office": [3],
  });
  // A know explains from a lore doc by its id in the notes' brief: the granary yard is the scene's
  // first, and the office's is 18th once Kell, Cob and Moll have been named (the third reply's turn).
  assert.deepEqual(notes.filter(n => n.kind === "know").map(n => n.lore), ["D1", "D18"]);
});

test("--fake plays fake.json's options, KM_AI_FAKE's on top, and says so when KM_AI_FAKE isn't JSON", () => {
  assert.deepEqual(fakeOptions(undefined), fake);
  assert.deepEqual(fakeOptions("{}"), fake);
  assert.deepEqual(fakeOptions('{"streamMs":0,"suggestions":""}'), { ...fake, streamMs: 0, suggestions: "" });
  assert.throws(() => fakeOptions("{ streamMs: 0"), /^Error: KM_AI_FAKE isn't JSON: \{ streamMs: 0$/);
});

test("KM_AI_FAKE's answers, delays and choices by name go beside fake.json's: creation's answers keep the notes', a choice keeps the quiet defaults", () => {
  const options = fakeOptions('{"byName":{"draft_backstory":{"backstory":"I kept the palace books."}},"byNameDelayMs":{"notes":12000},"choices":{"attempt":"examine-body","witnessed":"not_flagged"},"toolCalls":{"search_lore":[]}}');

  assert.deepEqual(Object.keys(options.byName!).sort(), ["co_gm_notes", "draft_backstory", "notes", "ruling"]);
  assert.deepEqual(options.byName!.notes, fake.byName!.notes);
  assert.deepEqual(options.byNameDelayMs, { notes: 12000 });
  assert.deepEqual(options.choices, { ...fake.choices, attempt: "examine-body", witnessed: "not_flagged" });
  assert.deepEqual(Object.keys((options as { toolCalls?: object }).toolCalls ?? {}), ["save_memory", "search_lore"]);
  assert.deepEqual(options.replies, fake.replies);
});

test("the full GM's quiet defaults (full-gm-design §4.4): only witnessed flagged, Kell's one memory, the co-GM on track without moving the tracker, the ruling a contest with Cob at DC 12", () => {
  // Every attention category (ai/docs/reviews.ts) has a choice, and only witnessed is flagged.
  const attention = Object.fromEntries(Object.entries(fake.choices!).filter(([k]) => !k.startsWith("react_")));
  assert.deepEqual(Object.keys(attention).sort(), Object.keys(CATEGORIES).sort());
  assert.deepEqual(Object.entries(attention).filter(([, c]) => c === "flagged").map(([k]) => k), ["witnessed"]);
  const memories = (fake as { toolCalls?: Record<string, Array<{ name: string; args: Record<string, string> }>> }).toolCalls!.save_memory!;
  assert.deepEqual(memories.map(c => [c.name, c.args.characterId, c.args.title]), [["save_memory", "kell", "What the investigator did"]]);
  assert.ok(memories.every(c => ["characterId", "title", "context", "content"].every(k => c.args[k]?.trim())));
  const coGm = fake.byName!.co_gm_notes as Record<string, unknown>;
  assert.deepEqual([coGm.status, coGm.move_to, coGm.add_beat, coGm.add_transitions, coGm.whispers, coGm.canon], ["on_track", null, null, [], [], []]);
  assert.ok(String(coGm.notes).trim());
  const ruling = fake.byName!.ruling as Record<string, unknown>;
  assert.deepEqual([ruling.target, ruling.skill, ruling.stakes, ruling.approach, ruling.disposition, ruling.lie, ruling.same_again], ["cob", "sleight_of_hand", "guarded", "plausible", "wary", false, false]);
  // A contest's DC by the prototype's verdict (src/runtime/consider.ts:157-167): 9 + 3 x (guarded 1 - plausible 0 - wary 0) = 12.
  for (const went of ["success", "failure"] as const) assert.deepEqual((ruling[went] as Record<string, unknown>).to, "stay");
});

test("a test's recipe on the quiet full GM: its choices beside the attention filter's, its own replies and answers on top", () => {
  const quiet = quietGm();
  const options = onTop(quiet, { replies: ["Kell nods."], choices: { outcome: "make-case" }, byName: { ruling: { act: "mine" } } });

  assert.deepEqual(Object.keys(quiet).sort(), ["byName", "choices", "toolCalls"]);
  assert.deepEqual(options.replies, ["Kell nods."]);
  assert.deepEqual(options.choices, { ...fake.choices, outcome: "make-case" });
  assert.deepEqual(options.byName, { co_gm_notes: fake.byName!.co_gm_notes, ruling: { act: "mine" } });
  assert.deepEqual((options as { toolCalls?: unknown }).toolCalls, (fake as { toolCalls?: unknown }).toolCalls);
});

test("the world bridge's quiet reactions (world-bridge-design §1.4): in the granary yard nobody fights the player's violence", () => {
  const reactions = Object.fromEntries(Object.entries(fake.choices!).filter(([k]) => k.startsWith("react_")));

  assert.deepEqual(reactions, { react_kell: "intervene", react_cob: "flee", react_moll: "cower", react_tull: "unmoved" });
});
