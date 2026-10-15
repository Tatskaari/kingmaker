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
const { effectiveScene } = await import("./brief.ts");
const { buildWorld } = await import("../world/scene-world.ts");
const { currentSuggestions, judge, limitHead, parseSuggestions, propose, screen, startSuggesting, stopSuggesting, suggested, suggesting, suggestionBrief, vet, vetting } = await import("./suggest.ts");
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

test("the call is given what the player knows and none of the prep, and nothing secret in a line gets through (thief#4, wizard#13, barbarian#37)", async () => {
  const state = yard("suggest-propose");
  state.suggestions = { scene: "hanged-clerk", turn: 0, lines: [{ kind: "say", text: "Lovely morning for it." }] };
  let asked: { instructions?: string; input: Array<{ content: string }> } | undefined;
  // The judge (the session's decider, given every fact): a line that takes a held thing for granted
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
    "Was it the man they call Silvertop?": "a name or place not met: Silvertop",
    "Lovely morning for it.": "offered last time",
    "Nice of you to wear the dead man's boots, boy.": "the judge: gives away what's held",
    "(I look for a docker's knot on the hoist rope)": "hidden: docker",
    "(I send a runner for the watch surgeon)": "the scene can't offer it: surgeon",
    "(I try to hold a séance for Prout)": "the scene can't offer it: séanc",
  });
  assert.ok(Math.abs(made.costUsd - 0.0003) < 1e-12, "the call's and the judge's");
  // The judge was given every fact, with its status: what the player knows, what's held from them, what's true now, what the scene can't offer.
  assert.match(judged!.facts.what_the_player_knows!, /A stone clangs off the hoist hook/);
  assert.match(judged!.facts.held_from_the_player!, /The boots are Prout's/);
  assert.match(judged!.facts.held_from_the_player!, /How the GM pictures the boy in the too-big boots[^\n]*laced round his ankles with string/, "how the GM pictures people is held: the scene shows what it shows");
  assert.match(judged!.facts.what_is_true_now!, /^Here now, and met: Sergeant Agnes Kell; the boy in the too-big boots; the girl in the shawl\./);
  assert.match(judged!.facts.what_the_scene_cannot_offer!, /a séance/);
  assert.deepEqual(Object.keys(judged!.questions), ["line_1", "line_2", "line_3", "line_4", "roll_4", "line_5", "roll_5"]);
  assert.ok(judged!.questions.line_1!.criteria.asks_after, "a question about what's held is a verdict of its own, and a fit one");
  // What it was given: the standing instructions, and what the player knows and nothing else.
  assert.match(asked!.instructions!, /^You suggest what the player might say or do next/);
  assert.doesNotMatch(asked!.instructions!, /`/, "no backticks: in Luna's instructions they cost seconds before the first word");
  const brief = asked!.input[0]!.content;
  assert.deepEqual([...brief.matchAll(/^# .*/gm)].map(m => m[0]), ["# Who they are", "# What they came in knowing", "# What this scene can't offer (never suggest reaching for these)", "# The scene as they've seen it (this is all they know of it)", "# A way out", "# Not again"]);
  const prep = sceneById("hanged-clerk");
  // None of the prep: no route (the crackle in his left boot), no secret, no essential and where it is, no look the scene hasn't shown, no premise.
  assert.doesNotMatch(brief, /crackl|left boot|lining|sewn|Behind the screen|What they're after|Ways on from here|laced round his ankles|tightly closed/i);
  for (const c of prep.cast) for (const s of c.secrets ?? []) assert.ok(!brief.includes(s.slice(0, 40)), s);
  assert.ok(!brief.includes(prep.premise.slice(0, 40)));
  assert.match(brief, /## Who's here now\n- Sergeant Kell\n- the boy in the too-big boots \(the player hasn't heard their name: call them that\)\n- the girl in the shawl/, "Kell by as much of her name as they've heard");
  assert.doesNotMatch(brief, /\bCob\b|\bMoll\b|\bTull\b/, "anyone not yet named goes by what the player calls them, and the corporal isn't here yet");
  for (const limit of prep.limits!) assert.ok(brief.includes(limitHead(limit)), limit);
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

test("what the player has found out is settled, as a companion's told stories are: in the brief to act on, not to ask after, and no longer hidden; but only in words they've met", async () => {
  const state = yard("suggest-found");
  state.turn = 4;
  state.transcript.push({ turn: 4, scene: "hanged-clerk", speaker: "gm", kind: "narration", text: "The page is razored from the Royal Granary Roll: a dozen wagons 'lost to goblins', each countersigned 'J. Sallow, for the Royal Purveyor'." });
  state.landed = ["page"];
  state.established = [
    "Prout didn't hang himself: what has been found shows he was killed and then hoisted up to look like a suicide.",
    // A fact can run ahead of the story (the Rat's had "the Heron" before anyone said it): what's not been met goes, a sentence at a time.
    "Kell has read the page. The rest (the Master's name, the Heron) comes as the boy is asked.",
  ];
  let brief = "";
  const made = await propose(state, {
    decider: { name: "stub", decide: async (_facts, questions) => ({ answers: Object.fromEntries(Object.keys(questions).map(id => [id, { choice: id.startsWith("roll_") ? "risky" : "fine", probabilities: {} }])), latencyMs: 1, costUsd: 0, decider: "stub" }) },
    ask: async request => { brief = request.input[0]!.content; return { costUsd: 0, latencyMs: 1, text: "say: Sergeant, the wagons were countersigned. By whom, though?\ndo: (I read the page again)" }; },
  });
  assert.match(brief, /## What's come out here \(settled: no line asks after it again, though one may act on it[^\n]*\)\n- Prout found grain written off as 'lost to goblins'[^\n]*'J\. Sallow, for the Royal Purveyor'\.\n- Prout didn't hang himself[^\n]*\n- Kell has read the page\.\n\n/);
  assert.doesNotMatch(brief, /Heron/);
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

/** The Drowned Rat, the thief's way, a turn in: the granary played (the girl named Master Sallow there), the big man by the fire. */
function rat(id: string): SessionState {
  const scene = sceneById("drowned-rat");
  const here = ["hobb", "nan-quill", "kell", "arlo", "dilly", "cob"].map(c => scene.cast.find(x => x.id === c)!);
  const state: SessionState = {
    id, sceneId: "drowned-rat", approach: "v2", seed: 3, rollCount: 0, turn: 24,
    player: { name: "Nim Bramblefoot", concept: "a halfling cutpurse and smooth liar", modifiers: { deception: 6, sleight_of_hand: 7 } },
    beat: "the-rat", turnsInBeat: 1, path: [], established: [], canon: [], notes: null, notesTurn: null, patches: [], repairs: [], metrics: [],
    history: [{ sceneId: "hanged-clerk", exitId: "open-case", summary: "Prout's death is recorded as murder by persons unknown.", journal: ["Prout was murdered. The watch has it down as persons unknown."] }],
    lead: "Kell followed the big man with the bandaged hand down the river stairs, and you go with her to the Rat.",
    transcript: [
      { turn: 0, scene: "hanged-clerk", speaker: "gm", kind: "narration", text: "High on the back wall, above a shut loft door, Wendell Prout turns slowly on the sack hoist." },
      { turn: 10, scene: "hanged-clerk", speaker: "gm", kind: "narration", text: "“He called him Master Sallow,” the girl says, “the big one did.”" },
      { turn: 23, scene: "drowned-rat", speaker: "gm", kind: "narration", text: "The din drops by half as you come down into the Rat. A small, square landlady behind the bar looks the sergeant over; an ancient bargewoman deals cards by the fire; a young lighterman with a black eye leans on his elbow by the door. In the fireside corner sits the biggest of a great many big men, back to the wall, one hand out of sight." },
      { turn: 24, scene: "drowned-rat", speaker: "player", kind: "player", text: "*I sit down by the big man.* Hard day, friend?" },
      { turn: 24, scene: "drowned-rat", speaker: "gm", kind: "narration", text: "The big man keeps his bandaged hand under the table. “I only held the rope,” he says, very low. “Hobb, they call me. I only held it.”" },
    ],
    world: buildWorld(scene.id, scene.world!, here.map(c => ({ id: c.id, name: c.name })), { name: "Nim Bramblefoot" }),
  };
  state.world!.entities.dagger = { id: "dagger", name: "Nim's dagger", kind: "item", parent: "player", tags: [], states: [], notes: [] };
  return state;
}

test("nothing the player hasn't met gets into a line: the story's names, the world's own, a place of another scene, a sign the GM pictures but hasn't shown, a word only what's hidden has (thief#4, barbarian#37, goals#61, robust#87)", () => {
  const state = rat("suggest-unmet");
  const scene = effectiveScene(sceneById("drowned-rat"), state.patches);
  const lines = parseSuggestions([
    "say: Hobb, what would put it right?",
    "say: The Heron, then. How do you get inside tonight?",
    "say: Where's the river door, and when does your Master arrive?",
    "do: (I study the big man's hidden hand and the string at his neck.)",
    "say: Hobb, what does that token at your throat open?",
    "say: Mallory, is it? Your mother would want the truth.",
    "do: (I eye Manners on its nails behind the bar.)",
    "say: Did Master Sallow pay you for the rope?",
    "say: Is there anyone he can get at, Hobb?",
    "do: (I slip the dagger back up my sleeve.)",
  ].join("\n"));
  const { kept, dropped } = screen(lines, vetting(scene, state));
  assert.deepEqual(Object.fromEntries(dropped.map(d => [d.text, d.why])), {
    "The Heron, then. How do you get inside tonight?": "a name or place not met: Heron",
    "Where's the river door, and when does your Master arrive?": "a place not met: river door",
    "(I study the big man's hidden hand and the string at his neck.)": "not shown: string",
    "Hobb, what does that token at your throat open?": "hidden: token",
    "Mallory, is it? Your mother would want the truth.": "a name not heard: Mallory",
    "(I eye Manners on its nails behind the bar.)": "a name not heard: Manners",
  });
  assert.deepEqual(kept.map(l => l.text), ["Hobb, what would put it right?", "Did Master Sallow pay you for the rope?", "Is there anyone he can get at, Hobb?", "(I slip the dagger back up my sleeve.)"], "the question, not the answer; and a name they've heard, anywhere in the story");
  // Once the scene has shown them, they're met: the heron on a token is a bird (the Heron is still a place nobody's named), the string's been seen.
  state.transcript.push({ turn: 25, scene: "drowned-rat", speaker: "gm", kind: "narration", text: "A greasy string slips out from round his neck, and on it a brass token stamped with a heron." });
  const later = screen(parseSuggestions("do: (I watch the string at his neck.)\nsay: What does the heron token open, Hobb?\nsay: The Heron, then?"), vetting(scene, state));
  assert.deepEqual(later.kept.map(l => l.text), ["(I watch the string at his neck.)", "What does the heron token open, Hobb?"]);
  assert.deepEqual(later.dropped.map(d => d.why), ["a name or place not met: Heron"]);
});

test("the brief has only what the player has met: who's here by the names they know, what's come out in words they've met, nothing of the prep (thief#4, goals#61)", () => {
  const state = rat("suggest-rat-brief");
  // The thief's Rat: the token stolen, and with it the way in "come across", ten turns before Hobb said what it opened.
  state.landed = ["which-man", "way-in"];
  state.established = ["Big Hobb Mallory has begun to tell the player what he did, the loft first. The rest (his master's name, the Heron) comes as he's asked."];
  const brief = suggestionBrief(effectiveScene(sceneById("drowned-rat"), state.patches), state);
  const here = /## Who's here now\n((?:- .*\n)+)/.exec(brief)![1]!;
  assert.deepEqual(here.trim().split("\n"), [
    "- Big Hobb",
    "- the landlady (the player hasn't heard their name: call them that)",
    "- Sergeant Kell",
    "- the young lighterman with the black eye (the player hasn't heard their name: call them that)",
    "- the old bargewoman with the cards (the player hasn't heard their name: call them that)",
  ], "not the pot-boy in the scullery, whom the scene hasn't shown; Hobb and Kell as far as their names have been said (she's \"the sergeant\" here)");
  // Hobb by as much of his name as he's given.
  assert.match(brief, /## What's come out here[^\n]*\n- Which of the Rat's many big men is the one: Big Hobb in the fireside corner[^\n]*\n- Big Hobb has begun to tell the player what he did, the loft first\.\n\n/);
  assert.doesNotMatch(brief, /Heron|river door|grille|midnight|plank walk|Mallory|his mum|string|Dabchick|Shambles/, "the way in's words, the fact's running ahead, Hobb's look and secrets, the routes");
  assert.match(brief, /Carrying: dagger\./, "what they carry is theirs: a line says \"my dagger\"");
  assert.match(brief, /# A way out\nNo leave line yet/);
});

test("who's here is who the world has here, and nobody who isn't is done to or spoken to; a line of the player's never speaks of them by name (thief#10)", () => {
  // The wizard's granary: the corporal's dead-cart came at the bell, though the scene never reached its beat.
  const yardState = yard("suggest-tull");
  yardState.world = buildWorld("hanged-clerk", sceneById("hanged-clerk").world!, [{ id: "kell", name: "Sergeant Agnes Kell" }, { id: "cob", name: "Cob" }, { id: "moll", name: "Moll" }, { id: "tull", name: "Corporal Abner Tull" }], { name: "Tamsin Vell" });
  yardState.transcript.push({ turn: 5, scene: "hanged-clerk", speaker: "gm", kind: "narration", text: "The cart bell sounds at the gate. “That's Tull,” says Kell, “the corporal with the dead-cart.”" });
  const scene = effectiveScene(sceneById("hanged-clerk"), yardState.patches);
  assert.deepEqual(screen(parseSuggestions("say: Corporal Tull, what does the Captain's order say?"), vetting(scene, yardState)).dropped, []);
  assert.match(suggestionBrief(scene, yardState), /## Who's here now\n(?:- .*\n)*- Corporal Tull \(Corporal Tull and two constables with the dead-cart\)\n/);
  // Before Master Sallow has come, or anyone not in the scene: talked about, yes; done to or spoken to, no.
  const state = rat("suggest-away");
  const { kept, dropped } = screen(parseSuggestions([
    "try: (I try to frighten Sallow into naming who killed Prout.)",
    "say: Sallow, you'll hang for this.",
    "say: Who's Master Sallow to you, Hobb?",
    "do: (I tell Kell what the girl said about Sallow.)",
    "say: I'm off duty. Nim's the one asking, and she pays for her own trouble.",
    "say: I'm Nim Bramblefoot, and I'm buying.",
  ].join("\n")), vetting(effectiveScene(sceneById("drowned-rat"), state.patches), state));
  assert.deepEqual(Object.fromEntries(dropped.map(d => [d.text, d.why])), {
    "(I try to frighten Sallow into naming who killed Prout.)": "not here: Sallow",
    "Sallow, you'll hang for this.": "not here: Sallow",
    "I'm off duty. Nim's the one asking, and she pays for her own trouble.": "not their voice: Nim, by name",
  });
  assert.deepEqual(kept.map(l => l.text), ["Who's Master Sallow to you, Hobb?", "(I tell Kell what the girl said about Sallow.)", "I'm Nim Bramblefoot, and I'm buying."]);
});

test("the judge is told what's held and what's true now: a question is fit, an answer goes even with \"fine\" on top, and so does a line behind the story (wizard#13, thief#10)", async () => {
  const state = rat("suggest-judge");
  state.world!.entities.hobb!.states.push("gone");
  let facts: Record<string, string> = {};
  // As the live judge read the testers' lines: Hobb's mother given away at 0.81 (the old judge, given his prep as known, passed it at 0.14).
  const reads: Record<string, Record<string, number>> = {
    "Is there anyone he can get at?": { asks_after: 0.5, fine: 0.35, gives_away: 0.15 },
    "I can keep your mother safe tonight.": { gives_away: 0.81, fine: 0.1, asks_after: 0.09 },
    "If the Master comes at midnight, we watch the door.": { fine: 0.5, gives_away: 0.48, asks_after: 0.02 },
    "(I ask Kell to give me back my dagger.)": { out_of_date: 0.7, fine: 0.3 },
    "(I try to slip past the landlady unseen.)": { fine: 0.6, gives_away: 0.37, asks_after: 0.03 },
  };
  const decider: Decider = { name: "stub", decide: async (f, questions) => {
    facts = f as Record<string, string>;
    const answers = Object.fromEntries(Object.entries(questions).map(([id, q]) => {
      if (id.startsWith("roll_")) return [id, { choice: "risky", probabilities: { risky: 0.9, safe: 0.1 } }];
      const p = Object.entries(reads).find(([t]) => q.instructions.includes(`"${t}"`))![1];
      return [id, { choice: Object.entries(p).sort((a, b) => b[1] - a[1])[0]![0], probabilities: p }];
    }));
    return { answers, latencyMs: 1, costUsd: 0.0007, decider: "stub" };
  } };
  const lines = parseSuggestions(Object.keys(reads).map(t => `${t.startsWith("(I try") ? "try" : t.startsWith("(") ? "do" : "say"}: ${t}`).join("\n"));
  const judged = await judge(effectiveScene(sceneById("drowned-rat"), state.patches), state, lines, decider);
  assert.deepEqual(judged.lines.map(l => l.text), ["Is there anyone he can get at?", "(I try to slip past the landlady unseen.)"]);
  assert.deepEqual(judged.dropped.map(d => d.why), ["the judge: gives away what's held", "the judge: gives away what's held", "the judge: out of date"]);
  // Every fact, with its status.
  assert.match(facts.held_from_the_player!, /How the GM pictures the landlady \(the player knows only what the scene so far has described\): A small, square woman/);
  assert.match(facts.held_from_the_player!, /the landlady hides: /);
  assert.match(facts.held_from_the_player!, /People whose names the player hasn't heard: [^\n]*Nan Quill \(to the player, "the landlady"\)/);
  assert.match(facts.held_from_the_player!, /Other names the player hasn't heard[^\n]*Mallory[^\n]*Manners/);
  assert.match(facts.held_from_the_player!, /Not yet come across: Hobb does night work for a gentleman at the Heron warehouse/);
  assert.match(facts.what_is_true_now!, /^Here now, and met: the landlady; Sergeant Agnes Kell; the young lighterman with the black eye; the old bargewoman with the cards\.\nHere, but the player hasn't seen them yet \(held\): the pot-boy\.\nGone from here: Big Hobb Mallory\.\nThe player carries: dagger\./);
  assert.match(facts.what_the_player_knows!, /“I only held the rope,” he says/);
  assert.doesNotMatch(facts.what_the_player_knows!, /A greasy string round his thick neck|his mum|Heron/, "nothing held in what they know");
});
