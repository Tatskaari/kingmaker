// Adapted from the prototype's src/game/menu.test.ts at 44c6d4a: the action menu on the map, on an ExploreState made from rows (exploreOf, as shared/map/town.test.ts makes it) with a character the engine made from the prototype's ready builds, the menu's context a client's (the catalogue, the keep) and an act's the simulation's (ActCtx, pinned as a commit pins it), where the prototype drove its game core. Cut: the zoo's cases, a fight played out on the map (V12: here it's recorded, the stand-in is the simulation's) and the core's save and load (here the rows' round trip); a refused act throws (NotDone), its sentence the prototype's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "../rules/shim.ts";
import * as E from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import { catalogue } from "../rules/actions.ts";
import { hazard } from "../rules/acts.ts";
import { createCharacter, settleBuild, sheetRows } from "../rules/character.ts";
import { rulesFrom } from "../rules/engine.ts";
import { withEngine } from "../rules/pin.ts";
import type { Build, RulesSession } from "../rules/types.ts";
import type { PlaceFile } from "../scene/files.ts";
import { keysFor, pcKey, worldToRows, type PlaceRows } from "../world/rows.ts";
import { buildWorld, type SceneWorld } from "../world/scene-world.ts";
import { actorsHere, doorState, move, walkPlan, type ExploreState } from "./explore.ts";
import { CAST } from "./looks.ts";
import { menuText, restedNow, type Keep, type MenuCtx } from "./menu.ts";
import { doMenuAct, NotDone, storyRoute, type ActCtx, type Done } from "./menu-acts.ts";
import { exploreOf, type ExploreRow, type MapPlace, type MapRows } from "./rows.ts";
import type { MapFile } from "./tiles.ts";
import { actionMenu, actions, aimAt as aimTown, aimFor as aimForTown } from "./town.ts";
import { townWorld } from "./town-world.ts";

const CAMPAIGN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const read = (path: string) => JSON.parse(readFileSync(join(CAMPAIGN, path), "utf8"));
const MAPS = (read("campaign.json").maps as string[]).map(key => read(`maps/${key}.json`)) as MapFile[];
const YARD = read("places/granary-yard.json") as PlaceFile;
const rules = rulesFrom(E, JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "vendor", "dnd-srd-engine", "starter-pack.json"), "utf8")), JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "vendor", "srd-spells", "spells.json"), "utf8")));
const T = Date.UTC(2026, 9, 16, 9, 30);
let pin = 900;
const pinned = <X>(f: () => X): X => withEngine({ seed: pin++, nowMs: T }, f);

/** The prototype's ready builds (src/game/combat/pregen.ts's PREGENS). */
const PREGENS: Record<string, { build: Build }> = {
  fighter: { build: { classId: "fighter", subclassId: "champion", speciesId: "human", backgroundId: "soldier", abilities: ["STR", "CON", "DEX", "WIS", "CHA", "INT"],
    skills: ["athletics", "intimidation", "perception"], feat: "savage-attacker", cantrips: [], spells: [], weapons: ["longsword", "longbow"], armor: "chain-mail", shield: true } },
  wizard: { build: { classId: "wizard", subclassId: "evoker", speciesId: "human", backgroundId: "sage", abilities: ["INT", "DEX", "CON", "WIS", "CHA", "STR"],
    skills: ["arcana", "investigation", "history"], feat: "alert", cantrips: ["fire-bolt", "ray-of-frost", "light"],
    spells: ["burning-hands", "magic-missile", "shield", "thunderwave", "sleep", "scorching-ray", "fireball", "misty-step"], weapons: ["quarterstaff", "dagger"], armor: "none", shield: false } },
  rogue: { build: { classId: "rogue", subclassId: "thief", speciesId: "halfling", backgroundId: "criminal", abilities: ["DEX", "CON", "INT", "WIS", "CHA", "STR"],
    skills: ["investigation", "insight", "stealth", "perception", "sleight-of-hand"], feat: "alert", cantrips: [], spells: [], weapons: ["rapier", "shortbow", "dagger"], armor: "leather-armor", shield: false } },
  cleric: { build: { classId: "cleric", subclassId: "life-domain", speciesId: "dwarf", backgroundId: "acolyte", abilities: ["WIS", "CON", "STR", "DEX", "CHA", "INT"],
    skills: ["insight", "medicine", "religion"], feat: "alert", cantrips: ["sacred-flame", "guidance", "thaumaturgy"],
    spells: ["cure-wounds", "healing-word", "guiding-bolt", "bless", "shield-of-faith", "spiritual-weapon"], weapons: ["mace"], armor: "chain-shirt", shield: true } },
};

