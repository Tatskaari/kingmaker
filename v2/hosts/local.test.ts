import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Identity } from "spacetimedb";
import type { FakeOptions } from "../ai/llm/fake-openrouter.ts";
import type { Markup } from "../shared/markup.ts";
import { rollFrom } from "../shared/dice.ts";
import { all, sceneNow } from "../simulation/src/host/testing.ts";
import { devFake, onTop, quietGm } from "./dev/fake.ts";
import { localHost, type LocalHost } from "./local.ts";

/**
 * The local host (v0-design §10.3, v5-design §4.3): the simulation and the AI service's pipeline in
 * one process, on the fake model, every body through JSON. The scene's endings as the prototype
 * plays them (gm-port §16.4: its endings.test.ts and gates.test.ts), each turn said, decided, replied
 * and settled by the real code on both sides, the model's decisions scripted a turn at a time; then
 * the reply as drawn: the notes the turn waits for, and the lines suggested after it; and the story
 * crossing a boundary (story-design §5): the simulation's job asking the pipeline's boundary.
 */

const WREN = new Identity(0x1001n);
const REPLY = "Kell looks at you a long moment. “Go on.”";

/**
 * A new game on the local host, its opening played as `opening` says; `say` says the next line with
 * the model answering as `fake` says, and `line` does and runs the jobs it makes. A line's fake goes
 * on the full GM's quiet answers (full-gm-design §4.4): each turn's memory review flags only what was
 * witnessed, and the co-GM, every third turn, finds the scene on track.
 */
