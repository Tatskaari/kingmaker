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

test("say: what answered the line, its notes and the lines suggested after it, then whose turn it is", async () => {
  const out = capture();
  const code = await verbs.say(demoBackend({ ms: 1 }), "Sergeant, who found him?", out);

  assert.equal(code, 0);
  assert.match(out.printed, /^Sergeant Kell glances up at the body/);
  assert.doesNotMatch(out.printed, /Sergeant, who found him\?/);
  assert.match(out.printed, /\n {2}⟨who says what: Sergeant Agnes Kell “The porters\. First light\. …”⟩\n/);
  assert.match(out.printed, /\n {2}⟨know on “ran for the watch”: The watch keeps a house .* \(lore: City Watch\)⟩\n {4}⟨card: The City Watch · .* · What anyone in Caerwyn could tell you\.⟩\n/);
  assert.match(out.printed, /\n {2}⟨why on “Her pencil taps once against the page”: .* \(who: Sergeant Agnes Kell\)⟩\n {4}⟨card: Sergeant Agnes Kell · .* · Last said to you \(turn 3\): “The porters\. First light\. .*”⟩\n/);
  assert.match(out.printed, /\nACTIONS:\n- say_1: Sergeant, who found him, .*\n- say_2: Nice boots, lad\. Yours\?\n- say_3: .*\n- say_4: .*\n\nPHASE: done \(your turn: say what your character says or does\)\n$/);
});

test("say --wait settled: once the world has settled and the notes are in", async () => {
  const settled = capture();
  await verbs.say(demoBackend({ ms: 1 }), "Who else?", settled, { settled: true });

  assert.match(settled.printed, /⟨why on “Her pencil taps/);
  assert.match(settled.printed, /PHASE: done \(your turn/);
});

test("the waits for the notes and the lines give up after a while: then what's there", async () => {
  const out = capture();
  const started = Date.now();
  const code = await verbs.say(stalled(), "Anyone?", out, { afterMs: 40 });

  assert.equal(code, 0);
  assert.ok(Date.now() - started < 2000);
  assert.match(out.printed, /^Kell says nothing\.\n\nPHASE: noting \(your turn/);
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
  assert.equal(out.printed, "(There's no say_9 here: the choices are say_1 to say_4.)\n");
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
  assert.match(on.printed, /^Suggested lines: on\.\n\nACTIONS:\n- say_1: .*\n- say_2: .*\n- say_3: .*\n- say_4: .*\n$/);
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
    newGame: async () => undefined, joinGame: async () => undefined, retry: async () => undefined, setSuggestions: async () => undefined, close: () => {},
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
  const failed: Backend = { ...demoBackend({ ms: 1 }), say: async () => refusal("turn_failed") };
  const out = capture();

  assert.equal(await verbs.say(failed, "Hello?", out), 1);
  assert.equal(out.printed, "(The GM lost the thread: /retry to carry on.)\nCarry it on: npm run play -- retry --session <name>.\n");
});

test("new: the opening, then the game's number to watch it by; join: the game as its player sees it, and who has the lead", async () => {
  const game = demoBackend({ ms: 1 });
  const made = capture();
  assert.equal(await verbs.newGame(game, { campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard", build: "wizard" }, made), 0);
  assert.match(made.printed, /^MODE: scene\n/);
  assert.match(made.printed, /Game 2\. Another terminal can watch it: npm run play -- join --session <name> --game 2\n$/);

  const watched = capture();
  assert.equal(await verbs.joinGame(game, 2n, watched), 0);
  assert.match(watched.printed, /PHASE: done \(you're watching: Pell Marrow has the lead\)\n$/);
  assert.equal(await verbs.say(game, "Can I help?", watched), 1);
  assert.match(watched.printed, /\(Pell Marrow has the lead here: you're watching\.\)\n$/);
});

test("not in a game: the simulation's words, then how to start or watch one with these verbs; exit 1", async () => {
  const nowhere: Backend = { ...rowsAsTheyCome(), view: () => undefined };
  const out = capture();

  assert.equal(verbs.observe(nowhere, out), 1);
  assert.equal(await verbs.say(nowhere, "Hello?", out), 1);
  assert.equal(out.printed, `${"(You're not in a game: start one, or watch someone's.)\nStart one: npm run play -- new --session <name> --as \"Name: concept\". Watch one: npm run play -- join --session <name> --game <n>.\n".repeat(2)}`);
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

/** A game whose reply comes at once, and whose notes and lines never do: what the waits give up on. */
function stalled(): Backend {
  let view: SceneView = YARD;
  return {
    view: () => view,
    onChange: () => () => {},
    newGame: () => Promise.resolve(undefined),
    joinGame: () => Promise.resolve(undefined),
    say(text) {
      const turn = 3;
      view = { ...view, entries: [...view.entries, { turn, speaker: "player:1", kind: "player", text }, { turn, speaker: "gm", kind: "narration", text: "Kell says nothing." }], phase: "noting", turn, notesComing: true, suggestionsComing: true };
      return Promise.resolve(undefined);
    },
    retry: () => Promise.resolve(undefined),
    setSuggestions: () => Promise.resolve(undefined),
    close() {},
  };
}
