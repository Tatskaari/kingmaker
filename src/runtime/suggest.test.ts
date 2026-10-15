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
type Decider = import("../llm/decide.ts").Decider;

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

test("the lines are read as typed: a kind and a colon, speech plain, a deed in round brackets, however the model dresses them; a preface is passed over, and the list ends where the model starts thinking aloud", () => {
  const lines = parseSuggestions([
    "Here are a few lines Tamsin might try:",
    "- say: \"Sergeant, who found him?\"",
    "2. **do:** [I look up at the hoist]",
    "try: I try to talk the boy down off his high horse.",
    "do: (I try to read the girl's face)",
    "*leave*: *I head for the gate*",
    "",
    "(I count the pigeons)",
    " #+#+#+#+",
    "Replace labels, no numbering. Need ensure say lines character voice.",
    "say: Lines after that aren't the list's.",
  ].join("\n"));
  assert.deepEqual(lines, [
    { kind: "say", text: "Sergeant, who found him?" },
    { kind: "do", text: "(I look up at the hoist)" },
    { kind: "try", text: "(I try to talk the boy down off his high horse)" },
    { kind: "try", text: "(I try to read the girl's face)" },
    { kind: "leave", text: "(I head for the gate)" },
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

test("no repeats: not what the player has just said, not a line offered last time (in other words too), not the same line twice", () => {
  const { lines, dropped } = vet(parseSuggestions([
    "say: Sergeant, who found him?",
    "say: Who found him, Sergeant? Who exactly?",
    "say: You called it no suicide. What would you need to write instead?",
    "do: (I look up at the hanged man for a while)",
    "do: (I look up at the hanged man)",
    "try: (I try to coax the boy down from his stones)",
    "say: What did the porters see?",
    "do: (I look down)",
  ].join("\n")), vetted({ said: ["(I look up at the hanged man)"], offered: ["Who found him, Sergeant?", "You haven't called it suicide. What would you need to write otherwise?", "(I look up)"] }));
  assert.deepEqual(lines.map(l => l.text), ["What did the porters see?", "(I look down)", "(I try to coax the boy down from his stones)"]);
  assert.deepEqual(dropped.map(d => d.why), ["offered last time", "offered last time", "offered last time", "just said", "just said"]);
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
  // The judge (the session's decider, given every fact): a line that takes a hidden thing for granted
  // in words of its own (the boots are the dead man's) goes; a "risky try" that's only talk is a deed.
  let judged: { facts: Record<string, string>; questions: Record<string, { instructions: string; criteria: Record<string, string> }> } | undefined;
  const decider: Decider = {
    name: "stub",
    decide: async (facts, questions) => {
      judged = { facts: facts as Record<string, string>, questions };
      const answer = (id: string, q: { instructions: string }) => id.startsWith("roll_") ? (/ask him nicely/.test(q.instructions) ? "safe" : "risky")
        : /dead man's boots/.test(q.instructions) ? "gives_away" : "fine";
      return { answers: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, { choice: answer(id, q), probabilities: { [answer(id, q)]: 0.9 } }])), latencyMs: 1, costUsd: 0.0002, decider: "stub" };
    },
  };
  const made = await propose(state, {
    decider,
    ask: async request => {
      asked = request;
      return { costUsd: 0.0001, latencyMs: 1, text: [
        "say: Sergeant, who found him?",
        "say: Moll, who paid you to say he jumped?",
        "say: Was it the man they call Silvertop?",
        "say: Lovely morning for it.",
        "say: Nice of you to wear the dead man's boots, boy.",
        "do: (I look for a docker's knot on the hoist rope)",
        "do: (I send a runner for the watch surgeon)",
        "do: (I look over the boy's boots)",
        "try: (I try to hold a séance for Prout)",
        "try: (I try to ask him nicely where he got them)",
        "try: (I try to talk the boy round with a hot pie)",
      ].join("\n") };
    },
  });
  // Nothing secret: no name the player hasn't heard, no name or clue only the prep has, nothing that gives away what's hidden; nothing the scene can't offer; nothing offered again.
  assert.deepEqual(made.lines.map(l => `${l.kind}: ${l.text}`), ["say: Sergeant, who found him?", "do: (I look over the boy's boots)", "do: (I try to ask him nicely where he got them)", "try: (I try to talk the boy round with a hot pie)"]);
  assert.deepEqual(Object.fromEntries(made.dropped.map(d => [d.text, d.why])), {
    "Moll, who paid you to say he jumped?": "a name not heard: Moll",
    "Was it the man they call Silvertop?": "a name or place not met: silvertop",
    "Lovely morning for it.": "offered last time",
    "Nice of you to wear the dead man's boots, boy.": "the judge: gives away what's hidden",
    "(I look for a docker's knot on the hoist rope)": "hidden: docker",
    "(I send a runner for the watch surgeon)": "the scene can't offer it: surgeon",
    "(I try to hold a séance for Prout)": "the scene can't offer it: séanc",
  });
  assert.ok(Math.abs(made.costUsd - 0.0003) < 1e-12, "the call's and the judge's");
  // The judge was given every fact: what the player knows, what's hidden from them, what the scene can't offer.
  assert.match(judged!.facts.what_the_player_knows!, /A stone clangs off the hoist hook/);
  assert.match(judged!.facts.hidden_from_the_player!, /The boots are Prout's/);
  assert.match(judged!.facts.what_the_scene_cannot_offer!, /a séance/);
  assert.deepEqual(Object.keys(judged!.questions), ["line_1", "line_2", "line_3", "line_4", "roll_4", "line_5", "roll_5"]);
  // What it was given: the standing instructions, the player's view first, the prep behind the screen, the limits, and what's not to come again.
  assert.match(asked!.instructions!, /^You suggest what the player might say or do next/);
  assert.doesNotMatch(asked!.instructions!, /`/, "no backticks: in Luna's instructions they cost seconds before the first word");
  const brief = asked!.input[0]!.content;
  assert.ok(brief.indexOf("# What the player knows") < brief.indexOf("# Behind the screen"));
  assert.match(brief, /the boy in the too-big boots \(the player hasn't heard their name: call them that\)/);
  assert.doesNotMatch(brief, /\bCob\b|\bMoll\b/, "anyone not yet named goes by what the player calls them, even in the prep");
  for (const limit of sceneById("hanged-clerk").limits!) assert.ok(brief.includes(limitHead(limit)), limit);
  assert.match(brief, /# Not again\nOffered last time \(none of these again, not even in other words: the player has seen them\):\n- Lovely morning for it\./);
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

test("what the player has found out is settled, as a companion's told stories are: in the brief to act on, not to ask after, and no longer hidden", async () => {
  const state = yard("suggest-found");
  state.landed = ["page"];
  state.established = ["Prout didn't hang himself: what has been found shows he was killed and then hoisted up to look like a suicide."];
  let brief = "";
  const made = await propose(state, {
    decider: { name: "stub", decide: async (_facts, questions) => ({ answers: Object.fromEntries(Object.keys(questions).map(id => [id, { choice: id.startsWith("roll_") ? "risky" : "fine", probabilities: {} }])), latencyMs: 1, costUsd: 0, decider: "stub" }) },
    ask: async request => { brief = request.input[0]!.content; return { costUsd: 0, latencyMs: 1, text: "say: Sergeant, the wagons were countersigned. By whom, though?\ndo: (I read the page again)" }; },
  });
  assert.match(brief, /## What they've found out here \(settled: no line asks after it again, though one may act on it\)\n- Prout didn't hang himself[\s\S]*- Prout found grain written off as 'lost to goblins'/);
  assert.deepEqual(made.lines.map(l => l.text), ["Sergeant, the wagons were countersigned. By whom, though?", "(I read the page again)"], "a word of what's been found isn't hidden any more (countersigned)");
});

test("the GM's markup never reaches the lines: the call is given a marked reply as the player reads it, and a line that comes back marked up isn't offered", async () => {
  const state = yard("suggest-markup");
  state.turn = 1;
  state.transcript.push({ turn: 1, scene: "hanged-clerk", speaker: "player", kind: "player", text: "Was it you who found him, Sergeant?" });
  // A reply as the transcript keeps it: the words the player reads, and its markup beside them (who says each line, a why on a phrase).
  const text = "Kell's pencil stops. “Not you,” she says. “Out.”";
  const first = text.indexOf("“Not"), firstEnd = text.indexOf("”", first) + 1, second = text.indexOf("“Out");
  state.transcript.push({ turn: 1, scene: "hanged-clerk", speaker: "gm", kind: "narration", text, marked: {
    speech: [{ start: first, end: firstEnd, speaker: "kell", tag: "Kell" }, { start: second, end: text.length, speaker: "kell", tag: "Kell" }],
    marks: [{ start: first + 1, end: firstEnd - 2, kind: "why", note: "You called her a liar in front of the boy." }],
  } });
  const decider: Decider = { name: "stub", decide: async (_facts, questions) => ({ answers: Object.fromEntries(Object.keys(questions).map(id => [id, { choice: id.startsWith("roll_") ? "risky" : "fine", probabilities: {} }])), latencyMs: 1, costUsd: 0, decider: "stub" }) };
  let brief = "";
  const made = await propose(state, {
    decider,
    ask: async request => {
      brief = request.input[0]!.content;
      return { costUsd: 0, latencyMs: 1, text: [
        "say: [you] “Who found him, then?”",
        "say: “Fair enough.”[why: She's the watch.]",
        "say: [Kell] “Out.”",
        "do: (I step back from (the hoist)[know: The granary's sack hoist.])",
        "do: (I look up at the body)",
        "try: (I try to talk the boy down with a pie)",
      ].join("\n") };
    },
  });
  assert.ok(brief.includes(text), "the reply's words, as the player reads them");
  assert.doesNotMatch(brief, /\[(?:Kell|you)\]|\[(?:why|know|you):|You called her a liar/, "none of the GM's markup, nor its notes");
  assert.deepEqual(made.lines.map(l => l.text), ["(I look up at the body)", "(I try to talk the boy down with a pie)"]);
  assert.deepEqual(made.dropped.filter(d => d.why === "the GM's markup").length, 4);
  assert.ok(made.lines.every(l => !/[[\]]/.test(l.text)));
});

test("a reply cut short loses its last line, which may be half a line", async () => {
  const decider: Decider = { name: "stub", decide: async (_facts, questions) => ({ answers: Object.fromEntries(Object.keys(questions).map(id => [id, { choice: id.startsWith("roll_") ? "risky" : "fine", probabilities: {} }])), latencyMs: 1, costUsd: 0, decider: "stub" }) };
  const made = await propose(yard("suggest-cut"), {
    decider,
    ask: async () => ({ costUsd: 0.0001, latencyMs: 1, cutShort: true, text: "say: Sergeant, who found him?\ndo: (I look up at the body)\ntry: (I try to coax the boy down with a pie)\nsay: And what did the por" }),
  });
  assert.deepEqual(made.lines.map(l => l.text), ["Sergeant, who found him?", "(I look up at the body)", "(I try to coax the boy down with a pie)"]);
});

test("the model's noise is cleaned from the lines, as the testers' own replies had it: two lines run together, other scripts, stray tokens, its own planning (goals#60, thief#10, barbarian#51, robust#88)", () => {
  const read = (text: string, cutShort = true) => parseSuggestions(text, { cutShort }).map(l => `${l.kind}: ${l.text}`);
  // The thief's T11 and T12: "…then leave.)♀♀♀♀)" and "…and leave.) pangsay: Sergeant, …" on screen.
  assert.deepEqual(read("try: (I try to read the girl's guardedness, using Insight to find what she's protecting.)\nleave: (I ask Kell to record the murder by persons unknown, then leave.)♀♀♀♀\n、】【finalCHANTABILITY\nsay: Sergeant, put the witness's account in your book, not my pocket.\nsay: I won't make you regret it. What did the"),
    ["try: (I try to read the girl's guardedness, using Insight to find what she's protecting.)", "leave: (I ask Kell to record the murder by persons unknown, then leave.)"]);
  assert.deepEqual(read("try: (I try to frighten Cob into talking, risking Kell’s record and Moll’s trust.)\nleave: (I ask Kell to file Prout’s murder by persons unknown and leave.) pangsay: Sergeant, what would you need before you wrote Sallow’s name?\nsay: Moll, what makes you think that gentleman will come back?\ndo: (I ask Kell to"),
    ["try: (I try to frighten Cob into talking, risking Kell’s record and Moll’s trust.)", "leave: (I ask Kell to file Prout’s murder by persons unknown and leave.)", "say: Sergeant, what would you need before you wrote Sallow’s name?", "say: Moll, what makes you think that gentleman will come back?"]);
  // The barbarian's T11: a line run into the next at "say:", the list said twice.
  assert.deepEqual(read("leave: (I leave the yard with the page; Kell can make her own record.)say: False entries prove theft. They don’t prove who killed Prout.\nsay: You sent him to the palace. Help me put it right here"),
    ["leave: (I leave the yard with the page; Kell can make her own record.)", "say: False entries prove theft. They don’t prove who killed Prout."]);
  // Stuck on after a deed: an ending's title, the model's markers, other scripts; then its planning, which ends the list.
  assert.deepEqual(read("leave: (I leave the wharf before the Master arrives, without the proof) (The barge sails) \nsay: Then let us keep the count honest, Mister Scrope.\nsay: What do the entries say"),
    ["leave: (I leave the wharf before the Master arrives, without the proof)", "say: Then let us keep the count honest, Mister Scrope."]);
  assert.deepEqual(read("try: (I press Kell to swear publicly to what she witnessed, so the King can act today.)(final) Williams\nCleaner, but avoid repeated? No prior offers. \"Where is grain now?\" pulls folio evidence."),
    ["try: (I press Kell to swear publicly to what she witnessed, so the King can act today.)"]);
  assert.deepEqual(read("leave: (I leave the evidence with the King and step aside as the procession forms.) TBC\npart 1 of 2\nThe user wants 4–6 concise lines, one per line, each with kind and colon, and nothing else."),
    ["leave: (I leave the evidence with the King and step aside as the procession forms.)"]);
  assert.deepEqual(read("leave: (I release Hobb and let him disappear into the dark.)oai સપfinal өҫ\nsay: Kell, write down what he’s already told you."),
    ["leave: (I release Hobb and let him disappear into the dark.)"]);
  assert.deepEqual(read("do: (I keep my hands visible and give the girl room to speak.)\ntry: (I try to read the girl’s certainty from her face, risking her shut mouth if I’m wrong.)娱乐登录\ntry: (I try to win Cob over with a quiet bargain for a look inside one boot.) \nly\n-cmpr\nThe user requires 4-6 lines only, each starting kind colon; above malformed artifact. Need six proper options."),
    ["do: (I keep my hands visible and give the girl room to speak.)", "try: (I try to read the girl’s certainty from her face, risking her shut mouth if I’m wrong.)", "try: (I try to win Cob over with a quiet bargain for a look inside one boot.)"]);
  assert.deepEqual(read("leave: (I leave the yard and trust Kell to stand by her record.) 二四六\n \u{5ffff}\n \nThere is an issue: user asked nothing else four to six lines.", false), ["leave: (I leave the yard and trust Kell to stand by her record.)"]);
  assert.deepEqual(read("leave: (I ask Kell to record murder by persons unknown and close the inquiry.)RGCTX\nไม่ต้องฝาก}\n</assistantileswisay: Your boots stay yours, Cob. I gave my word.", false), ["leave: (I ask Kell to record murder by persons unknown and close the inquiry.)"]);
  // Speech keeps what's said, and loses a bracket or a word of noise stuck on after it.
  assert.deepEqual(read("say: Is the body still on the hook? eject\nsay: Who found him?)\nsay: Lovely morning, Sergeant. Isn't it?", false), ["say: Is the body still on the hook?", "say: Who found him?", "say: Lovely morning, Sergeant. Isn't it?"]);
  // Nothing on screen is noise.
  for (const l of parseSuggestions("say: Sergeant, a word.\ndo: (I look up at the hoist.) ♀♀\ntry: (I try to climb the water butt.) ★ System 1: I'm concerned")) assert.match(l.text, /^[\p{Script=Latin}0-9\s.,;:!?'"‘’“”()\-–—…]+$/u);
});
