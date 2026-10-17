import { test } from "node:test";
import assert from "node:assert/strict";
import { describeRoll } from "../../../shared/dice.ts";
import { bandOf, BAND_NAME, BANDS, type Band } from "../../../shared/gm/two-part.ts";
import type { CoGmAnswer, OpenRequest, Reply, ReplyRequest, ReplyResponse, SettleRequest, SettleResponse } from "../../../shared/protocol/ai.ts";
import { keyParts } from "../../../shared/protocol/keys.ts";
import { all, nextCheck, openedGame, sceneNow } from "../host/testing.ts";

/**
 * The two-part GM's turn in the simulation (docs/two-part-design.md "A turn, step by step"), on the
 * memory host with the campaign's own hanged clerk: the opening's roles, a line replied and settled
 * with no decide, a check rolled from the game's dice and its outcome written, the co-GM's moves
 * taken again on the rows, the stage moving on and shown, and the wind-down that may wait once.
 */

const usage = { calls: 1, costUsd: 0.001, byOperation: {} };
const said = (text: string, speakers: string[] = []): Reply => ({ speaker: "gm", kind: "narration", text, ...(speakers.length ? { markup: { speech: speakers.map((speaker, i) => ({ start: i, end: i + 1, speaker })) } } : {}) });
const replied = (text: string, more: Partial<ReplyResponse> = {}): ReplyResponse => ({ entries: [said(text)], gm: { repeated: null }, firstTextMs: 3, usage, ...more });
const coGm = (moves: CoGmAnswer["moves"], roles: CoGmAnswer["roles"] = {}): SettleResponse => ({ ops: [], coGm: { roles, moves, log: [] }, usage });
const outcomes = Object.fromEntries(BANDS.map(b => [b, said(`Outcome: ${b}.`)])) as Record<Band, Reply>;

async function yard() {
  const game = await openedGame(7, "ranger", { twoPart: true, asIs: true });
  const { host, wren, scene } = game;
  const line = async (text: string) => {
    const refused = host.as(wren).say({ text });
    assert.equal(refused, undefined, `"${text}" was refused: ${refused?.text}`);
    await host.drain();
    return sceneNow(host, scene.id);
  };
  return { ...game, line };
}

test("a scene of the story opens on the two-part GM: everyone present has a role (their start note, else their attitude) as note -1, and the opening is the mouthpiece's", async () => {
  const { host, script, scene } = await yard();
  const now = sceneNow(host, scene.id);
  const open = script.to("open")[0]!.body as OpenRequest;
  assert.equal(open.twoPart, true);
  assert.deepEqual(Object.keys(open.gm.twoPart.roles), ["kell", "cob", "moll"], "Tull comes with the dead-cart");
  assert.match(open.gm.twoPart.roles.cob!.conversation_role, /^Characterise: stones and cheek/);
  assert.deepEqual(now.gm.twoPart.notes.map(n => n.turn), [-1]);
  assert.match(now.gm.twoPart.notes[0]!.text, /^Co-GM note, before turn 0\n\nCharacter role for Sergeant Agnes Kell:/);
  assert.deepEqual([now.scene.status, now.turns[0]!.phase], ["live", "done"]);
});

test("a line: replied with no decide, the GM's check rolled through the rules engine from the game's dice, its outcome written; then the stage manager and the co-GM, its move taken again on the rows", async () => {
  const { host, script, scene, line } = await yard();
  const roll = nextCheck(host, scene.controllerId, "medicine", 12);
  const band = bandOf(roll);
  script.then("reply", replied("You climb the outside stair and get a look at his throat.", { check: { skill: "medicine", dc: 12, outcomes } }));
  script.then("settle", coGm([{ route: "find-murder", outcome: "none", why: "The cord mark landed." }], { cob: { status: "Behind the water butt", mental_state: "Scared", conversation_role: "Could show the loose board." } }));

  const now = await line("(I climb the stair and look at his neck)");
  assert.deepEqual(script.to("decide"), [], "no decide");
  const reply = script.to("reply")[0]!.body as ReplyRequest;
  assert.deepEqual([reply.twoPart, reply.decision, reply.outcome.windDown], [true, undefined, undefined]);
  assert.deepEqual(now.lines.slice(-4).map(l => [l.kind, l.text]), [
    ["player", "(I climb the stair and look at his neck)"],
    ["narration", "You climb the outside stair and get a look at his throat."],
    ["roll", `${describeRoll(roll)} (${BAND_NAME[band]}).`],
    ["narration", `Outcome: ${band}.`],
  ]);
  const settle = script.to("settle")[0]!.body as SettleRequest;
  assert.deepEqual([settle.twoPart, settle.check?.skill, settle.check?.band, settle.check?.success], [true, "medicine", band, roll.success]);
  assert.equal(settle.reply, `You climb the outside stair and get a look at his throat.\n\nOutcome: ${band}.`);
  assert.deepEqual(settle.lines, [`${describeRoll(roll)} (${BAND_NAME[band]}).`], "the stage manager's dice lines");

  assert.deepEqual(now.gm.reached, ["start", "murder"]);
  assert.ok(now.gm.established.some(f => /strangled/i.test(f)) || now.gm.established.length === 1, "the discovery's fact settled");
  assert.deepEqual(now.gm.path.map(p => [p.turn, p.from, p.to, p.via]), [[1, "start", "murder", "find-murder"]]);
  assert.equal(now.gm.beat, "start", "a discovery doesn't move the stage");
  assert.equal(now.gm.turnsInBeat, 1);
  assert.equal(now.gm.twoPart.roles.cob!.status, "Behind the water butt");
  assert.deepEqual(now.gm.twoPart.notes.map(n => n.turn), [-1, 1]);
  assert.match(now.gm.twoPart.notes[1]!.text, /^Co-GM note, before turn 2[\s\S]*Character role for Cob:\nStatus: Behind the water butt\nMental state: Scared\nConversation role: Could show the loose board\./);
  assert.deepEqual(now.turns.map(t => [t.n, t.phase]), [[0, "done"], [1, "done"]]);
  assert.deepEqual(script.to("repair"), [], "no co-GM review: the two-part co-GM ran in the settle");
  assert.equal(script.to("remember").length, 1, "the memory review, as before");
  assert.deepEqual(keyParts(reply.key)?.step, "reply");
});

