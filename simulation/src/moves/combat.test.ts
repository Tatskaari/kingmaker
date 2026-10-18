import { test } from "node:test";
import assert from "node:assert/strict";
import { bandOf, BANDS, type Band } from "../../../shared/gm/two-part.ts";
import type { CombatMove, CombatRequest, CombatResponse, Reply, ReplyResponse, SettleRequest } from "../../../shared/protocol/ai.ts";
import { keyParts } from "../../../shared/protocol/keys.ts";
import { nextCheck, openedGame, sceneNow } from "../host/testing.ts";

/**
 * A fight in the conversation (docs/combat-gm.md), on the memory host with the hanged clerk: the
 * reply rolls for initiative, everyone rolls once and the order is written; the other side's turns
 * are combat steps until it's the player's, when the scene waits for their line; each of the GM's
 * actions is resolved by the rules on the yard's world (a move in the place, a blow from out of reach
 * refused, one in reach rolled), and the fight's end goes on to the settle.
 */

const usage = { calls: 1, costUsd: 0.001, byOperation: {} };
const answer = (move: CombatMove): CombatResponse => ({ move, entries: [{ speaker: "gm", kind: "narration", text: "narration" in move ? move.narration : move.act.narration }], usage });

async function fight(plays: (request: CombatRequest) => CombatMove) {
  const game = await openedGame(7, "fighter", { asIs: true });
  const { host, wren, scene, script } = game;
  const asked: CombatRequest[] = [];
  const respond = (request: unknown) => { asked.push(request as CombatRequest); return answer(plays(request as CombatRequest)); };
  for (let i = 0; i < 80; i++) script.then("combat", respond);
  const reply: ReplyResponse = { entries: [{ speaker: "gm", kind: "narration", text: "Cob spits and comes at you with the boathook. Roll for initiative!" }], gm: {}, firstTextMs: 3, initiative: { foes: ["cob"], allies: ["kell"], why: "Cob won't be taken" }, usage };
  script.then("reply", reply);
  const line = async (text: string) => {
    const refused = host.as(wren).say({ text });
    assert.equal(refused, undefined, `"${text}" was refused: ${refused?.text}`);
    await host.drain();
    return sceneNow(host, scene.id);
  };
  return { ...game, asked, line };
}

/** The player closes on Cob, then hits him; the others pass their turns; the fight ends when the rules say so. */
const closeAndHit = (request: CombatRequest): CombatMove => {
  const c = request.combat;
  if (c.over) return { kind: "end_combat", outcome: c.over.outcome, narration: "Cob is down in the dust." };
  if (c.whose !== "player") return { kind: "end_turn", narration: `${c.whose} circles.` };
  if (c.done.length === 0) return { kind: "act", act: { action: "move", target: "cob", narration: "You close on him." } };
  if (c.done.length === 1) return { kind: "act", act: { action: "attack", target: "cob", narration: "You swing." } };
  return { kind: "end_turn", narration: "Your blow lands where it lands." };
};

test("the reply rolls for initiative: everyone rolls once, the order is written, and the scene goes round it until it's the player's turn", async () => {
  const { line, asked } = await fight(closeAndHit);
  const now = await line("I grab Cob by the collar.");
  const combat = now.gm.combat!;
  assert.ok(combat, "a fight is on");
  assert.deepEqual(new Set(combat.order.map(f => f.id)), new Set(["player", "kell", "cob"]));
  assert.deepEqual(combat.order.map(f => f.side), combat.order.map(f => (f.id === "cob" ? "foes" : "party")));
  const rolls = now.lines.filter(l => l.kind === "roll" && l.text.startsWith("Initiative: "));
  assert.equal(rolls.length, 3);
  assert.ok(now.lines.some(l => l.kind === "system" && /^Combat! In initiative order: /.test(l.text)));
  assert.equal(combat.order[combat.at]!.id, "player", "the scene waits on the player's turn");
  assert.equal(now.lines.at(-1)!.text, "Your turn.");
  assert.ok(asked.every(r => r.combat.whose !== "player"), "the others' turns before the player's were the GM's");
  assert.deepEqual(now.turns.map(t => t.phase), ["done", "done"], "the box is open for the player's turn");
});

