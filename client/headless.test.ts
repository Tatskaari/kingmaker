import assert from "node:assert/strict";
import { test } from "node:test";
import { refusal } from "../shared/protocol/refusals.ts";
import type { Backend } from "./backend.ts";
import { YARD } from "./check/fixture.ts";
import { demoBackend } from "./demo.ts";
import * as verbs from "./headless.ts";
import type { SceneView } from "./scene/view.ts";

/** A verb's words, and the reply's progress, kept to read back. */
function capture(): verbs.Out & { printed: string; streamed: string } {
  const out = { printed: "", streamed: "", print: (text: string) => { out.printed += `${text}\n`; }, progress: (text: string) => { out.streamed += text; } };
  return out;
}

test("say: what answered the line, who says what in it, and the lines suggested after it, then whose turn it is", async () => {
  const out = capture();
  const code = await verbs.say(demoBackend({ ms: 1 }), "Sergeant, who found him?", out);

  assert.equal(code, 0);
  assert.match(out.printed, /^Sergeant Kell glances up at the body/);
  assert.doesNotMatch(out.printed, /Sergeant, who found him\?/);
  assert.match(out.printed, /\n {2}⟨who says what: Sergeant Agnes Kell “The porters\. First light\. …”⟩\n/);
  assert.doesNotMatch(out.printed, /⟨(?:why|know|you) on|⟨card:/, "the notes on marks went in M2");
  assert.match(out.printed, /\nACTIONS:\n- say_1: Sergeant, who found him, .*\n- say_2: Nice boots, lad\. Yours\?\n- say_3: .*\n- say_4: .*\n- say_5: Sergeant, that's a cord mark, .*\n\nPHASE: done \(your turn: say what your character says or does\)\n$/);
});

test("say --wait settled: once the world has settled", async () => {
  const settled = capture();
  await verbs.say(demoBackend({ ms: 1 }), "Who else?", settled, { settled: true });

  assert.match(settled.printed, /^Sergeant Kell glances up at the body/);
  assert.match(settled.printed, /PHASE: done \(your turn/);
});

test("the wait for the lines gives up after a while: then what's there", async () => {
  const out = capture();
  const started = Date.now();
  const code = await verbs.say(stalled(), "Anyone?", out, { afterMs: 40 });

  assert.equal(code, 0);
  assert.ok(Date.now() - started < 2000);
  assert.match(out.printed, /^Kell says nothing\.\n\nPHASE: settling \(your turn/);
  assert.doesNotMatch(out.printed, /ACTIONS:/);
});

test("act: the second line suggested said, and what answered it", async () => {
  const game = demoBackend({ ms: 1 });
  const out = capture();

  assert.equal(await verbs.act(game, "say_2", out), 0);
  assert.match(out.printed, /^> Nice boots, lad\. Yours\?\n\nSergeant Kell glances up/);
  assert.equal(game.view()!.entries.filter(e => e.kind === "player").at(-1)?.text, "Nice boots, lad. Yours?");
  assert.match(out.printed, /PHASE: done/);
});

test("act: no such line, a line with the lines off, or a spectator's, is refused (exit 1)", async () => {
  const game = demoBackend({ ms: 1 });
  const out = capture();

  assert.equal(await verbs.act(game, "say_9", out), 1);
  assert.equal(out.printed, "(There's no say_9 here: the choices are say_1 to say_5.)\n");
  assert.equal(await verbs.act(game, "talk_kell", capture()), 1);

  await game.setSuggestions(false);
  const off = capture();
  assert.equal(await verbs.act(game, "say_1", off), 1);
  assert.equal(off.printed, "(There's no say_1 here: the suggested lines are off (suggestions on brings them back).)\n");

  await game.joinGame(1n);
  const watching = capture();
  assert.equal(await verbs.act(game, "say_1", watching), 1);
  assert.equal(watching.printed, "(Pell Marrow has the lead here: you're watching.)\n");
});

test("suggestions: which it is; off, and none listed; on, this moment's asked for at once, waited for and listed", async () => {
  const game = demoBackend({ ms: 1 });

  const now = capture();
  assert.equal(await verbs.suggestions(game, undefined, now), 0);
  assert.match(now.printed, /^Suggested lines: on\.\n\nACTIONS:\n- say_1: /);

  const off = capture();
  assert.equal(await verbs.suggestions(game, false, off), 0);
  assert.equal(off.printed, "Suggested lines: off.\n");
  assert.equal(game.view()!.suggestions.length, 0);

  const on = capture();
  assert.equal(await verbs.suggestions(game, true, on), 0);
  assert.match(on.printed, /^Suggested lines: on\.\n\nACTIONS:\n- say_1: .*\n- say_2: .*\n- say_3: .*\n- say_4: .*\n- say_5: .*\n$/);
});

test("say --stream: the reply as it's written, on its own stream", async () => {
  const out = capture();
  await verbs.say(demoBackend({ ms: 1 }), "Who else?", out, { stream: true });

  assert.match(out.streamed, /^\[the GM\] Sergeant Kell glances up at the body, .* Her pencil taps once against the page\.\n\n$/);
});

test("say --stream: words the reply's entry brought that the last draft seen hadn't are streamed too", async () => {
  const out = capture();
  await verbs.say(rowsAsTheyCome(), "Who found him?", out, { stream: true });

  assert.equal(out.streamed, "[the GM] Kell looks up from her notebook. “The porters.”\n\n");
});

/**
 * A game whose rows, once a line is said (its turn at once, as the move's own rows come with its
 * commit), come as they can: the reply's draft seen part-way, then the reply's entry with the draft
 * gone, its last words never seen in a draft. One whose reply `closes` the scene is ending while
 * it settles, then ends.
 */
function rowsAsTheyCome(closes?: "closes"): Backend {
  const n = (YARD.entries.at(-1)?.turn ?? 0) + 1;
  const said: SceneView = { ...YARD, entries: [...YARD.entries, { turn: n, speaker: "player:1", kind: "player", text: "Who found him?" }], phase: "replying", turn: n, mayType: false };
  const replied: SceneView = { ...said, entries: [...said.entries, { turn: n, speaker: "gm", kind: "narration", text: "Kell looks up from her notebook. “The porters.”" }], phase: "settling", mayType: !closes };
  const ended: SceneView = { ...replied, entries: [...replied.entries, { turn: n, speaker: "system", kind: "system", text: "Scene ends: Walked away" }], phase: "done", over: true };
  const later: SceneView[] = [
    { ...said, phase: "replying", draft: { speaker: "gm", kind: "narration", text: "Kell looks up from her", attempt: 1, seq: 1 } },
    closes ? { ...replied, ending: true } : replied,
    ...(closes ? [ended] : []),
  ];
  let view = YARD;
  const listeners = new Set<() => void>();
  const show = (next: SceneView) => { view = next; for (const listener of listeners) listener(); };
  const play = async () => {
    for (const next of later) {
      await new Promise(resolve => setTimeout(resolve, 1));
      show(next);
    }
  };
  return {
    view: () => view,
    onChange: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    say: async () => { show(said); void play(); return undefined; },
    newGame: async () => undefined, joinGame: async () => undefined, retry: async () => undefined, setSuggestions: async () => undefined, close: () => {},
    explore: () => undefined, walk: async () => undefined, interact: async () => undefined, travel: async () => undefined,
    // The scene's rows are all these verbs read; the title's are empty.
    home: () => ({ games: [], campaigns: [] }), act: async () => undefined,
  };
}

test("say: a line whose reply closes the scene waits for the scene's end, and prints it", async () => {
  const out = capture();
  assert.equal(await verbs.say(rowsAsTheyCome("closes"), "*I give up and walk out of the yard.*", out), 0);

  assert.equal(out.printed, "Kell looks up from her notebook. “The porters.”\n\n— Scene ends: Walked away —\n\nPHASE: over (the scene has ended: there's nothing more to say in it)\n");
});

test("a refused move prints the simulation's words and exits 1", async () => {
  const game = demoBackend({ ms: 1 });
  const out = capture();

  assert.equal(await verbs.say(game, "   ", out), 1);
  assert.equal(out.printed, "(Say something, or do something in *asterisks*.)\n");
  assert.equal(await verbs.retry(game, out), 1);
  assert.match(out.printed, /\(That turn hasn't failed: there's nothing to retry\.\)\n$/);
});

test("a line while a turn is failed: the simulation's words, then the verb that carries it on; exit 1", async () => {
  const failed = demoBackend({ ms: 1 });
  failed.say = async () => refusal("turn_failed");
  const out = capture();

  assert.equal(await verbs.say(failed, "Hello?", out), 1);
  assert.equal(out.printed, "(The GM lost the thread: /retry to carry on.)\nCarry it on: npm run play -- retry --session <name>.\n");
});

test("new: on the map in the lane (MODE: explore), then the game's number to watch it by; act takes the map's ids, and talking to Kell opens the scene; join: the game as its player sees it, and who has the lead", async () => {
  const game = demoBackend({ ms: 1 });
  const made = capture();
  assert.equal(await verbs.newGame(game, { campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard", build: "wizard" }, made), 0);
  assert.match(made.printed, /^MODE: explore\n\nCaerwyn: the granary lane, morning\. You are the @; on this map north is up-left and east is up-right\.\n/);
  assert.match(made.printed, /\nThe story is heading for The Hanged Clerk: the granary yard, [^\n]*\.\n/);
  assert.match(made.printed, /\nACTIONS:\n- go_to_lead: Walk to where the story is heading: the granary yard, [^\n]*\n- talk_kell: Talk to Sergeant Kell /);
  assert.match(made.printed, /- talk_cob: Talk to the boy in the too-big boots /, "the people go by what the player would call them");
  assert.match(made.printed, /Game 3\. Another terminal can watch it: npm run play -- join --session <name> --game 3\n$/);

  // An id not on offer is refused in the game's words; a look is the map's words, and the map again.
  const nothing = capture();
  assert.equal(await verbs.act(game, "talk_nobody", nothing), 1);
  assert.match(nothing.printed, /^\(That isn't there to do from here: look again at what's in sight\.\)\n$/);
  const looked = capture();
  assert.equal(await verbs.act(game, "look", looked), 0);
  assert.match(looked.printed, /^You're in the granary lane, on the cobbles\. [\s\S]*\n\nMODE: explore\n/);
  assert.equal(game.explore()?.log.at(-1)?.startsWith("You're in the granary lane"), true, "the explore row keeps what was said");

  // Talking to Kell walks over to her and opens the scene: its opening, as new's would be.
  const talked = capture();
  assert.equal(await verbs.act(game, "talk_kell", talked), 0);
  assert.match(talked.printed, /\nMODE: scene\n\n\[The Hanged Clerk, morning\]/);
  assert.equal(game.explore()?.ex.scene, "hanged-clerk");
  const busy = capture();
  assert.equal(await verbs.act(game, "walk_north", busy), 1);
  assert.match(busy.printed, /^\(You're in the middle of a scene: see it through first\.\)\n$/);

  const watched = capture();
  assert.equal(await verbs.joinGame(game, 1n, watched), 0);
  assert.match(watched.printed, /PHASE: done \(you're watching: Pell Marrow has the lead\)\n$/);
  assert.equal(await verbs.say(game, "Can I help?", watched), 1);
  assert.match(watched.printed, /\(Pell Marrow has the lead here: you're watching\.\)\n$/);
});

test("not in a game: say and transcript give the simulation's words, then how to start or watch one with these verbs, exit 1; observe gives the title", async () => {
  const nowhere: Backend = { ...rowsAsTheyCome(), view: () => undefined };
  const out = capture();

  assert.equal(await verbs.say(nowhere, "Hello?", out), 1);
  assert.equal(verbs.transcript(nowhere, out), 1);
  assert.equal(out.printed, `${"(You're not in a game: start one, or watch someone's.)\nStart one: npm run play -- new --session <name> --as \"Name: concept\". Watch one: npm run play -- join --session <name> --game <n>.\n".repeat(2)}`);

  const title = capture();
  assert.equal(verbs.observe(nowhere, title), 0);
  assert.match(title.printed, /^MODE: title\n\nYou have no games yet\.\n/);
});

test("map: the scene's place as the player sees it, still, then the world from above with what's what; none until its rows come; refused outside a game", async () => {
  const out = capture();
  assert.equal(verbs.map(demoBackend({ ms: 1 }), out, { w: 60, h: 20 }), 0);
  const [stage = "", sketch = ""] = out.printed.replace(/^MODE: map\n\n/, "").split("\nThe yard behind the King's Granary\n");
  assert.equal(stage.split("\n").filter(r => r.trim()).length, 20, "the stage: 20 rows");
  assert.match(stage, /@/);
  assert.doesNotMatch(stage, /[^\x00-\x7f]/, "in seven-bit characters");
  assert.match(sketch, /\n@ Pell Marrow\n/);
  assert.match(sketch, /\n[A-Z] Sergeant Agnes Kell\n/);
  assert.match(sketch, /\n[a-z] the loft door \(closed, barred\)\n/);

  const none = capture();
  assert.equal(verbs.map(stalled(), none), 1);
  assert.equal(none.printed, "MODE: map\n\n(The scene's place hasn't come: its rows aren't in yet. Observe again in a moment.)\n");

  const nowhere = capture();
  assert.equal(verbs.map({ ...rowsAsTheyCome(), view: () => undefined }, nowhere), 1);
  assert.match(nowhere.printed, /^\(You're not in a game/);
});

test("say: Magic Missile at the hoist rope, on the demo, prints the rules' lines before the reply: the cast, the darts, the rope destroyed, the slot gone", async () => {
  const game = demoBackend({ ms: 1 });
  const out = capture();
  assert.equal(await verbs.say(game, "(I cast Magic Missile at the hoist rope)", out), 0);
  assert.match(out.printed, /Cast Magic Missile \(1st-level slot\) on the hoist rope\n.*3 darts at the hoist rope: 9 force\n.*The hoist rope takes 9 force damage and is destroyed\n.*Pell Marrow: HP 20\/20, spell slots 1st 3\/4, 2nd 2\/2\n/s);
  assert.ok(out.printed.indexOf("The hoist rope takes") < out.printed.indexOf("Sergeant Kell glances up"), "the dice before the GM's words");
  const map = capture();
  verbs.map(game, map);
  assert.match(map.printed, /\n[a-z] Wendell Prout's body \(fallen\)\n/, "Prout fell with the rope, and lies in the yard");
});

test("observe and transcript: the scene, and everything said in it", () => {
  const game = demoBackend();
  const seen = capture();
  const all = capture();

  assert.equal(verbs.observe(game, seen), 0);
  assert.equal(verbs.transcript(game, all), 0);
  assert.match(seen.printed, /^MODE: scene\n\n\[The Hanged Clerk, morning\] Here: /);
  assert.match(seen.printed, /\n\nThis morning a palace clerk, Wendell Prout, was found hanged/);
  assert.match(all.printed, /^MODE: transcript\n\n\[The Hanged Clerk\]\n\nThis morning a palace clerk, Wendell Prout, .* are some children\.\n\nThe yard behind the King's Granary/);
});

/** A game whose reply comes at once, and whose lines never do: what the wait gives up on. */
function stalled(): Backend {
  let view: SceneView = YARD;
  return {
    view: () => view,
    onChange: () => () => {},
    newGame: () => Promise.resolve(undefined),
    joinGame: () => Promise.resolve(undefined),
    say(text) {
      const turn = 3;
      view = { ...view, entries: [...view.entries, { turn, speaker: "player:1", kind: "player", text }, { turn, speaker: "gm", kind: "narration", text: "Kell says nothing." }], phase: "settling", turn, suggestionsComing: true };
      return Promise.resolve(undefined);
    },
    retry: () => Promise.resolve(undefined),
    setSuggestions: () => Promise.resolve(undefined),
    // The scene's rows are all these verbs read; the title's are empty.
    home: () => ({ games: [], campaigns: [] }),
    act: () => Promise.resolve(undefined),
    explore: () => undefined, walk: () => Promise.resolve(undefined), interact: () => Promise.resolve(undefined), travel: () => Promise.resolve(undefined),
    close() {},
  };
}

// ---------------------------------------------------------------------------------------------
// Making a character, and the player's games (v1-design §3.10), on the demo's canned rows.

const TAMSIN = { campaign: "caerwyn", name: "Tamsin Vell", concept: "a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier", session: "t" };

test("builds: the three cards, why they're the class defaults, and how new takes one", async () => {
  const out = capture();
  assert.equal(await verbs.builds(demoBackend({ ms: 1 }), TAMSIN, out), 0);
  assert.match(out.printed, /^The GM is offline: three from the class defaults that best match your words\.\n\n1\. Halfling Rogue 3 · Thief · Sage\n   Soft shoes/);
  assert.match(out.printed, /\n2\. Human Bard 3 · College of Lore · Sage\n/);
  assert.match(out.printed, /\n\(play new --session t --as "Tamsin Vell: a disgraced palace auditor[^"]*" --build 1, 2 or 3 takes one; --build own:<species>,<class>,<subclass>,<background> makes your own\.\)\n$/);
});

test("new --build 2 --backstory --accept-fixes: the build, each issue fixed and checked again, who they are, the game, then its opening", async () => {
  const out = capture();
  const code = await verbs.newCharacter(demoBackend({ ms: 1 }), { ...TAMSIN, build: "2", backstory: "I'm the King's nephew, though nobody at court will say so. I owe Fat Jory three crowns.", acceptFixes: true }, out);
  assert.equal(code, 0, out.printed);
  assert.match(out.printed, /^Build 2 of three: human bard 3 \(College of Lore\), sage background\nHuman Bard 3 · College of Lore · Sage\n/);
  assert.match(out.printed, /\nBackstory: "I'm the King's nephew" doesn't fit: King Aldren's family is known to all Caerwyn, and there's no nephew in it\.\n  A fix that keeps its spirit: "I'm a cousin of a minor courtier, twice removed"\n  \(fixed: --accept-fixes\)\nBackstory: with the fixes in, it fits\.\nWho you are: Tamsin Vell, /);
  assert.match(out.printed, /\nGame 3: you are Tamsin Vell\b/);
  assert.match(out.printed, /\nMODE: explore\n\nCaerwyn: the granary lane, morning\./);
});

test("new with a backstory the lore check doesn't take, and no --accept-fixes: the issue, unchanged, exit 1, the creation kept", async () => {
  const game = demoBackend({ ms: 1 });
  const out = capture();
  assert.equal(await verbs.newCharacter(game, { ...TAMSIN, build: "1", backstory: "I'm the King's nephew. I owe Fat Jory three crowns." }, out), 1);
  assert.match(out.printed, /doesn't fit: .*\n  A fix that keeps its spirit: .*\n  \(not changed: --accept-fixes takes the fixes\)\n/);
  assert.match(out.printed, /The creation is kept\.\)\n$/);
  assert.equal(game.home().creation?.step, "backstory");
  const title = capture();
  verbs.games(game, title);
  assert.match(title.printed, /\nHalf made: Tamsin Vell, a disgraced palace auditor[^\n]*\. play new --as "Tamsin Vell: [^"]*" carries it on \(its builds and backstory kept\)\.\n/);
});

test("new without --build: the GM picks; own: the engine's card for their own picks; a ready-made build won't take a backstory", async () => {
  const picked = capture();
  assert.equal(await verbs.newCharacter(demoBackend({ ms: 1 }), { ...TAMSIN }, picked), 0, picked.printed);
  assert.match(picked.printed, /^Game 3: you are Tamsin Vell, /);

  const own = capture();
  assert.equal(await verbs.newCharacter(demoBackend({ ms: 1 }), { ...TAMSIN, build: "own:orc,rogue,thief,criminal" }, own), 0, own.printed);
  assert.match(own.printed, /^Your own: orc rogue 3 \(Thief\), criminal background\nOrc Rogue 3 · Thief · Criminal\n/);

  const ready = capture();
  assert.equal(await verbs.newCharacter(demoBackend({ ms: 1 }), { ...TAMSIN, build: "rogue", backstory: "I owe Fat Jory." }, ready), 1);
  assert.match(ready.printed, /^\(A ready-made character goes straight in/);
});

test("games, continue, delete, begin, sheet and observe: the title's lines, the sheet before setting off, the scene after", async () => {
  const game = demoBackend({ ms: 1 });
  const title = capture();
  assert.equal(verbs.games(game, title), 0);
  assert.match(title.printed, /^MODE: title\n\nYour games, the one played last first:\n  Game 1\. Pell Marrow: Morning, in The Hanged Clerk \(5 min ago\)\n  Game 2\. Wren Ashdown: Morning, heading for The Hanged Clerk \(2 days ago\)\n/);

  const carried = capture();
  assert.equal(await verbs.continueGame(game, 2n, carried), 0);
  assert.match(carried.printed, /^MODE: created\n\nMorning, on the eve of the Assembly\. This morning a palace clerk/);
  assert.match(carried.printed, /\nWren Ashdown: human fighter 3 \(Champion\), soldier background\n/);
  assert.match(carried.printed, /\nUse: play begin\n$/);

  const sheet = capture();
  assert.equal(verbs.sheet(game, sheet), 0);
  assert.match(sheet.printed, /^Wren Ashdown: human fighter 3/);

  const begun = capture();
  assert.equal(await verbs.begin(game, begun), 0);
  assert.match(begun.printed, /^MODE: explore\n\nCaerwyn: the granary lane, morning\./);
  assert.equal(await verbs.begin(game, capture()), 1, "already begun");
  const seen = capture();
  assert.equal(verbs.observe(game, seen), 0);
  assert.match(seen.printed, /^MODE: explore\n/, "observe on the map");

  const gone = capture();
  assert.equal(await verbs.deleteGame(game, 1n, gone), 0);
  assert.match(gone.printed, /^Game 1 is deleted\.\n\nMODE: title\n\nYour games, the one played last first:\n  Game 2\. /);
  assert.equal(await verbs.deleteGame(game, 1n, capture()), 1, "no such game");

  const none = capture();
  assert.equal(await verbs.deleteGame(game, 2n, capture()), 0);
  assert.equal(verbs.observe(game, none), 0);
  assert.match(none.printed, /^MODE: title\n\nYou have no games yet\.\n/);
});