const made = new Map<string, string>();
function character(build: Partial<Build>, level: number, seed: number): RulesSession {
  const key = `${level}:${seed}:${JSON.stringify(build)}`;
  if (!made.has(key)) {
    const session: RulesSession = { id: "01JGAME0000000000000000000", seed, rollCount: 0, turn: 0, player: { name: "Vesper", concept: "a test of the menu", modifiers: {} } };
    withEngine({ seed: 1, nowMs: T }, () => createCharacter(rules, session, level, settleBuild(build, level, rules.content)));
    made.set(key, JSON.stringify(session));
  }
  return JSON.parse(made.get(key)!) as RulesSession;
}

/** The yard's rows as the simulation keeps them (shared/map/town.test.ts's): its place file built with its cast, the walker's character in it once they've played it. */
function yardRows(options: { player?: boolean; edit?: (w: SceneWorld) => void } = {}): PlaceRows {
  const world = buildWorld("hanged-clerk", YARD, ["kell", "cob", "moll"].map(id => ({ id, name: CAST[id]!.name })), { name: "Vesper" });
  if (!options.player) delete world.entities.player;
  options.edit?.(world);
  return worldToRows(world, keysFor("granary-yard", "hanged-clerk", pcKey("1")));
}
const yard = (status: string, rows = yardRows()): MapPlace => ({ key: "granary-yard", mapKey: "caerwyn", region: "granary-yard", origin: { x: 40, y: 9 }, scene: { key: "hanged-clerk", status, time: "morning" }, rows });
const row = (over: Partial<ExploreRow> = {}): ExploreRow => ({ playerId: "1", gameId: "1", map: "caerwyn", at: { x: 42, y: 9 }, facing: { x: 0, y: 1 }, steps: 0, hidden: false, followers: [], quips: 0, styles: [], acts: 0, said: "", log: [], ...over });
/** The lane in the morning, the yard waiting: a new game's rows. */
const morning = (town?: string): MapRows => ({ maps: MAPS, explore: row(), story: { time: "morning", lead: "hanged-clerk", played: [] }, places: [yard("waiting"), ...(town ? [townPlace(town)] : [])], unheard: [] });
/** After the hanged clerk, the Rat the lead at evening: the yard as play left it. */
const after = (): MapRows => ({ maps: MAPS, explore: row(), story: { time: "evening", lead: "drowned-rat", played: ["hanged-clerk"] }, places: [yard("ended", yardRows({ player: true }))], unheard: [] });
const townPlace = (town: string): MapPlace => ({ key: "map:caerwyn", mapKey: "caerwyn", origin: { x: 0, y: 0 }, rows: { ...yardRows(), place: { id: "9", key: "map:caerwyn", name: "Caerwyn", rootId: "0", sizeW: 0, sizeH: 0, round: 0, rev: 0 }, entity: [], position: [], narrative: [], area: [], material: [], health: [], stack: [], surface: [], creature: [], playerCharacter: [], gear: [], gmNote: [], worldLog: [] }, town });

