import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./shim.ts";
import * as E from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import type { Engine } from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import { rng, rollCheck } from "../dice.ts";
import type { BuildsFile } from "../scene/files.ts";
import { carryGear, comeTo, createCharacter, pocketsOf, rollFor, sheetData, sheetRows } from "./character.ts";
import { event, idTime, isoTime, loaded, opened, rulesFrom } from "./engine.ts";
import { withEngine } from "./pin.ts";
import type { RulesSession } from "./types.ts";

/**
 * The player's character through the engine, as the simulation runs it (character.ts): made from a
 * ready-made build, the sheet row, a check, coming to and the gear the story parts them from, each
 * pinned as the simulation pins it. The prototype's own sheets and dice are golden.test.ts's.
 */

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as unknown;
const rules = rulesFrom(E, read("../../vendor/dnd-srd-engine/starter-pack.json"), read("../../vendor/srd-spells/spells.json") as Parameters<typeof rulesFrom>[2]);
const BUILDS = read("../../campaigns/caerwyn/builds.json") as BuildsFile;
const T = Date.UTC(2026, 9, 16, 9, 30);
const PURSE = [{ name: "silver crowns", quantity: 2 }, { name: "shillings", quantity: 6 }, { name: "pennies", quantity: 12 }];

/** A game's session before anything has happened: the simulation's makeCharacter gives createCharacter one of these. */
const fresh = (seed = 7): RulesSession => ({ id: "01JGAME0000000000000000000", seed, rollCount: 0, turn: 0, player: { name: "Tamsin Vell", concept: "a palace inspector", modifiers: {} } });
/** The ready-made build made, pinned as the simulation pins it. */
const made = (id: string, seed = 7, pin = 1): RulesSession => {
  const session = fresh(seed);
  withEngine({ seed: pin, nowMs: T }, () => createCharacter(rules, session, 3, BUILDS[id]!.build));
  return session;
};

test("createCharacter makes the build at level 3, without a roll: the rules state, the modifiers and the build line on the session", () => {
  const session = fresh();
  const line = withEngine({ seed: 1, nowMs: T }, () => createCharacter(rules, session, 3, BUILDS.rogue!.build));
  assert.equal(line, "Tamsin Vell: halfling rogue 3 (Thief), criminal background. AC 14, HP 24/24.");
  assert.equal(session.rollCount, 0, "hit points are the average: no die drawn");
  assert.equal(session.player.build, "halfling rogue 3 (Thief), criminal background");
  assert.equal(Object.keys(session.player.modifiers).length, 18);
  assert.ok(session.rules!.campaign.length > 5000 && session.rules!.pc && session.rules!.status === "HP 24/24");
  assert.deepEqual(session.rules!.gear!.map(g => [g.name, g.kind, g.slot]), [["Rapier", "weapon", "mainHand"], ["Shortbow", "weapon", undefined], ["Dagger", "weapon", undefined], ["Leather Armor", "armor", "armor"]]);
});

test("the same pin makes the same campaign, its ids and times the pin's; another pin other ids", () => {
  const [a, b, c] = [made("wizard"), made("wizard"), made("wizard", 7, 2)];
  assert.equal(a.rules!.campaign, b.rules!.campaign);
  assert.notEqual(a.rules!.campaign, c.rules!.campaign);
  const events = (JSON.parse(a.rules!.campaign) as { events: Array<{ id: string; at: string }> }).events;
  assert.ok(events.length > 15);
  assert.ok(events.every(e => e.at === "2026-10-16T09:30:00.000Z" && idTime(e.id) === T), "every event, the engine's and the rules code's, at the pinned time");
});

