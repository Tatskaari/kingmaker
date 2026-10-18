import { test } from "node:test";
import assert from "node:assert/strict";
import type { FightBoard, FightEvent, FightOptions } from "../../../shared/fight/types.ts";
import type { BoardTurnRequest, BoardTurnResponse, NarrateRequest, ReplyResponse } from "../../../shared/protocol/ai.ts";
import { all, hostWithCampaign, identity, installZoo, sceneNow } from "../host/testing.ts";
import type { MemoryHost } from "../host/memory.ts";
import { eventsOf, fightOf } from "./rows.ts";

/**
 * The GM on the board (docs/combat-gm.md; the user: "make it so the GM still narrates what happens in
 * the log, and if I click on it, I can still narrate what I do"), on the zoo's toll with the AI
 * service scripted: each turn the board plays is told by the GM in the fight's log, after the turn's
 * last moment (and the next of the other side's turns waits for it); the player's turn in their own
 * words is the GM's to play on the board, an option at a time, its words in the log with what the
 * board made of it.
 */

const usage = { calls: 1, costUsd: 0.001, byOperation: {} };

/** A visit to the toll, its fight broken out and set out on the board. */
async function atTheToll() {
  const { host, script } = hostWithCampaign(7, { map: true });
  installZoo(host);
  const wren = identity(1);
  assert.equal(host.as(wren).visitZoo({ exhibit: "toll", build: "fighter" }), undefined);
  await host.drain();
  const game = all(host.db.game).find(g => g.campaign === "zoo")!;
  const scene = all(host.db.scene).find(s => s.gameId === game.id)!;
  script.then("reply", { entries: [{ speaker: "gm", kind: "narration", text: "The talking Crake drops the cup. Roll for initiative!" }], gm: {}, firstTextMs: 3, initiative: { foes: ["crake-1", "crake-2"], allies: ["kell"], why: "the toll refused with a fist" }, usage } satisfies ReplyResponse);
  assert.equal(host.as(wren).say({ text: "I punch the talking one in the mouth." }), undefined);
  await host.drain();
  assert.equal(sceneNow(host, scene.id).scene.status, "fighting");
  assert.equal(host.as(wren).fightItOut(), undefined);
  return { host, script, wren, game, scene };
}

const fightRow = (host: MemoryHost, gameId: bigint) => host.transact(tx => fightOf(tx, gameId))!;
const events = (host: MemoryHost, gameId: bigint): FightEvent[] => { const id = fightRow(host, gameId).id; return host.transact(tx => eventsOf(tx, id)); };
const boardNow = (host: MemoryHost, gameId: bigint) => JSON.parse(fightRow(host, gameId).board) as FightBoard;

/** The other side's turns played (their tellings drained as they come), until the player's turn, and the last of them told. */
async function toPlayer(host: MemoryHost, gameId: bigint): Promise<void> {
  for (let i = 0; i < 80; i++) {
    const f = fightRow(host, gameId);
    if (f.status !== "on" || f.options) { await host.drain(); return; }
    await host.drain();
    host.advance(1000);
    host.fightSteps();
  }
  assert.fail("the turn never came round to the player");
}

test("each turn the board plays is told by the GM in the fight's log, after its last moment, the board's moments and dice handed over; the next turn waits for the telling", async () => {
  const { host, script, game } = await atTheToll();
  await toPlayer(host, game.id);
  // Someone's turn before the player's (the Crakes or Kell), told.
  const told = events(host, game.id).filter(e => e.kind === "gm");
  const asked = script.to("narrate").map(s => s.body as NarrateRequest);
  if (fightRow(host, game.id).order[0] === "player") {
    assert.equal(told.length, 0, "nothing played before the player's first turn");
    host.as(identity(1)).fightTurn({ act: "end_turn" });
    await toPlayer(host, game.id);
  }
  const now = events(host, game.id);
  const tellings = now.filter(e => e.kind === "gm");
  const requests = script.to("narrate").map(s => s.body as NarrateRequest);
  assert.ok(tellings.length >= 1 && requests.length === tellings.length, `${tellings.length} told, ${requests.length} asked (${asked.length} before)`);
  for (const [i, t] of tellings.entries()) {
    assert.equal(t.caption, "Steel rings on steel.");
    const after = t.detail.after!;
    const turn = requests[i]!;
    assert.ok(turn.moments.length > 0 && turn.moments[0]!.kind === "turn", JSON.stringify(turn.moments.map(m => m.kind)));
    assert.equal(now.find(e => e.seq === after)?.kind !== "gm", true, "after one of the board's moments");
    assert.ok(turn.fight.fighters.some(f => f.id === "player" && f.name === "you"), "the player as \"you\"");
    assert.ok(turn.key.includes(`:narrate-${after}`), turn.key);
  }
  assert.equal(boardNow(host, game.id).telling, undefined, "nothing waited on once told");
});

