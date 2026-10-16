import { test } from "node:test";
import assert from "node:assert/strict";
import type { After, Decision, DecideResponse, SettleResponse, Suggestion, SuggestRequest, SuggestResponse, Usage } from "../../../shared/protocol/ai.ts";
import { idText, keyParts } from "../../../shared/protocol/keys.ts";
import type { MemoryHost } from "../host/memory.ts";
import { all, DEFAULTS, down, held, http, identity, openedGame, sceneNow, tick } from "../host/testing.ts";
import { queueThink } from "../jobs.ts";
import { suggest } from "./suggest.ts";

/**
 * The lines suggested after a reply (v5-design §3.3-§3.5), on the memory host: asked for after the
 * opening and every reply that leaves the scene going, while the controller has them on; landing as
 * the scene's one set of rows, or dropped when their moment has passed; asked for again at once when
 * the setting is turned back on.
 */

const usage = (calls: number, costUsd = 0): Usage => ({ calls, costUsd, byOperation: {} });
const lines = (...texts: string[]): SuggestResponse => ({ lines: texts.map(text => ({ kind: "say", text })), dropped: [], usage: usage(2, 0.0008) });
const decided = (d: Partial<Decision> = {}): DecideResponse => ({ decision: { earned: false, daft: false, outOfCharacter: false, ...d }, opened: [], usage: usage(1) });
const read = (a: Partial<After> = {}): SettleResponse => ({ ops: [], after: { landed: [], hinted: [], unanswered: false, theirs: false, ...a }, usage: usage(2) });

/** The scene's set as it stands: [turn, ord, kind, text] by ord. */
const setOf = (host: MemoryHost, sceneId: bigint) => [...host.db.sceneSuggestion.sceneId.filter(sceneId)].sort((a, b) => a.ord - b.ord).map(s => [s.turn, s.ord, s.kind, s.text]);
const asSet = (turn: number, suggestions: Suggestion[]) => suggestions.map((s, i) => [turn, i + 1, s.kind, s.text]);

test("after the opening and after each reply, the lines land as the scene's one set, for its controller, replacing the last", async () => {
  const { host, script, wren, scene } = await openedGame();
  const opening = sceneNow(host, scene.id).turns[0]!;
  assert.deepEqual(setOf(host, scene.id), asSet(0, DEFAULTS.suggest.lines));
  assert.ok(all(host.db.sceneSuggestion).every(s => s.playerId === scene.controllerId && s.gameId === scene.gameId));
  assert.deepEqual([opening.suggest, opening.suggestAsks], ["landed", 1]);

  script.then("suggest", lines("Who found him?", "Was he a drinker?"));
  host.as(wren).say({ text: "Sergeant." });
  await host.drain();

  assert.deepEqual(setOf(host, scene.id), asSet(1, lines("Who found him?", "Was he a drinker?").lines));
  const [, request] = script.to("suggest").map(s => s.body as SuggestRequest);
  const game = all(host.db.game)[0]!;
  assert.deepEqual(keyParts(request!.key), { game: game.uid, scene: String(scene.id), turn: 1, step: "suggest" });
  assert.deepEqual(request!.offered, DEFAULTS.suggest.lines.map(l => l.text), "the scene's last set, in order");
  assert.equal(request!.turn.scene.turn, 1);
  assert.deepEqual(request!.turn.transcript.map(e => [e.turn, e.kind]), [[0, "narration"], [1, "player"], [1, "narration"]]);
  assert.deepEqual(sceneNow(host, scene.id).turns.map(t => [t.suggest, t.suggestAsks]), [["landed", 1], ["landed", 1]]);
});

test("no lines clears the set, so the next ask offers nothing as already offered", async () => {
  const { host, script, wren, scene } = await openedGame();
  script.then("suggest", lines());
  host.as(wren).say({ text: "Sergeant." });
  await host.drain();
  assert.deepEqual(setOf(host, scene.id), []);
  assert.equal(sceneNow(host, scene.id).turns[1]!.suggest, "landed");

  host.as(wren).say({ text: "Who found him?" });
  await host.drain();
  assert.deepEqual((script.to("suggest")[2]!.body as SuggestRequest).offered, []);
});