test("sheetRows: the row's columns from the engine, the data without the pockets, which pocketsOf gives", () => {
  const session = made("wizard");
  const rows = sheetRows(rules, session);
  assert.deepEqual([rows.build, rows.statusLine, rows.level, rows.hp, rows.maxHp, rows.ac], ["human wizard 3 (Evoker), sage background", "HP 20/20, spell slots 1st 4/4, 2nd 2/2", 3, 20, 20, 12]);
  assert.deepEqual(rows.slots, [{ level: 1, max: 4, used: 0 }, { level: 2, max: 2, used: 0 }]);
  assert.deepEqual(rows.conditions, []);
  assert.deepEqual(JSON.parse(rows.skills), session.player.modifiers);
  assert.deepEqual(rows.spells.map(s => s.name), ["Fire Bolt", "Light", "Ray of Frost", "Burning Hands", "Magic Missile", "Shield", "Sleep", "Thunderwave", "Scorching Ray"]);
  assert.deepEqual(rows.weapons.map(w => w.name), ["Quarterstaff", "Dagger", "Unarmed Strike"], "the prototype's weaponsOf: unarmed is a weapon too");
  assert.deepEqual(rows.features, []);
  assert.equal(rows.backstory, undefined);
  const data = JSON.parse(rows.data) as Record<string, unknown>;
  assert.ok(!("purse" in data) && !("carrying" in data), "the pockets are kept apart");
  assert.deepEqual({ ...data, ...pocketsOf(session, PURSE) }, { ...sheetData(rules, session), purse: PURSE, carrying: [] });
  assert.deepEqual(sheetRows(rules, made("fighter")).features, [{ id: "second-wind", name: "Second Wind", target: "self" }]);
});

test("a backstory with words goes on the row; an empty one doesn't", () => {
  const session = made("rogue");
  const story = { text: "I owe Fat Jory three crowns.", summary: "Owes Fat Jory.", personality: ["wary"], ideals: [], bonds: ["Fat Jory"], flaws: [] };
  session.player.backstory = story;
  assert.deepEqual(JSON.parse(sheetRows(rules, session).backstory!), story);
  session.player.backstory = { ...story, text: "  " };
  assert.equal(sheetRows(rules, session).backstory, undefined);
});

test("rollFor rolls through the engine on the cached campaign, as a fresh engine on a fresh load would, and commits the roll", () => {
  const session = made("rogue", 11);
  const before = session.rules!.campaign;
  const roll = withEngine({ seed: 2, nowMs: T }, () => rollFor(rules, session, "investigation", 12));
  assert.equal(session.rollCount, 1);
  assert.notEqual(session.rules!.campaign, before, "the check is on the log");
  // The same check, on an engine made for it and the campaign loaded afresh: the prototype's way.
  const engine = E.createEngine({ contentPacks: [rules.pack], rng: E.seededRNG(11 + 7919 * 1) });
  const [rolled] = engine.plan.abilityCheck(E.loadCampaign(before, engine).state, { type: "AbilityCheck", characterId: session.rules!.pc, ability: "INT", skill: "investigation", dc: 12 }).events;
  assert.equal(roll.total, Number(rolled!["total"]));
  assert.equal(roll.modifier, session.player.modifiers.investigation);
  // The second roll is the next draw.
  const again = withEngine({ seed: 3, nowMs: T }, () => rollFor(rules, session, "investigation", 12));
  assert.equal(session.rollCount, 2);
  assert.equal(again.die, rollFor(rules, { ...made("rogue", 11), rollCount: 1 }, "investigation", 12).die);
});

test("without a character, rollFor rolls the concept's modifiers from the dice, as the prototype's rollFor does", () => {
  const session: RulesSession = { ...fresh(5), player: { name: "Wren", concept: "", modifiers: { persuasion: 3 } } };
  assert.deepEqual(rollFor(rules, session, "persuasion", 12), rollCheck(rng(5 + 7919), "persuasion", 12, 3));
  assert.equal(session.rollCount, 1);
});

