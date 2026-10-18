import { test } from "node:test";
import assert from "node:assert/strict";
import { BANDS, bandOf, diceLine, type Band } from "../../../shared/gm/two-part.ts";
import type { Reply, ReplyRequest, ReplyResponse, SettleRequest, SettleResponse } from "../../../shared/protocol/ai.ts";
import { keyParts } from "../../../shared/protocol/keys.ts";
import type { WorldOp } from "../../../shared/world/scene-world.ts";
import { all, nextCheck, openedGame, sceneNow } from "../host/testing.ts";

/** A line in a scene (v0-design §4.2, §6.2; docs/two-part-design.md): said, replied (its check rolled), settled, on the memory host. */

const blank = { what: "", to: "", how: "", name: "", kind: "", text: "", add: [] as string[], remove: [] as string[] };
const said = (text: string): Reply => ({ speaker: "gm", kind: "narration", text });
const outcomes = Object.fromEntries(BANDS.map(b => [b, said(`Outcome: ${b}.`)])) as Record<Band, Reply>;
/** The mouthpiece's reply calling a check: its five outcomes, the simulation rolls it. */
const checked = (text: string, skill: "medicine" | "insight", dc: number, more: Partial<ReplyResponse> = {}): ReplyResponse => ({
  entries: [said(text)], gm: {}, firstTextMs: 4, check: { skill, dc, outcomes }, usage: { calls: 1, costUsd: 0.001, byOperation: {} }, ...more,
});

test("a line: said at once, then replied (its check rolled by the rules engine from the game's dice, its outcome written) and settled", async () => {
  const { host, script, wren, scene } = await openedGame();
  const dice = host.db.dice.gameId.find(scene.gameId)!;
  const roll = nextCheck(host, scene.controllerId, "medicine", 12);
  const phases: string[] = [];
  const phaseNow = () => phases.push(sceneNow(host, scene.id).turns[1]!.phase);
  script.then("reply", () => { phaseNow(); return checked("You kneel by the body. The rope burn is wrong.", "medicine", 12, { gm: { offered: "yard" } }); });
  script.then("settle", () => { phaseNow(); return { ops: [], coGm: { roles: {}, moves: [], log: [] }, usage: { calls: 2, costUsd: 0.0005, byOperation: {} } } satisfies SettleResponse; });

  assert.equal(host.as(wren).say({ text: "  *I kneel by the body and look at his neck.*  " }), undefined);
  const now0 = sceneNow(host, scene.id);
  assert.deepEqual(now0.turns.map(t => [t.n, t.phase]), [[0, "done"], [1, "replying"]], "no decide: the reply first");
  assert.equal(now0.scene.turnId, now0.turns[1]!.id);
  assert.deepEqual(now0.lines.map(l => [l.turn, l.speaker, l.kind, l.text]).at(-1), [1, `player:${scene.controllerId}`, "player", "*I kneel by the body and look at his neck.*"]);

  await host.drain();

  const now = sceneNow(host, scene.id);
  assert.deepEqual(phases, ["replying", "settling"]);
  assert.deepEqual(now.lines.slice(1).map(l => [l.turn, l.speaker, l.kind, l.text]), [
    [1, `player:${scene.controllerId}`, "player", "*I kneel by the body and look at his neck.*"],
    [1, "gm", "narration", "You kneel by the body. The rope burn is wrong."],
    [1, "dice", "roll", diceLine(roll)],
    [1, "gm", "narration", `Outcome: ${bandOf(roll)}.`],
  ]);
  assert.equal(host.db.dice.gameId.find(scene.gameId)!.rolls, dice.rolls + 1);
  assert.equal(roll.modifier, JSON.parse(host.db.sheet.playerId.find(scene.controllerId)!.skills).medicine, "the sheet's own modifier");
  assert.deepEqual(now.turns.map(t => [t.n, t.phase, t.calls]), [[0, "done", 2 + 2], [1, "done", 3 + 2]], "each turn's own calls, and its lines'");
  assert.equal(now.scene.turnId, undefined);
  assert.equal(now.scene.turns, 1);
  assert.deepEqual(all(host.db.job).filter(j => j.move !== "remember"), [], "nothing left but the memory review");
  assert.deepEqual(now.gm.pressureOffered, ["yard"]);
  assert.equal(now.gm.turnsInBeat, 1, "the co-GM moved nothing: an exchange at the stage");
});

