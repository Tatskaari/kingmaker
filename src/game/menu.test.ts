import { test } from "node:test";
import assert from "node:assert/strict";
import { hangedClerkWorld } from "../../scenes/worlds/hanged-clerk.ts";
import { dnd, rulesNow, type Build } from "../rules/dnd.ts";
import { hazard } from "../rules/dnd.ts";
import { buildWorld, joinWorld } from "../world/scene-world.ts";
import { PREGENS } from "./combat/pregen.ts";
import type { TacticalFight } from "./combat/fights.ts";
import { mapFights } from "./fights.ts";
import { actorsHere, CAST, doorState, move, walkPlan } from "./map/index.ts";
import { Game } from "./play.ts";
import { actionMenu, aimAt, aimFor, exploreState, town, townOf } from "./town.ts";
import { townWorld } from "./town-world.ts";

/**
 * The action menu on the map (src/game/menu.ts) as the game core drives it: what's on offer where
 * the player stands, aiming (reach, a clear line, areas, yourself), and doing it through the core
 * by action id, on the town's world (src/game/town-world.ts). Offline: characters are made from
 * ready builds, and nothing here needs the GM.
 */

process.env.KM_RUNS_DIR ??= "runs/test";
const fights = mapFights();
const play = async (build: Partial<Build>, level = 3, seed = 11) => Game.create({ player: "Vesper: a test of the menu", level, build, explorer: town, fights, seed });
const entries = (g: Game, at?: { x: number; y: number }) => actionMenu(g.state, g.session, at)!.sections.flatMap(s => s.entries);
const item = (g: Game, key: string, at?: { x: number; y: number }) => { const e = entries(g, at).find(x => x.key === key); assert.ok(e, key); return e; };
const standAt = (g: Game, x: number, y: number) => { exploreState(g.state).at = { x, y }; };
/** The porters' lodgings' door, off the granary lane. */
const DOOR = { x: 52, y: 5 };

test("the menu on the map: what's in reach decides what's dimmed, and why", async () => {
  const g = await play(PREGENS.fighter!.build);
  standAt(g, 47, 9);
  assert.match(item(g, "shove").why!, /nobody in reach \(5 ft\)/);
  assert.equal(item(g, "attack").aiming, true, "the cart shed's cart is in reach of nothing, but the lane has things to hit");
  // Next to a porter, there's someone to shove.
  const porter = actorsHere(exploreState(g.state)).find(a => /porter/.test(a.name))!;
  standAt(g, porter.at.x + 1, porter.at.y);
  assert.equal(item(g, "shove").why, undefined);
  assert.equal(item(g, "shove").aiming, true);
  // Aimed at the porter already (a right-click's Do something…): ready to do, or why not.
  const at = entries(g, porter.at);
  assert.equal(at.find(e => e.key === "shove")?.id, `shove@${porter.at.x},${porter.at.y}`);
  assert.equal(at.find(e => e.key === "hide")?.id, "hide", "what isn't aimed is as it was");
});

