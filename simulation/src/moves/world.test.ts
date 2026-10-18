import { test } from "node:test";
import assert from "node:assert/strict";
import type { Outcome, ReplyRequest, SettleRequest, SettleResponse } from "../../../shared/protocol/ai.ts";
import { idText } from "../../../shared/protocol/keys.ts";
import type { Mechanic, Reaction, Threat, ThreatRead } from "../../../shared/rules/types.ts";
import { ignite } from "../../../shared/world/systems.ts";
import { getGm, putGm } from "../gm/rows.ts";
import { openedGame, sceneNow } from "../host/testing.ts";
import { sceneRow } from "../rows.ts";
import { sceneGraph } from "../scenes.ts";
import { queuedTurnOf } from "../turns.ts";
import { placeWorldOf, savePlaceWorld } from "../world/place.ts";
import { atTurn, reactionsTakeEffect, takeAct } from "./say-commits.ts";

/**
 * The world bridge in a scene (world-bridge-design §3.4), on the memory host with the AI service
 * scripted and the rules engine the module's own, on the two-part GM's turn: the map's act, its
 * mechanic chosen already, resolved by the rules as its turn starts (its dice rows, the world and the
 * sheet); what the rules leave hanging landing as the next turn starts (a blow, a hold, fire burning
 * on, a spell running out); and the rules' state kept from turn to turn. The reactions to the
 * player's violence are parked for combat (nothing asks them on the two-part GM): their taking
 * effect is tested as the parked code has it.
 */

const none = { calls: 0, costUsd: 0, byOperation: {} };
const settled = (): SettleResponse => ({ ops: [], coGm: { roles: {}, moves: [], log: [] }, usage: none });

const MISSILE: Mechanic = { kind: "cast", spell: "magic-missile", targets: ["hoist-rope"] };
/** fake.json's quiet reactions for the yard. */
const QUIET: Record<string, Reaction> = { kell: "intervene", cob: "flee", moll: "cower" };

/** A game with the ready-made wizard, opened: the yard, Kell, Cob and Moll. */
async function wizard() {
  const opened = await openedGame(7, "wizard");
  const { host, script, wren, scene, player } = opened;
  const now = () => sceneNow(host, scene.id);
  const world = () => host.transact(tx => placeWorldOf(tx, sceneRow(tx, scene.id)).world);
  const sheet = () => host.db.sheet.playerId.find(player.id)!;
  const rules = () => host.db.rulesState.playerId.find(player.id)!;
  const onStage = () => [...host.db.onStage.sceneId.filter(scene.id)].map(r => host.db.entity.id.find(r.entityId)!.key);
  const line = async (text: string) => {
    assert.equal(host.as(wren).say({ text }), undefined, `"${text}" was refused`);
    await host.drain();
    return now();
  };
  /**
   * A line, then the player's act as the map's menu plays it (town-design §3.4): said while the line
   * settles, so it waits as queued, its mechanic chosen already on its turn (as open-scene.ts queueAct
   * writes it); the rules resolve it as its turn starts.
   */
  const act = async (text: string, mechanic: Mechanic, before = "Morning, Sergeant.", left?: ThreatRead) => {
    script.then("settle", () => {
      assert.equal(host.as(wren).say({ text }), undefined, `"${text}" was refused`);
      host.transact(tx => { const turn = queuedTurnOf(tx, scene.id)!; tx.db.turn.id.update({ ...turn, mechanic: JSON.stringify(mechanic) }); });
      if (left) hanging(left);
      return settled();
    });
    return line(before);
  };
  /** What the last reply left hanging over the player (gm.threat, as a reaction's fight or the old pipeline's read after the reply left it), for the next turn's start to land. */
  const hanging = (threat: ThreatRead) => host.transact(tx => { const gm = getGm(tx, scene.id); putGm(tx, scene.id, { ...gm, threat: { ...threat, turn: sceneRow(tx, scene.id).turns } as Threat }); });
  const turnLines = (n: number) => now().lines.filter(l => l.turn === n).map(l => [l.kind, l.text]);
  return { host, script, scene, player, now, world, sheet, rules, onStage, line, act, hanging, turnLines };
}

