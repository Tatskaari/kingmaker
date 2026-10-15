import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChoiceQuestion, Decider, Decision } from "../../llm/decide.ts";
import type { CombatantSetup, Tile2 } from "../types.ts";
import { startCombat } from "./controller.ts";
import { TacticalFight } from "./fights.ts";
import { heronMap } from "./heron-grid.ts";
import { heronEncounter } from "./heron.ts";
import { pregenSession } from "./pregen.ts";
import { parseCommand, readLine, type Reading } from "./typed.ts";
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
 * keeps what it was asked. Probabilities are 1 unless `unsure`.
 */
function stub(answers: Record<string, string>, unsure: string[] = []): Decider & { asked: Array<Record<string, ChoiceQuestion>> } {
  const asked: Array<Record<string, ChoiceQuestion>> = [];
  return {
    name: "stub", asked,
    async decide(_state: unknown, questions: Record<string, ChoiceQuestion>): Promise<Decision> {
      asked.push(questions);
      const quiet = ["no", "none", "nobody", "lowest", "not_possible"];
      const out: Decision["answers"] = {};
      for (const [id, q] of Object.entries(questions)) {
        const keys = Object.keys(q.criteria);
        const choice = answers[id] !== undefined && keys.includes(answers[id]!) ? answers[id]! : quiet.find(k => keys.includes(k)) ?? keys[0]!;
        out[id] = { choice, probabilities: { [choice]: unsure.includes(id) ? 0.3 : 1 } };
      }
      return { answers: out, latencyMs: 0, costUsd: 0, decider: "stub" };
    },
  };
}

const offline = (line: string, fight: TacticalFight) => readLine(line, fight, null);
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
    assert.deepEqual((await offline("intimidate the crake into giving up", f)).steps, ["urge_intimidation_yield_hostile_crake-1"]);
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
  });

  it("say the GM is offline for a line that isn't a plain command", async () => {
    const f = await heron("fighter", BESIDE);
    const r = await offline("Give it up, Crake, nobody's paying you for this!", f);
    assert.equal(r.offline, true);
    assert.match(r.refusal ?? "", /The GM is offline.*attack sallow, cast fire bolt at the nearest crake, move to the brazier/);
    assert.equal(parseCommand("I gaze thoughtfully at the brazier", turnFor(f)), undefined);
  });
});

/** The parser's own view of the turn (as readLine builds it). */
function turnFor(f: TacticalFight): Parameters<typeof parseCommand>[1] {
  const c = f.controller, s = c.look();
  return { s, me: s.pc(), o: c.options(), actions: f.actions(), others: s.units.filter(u => u.id !== "player" && u.state !== "fled"), props: Object.values(c.state().props).filter(p => !p.carriedBy) };
}

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

  it("puts a deed's steps together: a move first, the act, a bonus action, a move after", async () => {
    const f = await heron("fighter", BESIDE);
    const r = await readLine("I hit him and back off", f, stub({ deed: "attack:crake-1:longsword", move_after: "away" }));
    assert.deepEqual(r.steps, ["attack_crake-1_with_longsword", "back_off"]);
    const far = await heron("fighter", { "crake-1": { x: 19, y: 6 } });
    const closed = await readLine("I charge the talking crake and cut him down", far, stub({ deed: "attack:crake-1:close" }));
    assert.deepEqual(closed.steps, ["close_crake-1", "attack_crake-1_with_longsword"]);
    const brazier = await readLine("I run to the brazier", far, stub({ deed: "move_only", move_first: "close:brazier" }));
    assert.deepEqual(brazier.steps, ["close_brazier"]);
  });

  it("refuses magic they haven't got, a spell that can't be cast now, and what it isn't sure of", async () => {
    const f = await heron("fighter", BESIDE);
    assert.match((await readLine("I conjure a great ball of fire at them", f, stub({ deed: "not_theirs" }))).refusal ?? "", /isn't magic you have/);
    // A spell named plainly is the rules' to refuse, with no model: the same answer, by its name.
    assert.match((await readLine("I cast a fireball", f, stub({ deed: "not_theirs" }))).refusal ?? "", /Fireball isn't one of your spells/);
    const wizard = await heron("wizard", BESIDE, 5);
    assert.match((await readLine("I put up a shield", wizard, stub({ deed: "cannot:cast:shield" }))).refusal ?? "", /Shield isn't a spell a fight on the map can play out/);
    assert.match((await readLine("I do the thing", f, stub({ deed: "attack:crake-1:longsword" }, ["deed"]))).refusal ?? "", /Not sure what you mean/);
    assert.match((await readLine("I summon a dragon", f, stub({ deed: "not_possible" }))).refusal ?? "", /isn't something this fight can do/);
  });

  it("makes an urge to give it up the Influence action, unless it's unwilling ears or the action's spoken for", async () => {
    const f = await heron("fighter", BESIDE);
    const urged = await readLine("Drop the cudgel, Crake. Nobody's paying you enough for this.", f, stub({ deed: "speak_only", said_to: "crake-1", urge: "yield", urged: "crake-1", urge_how: "persuasion", urge_mood: "wavering" }));
    assert.deepEqual(urged.steps, ["urge_persuasion_yield_wavering_crake-1"]);
    assert.deepEqual(urged.speech, { words: "Drop the cudgel, Crake. Nobody's paying you enough for this.", to: "crake-1" });
    const never = await readLine("Sallow! Surrender!", f, stub({ deed: "speak_only", said_to: "sallow", urge: "yield", urged: "sallow", urge_how: "intimidation", urge_mood: "unwilling" }));
    assert.deepEqual(never.steps, []);
    assert.match(never.note ?? "", /won't hear of it: that's just words/);
    const both = await readLine("Give up! *shoves him*", f, stub({ deed: "shove:crake-1", said_to: "crake-1", urge: "yield", urged: "crake-1", urge_how: "intimidation", urge_mood: "hostile" }));
    assert.deepEqual(both.steps, ["shove_crake-1"]);
    assert.match(both.note ?? "", /would take your action too/);
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
