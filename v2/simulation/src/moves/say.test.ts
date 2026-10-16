import { test } from "node:test";
import assert from "node:assert/strict";
import { describeRoll } from "../../../shared/dice.ts";
import type { DecideRequest, DecideResponse, ReplyRequest, SettleRequest, SettleResponse } from "../../../shared/protocol/ai.ts";
import { keyParts } from "../../../shared/protocol/keys.ts";
import type { WorldOp } from "../../../shared/world/scene-world.ts";
import { all, nextCheck, openedGame, sceneNow } from "../host/testing.ts";

/** A line in a scene (v0-design §4.2, §6.2): said, decided, rolled, replied, settled, on the memory host. */

const blank = { what: "", to: "", how: "", name: "", kind: "", text: "", add: [] as string[], remove: [] as string[] };
const catchMoll: DecideResponse = {
  decision: { route: { id: "catch-moll", phase: "attempt", check: { skill: "insight", dc: 13, reason: "to see through Moll's story about the jump" } }, earned: false, daft: false, outOfCharacter: false },
  opened: [], usage: { calls: 2, costUsd: 0.0006, byOperation: {} },
};
const examineBody: DecideResponse = {
  decision: { route: { id: "examine-body", phase: "attempt", check: { skill: "medicine", dc: 12, reason: "to tell how Prout really died" } }, earned: false, daft: false, outOfCharacter: false },
  opened: [], usage: { calls: 2, costUsd: 0.0006, byOperation: {} },
};

test("a line: said at once, then decided (a route with a check, rolled by the rules engine from the game's dice), replied and settled", async () => {
  const { host, script, wren, scene } = await openedGame();
  const dice = host.db.dice.gameId.find(scene.gameId)!;
  const roll = nextCheck(host, scene.controllerId, "medicine", 12);
  const phases: string[] = [];
  const phaseNow = () => phases.push(sceneNow(host, scene.id).turns[1]!.phase);
  script.then("decide", () => { phaseNow(); return examineBody; });
  script.then("reply", () => { phaseNow(); return { entries: [{ speaker: "gm", kind: "narration", text: "You kneel by the body. The rope burn is wrong." }], gm: { offered: "yard", repeated: null }, firstTextMs: 4, usage: { calls: 1, costUsd: 0.001, byOperation: {} } }; });
  script.then("settle", () => { phaseNow(); return { ops: [], after: { landed: ["not-suicide"], hinted: [], unanswered: false, theirs: true, status: "on_track" }, usage: { calls: 2, costUsd: 0.0005, byOperation: {} } }; });

  assert.equal(host.as(wren).say({ text: "  *I kneel by the body and look at his neck.*  " }), undefined);
  const said = sceneNow(host, scene.id);
  assert.deepEqual(said.turns.map(t => [t.n, t.phase]), [[0, "done"], [1, "deciding"]]);
  assert.equal(said.scene.turnId, said.turns[1]!.id);
  assert.deepEqual(said.lines.map(l => [l.turn, l.speaker, l.kind, l.text]).at(-1), [1, `player:${scene.controllerId}`, "player", "*I kneel by the body and look at his neck.*"]);

  await host.drain();

  const line = describeRoll(roll, "to tell how Prout really died");
  const now = sceneNow(host, scene.id);
  assert.deepEqual(phases, ["deciding", "replying", "settling"]);
  assert.deepEqual(now.lines.slice(1).map(l => [l.turn, l.speaker, l.kind, l.text]), [
    [1, `player:${scene.controllerId}`, "player", "*I kneel by the body and look at his neck.*"],
    [1, "dice", "roll", line],
    [1, "gm", "narration", "You kneel by the body. The rope burn is wrong."],
  ]);
  assert.equal(host.db.dice.gameId.find(scene.gameId)!.rolls, dice.rolls + 1);
  assert.equal(roll.modifier, JSON.parse(host.db.sheet.playerId.find(scene.controllerId)!.skills).medicine, "the sheet's own modifier");
  assert.deepEqual(now.turns.map(t => [t.n, t.phase, t.calls]), [[0, "done", 2], [1, "done", 5]]);
  assert.equal(now.scene.turnId, undefined);
  assert.equal(now.scene.turns, 1);
  assert.deepEqual(all(host.db.job), []);

  // The bookkeeping: the check moved the scene to doubt (or kept it in the yard on a failure), the read after the reply noted.
  assert.equal(now.gm.beat, roll.success ? "doubt" : "yard");
  assert.deepEqual(now.gm.path, [{ turn: 1, from: "yard", to: roll.success ? "doubt" : "yard", via: "examine-body", source: "pre", roll, known: 0 }]);
  assert.equal(now.gm.turnsInBeat, roll.success ? 0 : 1);
  assert.deepEqual(now.gm.landed, ["not-suicide"]);
  assert.equal(now.gm.sceneStatus, "on_track");
  assert.deepEqual(now.gm.pressureOffered, ["yard"]);
});