test("the co-GM moves the stage to an event: whoever it brings joins the world with their stage note as their role, and the next reply is told so, once", async () => {
  const { host, script, scene, line } = await yard();
  script.then("settle", coGm([{ route: "cart-comes", outcome: "none", why: "The noon bell." }]));
  const moved = await line("Sergeant, what time is it?");
  assert.deepEqual([moved.gm.beat, moved.gm.turnsInBeat, moved.gm.twoPart.moved], ["cart-arrives", 0, "cart-arrives"]);
  assert.match(moved.gm.twoPart.roles.tull!.conversation_role, /^Helmet off to the dead/);
  assert.ok(all(host.db.entity).some(e => e.key === "tull"), "Tull is in the world");

  const next = await line("Corporal, good morning.");
  const reply = script.to("reply").at(-1)!.body as ReplyRequest;
  assert.equal(reply.turn.gm.twoPart.moved, "cart-arrives", "the reply's request has the move to show");
  assert.equal(next.gm.twoPart.moved, undefined, "shown, it's done with");
  assert.equal(next.gm.turnsInBeat, 1);
  void scene;
});

test("a route to an ending leaves the scene closing; the next line's reply is the closing, which may wait once, then closes through the story's end", async () => {
  const { host, script, scene, line } = await yard();
  script.then("settle", coGm([
    { route: "find-murder", outcome: "none", why: "" }, { route: "find-hobb", outcome: "none", why: "" },
    { route: "cart-comes", outcome: "none", why: "" }, { route: "signed-murder", outcome: "none", why: "Kell signs." },
  ]));
  const closing = await line("Write it down as murder, Sergeant.");
  assert.deepEqual([closing.scene.status, closing.gm.closing?.exitId, closing.gm.landed], ["closing", "murder-unknown", ["hobb"]]);

  script.then("reply", replied("Kell raises her pencil. “One more thing?”", { closes: false }));
  const held = await line("Wait: Cob, who was the big man?");
  const winding = script.to("reply").at(-1)!.body as ReplyRequest;
  assert.deepEqual([winding.twoPart, winding.outcome.windDown?.exit], [true, "murder-unknown"]);
  assert.deepEqual([held.scene.status, held.gm.twoPart.held, held.gm.closing?.exitId], ["closing", true, "murder-unknown"], "it waited, once");
  assert.equal(script.to("settle").length, 1, "no settle on a wind-down");

  script.then("reply", replied("Kell underlines it twice."));
  const ended = await line("Then let's go.");
  assert.equal(ended.scene.status, "ended");
  assert.equal(ended.scene.exitKey, "murder-unknown");
  assert.equal(ended.lines.at(-1)!.text, "Scene ends: Murder by persons unknown");
  assert.ok(host.db.chapter.sceneId.find(scene.id), "its chapter: the story's end");
});

test("a move the rows refuse is logged and left; a role for someone not in the scene is dropped", async () => {
  const { script, line } = await yard();
  script.then("settle", coGm([{ route: "signed-murder", outcome: "none", why: "Too soon." }, { route: "find-hobb", outcome: "none", why: "" }], { nobody: { status: "", mental_state: "", conversation_role: "?" } }));
  const now = await line("Who was here last night?");
  assert.deepEqual(now.gm.reached, ["start", "hobb"]);
  assert.equal(now.gm.twoPart.roles.nobody, undefined);
});
