import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.KM_RUNS_DIR = mkdtempSync(join(tmpdir(), "km-suggest-"));
process.env.KM_COST_LEDGER = join(process.env.KM_RUNS_DIR, "cost-ledger.jsonl");
// A key shaped like OpenRouter's, so the game thinks it has a model: the fake below answers in its place.
process.env.OPENROUTER_API_KEY = "sk-or-v1-suggest-test";
const { sceneById } = await import("../../scenes/index.ts");
const { fakeOpenRouter } = await import("../llm/fake-openrouter.ts");
const { currentSuggestions, limitHead, parseSuggestions, propose, startSuggesting, stopSuggesting, suggested, suggesting, vet } = await import("./suggest.ts");
type SessionState = import("./session.ts").SessionState;
type Vetting = import("./suggest.ts").Vetting;

/**
 * What a scene suggests the player might say or do next (src/runtime/suggest.ts), with a stand-in for
 * the model: how the lines are read, what's dropped and why (someone else's words, a name not heard,
 * what's hidden, what the scene can't offer, what was just said or offered), the mix of kinds, what
 * the call is given, and how the lines land in the session (for their scene and turn only).
 */

const OPENING = "The yard behind the King's Granary smells of wet grain and pigeons. High on the back wall, above a shut loft door, Wendell Prout turns slowly on the sack hoist, darned stockings and no boots. Beneath him a scrawny boy in enormous black boots lobs gutter stones at the body, and a sharp-faced girl on the wall top swears at everyone in two languages.\n\nA woman in a rain cape steps away from the gate, notebook open. \"Sergeant Kell. Watch. The Captain says suicide.\" A stone clangs off the hoist hook.";

/** The granary yard just after its opening: nobody's name heard but Kell's. */
function yard(id: string): SessionState {
  return {
    id, sceneId: "hanged-clerk", approach: "v2", seed: 3, rollCount: 0, turn: 0,
    player: { name: "Tamsin Vell", concept: "a disgraced palace auditor with a sharp tongue", modifiers: { insight: 5, investigation: 5, stealth: 3, persuasion: 1 } },
    beat: "yard", turnsInBeat: 0, path: [], established: [], canon: [], notes: null, notesTurn: null, patches: [], repairs: [], history: [], metrics: [],
    transcript: [{ turn: 0, scene: "hanged-clerk", speaker: "gm", kind: "narration", text: OPENING }],
  };
}

const vetted = (over: Partial<Vetting> = {}): Vetting => ({ said: [], offered: [], names: [], hidden: [], proper: [], limits: [], leave: false, ...over });

test("the lines are read as typed: a kind and a colon, speech plain, a deed in round brackets, however the model dresses them", () => {
  const lines = parseSuggestions([
    "- say: \"Sergeant, who found him?\"",
    "2. **do:** [I look up at the hoist]",
    "try: I try to talk the boy down off his high horse.",
    "do: (I try to read the girl's face)",
    "*leave*: *I head for the gate*",
    "Leave it out, you two.",
    "(I count the pigeons)",
    "",
  ].join("\n"));
  assert.deepEqual(lines, [
    { kind: "say", text: "Sergeant, who found him?" },
    { kind: "do", text: "(I look up at the hoist)" },
    { kind: "try", text: "(I try to talk the boy down off his high horse)" },
    { kind: "try", text: "(I try to read the girl's face)" },
    { kind: "leave", text: "(I head for the gate)" },
    { kind: "say", text: "Leave it out, you two." },
    { kind: "do", text: "(I count the pigeons)" },
  ]);
});

test("a mix of kinds: two to say at most, a deed, a risky try, and a way out only when one fits, in that order", () => {
  const pile = parseSuggestions([
    "leave: (I leave the yard to the pigeons)",
    "say: Who found him?", "say: Nice boots.", "say: How's the weather on the wall?",
    "try: (I try to slip past the girl to the gate)", "try: (I try to frighten the boy into talking)",
    "do: (I look up at the body)", "do: (I check the gutter)",
  ].join("\n"));
  const young = vet(pile, vetted());
  assert.deepEqual(young.lines.map(l => l.kind), ["say", "say", "do", "try"]);
  assert.deepEqual(young.lines.map(l => l.text), ["Who found him?", "Nice boots.", "(I look up at the body)", "(I try to slip past the girl to the gate)"]);
  assert.ok(young.dropped.some(d => d.text === "(I leave the yard to the pigeons)" && d.why === "no way out yet"));
  const late = vet(pile, vetted({ leave: true }));
  assert.deepEqual(late.lines.map(l => l.kind), ["say", "say", "do", "try", "leave"]);
  // Short of a kind, a spare of another fills in: four lines where there are four to be had.
  const deeds = vet(parseSuggestions("do: (I look up)\ndo: (I look down)\ndo: (I look around)\nsay: Morning."), vetted());
  assert.deepEqual(deeds.lines.map(l => l.text), ["Morning.", "(I look up)", "(I look down)", "(I look around)"]);
});

test("no repeats: not what the player has just said, not a line offered last time, not the same line twice", () => {
  const { lines, dropped } = vet(parseSuggestions([
    "say: Sergeant, who found him?",
    "say: Who found him, Sergeant? Who exactly?",
    "do: (I look up at the hanged man for a while)",
    "do: (I look up at the hanged man)",
    "try: (I try to coax the boy down from his stones)",
    "say: What did the porters see?",
  ].join("\n")), vetted({ said: ["(I look up at the hanged man)"], offered: ["Who found him, Sergeant?"] }));
  assert.deepEqual(lines.map(l => l.text), ["What did the porters see?", "(I try to coax the boy down from his stones)"]);
  assert.deepEqual(dropped.map(d => d.why), ["offered last time", "offered last time", "just said", "just said"]);
});

