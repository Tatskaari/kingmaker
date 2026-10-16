import assert from "node:assert/strict";
import { test } from "node:test";
import { demoBackend } from "./demo.ts";
import * as verbs from "./headless.ts";

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