test("the map's act, resolved by the rules as its turn starts: a spell at a thing writes the dice rows, the world and the sheet; the reply is told the act, the stage manager its dice lines; nothing reacts to it", async () => {
  const { script, scene, now, world, sheet, onStage, act, turnLines } = await wizard();
  assert.deepEqual(onStage().sort(), ["cob", "kell", "moll", `pc:${scene.controllerId}`]);

  const ended = await act("(I cast Magic Missile at the hoist rope)", MISSILE);

  const dice = turnLines(2).filter(([kind]) => kind === "roll").map(([, text]) => text!);
  assert.match(dice[0]!, /^Cast Magic Missile \(1st-level slot\)/);
  assert.ok(dice.some(d => /hoist rope takes \d+ force damage and is destroyed/i.test(d)), dice.join("\n"));
  assert.ok(world().entities["hoist-rope"]!.states.includes("destroyed"));
  assert.notEqual(world().entities.prout!.parent, "hoist-rope", "what hung from the rope falls");
  assert.ok(!world().entities.prout!.states.includes("hanging"));
  assert.match(sheet().statusLine, /1st 3\/4/);
  assert.deepEqual(ended.gm.path.map(p => p.via), ["rules:cast:magic-missile"]);

  const reply = script.to("reply")[1]!.body as ReplyRequest;
  assert.deepEqual(reply.outcome.lines, dice);
  assert.equal(reply.outcome.acts?.length, 1);
  assert.match(reply.outcome.acts![0]!, /Magic Missile/);
  assert.deepEqual((script.to("settle")[1]!.body as SettleRequest).lines, dice);
  assert.deepEqual(script.to("reactions"), [], "nothing reacts to the act on the two-part GM: the reactions are parked for combat");
  assert.deepEqual(onStage().sort(), ["cob", "kell", "moll", `pc:${scene.controllerId}`]);
  assert.deepEqual(now().turns.map(t => t.phase), ["done", "done", "done"]);
});