test("comeTo: someone up has no line, but the dice roll once; someone dropped comes to with 1 HP, prone and out cold over", () => {
  const up = made("fighter");
  assert.equal(withEngine({ seed: 4, nowMs: T }, () => comeTo(rules, up)), undefined);
  assert.equal(up.rollCount, 1);
  const down = made("fighter");
  // Knocked down: 30 damage, unconscious and prone, as a fight leaves them.
  const ctx = opened(rules, down);
  ctx.apply([event(E, "DamageApplied", { targetId: down.rules!.pc, components: [{ amount: 30, type: "bludgeoning" }] }),
    event(E, "ConditionApplied", { targetId: down.rules!.pc, conditionId: "unconscious", appliedConditionId: E.newEventId() }),
    event(E, "ConditionApplied", { targetId: down.rules!.pc, conditionId: "prone", appliedConditionId: E.newEventId() })]);
  down.rules!.campaign = E.serializeCampaign(ctx.campaign);
  assert.match(sheetRows(rules, down).statusLine, /^HP 0\/28, (unconscious, prone|prone, unconscious)$/);
  const line = withEngine({ seed: 5, nowMs: T }, () => comeTo(rules, down));
  assert.equal(line, "You come to: HP 1/28");
  assert.deepEqual(sheetRows(rules, down).conditions, []);
});

test("carryGear: the story parts them from their armour (off the sheet, AC down) and gives it back (worn again); nothing changed, no line and no roll", () => {
  const session = made("rogue");
  const armour = session.rules!.gear!.find(g => g.kind === "armor")!;
  assert.equal(carryGear(rules, session, armour.id, true), undefined);
  assert.equal(session.rollCount, 0, "nothing changed: the dice don't roll");
  assert.equal(withEngine({ seed: 6, nowMs: T }, () => carryGear(rules, session, armour.id, false)), "You no longer have your leather armor (AC now 13)");
  assert.deepEqual([session.rollCount, session.rules!.gone], [1, [armour.id]]);
  const rows = sheetRows(rules, session);
  assert.equal(rows.ac, 13);
  assert.ok(!(JSON.parse(rows.data) as { equipment: Array<{ name: string }> }).equipment.some(e => e.name === "Leather Armor"));
  assert.equal(withEngine({ seed: 7, nowMs: T }, () => carryGear(rules, session, armour.id, true)), "You have your leather armor again");
  assert.deepEqual([session.rollCount, session.rules!.gone, sheetRows(rules, session).ac], [2, [], 14]);
  // A weapon given away: off the row's weapons and the sheet's attacks.
  const dagger = session.rules!.gear!.find(g => g.name === "Dagger")!;
  assert.equal(withEngine({ seed: 8, nowMs: T }, () => carryGear(rules, session, dagger.id, false)), "You no longer have your dagger");
  assert.deepEqual(sheetRows(rules, session).weapons.map(w => w.name), ["Rapier", "Shortbow", "Unarmed Strike"]);
});

test("pocketsOf: what's on them in the world, coins in the purse; before the story begins, the campaign's purse", () => {
  const session = fresh();
  assert.deepEqual(pocketsOf(session, PURSE), { purse: PURSE, carrying: [] });
  assert.deepEqual(pocketsOf({ ...session, history: [{}] }, PURSE), { purse: [], carrying: [] }, "a story begun has no purse but the world's");
  const thing = (id: string, name: string, parent: string, more: object = {}) => ({ id, name, kind: "item" as const, parent, tags: [], states: [], notes: [], ...more });
  const world = { scene: "hanged-clerk", turn: 0, entities: {
    player: { ...thing("player", "Tamsin", "yard"), kind: "person" as const, player: true },
    satchel: thing("satchel", "a satchel", "player"),
    letter: thing("letter", "a letter", "satchel"),
    coins: thing("coins", "shillings", "player", { quantity: 4 }),
    dagger: thing("dagger", "Tamsin's dagger", "player", { gear: "01J" }),
    given: thing("given", "a key", "kell"),
    kell: { ...thing("kell", "Kell", "yard"), kind: "person" as const },
  }, log: [] } as unknown as NonNullable<RulesSession["world"]>;
  assert.deepEqual(pocketsOf({ ...session, world }, PURSE), {
    purse: [{ name: "shillings", quantity: 4 }],
    carrying: [{ name: "a satchel", quantity: 1 }, { name: "a letter", quantity: 1, in: "a satchel" }],
  });
});

