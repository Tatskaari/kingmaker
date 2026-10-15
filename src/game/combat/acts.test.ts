import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dnd } from "../../rules/dnd.ts";
import type { CombatantSetup, CombatSetup, Tile2 } from "../types.ts";
import { decide, freshMemo } from "./ai.ts";
import { resumeCombat, startCombat, type CombatController } from "./controller.ts";
import { arenaMap } from "./fights.ts";
import { steps } from "./grid.ts";
import { heronMap } from "./heron-grid.ts";
import { heronEncounter } from "./heron.ts";
import type { Rules } from "./rules.ts";
import { pregenSession } from "./pregen.ts";
import { Skirmish } from "./skirmish.ts";

/**
 * The fight's acts beyond a blow and a spell, as a typed line can ask for them: a grab and a
 * shove (the engine's Grapple and Shove), getting up off the floor, a word with weight (the
 * Influence action) and what it does to the AI, a look (Search), something to hand as a weapon,
 * a spell from a higher slot, and a fight that ends with its last one yielding.
 *
 *   node --no-warnings --test src/game/combat/acts.test.ts
 */

/** The player first, at the Heron, with people where the test wants them (the player at 22,6). */
async function heron(pregen: string, at: Record<string, Tile2>, options: { level?: number; from?: number; drop?: string[] } = {}): Promise<{ combat: CombatController; seed: number }> {
  for (let seed = options.from ?? 1; seed < (options.from ?? 1) + 60; seed++) {
    const session = await pregenSession({ pregen, seed: 3, level: options.level ?? 3 });
    session.beat = "midnight";
    session.established.push("Master Sallow has come to the Heron.");
    const setup = heronEncounter(heronMap(), session, { sallow: true, seed });
    const combatants = setup.combatants.filter(c => !(options.drop ?? []).includes(c.id)).map((c: CombatantSetup) => (at[c.id] ? { ...c, at: at[c.id]! } : c));
    const combat = await startCombat({ ...setup, combatants }, session);
    if (combat.state().order[0] === "player") return { combat, seed };
  }
  throw new Error("no seed where the player goes first");
}

/** A plain room with the player and whoever's against them (a wolf, a porter), the player first. */
async function room(pregen: string, foes: Array<Pick<CombatantSetup, "id" | "name" | "statblock" | "role"> & { at: Tile2 }>, from = 1): Promise<CombatController> {
  for (let seed = from; seed < from + 60; seed++) {
    const session = await pregenSession({ pregen, seed: 5, level: 3, sceneId: "crossroads-ambush" });
    const setup: CombatSetup = { map: arenaMap("A room"), seed, place: "the room", combatants: [{ id: "player", name: session.player.name, side: "player", role: "player", at: { x: 10, y: 4 } }, ...foes.map(f => ({ ...f, side: "enemy" as const }))] };
    const combat = await startCombat(setup, session);
    if (combat.state().order[0] === "player") return combat;
  }
  throw new Error("no seed where the player goes first");
}

const BESIDE = { "crake-1": { x: 23, y: 6 } };
const usage = (c: CombatController) => c.look().usage(c.look().pc());

/** Try something on a fresh fight from each seed until the dice let it happen. */
async function until<T>(make: (from: number) => Promise<T>, happened: (t: T) => boolean): Promise<T> {
  for (let from = 1; from < 200; from += 7) { const t = await make(from); if (happened(t)) return t; }
  throw new Error("the dice never allowed it");
}