test("only the player's own words and deeds: no one else's lines, nobody else's doings", () => {
  const { lines, dropped } = vet(parseSuggestions([
    "say: Kell: \"Noted.\"",
    "do: (Kell holds the ladder while I climb)",
    "do: (I hold the ladder while Kell climbs)",
  ].join("\n")), vetted());
  assert.deepEqual(lines.map(l => l.text), ["(I hold the ladder while Kell climbs)"]);
  assert.deepEqual(dropped.map(d => d.why), ["someone else's words", "not the player's own deed"]);
});

test("a limit by what it rules out: the words before its reason", () => {
  assert.equal(limitHead("Prout's own notes and papers: his satchel was found open and empty."), "Prout's own notes and papers");
  assert.equal(limitHead("The watch: there's no watch in the zoo."), "The watch: there's no watch in the zoo.");
});

test("the call is given what the player knows, then the GM's prep behind the screen, and nothing secret in a line gets through", async () => {
  const state = yard("suggest-propose");
  state.suggestions = { scene: "hanged-clerk", turn: 0, lines: [{ kind: "say", text: "Lovely morning for it." }] };
  let asked: { instructions?: string; input: Array<{ content: string }> } | undefined;
  const made = await propose(state, {
    ask: async request => {
      asked = request;
      return { costUsd: 0.0001, latencyMs: 1, text: [
        "say: Sergeant, who found him?",
        "say: Moll, who paid you to say he jumped?",
        "say: Was it the man they call Silvertop?",
        "say: Lovely morning for it.",
        "do: (I look for a docker's knot on the hoist rope)",
        "do: (I send a runner for the watch surgeon)",
        "do: (I look over the boy's boots)",
        "try: (I try to hold a séance for Prout)",
        "try: (I try to talk the boy round with a hot pie)",
      ].join("\n") };
    },
  });
  // Nothing secret: no name the player hasn't heard, no name or clue only the prep has; nothing the scene can't offer; nothing offered again.
  assert.deepEqual(made.lines.map(l => l.text), ["Sergeant, who found him?", "(I look over the boy's boots)", "(I try to talk the boy round with a hot pie)"]);
  assert.deepEqual(Object.fromEntries(made.dropped.map(d => [d.text, d.why])), {
    "Moll, who paid you to say he jumped?": "a name not heard: Moll",
    "Was it the man they call Silvertop?": "a name or place not met: silvertop",
    "Lovely morning for it.": "offered last time",
    "(I look for a docker's knot on the hoist rope)": "hidden: docker",
    "(I send a runner for the watch surgeon)": "the scene can't offer it: surgeon",
    "(I try to hold a séance for Prout)": "the scene can't offer it: séanc",
  });
  // What it was given: the standing instructions, the player's view first, the prep behind the screen, the limits, and what's not to come again.
  assert.match(asked!.instructions!, /^You suggest what the player might say or do next/);
  assert.doesNotMatch(asked!.instructions!, /`/, "no backticks: in Luna's instructions they cost seconds before the first word");
  const brief = asked!.input[0]!.content;
  assert.ok(brief.indexOf("# What the player knows") < brief.indexOf("# Behind the screen"));
  assert.match(brief, /the boy in the too-big boots \(the player hasn't heard their name: call them that\)/);
  assert.doesNotMatch(brief, /\bCob\b|\bMoll\b/, "anyone not yet named goes by what the player calls them, even in the prep");
  for (const limit of sceneById("hanged-clerk").limits!) assert.ok(brief.includes(limitHead(limit)), limit);
  assert.match(brief, /# Not again\nOffered last time:\n- Lovely morning for it\./);
  assert.match(brief, /No leave line yet/);
});

test("the lines land for the scene and turn they were made for, and the hooks say so; a line said meanwhile leaves them behind", async () => {
  const fake = fakeOpenRouter({ suggestions: "say: Sergeant, who found him?\ndo: (I look up at the body)\ntry: (I try to coax the boy down with a pie)" });
  try {
    const state = yard("suggest-land");
    let told = 0;
    startSuggesting(state, { onSuggestions: () => { told++; } });
    assert.ok(suggesting(state));
    assert.deepEqual(currentSuggestions(state), [], "not yet");
    await suggested(state);
    assert.equal(told, 1);
    assert.ok(!suggesting(state));
    assert.deepEqual(currentSuggestions(state).map(s => s.kind), ["say", "do", "try"]);
    assert.equal(state.suggestions?.turn, 0);
    // The next turn has begun: last turn's lines aren't this moment's.
    state.turn++;
    assert.deepEqual(currentSuggestions(state), []);
    // Asked for, then a line said before they come: they're dropped, unannounced.
    startSuggesting(state, { onSuggestions: () => { told++; } });
    state.turn++;
    await suggested(state);
    assert.equal(told, 1);
    assert.equal(state.suggestions?.turn, 0, "the stale ones never landed");
    // Stopped (the scene ended, or they were turned off): nothing lands.
    startSuggesting(state, { onSuggestions: () => { told++; } });
    stopSuggesting(state);
    await new Promise(r => setTimeout(r, 20));
    assert.equal(told, 1);
    assert.ok(!suggesting(state));
    // A talk has its own; a scene that's over has none.
    const asked = fake.asked.length;
    startSuggesting({ ...state, talk: { with: "kell", where: "the lane", waiting: {}, suggestions: [] } });
    startSuggesting({ ...state, ended: { exitId: "walked-away", turn: state.turn, operations: [], warnings: [] } });
    assert.equal(fake.asked.length, asked, "neither asked the model");
  } finally {
    fake.restore();
  }
});