test("each step's request carries what the commit before it did", async () => {
  const { host, script, wren, scene } = await openedGame();
  const roll = nextCheck(host, scene.controllerId, "medicine", 12);
  script.then("reply", checked("You look at his neck.", "medicine", 12));
  host.as(wren).say({ text: "*I look at his neck.*" });
  await host.drain();

  const reply = script.to("reply")[0]!.body as ReplyRequest;
  const settle = script.to("settle")[0]!.body as SettleRequest;
  const game = all(host.db.game)[0]!;
  const turn = sceneNow(host, scene.id).turns[1]!;

  assert.deepEqual([reply.key, settle.key].map(k => keyParts(k)), ["reply", "settle"].map(step => ({ game: game.uid, scene: String(scene.id), turn: 1, step })));
  assert.deepEqual(reply.turn.line, { speaker: `player:${scene.controllerId}`, text: "*I look at his neck.*" });
  assert.equal(reply.turn.scene.turn, 1);
  assert.deepEqual(reply.turn.present.map(p => p.key), ["kell", "cob", "moll"]);
  assert.deepEqual(reply.turn.transcript.map(e => e.kind), ["narration", "player"]);
  assert.deepEqual(reply.outcome.lines, []);
  assert.equal(reply.stream.turn, String(turn.id));

  assert.equal(settle.reply, `You look at his neck.\n\nOutcome: ${bandOf(roll)}.`, "the reply and the outcome that came up");
  assert.deepEqual(settle.lines, [diceLine(roll)], "the check's dice line");
  assert.deepEqual([settle.check?.skill, settle.check?.dc, settle.check?.total, settle.check?.band], ["medicine", 12, roll.total, bandOf(roll)]);
  assert.deepEqual(settle.settled, [], "nothing was settled before the turn");
});

test("the stage manager's operations go through the gate: problems are logged, and the player is never removed", async () => {
  const { host, script, wren, scene, player } = await openedGame();
  const ops: WorldOp[] = [
    { ...blank, op: "note", what: "kell", text: "Writes down that the investigator knelt by the body." },
    { ...blank, op: "give", what: "granary-yard/wheat-crown", to: `pc:${player.id}` },
    { ...blank, op: "move", what: "granary-yard/yard", to: "granary-yard/lane" },
    { ...blank, op: "remove", what: `pc:${player.id}`, text: "out of the gate" },
    { ...blank, op: "create", name: "a scrap of rope", kind: "item", to: "kell" },
  ];
  script.then("settle", { ops, coGm: { roles: {}, moves: [], log: [] }, usage: { calls: 1, costUsd: 0, byOperation: {} } } satisfies SettleResponse);
  host.as(wren).say({ text: "Sergeant, may I have that crown the girl is holding?" });
  await host.drain();

  const entities = [...host.db.entity.placeId.filter(scene.placeId)];
  const byKey = (k: string) => entities.find(e => e.key === k)!;
  const log = [...host.db.worldLog.placeId.filter(scene.placeId)].sort((a, b) => a.seq - b.seq);
  const lately = log.slice(-5).map(l => [l.round, l.by, l.text]);

  assert.equal(byKey("granary-yard/wheat-crown").parentId, player.characterId, "given to the player");
  assert.equal(byKey(`pc:${player.id}`).gone, false, "the player's removal undone");
  assert.equal(byKey("granary-yard/scrap-of-rope")?.parentId, byKey("kell").id, "created in Kell's hands, with a new id");
  assert.ok(byKey("granary-yard/scrap-of-rope").ord > Math.max(...entities.filter(e => e.key !== "granary-yard/scrap-of-rope").map(e => e.ord)));
  assert.ok(lately.some(([round, by, text]) => round === 1 && by === "stage" && /^\(not done\) move: /.test(String(text))), JSON.stringify(lately));
  assert.ok(lately.some(([, by, text]) => by === "stage" && text === "(not done) remove: the player leaves only by walking out"));
  assert.deepEqual(log.map(l => l.seq), log.map((_, i) => i + 1));
  assert.match(JSON.stringify(host.db.narrative.entityId.find(byKey("kell").id)!.notes), /knelt by the body/);
  assert.equal(host.db.place.id.find(scene.placeId)!.rev, 2, "written once more after the opening");
});

test("a line said while the last turn settles waits, and starts when that one is done; a third is refused", async () => {
  const { host, script, wren, scene } = await openedGame();
  const refusals: unknown[] = [];
  script.then("settle", () => {
    refusals.push(host.as(wren).say({ text: "And who found him?" }));
    refusals.push(host.as(wren).say({ text: "And when?" }));
    return { ops: [], coGm: { roles: {}, moves: [], log: [] }, usage: { calls: 0, costUsd: 0, byOperation: {} } };
  });

  host.as(wren).say({ text: "Morning, Sergeant." });
  await host.drain();

  const now = sceneNow(host, scene.id);
  assert.deepEqual(refusals.map(r => (r as { code?: string } | undefined)?.code), [undefined, "turn_in_flight"]);
  assert.deepEqual(now.turns.map(t => [t.n, t.phase]), [[0, "done"], [1, "done"], [2, "done"]]);
  assert.deepEqual(script.to("reply").map(s => (s.body as ReplyRequest).turn.line.text), ["Morning, Sergeant.", "And who found him?"]);
  assert.deepEqual(now.lines.map(l => [l.turn, l.kind]), [[0, "narration"], [1, "player"], [1, "narration"], [2, "player"], [2, "narration"]]);
});

test("the same seed and the same lines roll the same dice", async () => {
  const play = async () => {
    const { host, script, wren, scene } = await openedGame(42);
    for (let i = 0; i < 3; i++) {
      script.then("reply", checked("Moll's chin comes up.", "insight", 13));
      host.as(wren).say({ text: `You were never up that wall, were you? (${i})` });
      await host.drain();
    }
    return sceneNow(host, scene.id).lines.filter(l => l.kind === "roll").map(l => l.text);
  };
  const first = await play();
  assert.equal(first.length, 3);
  assert.deepEqual(await play(), first);
});