async function game(seed = 7, opening: FakeOptions = {}) {
  let next = opening;
  const local = await localHost({ seed, fake: () => next });
  assert.equal(local.sim.as(WREN).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a quick-witted investigator lent to the case by the King", build: "ranger" }), undefined);
  await local.sim.drain();
  const scene = all(local.sim.db.scene)[0]!;
  const now = () => sceneNow(local.sim, scene.id);

  const say = (text: string, fake: FakeOptions = {}) => {
    next = onTop(quietGm(), { replies: [REPLY], ...fake });
    const refused = local.sim.as(WREN).say({ text });
    assert.equal(refused, undefined, `"${text}" was refused: ${refused?.text}`);
  };
  const line = async (text: string, fake: FakeOptions = {}) => {
    say(text, fake);
    await local.sim.drain();
    return now();
  };
  return { local, scene, say, line, now };
}

/** Each model call the AI service made for the game, done (the call log's lines with a request). */
function calls(local: LocalHost): Array<{ key: string; operation: string; request: { input?: Array<{ content: string }> } }> {
  const uid = all(local.sim.db.game)[0]!.uid;
  return readFileSync(join(local.store, "games", uid, "calls.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l)).filter(e => e.request);
}

/** What the GM was told for the latest reply: the last of its input, the turn's note (the prototype's `told`). */
const told = (local: LocalHost) => calls(local).filter(c => c.operation === "gm.reply" || c.operation === "gm.closing").at(-1)!.request.input!.at(-1)!.content;

const sayNow = (local: LocalHost, text: string) => local.sim.as(WREN).say({ text });

test("a line on the local host: the opening and the reply streamed into their drafts, each step's answer committed, each reply's notes and lines asked for, the turn done", async () => {
  const { local, line, now } = await game();
  const opening = now();
  assert.equal(opening.scene.status, "live");
  assert.ok(opening.turns[0]!.firstTextAt, "the opening streamed through stream_reply");

  const after = await line("Sergeant, who found him?");
  const turn = after.turns[1]!;
  assert.deepEqual([turn.phase, turn.error], ["done", undefined]);
  assert.ok(turn.firstTextAt, "the reply streamed");
  assert.ok(turn.calls > 0 && turn.costMicros > 0n, "the answers' usage is on the turn");
  assert.deepEqual(after.lines.slice(-2).map(l => [l.kind, l.text]), [["player", "Sergeant, who found him?"], ["narration", REPLY]]);
  assert.equal(all(local.sim.db.replyDraft).length, 0, "the reply's commit deleted its draft");
  assert.deepEqual(local.aiLogs.filter(l => /: 200 in/.test(l)).map(l => l.split(" ")[1]), ["open", "notes", "suggest", "decide", "reply", "notes", "suggest", "settle", "remember"]);
  local.close();
});

test("a word out of character isn't an exchange: the scene's clock doesn't move", async () => {
  const { local, line } = await game();
  const ooc = await line("(out of character: what can I do here?)", { choices: { ooc: "out_of_character" } });
  assert.deepEqual([ooc.gm.turnsInBeat, ooc.gm.oocTurns], [0, [1]], "no exchange counted");
  const plain = await line("Who found him, Sergeant?");
  assert.equal(plain.gm.turnsInBeat, 1, "an exchange in character counts");
  local.close();
});

test("an ending found after the reply that isn't the player's own doing waits for their answer; an answer holds it once; then it lands", async () => {
  const { local, line } = await game();
  const cart = await line("*I wait by the gate.*", { choices: { cue: "cart-comes" } });
  assert.equal(cart.gm.beat, "dead-cart");

  const signed = await line("Kell, I'm worried. Can you protect these kids until we get to the bottom of this?", { choices: { outcome: "held-as-murder" } });
  assert.equal(signed.scene.status, "live", "no wind-down turn");
  assert.equal(signed.gm.closing, undefined);
  assert.deepEqual(signed.gm.pendingExit, { exitId: "open-case", turn: 2, via: "held-as-murder", extended: false, waits: "it isn't the player's own doing" });

  // Their answer (a question to Cob) holds it once more, and gets a real reply.
  const asked = await line("Cob, you'll be safe. Can you tell me exactly what you heard and saw?", { choices: { brink: "answers" } });
  assert.equal(asked.scene.status, "live");
  assert.match(told(local), /The scene is on the brink of: Murder by persons unknown .*It hasn't closed: the player is answering it/s);
  assert.equal(asked.gm.pendingExit?.extended, true);

  // Then, with nothing changing it, it lands, with their turn answered first.
  const done = await line("Right. Thank you, Sergeant.");
  assert.match(told(local), /This reply closes the scene: .*Answer the player's turn first: if they ask someone here something, or challenge or call someone out, that person hears it and answers/s);
  assert.deepEqual([done.scene.status, done.scene.exitKey, done.scene.turnId], ["ended", "open-case", undefined]);
  assert.deepEqual(done.lines.at(-1)!.text, "Scene ends: Murder by persons unknown");
  assert.equal(sayNow(local, "Wait!")?.code, "scene_over");
  local.close();
});

test("an ending the player chose, with nothing left hanging, gets one wind-down turn, where a challenge still lands", async () => {
  const { local, line } = await game();
  const chose = await line("We're done here, Sergeant. Write him up as murdered and let's take it to the King.", { choices: { ending: "open-case", own_exit: "theirs" } });
  assert.deepEqual(chose.gm.closing, { exitId: "open-case", turn: 1 });
  assert.deepEqual([chose.scene.status, chose.gm.pendingExit], ["closing", undefined]);

  const close = await line("*to Moll, on the way out* You lied about seeing him jump.");
  assert.match(told(local), /The scene is ending: .*Answer the player's turn first: .*challenge or call someone out, that person hears it and answers in their own way and character \(a reaction, a retort, a slip\), so it lands/s);
  assert.equal(calls(local).filter(c => c.key.endsWith(":t2:decide")).map(c => c.operation).join(), "director.ooc", "a wind-down asks only whether it's out of character");
  assert.deepEqual([close.scene.status, close.scene.exitKey, close.lines.at(-1)!.text], ["ended", "open-case", "Scene ends: Murder by persons unknown"]);
  assert.equal(close.turns[2]!.phase, "done");
  local.close();
});

test("a question the reply left unanswered holds an ending the player chose", async () => {
  const { local, line } = await game();
  const held = await line("Shall we go, Sergeant? And who found him?", { choices: { ending: "open-case", own_exit: "theirs", ask: "unanswered" } });
  assert.deepEqual([held.gm.pendingExit?.exitId, held.gm.pendingExit?.waits], ["open-case", "the player asked something the reply left unanswered"]);
  assert.deepEqual([held.scene.status, held.gm.closing], ["live", undefined]);
  local.close();
});

test("a word out of character never closes an ending held or winding down: it's answered, and the turn is given back", async () => {
  const { local, line } = await game();
  const held = await line("Shall we go, Sergeant? And who found him?", { choices: { ending: "open-case", own_exit: "theirs", ask: "unanswered" } });
  const answer = await line("(out of character: so what am I meant to do here? Feel a bit stuck)", { choices: { ooc: "out_of_character" } });
  assert.equal(answer.scene.status, "live");
  assert.deepEqual(answer.gm.pendingExit, held.gm.pendingExit, "as it was: not spent, not taken");
  assert.match(told(local), /Nothing in the story moves on while you answer: the scene is on the brink of Murder by persons unknown, which hasn't happened yet/);
  assert.match(told(local), /If they're stuck or ask what they can do, name two or three concrete things in front of them/);
  assert.doesNotMatch(told(local), /This reply closes the scene|going in circles/, "no close, and no push to break the loop");
  assert.equal(answer.gm.turnsInBeat, held.gm.turnsInBeat);
  local.close();

  // On a wind-down turn too: the close waits for their next turn in character.
  const winding = await game();
  const closing = await winding.line("We're done here, Sergeant.", { choices: { ending: "open-case", own_exit: "theirs" } });
  const asked = await winding.line("(ooc: before we go, is there anything else here I missed?)", { choices: { ooc: "out_of_character" } });
  assert.deepEqual([asked.scene.status, asked.gm.closing], ["closing", closing.gm.closing]);
  assert.match(told(winding.local), /it closes on the player's next turn in character, not in this reply/);
  const gone = await winding.line("Let's go.");
  assert.deepEqual([gone.scene.status, gone.scene.exitKey], ["ended", "open-case"]);
  winding.local.close();
});

test("the same push again gets the answer it got before, and nothing more: no second roll", async () => {
  const { local, scene, line } = await game();
  const modifier = (JSON.parse(all(local.sim.db.sheet)[0]!.skills) as Record<string, number>).intimidation!;
  local.sim.transact(tx => {
    const dice = tx.db.dice.gameId.find(scene.gameId)!;
    tx.db.dice.gameId.update({ ...dice, seed: failingSeed("intimidation", 12, modifier), rolls: 0 });
  });

  const failed = await line("*plants herself in the gateway* Nobody leaves! Come back here, or the watch drags you back by your ear!", { choices: { attempt: "scare-kids" } });
  assert.equal(failed.gm.path.at(-1)?.roll?.success, false, "the seed's first roll fails");
  const rolls = local.sim.db.dice.gameId.find(scene.gameId)!.rolls;

  const again = await line("*stamps a boot* I said nobody leaves! Come back here!", { choices: { attempt: "scare-kids", same_again: "again_0" } });
  assert.equal(again.gm.path.at(-1)?.via, "same-again:scare-kids");
  assert.equal(local.sim.db.dice.gameId.find(scene.gameId)!.rolls, rolls, "no second roll");
  assert.match(told(local), /it gets the same answer it got before: Cob bolts behind the water butt/);
  assert.doesNotMatch(told(local), /going in circles/);
  local.close();
});

test("an outcome after the reply that keeps the scene where it was doesn't throw away where it stands: an ending that leads twice is reached", async () => {
  const { local, line } = await game();
  const reading = { choices: { outcome: "kind-to-cob", ending: "open-case", own_exit: "theirs" }, odds: { ending: 0.5 } };
  const once = await line("*I hand Cob the heel of my bread and ask for nothing.*", reading);
  assert.ok(once.gm.established.some(f => /kindness/i.test(f)), "the kindness is established");
  assert.equal(once.gm.beat, "yard", "and the scene is where it was");
  assert.deepEqual([once.gm.endingLead?.exitId, once.gm.endingLead?.count, once.gm.closing], ["open-case", 1, undefined], "not yet: once, at 0.5");

  const twice = await line("Come on, Sergeant. We know enough: it's murder, and the King will hear it.", reading);
  assert.deepEqual(twice.gm.closing, { exitId: "open-case", turn: 2 }, "leading twice, it's reached, and it's their own doing");
  local.close();
});

test("the same seed and the same lines give the same dice lines", async () => {
  const lines: Array<[string, FakeOptions]> = [
    ["*I climb up and look closely at Prout's neck and hands.*", { choices: { attempt: "examine-body" } }],
    ["Moll, you never saw him jump. Who paid you to say it?", { choices: { attempt: "catch-moll" } }],
  ];
  const play = async () => {
    const { local, line } = await game(11);
    for (const [text, fake] of lines) await line(text, fake);
    const rolled = (await line("Hm.")).lines.filter(l => l.kind === "roll").map(l => l.text);
    local.close();
    return rolled;
  };

  const first = await play();
  assert.equal(first.length, 2, "both checks were rolled");
  assert.deepEqual(await play(), first);
});

/** A dice seed whose first roll fails this check (the prototype's plainSeed, the other way round). */
function failingSeed(skill: "intimidation", dc: number, modifier: number): number {
  for (let seed = 1; ; seed++) if (!rollFrom({ seed, rolls: 0 }, skill, dc, modifier).roll.success) return seed;
}

// ---------------------------------------------------------------------------------------------
// The reply as drawn (v5-design §4.3): the notes on a reply's marks, which its turn waits for, and
// the lines suggested after it. The model plays the dev host's fake (hosts/dev/fake.json): the GM's
// golden replies, a turn each from the opening, the notes written on their words, twelve lines.

const LINES = ["Sergeant, who found him?", "Moll, did you really see him jump from up on that wall?", "(out of character: what can I do here?)"];

/** The dev host's fake, answering at once but where `timing` holds the notes or the lines back. */
const drawn = (timing: FakeOptions = {}): FakeOptions => ({ ...devFake(), streamMs: 0, byNameDelayMs: {}, suggestDelayMs: 0, ...timing });

test("a reply's notes land on its row, and its turn waits for them: noting once the world has settled, done when they're in", async t => {
  const { local, say, now } = await game(7, drawn());
  const jobs = procedures(local, t);
  say(LINES[0]!, drawn({ byNameDelayMs: { notes: 1000 } }));

  const noting = await jobs.until("turn 1 noting", () => now().turns[1]?.phase === "noting" && now());
  assert.deepEqual(marksOf(replyOf(noting, 1)), [], "no marks until the notes are in");
  const own = noting.jobs.filter(j => j.turnId === noting.turns[1]!.id).map(j => j.move);
  assert.ok(own.includes("notes") && !own.includes("say"), `the settle is in, and the notes are still being written (${own.join(", ")})`);
  assert.equal(noting.scene.turnId, noting.turns[1]!.id, "the turn keeps the lease");

  const done = await jobs.until("turn 1 done", () => now().turns[1]?.phase === "done" && now());
  await jobs.stop();
  const reply = replyOf(done, 1);
  assert.deepEqual(marksOf(reply).map(m => [m.kind, reply.text.slice(m.start, m.end), m.link?.kind === "person" ? m.link.id : undefined, m.card?.title]), [
    ["why", "I haven’t written that down.", "kell", "Sergeant Agnes Kell"],
    ["why", "And Cob don’t talk to bluebottles.", "cob", "Cob"],
  ]);
  assert.equal(done.turns[1]!.notes, "written");
  local.close();
});

test("a line said while the turn is noting waits, and starts once the notes are in: its reply's history has them", async t => {
  const { local, say, now } = await game(7, drawn());
  const jobs = procedures(local, t);
  say(LINES[0]!, drawn({ byNameDelayMs: { notes: 1000 } }));
  await jobs.until("turn 1 noting", () => now().turns[1]?.phase === "noting");

  say(LINES[1]!, drawn());
  assert.equal(now().turns[2]!.phase, "queued", "it waits for turn 1's notes");
  await jobs.until("turn 2 done", () => now().turns[2]?.phase === "done");
  await jobs.stop();

  const written = local.sim.logs.findIndex(l => /\[scene \d+ turn 1\] notes written: 2/.test(l));
  const started = local.sim.logs.findIndex(l => /:t2:decide attempt 1\]/.test(l));
  assert.ok(written >= 0 && written < started, "turn 2 was decided only after turn 1's notes were written");
  const history = calls(local).filter(c => c.operation === "gm.reply" && c.key.endsWith(":t2:reply")).at(-1)!.request.input!.map(m => m.content).join("\n");
  assert.ok(history.includes("(I haven’t written that down.)[why: Kell won’t put the Captain’s verdict in her book until she has seen for herself.]"), "the GM's history has turn 1's notes as it writes them");
  local.close();
});

test("a set of lines whose moment has passed is dropped when it comes: the last set's rows stay, and it cost one call", async t => {
  const { local, say, now } = await game(7, drawn());
  const jobs = procedures(local, t);
  say(LINES[0]!, drawn({ suggestDelayMs: 1000 }));
  await jobs.until("turn 1 done, its lines still coming", () => now().turns[1]?.phase === "done" && now().turns[1]!.suggest === "coming");

  say(LINES[1]!, drawn({ suggestDelayMs: 2000 }));
  const dropped = await jobs.until("turn 1's lines dropped", () => now().turns[1]?.suggest === "dropped" && rowsOf(local));
  assert.deepEqual([...new Set(dropped.map(r => r.turn))], [0], "the opening's set stays until turn 2's comes");
  await jobs.until("turn 2's lines", () => now().turns[2]?.suggest === "landed");
  await jobs.stop();

  assert.deepEqual([...new Set(rowsOf(local).map(r => r.turn))], [2]);
  assert.equal(calls(local).filter(c => c.operation === "scene.suggest" && c.key.endsWith(":t1:suggest")).length, 1);
  assert.match(local.sim.logs.join("\n"), /\[scene \d+ turn 1\] lines dropped \(turn 2 has been said\)/);
  local.close();
});

test("notes the model can't write leave the reply with no marks, and its turn ends all the same", async () => {
  const { local, line } = await game(7, drawn());
  const after = await line(LINES[0]!, drawn({ capped: { notes: 0.0002 } }));
  assert.deepEqual([after.turns[1]!.phase, after.turns[1]!.notes, after.turns[1]!.error], ["done", "written", undefined]);
  assert.deepEqual(marksOf(replyOf(after, 1)), []);
  assert.ok(markupOf(replyOf(after, 1)).speech.length > 0, "who says what is kept");
  local.close();
});

test("the story on the local host: a scene ended by its owner crosses the boundary through the pipeline, the Rat waits with what was handed on, and walk opens it with the story so far (story-design §5)", async () => {
  const { local, scene } = await game();
  const id = all(local.sim.db.game)[0]!.id;
  assert.equal(local.sim.as(local.sim.owner).endScene({ game: id, exit: "open-case" }), undefined);
  await local.sim.drain();

  const chapter = local.sim.db.chapter.sceneId.find(scene.id)!;
  assert.match(chapter.summary, /^Previous scene, "The Hanged Clerk", ended: Murder by persons unknown \(hanged-clerk: open-case\)\.\n/);
  const key = `${all(local.sim.db.game)[0]!.uid}:s${scene.id}:t0:boundary`;
  assert.deepEqual(["handoff", "boundary", "fronts"].map(op => calls(local).filter(c => c.key === key && c.operation === op).length), [1, 1, 1], "the hand-off, the verdict and the fronts, once each under the ended scene's last turn");
  const rat = all(local.sim.db.scene).find(s => s.sceneKey === "drowned-rat")!;
  assert.deepEqual([rat.status, rat.time, all(local.sim.db.game)[0]!.leadScene], ["waiting", "evening", "drowned-rat"]);
  assert.ok(local.sim.db.gmState.sceneId.find(rat.id)!.owed.some(o => o.id === "page"), "the page is owed into the Rat");

  assert.equal(local.sim.as(WREN).walk({ toward: "lead" }), undefined);
  await local.sim.drain();
  assert.equal(local.sim.db.scene.id.find(rat.id)!.status, "live");
  const opening = calls(local).find(c => c.key.endsWith(`:s${rat.id}:t0:open`) && c.operation === "gm.opening")!.request.input!.map(m => m.content).join("\n");
  assert.match(opening, /What happened just before this scene[\s\S]*Previous scene, "The Hanged Clerk", ended/);
  local.close();
});

test("the same seed and the same lines give the same notes and the same suggested lines", async () => {
  const play = async () => {
    const { local, line, now } = await game(11, drawn());
    const sets = [rowsOf(local).map(r => `${r.kind}: ${r.text}`)];
    for (const text of LINES) {
      await line(text, drawn());
      sets.push(rowsOf(local).map(r => `${r.kind}: ${r.text}`));
    }
    const marks = now().lines.filter(l => l.speaker === "gm").map(l => marksOf(l));
    local.close();
    return { marks, sets };
  };

  const first = await play();
  assert.equal(first.marks.flat().length, 7, "every reply has its notes");
  assert.ok(first.sets.every(set => set.length >= 3), "and its lines");
  assert.deepEqual(await play(), first);
});

/**
 * The job loop as SpacetimeDB runs it, each dispatch in a procedure of its own: drains side by side,
 * so a think the fake holds back (the notes, the lines) holds up nothing else. `until` waits for the
 * rows to pass a test; `stop` lets what's running finish, and the test's end stops it too.
 */
function procedures(local: LocalHost, t: TestContext) {
  const running = new Set<Promise<void>>();
  const failed: unknown[] = [];
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const drain = local.sim.drain().catch(e => { failed.push(e); });
      running.add(drain);
      void drain.finally(() => running.delete(drain));
      await new Promise(resolve => setTimeout(resolve, 2));
    }
  })();

  const stop = async (): Promise<void> => {
    stopped = true;
    await loop;
    await Promise.all(running);
    await local.sim.drain();
    if (failed.length) throw failed[0];
  };
  t.after(stop);

  return {
    stop,
    async until<T>(what: string, test: () => T | undefined | false, ms = 10_000): Promise<T> {
      for (const deadline = performance.now() + ms; performance.now() < deadline; await new Promise(resolve => setTimeout(resolve, 2))) {
        const found = test();
        if (found) return found;
      }
      throw new Error(`waited ${ms} ms for ${what}`);
    },
  };
}

type Scene = ReturnType<typeof sceneNow>;
type Entry = Scene["lines"][number];

/** Turn n's reply: the GM's entry. */
const replyOf = (scene: Scene, n: number): Entry => scene.lines.find(l => l.turn === n && l.speaker === "gm")!;
const markupOf = (entry: Entry): Markup => JSON.parse(entry.markup ?? '{"speech":[],"marks":[]}') as Markup;
const marksOf = (entry: Entry) => markupOf(entry).marks;

/** The scene's suggested lines, in order. */
const rowsOf = (local: LocalHost) => all(local.sim.db.sceneSuggestion).sort((a, b) => a.ord - b.ord);
