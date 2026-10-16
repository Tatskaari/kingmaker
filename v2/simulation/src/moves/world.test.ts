import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConsiderRequest, Decision, DecideRequest, DecideResponse, ReactionsRequest, ReactionsResponse, ReplyRequest, SettleRequest, SettleResponse } from "../../../shared/protocol/ai.ts";
import { keyParts } from "../../../shared/protocol/keys.ts";
import type { Mechanic, Reaction } from "../../../shared/rules/types.ts";
import { ignite } from "../../../shared/world/systems.ts";
import { getGm } from "../gm/rows.ts";
import { openedGame, sceneNow } from "../host/testing.ts";
import { sceneRow } from "../rows.ts";
import { sceneGraph } from "../scenes.ts";
import { placeWorldOf, savePlaceWorld } from "../world/place.ts";

/**
 * The world bridge in a scene (world-bridge-design §3.4), on the memory host with the AI service
 * scripted and the rules engine the module's own: the player's act resolved in the decide commit
 * (its dice rows, the world and the sheet), the reactions to it before the reply, a fight that breaks
 * out (the move's ending undone, the ruling skipped), what the last reply left hanging landing as the
 * next turn starts, fire burning on, and the rules' state kept from turn to turn.
 */

const none = { calls: 0, costUsd: 0, byOperation: {} };
const decided = (d: Partial<Decision> = {}): DecideResponse => ({ decision: { earned: false, daft: false, outOfCharacter: false, ...d }, opened: [], usage: none });
const acts = (mechanic: Mechanic, d: Partial<Decision> = {}) => decided({ mechanic, ...d });
const reacting = (reactions: Record<string, Reaction>, directive = "Rules: that was violence, and everyone here reacts at once."): ReactionsResponse => ({ reactions, directive, usage: none });
const read = (a: Partial<NonNullable<SettleResponse["after"]>> = {}): SettleResponse => ({ ops: [], after: { landed: [], hinted: [], unanswered: false, theirs: false, ...a }, usage: none });

const MISSILE: Mechanic = { kind: "cast", spell: "magic-missile", targets: ["hoist-rope"] };
/** fake.json's quiet reactions for the yard. */
const QUIET = reacting({ kell: "intervene", cob: "flee", moll: "cower" });

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
  const turnLines = (n: number) => now().lines.filter(l => l.turn === n).map(l => [l.kind, l.text]);
  return { host, script, scene, player, now, world, sheet, rules, onStage, line, turnLines };
}

