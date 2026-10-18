import { test } from "node:test";
import assert from "node:assert/strict";
import type { ActRequest, ActResponse, Outcome, ReactionsRequest, ReplyRequest, SettleRequest, SettleResponse } from "../../../shared/protocol/ai.ts";
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
 * scripted and the rules engine the module's own, on the two-part GM's turn: a spell or a blow said
 * in words, asked of the act step and resolved by the rules before the reply, and the map's act, its
 * mechanic chosen already, resolved as its turn starts (their dice rows, the world and the sheet);
 * the reactions of everyone who saw it when it was violence (no fight starts); a spell the character
 * hasn't got refused by the rules; an ordinary line with no step before its reply; what the rules
 * leave hanging landing as the next turn starts (a blow, a hold, fire burning on, a spell running
 * out); and the rules' state kept from turn to turn.
 */

const none = { calls: 0, costUsd: 0, byOperation: {} };
const settled = (): SettleResponse => ({ ops: [], coGm: { roles: {}, moves: [], log: [] }, usage: none });

const MISSILE: Mechanic = { kind: "cast", spell: "magic-missile", targets: ["hoist-rope"] };
/** fake.json's quiet reactions for the yard. */
const QUIET: Record<string, Reaction> = { kell: "intervene", cob: "flee", moll: "cower" };

/** A game with the ready-made wizard (or another of builds.json's), opened: the yard, Kell, Cob and Moll. */
async function wizard(build = "wizard") {
  const opened = await openedGame(7, build);
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
  /** The steps a turn's own thinks took, in order (the lines beside it and the memory review after it left out). */
  const stepsOf = (n: number) => script.sent.filter(s => s.key.endsWith(`:t${n}:${s.step}`) && ["act", "reactions", "reply", "settle"].includes(s.step)).map(s => s.step);
  return { host, script, scene, player, now, world, sheet, rules, onStage, line, act, hanging, turnLines, stepsOf };
}

const asked = (mechanic?: Mechanic): ActResponse => ({ ...(mechanic ? { mechanic } : {}), usage: { calls: 2, costUsd: 0.0004, byOperation: {} } });

test("a spell said in words: the line asks the act step, and the rules resolve it before the reply (its dice rows first, the world and the sheet changed); the people who saw it react (Cob gone, Moll cowering); the reply is told the act and the reactions, the co-GM what the rules decided", async () => {
  const { script, scene, now, world, sheet, onStage, line, turnLines, stepsOf } = await wizard();
  script.then("act", asked(MISSILE));
  script.then("reactions", { reactions: QUIET, directive: "Rules: that was violence, and everyone here reacts at once.", usage: { calls: 1, costUsd: 0.0002, byOperation: {} } });

  const ended = await line("(I cast Magic Missile at the hoist rope)");

  assert.deepEqual(stepsOf(1), ["act", "reactions", "reply", "settle"]);
  const spells = (script.to("act")[0]!.body as ActRequest).turn.party[0]!.spells!;
  assert.deepEqual(spells.find(s => s.id === "magic-missile"), { id: "magic-missile", name: "Magic Missile", level: 1, range: "120 feet", effects: ["auto-hit"] }, "the act step is told each spell's reach: whether it needs aiming");
  const lines = turnLines(1);
  const dice = lines.filter(([kind]) => kind === "roll").map(([, text]) => text!);
  assert.deepEqual(lines.map(([kind]) => kind), ["player", ...dice.map(() => "roll"), "narration"], "the rules' lines before the reply");
  assert.match(dice[0]!, /^Cast Magic Missile \(1st-level slot\) on the hoist rope$/);
  assert.ok(dice.some(d => /hoist rope takes \d+ force damage and is destroyed/i.test(d)), dice.join("\n"));
  assert.ok(world().entities["hoist-rope"]!.states.includes("destroyed"));
  assert.ok(!world().entities.prout!.states.includes("hanging"), "what hung from the rope falls");
  assert.match(sheet().statusLine, /1st 3\/4/);
  assert.deepEqual(ended.gm.path.map(p => p.via), ["rules:cast:magic-missile", "reactions:kell=intervene,cob=flee,moll=cower"]);
  assert.deepEqual([ended.gm.absent, onStage().sort()], [["cob"], ["kell", "moll", `pc:${scene.controllerId}`]]);
  assert.ok(world().entities.moll!.states.includes("cowering"));
  assert.deepEqual([ended.gm.brawl, ended.gm.threat], [undefined, undefined], "no fight starts: that's the scene's routes' and the co-GM's");

  const reactions = script.to("reactions")[0]!.body as ReactionsRequest;
  assert.match(reactions.act.what, /^cast Magic Missile/);
  const reply = script.to("reply")[0]!.body as ReplyRequest;
  assert.deepEqual(reply.outcome.lines, dice);
  assert.equal(reply.outcome.acts?.length, 2);
  assert.match(reply.outcome.acts![0]!, /^Rules: the player cast Magic Missile/);
  assert.equal(reply.outcome.acts![1], "Rules: that was violence, and everyone here reacts at once.");
  assert.ok(reply.turn.transcript.filter(e => e.turn === 1 && e.kind === "roll").length === dice.length, "written before the reply was asked");
  const settle = script.to("settle")[0]!.body as SettleRequest;
  assert.deepEqual(settle.act, { lines: dice, reactions: QUIET }, "the co-GM is told what the rules decided, and who reacted how");
  assert.deepEqual(now().turns.map(t => t.phase), ["done", "done"]);
});