describe("a grab and a shove", () => {
  it("take the action and a save; held fast, they can't move until let go", async () => {
    const { combat } = await until(from => heron("fighter", BESIDE, { from }), ({ combat }) => {
      const done = combat.act({ kind: "wrestle", target: "crake-1", how: "grapple" });
      return done.ok && combat.state().units["crake-1"]!.conditions.includes("grappled");
    });
    const G = combat.state();
    assert.ok(G.log.some(l => /^Grapple: you try to grab hold of the talking Crake/.test(l.text)));
    assert.ok(G.log.some(l => /Strength save: .* failed$/.test(l.text)));
    assert.equal(usage(combat)?.actionUsed, true, "the action's gone");
    assert.equal(G.flags["grappler:crake-1"], "player");
    // On the Crake's turn: no movement.
    const s = new Skirmish(structuredClone(G), (combat as unknown as { rules: Rules }).rules);
    s.G.active = s.G.order.indexOf("crake-1");
    assert.equal(s.movementLeft(s.unit("crake-1")!), 0, "held fast");
    // Step away, and the grip goes.
    const away = combat.act({ kind: "move", to: { x: 24, y: 9 } });
    assert.ok(away.ok, away.error ?? "");
    assert.ok(!combat.state().units["crake-1"]!.conditions.includes("grappled"), "let go");
    assert.ok(combat.state().log.some(l => /free of the grip/.test(l.text)));
  });

  it("knocked over, they get up as their turn starts, for half their movement", async () => {
    const { combat } = await until(from => heron("fighter", BESIDE, { from }), ({ combat }) => {
      const done = combat.act({ kind: "wrestle", target: "crake-1", how: "prone" });
      return done.ok && combat.state().units["crake-1"]!.conditions.includes("prone");
    });
    assert.ok(combat.state().log.some(l => /the talking Crake is prone/i.test(l.text)));
    combat.act({ kind: "end" });
    combat.advance(undefined, 10);
    const G = combat.state();
    assert.ok(!G.units["crake-1"]!.conditions.includes("prone") || G.units["crake-1"]!.state !== "fighting", "up again");
    assert.ok(G.log.some(l => /The talking Crake gets up off the floor/.test(l.text)));
  });

  it("shoved away, they're pushed back 5 ft", async () => {
    const { combat } = await until(from => heron("fighter", BESIDE, { from }), ({ combat }) => {
      const done = combat.act({ kind: "wrestle", target: "crake-1", how: "push" });
      return done.ok && combat.state().log.some(l => /pushed back/.test(l.text));
    });
    assert.equal(steps(combat.state().units["crake-1"]!.at, combat.state().units["player"]!.at), 2);
  });

  it("need them beside you, and the action free", async () => {
    const { combat } = await heron("fighter", {});
    assert.match(combat.act({ kind: "wrestle", target: "sallow", how: "grapple" }).error ?? "", /out of reach/);
    const kell = combat.act({ kind: "wrestle", target: "kell", how: "prone" });
    assert.equal(kell.ok, true, "a shove at a friend is still a shove (the menu doesn't offer it)");
  });
});