test("a set overtaken by the next line is dropped when it comes: the rows stay as they were", async () => {
  const { host, script, wren, scene } = await openedGame();
  const late = held<SuggestResponse>();
  script.then("suggest", () => late.promise);

  host.as(wren).say({ text: "Sergeant." });
  const first = host.drain();
  await tick();
  await host.drain();
  assert.equal(sceneNow(host, scene.id).turns[1]!.suggest, "coming");

  host.as(wren).say({ text: "Who found him?" });
  late.settle(lines("Too late"));
  await first;

  const now = sceneNow(host, scene.id);
  assert.equal(now.turns[1]!.suggest, "dropped");
  assert.deepEqual(setOf(host, scene.id), asSet(2, DEFAULTS.suggest.lines), "turn 2's set; turn 1's never landed");
  assert.equal(script.to("suggest").filter(s => keyParts(s.key)?.turn === 1).length, 1);
  assert.match(host.logs.join("\n"), /\[scene \d+ turn 1\] lines dropped \(turn 2 has been said\)/);
});

test("a set that comes once the scene is over is dropped", async () => {
  const { host, script, wren, scene } = await openedGame();
  const late = held<SuggestResponse>();
  script.then("suggest", () => late.promise);
  host.as(wren).say({ text: "Sergeant." });
  const first = host.drain();
  await tick();
  await host.drain();

  host.transact(tx => tx.db.scene.id.update({ ...tx.db.scene.id.find(scene.id)!, status: "ended" }));
  late.settle(lines("Too late"));
  await first;

  assert.equal(sceneNow(host, scene.id).turns[1]!.suggest, "dropped");
  assert.deepEqual(setOf(host, scene.id), asSet(0, DEFAULTS.suggest.lines));
});

test("turned off, lines on their way are dropped and none are asked for; turned on, this moment's are asked for at once, as its next ask", async () => {
  const { host, script, wren, scene } = await openedGame();
  const late = held<SuggestResponse>();
  script.then("suggest", () => late.promise);
  host.as(wren).say({ text: "Sergeant." });
  const first = host.drain();
  await tick();
  await host.drain();

  assert.equal(host.as(wren).setSuggestions({ on: false }), undefined);
  assert.equal(host.db.player.id.find(scene.controllerId)!.suggestions, false);
  late.settle(lines("Unwanted"));
  await first;
  assert.equal(sceneNow(host, scene.id).turns[1]!.suggest, "dropped");
  assert.deepEqual(setOf(host, scene.id), asSet(0, DEFAULTS.suggest.lines), "the rows are left: the client shows none while they're off");

  host.as(wren).say({ text: "Who found him?" });
  await host.drain();
  assert.equal(script.to("suggest").length, 2, "none asked for after turn 2's reply");
  assert.deepEqual(sceneNow(host, scene.id).turns[2]!.suggest, "none");

  assert.equal(host.as(wren).setSuggestions({ on: true }), undefined);
  const asked = sceneNow(host, scene.id).turns[2]!;
  assert.deepEqual([asked.suggest, asked.suggestAsks], ["coming", 1]);
  await host.drain();
  assert.deepEqual(setOf(host, scene.id), asSet(2, DEFAULTS.suggest.lines));
  assert.deepEqual(keyParts(script.to("suggest")[2]!.key)?.turn, 2);
  assert.equal(script.to("suggest")[2]!.key.endsWith(":t2:suggest"), true, "turn 2's first ask");
});

test("turned back on with no lines for this moment, they're asked for again: the turn's second ask, keyed suggest-2", async () => {
  const { host, script, wren, scene } = await openedGame();
  script.then("suggest", lines());
  host.as(wren).say({ text: "Sergeant." });
  await host.drain();

  host.as(wren).setSuggestions({ on: false });
  host.as(wren).setSuggestions({ on: true });
  const turn = sceneNow(host, scene.id).turns[1]!;
  assert.deepEqual([turn.suggest, turn.suggestAsks], ["coming", 2]);
  assert.equal(host.as(wren).setSuggestions({ on: true }), undefined);
  assert.equal(all(host.db.job).filter(j => j.move === "suggest").length, 1, "never twice while they're coming");
  await host.drain();

  const keys = script.to("suggest").map(s => s.key);
  assert.deepEqual(keys.slice(1).map(k => k.split(":").pop()), ["suggest", "suggest-2"]);
  assert.deepEqual(keyParts(keys[2]!), { game: all(host.db.game)[0]!.uid, scene: String(scene.id), turn: 1, step: "suggest", ask: 2 });
  assert.deepEqual(setOf(host, scene.id), asSet(1, DEFAULTS.suggest.lines));
});