test("a spell at a thing: the decide commit writes the dice rows, the world and the sheet; the reactions to it come before the reply (Cob flees: gone, absent, off the stage); the reply is told the act and the reactions", async () => {
  const { script, scene, now, world, sheet, onStage, line } = await wizard();
  assert.deepEqual(onStage().sort(), ["cob", "kell", "moll", `pc:${scene.controllerId}`]);
  const phases: string[] = [];
  const phaseNow = () => phases.push(now().turns[1]!.phase);
  let before: { lines: string[][]; rope: string[]; prout: { parent?: string | null; states: string[] }; status: string } | undefined;
  script.then("decide", () => { phaseNow(); return acts(MISSILE); });
  script.then("reactions", () => {
    phaseNow();
    const w = world();
    before = { lines: now().lines.filter(l => l.turn === 1).map(l => [l.kind, l.text]), rope: w.entities["hoist-rope"]!.states, prout: { parent: w.entities.prout!.parent, states: w.entities.prout!.states }, status: sheet().statusLine };
    return QUIET;
  });
  script.then("reply", () => { phaseNow(); return { entries: [{ speaker: "gm", kind: "narration", text: "Three darts of light cut the rope, and the clerk drops." }], gm: { repeated: null }, firstTextMs: 3, usage: none }; });
  script.then("settle", () => { phaseNow(); return read(); });

  const ended = await line("(I cast Magic Missile at the hoist rope)");

  // In the decide commit, before anyone was asked how they react: the dice rows, the rope destroyed, Prout fallen, a slot spent.
  assert.deepEqual(phases, ["deciding", "deciding", "replying", "settling"], "the turn stays deciding while the reactions are asked");
  const dice = before!.lines.filter(([kind]) => kind === "roll").map(([, text]) => text!);
  assert.match(dice[0]!, /^Cast Magic Missile \(1st-level slot\)/);
  assert.ok(dice.some(d => /hoist rope takes \d+ force damage and is destroyed/i.test(d)), dice.join("\n"));
  assert.ok(before!.rope.includes("destroyed"));
  assert.notEqual(before!.prout.parent, "hoist-rope", "what hung from the rope falls");
  assert.ok(!before!.prout.states.includes("hanging"));
  assert.match(before!.status, /1st 3\/4/);

  // The reactions: asked with the act, on the world after it; the fleeing gone from the world and the stage, the cowering cowering.
  const asked = script.to("reactions")[0]!.body as ReactionsRequest;
  assert.equal(keyParts(asked.key)?.step, "reactions");
  assert.deepEqual([asked.act.victims, asked.act.property], [[], ["hoist-rope"]]);
  assert.match(asked.act.what, /^cast Magic Missile/);
  assert.deepEqual(asked.turn.transcript.filter(e => e.turn === 1 && e.kind === "roll").map(e => e.text), dice);
  assert.deepEqual(ended.gm.absent, ["cob"]);
  assert.ok(world().entities.cob!.states.includes("gone"));
  assert.ok(world().entities.moll!.states.includes("cowering"));
  assert.deepEqual(onStage().sort(), ["kell", "moll", `pc:${scene.controllerId}`]);
  assert.deepEqual(ended.gm.path.map(p => p.via), ["rules:cast:magic-missile", "reactions:kell=intervene,cob=flee,moll=cower"]);
  assert.equal(ended.gm.brawl, undefined);

  // The reply: the dice lines, the act's directive then the reactions'; the settle's stage manager has the same lines.
  const reply = script.to("reply")[0]!.body as ReplyRequest;
  assert.deepEqual(reply.outcome.lines, dice);
  assert.equal(reply.outcome.acts?.length, 2);
  assert.match(reply.outcome.acts![0]!, /Magic Missile/);
  assert.equal(reply.outcome.acts![1], QUIET.directive);
  assert.equal(reply.outcome.brawl, undefined);
  assert.deepEqual((script.to("settle")[0]!.body as SettleRequest).lines, dice);
  assert.deepEqual(ended.turns.map(t => t.phase), ["done", "done"]);
});