test("loaded: a campaign is loaded once and kept by its string; another string, another load", () => {
  const session = made("cleric");
  const first = loaded(rules, session.rules!.campaign);
  assert.equal(loaded(rules, session.rules!.campaign), first);
  assert.notEqual(loaded(rules, made("cleric", 8, 2).rules!.campaign), first);
  assert.throws(() => loaded({ ...rules }, session.rules!.campaign), /not made by rulesFrom/);
});

test("what the isolate keeps is what loading its string gives: the campaign creation reloaded, and every check, coming to and gear change after", () => {
  // An isolate whose loads are counted: a campaign it kept needs none.
  let loads = 0;
  const counted = rulesFrom({ ...E, loadCampaign: (s: string, engine: Engine) => { loads++; return E.loadCampaign(s, engine); } }, rules.pack, rules.srd);
  const keptAsLoaded = (serialized: string) => {
    const before = loads;
    const kept = loaded(counted, serialized), fresh = E.loadCampaign(serialized, rules.engine(0));
    return loads === before && E.serializeCampaign(kept) === serialized && JSON.stringify(kept.events) === JSON.stringify(fresh.events) && JSON.stringify(kept.state) === JSON.stringify(fresh.state);
  };
  for (const id of ["cleric", "fighter", "ranger", "wizard", "rogue"]) {
    const session = fresh();
    withEngine({ seed: 1, nowMs: T }, () => createCharacter(counted, session, 3, BUILDS[id]!.build));
    // A class with resources is reloaded with them, and kept; the rogue has none, so its first load is a load.
    assert.equal(keptAsLoaded(session.rules!.campaign), id !== "rogue", `${id}: as made`);
    for (const [i, skill] of (["perception", "arcana", "athletics"] as const).entries()) {
      withEngine({ seed: 10 + i, nowMs: T }, () => rollFor(counted, session, skill, 13));
      assert.ok(keptAsLoaded(session.rules!.campaign), `${id}: after check ${i + 1}`);
    }
    withEngine({ seed: 20, nowMs: T }, () => comeTo(counted, session));
    assert.ok(keptAsLoaded(session.rules!.campaign), `${id}: after coming to`);
    const worn = session.rules!.gear!.find(g => g.slot)!;
    withEngine({ seed: 21, nowMs: T }, () => carryGear(counted, session, worn.id, false));
    withEngine({ seed: 22, nowMs: T }, () => carryGear(counted, session, worn.id, true));
    assert.ok(keptAsLoaded(session.rules!.campaign), `${id}: after its ${worn.name} went and came back`);
  }
});

test("a commit is a pure function of the rows: an isolate that kept the campaign and one that loads it afresh write the same strings and roll the same", () => {
  /** The steps a game takes, each in its own transaction: on one isolate throughout (warm), or each on a new one (cold). */
  const play = (isolate: () => typeof rules) => {
    const session = fresh(3);
    const out: string[] = [];
    const step = (pin: number, f: (r: typeof rules) => unknown) => { out.push(JSON.stringify(withEngine({ seed: pin, nowMs: T }, () => f(isolate()))), session.rules?.campaign ?? ""); };
    step(1, r => createCharacter(r, session, 3, BUILDS.wizard!.build));
    step(2, r => rollFor(r, session, "arcana", 12));
    step(3, r => rollFor(r, session, "perception", 14));
    step(4, r => comeTo(r, session));
    step(5, r => carryGear(r, session, session.rules!.gear![0]!.id, false));
    step(6, r => rollFor(r, session, "investigation", 10));
    step(7, r => sheetRows(r, session));
    return out;
  };
  assert.deepEqual(play(() => rules), play(() => rulesFrom(E, rules.pack, rules.srd)));
});

test("an event's time, from its id, is written as Date writes it", () => {
  const next = rng(9);
  for (let i = 0; i < 2000; i++) {
    const ms = Math.floor(next() * 8e12) - 1e12; // 1938 to 2223
    assert.equal(isoTime(ms), new Date(ms).toISOString());
  }
  assert.equal(isoTime(Date.UTC(2024, 1, 29, 23, 59, 59, 999)), "2024-02-29T23:59:59.999Z");
  assert.equal(idTime(withEngine({ seed: 1, nowMs: T }, () => E.newEventId())), T);
});