test("aiming: how far it reaches, a clear line, an area and what it catches, yourself", async () => {
  const g = await play(PREGENS.wizard!.build, 5);
  standAt(g, 47, 9);
  // Fire Bolt at the door: 25 ft, a clear line.
  const bolt = aimAt(g.state, g.session, "spell:fire-bolt", DOOR)!;
  assert.equal(bolt.ok, true, bolt.why ?? "");
  assert.equal(bolt.id, "cast_fire-bolt@52,5");
  assert.equal(bolt.feet, 25);
  // Through a building: no line. Off past its reach: out of reach.
  standAt(g, 52, 9);
  assert.match(aimAt(g.state, g.session, "spell:fire-bolt", { x: 53, y: 1 })!.why ?? "", /no clear line|nobody and nothing/);
  standAt(g, 20, 40);
  assert.match(aimAt(g.state, g.session, "spell:fire-bolt", DOOR)!.why ?? "", /out of reach: \d+ ft \(it reaches 120 ft\)/);
  // Ray of Frost, like Magic Missile, is the SRD's at a creature: not at a door.
  standAt(g, 47, 9);
  assert.match(aimAt(g.state, g.session, "spell:ray-of-frost", DOOR)!.why ?? "", /^not on the door of the porters' lodgings$/);
  assert.match(aimAt(g.state, g.session, "spell:magic-missile", DOOR)!.why ?? "", /^not on the door/);
  // Fireball: a 20-ft sphere, what it covers and catches; too close, and it catches you.
  standAt(g, 47, 9);
  const ball = aimAt(g.state, g.session, "spell:fireball", DOOR)!;
  assert.equal(ball.ok, true);
  assert.ok((ball.area?.length ?? 0) >= 9, `area ${ball.area?.length}`);
  assert.ok(ball.caught?.includes("the door of the porters' lodgings"), ball.caught?.join() ?? "");
  assert.ok(!ball.caught?.includes("you"));
  const close = aimAt(g.state, g.session, "spell:fireball", { x: 48, y: 8 })!;
  assert.ok(close.caught?.includes("you"), "a Fireball at your feet catches you");
  // From yourself: a direction, not your own feet.
  assert.match(aimAt(g.state, g.session, "spell:burning-hands", { x: 47, y: 9 })!.why!, /which way/);
  assert.equal(aimAt(g.state, g.session, "spell:burning-hands", { x: 48, y: 9 })!.ok, true);
  // Misty Step: somewhere to stand, within 30 ft.
  assert.match(aimAt(g.state, g.session, "spell:misty-step", DOOR)!.why!, /nowhere to land/);
  assert.equal(aimAt(g.state, g.session, "spell:misty-step", { x: 50, y: 8 })!.ok, true);
  // The ring of its reach, and what's in it to Tab through, nearest first.
  const view = aimFor(g.state, g.session, "spell:fire-bolt")!;
  assert.ok(view.ring.length > 40);
  assert.ok(view.targets.length > 0);
  assert.ok(view.targets.every((t, i, all) => i === 0 || Math.max(Math.abs(t.at.x - 47), Math.abs(t.at.y - 9)) >= Math.max(Math.abs(all[i - 1]!.at.x - 47), Math.abs(all[i - 1]!.at.y - 9))));
});

test("on yourself, where it can be: a cleric's Cure Wounds on themselves once they're hurt; not a Fire Bolt", async () => {
  const g = await play(PREGENS.cleric!.build);
  // Fresh, there's nothing to heal: not on yourself, nor on a porter who's fine.
  const porter = actorsHere(exploreState(g.state)).find(a => /porter/.test(a.name))!;
  standAt(g, porter.at.x + 1, porter.at.y);
  const me = exploreState(g.state).at;
  assert.match(aimAt(g.state, g.session, "spell:cure-wounds", me)!.why!, /^you're not hurt$/);
  assert.match(aimAt(g.state, g.session, "spell:cure-wounds", porter.at)!.why!, /^A porter isn't hurt$/);
  assert.match(item(g, "spell:cure-wounds").why!, /^nobody in reach is hurt \(you included\)$/);
  assert.equal(aimFor(g.state, g.session, "spell:cure-wounds")!.self, true, "it can be aimed at yourself (t), and says why not");
  // Hurt: on yourself.
  for (let i = 0; i < 12 && rulesNow(g.session)!.character.hp.current >= rulesNow(g.session)!.character.hp.max; i++) await hazard(g.session, "fall_or_blow", "serious");
  assert.equal(aimAt(g.state, g.session, "spell:cure-wounds", me)!.id, "cast_cure-wounds_self");
  assert.equal(aimFor(g.state, g.session, "spell:cure-wounds")!.selfReady, true);
  assert.equal(item(g, "spell:cure-wounds").why, undefined);
  assert.match(aimAt(g.state, g.session, "spell:sacred-flame", me)!.why!, /not on yourself/);
});

test("a short rest on the map: the rules' rest; then not again until the clock moves on", async () => {
  const g = await play(PREGENS.fighter!.build);
  for (let i = 0; i < 12 && rulesNow(g.session)!.character.hp.current >= rulesNow(g.session)!.character.hp.max; i++) await hazard(g.session, "fall_or_blow", "serious");
  const before = rulesNow(g.session)!.character.hp.current;
  assert.equal(item(g, "rest:short").id, "rest_short");
  const text = await g.act("rest_short");
  assert.match(text, /^Short rest \(an hour\)/m);
  assert.match(text, /sit an hour while Caerwyn goes past/);
  assert.ok(rulesNow(g.session)!.character.hp.current > before, "Hit Dice spent");
  assert.match(item(g, "rest:short").why!, /had a short rest/);
  // The clock moves on (the next scene): rest again.
  g.state.story.time = "evening";
  assert.ok(!/had a short rest/.test(item(g, "rest:short").why ?? ""));
});

test("a leap: over the cabbage cart, by the rules' jump, and you land on the far side", async () => {
  const g = await play(PREGENS.fighter!.build);
  // The cabbage cart stands at (29, 21) in the market square: from beside it, over it.
  standAt(g, 28, 21);
  const leap = aimAt(g.state, g.session, "jump", { x: 30, y: 21 })!;
  assert.equal(leap.ok, true, leap.why ?? "");
  assert.match(leap.label, /Leap 10 ft over a cabbage cart$/);
  // The other way the cart's behind you: no run-up, so 10 ft takes Athletics and 15 is past a standing leap.
  assert.equal(aimAt(g.state, g.session, "jump", { x: 26, y: 21 })!.label, "Leap 10 ft (Athletics, DC 12)");
  assert.match(aimAt(g.state, g.session, "jump", { x: 25, y: 21 })!.why!, /^too far from a standing start: 15 ft \(10 ft at most; a run-up needs 10 ft clear behind you\)$/);
  // A wall is past any leap: the cart shed's, from the grass outside it to the floor within.
  standAt(g, 40, 5);
  assert.match(aimAt(g.state, g.session, "jump", { x: 42, y: 5 })?.why ?? "", /^a wall in the way: no leap clears that$/);
  standAt(g, 28, 21);
  const text = await g.act("jump@30,21");
  assert.match(text, /^Jump: a long jump of 10 ft/m);
  assert.deepEqual(exploreState(g.state).at, { x: 30, y: 21 });
  assert.match(text, /over a cabbage cart/);
});

test("a cantrip at a thing: Fire Bolt at a market stall, and the map keeps what it did", async () => {
  const g = await play(PREGENS.wizard!.build);
  const stall = actorsHere(exploreState(g.state)).find(a => a.name === "a market stall")!;
  standAt(g, stall.at.x + 2, stall.at.y);
  const check = aimAt(g.state, g.session, "spell:fire-bolt", stall.at)!;
  assert.equal(check.ok, true, check.why ?? "");
  const text = await g.act(check.id!);
  assert.match(text, /^Fire Bolt at a market stall: \d+ [+-]\d+ = \d+ vs AC 15: (hit|miss)$/m);
  const kept = exploreState(g.state).overlay.town?.["caerwyn"]?.things[stall.id];
  if (/: hit$/m.test(text)) {
    assert.match(text, /A market stall takes \d+ fire damage/);
    assert.ok(kept && kept.states.some(s => ["burning", "damaged", "destroyed"].includes(s)), JSON.stringify(kept));
    assert.ok(actorsHere(exploreState(g.state)).find(a => a.id === stall.id)!.states!.some(s => ["burning", "damaged", "destroyed"].includes(s)), "the map draws it so");
  } else assert.equal(kept, undefined, "a miss leaves it be");
  // A cantrip spends no slot.
  assert.match(g.session.rules!.status!, /1st 4\/4/);
});

test("Fireball at a door: it breaks, the doorway opens, and it stays broken after a save and a reload", async () => {
  const g = await play(PREGENS.wizard!.build, 5);
  standAt(g, 47, 9);
  const ex = exploreState(g.state);
  assert.equal(doorState(actorsHere(ex), DOOR), undefined, "a locked door, as the map has it");
  assert.equal(walkPlan(ex, DOOR)?.reaches, false, "you can't walk into it");
  const text = await g.act("cast_fireball@52,5");
  assert.match(text, /^Cast Fireball \(3rd-level slot\): a 20-foot sphere on the door of the porters' lodgings/m);
  assert.match(text, /The door of the porters' lodgings takes \d+ fire damage and is destroyed/);
  assert.match(g.session.rules!.status!, /3rd 1\/2/);
  // The way is open: the map's door is a hole now.
  assert.equal(doorState(actorsHere(exploreState(g.state)), DOOR), "open");
  assert.equal(walkPlan(exploreState(g.state), DOOR)?.reaches, true);
  // Saved and loaded: still broken, still open.
  g.save();
  const again = Game.load(g.state.id, town, fights);
  const ex2 = exploreState(again.state);
  assert.equal(doorState(actorsHere(ex2), DOOR), "open");
  ex2.at = { x: DOOR.x, y: DOOR.y + 1 };
  const step = move(ex2, 0, -1);
  assert.equal(step.moved, true, step.message ?? "");
  assert.deepEqual(ex2.at, DOOR);
});

test("after the granary the yard's locked; blast its gate and the way in is open again", async () => {
  const g = await play(PREGENS.wizard!.build, 5);
  // The granary scene, played and over (its world kept on the map), as the core does it.
  town.enterScene!(g.state, g.session);
  const people = ["kell", "cob", "moll"].map(id => ({ id, name: CAST[id]!.name }));
  g.session.world = buildWorld("hanged-clerk", hangedClerkWorld, people, { name: "Vesper" });
  joinWorld(g.session.world, people, 0);
  town.leaveScene!(g.state, g.session);
  delete g.session.world;
  Object.assign(g.state.story, { played: ["hanged-clerk"], lead: "drowned-rat", time: "evening" });
  town.afterScene!(g.state, g.session);
  const ex = exploreState(g.state);
  // Up to the gate, then in: locked.
  ex.at = { x: 42, y: 10 };
  const locked = move(ex, 0, 1);
  assert.equal(locked.moved, false);
  assert.match(locked.message ?? "", /locked up for the Assembly/);
  // From along the lane, Fireball at the gate.
  ex.at = { x: 47, y: 7 };
  const check = aimAt(g.state, g.session, "spell:fireball", { x: 42, y: 10 })!;
  assert.equal(check.ok, true, check.why ?? "");
  assert.ok(check.caught?.includes("the yard gate"), check.caught?.join() ?? "");
  const text = await g.act(check.id!);
  assert.match(text, /The yard gate takes \d+ fire damage and is destroyed/);
  const yard = exploreState(g.state);
  yard.at = { x: 42, y: 10 };
  const inside = move(yard, 0, 1);
  assert.equal(inside.moved, true, inside.message ?? "");
});

test("violence: the people about react, the guards come on, the fight is on the map; after it, back to the map", async () => {
  const g = await play(PREGENS.wizard!.build, 3, 4);
  standAt(g, 11, 17);
  const guard = actorsHere(exploreState(g.state)).find(a => /palace guard/.test(a.name))!;
  const text = await g.act(`cast_fire-bolt@${guard.at.x},${guard.at.y}`);
  assert.match(text, /^Fire Bolt: your attack on a palace guard/m);
  assert.match(text, /Both palace guards come at you, and mean it\./);
  assert.match(text, /Roll for initiative!/);
  assert.equal(g.state.mode, "combat");
  assert.equal(g.state.fightOnMap, true);
  // Two of a kind are told apart, by name and by letter.
  const units = Object.values((g.currentFight as TacticalFight).controller.state().units).filter(u => u.side === "enemy");
  assert.deepEqual(units.map(u => u.name).sort(), ["the first palace guard", "the second palace guard"]);
  assert.deepEqual(units.map(u => u.glyph).sort(), ["G", "g"]);
  // It's a fight like any other: play it out, and see what comes of it.
  for (let i = 0; i < 80 && !g.currentFight!.result(); i++) {
    const acts = g.currentFight!.actions();
    if (!acts.length) break;
    await g.act(acts.some(a => a.id === "auto") ? "auto" : "end_turn");
  }
  assert.ok(g.currentFight!.result(), "the fight ends");
  const result = g.currentFight!.result()!;
  const after = await g.act("continue");
  assert.match(after, /^The fight: /);
  // The news on the map is yours: "You ended the fight on...", not the story's "The player".
  assert.doesNotMatch(after, /The player/);
  assert.match(after, /\bYou (ended the fight|were knocked out|got out)/);
  assert.equal(g.state.mode, "explore");
  assert.equal(g.state.fightOnMap, undefined);
  const people = exploreState(g.state).overlay.town?.["caerwyn"]?.people;
  assert.equal(people?.time, "morning");
  assert.ok(Object.keys(people?.states ?? {}).some(id => /palace-guard/.test(id)), JSON.stringify(people));
  // Whoever ran is off the map until the clock moves on.
  const gone = Object.entries(people!.states).filter(([, s]) => s.includes("gone")).map(([id]) => id);
  for (const id of gone) assert.ok(!actorsHere(exploreState(g.state)).some(a => a.id === id), `${id} has gone`);
  // Whoever went down lies where the fight left them, not back at their post.
  for (const [id, s] of Object.entries(people!.states).filter(([, s]) => s.includes("down"))) {
    const lying = actorsHere(exploreState(g.state)).find(a => a.id === id);
    assert.deepEqual(lying?.at, result.positions?.[id], `${id} lies where they fell (${s.join()})`);
  }
});

test("what's done to someone whose scene is waiting opens it, the act its first turn; to Kell between scenes, a talk", async () => {
  const g = await play({ ...PREGENS.wizard!.build, spells: ["charm-person", "magic-missile", "sleep", "shield", "scorching-ray"] });
  const kell = actorsHere(exploreState(g.state)).find(a => a.ref === "kell")!;
  standAt(g, 42, 8);
  const check = aimAt(g.state, g.session, "spell:charm-person", kell.at)!;
  assert.equal(check.ok, true, check.why ?? "");
  assert.match(check.label, /their scene opens/);
  // Done at once (the app shows the scene opening), the rules left to the scene.
  const done = town.act(g.state, g.session, check.id!);
  assert.ok(!(done instanceof Promise));
  assert.equal(done.scene, true);
  // Cast from as far off as you stood (the scene starts you beside her).
  assert.deepEqual(done.act, { text: "(I cast Charm Person on Sergeant Kell)", mechanic: { kind: "cast", spell: "charm-person", targets: ["kell"], from: { backOff: 15 } } });
  assert.match(g.session.rules!.status!, /1st 4\/4/, "no slot spent on the map: the scene's rules spend it");
  // A passer-by isn't the story's to charm.
  const porter = actorsHere(exploreState(g.state)).find(a => /porter/.test(a.name))!;
  standAt(g, porter.at.x + 1, porter.at.y);
  assert.match(aimAt(g.state, g.session, "spell:charm-person", porter.at)!.why!, /only someone the story knows/);
  // Between scenes, Kell walks with you: a bolt at her is a talk's to play.
  Object.assign(g.state.story, { played: ["hanged-clerk"], lead: "drowned-rat", time: "evening" });
  town.afterScene!(g.state, g.session);
  const ex = exploreState(g.state);
  const follower = ex.followers[0]!;
  ex.at = { x: follower.at.x + 2, y: follower.at.y };
  const bolt = town.act(g.state, g.session, `cast_magic-missile@${follower.at.x},${follower.at.y}`);
  assert.ok(!(bolt instanceof Promise));
  assert.equal(bolt.talk?.with, "kell");
  assert.deepEqual(bolt.act?.mechanic, { kind: "cast", spell: "magic-missile", targets: ["kell"] });
});

test("a potion to hand: dimmed while you're whole; hurt, using it heals you, and it's gone", async () => {
  const g = await play(PREGENS.fighter!.build);
  // A Potion of Healing in their pack, by the engine's own event (as loot would come).
  const { E, pack } = await dnd();
  const engine = E.createEngine({ contentPacks: [pack], rng: E.seededRNG(1) });
  const id = E.newItemInstanceId();
  const got = { id: E.newEventId(), at: new Date().toISOString(), type: "ItemAcquired", instance: { id, definitionId: "healing-potion", quantity: 1, attuned: false, identifiedByCharacterIds: [] }, characterId: g.session.rules!.pc };
  g.session.rules!.campaign = E.serializeCampaign(E.commit(E.loadCampaign(g.session.rules!.campaign, engine), [got]));
  const potion = item(g, `item:${id}`);
  assert.equal(potion.group, "items");
  assert.equal(potion.name, "Potion of Healing");
  assert.match(potion.summary, /^heals 2d4\+2 hit points when consumed$/);
  assert.equal(potion.why, "you're not hurt");
  for (let i = 0; i < 12 && rulesNow(g.session)!.character.hp.current >= rulesNow(g.session)!.character.hp.max; i++) await hazard(g.session, "fall_or_blow", "serious");
  const before = rulesNow(g.session)!.character.hp.current;
  assert.equal(item(g, `item:${id}`).id, `use_${id}`);
  const text = await g.act(`use_${id}`);
  assert.match(text, /^Potion of Healing: used/m);
  assert.ok(rulesNow(g.session)!.character.hp.current > before, "healed");
  assert.ok(!entries(g).some(e => e.key === `item:${id}`), "used up");
});

test("hide: a Stealth check against the sharpest eyes about; out of sight until you do something", async () => {
  const g = await play(PREGENS.rogue!.build, 3, 2);
  standAt(g, 47, 9);
  const text = await g.act("hide");
  assert.match(text, /^Stealth check to slip out of sight( of [^:]+)?: \d+ [+-] ?\d+ = \d+ vs DC 1\d: (success|failure)/m);
  const hidden = /: success/.test(text);
  assert.equal(!!exploreState(g.state).hidden, hidden);
  if (hidden) assert.ok(actorsHere(exploreState(g.state)).find(a => a.kind === "player")!.states?.includes("hidden"), "drawn hidden");
  // Throwing a stone (at something of the town's: the old elm by the yard is the scene's) shows you.
  const target = aimFor(g.state, g.session, "throw")!.targets.find(t => !/scene opens/.test(aimAt(g.state, g.session, "throw", t.at)!.label))!;
  await g.act(target.id);
  assert.equal(exploreState(g.state).hidden, undefined);
});

test("the QA console sees the menu: the observation lists it, the actions have what needs no aiming and the nearest of the rest", async () => {
  const g = await play(PREGENS.wizard!.build);
  standAt(g, 47, 9);
  const o = g.observe();
  assert.match(o.text, /What you can do \(the app's m; aimed ones take @x,y or _self\):/);
  assert.match(o.text, /Cantrips:\n {4}Fire Bolt: 1d10 fire, 120 ft: sets things alight \[cast_fire-bolt@/);
  assert.match(o.text, /Shield: .* \(not now: a reaction: only in a fight\)/);
  const ids = o.actions.map(a => a.id);
  assert.ok(ids.includes("hide"), ids.join(", "));
  assert.ok(ids.some(id => /^cast_fire-bolt@\d+,\d+$/.test(id)), ids.join(", "));
  assert.ok(ids.some(id => id === "cast_light_self"), ids.join(", "));
  assert.equal(new Set(ids).size, ids.length, "ids unique");
  // An id that can't be done says why, rather than doing something else.
  assert.match(await g.act("cast_fire-bolt@0,0"), /\(Fire Bolt \(cantrip\): (out of reach|nobody and nothing there|no clear line)/);
  assert.match(await g.act("rest_long"), /\(Long rest: not now, nothing to rest off/);
  void townOf;
});

test("before its scene the granary yard is the scene's: its gate, its people, the elm over its wall; an act at them opens it", async () => {
  const g = await play(PREGENS.wizard!.build, 5);
  standAt(g, 42, 9);
  const ex = exploreState(g.state);
  const tw = townWorld(ex);
  // Not the town's to burn: the scene's world has them (the gate open, the loft door barred), and the GM is told that.
  for (const id of ["caerwyn:door@42,10", "caerwyn:door@47,12", "caerwyn:door@47,15", "caerwyn:elm"]) assert.equal(tw.world.entities[id], undefined, id);
  assert.ok(tw.world.entities["caerwyn:door@53,10"], "the King's Granary's own door, on the lane, is the town's");
  assert.deepEqual([...tw.waiting.values()].filter(w => w.person).map(w => w.id).sort(), ["cob", "kell", "moll"]);
  // A Fire Bolt at the gate opens the scene, the bolt its first turn.
  const bolt = aimAt(g.state, g.session, "spell:fire-bolt", { x: 42, y: 10 })!;
  assert.equal(bolt.ok, true, bolt.why ?? "");
  assert.match(bolt.label, /at the yard gate \(the scene opens\)$/);
  const done = town.act(g.state, g.session, bolt.id!);
  assert.ok(!(done instanceof Promise));
  assert.equal(done.scene, true);
  assert.deepEqual(done.act, { text: "(I cast Fire Bolt at the yard gate)", mechanic: { kind: "cast", spell: "fire-bolt", targets: ["gate"] } });
  assert.match(g.session.rules!.status!, /3rd 2\/2/);
  assert.equal(ex.overlay.town?.["caerwyn"]?.things["caerwyn:door@42,10"], undefined, "nothing of the town's was touched");
});

test("an area that would reach a waiting scene is aimed at one of its people or things, or not at all; from as far off as you stood", async () => {
  const g = await play(PREGENS.wizard!.build, 5);
  // In the lane, over the yard wall from Kell.
  standAt(g, 42, 7);
  // At the empty yard: it'd catch Kell, Moll and Cob, which is their scene's to play.
  const yard = aimAt(g.state, g.session, "spell:fireball", { x: 44, y: 12 })!;
  assert.equal(yard.ok, false);
  assert.match(yard.why!, /^it would catch Sergeant Kell and (Cob|Moll) and more: aim it at one of them, and their scene opens$/);
  assert.ok(yard.caught?.includes("Sergeant Kell") && (yard.area?.length ?? 0) > 9, "the aim still shows what it would cover");
  // At Kell herself: the scene opens with it, cast from 20 ft off (the scene starts you at her elbow).
  const kell = actorsHere(exploreState(g.state)).find(a => a.ref === "kell")!;
  const at = aimAt(g.state, g.session, "spell:fireball", kell.at)!;
  assert.equal(at.ok, true, at.why ?? "");
  assert.match(at.label, /on Sergeant Kell \(their scene opens\)$/);
  const done = town.act(g.state, g.session, at.id!);
  assert.ok(!(done instanceof Promise));
  assert.deepEqual(done.act?.mechanic, { kind: "cast", spell: "fireball", targets: ["kell"], from: { backOff: 20 } });
  // Hiding by the yard: from Kell's eyes too.
  const r = await play(PREGENS.rogue!.build, 3, 2);
  standAt(r, 42, 9);
  assert.match(await r.act("hide"), /^Stealth check to slip out of sight of (Sergeant Kell|Cob|Moll): .* vs DC 13/m);
});

test("a stale town change at a scene's own door isn't drawn: the yard gate is the scene's, before its scene and after", async () => {
  const g = await play(PREGENS.wizard!.build, 5);
  const ex = exploreState(g.state);
  ex.overlay.town = { caerwyn: { things: { "caerwyn:door@42,10": { states: ["destroyed", "burning"], at: { x: 42, y: 10 }, name: "the yard gate", time: "morning" } } } };
  const gate = actorsHere(ex).filter(a => a.at.x === 42 && a.at.y === 10);
  assert.deepEqual(gate.map(a => a.id), ["hanged-clerk:gate"]);
});

test("the aim shows what the rules will catch: the same people and things, you included", async () => {
  for (const [from, to] of [[{ x: 30, y: 22 }, { x: 28, y: 22 }], [{ x: 47, y: 9 }, { x: 50, y: 8 }], [{ x: 20, y: 30 }, { x: 22, y: 27 }]] as const) {
    const g = await play(PREGENS.wizard!.build, 5, 3);
    standAt(g, from.x, from.y);
    const aim = aimAt(g.state, g.session, "spell:fireball", to)!;
    assert.equal(aim.ok, true, aim.why ?? "");
    const text = await g.act(aim.id!);
    const caught = /catching (.+)$/m.exec(text.split("\n")[0]!)?.[1]?.split(", ") ?? [];
    assert.deepEqual([...new Set(caught)].sort(), [...aim.caught!].sort(), `from ${from.x},${from.y} at ${to.x},${to.y}`);
  }
});

test("a right-click's Do something…: an area is aimed there first, not cast; an area's aim starts clear of you", async () => {
  const g = await play(PREGENS.wizard!.build, 5);
  standAt(g, 47, 9);
  const fireball = item(g, "spell:fireball", DOOR);
  assert.equal(fireball.id, undefined, "not cast from the menu");
  assert.equal(fireball.aiming, true);
  assert.equal(item(g, "spell:fire-bolt", DOOR).id, "cast_fire-bolt@52,5", "one target, said in the menu: done at once");
  // Fireball's nearest target is the old elm beside you, which would catch you: it starts on one that doesn't.
  const view = aimFor(g.state, g.session, "spell:fireball")!;
  assert.ok(view.start);
  assert.ok(!aimAt(g.state, g.session, "spell:fireball", view.start!)!.caught!.includes("you"), `starts at ${JSON.stringify(view.start)}`);
});

test("hidden until you move: a step into the open shows you; seen trying, not again from the same spot", async () => {
  const r = await play(PREGENS.rogue!.build, 3, 2);
  standAt(r, 20, 22);
  assert.match(await r.act("hide"), /: success/);
  assert.equal(exploreState(r.state).hidden, true);
  // Looking about keeps you hidden; a step doesn't.
  await r.act("look");
  assert.equal(exploreState(r.state).hidden, true);
  assert.match(await r.act("walk_south"), /You're in plain sight again/);
  assert.equal(exploreState(r.state).hidden, undefined);
  // A failed hide: they saw you try (a seed that fails it).
  for (let seed = 1; seed < 40; seed++) {
    const f = await play(PREGENS.wizard!.build, 3, seed);
    standAt(f, 20, 22);
    if (/: success/.test(await f.act("hide"))) continue;
    assert.match(item(f, "hide").why!, /saw you try: somewhere else, perhaps$/);
    assert.match(await f.act("hide"), /^\(Hide: not now, .* saw you try/);
    await f.act("walk_south");
    assert.equal(item(f, "hide").why, undefined, "somewhere else, you can try again");
    return;
  }
  assert.fail("no seed failed a hide");
});

test("healing someone who's down isn't violence: Healing Word on a guard who went down, and nobody comes at you", async () => {
  const c = await play(PREGENS.cleric!.build, 3, 4);
  standAt(c, 11, 15);
  const guard = actorsHere(exploreState(c.state)).find(a => /palace guard/.test(a.name))!;
  await c.act(`cast_sacred-flame@${guard.at.x},${guard.at.y}`);
  assert.equal(c.state.mode, "combat");
  for (let i = 0; i < 120 && !c.currentFight!.result(); i++) {
    const acts = c.currentFight!.actions();
    if (!acts.length) break;
    await c.act(acts.some(a => a.id === "auto") ? "auto" : "end_turn");
  }
  await c.act("continue");
  const down = actorsHere(exploreState(c.state)).find(a => /palace guard/.test(a.name) && (a.states ?? []).includes("down"));
  assert.ok(down, "a guard went down (seed 4)");
  standAt(c, down.at.x + 1, down.at.y);
  const heal = aimAt(c.state, c.session, "spell:healing-word", down.at)!;
  assert.equal(heal.ok, true, heal.why ?? "");
  const text = await c.act(heal.id!);
  assert.match(text, /regains \d+ HP/);
  assert.doesNotMatch(text, /come at you|Roll for initiative/);
  assert.equal(c.state.mode, "explore");
});

test("lift a purse: a Sleight of Hand check beside someone, a few coins into your pockets or a hand on your wrist, and not them twice (thief#12)", async () => {
  const g = await play(PREGENS.rogue!.build, 3, 5);
  const porter = actorsHere(exploreState(g.state)).find(a => /porter/.test(a.name))!;
  standAt(g, porter.at.x + 1, porter.at.y);
  assert.equal(item(g, "lift").why, undefined);
  const before = (g.session.carried ?? []).find(e => e.name === "pennies")?.quantity ?? 0;
  const text = await g.act(`lift@${porter.at.x},${porter.at.y}`);
  assert.match(text, /^Sleight of Hand check to lift .*'s purse: \d+ [+-] ?\d+ = \d+ vs DC 15: (success|failure)/im, "awake: DC 15");
  const got = (g.session.carried ?? []).find(e => e.name === "pennies")?.quantity ?? 0;
  if (/: success/.test(text)) assert.ok(got > before, "coins in your pockets");
  else { assert.equal(got, before); assert.match(text, /a hand closes on your wrist/); }
  assert.match(await g.act(`lift@${porter.at.x},${porter.at.y}`), /you've tried .* already/);
});