test("a fight breaking out undoes the ending the move reached this turn: nothing closes, the reply is told of the brawl, and the first fighter's blow lands first next turn", async () => {
  const { script, line, turnLines } = await wizard();
  script.then("decide", acts({ kind: "attack", target: "kell" }, { route: { id: "walk-away", phase: "attempt" } }));
  script.then("reactions", reacting({ kell: "fight", cob: "flee", moll: "cower" }, "Rules: that was violence. It's a fight now: end on the moment it breaks out."));

  const fought = await line("*I hit the sergeant with my staff and make for the gate.*");

  const reply = script.to("reply")[0]!.body as ReplyRequest;
  assert.deepEqual([reply.outcome.brawl, reply.outcome.taken, reply.outcome.closes], [true, undefined, undefined]);
  assert.equal(reply.outcome.move?.exit, "walked-away", "the move itself is still told");
  assert.deepEqual([fought.scene.status, fought.gm.ended, fought.gm.closing], ["live", undefined, undefined]);
  assert.deepEqual(fought.gm.brawl, { turn: 1, cause: (script.to("reactions")[0]!.body as ReactionsRequest).act.what, against: ["kell"], allies: [], fled: ["cob"] });
  assert.deepEqual(fought.gm.threat, { kind: "attack", by: "kell", turn: 1 });

  // The blow left hanging lands as the next turn starts, before the player acts.
  script.then("decide", (request: DecideRequest) => {
    assert.equal(request.turn.gm.threat, undefined, "it's taken off as it lands");
    return decided();
  });
  const next = await line("(I put my hands up)");
  const first = turnLines(2);
  assert.deepEqual(first[0], ["player", "(I put my hands up)"]);
  assert.equal(first[1]![0], "roll");
  assert.match(first[1]![1]!, /Kell's attack on you/);
  assert.equal(next.gm.threat, undefined);
  const directives = (script.to("reply")[1]!.body as ReplyRequest).outcome.directives;
  assert.equal(directives.length, 1);
  assert.match(directives[0]!, /^Rules/);
  assert.equal(script.to("reactions").length, 1, "no more violence is asked about while the fight is on");
});

test("a fight breaking out is the turn's answer: the GM's ruling on the act is skipped; with no fight it comes after the reactions", async () => {
  const { script, now, line } = await wizard();
  const considered = { probability: 0.8, routes: [], means: "athletics" as const };
  const phases: string[] = [];
  script.then("decide", acts({ kind: "wrestle", target: "cob", how: "grapple" }, { considered }));
  script.then("reactions", () => { phases.push(now().turns[1]!.phase); return reacting({ kell: "intervene", cob: "cower", moll: "cower" }); });
  script.then("consider", () => { phases.push(now().turns[1]!.phase); return { error: "scripted: no ruling", ms: 0, usage: none }; });

  await line("(I grab the boy by the collar and haul him off the cobbles)");
  assert.deepEqual(phases, ["deciding", "considering"], "the ruling comes once the reactions are in");
  assert.equal((script.to("consider")[0]!.body as ConsiderRequest).read?.means, "athletics");

  script.then("decide", acts({ kind: "attack", target: "moll" }, { considered }));
  script.then("reactions", reacting({ kell: "fight", cob: "flee", moll: "fight" }));
  const fought = await line("(I knock the girl off the wall to see if her story holds)");
  assert.equal(script.to("consider").length, 1, "no ruling on the turn the fight broke out");
  assert.equal((script.to("reply")[1]!.body as ReplyRequest).outcome.brawl, true);
  assert.deepEqual(fought.gm.brawl?.against, ["kell", "moll"]);
});

test("a blow the last reply left hanging lands as the next turn starts, before the decide; a hold the reply no longer has them in lets them go", async () => {
  const { script, sheet, line, turnLines } = await wizard();
  const hp = sheet().hp;
  script.then("settle", read({ threat: { kind: "attack", by: "kell" }, threatRead: "attack:kell" }));
  const left = await line("I'm not going anywhere, Sergeant.");
  assert.deepEqual(left.gm.threat, { kind: "attack", by: "kell", turn: 1 });

  let decide: DecideRequest | undefined;
  script.then("decide", (request: DecideRequest) => { decide = request; return decided(); });
  const landed = await line("(I stand my ground)");
  const dice = turnLines(2).filter(([kind]) => kind === "roll").map(([, text]) => text!);
  assert.match(dice[0]!, /Kell's attack on you: .* vs AC \d+: (hit|miss|critical hit!)/);
  assert.deepEqual(decide!.turn.transcript.filter(e => e.turn === 2 && e.kind === "roll").map(e => e.text), dice, "landed before the decide was asked");
  assert.equal(decide!.turn.gm.threat, undefined);
  assert.equal(landed.gm.threat, undefined);
  assert.deepEqual((script.to("reply")[1]!.body as ReplyRequest).outcome.lines, dice, "the turn's dice lines start with what landed");
  if (dice.some(d => /You take \d+/.test(d))) assert.ok(sheet().hp < hp, "the blow's damage is on the sheet");
  assert.ok(script.to("decide")[1]!.body.turn.party[0].status, "the GM is told the player's state after it");

  // A hold: the reply leaves them grabbed (a saving throw as it lands); while the reply still has them, it stands; once not, it's gone.
  script.then("settle", read({ threat: { kind: "hazard", hazard: "grab_or_shove", severity: "serious" }, threatRead: "hazard:grab_or_shove" }));
  await line("(I try to push past him to the gate)");
  script.then("settle", read({ threatRead: "hazard:grab_or_shove" }));
  const grabbed = await line("(I struggle)");
  const save = turnLines(4).filter(([kind]) => kind === "roll").map(([, text]) => text!);
  assert.match(save[0] ?? "", /Strength save/);
  assert.equal(grabbed.gm.held === undefined, /saved/.test(save.join(" ")), "a failed save leaves them held");
  script.then("settle", read({ threatRead: "none" }));
  const free = await line("(I wait)");
  assert.equal(free.gm.held, undefined, "the reply no longer has them held");
});

test("what's burning burns on as a turn starts, before the decide: its dice lines and its directive lead the turn", async () => {
  const { host, script, scene, world, line, turnLines } = await wizard();
  host.transact(tx => {
    const row = sceneRow(tx, scene.id);
    const place = placeWorldOf(tx, row);
    ignite(place.world, place.world.entities.gate!, 0);
    savePlaceWorld(tx, row, place, sceneGraph(tx, row, getGm(tx, scene.id)));
  });
  assert.ok(world().entities.gate!.states.includes("burning"));

  let decide: DecideRequest | undefined;
  script.then("decide", (request: DecideRequest) => { decide = request; return decided(); });
  await line("(I watch the gate burn)");

  const dice = turnLines(1).filter(([kind]) => kind === "roll").map(([, text]) => text!);
  assert.ok(dice.length >= 1);
  assert.match(dice[0]!, /^The yard gate takes \d+ fire damage/);
  assert.deepEqual(decide!.turn.transcript.filter(e => e.turn === 1 && e.kind === "roll").map(e => e.text), dice, "it burned before the decide was asked");
  const reply = script.to("reply")[0]!.body as ReplyRequest;
  assert.match(reply.outcome.directives[0]!, /^Rules, since the last reply: The yard gate takes/);
  assert.deepEqual((script.to("settle")[0]!.body as SettleRequest).lines, dice, "the stage manager is told what burned");
});

test("the rules keep their state from turn to turn: someone the rules have touched is the engine's same character, and a running spell's time passes", async () => {
  const { script, rules, line, turnLines } = await wizard();
  const created = () => rules().campaign.split('"CharacterCreated"').length - 1;
  const before = created();

  for (const n of [1, 2, 3]) {
    script.then("decide", acts({ kind: "attack", target: "kell" }));
    await line(`(I swing my staff at the sergeant, ${n})`);
    assert.deepEqual(Object.keys(JSON.parse(rules().npcs) as object), ["kell"]);
  }
  const kell = (JSON.parse(rules().npcs) as Record<string, { id: string; weapon: string }>).kell!;
  assert.equal(created(), before + 1, "Kell was made once, and stays hurt from one turn to the next");
  assert.ok(kell.id && kell.weapon);

  // A spell with a duration: timed is kept, and the next turn's start runs its minute on, when it runs out.
  script.then("decide", acts({ kind: "cast", spell: "sleep", targets: ["cob"] }));
  await line("(I cast Sleep on the boy)");
  assert.equal(rules().timed, true);
  await line("(I wait a moment)");
  assert.deepEqual(turnLines(5).filter(([kind]) => kind === "roll"), [["roll", "Sleep has run out"]]);
  assert.deepEqual((script.to("reply")[4]!.body as ReplyRequest).outcome.directives, ["Rules: Sleep has run out (the spell's time is up)."]);
  assert.equal(rules().timed, false);
});