interface Game { ex: ExploreState; session: RulesSession; keep: Keep }
const play = (build: Partial<Build>, level = 3, seed = 11, rows = morning()): Game => ({ ex: exploreOf(rows), session: character(build, level, seed), keep: {} });
/** The menu's context as a client has it: the catalogue made with this time of day's rests, as the sheet's is. */
const menu = (g: Game): MenuCtx => ({ ex: g.ex, keep: g.keep, catalogue: pinned(() => catalogue(rules, g.session, { rested: restedNow({ ex: g.ex, keep: g.keep, catalogue: undefined }) })) });
const ctx = (g: Game): ActCtx => ({ ...menu(g), rules, session: g.session, companions: [], ...(g.ex.story.lead ? { lead: g.ex.story.lead } : {}) });
const entries = (g: Game, at?: { x: number; y: number }) => actionMenu(menu(g), at)!.sections.flatMap(s => s.entries);
const item = (g: Game, key: string, at?: { x: number; y: number }) => { const e = entries(g, at).find(x => x.key === key); assert.ok(e, key); return e; };
const aimAt = (g: Game, key: string, at: { x: number; y: number }) => aimTown(menu(g), key, at)!;
const aimFor = (g: Game, key: string) => aimForTown(menu(g), key)!;
const standAt = (g: Game, x: number, y: number) => { g.ex.at = { x, y }; };
/** An act by its id, as the simulation does it: the story's people first, else the rules; refused, its sentence. */
function act(g: Game, id: string): Done {
  try {
    return pinned(() => { const c = ctx(g); return storyRoute(c, id) ?? doMenuAct(c, id); });
  } catch (e) {
    if (e instanceof NotDone) return { text: e.text };
    throw e;
  }
}
const hp = (g: Game) => pinned(() => sheetRows(rules, g.session));
/** Hurt as the rules heal (the catalogue's `you`: below the engine's own maximum, as the prototype's rulesNow read it). */
const hurt = (g: Game) => !!menu(g).catalogue?.you.hurt;
/** The porters' lodgings' door, off the granary lane. */
const DOOR = { x: 52, y: 5 };

test("the menu on the map: what's in reach decides what's dimmed, and why", () => {
  const g = play(PREGENS.fighter!.build);
  standAt(g, 47, 9);
  assert.match(item(g, "shove").why!, /nobody in reach \(5 ft\)/);
  assert.equal(item(g, "attack").aiming, true);
  const porter = actorsHere(g.ex).find(a => /porter/.test(a.name))!;
  standAt(g, porter.at.x + 1, porter.at.y);
  assert.equal(item(g, "shove").why, undefined);
  assert.equal(item(g, "shove").aiming, true);
  const at = entries(g, porter.at);
  assert.equal(at.find(e => e.key === "shove")?.id, `shove@${porter.at.x},${porter.at.y}`);
  assert.equal(at.find(e => e.key === "hide")?.id, "hide", "what isn't aimed is as it was");
});