describe("a word with weight (the Influence action)", () => {
  it("willing ears need no roll: the action, and they give up", async () => {
    const { combat } = await heron("fighter", BESIDE);
    const done = combat.act({ kind: "influence", target: "crake-1", skill: "persuasion", urge: "yield", mood: "willing" });
    assert.ok(done.ok, done.error ?? "");
    assert.equal(combat.state().units["crake-1"]!.state, "surrendered");
    assert.equal(usage(combat)?.actionUsed, true);
    assert.ok(combat.state().log.some(l => /No roll needed: the talking Crake was ready to give up/.test(l.text)));
  });

  it("a hostile foe is a Charisma check at disadvantage against 15 or their Intelligence, once per way", async () => {
    const { combat } = await until(from => heron("fighter", BESIDE, { from }), ({ combat }) => {
      combat.act({ kind: "influence", target: "crake-1", skill: "intimidation", urge: "yield", mood: "hostile" });
      return combat.state().log.some(l => /^Intimidation \(Influence\).*: failure$/.test(l.text));
    });
    const line = combat.state().log.find(l => /^Intimidation \(Influence\)/.test(l.text))!.text;
    assert.match(line, /you urge the talking Crake to give up: \d+\/\d+ \(disadvantage\) [+-]\d+ = \d+ vs DC 15: failure/);
    assert.equal(combat.state().units["crake-1"]!.state, "fighting");
    // The same way twice doesn't work (it's the next turn's action, and it's still refused).
    const again = new Skirmish(structuredClone(combat.state()), (combat as unknown as { rules: Rules }).rules);
    assert.match(again.influence(again.pc(), "crake-1", "intimidation", "yield", "hostile") ?? "", /won't work twice/);
  });

  it("a wolf understands a threat and nothing else", async () => {
    const combat = await room("fighter", [{ id: "wolf", name: "a grey wolf", statblock: "wolf", role: "bruiser", at: { x: 11, y: 4 } }]);
    assert.match(combat.act({ kind: "influence", target: "wolf", skill: "persuasion", urge: "go", mood: "wavering" }).error ?? "", /doesn't understand a word of it/);
    assert.equal(combat.options().hear.find(h => h.id === "wolf")?.understands, false);
    assert.equal(usage(combat)?.actionUsed, false, "nothing spent");
  });

  it("talked into leaving, they make for the way out on their turn (or give up, cornered); talked into holding back, their turn goes by", async () => {
    const { combat } = await heron("fighter", BESIDE);
    combat.act({ kind: "influence", target: "crake-1", skill: "persuasion", urge: "go", mood: "willing" });
    assert.match(combat.state().log.at(-1)!.text, /will leave the fight/);
    const rules = (combat as unknown as { rules: Rules }).rules;
    const G = structuredClone(combat.state());
    G.active = G.order.indexOf("crake-1");
    const s = new Skirmish(G, rules);
    const step = decide(s, s.unit("crake-1")!, freshMemo());
    assert.ok(["move", "dash", "leave", "surrender"].includes(step.kind), `running for it: ${step.kind}`);
    // Holding back: the turn goes by.
    const held = await heron("fighter", BESIDE);
    held.combat.act({ kind: "influence", target: "crake-1", skill: "intimidation", urge: "hold", mood: "willing" });
    held.combat.act({ kind: "end" });
    held.combat.advance(undefined, 10);
    assert.ok(held.combat.state().log.some(l => /The talking Crake hangs back, in two minds/.test(l.text)));
    const turn = held.combat.state().log.findIndex(l => l.kind === "turn" && /talking Crake's turn/.test(l.text));
    const after = held.combat.state().log.slice(turn + 1);
    const next = after.findIndex(l => l.kind === "turn");
    assert.ok(!after.slice(0, next < 0 ? undefined : next).some(l => /talking Crake's attack/.test(l.text)), "no swing that turn");
  });

  it("a fight that ends with the last of them yielding is a surrender (nobody in charge)", async () => {
    const combat = await room("fighter", [{ id: "porter", name: "a big porter", statblock: "bandit", role: "brawler", at: { x: 11, y: 4 } }]);
    combat.act({ kind: "influence", target: "porter", skill: "intimidation", urge: "yield", mood: "willing" });
    assert.ok(combat.over());
    assert.equal(combat.result().outcome, "surrender");
    assert.match(combat.result().summary, /gave up/);
    assert.ok(combat.state().log.some(l => /the last of them/.test(l.text)));
  });
});

describe("a look, something to hand, a higher slot", () => {
  it("a look is the Search action: a Wisdom check through the engine, and the action", async () => {
    const { combat } = await heron("fighter", {});
    const done = combat.act({ kind: "check", skill: "perception", dc: 13 });
    assert.ok(done.ok, done.error ?? "");
    assert.match(combat.state().log.at(-1)!.text, /^Perception check \(Search\): \d+ [+-]\d+ = \d+ vs DC 13: (success|failure)$/);
    assert.equal(usage(combat)?.actionUsed, true);
    assert.match(combat.act({ kind: "check", skill: "arcana", dc: 10 }).error ?? "", /already used your action/);
  });

  it("an improvised weapon is the rules' unarmed strike, called what it is", async () => {
    const { combat } = await heron("fighter", BESIDE);
    const done = combat.act({ kind: "attack", target: "crake-1", weapon: "improvised" });
    assert.ok(done.ok, done.error ?? "");
    assert.ok(combat.state().log.some(l => /^Improvised weapon: your attack on the talking Crake/.test(l.text)));
  });

  it("a spell from a higher slot spends that slot, and says so", async () => {
    const { combat } = await heron("wizard", {}, { level: 5 });
    const s = () => combat.look();
    const before = s().freeSlots(s().pc(), 2);
    const done = combat.act({ kind: "cast", spell: "magic-missile", target: "sallow", slot: 2 });
    assert.ok(done.ok, done.error ?? "");
    assert.ok(combat.state().log.some(l => /^You cast Magic Missile \(2nd-level slot\) at Master Sallow/.test(l.text)));
    assert.equal(s().freeSlots(s().pc(), 2), before - 1);
    const low = await heron("wizard", {}, { level: 3 });
    assert.match(low.combat.act({ kind: "cast", spell: "magic-missile", target: "sallow", slot: 3 }).error ?? "", /no 3rd-level slot left/);
  });
});

describe("table talk", () => {
  it("goes in the fight's log as shown, after what the rules had said, and is saved with it", async () => {
    const { combat } = await heron("fighter", BESIDE);
    const at = combat.state().log.length;
    combat.act({ kind: "dodge" });
    combat.note({ kind: "said", who: "player", text: "Come on, then." }, at);
    combat.note({ kind: "narration", who: "gm", text: "The Crake considers it." });
    const log = combat.view().log;
    const said = log.findIndex(l => l.text === "Come on, then.");
    assert.equal(log[said + 1]!.text.startsWith("Dodge") || /weave/.test(log[said + 1]!.text), true, "the words, then the rules' lines");
    assert.equal(log.at(-1)!.text, "The Crake considers it.");
    assert.ok(!combat.state().log.some(l => l.kind === "said"), "never in the rules' own state");
    const resumed = resumeCombat(JSON.parse(JSON.stringify(combat.save())), combat.session, await dnd());
    assert.deepEqual(resumed.view().log.map(l => l.text), log.map(l => l.text));
  });
});