test("the user's report, turns 9 and 10: a rogue's Fire Bolt at Cob is no spell of hers, and the rules say so before the reply (no slot, no damage, nobody reacting); the reply is told the magic doesn't come", async () => {
  const { script, scene, world, sheet, line, turnLines, stepsOf } = await wizard("rogue");
  const status = sheet().statusLine;
  script.then("act", asked({ kind: "cast", spell: "not_theirs", targets: [] }), asked({ kind: "cast", spell: "not_theirs", targets: [] }));

  for (const [n, said] of [[1, "(I cast firebolt at the boy)"], [2, "(I cast firebolt at cob)"]] as const) {
    const done = await line(said);
    assert.deepEqual(stepsOf(n), ["act", "reply", "settle"], "nothing to react to");
    assert.deepEqual(turnLines(n), [["player", said], ["roll", "(Fire Bolt isn't a spell Wren Ashdown has ready: /sheet shows what they have.)"], ["narration", "Kell taps her pencil on the notebook. \"Noted.\""]]);
    assert.equal(done.gm.path.at(-1)?.via, "rules:cast:not_theirs");
    const reply = script.to("reply").at(-1)!.body as ReplyRequest;
    assert.deepEqual(reply.outcome.acts, ["The player reached for magic their character doesn't have ready (Fire Bolt). It doesn't come: nothing happens beyond a gesture, maybe a fizzle. Say so in a few words, in the fiction, without inventing any effect, and let them choose something else."]);
    assert.deepEqual((script.to("settle").at(-1)!.body as SettleRequest).act, { lines: ["(Fire Bolt isn't a spell Wren Ashdown has ready: /sheet shows what they have.)"] });
  }
  assert.equal(sheet().statusLine, status, "nothing spent");
  assert.deepEqual(world().entities.cob!.states.filter(st => ["hurt", "badly hurt", "down", "gone"].includes(st)), []);
  assert.deepEqual(script.to("reactions"), []);
  assert.deepEqual((script.to("act")[0]!.body as ActRequest).turn.party[0]!.spells, [], "the act step is told her sheet");
  void scene;
});

