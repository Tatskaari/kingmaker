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

test("say: what answered the line, then whose turn it is; with --wait settled, once the world has settled", async () => {
  const out = capture();
  const code = await verbs.say(demoBackend({ ms: 1 }), "Sergeant, who found him?", out);

  assert.equal(code, 0);
  assert.match(out.printed, /^Sergeant Kell glances up at the body/);
  assert.doesNotMatch(out.printed, /Sergeant, who found him\?/);
  assert.match(out.printed, /PHASE: settling \(your turn: say what your character says or does\)\n$/);

  const settled = capture();
  await verbs.say(demoBackend({ ms: 1 }), "Who else?", settled, { settled: true });
  assert.match(settled.printed, /PHASE: done \(your turn/);
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
 * gone, its last words never seen in a draft.
 */
function rowsAsTheyCome(): Backend {
  const n = (YARD.entries.at(-1)?.turn ?? 0) + 1;
  const said: SceneView = { ...YARD, entries: [...YARD.entries, { turn: n, speaker: "player:1", kind: "player", text: "Who found him?" }], phase: "deciding", turn: n, mayType: false };
  const later: SceneView[] = [
    { ...said, phase: "replying", draft: { speaker: "gm", kind: "narration", text: "Kell looks up from her", attempt: 1, seq: 1 } },
    { ...said, entries: [...said.entries, { turn: n, speaker: "gm", kind: "narration", text: "Kell looks up from her notebook. “The porters.”" }], phase: "settling", mayType: true },
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
    newGame: async () => undefined, joinGame: async () => undefined, retry: async () => undefined, close: () => {},
    // The scene's rows are all these verbs read; the title's are empty.
    home: () => ({ games: [], campaigns: [] }), act: async () => undefined,
  };
}

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

test("new: the opening, then the game's number to watch it by; join: the game as its player sees it, and who has the lead", async () => {
  const game = demoBackend({ ms: 1 });
  const made = capture();
  assert.equal(await verbs.newGame(game, { campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard", build: "wizard" }, made), 0);
  assert.match(made.printed, /^MODE: scene\n/);
  assert.match(made.printed, /Game 3\. Another terminal can watch it: npm run play -- join --session <name> --game 3\n$/);

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

test("observe and transcript: the scene, and everything said in it", () => {
  const game = demoBackend();
  const seen = capture();
  const all = capture();

  assert.equal(verbs.observe(game, seen), 0);
  assert.equal(verbs.transcript(game, all), 0);
  assert.match(seen.printed, /^MODE: scene\n\n\[The Hanged Clerk, morning\] Here: /);
  assert.match(all.printed, /^MODE: transcript\n\n\[The Hanged Clerk\]\n\nThe yard behind the King's Granary/);
});

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
  assert.match(out.printed, /\nMODE: scene\n/);
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
  assert.match(begun.printed, /^MODE: scene\n/);
  assert.equal(await verbs.begin(game, capture()), 1, "already begun");

  const gone = capture();
  assert.equal(await verbs.deleteGame(game, 1n, gone), 0);
  assert.match(gone.printed, /^Game 1 is deleted\.\n\nMODE: title\n\nYour games, the one played last first:\n  Game 2\. /);
  assert.equal(await verbs.deleteGame(game, 1n, capture()), 1, "no such game");

  const seen = capture();
  assert.equal(await verbs.deleteGame(game, 2n, capture()), 0);
  assert.equal(verbs.observe(game, seen), 0);
  assert.match(seen.printed, /^MODE: title\n\nYou have no games yet\.\n/);
});