test("set_suggestions asks for nothing when this moment has its lines, nor for a spectator, whose setting is their own; and refuses a caller with no seat", async () => {
  const { host, wren, scene } = await openedGame();
  const tamsin = identity(2);
  assert.deepEqual(host.as(identity(9)).setSuggestions({ on: true }), { code: "not_in_game", text: "(You're not in a game: start one, or watch someone's.)" });

  assert.equal(host.as(wren).setSuggestions({ on: true }), undefined);
  assert.equal(all(host.db.job).length, 0, "turn 0's lines are here");

  host.as(tamsin).joinGame({ game: scene.gameId });
  host.transact(tx => tx.db.sceneSuggestion.sceneId.delete(scene.id));
  assert.equal(host.as(tamsin).setSuggestions({ on: false }), undefined);
  assert.equal(host.as(tamsin).setSuggestions({ on: true }), undefined);
  const players = all(host.db.player).map(p => [p.role, p.suggestions]);
  assert.deepEqual(players, [["host", true], ["spectator", true]]);
  assert.equal(all(host.db.job).length, 0, "a spectator leads nothing: no lines asked for");
});

test("turned on while a turn waits for /retry after its settle failed, this moment's lines are asked for at once (its reply is in); not for a turn that failed before its reply", async () => {
  const { host, script, wren, scene } = await openedGame();
  const turn = (n: number) => sceneNow(host, scene.id).turns[n]!;
  const asks = () => all(host.db.job).filter(j => j.move === "suggest").length;
  host.as(wren).setSuggestions({ on: false });
  script.then("settle", http(400));
  host.as(wren).say({ text: "Sergeant." });
  await host.drain();
  assert.deepEqual([turn(1).phase, turn(1).suggest], ["failed", "none"], "off at the reply: none asked for");

  assert.equal(host.as(wren).setSuggestions({ on: true }), undefined);
  assert.deepEqual([turn(1).suggest, turn(1).suggestAsks, asks()], ["coming", 1, 1]);
  await host.drain();
  assert.deepEqual(setOf(host, scene.id), asSet(1, DEFAULTS.suggest.lines), "they land while the turn waits, as lines asked for at the reply would");

  assert.equal(host.as(wren).retryTurn({ turn: turn(1).id }), undefined);
  await host.drain();
  assert.deepEqual([turn(1).phase, turn(1).suggest, script.to("suggest").length], ["done", "landed", 2], "the retried settle asks for none again");
  assert.deepEqual(setOf(host, scene.id), asSet(1, DEFAULTS.suggest.lines));

  host.as(wren).setSuggestions({ on: false });
  script.then("decide", http(400));
  host.as(wren).say({ text: "Who found him?" });
  await host.drain();
  assert.equal(host.as(wren).setSuggestions({ on: true }), undefined);
  assert.deepEqual([turn(2).phase, turn(2).suggest, asks()], ["failed", "none", 0], "no reply yet: no lines to follow it, until its retry's reply asks");
});

test("lines that can't be had are given up after 60 s: the moment has none, and nothing is said on the turn", async () => {
  const { host, script, wren, scene } = await openedGame();
  for (let i = 0; i < 20; i++) script.then("suggest", down());
  host.as(wren).say({ text: "Sergeant." });
  await host.drain();
  assert.deepEqual(sceneNow(host, scene.id).turns.map(t => [t.phase, t.note]), [["done", undefined], ["done", undefined]], "the turn waits for no lines");

  for (let s = 0; s < 60; s += 15) {
    host.advance(15_000);
    await host.drain();
  }

  assert.deepEqual([sceneNow(host, scene.id).turns[1]!.suggest, sceneNow(host, scene.id).turns[1]!.note], ["lost", undefined]);
  assert.deepEqual(setOf(host, scene.id), [], "the last set cleared, as an empty one would be");
  assert.match(host.logs.join("\n"), /:t1:suggest gave up: no answer for 60 s/);
  assert.match(host.logs.join("\n"), /\[scene \d+ turn 1\] lines lost: the set cleared/);
});

