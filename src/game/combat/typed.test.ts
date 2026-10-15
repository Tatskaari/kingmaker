import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChoiceQuestion, Decider, Decision } from "../../llm/decide.ts";
import type { CombatantSetup, Tile2 } from "../types.ts";
import { startCombat } from "./controller.ts";
import { tacticalFights, TacticalFight } from "./fights.ts";
import { heronMap } from "./heron-grid.ts";
import { heronEncounter } from "./heron.ts";
import { pregenSession } from "./pregen.ts";
import { parseCommand, readLine, type Reading } from "./typed.ts";
import { areaCatch, turnOf } from "./typed-turn.ts";
import type { Voice } from "./voice.ts";

/**
 * The typed line in a fight (typed.ts): the plain commands with no model, the decider choosing
 * among the turn's own actions (a stub here, answering as told), refusals that spend nothing, the
 * action economy, and speech. On real fights at the Heron, so what's legal is the rules' own.
 *
 *   node --no-warnings --test src/game/combat/typed.test.ts
 */

process.env.OPENROUTER_API_KEY = "offline";

/** A Heron fight where the player goes first, with people where the test wants them (the player at 22,6). */
async function heron(pregen = "fighter", at: Record<string, Tile2> = {}, level = 3): Promise<TacticalFight> {
  for (let seed = 1; seed < 40; seed++) {
    const session = await pregenSession({ pregen, seed: 3, level });
    session.beat = "midnight";
    session.established.push("Master Sallow has come to the Heron.");
    const setup = heronEncounter(heronMap(), session, { sallow: true, seed });
    const combatants = setup.combatants.map((c: CombatantSetup) => (at[c.id] ? { ...c, at: at[c.id]! } : c));
    const combat = await startCombat({ ...setup, combatants }, session);
    if (combat.state().order[0] !== combat.state().pc) continue;
    const fight = new TacticalFight(combat, []);
    fight.begin();
    return fight;
  }
  throw new Error("no seed where the player goes first");
}

/** The Crake beside the player, east of them. */
const BESIDE = { "crake-1": { x: 23, y: 6 } };

/**
 * A decider that answers as told, and otherwise the quiet answer (no, none, nobody, lowest), and
 * keeps what it was asked. Probabilities are 1 unless `unsure` (0.3), or as given in `spread`.
 */
function stub(answers: Record<string, string>, unsure: string[] = [], spread: Record<string, Record<string, number>> = {}): Decider & { asked: Array<Record<string, ChoiceQuestion>> } {
  const asked: Array<Record<string, ChoiceQuestion>> = [];
  return {
    name: "stub", asked,
    async decide(_state: unknown, questions: Record<string, ChoiceQuestion>): Promise<Decision> {
      asked.push(questions);
      const quiet = ["no", "none", "nobody", "lowest", "not_possible", "after"];
      const out: Decision["answers"] = {};
      for (const [id, q] of Object.entries(questions)) {
        const keys = Object.keys(q.criteria);
        const choice = answers[id] !== undefined && keys.includes(answers[id]!) ? answers[id]! : quiet.find(k => keys.includes(k)) ?? keys[0]!;
        out[id] = { choice, probabilities: spread[id] ?? { [choice]: unsure.includes(id) ? 0.3 : 1 } };
      }
      return { answers: out, latencyMs: 0, costUsd: 0, decider: "stub" };
    },
  };
}

const offline = (line: string, fight: TacticalFight) => readLine(line, fight, null);
/** The deeds the decider is offered on this turn (a stub's first question). */
const offered = async (fight: TacticalFight) => { const d = stub({ deed: "speak_only" }); await readLine("Hm.", fight, d); return d.asked[0]!.deed!.criteria; };
const spent = (fight: TacticalFight) => { const o = fight.controller.options(); return { action: o.actionUsed, moved: fight.controller.state().units.player!.at, log: fight.controller.state().log.length }; };

