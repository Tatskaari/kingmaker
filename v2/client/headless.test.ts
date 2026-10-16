import assert from "node:assert/strict";
import { test } from "node:test";
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

test("observe and transcript: the scene, and everything said in it", () => {
  const game = demoBackend();
  const seen = capture();
  const all = capture();

  assert.equal(verbs.observe(game, seen), 0);
  assert.equal(verbs.transcript(game, all), 0);
  assert.match(seen.printed, /^MODE: scene\n\n\[The Hanged Clerk, morning\] Here: /);
  assert.match(all.printed, /^MODE: transcript\n\n\[The Hanged Clerk\]\n\nThe yard behind the King's Granary/);
});