test("parked for combat: the reactions to the player's violence take effect on the world and the bookkeeping (the fleeing gone, absent and off the stage, the cowering cowering), their directive after the act's; a fight that breaks out leaves the first fighter's blow over the player, which lands as the next turn starts", async () => {
  const { host, script, scene, world, onStage, line, turnLines } = await wizard();
  const directive = "Rules: that was violence, and everyone here reacts at once.";
  const outcome = host.transact(tx => {
    const at = atTurn(tx, { scene: idText(scene.id) });
    const out: Outcome = { lines: [], directives: [], wasStuck: false };
    const violence = takeAct(tx, at, { n: 1, input: "(I cast Magic Missile at the hoist rope)" }, MISSILE, undefined, out)!;
    assert.match(violence.what, /^cast Magic Missile/);
    reactionsTakeEffect(tx, at, { n: 1 }, violence, QUIET, directive, out);
    putGm(tx, scene.id, at.gm);
    return out;
  });
  assert.equal(outcome.acts?.length, 2);
  assert.equal(outcome.acts![1], directive);
  const gm = sceneNow(host, scene.id).gm;
  assert.deepEqual(gm.absent, ["cob"]);
  assert.ok(world().entities.cob!.states.includes("gone"));
  assert.ok(world().entities.moll!.states.includes("cowering"));
  assert.deepEqual(onStage().sort(), ["kell", "moll", `pc:${scene.controllerId}`]);
  assert.deepEqual(gm.path.map(p => p.via), ["rules:cast:magic-missile", "reactions:kell=intervene,cob=flee,moll=cower"]);
  assert.equal(gm.brawl, undefined);

  // A fight: Kell goes for the player, and her blow lands as the next turn starts.
  host.transact(tx => {
    const at = atTurn(tx, { scene: idText(scene.id) });
    const out: Outcome = { lines: [], directives: [], wasStuck: false };
    const violence = takeAct(tx, at, { n: 1, input: "*I hit the sergeant with my staff.*" }, { kind: "attack", target: "kell" }, undefined, out)!;
    reactionsTakeEffect(tx, at, { n: 1 }, violence, { kell: "fight", moll: "cower" }, "Rules: that was violence. It's a fight now: end on the moment it breaks out.", out);
    putGm(tx, scene.id, at.gm);
  });
  const fighting = sceneNow(host, scene.id).gm;
  assert.deepEqual([fighting.brawl?.against, fighting.threat], [["kell"], { kind: "attack", by: "kell", turn: 1 }]);
  const next = await line("(I put my hands up)");
  const first = turnLines(1).filter(([kind]) => kind === "roll").map(([, text]) => text!);
  assert.ok(first.some(l => /Kell's attack on you/.test(l)), first.join("\n"));
  assert.equal(next.gm.threat, undefined, "taken off as it lands");
  assert.match((script.to("reply")[0]!.body as ReplyRequest).outcome.directives[0]!, /^Rules/);
});

test("a blow the last reply left hanging lands as the next turn starts, before the reply; a hold catches the player with a saving throw as it lands", async () => {
  const { script, sheet, line, hanging, turnLines } = await wizard();
  const hp = sheet().hp;
  await line("I'm not going anywhere, Sergeant.");
  hanging({ kind: "attack", by: "kell" });

  const landed = await line("(I stand my ground)");
  const dice = turnLines(2).filter(([kind]) => kind === "roll").map(([, text]) => text!);
  assert.match(dice[0]!, /Kell's attack on you: .* vs AC \d+: (hit|miss|critical hit!)/);
  const reply = script.to("reply")[1]!.body as ReplyRequest;
  assert.deepEqual(reply.turn.transcript.filter(e => e.turn === 2 && e.kind === "roll").map(e => e.text), dice, "landed before the reply was asked");
  assert.equal(reply.turn.gm.threat, undefined);
  assert.equal(landed.gm.threat, undefined);
  assert.deepEqual(reply.outcome.lines, dice, "the turn's dice lines start with what landed");
  assert.match(reply.outcome.directives[0]!, /^Rules/);
  if (dice.some(d => /You take \d+/.test(d))) assert.ok(sheet().hp < hp, "the blow's damage is on the sheet");
  assert.ok(reply.turn.party[0]!.status, "the GM is told the player's state after it");

  // A hold: a saving throw as it catches them; a failed save leaves them held.
  hanging({ kind: "hazard", hazard: "grab_or_shove", severity: "serious" });
  const grabbed = await line("(I try to push past him to the gate)");
  const save = turnLines(3).filter(([kind]) => kind === "roll").map(([, text]) => text!);
  assert.match(save[0] ?? "", /Strength save/);
  assert.equal(grabbed.gm.held === undefined, /saved/.test(save.join(" ")), "a failed save leaves them held");
});

test("in a turn, a Shield raised against the blow isn't cast again by the turn's own act (the prototype's threats.test.ts, its whole-turn case)", async () => {
  const { script, sheet, act, turnLines } = await wizard();
  // Kell's blow left hanging by the first line's reply, and the Shield the next turn, as the blow lands.
  await act("*As the club comes down I snap up a hand and speak the word for Shield.*", { kind: "cast", spell: "shield", targets: ["self"] }, "I'm not going anywhere, Sergeant.", { kind: "attack", by: "kell" });

  const dice = turnLines(2).filter(([kind]) => kind === "roll").map(([, text]) => text!);
  assert.equal(dice.filter(d => /^Cast Shield/.test(d)).length, 1, dice.join("\n"));
  assert.match(sheet().statusLine, /1st 3\/4/, "one slot for it");
  assert.deepEqual((script.to("reply")[1]!.body as ReplyRequest).outcome.acts, undefined, "the act was forestalled: only the rules' own directives lead the reply");
});

test("what's burning burns on as a turn starts, before the reply: its dice lines and its directive lead the turn", async () => {
  const { host, script, scene, world, line, turnLines } = await wizard();
  host.transact(tx => {
    const row = sceneRow(tx, scene.id);
    const place = placeWorldOf(tx, row);
    ignite(place.world, place.world.entities.gate!, 0);
    savePlaceWorld(tx, row, place, sceneGraph(tx, row, getGm(tx, scene.id)));
  });
  assert.ok(world().entities.gate!.states.includes("burning"));

  await line("(I watch the gate burn)");

  const dice = turnLines(1).filter(([kind]) => kind === "roll").map(([, text]) => text!);
  assert.ok(dice.length >= 1);
  assert.match(dice[0]!, /^The yard gate takes \d+ fire damage/);
  const reply = script.to("reply")[0]!.body as ReplyRequest;
  assert.deepEqual(reply.turn.transcript.filter(e => e.turn === 1 && e.kind === "roll").map(e => e.text), dice, "it burned before the reply was asked");
  assert.match(reply.outcome.directives[0]!, /^Rules, since the last reply: The yard gate takes/);
  assert.deepEqual((script.to("settle")[0]!.body as SettleRequest).lines, dice, "the stage manager is told what burned");
});

test("the rules keep their state from turn to turn: someone the rules have touched is the engine's same character, and a running spell's time passes", async () => {
  const { script, rules, act, line, turnLines } = await wizard();
  const created = () => rules().campaign.split('"CharacterCreated"').length - 1;
  const before = created();

  for (const n of [1, 2, 3]) {
    await act(`(I swing my staff at the sergeant, ${n})`, { kind: "attack", target: "kell" }, `Sergeant? (${n})`);
    assert.deepEqual(Object.keys(JSON.parse(rules().npcs) as object), ["kell"]);
  }
  const kell = (JSON.parse(rules().npcs) as Record<string, { id: string; weapon: string }>).kell!;
  assert.equal(created(), before + 1, "Kell was made once, and stays hurt from one turn to the next");
  assert.ok(kell.id && kell.weapon);

  // A spell with a duration: timed is kept, and the next turn's start runs its minute on, when it runs out.
  await act("(I cast Sleep on the boy)", { kind: "cast", spell: "sleep", targets: ["cob"] }, "Cob?");
  assert.equal(rules().timed, true);
  await line("(I wait a moment)");
  assert.deepEqual(turnLines(9).filter(([kind]) => kind === "roll"), [["roll", "Sleep has run out"]]);
  assert.deepEqual((script.to("reply").at(-1)!.body as ReplyRequest).outcome.directives, ["Rules: Sleep has run out (the spell's time is up)."]);
  assert.equal(rules().timed, false);
});