describe("the plain commands, with no model", () => {
  it("read attacks, spells, moves, things to knock over and the end of the turn onto the fight's own action ids", async () => {
    const f = await heron("fighter", BESIDE);
    assert.deepEqual((await offline("attack the talking crake", f)).steps, ["attack_crake-1"]);
    assert.deepEqual((await offline("(I attack the crake with my longsword)", f)).steps, ["attack_crake-1_with_longsword"]);
    assert.deepEqual((await offline("*shoots Sallow with the longbow*", f)).steps, ["attack_sallow_with_longbow"]);
    assert.deepEqual((await offline("hit the crake with a bottle", f)).steps, ["attack_crake-1_with_improvised"]);
    assert.deepEqual((await offline("move to the brazier", f)).steps, ["close_brazier"]);
    assert.deepEqual((await offline("move to the brazier and kick it over", f)).steps, ["close_brazier", "use_brazier"]);
    assert.deepEqual((await offline("shove the crake over", f)).steps, ["shove_crake-1"]);
    assert.deepEqual((await offline("push the crake back", f)).steps, ["push_crake-1"]);
    assert.deepEqual((await offline("grab the talking crake", f)).steps, ["grapple_crake-1"]);
    assert.deepEqual((await offline("intimidate the crake into giving up", f)).steps, ["urge_intimidation_yield_crake-1"]);
    assert.deepEqual((await offline("dodge", f)).steps, ["dodge"]);
    assert.deepEqual((await offline("end turn", f)).steps, ["end_turn"]);
    assert.equal((await offline("end turn", f)).by, "parser");
  });

  it("close in first when someone's out of reach but can be got to this turn", async () => {
    const f = await heron("fighter", { "crake-1": { x: 19, y: 6 } });
    assert.deepEqual((await offline("attack the talking crake with my sword", f)).steps, ["close_crake-1", "attack_crake-1_with_longsword"]);
    assert.deepEqual((await offline("grab the talking crake", f)).steps, ["close_crake-1", "grapple_crake-1"]);
  });

  it("read a spell, at whom (the nearest of a kind), and from which slot", async () => {
    const f = await heron("wizard", { "crake-1": { x: 18, y: 6 }, "crake-2": { x: 15, y: 7 } }, 5);
    assert.deepEqual((await offline("cast fire bolt at the nearest crake", f)).steps, ["cast_fire-bolt_crake-1"]);
    assert.deepEqual((await offline("cast magic missile at sallow with a 2nd-level slot", f)).steps, ["cast_magic-missile_sallow_slot2"]);
    assert.deepEqual((await offline("cast fireball at sallow", f)).steps, ["cast_fireball_at_sallow"]);
    assert.deepEqual((await offline("cast shield", f)).steps.length, 0, "a reaction isn't cast on your turn");
  });

  it("refuse what can't be done, with the reason, and spend nothing", async () => {
    const f = await heron("cleric");
    const before = spent(f);
    const fireball = await offline("cast fireball at sallow", f);
    assert.match(fireball.refusal ?? "", /Fireball isn't one of your spells/);
    assert.match((await offline("attack sallow", f)).refusal ?? "", /out of reach.*can't get beside them/);
    assert.match((await offline("attack kell", f)).refusal ?? "", /on your side/);
    assert.match((await offline("attack the lantern-boy", f)).refusal ?? "", /isn't fighting anyone/);
    assert.match((await offline("attack the dragon", f)).refusal ?? "", /nobody and nothing here called "the dragon"/);
    assert.match((await offline("cast guiding bolt at sallow with a 3rd-level slot", f)).refusal ?? "", /no 3rd-level slot left/);
    // Through the fight: the refusal is all there is.
    const said = await f.say("cast fireball at sallow", {}, { decider: null, voice: null });
    assert.match(said, /^\(Fireball isn't one of your spells/);
    assert.deepEqual(spent(f), before, "nothing spent, nothing moved, nothing logged");
  });

  it("keep to the action economy: one action a turn (its attacks), one bonus action", async () => {
    const wizard = await heron("wizard", BESIDE, 5);
    assert.match((await offline("attack the crake and cast fire bolt at sallow", wizard)).refusal ?? "", /more than one thing that takes your action/);
    // A level-five fighter's action is two attacks.
    const fighter = await heron("fighter", BESIDE, 5);
    assert.deepEqual((await offline("attack the crake and attack the crake", fighter)).steps, ["attack_crake-1", "attack_crake-1"]);
    assert.match((await offline("attack the crake, attack the crake and attack the crake", fighter)).refusal ?? "", /2 attacks left/);
    // Once the action's gone, so are the things that take it.
    await fighter.say("shove the crake over", {}, { decider: null, voice: null });
    assert.match((await offline("dodge", fighter)).refusal ?? "", /already used your action/);
    assert.match((await offline("attack the crake", fighter)).refusal ?? "", /attack's spent/);
    // A bonus action beside the action: Healing Word (a cleric's) and a blow; not two bonus actions.
    const cleric = await heron("cleric", BESIDE);
    assert.deepEqual((await offline("cast healing word on kell and attack the crake", cleric)).steps, ["cast_healing-word_kell", "attack_crake-1"]);
    assert.match((await offline("cast healing word on kell and cast shield of faith on kell", cleric)).refusal ?? "", /two bonus actions/);
    const both = await readLine("I clout the crake with my mace and call a word of healing to Kell", cleric, stub({ deed: "attack:crake-1:mace", bonus: "cast:healing-word:kell" }));
    assert.deepEqual(both.steps, ["attack_crake-1_with_mace", "cast_healing-word_kell"]);
    // Spiritual Weapon is a bonus action whose first swing wants the action too: not beside a blow, and not once the action's gone.
    assert.match((await offline("attack the crake and cast spiritual weapon at the crake", cleric)).refusal ?? "", /more than one thing that takes your action/);
    await cleric.say("attack the crake", {}, { decider: null, voice: null });
    assert.match((await offline("cast spiritual weapon at the crake", cleric)).refusal ?? "", /^Spiritual Weapon takes your action as well as your bonus action \(its first swing\), and your action's spent this turn\.$/);
  });

  it("say the GM is offline for a line that isn't a plain command, with commands that fit the fight", async () => {
    const f = await heron("fighter", BESIDE);
    const r = await offline("Give it up, Crake, nobody's paying you for this!", f);
    assert.equal(r.offline, true);
    assert.match(r.refusal ?? "", /The GM is offline.*attack the crake, move to the brazier, shove the crake over, end turn/);
    const wizard = await heron("wizard", BESIDE, 5);
    assert.match((await offline("Give it up!", wizard)).refusal ?? "", /attack the crake, cast fire bolt at the nearest crake, move to the brazier/);
    assert.equal(parseCommand("I gaze thoughtfully at the brazier", turnOf(f)), undefined);
  });

  it("don't take a shout at someone else for the player's own move", async () => {
    const f = await heron("fighter", BESIDE);
    assert.deepEqual((await offline("back off", f)).steps, ["back_off"], "typed plainly, it's a command");
    for (const shout of ["Back off!", "Wait!", "Get out!", "Flee, you fools!", "Done!"]) {
      assert.equal(parseCommand(shout, turnOf(f)), undefined, `"${shout}" is words`);
      assert.equal((await offline(shout, f)).offline, true);
    }
  });
});

describe("the decider, choosing among the turn's own actions", () => {
  it("is offered what the rules allow this turn, and why not for the rest", async () => {
    const d = stub({ deed: "speak_only", said_to: "crake-1" });
    const f = await heron("wizard", BESIDE, 5);
    await readLine("Well, this is awkward.", f, d);
    const deed = Object.keys(d.asked[0]!.deed!.criteria);
    for (const k of ["attack:crake-1:quarterstaff", "shove:crake-1", "grapple:crake-1", "improvised:crake-1", "cast:fire-bolt:crake-1", "cast:fireball:sallow", "use:brazier", "dodge", "end", "speak_only", "check:search", "not_theirs", "not_possible", "cannot:cast:shield"]) assert.ok(deed.includes(k), `${k} offered`);
    assert.ok(!deed.some(k => k.startsWith("attack:lantern-boy")), "nobody's offered the lantern-boy");
    assert.ok(Object.keys(d.asked[0]!.urged!.criteria).includes("crake-1"));
  });

  it("puts a deed's steps together: the act, a move before or after it (once), a second act, a bonus action", async () => {
    const f = await heron("fighter", BESIDE);
    const r = await readLine("I hit him and back off", f, stub({ deed: "attack:crake-1:longsword", move: "away", move_when: "after" }));
    assert.deepEqual(r.steps, ["attack_crake-1_with_longsword", "back_off"]);
    const far = await heron("fighter", { "crake-1": { x: 19, y: 6 } });
    const closed = await readLine("I charge the talking crake and cut him down", far, stub({ deed: "attack:crake-1:close" }));
    assert.deepEqual(closed.steps, ["close_crake-1", "attack_crake-1_with_longsword"]);
    const brazier = await readLine("I run to the brazier", far, stub({ deed: "move_only", move: "close:brazier" }));
    assert.deepEqual(brazier.steps, ["close_brazier"]);
    // One move, where the line has it: after the shot, not before it and after it.
    const wizard = await heron("wizard", BESIDE, 5);
    const ran = await readLine("*I shoot a ray of frost at the crake, then run to the brazier*", wizard, stub({ deed: "cast:ray-of-frost:crake-1", move: "close:brazier", move_when: "after" }));
    assert.deepEqual(ran.steps, ["cast_ray-of-frost_crake-1", "close_brazier"]);
    // A Disengage comes before the move it's for, whatever the read of when.
    const away = await readLine("I disengage and back off to the gate", wizard, stub({ deed: "disengage", move: "door", move_when: "before" }));
    assert.deepEqual(away.steps, ["disengage", "make_for_the_door"]);
    // Words move nobody: "Get back!" is for whoever it's said to, however the move question reads it.
    const told = await readLine("Back! Go on, get back, the lot of you!", f, stub({ deed: "speak_only", said_to: "crake-1", move: "away" }));
    assert.deepEqual(told.steps, []);
    assert.equal(told.speech?.to, "crake-1");
    // A second act: a fighter's second attack is done; after a shove, which takes the whole action, the stab isn't, and it says so.
    const fifth = await heron("fighter", BESIDE, 5);
    assert.deepEqual((await readLine("I hit the talking crake twice", fifth, stub({ deed: "attack:crake-1:longsword", deed2: "attack:crake-1:longsword" }))).steps, ["attack_crake-1_with_longsword", "attack_crake-1_with_longsword"]);
    const shoved = await readLine("I shove him down, then stab him", fifth, stub({ deed: "shove:crake-1", deed2: "attack:crake-1:longsword" }));
    assert.deepEqual(shoved.steps, ["shove_crake-1"]);
    assert.match(shoved.note ?? "", /took your whole action, so attack the talking Crake with your Longsword didn't happen as well/);
  });

  it("walks the plan on the board first: a step back keeps the line for the spell after it, and a way out too far is refused", async () => {
    const wizard = await heron("wizard", BESIDE, 5);
    const before = spent(wizard);
    const r = await readLine("I step away from the crake and cast fire bolt at Sallow", wizard, stub({ deed: "cast:fire-bolt:sallow", move: "away", move_when: "before" }));
    assert.equal(r.steps.length, 2);
    assert.match(r.steps[0]!, /^(?:back_off|move_\d+_\d+)$/);
    assert.equal(r.steps[1], "cast_fire-bolt_sallow");
    // Done: the step back, then the bolt (the Crake's swing as the wizard goes is the rules').
    const said = await wizard.say("I step away from the crake and cast fire bolt at Sallow", {}, { decider: stub({ deed: "cast:fire-bolt:sallow", move: "away", move_when: "before" }), voice: null });
    assert.match(said, /You move \d+ ft/);
    assert.match(said, /You cast Fire Bolt \(cantrip\) at Master Sallow/);
    assert.notDeepEqual(spent(wizard).moved, before.moved);
    // Too far to get out through the door this turn: how far, and what would do it; nothing spent.
    const fighter = await heron("fighter", BESIDE);
    const fled = await offline("flee", fighter);
    assert.match(fled.refusal ?? "", /The river door is 35 ft off, and going out through it takes 5 ft more: you've 35 ft of movement\. A Dash would get you out \("dash and leave"\)/);
    assert.deepEqual((await offline("dash and leave", fighter)).steps, ["dash", "make_for_the_door", "leave"]);
    const stayed = spent(fighter);
    assert.match(await fighter.say("flee", {}, { decider: null, voice: null }), /^\(The river door is 35 ft off/);
    assert.deepEqual(spent(fighter), stayed);
    // A named move that's there already is no move: beside the Crake, closing on him goes nowhere.
    const beside = fighter.perform("close_crake-1");
    assert.equal(beside.ok, true);
    assert.deepEqual(spent(fighter), stayed);
    // Standing in the way out, it's leave, not making for it.
    const door = await heron("fighter", { player: { x: 29, y: 6 } });
    assert.ok(door.actions().some(a => a.id === "leave"));
    assert.ok(!door.actions().some(a => a.id === "make_for_the_door"));
  });

  it("aims an area where it misses you and yours when it isn't said where, and asks again before one that catches a friend", async () => {
    const wizard = await heron("wizard", BESIDE, 5);
    const untold = await offline("cast fireball", wizard);
    const aim = /^cast_fireball_at_(.+)$/.exec(untold.steps[0] ?? "")?.[1];
    assert.ok(aim, untold.refusal ?? "no aim");
    const t = turnOf(wizard);
    assert.deepEqual(areaCatch(t.o.spells.find(sp => sp.id === "fireball")!, t.s.unit(aim)!.at, t).friends, [], "nobody of yours in it");
    // At the Crake beside you: it catches you and Kell. Said once, it says so and spends nothing; said again, it's done.
    const before = spent(wizard);
    const first = await wizard.say("cast fireball at the talking crake", {}, { decider: null, voice: null });
    assert.match(first, /^\(Fireball at the talking Crake would catch you and Sergeant Kell too\. Say it again to do it anyway/);
    assert.deepEqual(spent(wizard), before);
    // Said again in a game loaded from its save (the QA console's way: a process a command), it's done.
    const loaded = tacticalFights().load(JSON.parse(JSON.stringify(wizard.save())), wizard.controller.session) as TacticalFight;
    const again = await loaded.say("cast fireball at the talking crake", {}, { decider: null, voice: null });
    assert.match(again, /You cast Fireball \(3rd-level slot\): a 20-foot sphere, catching .*you/);
  });

  it("refuses magic they haven't got, a spell that can't be cast now, and what it isn't sure of", async () => {
    const f = await heron("fighter", BESIDE);
    assert.match((await readLine("I conjure a great ball of fire at them", f, stub({ deed: "not_theirs" }))).refusal ?? "", /isn't magic you have/);
    // A spell named plainly is the rules' to refuse, with no model: the same answer, by its name.
    assert.match((await readLine("I cast a fireball", f, stub({ deed: "not_theirs" }))).refusal ?? "", /Fireball isn't one of your spells/);
    const wizard = await heron("wizard", BESIDE, 5);
    assert.match((await readLine("I put up a shield", wizard, stub({ deed: "cannot:cast:shield" }))).refusal ?? "", /Shield isn't a spell a fight on the map can play out/);
    assert.match((await readLine("I do the thing", f, stub({ deed: "attack:crake-1:longsword" }, ["deed"]))).refusal ?? "", /Not sure what you mean/);
    // Hand to hand with someone a shot can reach but feet can't: why not, and what can.
    const rogue = await heron("rogue", BESIDE);
    assert.match((await readLine("*I tumble past the crake and go for Sallow*", rogue, stub({ deed: "cannot:close:sallow" }))).refusal ?? "", /Master Sallow is 50 ft off: you can't get beside them this turn \(your Shortbow reaches them from here\)/);
    // A spell at someone it can't reach says why in its own words, not a blow's.
    const hidden = await heron("wizard", { ...BESIDE, "crake-2": { x: 2, y: 1 } }, 5);
    assert.ok(Object.keys(await offered(hidden)).includes("cannot:cast:fire-bolt:crake-2"));
    assert.match((await readLine("*I loose a fire bolt at the silent crake, wherever he's got to*", hidden, stub({ deed: "cannot:cast:fire-bolt:crake-2" }))).refusal ?? "", /^There's no clear line to the silent Crake from here\. Nothing's spent\.$/);
    // Hurled, a spell is still a spell, not a throw.
    assert.match((await offline("*I hurl a fire bolt at the silent crake*", hidden)).refusal ?? "", /^There's no clear line to the silent Crake from here\.$/);
    assert.match((await offline("cast fire bolt at the silent crake", hidden)).refusal ?? "", /^There's no clear line to the silent Crake from here\.$/);
    assert.match((await readLine("I summon a dragon", f, stub({ deed: "not_possible" }))).refusal ?? "", /isn't something this fight can do/);
  });

  it("makes an urge to give it up the Influence action, as the fight has them take it, unless it's ears that never would or the action's spoken for", async () => {
    const f = await heron("fighter", BESIDE);
    // The fight's own mood (the rules' moodOf), with the decider's read of who they are only making it harder.
    const urged = await readLine("Drop the cudgel, Crake. Nobody's paying you enough for this.", f, stub({ deed: "speak_only", said_to: "crake-1", urge: "yield", urged: "crake-1", urge_how: "persuasion" }));
    assert.deepEqual(urged.steps, ["urge_persuasion_yield_crake-1"]);
    assert.deepEqual(urged.speech, { words: "Drop the cudgel, Crake. Nobody's paying you enough for this.", to: "crake-1" });
    const harder = await readLine("Drop it, Crake.", f, stub({ deed: "speak_only", said_to: "crake-1", urge: "yield", urged: "crake-1", urge_how: "intimidation", urge_mood: "hostile" }));
    assert.deepEqual(harder.steps, ["urge_intimidation_yield_hostile_crake-1"]);
    // Sallow with his Crakes on their feet never would, however the line reads: words, and nothing spent.
    const never = await readLine("Master Sallow! Lay down the cane in the King's name.", f, stub({ deed: "speak_only", said_to: "sallow", urge: "yield", urged: "sallow", urge_how: "persuasion" }));
    assert.deepEqual(never.steps, []);
    assert.match(never.note ?? "", /Master Sallow won't hear of it while his people are still standing: that's just words/);
    assert.match((await offline("persuade sallow to give up", f)).refusal ?? "", /Master Sallow won't hear of it while his people are still standing/);
    // An unclear read of the mood is the fight's.
    const unsure = await readLine("Drop it, Crake.", f, stub({ deed: "speak_only", said_to: "crake-1", urge: "yield", urged: "crake-1", urge_how: "intimidation", urge_mood: "unwilling" }, ["urge_mood"]));
    assert.deepEqual(unsure.steps, ["urge_intimidation_yield_crake-1"]);
    const both = await readLine("Give up! *shoves him*", f, stub({ deed: "shove:crake-1", said_to: "crake-1", urge: "yield", urged: "crake-1", urge_how: "intimidation" }));
    assert.deepEqual(both.steps, ["shove_crake-1"]);
    assert.match(both.note ?? "", /would take your action too/);
  });

  it("holds an act to the line's own words: the weapon named, a throw not yet, a heal as sure as its kind", async () => {
    const rogue = await heron("rogue", BESIDE);
    assert.match((await readLine("I throw a dagger at Sallow", rogue, stub({ deed: "attack:sallow:shortbow" }))).refusal ?? "", /Throwing isn't part of a fight on the map yet .*: your Shortbow reaches Master Sallow from where you stand/);
    const fighter = await heron("fighter", BESIDE);
    assert.deepEqual((await readLine("I shoot the crake with my bow", fighter, stub({ deed: "attack:crake-1:longsword" }))).steps, ["attack_crake-1_with_longbow"]);
    assert.match((await readLine("I stab him with my dagger", fighter, stub({ deed: "attack:crake-1:longsword" }))).refusal ?? "", /You haven't got a dagger: you've longsword and longbow/);
    const wizard = await heron("wizard", BESIDE, 5);
    assert.deepEqual((await readLine("I crack him over the head with my staff", wizard, stub({ deed: "improvised:crake-1" }))).steps, ["attack_crake-1_with_quarterstaff"]);
    // Cure Wounds or Healing Word: unsure which, but sure it's a heal.
    const cleric = await heron("cleric", { kell: { x: 22, y: 5 } });
    const healed = await readLine("I lay hands on Kell and heal her", cleric, stub({ deed: "cast:cure-wounds:kell" }, [], { deed: { "cast:cure-wounds:kell": 0.35, "cast:healing-word:kell": 0.3, "not_possible": 0.35 } }));
    assert.deepEqual(healed.steps, ["cast_cure-wounds_kell"]);
    assert.match((await readLine("I take a second wind", fighter, stub({ deed: "not_yet" }))).refusal ?? "", /isn't part of a fight on the map yet/);
  });

  it("asks which skill and how hard for a look or a think, and rolls it as the Search or Study action", async () => {
    const f = await heron("fighter", BESIDE);
    const r = await readLine("I look for another way out", f, stub({ deed: "check:search", skill: "perception", difficulty: "moderate" }));
    assert.deepEqual(r.steps, ["check_perception_13"]);
  });
});

describe("a typed line, done through the fight", () => {
  it("is the same act as its click or key: the same dice, in the same order", async () => {
    const typed = await heron("fighter", BESIDE);
    const clicked = await heron("fighter", BESIDE);
    await typed.say("attack the talking crake", {}, { decider: null, voice: null });
    await clicked.act("attack_crake-1");
    const rules = (f: TacticalFight) => f.controller.state().log.map(l => l.text);
    assert.deepEqual(rules(typed), rules(clicked));
    // The typed line itself is table talk: in the fight's log as shown, not in the rules' state.
    assert.ok(typed.controller.view().log.some(l => l.kind === "said" && l.text === "attack the talking crake"));
    assert.ok(!typed.controller.state().log.some(l => l.kind === "said"));
  });

  it("speaks: plain words cost nothing, and whoever was spoken to answers, after the rules", async () => {
    const f = await heron("fighter", BESIDE);
    const heard: string[] = [];
    const voice: Voice = async ({ reading, rules, onSpeaker, onText }) => {
      heard.push(`${reading.speech?.to}|${rules.map(l => l.kind).join(",")}`);
      onSpeaker("crake-1");
      onText("“Two shillings”");
      return { who: "crake-1", text: "The talking Crake: “Two shillings, and you're not worth either of them.”" };
    };
    const before = spent(f);
    const said = await f.say("Nice weather for it, Crake.", {}, { decider: stub({ deed: "speak_only", said_to: "crake-1" }), voice });
    assert.deepEqual(heard, ["crake-1|said"]);
    assert.match(said, /^› Nice weather for it, Crake\.\nThe talking Crake: “Two shillings/);
    assert.equal(spent(f).action, before.action, "talking costs no action");
    assert.equal(f.controller.playerTurn(), true, "and the turn goes on");
    // A deed's line: the rules' lines first, then the GM's.
    const voiced: Voice = async () => ({ who: "gm", text: "Your blade finds the gap in his guard." });
    const after = await f.say("attack the talking crake", {}, { decider: null, voice: voiced });
    const lines = after.split("\n");
    assert.equal(lines[0], "› attack the talking crake");
    assert.ok(lines[1]!.startsWith("🎲 Longsword: your attack on the talking Crake"));
    assert.ok(lines.indexOf("Your blade finds the gap in his guard.") > 1);
  });

  it("lets the GM's line be waved on: what was said so far stands, and the fight goes on", async () => {
    const f = await heron("fighter", BESIDE);
    const skip = new AbortController();
    // A voice that says half a line and then would go on and on, until it's cut short.
    const slow: Voice = ({ signal, onSpeaker, onText }) => new Promise((_resolve, reject) => {
      onSpeaker("gm");
      onText("Your blade finds the gap in his guard, and");
      skip.abort();
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    const said = await f.say("attack the talking crake", { skip: skip.signal }, { decider: null, voice: slow });
    assert.match(said, /Your blade finds the gap in his guard, and…/);
    assert.ok(f.controller.view().log.some(l => l.kind === "narration" && l.who === "gm" && l.text.endsWith("and…")));
  });

  it("refuses with the rules' reason when the deed can't happen, and spends nothing", async () => {
    const f = await heron("cleric");
    const before = spent(f);
    const r: Reading = await readLine("attack sallow", f, null);
    assert.ok(r.refusal);
    const said = await f.say("attack sallow", {}, { decider: null, voice: null });
    assert.match(said, /^\(.*out of reach/);
    assert.deepEqual(spent(f), before);
  });
});

describe("fists and a barbarian's Reckless Attack (barbarian#45)", () => {
  const BARBARIAN = { classId: "barbarian", subclassId: "path-of-the-berserker", speciesId: "orc", backgroundId: "soldier", abilities: ["STR", "CON", "DEX", "WIS", "CHA", "INT"], skills: ["athletics", "intimidation"], feat: "savage-attacker", cantrips: [], spells: [], weapons: ["greataxe", "handaxe"], armor: "none", shield: false } as unknown as import("../../rules/dnd.ts").Build;
  /** As `heron`, for an orc barbarian. */
  async function barbarian(at: Record<string, Tile2> = {}): Promise<TacticalFight> {
    for (let seed = 1; seed < 40; seed++) {
      const session = await pregenSession({ build: BARBARIAN, seed: 3, level: 3 });
      session.established.push("Master Sallow has come to the Heron.");
      const setup = heronEncounter(heronMap(), session, { sallow: true, seed });
      const combat = await startCombat({ ...setup, combatants: setup.combatants.map((c: CombatantSetup) => (at[c.id] ? { ...c, at: at[c.id]! } : c)) }, session);
      if (combat.state().order[0] !== combat.state().pc) continue;
      const fight = new TacticalFight(combat, []);
      fight.begin();
      return fight;
    }
    throw new Error("no seed where the player goes first");
  }

  it("offers a punch for whoever's beside you, and Reckless Attack before the first blow", async () => {
    const f = await barbarian(BESIDE);
    const o = f.controller.options();
    assert.deepEqual(o.unarmed.map(u => u.target), ["crake-1"]);
    assert.equal(o.reckless, true);
    const ids = f.actions().map(a => a.id);
    assert.ok(ids.includes("attack_crake-1_with_unarmed") && ids.includes("reckless"), ids.join(", "));
    // Not a fighter's.
    const fighter = await heron("fighter", BESIDE);
    assert.equal(fighter.controller.options().reckless, false);
    assert.match((await offline("reckless attack the talking crake", fighter)).refusal ?? "", /Reckless Attack is a barbarian's/);
  });

  it("reads a punch, an unarmed strike and a reckless attack in plain words", async () => {
    const f = await barbarian(BESIDE);
    assert.deepEqual((await offline("punch the talking crake", f)).steps, ["attack_crake-1_with_unarmed"]);
    assert.deepEqual((await offline("reckless attack the talking crake", f)).steps, ["reckless", "attack_crake-1"]);
    assert.deepEqual((await offline("attack the talking crake recklessly", f)).steps, ["reckless", "attack_crake-1"]);
    const far = await barbarian({ "crake-1": { x: 19, y: 6 } });
    assert.deepEqual((await offline("move to the talking crake, then unarmed strike the talking crake", far)).steps, ["close_crake-1", "attack_crake-1_with_unarmed"]);
  });

  it("a punch the decider took for a swing of the axe is the punch the player said", async () => {
    const f = await barbarian(BESIDE);
    const r = await readLine("*I barge past and punch the talking crake square in the face*", f, stub({ deed: "attack:crake-1:greataxe" }));
    assert.deepEqual(r.steps, ["attack_crake-1_with_unarmed"]);
  });

  it("does it: Reckless Attack declared, the blow at advantage, and an Unarmed Strike called that", async () => {
    const f = await barbarian(BESIDE);
    await f.say("reckless attack the talking crake", {}, { decider: null, voice: null });
    const log = f.controller.view().log.map(l => l.text);
    assert.ok(log.some(l => /^Reckless Attack: your blows have advantage this turn/.test(l)), log.join("\n"));
    assert.ok(log.some(l => /^Greataxe: your attack on the talking Crake: \d+\/\d+ \(advantage\)/.test(l)), log.join("\n"));
    const g = await barbarian(BESIDE);
    await g.say("punch the talking crake", {}, { decider: null, voice: null });
    assert.ok(g.controller.view().log.some(l => /^Unarmed Strike: your attack on the talking Crake/.test(l.text)), g.controller.view().log.map(l => l.text).join("\n"));
  });
});
