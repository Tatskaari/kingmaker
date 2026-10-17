import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Backend } from "../../client/backend.ts";
import { demoBackend } from "../../client/demo.ts";
import type { SceneView } from "../../client/scene/view.ts";
import { patiently, worthWaiting } from "./patience.ts";
import { CAMPAIGNS, recordPath, type LoopConfig } from "./paths.ts";
import { brief, say, start, transcript, type PlayDeps } from "./play.ts";
import { newRecord, readRecord, type Wait } from "./record.ts";
import { reachScene } from "./reach.ts";
import { newRound, personas } from "./round.ts";
import { campaignAt } from "./scenes.ts";

/**
 * start and say against the demo (client/demo.ts): the game with no server, canned turns, the yard
 * and the Drowned Rat, its end_scene taking only open-case. What a stack would add (the owner's rows,
 * the call log) isn't there, and the loop goes without.
 */

const CONFIG = (): LoopConfig => ({ rounds: mkdtempSync(join(tmpdir(), "km-loop-")), command: "npm run -s loop --" });
const loaded = campaignAt(join(CAMPAIGNS, "caerwyn"));

/** The demo as every command's connection (its close a no-op: the next command finds the game as the last left it). */
function demoDeps(): PlayDeps & { game: Backend } {
  const game = demoBackend({ ms: 1 });
  const kept = new Proxy(game, {
    get: (target, key) => {
      if (key === "close") return () => {};
      const value = Reflect.get(target, key) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { game, connect: async () => kept, owner: () => undefined, campaign: () => loaded, calls: () => [], callLog: () => "", sleep: async () => {}, now: () => new Date("2026-10-17T20:00:00Z"), backoff: [1, 1] };
}

function round(config: LoopConfig, scene: string, maxTurns = 2) {
  return newRound(config, "r1", { scenes: [{ scene, games: 1 }], personas: ["thief"], arms: [{ name: "baseline", stack: "demo" }], maxTurns }, {
    personas: personas(), scenes: ["hanged-clerk", "drowned-rat"], build: { commit: "abc1234", dirty: false }, now: "2026-10-17T20:00:00.000Z",
  });
}

test("start: a character made from the persona's sentence, the lead walked to, and the opening as the player sees it; say: what answered the line, who said what by name, the turn; then the limit", async () => {
  const config = CONFIG();
  round(config, "hanged-clerk");
  const deps = demoDeps();

  const started = await start(config, "r1", "g01", deps);
  assert.equal(started.code, 0, started.text);
  assert.match(started.text, /^You are Nell Quickfingers: a sneaky halfling thief who trusts nobody and pockets anything not nailed down\.\nIn game terms: /);
  assert.match(started.text, /\n\n\[The Hanged Clerk, [Mm]orning\] Here: Sergeant Agnes Kell, /);
  assert.match(started.text, /\(Turn 0 of 2: the opening\. Your turn: npm run -s loop -- say r1 g01 "<what you say or do>"\)$/);
  assert.doesNotMatch(started.text, /⟨|ACTIONS:|PHASE:|MODE:/, "no markup lines, no suggested lines, nothing for an agent");
  assert.equal(deps.game.view()?.suggestionsOn, false, "the suggested lines are off: the testers write their own");

  const record = readRecord(recordPath(config, "r1", "g01"))!;
  assert.equal(record.scene, "hanged-clerk");
  assert.deepEqual(record.skipped, []);
  assert.equal(record.player!.made, "from the persona's sentence (the GM picked the build)");
  assert.ok(record.entries.some(e => e.turn === 0), "the opening is recorded");
  assert.equal((await start(config, "r1", "g01", deps)).text, 'Game g01 has already started. Go on with: npm run -s loop -- say r1 g01 "<what you say or do>"');

  const said = await say(config, "r1", "g01", "Sergeant, who found him?", deps);
  assert.equal(said.code, 0, said.text);
  assert.match(said.text, /Sergeant Agnes Kell: “/, "a spoken line after its speaker's name");
  assert.doesNotMatch(said.text, /Sergeant, who found him\?/, "not the line they typed");
  assert.match(said.text, /\(Turn 1 of 2\.\)$/);
  assert.equal(readRecord(recordPath(config, "r1", "g01"))!.turns["1"]!.said, "Sergeant, who found him?");

  assert.match((await say(config, "r1", "g01", "And the boots?", deps)).text, /\(That was your last turn: the round's limit is 2\. Write your notes now\.\)$/);
  const over = await say(config, "r1", "g01", "One more?", deps);
  assert.deepEqual(over, { code: 0, text: "That was your last turn (the round's limit is 2). Write your notes now." }, "the game's answer, not a failure to try again");

  const text = (await transcript(config, "r1", "g01", deps)).text;
  assert.match(text, /^## Turn 0 \(the opening\)\n\n/);
  assert.match(text, /\n## Turn \d+\n\n> Sergeant, who found him\?\n\n/);
});

test("say: a line that ends the scene says so, notes the ending, and no line is said after it", async () => {
  const config = CONFIG();
  round(config, "hanged-clerk", 5);
  const deps = demoDeps();
  assert.equal((await start(config, "r1", "g01", deps)).code, 0);

  const ended = await say(config, "r1", "g01", "Sergeant, that's a cord mark. Write him down as murdered, persons unknown.", deps);
  assert.match(ended.text, /— Scene ends: Murder by persons unknown —\n\n— The scene is over \(Murder by persons unknown\)\. — Write your notes now\.$/);
  assert.deepEqual(readRecord(recordPath(config, "r1", "g01"))!.ended, { turn: 1, title: "Murder by persons unknown" });
  assert.deepEqual(await say(config, "r1", "g01", "And now?", deps), { code: 0, text: "— The scene is over (Murder by persons unknown). — Write your notes now." });
});

test("say: a scene that ended behind the loop's back (the owner ended it, or a closing reply was still settling) is noted, said to be over, and not a failure", async () => {
  const config = CONFIG();
  round(config, "hanged-clerk", 5);
  const deps = demoDeps();
  assert.equal((await start(config, "r1", "g01", deps)).code, 0);
  assert.equal(await deps.game.act("endScene", { game: BigInt(deps.game.view()!.game), exit: "open-case" }), undefined);

  const said = await say(config, "r1", "g01", "Hello?", deps);
  assert.equal(said.code, 0, said.text);
  assert.match(said.text, /^— Scene ends: Murder by persons unknown —\n\n— The scene is over \(Murder by persons unknown\)\. — Write your notes now\.$/);
  assert.equal(readRecord(recordPath(config, "r1", "g01"))!.ended?.title, "Murder by persons unknown");
});

test("a later scene reached: the scene before it ended for QA on its first good or mixed ending the game takes, the story moved on, then on to the lead", async () => {
  // The demo's own game (Pell Marrow's, in the yard and on no map: the demo's map can't walk to the Rat, as the game's can).
  const game = demoBackend({ ms: 1 });
  const record = newRecord({ round: "r1", game: "g01", scene: "drowned-rat", stack: "demo" });
  const waits: Wait[] = [];
  await reachScene(game, "drowned-rat", await loaded, record, { sleep: async () => {}, now: () => new Date(0), waits, backoff: [1] });

  assert.equal(game.view()?.title, "The Drowned Rat");
  assert.equal(game.view()?.mayType, true, "its opening is over");
  // The demo's end_scene takes only open-case: case-made, the first of the yard's good endings, was refused, so the next was tried.
  assert.deepEqual(record.skipped, [{ scene: "hanged-clerk", exit: "open-case", title: "Murder by persons unknown", result: "good" }]);
  assert.deepEqual(waits, []);
  await assert.rejects(reachScene(game, "hanged-clerk", await loaded, record, { sleep: async () => {}, now: () => new Date(0), waits, backoff: [1] }), /The story passed over hanged-clerk and opened drowned-rat/);
});

test("a tester's brief: their character, how they play, the commands with the round and game, where their notes go; nothing of the build", () => {
  const config = CONFIG();
  round(config, "hanged-clerk", 20);
  const text = brief(config, "r1", "g01");
  assert.match(text, /\*\*Nell Quickfingers: a sneaky halfling thief/);
  assert.match(text, /How you play: You sneak, eavesdrop/);
  assert.match(text, /npm run -s loop -- start r1 g01\n/);
  assert.match(text, /npm run -s loop -- say r1 g01 "<what you say or do>"/);
  assert.match(text, /You have up to 20 turns\./);
  assert.match(text, /write your notes to `\/tmp\/km-loop-[^`]*\/r1\/notes\/g01\.md`/);
  assert.doesNotMatch(text, /\{\{|baseline|demo|k1/);
});

test("waiting on the GM: a verb that stopped waiting, or a turn that failed, is waited on and carried on, each wait logged; the day's ceiling and a refusal aren't", async () => {
  const failed = { phase: "failed", failed: "The GM couldn't answer: 500 model_failed: OpenRouter reply HTTP 402" } as SceneView;
  assert.equal(worthWaiting({ code: 1, timedOut: true }, { note: "The GM has lost the thread for a moment: trying again." } as SceneView), "no answer yet: The GM has lost the thread for a moment: trying again. (the call log says why)");
  assert.match(worthWaiting({ code: 1 }, failed)!, /^the turn failed: The GM couldn't answer: 500 model_failed: OpenRouter reply HTTP 402$/);
  assert.equal(worthWaiting({ code: 1 }, { phase: "failed", failed: "The GM has spent today's budget ($0.20): it starts again at midnight UTC, or raise KM_AI_DAILY_USD." } as SceneView), undefined);
  assert.equal(worthWaiting({ code: 1 }, { phase: "done" } as SceneView), undefined, "a refusal: the game's words say why");
  assert.equal(worthWaiting({ code: 0 }, failed), undefined);

  let view: SceneView | undefined = failed;
  const conn = { view: () => view } as Backend;
  const waits: Array<{ why: string; ms: number }> = [];
  let tries = 0;
  const code = await patiently(conn, async () => { throw new Error("No answer in 180 s: observe again in a moment."); }, async () => {
    tries++;
    if (tries === 2) view = { phase: "done" } as SceneView;
    return tries === 2 ? 0 : 1;
  }, { sleep: async () => {}, now: () => new Date(0), waits: waits as never, backoff: [10, 20, 30] });
  assert.equal(code, 0);
  assert.equal(tries, 2);
  assert.deepEqual(waits.map(w => [w.ms, w.why.replace(/[:(].*$/, "").trim()]), [[10, "no answer yet"], [20, "the turn failed"]]);
});