test("aiming: how far it reaches, a clear line, an area and what it catches, yourself", () => {
  const g = play(PREGENS.wizard!.build, 5);
  standAt(g, 47, 9);
  const bolt = aimAt(g, "spell:fire-bolt", DOOR);
  assert.equal(bolt.ok, true, bolt.why ?? "");
  assert.equal(bolt.id, "cast_fire-bolt@52,5");
  assert.equal(bolt.feet, 25);
  standAt(g, 52, 9);
  assert.match(aimAt(g, "spell:fire-bolt", { x: 53, y: 1 }).why ?? "", /no clear line|nobody and nothing/);
  standAt(g, 20, 40);
  assert.match(aimAt(g, "spell:fire-bolt", DOOR).why ?? "", /out of reach: \d+ ft \(it reaches 120 ft\)/);
  standAt(g, 47, 9);
  assert.match(aimAt(g, "spell:ray-of-frost", DOOR).why ?? "", /^not on the door of the porters' lodgings$/);
  assert.match(aimAt(g, "spell:magic-missile", DOOR).why ?? "", /^not on the door/);
  const ball = aimAt(g, "spell:fireball", DOOR);
  assert.equal(ball.ok, true);
  assert.ok((ball.area?.length ?? 0) >= 9, `area ${ball.area?.length}`);
  assert.ok(ball.caught?.includes("the door of the porters' lodgings"), ball.caught?.join() ?? "");
  assert.ok(!ball.caught?.includes("you"));
  assert.ok(aimAt(g, "spell:fireball", { x: 48, y: 8 }).caught?.includes("you"), "a Fireball at your feet catches you");
  assert.match(aimAt(g, "spell:burning-hands", { x: 47, y: 9 }).why!, /which way/);
  assert.equal(aimAt(g, "spell:burning-hands", { x: 48, y: 9 }).ok, true);
  assert.match(aimAt(g, "spell:misty-step", DOOR).why!, /nowhere to land/);
  assert.equal(aimAt(g, "spell:misty-step", { x: 50, y: 8 }).ok, true);
  const view = aimFor(g, "spell:fire-bolt");
  assert.ok(view.ring.length > 40);
  assert.ok(view.targets.length > 0);
});

test("on yourself, where it can be: a cleric's Cure Wounds on themselves once they're hurt; not a Fire Bolt", () => {
  const g = play(PREGENS.cleric!.build);
  const porter = actorsHere(g.ex).find(a => /porter/.test(a.name))!;
  standAt(g, porter.at.x + 1, porter.at.y);
  const me = g.ex.at;
  assert.match(aimAt(g, "spell:cure-wounds", me).why!, /^you're not hurt$/);
  assert.match(aimAt(g, "spell:cure-wounds", porter.at).why!, /^A porter isn't hurt$/);
  assert.match(item(g, "spell:cure-wounds").why!, /^nobody in reach is hurt \(you included\)$/);
  for (let i = 0; i < 12 && !hurt(g); i++) pinned(() => hazard(rules, g.session, "fall_or_blow", "serious"));
  assert.equal(aimAt(g, "spell:cure-wounds", me).id, "cast_cure-wounds_self");
  assert.equal(aimFor(g, "spell:cure-wounds").selfReady, true);
  assert.match(aimAt(g, "spell:sacred-flame", me).why!, /not on yourself/);
});

test("a short rest on the map: the rules' rest; then not again until the clock moves on", () => {
  const g = play(PREGENS.fighter!.build);
  for (let i = 0; i < 12 && !hurt(g); i++) pinned(() => hazard(rules, g.session, "fall_or_blow", "serious"));
  const before = hp(g).hp;
  assert.equal(item(g, "rest:short").id, "rest_short");
  const text = act(g, "rest_short").text;
  assert.match(text, /^Short rest \(an hour\)/m);
  assert.match(text, /sit an hour while Caerwyn goes past/);
  assert.ok(hp(g).hp > before, "Hit Dice spent");
  assert.match(item(g, "rest:short").why!, /had a short rest/);
  g.ex.story.time = "evening";
  assert.ok(!/had a short rest/.test(item(g, "rest:short").why ?? ""));
});

test("a leap: over the cabbage cart, by the rules' jump, and you land on the far side", () => {
  const g = play(PREGENS.fighter!.build);
  standAt(g, 28, 21);
  const leap = aimAt(g, "jump", { x: 30, y: 21 });
  assert.equal(leap.ok, true, leap.why ?? "");
  assert.match(leap.label, /Leap 10 ft over a cabbage cart$/);
  assert.equal(aimAt(g, "jump", { x: 26, y: 21 }).label, "Leap 10 ft (Athletics, DC 12)");
  assert.match(aimAt(g, "jump", { x: 25, y: 21 }).why!, /^too far from a standing start: 15 ft \(10 ft at most; a run-up needs 10 ft clear behind you\)$/);
  standAt(g, 40, 5);
  assert.match(aimAt(g, "jump", { x: 42, y: 5 }).why ?? "", /^a wall in the way: no leap clears that$/);
  standAt(g, 28, 21);
  const text = act(g, "jump@30,21").text;
  assert.match(text, /^Jump: a long jump of 10 ft/m);
  assert.deepEqual(g.ex.at, { x: 30, y: 21 });
  assert.match(text, /over a cabbage cart/);
});

test("Fireball at a door: it breaks, the doorway opens, and it stays broken from the rows (place.town)", () => {
  const g = play(PREGENS.wizard!.build, 5);
  standAt(g, 47, 9);
  assert.equal(doorState(actorsHere(g.ex), DOOR), undefined, "a locked door, as the map has it");
  assert.equal(walkPlan(g.ex, DOOR)?.reaches, false, "you can't walk into it");
  const text = act(g, "cast_fireball@52,5").text;
  assert.match(text, /^Cast Fireball \(3rd-level slot\): a 20-foot sphere on the door of the porters' lodgings/m);
  assert.match(text, /The door of the porters' lodgings takes \d+ fire damage and is destroyed/);
  assert.match(g.session.rules!.status!, /3rd 1\/2/);
  assert.equal(doorState(actorsHere(g.ex), DOOR), "open");
  // As the simulation keeps it (place.town) and both sides read it back.
  const again = exploreOf(morning(JSON.stringify(g.ex.overlay.town!["caerwyn"])));
  assert.equal(doorState(actorsHere(again), DOOR), "open");
  again.at = { x: DOOR.x, y: DOOR.y + 1 };
  const step = move(again, 0, -1);
  assert.equal(step.moved, true, step.message ?? "");
  assert.deepEqual(again.at, DOOR);
});

test("after the granary the yard's locked; blast its gate and the way in is open again", () => {
  const g = play(PREGENS.wizard!.build, 5, 11, after());
  g.ex.at = { x: 42, y: 10 };
  const locked = move(g.ex, 0, 1);
  assert.equal(locked.moved, false);
  assert.match(locked.message ?? "", /locked up for the Assembly/);
  g.ex.at = { x: 47, y: 7 };
  const check = aimAt(g, "spell:fireball", { x: 42, y: 10 });
  assert.equal(check.ok, true, check.why ?? "");
  assert.ok(check.caught?.includes("the yard gate"), check.caught?.join() ?? "");
  const text = act(g, check.id!).text;
  assert.match(text, /The yard gate takes \d+ fire damage and is destroyed/);
  g.ex.at = { x: 42, y: 10 };
  assert.equal(move(g.ex, 0, 1).moved, true, "the way in is open again");
});

test("violence: the people about react, the guards come on, and the fight is recorded (two of a kind told apart)", () => {
  const g = play(PREGENS.wizard!.build, 3, 4);
  standAt(g, 11, 17);
  const guard = actorsHere(g.ex).find(a => /palace guard/.test(a.name))!;
  const done = act(g, `cast_fire-bolt@${guard.at.x},${guard.at.y}`);
  assert.match(done.text, /^Fire Bolt: your attack on a palace guard/m);
  assert.match(done.text, /Both palace guards come at you, and mean it\./);
  const enemies = done.fight!.combatants.filter(c => c.side === "enemy");
  assert.deepEqual(enemies.map(c => c.name).sort(), ["the first palace guard", "the second palace guard"]);
  assert.deepEqual(enemies.map(c => c.glyph).sort(), ["G", "g"]);
  assert.equal(done.fight!.map, "caerwyn");
});

test("what's done to someone whose scene is waiting opens it, the act its first turn; to Kell between scenes, a talk", () => {
  const g = play({ ...PREGENS.wizard!.build, spells: ["charm-person", "magic-missile", "sleep", "shield", "scorching-ray"] });
  const kell = actorsHere(g.ex).find(a => a.ref === "kell")!;
  standAt(g, 42, 8);
  const check = aimAt(g, "spell:charm-person", kell.at);
  assert.equal(check.ok, true, check.why ?? "");
  assert.match(check.label, /their scene opens/);
  const done = act(g, check.id!);
  assert.equal(done.scene, true);
  assert.deepEqual(done.act, { text: "(I cast Charm Person on Sergeant Kell)", mechanic: { kind: "cast", spell: "charm-person", targets: ["kell"], from: { backOff: 15 } } });
  assert.match(g.session.rules!.status!, /1st 4\/4/, "no slot spent on the map: the scene's rules spend it");
  const porter = actorsHere(g.ex).find(a => /porter/.test(a.name))!;
  standAt(g, porter.at.x + 1, porter.at.y);
  assert.match(aimAt(g, "spell:charm-person", porter.at).why!, /only someone the story knows/);
  // Between scenes, Kell walks with you: a bolt at her is a talk's to play.
  const b = play({ ...PREGENS.wizard!.build, spells: ["charm-person", "magic-missile", "sleep", "shield", "scorching-ray"] }, 3, 11, after());
  const follower = b.ex.followers[0]!;
  b.ex.at = { x: follower.at.x + 2, y: follower.at.y };
  const bolt = act(b, `cast_magic-missile@${follower.at.x},${follower.at.y}`);
  assert.equal(bolt.talk?.with, "kell");
  assert.deepEqual(bolt.act?.mechanic, { kind: "cast", spell: "magic-missile", targets: ["kell"] });
});

test("hide: a Stealth check against the sharpest eyes about; out of sight until you move; seen trying, not again from there", () => {
  const r = play(PREGENS.rogue!.build, 3, 2);
  standAt(r, 47, 9);
  const text = act(r, "hide").text;
  assert.match(text, /^Stealth check to slip out of sight( of [^:]+)?: \d+ [+-] ?\d+ = \d+ vs DC 1\d: (success|failure)/m);
  assert.equal(!!r.ex.hidden, /: success/.test(text));
  for (let seed = 1; seed < 40; seed++) {
    const f = play(PREGENS.wizard!.build, 3, seed);
    standAt(f, 20, 22);
    if (/: success/.test(act(f, "hide").text)) continue;
    assert.match(item(f, "hide").why!, /saw you try: somewhere else, perhaps$/);
    assert.match(act(f, "hide").text, /^\(Hide: not now, .* saw you try/);
    standAt(f, 20, 23);
    assert.equal(item(f, "hide").why, undefined, "somewhere else, you can try again");
    return;
  }
  assert.fail("no seed failed a hide");
});

test("the QA console sees the menu: the text lists it, the actions have what needs no aiming and the nearest of the rest; an id that can't be done says why", () => {
  const g = play(PREGENS.wizard!.build);
  standAt(g, 47, 9);
  const text = menuText(menu(g));
  assert.match(text, /What you can do \(the app's m; aimed ones take @x,y or _self\):/);
  assert.match(text, /Cantrips:\n {4}Fire Bolt: 1d10 fire, 120 ft: sets things alight \[cast_fire-bolt@/);
  const ids = actions(g.ex, [], menu(g)).map(a => a.id);
  assert.ok(ids.includes("hide"), ids.join(", "));
  assert.ok(ids.some(id => /^cast_fire-bolt@\d+,\d+$/.test(id)), ids.join(", "));
  assert.ok(ids.includes("cast_light_self"), ids.join(", "));
  assert.equal(new Set(ids).size, ids.length, "ids unique");
  assert.match(act(g, "cast_fire-bolt@0,0").text, /\(Fire Bolt \(cantrip\): (out of reach|nobody and nothing there|no clear line)/);
  assert.match(act(g, "rest_long").text, /\(Long rest: not now, nothing to rest off/);
});

test("before its scene the granary yard is the scene's: its gate, its people, the elm over its wall; an act at them opens it; an area reaching them is aimed at one of them", () => {
  const g = play(PREGENS.wizard!.build, 5);
  standAt(g, 42, 9);
  const tw = townWorld(g.ex);
  for (const id of ["caerwyn:door@42,10", "caerwyn:door@47,12", "caerwyn:door@47,15"]) assert.equal(tw.world.entities[id], undefined, id);
  assert.ok(tw.world.entities["caerwyn:door@53,10"], "the King's Granary's own door, on the lane, is the town's");
  assert.deepEqual([...tw.waiting.values()].filter(w => w.person).map(w => w.id).sort(), ["cob", "kell", "moll"]);
  const bolt = aimAt(g, "spell:fire-bolt", { x: 42, y: 10 });
  assert.equal(bolt.ok, true, bolt.why ?? "");
  assert.match(bolt.label, /at the yard gate \(the scene opens\)$/);
  const done = act(g, bolt.id!);
  assert.equal(done.scene, true);
  assert.deepEqual(done.act, { text: "(I cast Fire Bolt at the yard gate)", mechanic: { kind: "cast", spell: "fire-bolt", targets: ["gate"] } });
  // In the lane, over the yard wall from Kell: a Fireball at the empty yard would catch them.
  standAt(g, 42, 7);
  const yardAim = aimAt(g, "spell:fireball", { x: 44, y: 12 });
  assert.equal(yardAim.ok, false);
  assert.match(yardAim.why!, /^it would catch .*: aim it at one of them, and their scene opens$/);
});

test("lift a purse: a Sleight of Hand check beside someone, a few coins into your pockets or a hand on your wrist, and not them twice", () => {
  const g = play(PREGENS.rogue!.build, 3, 5);
  const porter = actorsHere(g.ex).find(a => /porter/.test(a.name))!;
  standAt(g, porter.at.x + 1, porter.at.y);
  assert.equal(item(g, "lift").why, undefined);
  const text = act(g, `lift@${porter.at.x},${porter.at.y}`).text;
  assert.match(text, /^Sleight of Hand check to lift .*'s purse: \d+ [+-] ?\d+ = \d+ vs DC 15: (success|failure)/im, "awake: DC 15");
  const got = (g.session.carried ?? []).find(e => e.name === "pennies")?.quantity ?? 0;
  if (/: success/.test(text)) assert.ok(got > 0, "coins in your pockets");
  else assert.match(text, /a hand closes on your wrist/);
  assert.match(act(g, `lift@${porter.at.x},${porter.at.y}`).text, /you've tried .* already/);
});