test("a spell said in words with no slot left for it is refused by the rules before the reply, with their reason, and the reply is told the magic doesn't come", async () => {
  const { script, sheet, line, turnLines } = await wizard();
  const atTheGate: Mechanic = { kind: "cast", spell: "magic-missile", targets: ["gate"] };
  script.then("act", ...Array.from({ length: 7 }, () => asked(atTheGate)));

  // Four from 1st-level slots, then two from 2nd-level ones, as the rules take a higher slot when the lower ones are gone.
  for (let n = 1; n <= 6; n++) await line(`(I cast Magic Missile at the yard gate, ${n})`);
  assert.match(sheet().statusLine, /1st 0\/4, 2nd 0\/2/, "every slot spent");
  await line("(I cast Magic Missile at the yard gate, again)");

  assert.deepEqual(turnLines(7).filter(([kind]) => kind === "roll"), [["roll", "(No spell slots left for Magic Missile: a long rest restores them.)"]]);
  const reply = script.to("reply").at(-1)!.body as ReplyRequest;
  assert.match(reply.outcome.acts![0]!, /^The player tried to cast Magic Missile, but their character has no spell slots left for it\. The magic doesn't come/);
  assert.match(sheet().statusLine, /1st 0\/4, 2nd 0\/2/, "nothing more spent");
});

test("what a spell said in words conjured is the spell's, as the map's act's is: the stage manager's spectral weapon marked conjured, to fade with the scene", async () => {
  const { script, world, line } = await wizard("cleric");
  script.then("act", asked({ kind: "cast", spell: "spiritual-weapon", targets: ["kell"] }));
  const weapon = { op: "create", what: "", to: "yard", how: "", feet: 0, name: "a spectral weapon", kind: "object", text: "A floating mace of light.", add: [], remove: [], quantity: 0 };
  script.then("settle", { ...settled(), ops: [weapon] });

  await line("(I cast Spiritual Weapon to hover over Kell's shoulder)");

  const made = Object.values(world().entities).find(e => e.name === "a spectral weapon");
  assert.deepEqual(made?.tags.filter(t => t.startsWith("conjured")), ["conjured", "conjured:spiritual-weapon"]);
});

test("an ordinary line goes straight to the reply, with no step before it; a line the check lets through that isn't an act asks once, and nothing comes of it", async () => {
  const { script, now, line, turnLines, stepsOf } = await wizard();

  await line("Sergeant, who found him, and when?");
  assert.deepEqual(stepsOf(1), ["reply", "settle"], "no act step: the line has nothing the rules resolve");

  const kicked = await line("(I kick the loose board by the water butt)");
  assert.deepEqual(stepsOf(2), ["act", "reply", "settle"], "the check asked: a kick might be a blow");
  assert.deepEqual(turnLines(2).map(([kind]) => kind), ["player", "narration"], "no dice: the act step answered none");
  assert.deepEqual(kicked.gm.path.filter(p => p.turn === 2), []);
  assert.equal((script.to("reply")[1]!.body as ReplyRequest).outcome.acts, undefined);
  assert.equal((script.to("settle")[1]!.body as SettleRequest).act, undefined);
  assert.deepEqual(now().turns.map(t => t.phase), ["done", "done", "done"]);
});

test("the map's act, resolved by the rules as its turn starts: a spell at a thing writes the dice rows, the world and the sheet; the reply is told the act, the stage manager its dice lines; breaking the rope where people are draws their reactions, as a line's act does", async () => {
  const { script, scene, now, world, sheet, onStage, act, turnLines, stepsOf } = await wizard();
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
  assert.deepEqual(stepsOf(2), ["reactions", "reply", "settle"], "no act step: its mechanic was chosen already");
  assert.match((script.to("reactions")[0]!.body as ReactionsRequest).act.what, /^cast Magic Missile setting the hoist rope burning or breaking it$/);
  assert.deepEqual(onStage().sort(), ["cob", "kell", "moll", `pc:${scene.controllerId}`], "the scripted AI's nobody reacts");
  assert.deepEqual(now().turns.map(t => t.phase), ["done", "done", "done"]);
});

test("the reactions to the player's violence take effect on the world and the bookkeeping (the fleeing gone, absent and off the stage, the cowering cowering), their directive after the act's; someone who'd fight starts no fight, and nothing hangs over the player as the next turn starts", async () => {
  const { host, script, scene, world, onStage, line, turnLines } = await wizard();
  const directive = "Rules: that was violence, and everyone here reacts at once.";
  const outcome = host.transact(tx => {
    const at = atTurn(tx, { scene: idText(scene.id) });
    const out: Outcome = { lines: [], directives: [] };
    const violence = takeAct(tx, at, { n: 1, input: "(I cast Magic Missile at the hoist rope)" }, MISSILE, out)!;
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

  // Kell would fight: she turns on the player, but no fight starts and no blow hangs over them.
  host.transact(tx => {
    const at = atTurn(tx, { scene: idText(scene.id) });
    const out: Outcome = { lines: [], directives: [] };
    const violence = takeAct(tx, at, { n: 1, input: "*I hit the sergeant with my staff.*" }, { kind: "attack", target: "kell" }, out)!;
    reactionsTakeEffect(tx, at, { n: 1 }, violence, { kell: "fight", moll: "cower" }, "Rules: that was violence. End on the moment they turn on the player.", out);
    putGm(tx, scene.id, at.gm);
  });
  const angry = sceneNow(host, scene.id).gm;
  assert.deepEqual([angry.brawl, angry.threat], [undefined, undefined]);
  assert.equal(angry.path.at(-1)?.via, "reactions:kell=fight,moll=cower");
  await line("(I put my hands up)");
  assert.ok(!turnLines(1).some(([kind, text]) => kind === "roll" && /attack on you/.test(text!)), "no blow lands as the next turn starts");
  assert.deepEqual((script.to("reply")[0]!.body as ReplyRequest).outcome.directives, []);
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