test("each step's request carries what the commit before it did", async () => {
  const { host, script, wren, scene } = await openedGame();
  script.then("decide", examineBody);
  host.as(wren).say({ text: "*I look at his neck.*" });
  await host.drain();

  const decide = script.to("decide")[0]!.body as DecideRequest;
  const reply = script.to("reply")[0]!.body as ReplyRequest;
  const settle = script.to("settle")[0]!.body as SettleRequest;
  const game = all(host.db.game)[0]!;
  const turn = sceneNow(host, scene.id).turns[1]!;

  assert.deepEqual([decide.key, reply.key, settle.key].map(k => keyParts(k)), ["decide", "reply", "settle"].map(step => ({ game: game.uid, scene: String(scene.id), turn: 1, step })));
  assert.deepEqual(decide.turn.line, { speaker: `player:${scene.controllerId}`, text: "*I look at his neck.*" });
  assert.equal(decide.turn.scene.turn, 1);
  assert.deepEqual(decide.landed, []);
  assert.deepEqual(decide.turn.present.map(p => p.key), ["kell", "cob", "moll"]);
  assert.deepEqual(decide.turn.transcript.map(e => e.kind), ["narration", "player"]);

  assert.deepEqual(reply.decision, examineBody.decision);
  assert.equal(reply.outcome.move?.route, "examine-body");
  assert.equal(reply.outcome.move?.from, "yard");
  assert.deepEqual(reply.outcome.lines, [reply.turn.transcript.at(-1)!.text]);
  assert.equal(reply.stream.turn, String(turn.id));
  assert.equal(reply.turn.gm.path.length, 1, "the reply sees the move applied");

  assert.equal(settle.reply, "Kell taps her pencil on the notebook. \"Noted.\"");
  assert.deepEqual(settle.lines, reply.outcome.lines);
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
  script.then("settle", { ops, after: { landed: [], hinted: [], unanswered: false, theirs: false }, usage: { calls: 1, costUsd: 0, byOperation: {} } } satisfies SettleResponse);
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
    return { ops: [], after: { landed: [], hinted: [], unanswered: false, theirs: false }, usage: { calls: 0, costUsd: 0, byOperation: {} } };
  });

  host.as(wren).say({ text: "Morning, Sergeant." });
  await host.drain();

  const now = sceneNow(host, scene.id);
  assert.deepEqual(refusals.map(r => (r as { code?: string } | undefined)?.code), [undefined, "turn_in_flight"]);
  assert.deepEqual(now.turns.map(t => [t.n, t.phase]), [[0, "done"], [1, "done"], [2, "done"]]);
  assert.deepEqual(script.to("decide").map(s => (s.body as DecideRequest).turn.line.text), ["Morning, Sergeant.", "And who found him?"]);
  assert.deepEqual(now.lines.map(l => [l.turn, l.kind]), [[0, "narration"], [1, "player"], [1, "narration"], [2, "player"], [2, "narration"]]);
});

test("the same seed and the same lines roll the same dice", async () => {
  const play = async () => {
    const { host, script, wren, scene } = await openedGame(42);
    for (let i = 0; i < 3; i++) {
      script.then("decide", catchMoll);
      host.as(wren).say({ text: `You were never up that wall, were you? (${i})` });
      await host.drain();
    }
    return sceneNow(host, scene.id).lines.filter(l => l.kind === "roll").map(l => l.text);
  };
  const first = await play();
  assert.equal(first.length, 3);
  assert.deepEqual(await play(), first);
});