test("the player's turn: their move in the yard, then their blow rolled by the rules, round after round until Cob's down; the fight's end goes on to the settle", async () => {
  const { script, line, asked } = await fight(closeAndHit);
  let now = await line("I grab Cob by the collar.");
  for (let i = 0; i < 10 && now.gm.combat; i++) now = await line("I hit him.");
  assert.equal(now.gm.combat, undefined, "the fight is over");
  const mine = asked.filter(r => r.combat.whose === "player" && r.combat.done.length);
  const moved = mine.find(r => r.combat.done[0]!.act.action === "move")!.combat.done[0]!;
  assert.match(moved.result, /^you moved \d+ ft towards Cob: now (beside them|\d+ ft away)\.$/);
  const hit = mine.find(r => r.combat.done.length === 2)!.combat.done[1]!;
  assert.equal(hit.refused, undefined, "beside him, the blow is in reach");
  assert.match(hit.lines[0]!, /your attack on Cob: \d+/);
  assert.ok(now.lines.some(l => l.kind === "roll" && /your attack on Cob/.test(l.text)), "the dice lines in the transcript");
  assert.ok(now.lines.some(l => l.kind === "system" && l.text === "The fight is over (you won)."));
  const ended = asked.at(-1)!;
  assert.equal(ended.combat.over?.outcome, "won");
  const settle = script.to("settle").at(-1)!.body as SettleRequest;
  assert.match(settle.reply, /^The fight is over: you won\. Cob is down in the dust\.$/);
  const keys = asked.map(r => keyParts(r.key)!);
  assert.ok(keys.every(k => k.step === "combat"));
  assert.equal(new Set(asked.map(r => r.key)).size, asked.length, "every step of the fight has a key of its own");
});

test("a blow from out of reach is refused before anything's rolled, and the GM is told why", async () => {
  const { line, asked } = await fight(request => {
    const c = request.combat;
    if (c.over) return { kind: "end_combat", outcome: c.over.outcome, narration: "Done." };
    if (c.whose !== "player") return c.done.length ? { kind: "end_turn", narration: "Waits." } : { kind: "act", act: { action: "move", target: "player", away: true, narration: "Backs off." } };
    if (c.done.length === 0) return { kind: "act", act: { action: "attack", target: "cob", narration: "You swing at the air." } };
    return { kind: "end_turn", narration: "Nothing." };
  });
  await line("I grab Cob by the collar.");
  await line("I hit him.");
  const mine = asked.find(r => r.combat.whose === "player" && r.combat.done.length === 1)!;
  const me = mine.combat.fighters.find(f => f.id === "player")!;
  const done = mine.combat.done[0]!;
  assert.ok((me.feet.cob ?? 0) > 7, "Cob backed off out of reach");
  assert.equal(done.refused, true);
  assert.match(done.result, /^Out of reach: Cob is \d+ ft away, and a melee blow reaches 5 ft\. move_towards first/);
  assert.deepEqual(done.lines, []);
});

test("a fight only some of a check's outcomes start (toll1-1018: a bluff failed badly, and its outcome called for initiative with nothing after it): it starts on those, and not on the others", async () => {
  for (const starts of [true, false]) {
    const { host, wren, scene, script } = await openedGame(7, "fighter", { asIs: true });
    const band = bandOf(nextCheck(host, scene.controllerId, "deception", 15));
    const outcomes = Object.fromEntries(BANDS.map(b => [b, { speaker: "gm", kind: "narration", text: `Outcome: ${b}.` }])) as Record<Band, Reply>;
    const on = starts ? [band] : BANDS.filter(b => b !== band);
    script.then("reply", { entries: [{ speaker: "gm", kind: "narration", text: "Cob squints at your story." }], gm: {}, firstTextMs: 3, check: { skill: "deception", dc: 15, outcomes }, initiative: { foes: ["cob"], allies: [], why: "a bluff called", on }, usage } satisfies ReplyResponse);
    assert.equal(host.as(wren).say({ text: "Found it in the gutter, honest." }), undefined);
    await host.drain();
    const now = sceneNow(host, scene.id);
    assert.equal(now.lines.some(l => l.kind === "system" && l.text.startsWith("Combat!")), starts, `the check came up ${band}: a fight ${starts ? "starts" : "doesn't"}`);
    assert.equal(!!now.gm.combat, starts);
  }
});

test("a fight that breaks out on the player's own blow (toll1-1018: a rapier run in at arm's length left the world's player 25 feet off) starts with them beside its target", async () => {
  const { line, asked, script } = await fight(closeAndHit);
  script.then("act", { mechanic: { kind: "attack", target: "cob" }, usage });
  await line("I punch Cob in the ear.");
  const first = asked[0]!;
  assert.ok(first.combat.fighters.find(f => f.id === "player")!.feet.cob! <= 7, "beside Cob as the fight starts");
});