test("a reply that ends the scene asks for no lines; a wind-down out of character does", async () => {
  const { host, script, wren, scene } = await openedGame();
  const say = async (text: string, decide = decided(), settle?: SettleResponse) => {
    script.then("decide", decide);
    if (settle) script.then("settle", settle);
    host.as(wren).say({ text });
    await host.drain();
  };
  const askedFor = () => script.to("suggest").map(s => keyParts(s.key)!.turn);

  await say("I'll take the page to the King myself.", decided(), read({ ending: { exitId: "case-made", probability: 0.9 }, theirs: true }));
  await say("(ooc: can I still look around?)", decided({ outOfCharacter: true }));
  assert.deepEqual(askedFor(), [0, 1, 2], "the scene is closing, but this reply was out of character: it goes on");
  await say("Thank you, Sergeant.");
  assert.equal(sceneNow(host, scene.id).scene.status, "ended");
  assert.deepEqual(askedFor(), [0, 1, 2], "the wind-down's reply closed the scene");

  const { host: again, script: script2, wren: wren2 } = await openedGame();
  script2.then("decide", decided({ route: { id: "walk-away", phase: "attempt" } }));
  again.as(wren2).say({ text: "*I walk out of the gate.*" });
  await again.drain();
  assert.deepEqual(script2.to("suggest").map(s => keyParts(s.key)!.turn), [0], "a route into an ending closes the scene in its reply");
});

test("a reply that ends the scene gets no lines while it settles, the scene still live: set_suggestions asks for none, and a set for it that comes is dropped", async () => {
  const { host, script, wren, scene } = await openedGame();
  const settle = held<SettleResponse>();
  script.then("decide", decided({ route: { id: "walk-away", phase: "attempt" } }));
  script.then("settle", () => settle.promise);
  host.as(wren).say({ text: "*I walk out of the gate.*" });
  const first = host.drain();
  await tick();
  await host.drain();

  const settling = sceneNow(host, scene.id);
  assert.deepEqual([settling.scene.status, settling.turns[1]!.phase, settling.gm.ended?.exitId], ["live", "settling", "walked-away"]);
  assert.equal(host.as(wren).setSuggestions({ on: true }), undefined);
  assert.deepEqual([all(host.db.job).filter(j => j.move === "suggest").length, sceneNow(host, scene.id).turns[1]!.suggest], [0, "none"], "nothing asked for the closing reply");

  const turn = settling.turns[1]!;
  script.then("suggest", lines("A line for a scene that's over"));
  host.transact(tx => queueThink(tx, suggest, { step: "suggest", game: idText(scene.gameId), scene: idText(scene.id), turn: idText(turn.id), n: 1, ask: 1 }));
  await host.drain();
  assert.deepEqual([sceneNow(host, scene.id).turns[1]!.suggest, setOf(host, scene.id)], ["dropped", asSet(0, DEFAULTS.suggest.lines)], "a set that comes before the settle ends the scene is dropped, the rows left");
  assert.match(host.logs.join("\n"), /\[scene \d+ turn 1\] lines dropped \(the scene is over\)/);

  settle.settle(read());
  await first;
  assert.deepEqual([sceneNow(host, scene.id).scene.status, sceneNow(host, scene.id).turns[1]!.phase], ["ended", "done"]);
});

test("lines given up once their moment has passed are lost, and leave the set that's there", async () => {
  const { host, script, wren, scene } = await openedGame();
  const refused = down();
  const turnOne = (request: SuggestRequest) => (keyParts(request.key)!.turn === 1 ? refused() : lines("Turn 2's line"));
  for (let i = 0; i < 20; i++) script.then("suggest", turnOne);

  host.as(wren).say({ text: "Sergeant." });
  await host.drain();
  host.as(wren).say({ text: "Who found him?" });
  await host.drain();
  assert.deepEqual(setOf(host, scene.id), asSet(2, lines("Turn 2's line").lines));

  for (let s = 0; s < 60; s += 15) {
    host.advance(15_000);
    await host.drain();
  }
  assert.deepEqual(sceneNow(host, scene.id).turns.map(t => t.suggest), ["landed", "lost", "landed"]);
  assert.deepEqual(setOf(host, scene.id), asSet(2, lines("Turn 2's line").lines));
  assert.match(host.logs.join("\n"), /\[scene \d+ turn 1\] lines lost \(turn 2 has been said\)/);
});