test("the player's turn in their own words: their line in the log, the GM's attempt before what the board made of it, the next step asked with that, and the turn's end; the menu waits meanwhile", async () => {
  const { host, script, wren, game } = await atTheToll();
  await toPlayer(host, game.id);
  const options = JSON.parse(fightRow(host, game.id).options) as FightOptions;
  const blow = options.actions.find(a => a.kind === "attack" && a.target?.startsWith("crake")) ?? options.actions.find(a => a.id.startsWith("walk@"))!;
  const moves: BoardTurnResponse["move"][] = [
    blow.kind === "attack" ? { kind: "act", id: blow.id, narration: "You drive a fist at the talking one." } : { kind: "toward", target: "crake-1", narration: "You go for the talking one." },
    { kind: "end_turn", narration: "He staggers back, spitting blood." },
  ];
  for (const move of moves) script.then("fight", { move, entries: [{ speaker: "gm", kind: "narration", text: move.narration }], usage } satisfies BoardTurnResponse);
  const seen = fightRow(host, game.id).seq;
  assert.equal(host.as(wren).fightSay({ text: "I punch the talking one again." }), undefined);
  assert.equal(boardNow(host, game.id).thinking, true, "the GM is playing it");
  assert.equal(host.as(wren).fightTurn({ act: "dodge" })?.text, "(The GM is playing what you said: a moment.)");
  await host.drain();

  const turn = events(host, game.id).filter(e => e.seq > seen);
  assert.deepEqual(turn[0] && [turn[0].kind, turn[0].actor, turn[0].caption], ["say", "player", "I punch the talking one again."], "the player's words, in the log");
  assert.deepEqual([turn[1]?.kind, turn[1]?.caption], ["gm", moves[0]!.narration], "the attempt, before what the board makes of it");
  assert.ok(["attack", "move"].includes(turn[2]?.kind ?? ""), `the board did it: ${turn.map(e => e.kind).join(", ")}`);
  const steps = script.to("fight").map(s => s.body as BoardTurnRequest);
  assert.equal(steps.length, 2);
  assert.equal(steps[0]!.turn.line.text, "I punch the talking one again.");
  assert.ok(steps[0]!.options.some(o => o.id === blow.id), "asked with the board's options");
  assert.deepEqual([steps[1]!.done.length, steps[1]!.done[0]!.act, steps[1]!.done[0]!.moments.length > 0], [1, blow.kind === "attack" ? blow.id : "move_towards crake-1", true], "the next step asked with what came of the first");
  assert.ok(steps[0]!.key.endsWith(`:fight-${(seen + 1) * 100 + 1}`) && steps[1]!.key.endsWith(`:fight-${(seen + 1) * 100 + 2}`), `${steps[0]!.key} ${steps[1]!.key}`);
  const ended = events(host, game.id).filter(e => e.seq > seen);
  assert.ok(ended.some(e => e.kind === "gm" && e.caption === moves[1]!.narration), "the turn's end, told");
  const b = boardNow(host, game.id);
  assert.equal(b.thinking, undefined, "the menu's the player's again");
  assert.ok(fightRow(host, game.id).options === "" || fightRow(host, game.id).status !== "on", "the turn passed on");
  // Its moments aren't told again: the GM played them.
  host.advance(1000); host.fightSteps(); await host.drain();
  const told = script.to("narrate").map(s => s.body as NarrateRequest);
  assert.ok(!told.some(r => r.moments.some(m => m.kind === "say" && m.actor === "player")), "the typed turn isn't told twice");
});
