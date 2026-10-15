import { SCENES } from "../../scenes/index.ts";
import { catalogue, entryLabel, rangeFeet, type Aim, type Entry, type Section } from "../rules/actions.ts";
import { arcaneRecovery, attack as rulesAttack, castSpell, dnd, jump, rest, rulesNow, skillCheck, useFeature, useItem, wrestle, type Outcome } from "../rules/dnd.ts";
import { describeRoll } from "../runtime/dice.ts";
import type { Mechanic } from "../runtime/director.ts";
import type { Character } from "../runtime/scene.ts";
import type { SessionState } from "../runtime/session.ts";
import type { Entity } from "../world/scene-world.ts";
import { areaTiles, line } from "./combat/grid.ts";
import { direction, doorState, getMap, inBounds, inRect, isLive, isStructure, regionAt, steps, tileAt, tileName, whereabouts, type ExploreState, type PlaceRegion } from "./map/index.ts";
import type { GameState } from "./play.ts";
import { companion, entityAt, feetOf, keepTown, tileOfFeet, townWorld, type TownWorld } from "./town-world.ts";
import type { CombatSetup, CombatantSetup, MapActor, StoryState, Tile2, TileMap } from "./types.ts";

/**
 * The action menu on the map (the app's m): what the player can do there, grouped by kind (the
 * rules' catalogue, src/rules/actions.ts), with what's in reach for each; aiming (who and what an
 * entry can be aimed at from here, how far it reaches, what an area would catch); and doing it, by
 * the core's action ids, so the QA console plays the same menu:
 *
 *   cast_<spell>, cast_<spell>_self, cast_<spell>@x,y     a spell: no aim, on yourself, or at whoever or whatever is at a tile (an area's centre, a cone's way)
 *   feature_<id>, feature_<id>_self, feature_<id>@x,y      a class feature (Second Wind, Lay on Hands, Divine Spark)
 *   attack@x,y, throw@x,y, shove@x,y, grapple@x,y           a blow with the weapon in hand, a stone, a shove, a grab
 *   jump@x,y                                                a leap to a tile in reach (the rules' jump: farther takes Athletics)
 *   hide                                                    a Stealth check against whoever's watching
 *   rest_short, rest_short_recover, rest_long               an hour (and Arcane Recovery), a night: once each before the clock moves on
 *   use_<item>                                              something carried that's used up (a potion)
 *
 * It's all resolved by the rules on the town's world (src/game/town-world.ts): a Fireball at a door
 * breaks it and opens the way, and it stays broken. Violence draws the people about (some run, some
 * cower, the guards come on), and if anyone fights, the fight is on the map. Anything done to someone
 * whose scene is waiting opens that scene, the act its first turn (the scene's rules resolve it,
 * slot and all); what would work on Kell's mind, or hurt her, opens a talk with her the same way.
 * Charming a passer-by isn't a thing the map can play.
 */

await dnd();

/** What the explorer keeps between acts, for the menu: when the player last rested, by the story's clock. */
export interface Rested { time: StoryState["time"]; short?: boolean; long?: boolean }

export interface Ctx {
  game: GameState;
  session: SessionState;
  ex: ExploreState;
  /** The explorer's own state, which keeps `rested`. */
  keep: { rested?: Rested };
}

/** What doing something on the map came to, for the core (play.ts). */
export interface Done {
  text: string;
  /** The lead scene opens (the act is its first turn). */
  scene?: boolean;
  /** A talk with someone walking with the player opens (the act is its first turn). */
  talk?: { with: string; where: string };
  /** The player's first turn in the scene or talk that opens: what they do, and what the rules resolve. */
  act?: { text: string; mechanic: Mechanic };
  /** A fight breaks out on the map. */
  fight?: CombatSetup;
  /** The rules' lines (for the look layer's effects). */
  lines?: string[];
}

export interface MenuItem extends Entry {
  /** Ready to do as it is (nothing to aim, or aimed already): its action id. */
  id?: string;
  /** Wants aiming on the map first. */
  aiming?: boolean;
}

export interface MenuView {
  title: string;
  sections: Array<Omit<Section, "entries"> & { entries: MenuItem[] }>;
  /** Aimed at a tile already (a right-click's "Do something…"). */
  at?: Tile2;
}

const FEET = 5;
const feetBetween = (a: Tile2, b: Tile2) => steps(a, b) * FEET;
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const the = (name: string) => (/^(a|an|the)\s/i.test(name) || /^[A-Z]/.test(name) ? name.replace(/^(A|An)\s/, m => m.toLowerCase()) : `the ${name}`);

/** Rested this time of day already. */
function restedNow(c: Ctx): { short?: boolean; long?: boolean } {
  const r = c.keep.rested;
  return r && r.time === c.ex.story.time ? { ...(r.short ? { short: true } : {}), ...(r.long ? { long: true } : {}) } : {};
}

// ---------------------------------------------------------------------------------------------
// The map's geometry: lines of sight, where a body can stand, what's in reach.

/** Does anything stand in the way of a spell or a shot between two tiles (walls, buildings, trees, shut doors)? The ends don't count. */
export function clearLine(map: TileMap, actors: MapActor[], a: Tile2, b: Tile2): boolean {
  return line(a, b).slice(1, -1).every(p => {
    const t = tileAt(map, p);
    if (t.terrain === "door") return doorState(actors, p) === "open";
    if (t.terrain === "tree") return false;
    return !(isStructure(t) && (t.height ?? 0) >= 2) && t.terrain !== "void";
  });
}

/** Somewhere a body can land or stand: open ground (or water, or a doorway that's open), nobody in the way, not a way off the map. */
export function standable(map: TileMap, actors: MapActor[], p: Tile2, story: StoryState): boolean {
  if (!inBounds(map, p)) return false;
  const t = tileAt(map, p);
  const open = t.terrain === "door" && doorState(actors, p) === "open";
  if ((t.blocks && !open) || (isStructure(t) && t.terrain !== "door") || t.terrain === "deep-water" || t.terrain === "void" || t.terrain === "tree") return false;
  if (t.terrain === "door" && t.blocks && !open) return false;
  if (map.exits.some(e => e.at.x === p.x && e.at.y === p.y)) return false;
  if (actors.some(a => a.at.x === p.x && a.at.y === p.y && a.kind !== "player" && a.blocks && !(a.states ?? []).some(s => s === "overhead" || s === "hanging"))) return false;
  const region = regionAt(map, p);
  return !region?.shut || isLive(story, region.opensFor ?? region.sceneId) || story.played.includes(region.opensFor ?? region.sceneId ?? "");
}

/**
 * What's in the way of a leap between two tiles: nothing (a clear jump), something low to clear (a
 * fence, a cart, the river), or something too tall (a wall, a house, a tree), which no leap clears.
 */
function overleap(map: TileMap, actors: MapActor[], a: Tile2, b: Tile2): { tall?: string; low: string[]; water: boolean } {
  const low: string[] = [];
  let water = false;
  for (const p of line(a, b).slice(1, -1)) {
    const t = tileAt(map, p);
    const raised = (t.height ?? 0) >= 2 && (isStructure(t) || t.terrain === "tree");
    if (raised || t.terrain === "void") return { tall: t.terrain === "tree" ? "a tree" : t.terrain === "door" ? "a door" : "a wall", low, water };
    if (t.terrain === "deep-water" || t.terrain === "water") { water ||= t.terrain === "deep-water"; if (!low.includes("the river")) low.push("the river"); }
    else if (isStructure(t)) low.push(t.terrain === "fence" ? "a fence" : "a low wall");
    const over = actors.find(x => x.at.x === p.x && x.at.y === p.y && x.kind !== "player" && x.blocks);
    if (over && !low.includes(over.name)) low.push(over.name);
  }
  return { low, water };
}

/** Room to run at a leap: two clear tiles behind you, the way you'd jump (the rules' 10 ft run-up). */
function runUp(map: TileMap, actors: MapActor[], from: Tile2, to: Tile2, story: StoryState): boolean {
  const dir = { x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) };
  return [1, 2].every(d => standable(map, actors, { x: from.x - dir.x * d, y: from.y - dir.y * d }, story));
}

/** States that say someone's hurt (the rules keep them on the town's people). */
const HURT = ["hurt", "badly hurt", "down", "unconscious"];

/** Is the player hurt, as the rules heal (below the engine's own maximum: src/rules/actions.ts)? */
function youHurt(c: Ctx): boolean {
  const r = rulesNow(c.session);
  return !!r && Math.max(0, r.character.hp.current) < r.character.hp.max;
}

/** A story person: someone whose scene is waiting, or who walks with the player and has a talk in them. */
interface Story { kind: "waiting"; sceneId: string; castId: string; name: string; at: Tile2 }

/** Who or what is at a tile, as the menu aims at it. */
type Aimed =
  | { kind: "self"; at: Tile2; name: "you" }
  | { kind: "being"; at: Tile2; name: string; entity: Entity; companion: boolean }
  | { kind: "thing"; at: Tile2; name: string; entity: Entity }
  | Story;

function aimedAt(tw: TownWorld, ex: ExploreState, at: Tile2): Aimed | undefined {
  if (at.x === ex.at.x && at.y === ex.at.y) return { kind: "self", at, name: "you" };
  for (const w of tw.waiting.values()) if (w.at.x === at.x && w.at.y === at.y) return { kind: "waiting", sceneId: w.sceneId, castId: w.castId, name: w.name, at };
  const e = entityAt(tw, at, { people: true, things: true });
  if (!e) return undefined;
  if (e.kind === "person" || e.kind === "creature") return { kind: "being", at, name: e.name, entity: e, companion: !!companion(tw, e.id) };
  return { kind: "thing", at, name: e.name, entity: e };
}

/** Everyone and everything the menu could aim at from here, nearest first. */
function aimables(tw: TownWorld, ex: ExploreState): Aimed[] {
  const seen = new Set<string>();
  const out: Aimed[] = [{ kind: "self", at: { ...ex.at }, name: "you" }];
  for (const w of tw.waiting.values()) out.push({ kind: "waiting", sceneId: w.sceneId, castId: w.castId, name: w.name, at: w.at });
  for (const e of Object.values(tw.world.entities)) {
    // What hangs overhead (bunting, a washing line) can be aimed at by pointing, but isn't one of what Tab goes through.
    if (!e.at || e.player || e.kind === "place" || e.kind === "area" || e.kind === "surface" || e.states.includes("gone") || e.tags.includes("hanging")) continue;
    const at = tileOfFeet(e.at);
    const key = `${at.x},${at.y}`;
    if (seen.has(key) || steps(at, ex.at) > 32) continue;
    const a = aimedAt(tw, ex, at);
    if (!a || a.kind === "self") continue;
    seen.add(key);
    out.push(a);
  }
  return out.sort((a, b) => steps(a.at, ex.at) - steps(b.at, ex.at));
}

// ---------------------------------------------------------------------------------------------
// Aiming.

export interface AimAt {
  ok: boolean;
  /** Why not, when it isn't. */
  why?: string;
  /** The action id to do it with. */
  id?: string;
  /** "Fire Bolt (cantrip) at the cabbage cart", for the hint line. */
  label: string;
  /** What's aimed at, in a few words ("the cabbage cart", "yourself", "the market square"). */
  target?: string;
  /** The tiles an area covers, aimed here. */
  area?: Tile2[];
  /** Who and what that area catches (you included). */
  caught?: string[];
  feet: number;
}

const SOCIAL_WHY = "only someone the story knows (Kell, or someone whose scene is waiting): a passer-by has nothing to be talked round to";

/**
 * Can an entry be aimed at a tile from where the player stands, and what would it do there?
 * `area`: work out what an area covers and catches (what the aim on screen shows; a list of targets needn't).
 */
export function checkAim(c: Ctx, tw: TownWorld, entry: Entry, at: Tile2, options: { area?: boolean } = {}): AimAt {
  const ex = c.ex, map = tw.map;
  const actors = tw.mapActors;
  const feet = feetBetween(ex.at, at);
  const name = entryLabel(entry);
  const no = (why: string, label = name): AimAt => ({ ok: false, why, label, feet });
  if (entry.why) return no(entry.why);
  const aim = entry.aim;
  if (aim.kind === "none" || aim.kind === "self") return { ok: true, id: entry.act, label: name, feet: 0 };
  if (!inBounds(map, at)) return no("off the map");
  if (aim.kind === "area") {
    const fromSelf = aim.fromSelf;
    if (fromSelf && feet === 0) return no("which way? Point it away from you");
    if (!fromSelf && feet > aim.range) return no(`out of reach: ${feet} ft (it reaches ${aim.range} ft)`);
    if (!fromSelf && !clearLine(map, actors, ex.at, at)) return no("no clear line to there");
    const area = options.area === false ? undefined : areaTiles(map, aim.shape, aim.size, ex.at, at, fromSelf);
    const caught = area ? caughtBy(tw, ex, area) : undefined;
    const where = aimedAt(tw, ex, at);
    const there = where && where.kind !== "self" ? the(where.name) : tileName(ex, at);
    return { ok: true, id: `${entry.act}@${at.x},${at.y}`, label: `${name} ${fromSelf ? "towards" : "on"} ${there}`, target: `${fromSelf ? "towards " : ""}${there}`, ...(area ? { area } : {}), ...(caught ? { caught } : {}), feet };
  }
  if (aim.kind === "tile") {
    if (feet === 0) return no("you're already here");
    if (feet > aim.range) return no(`too far: ${feet} ft (${aim.range} ft at most)`);
    if (!standable(map, actors, at, ex.story)) return no(`nowhere to land: ${tileName(ex, at)}`);
    if (aim.jump) {
      const way = overleap(map, actors, ex.at, at);
      if (way.tall) return no(`${way.tall} in the way: no leap clears that`);
      // As the rules have it: easy within reach, half as far again on Athletics, and past that you fall short.
      const run = runUp(map, actors, ex.at, at, ex.story);
      const easy = run ? aim.jump.long : aim.jump.standing;
      const most = Math.floor(easy * 1.5 / FEET) * FEET;
      if (feet * 2 > easy * 3) return no(run ? `too far: ${feet} ft (${most} ft at most)` : `too far from a standing start: ${feet} ft (${most} ft at most; a run-up needs 10 ft clear behind you)`);
      const hard = feet > easy ? ` (Athletics, DC ${10 + feet - easy})` : "";
      return { ok: true, id: `${entry.act}@${at.x},${at.y}`, label: `Leap ${feet} ft${way.low.length ? ` over ${way.low.slice(0, 2).join(" and ")}` : ""}${hard}`, target: tileName(ex, at), feet };
    }
    if (!clearLine(map, actors, ex.at, at)) return no("you can't see a clear way to there");
    return { ok: true, id: `${entry.act}@${at.x},${at.y}`, label: `${name} to ${tileName(ex, at)}`, target: tileName(ex, at), feet };
  }
  // Someone, or someone or something.
  const who = aimedAt(tw, ex, at);
  if (!who) return no(aim.kind === "creature" ? "nobody there" : "nobody and nothing there");
  if (who.kind === "self") {
    if (!aim.self) return no("not on yourself");
    if (entry.heals && !youHurt(c)) return no("you're not hurt", `${name} on yourself`);
    return { ok: true, id: `${entry.act}_self`, label: `${name} on yourself`, target: "yourself", feet: 0 };
  }
  if (aim.kind === "creature" && who.kind === "thing") return no(`not on ${the(who.name)}`);
  if (who.kind === "thing" && who.entity.states.includes("destroyed")) return no(`${the(who.name)} is past it`);
  if (entry.effect === "social" && who.kind === "being" && !who.companion) return no(SOCIAL_WHY);
  // Healing someone who isn't hurt does nothing (Kell, and anyone whose scene is waiting, are the story's to play).
  if (entry.heals && who.kind === "being" && !who.companion && !who.entity.states.some(s => HURT.includes(s))) return no(`${capital(the(who.name))} isn't hurt`);
  const range = Math.max(aim.range, FEET);
  if (feet > range) return no(`out of reach: ${feet} ft (it reaches ${range} ft)`);
  if (feet > FEET && !clearLine(map, actors, ex.at, at)) return no("no clear line to there");
  const verb = entry.effect === "harm" ? "at" : "on";
  return { ok: true, id: `${entry.act}@${at.x},${at.y}`, label: `${name} ${verb} ${the(who.name)}${who.kind === "waiting" ? " (their scene opens)" : ""}`, target: `${the(who.name)}${who.kind === "waiting" ? " (their scene opens)" : ""}`, feet };
}

/** Who and what an area's tiles catch: the town's people and things in it, and you. */
function caughtBy(tw: TownWorld, ex: ExploreState, area: Tile2[]): string[] {
  const inside = new Set(area.map(t => `${t.x},${t.y}`));
  const names: string[] = [];
  for (const e of Object.values(tw.world.entities)) {
    if (!e.at || e.kind === "place" || e.kind === "area" || e.kind === "surface" || e.states.includes("gone")) continue;
    const t = tileOfFeet(e.at);
    if (!inside.has(`${t.x},${t.y}`)) continue;
    const n = e.player ? "you" : e.name;
    if (!names.includes(n)) names.push(n);
  }
  void ex;
  return names.sort((a, b) => Number(b === "you") - Number(a === "you"));
}

export interface AimView {
  entry: Entry;
  /** Where its reach ends: a ring of tiles round the player. */
  ring: Tile2[];
  /** Who and what it could be aimed at from here (in reach, in sight), nearest first: Tab goes through them. */
  targets: Array<{ at: Tile2; name: string; id: string }>;
  /** It can be aimed at yourself. */
  self: boolean;
  /** Aimed at yourself, it would be done now (a heal needs you hurt). */
  selfReady: boolean;
}

/** What an entry can be aimed at from here: its reach, and the targets in it. */
export function aimView(c: Ctx, tw: TownWorld, entry: Entry): AimView {
  const ex = c.ex;
  const reach = reachOf(entry.aim);
  const ring: Tile2[] = [];
  const r = Math.floor(reach / FEET);
  if (r > 0 && r <= 40) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const p = { x: ex.at.x + dx, y: ex.at.y + dy };
    if (inBounds(tw.map, p)) ring.push(p);
  }
  const targets: AimView["targets"] = [];
  if (entry.aim.kind === "target" || entry.aim.kind === "creature" || entry.aim.kind === "area") {
    for (const a of aimables(tw, ex)) {
      if (a.kind === "self") continue;
      const check = checkAim(c, tw, entry, a.at, { area: false });
      if (check.ok && check.id) targets.push({ at: a.at, name: a.name, id: check.id });
    }
  } else if (entry.aim.kind === "tile") {
    // Somewhere to land: the farthest open tile each way, within reach.
    for (const [dx, dy] of [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as const) {
      for (let d = r; d >= 1; d--) {
        const p = { x: ex.at.x + dx * d, y: ex.at.y + dy * d };
        const check = checkAim(c, tw, entry, p);
        if (check.ok && check.id) { targets.push({ at: p, name: tileName(ex, p), id: check.id }); break; }
      }
    }
  }
  const self = (entry.aim.kind === "target" || entry.aim.kind === "creature") && entry.aim.self;
  return { entry, ring, targets, self, selfReady: self && checkAim(c, tw, entry, ex.at).ok };
}

const reachOf = (aim: Aim) => (aim.kind === "none" || aim.kind === "self" ? 0 : aim.range);

// ---------------------------------------------------------------------------------------------
// The menu.

/** The menu now: what the player can do, by kind, and what's in reach for each. `at`: aimed at a tile already. */
export function menuOf(c: Ctx, at?: Tile2): MenuView | undefined {
  const cat = catalogue(c.session, { rested: restedNow(c) });
  if (!cat) return undefined;
  const tw = townWorld(c.ex);
  const where = at ? aimedAt(tw, c.ex, at) : undefined;
  const sections = cat.sections.map(s => ({ ...s, entries: s.entries.map((e): MenuItem => {
    if (e.why) return e;
    if (e.aim.kind === "none" || e.aim.kind === "self") return { ...e, id: e.act };
    if (at) {
      // Aimed already: at what was right-clicked.
      const check = checkAim(c, tw, e, at, { area: false });
      return check.ok ? { ...e, id: check.id! } : { ...e, why: check.why ?? "not there" };
    }
    // An area can go anywhere in reach: there's always somewhere to aim it.
    if (e.aim.kind === "area") return { ...e, aiming: true };
    const view = aimView(c, tw, e);
    if (!view.targets.length && !view.selfReady) {
      // People about, but none the story knows: that's why, for working on someone's mind.
      const reach = Math.max(FEET, e.aim.range);
      const people = e.effect === "social" && aimables(tw, c.ex).some(a => a.kind === "being" && feetBetween(c.ex.at, a.at) <= reach);
      const why = e.aim.kind === "tile" ? `nowhere to land within ${e.aim.range} ft`
        : e.heals ? `nobody in reach is hurt${view.self ? " (you included)" : ""}`
        : people ? SOCIAL_WHY : `${e.aim.kind === "creature" ? "nobody" : "nobody and nothing"} in reach (${reach} ft)`;
      return { ...e, why };
    }
    return { ...e, aiming: true };
  }) }));
  return { title: at ? `Do something: ${where && where.kind !== "self" ? the(where.name) : tileName(c.ex, at)}` : "What will you do?", sections, ...(at ? { at } : {}) };
}

/** The menu as a QA observation says it: each kind, what's in it, the ids to act with (or why not). */
export function menuText(c: Ctx): string {
  const menu = menuOf(c);
  if (!menu) return "";
  const tw = townWorld(c.ex);
  const lines = ["What you can do (the app's m; aimed ones take @x,y or _self):"];
  for (const s of menu.sections) {
    lines.push(`  ${s.title}${s.note ? ` (${s.note})` : ""}:`);
    for (const e of s.entries) {
      let ids = e.id ?? "";
      if (!e.why && !e.id) {
        const view = aimView(c, tw, e);
        ids = [...(view.selfReady ? [`${e.act}_self`] : []), ...view.targets.slice(0, 3).map(t => t.id), ...(e.aim.kind === "area" ? [`${e.act}@x,y`] : [])].join(", ");
      }
      lines.push(`    ${e.name}: ${e.summary}${e.why ? ` (not now: ${e.why})` : ids ? ` [${ids}]` : ""}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// Doing it.

const STEM = /^(cast|feature)_(.+?)(?:_(self)|@(\d+),(\d+))?$/;
const BLOW = /^(attack|throw|shove|grapple|jump)@(\d+),(\d+)$/;

/** Is this one of the menu's action ids? */
export const isMenuAct = (id: string) => STEM.test(id) || BLOW.test(id) || /^(hide|rest_short|rest_short_recover|rest_long)$/.test(id) || /^use_.+$/.test(id);

/** The rules' work on the town's world: the session's world for as long as it takes, then back as it was. */
async function onTown<T>(session: SessionState, tw: TownWorld, run: () => Promise<T>): Promise<T> {
  const had = session.world;
  session.world = tw.world;
  try { return await run(); }
  finally { if (had) session.world = had; else delete session.world; }
}

/** The cards of whoever walks with the player (the rules take their stats from them), for the rules' `cast`. */
function companions(tw: TownWorld): Character[] {
  return Object.values(tw.world.entities).filter(e => e.cast).map(e => SCENES.flatMap(s => s.cast).find(c => c.id === e.cast)).filter((c): c is Character => !!c);
}

/**
 * An act aimed at one of the story's people (someone whose scene is waiting; Kell, for what would
 * hurt her or work on her mind): the scene or the talk it opens, at once (no rules on the map: the
 * scene's resolve it, as its first turn). Undefined for anything else.
 */
export function storyRoute(c: Ctx, id: string): Done | undefined {
  const m = STEM.exec(id) ?? BLOW.exec(id);
  const x = m?.[m.length - 2], y = m?.[m.length - 1];
  if (!m || x === undefined || y === undefined || !c.session.rules) return undefined;
  const at = { x: Number(x), y: Number(y) };
  const stem = id.replace(/@\d+,\d+$/, "");
  const entry = catalogue(c.session, { rested: restedNow(c) })?.entries.find(e => e.act === stem && e.act);
  if (!entry || entry.why || entry.key === "jump") return undefined;
  const tw = townWorld(c.ex);
  const target = aimedAt(tw, c.ex, at);
  if (target?.kind !== "waiting" && !(target?.kind === "being" && target.companion && (entry.effect === "harm" || entry.effect === "social"))) return undefined;
  if (!checkAim(c, tw, entry, at).ok) return undefined;
  delete c.ex.hidden;
  return target.kind === "waiting" ? storyAct(c, entry, target, at) : talkAct(c, tw, entry, target);
}

/** Do one of the menu's acts. */
export async function doMenuAct(c: Ctx, id: string): Promise<Done> {
  const { session, ex } = c;
  if (!session.rules) return { text: "(No rules character: nothing to do it with.)" };
  const cat = catalogue(session, { rested: restedNow(c) })!;
  const tw = townWorld(ex);
  const at = (() => { const m = STEM.exec(id) ?? BLOW.exec(id); const x = m?.[m.length - 2], y = m?.[m.length - 1]; return x !== undefined && y !== undefined ? { x: Number(x), y: Number(y) } : undefined; })();
  const stem = id.replace(/@\d+,\d+$/, "").replace(/_self$/, "");
  const entry = cat.entries.find(e => e.act === stem && e.act);
  if (!entry) throw new Error(`Unavailable action: ${id}. Observe again for what you can do.`);
  if (entry.why) return { text: `(${entry.name}: not now, ${entry.why}.)` };
  // Aimed: is it in reach from here, at something it can be aimed at?
  const self = id.endsWith("_self");
  if (at || self) {
    const check = checkAim(c, tw, entry, self ? ex.at : at!);
    if (!check.ok) return { text: `(${check.label}: ${check.why}.)` };
  } else if (entry.aim.kind !== "none" && entry.aim.kind !== "self") {
    return { text: `(${entry.name} needs aiming: ${entry.act}@x,y${entry.aim.kind !== "area" && entry.aim.kind !== "tile" && entry.aim.self ? ` or ${entry.act}_self` : ""}.)` };
  }
  const wasHidden = !!ex.hidden;
  // Doing anything but hiding shows you (in the town's world too, which is what's kept).
  if (entry.key !== "hide") {
    delete ex.hidden;
    const me = tw.world.entities.player;
    if (me) me.states = me.states.filter(s => s !== "hidden");
  }
  if (entry.key === "rest:short" || entry.key === "rest:long" || entry.key === "feature:arcane-recovery") return restNow(c, entry.key === "rest:long" ? "long" : "short", entry.key === "feature:arcane-recovery");
  if (entry.key === "hide") return hideNow(c, tw);
  if (entry.key === "jump") return leapNow(c, tw, at!);
  if (entry.group === "items") return result(c, tw, await useItem(session, id.slice("use_".length)), { act: entry, wasHidden });
  const target = self ? undefined : at ? aimedAt(tw, ex, at) : undefined;
  // Someone the story is keeping for a scene: the act opens it.
  if (target?.kind === "waiting") return storyAct(c, entry, target, at!);
  if (target?.kind === "being" && target.companion && (entry.effect === "harm" || entry.effect === "social")) return talkAct(c, tw, entry, target);
  const cast = companions(tw);
  const targetId = target && target.kind !== "self" ? (target as { entity: Entity }).entity.id : undefined;
  let out: Outcome;
  if (entry.spell) {
    const spell = entry.spell;
    let targets: string[];
    let marker: string | undefined;
    if (self || entry.aim.kind === "self") targets = ["self"];
    else if (entry.aim.kind === "area" && at) {
      // An area goes where it's aimed: at whoever or whatever is there, else at the spot itself.
      if (targetId) targets = [targetId];
      else { marker = `aim@${at.x},${at.y}`; tw.world.entities[marker] = { id: marker, name: tileName(ex, at), kind: "area", parent: tw.world.root, at: feetOf(at), tags: [], states: [], notes: [] }; targets = [marker]; }
    } else targets = targetId ? [targetId] : [];
    out = await onTown(session, tw, () => castSpell(session, cast, spell.id, targets, spell.ritual ? { ritual: true } : {}));
    if (marker) delete tw.world.entities[marker];
    const cast_ = !/^\(/.test(out.lines[0] ?? "");
    if (cast_) {
      // What the rules leave to the world here: a lock opened or shut, a light lit, a step through mist.
      if (spell.id === "knock" && target?.kind === "thing") out = { ...out, lines: [...out.lines, ...openLock(target.entity)] };
      if (spell.id === "arcane-lock" && target?.kind === "thing") out = { ...out, lines: [...out.lines, ...shutLock(target.entity)] };
      if ((spell.id === "light" || spell.id === "continual-flame") && target?.kind === "thing" && !target.entity.states.includes("lit")) { target.entity.states.push("lit"); out = { ...out, lines: [...out.lines, `${capital(target.name)} shines like a torch`] }; }
      if (entry.aim.kind === "tile" && at) {
        ex.at = { ...at };
        out = { ...out, lines: [...out.lines, `You step out of the mist ${tileName(ex, at) === "you" ? "here" : `on ${tileName(ex, at)}`}`] };
        const opened = stepsInto(c, at);
        if (opened) return { text: [...out.lines, opened.text].join("\n"), scene: true, lines: out.lines };
      }
    }
  } else if (entry.key.startsWith("feature:")) {
    out = await onTown(session, tw, () => useFeature(session, cast, entry.key.slice("feature:".length), self || !targetId ? "self" : targetId));
  } else if (entry.key === "attack" || entry.key === "throw") {
    out = await onTown(session, tw, () => rulesAttack(session, cast, targetId!, entry.key === "throw" ? "improvised" : undefined));
  } else if (entry.key === "shove" || entry.key === "grapple") {
    out = await onTown(session, tw, () => wrestle(session, cast, targetId!, entry.key === "shove" ? "prone" : "grapple"));
  } else return { text: `(${entry.name}: not something the map can do yet.)` };
  return result(c, tw, out, { act: entry, ...(target && target.kind !== "self" ? { target } : {}), wasHidden });
}

/** A lock, opened by Knock: on the map, an opened lock is a door you can go through. */
function openLock(e: Entity): string[] {
  if (!e.states.some(s => ["locked", "barred", "bolted", "closed"].includes(s))) return [`${capital(e.name)} wasn't locked`];
  e.states = [...e.states.filter(s => !["locked", "barred", "bolted", "closed"].includes(s)), "open"];
  return [`${capital(e.name)} unlocks with a knock you could hear in the next street, and swings open`];
}

function shutLock(e: Entity): string[] {
  e.states = [...e.states.filter(s => s !== "open"), ...["closed", "locked"].filter(s => !e.states.includes(s))];
  return [`${capital(e.name)} is shut, and locked by magic`];
}

/** Stepping (or landing) somewhere opens the lead's place, when it's walked into. */
function stepsInto(c: Ctx, at: Tile2): { text: string } | undefined {
  const map = getMap(c.ex.map);
  const r = (map.regions as PlaceRegion[]).find(r => r.trigger === "enter" && r.sceneId && inRect(r.rect, at) && isLive(c.ex.story, r.sceneId));
  return r && r.sceneId === c.game.story.lead ? { text: `You ${(r.label ?? `go into ${r.name}`).charAt(0).toLowerCase()}${(r.label ?? `go into ${r.name}`).slice(1)}.` } : undefined;
}

/**
 * After the rules: keep what they did to the town, let the people about react to any violence,
 * and say it all (the rules' lines, then what the town did about it).
 */
function result(c: Ctx, tw: TownWorld, out: Outcome, how: { act: Entry; target?: Aimed; wasHidden?: boolean }): Done {
  const { ex } = c;
  const lines = [...out.lines];
  const refused = /^\(/.test(lines[0] ?? "");
  // A blow or a harmful spell at someone is violence whether or not it lands.
  const aimed = how.target?.kind === "being" && how.act.effect === "harm" ? [how.target.entity] : [];
  const hurt = refused ? [] : [...new Set([...aimed, ...victims(tw)])];
  const property = refused ? [] : wrecked(tw);
  let fight: CombatSetup | undefined;
  if (!refused && (hurt.length || (property.length && how.act.effect === "harm"))) {
    const react = townReactions(tw, ex, { victims: hurt, property, hidden: !!how.wasHidden, seed: c.session.seed + 131 * c.session.rollCount });
    lines.push(...react.lines);
    if (react.fighters.length) fight = townFight(c, tw, react.fighters);
  }
  keepTown(ex, tw);
  return { text: lines.join("\n"), lines: out.lines, ...(fight ? { fight } : {}) };
}

/** People the rules just hurt, knocked down or set alight. */
function victims(tw: TownWorld): Entity[] {
  return Object.values(tw.world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !e.player && changedTo(tw, e, ["hurt", "badly hurt", "down", "burning", "prone", "unconscious", "grappled"]));
}

/** Things the rules just set burning or broke. */
function wrecked(tw: TownWorld): Entity[] {
  return Object.values(tw.world.entities).filter(e => (e.kind === "object" || e.kind === "item" || e.kind === "feature") && changedTo(tw, e, ["burning", "destroyed", "damaged"]));
}

function changedTo(tw: TownWorld, e: Entity, states: string[]): boolean {
  const was = (tw.before.get(e.id) ?? "").split("#")[0]!.split("|");
  return e.states.some(s => states.includes(s) && !was.includes(s));
}

// ---------------------------------------------------------------------------------------------
// The town's people react.

export type TownReaction = "fight" | "flee" | "raise_alarm" | "cower" | "intervene" | "unmoved";

const SAYS: Record<TownReaction, string> = {
  fight: "comes at you", flee: "runs for it", raise_alarm: "runs off shouting for the watch", cower: "ducks behind whatever's nearest", intervene: "shouts at you to stop it", unmoved: "carries on regardless",
};
const SAY_MANY: Record<TownReaction, string> = {
  fight: "come at you", flee: "run for it", raise_alarm: "run off shouting for the watch", cower: "duck behind whatever's nearest", intervene: "shout at you to stop it", unmoved: "carry on regardless",
};

/**
 * Everyone about takes what the player did, each by what they are (the town has no GM between
 * scenes, so it's the rules' own judgement, and the same every time): the guards come on for
 * someone hurt (and shout about property), the hurt and most passers-by get out, some cower, some
 * run for the watch; Kell steps in. Whoever runs is gone until the clock moves on. From hiding,
 * nobody knows who did it: nobody comes at you.
 */
export function townReactions(tw: TownWorld, ex: ExploreState, act: { victims: Entity[]; property: Entity[]; hidden: boolean; seed: number }): { reactions: Record<string, TownReaction>; lines: string[]; fighters: Entity[] } {
  const reactions: Record<string, TownReaction> = {};
  const lines: string[] = [];
  const fighters: Entity[] = [];
  const near = Object.values(tw.world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !e.player && !e.states.some(s => ["gone", "down", "unconscious", "dead"].includes(s)) && e.at && steps(tileOfFeet(e.at), ex.at) <= 12);
  const hurtPerson = act.victims.some(v => v.kind === "person");
  const roll = (id: string) => [...`${id}:${act.seed}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 100;
  for (const e of near) {
    const victim = act.victims.includes(e);
    const guard = e.stats?.statblock === "guard";
    let r: TownReaction;
    if (e.cast) r = "intervene";
    else if (guard) r = hurtPerson && !act.hidden ? "fight" : "intervene";
    else if (e.kind === "creature") r = /goose/i.test(e.name) ? "unmoved" : "flee";
    else if (victim) r = roll(e.id) < 70 ? "flee" : "raise_alarm";
    else { const n = roll(e.id); r = n < 50 ? "flee" : n < 80 ? "cower" : "raise_alarm"; }
    reactions[e.id] = r;
    if (r === "flee" || r === "raise_alarm") e.states = [...e.states.filter(s => s !== "cowering"), "gone"];
    else if (r === "cower" && !e.states.includes("cowering")) e.states.push("cowering");
    else if (r === "fight") fighters.push(e);
  }
  // A few words for each, the ones who matter first; two of a kind doing the same thing are said once.
  const order = (id: string) => (reactions[id] === "fight" ? 0 : tw.world.entities[id]?.cast ? 1 : act.victims.some(v => v.id === id) ? 2 : 3);
  const said = Object.keys(reactions).sort((a, b) => order(a) - order(b));
  const groups: Array<{ name: string; r: TownReaction; ids: string[] }> = [];
  for (const id of said) {
    const e = tw.world.entities[id]!, r = reactions[id]!;
    const same = groups.find(g => g.name === e.name && g.r === r && !e.cast);
    if (same) same.ids.push(id); else groups.push({ name: e.name, r, ids: [id] });
  }
  for (const g of groups.slice(0, 5)) {
    const e = tw.world.entities[g.ids[0]!]!;
    if (e.cast === "kell") { lines.push(`Kell: "Investigator! ${hurtPerson ? "That is assault, and I am the watch." : "That was somebody's."}" She writes it down.`); continue; }
    if (/goose/i.test(e.name) && g.r === "unmoved") { lines.push("The goose looks at you as if you owe it money. You may, now."); continue; }
    const many = g.ids.length > 1;
    const who = many ? `${g.ids.length === 2 ? "Both" : `All ${g.ids.length}`} ${e.name.replace(/^(a|an|the)\s+/i, "")}s` : capital(e.name);
    lines.push(`${who} ${(many ? SAY_MANY : SAYS)[g.r]}${g.r === "fight" && !act.hidden ? `, and mean${many ? "" : "s"} it` : ""}.`);
  }
  if (groups.length > 5) lines.push(`Everyone else about gets out of the way.`);
  if (act.hidden && near.some(e => e.stats?.statblock === "guard")) lines.push("Nobody saw who did it. The guards look about them, very sternly.");
  return { reactions, lines, fighters };
}

/** A fight on the map: the player, and whoever came at them, where they stand. */
function townFight(c: Ctx, tw: TownWorld, fighters: Entity[]): CombatSetup {
  const used = new Set<string>();
  const clean = (name: string) => { const base = name.toLowerCase().replace(/^(a|an|the)\s+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "someone"; let id = base; for (let n = 2; used.has(id); n++) id = `${base}-${n}`; used.add(id); return id; };
  const combatants: CombatantSetup[] = [{ id: "player", name: c.session.player.name, side: "player", role: "player", at: { ...c.ex.at } }];
  for (const f of fighters) {
    const statblock = f.stats?.statblock ?? "commoner";
    combatants.push({ id: clean(f.name), castId: f.id, name: f.name.replace(/^a /, "a "), side: "enemy", role: statblock === "guard" ? "bruiser" : "brawler", statblock, ...(statblock === "guard" ? { weapon: "spear" } : {}), at: tileOfFeet(f.at!) });
  }
  return { map: tw.map, combatants, seed: (c.session.seed + 7 * (c.session.rollCount + 1)) >>> 0 };
}

// ---------------------------------------------------------------------------------------------
// The story's people: what's done to them is a scene's.

/** The player's words for an act, as a scene's first turn: "(I cast Charm Person on Sergeant Kell)". */
function actText(entry: Entry, name: string, weapon?: string): string {
  const who = name.replace(/^the /, "the ");
  switch (entry.key) {
    case "attack": return `(I attack ${who}${weapon ? ` with my ${weapon.toLowerCase()}` : ""})`;
    case "throw": return `(I throw a stone at ${who})`;
    case "shove": return `(I shove ${who} over)`;
    case "grapple": return `(I grab hold of ${who})`;
  }
  if (entry.spell) return `(I cast ${entry.name} ${entry.effect === "harm" ? "at" : "on"} ${who})`;
  return `(I use ${entry.name} on ${who})`;
}

function mechanicFor(entry: Entry, target: string): Mechanic {
  if (entry.spell) return { kind: "cast", spell: entry.spell.id, targets: [target] };
  if (entry.key === "attack") return { kind: "attack", target };
  if (entry.key === "throw") return { kind: "attack", target, weapon: "improvised" };
  if (entry.key === "shove") return { kind: "wrestle", target, how: "prone" };
  if (entry.key === "grapple") return { kind: "wrestle", target, how: "grapple" };
  return { kind: "feature", feature: entry.key.replace(/^feature:/, ""), target };
}

/** Anything done to someone whose scene is waiting opens it: the act is its first turn, for the scene's rules to resolve. */
function storyAct(c: Ctx, entry: Entry, who: Story, at: Tile2): Done {
  const weapon = entry.key === "attack" ? catalogue(c.session)?.weapon?.name : undefined;
  const reach = feetBetween(c.ex.at, at);
  return {
    text: reach > FEET ? `You turn to ${who.name}.` : `You go over to ${who.name}.`,
    scene: true,
    act: { text: actText(entry, who.name, weapon), mechanic: mechanicFor(entry, who.castId) },
  };
}

/** What would hurt Kell, or work on her mind, is a talk's to play (she has a say in it). */
function talkAct(c: Ctx, tw: TownWorld, entry: Entry, who: { name: string; entity: Entity }): Done {
  const w = whereabouts(c.ex);
  const weapon = entry.key === "attack" ? catalogue(c.session)?.weapon?.name : undefined;
  void tw;
  return {
    text: `You turn to ${who.name}.`,
    talk: { with: who.entity.cast!, where: `${w.place === w.map ? w.map : `${w.place} in ${w.map}`}, ${w.time.replace("-", " ")}` },
    act: { text: actText(entry, who.name, weapon), mechanic: mechanicFor(entry, who.entity.cast!) },
  };
}

// ---------------------------------------------------------------------------------------------
// Resting, hiding, leaping.

/** A rest on the map: the rules' rest (and a wizard's Arcane Recovery with it); once each before the clock moves on. */
async function restNow(c: Ctx, kind: "short" | "long", recover: boolean): Promise<Done> {
  const { session, ex } = c;
  const r = c.keep.rested && c.keep.rested.time === ex.story.time ? c.keep.rested : { time: ex.story.time };
  const out = await rest(session, kind);
  const more = recover ? await arcaneRecovery(session) : undefined;
  c.keep.rested = { ...r, [kind]: true, ...(kind === "long" ? { short: true } : {}) };
  // What's burning in the town has burned out by the time you've rested.
  const tw = townWorld(ex);
  let burnt = 0;
  for (const e of Object.values(tw.world.entities)) if (e.states.includes("burning")) { e.states = [...e.states.filter(s => s !== "burning"), ...(e.kind === "surface" ? [] : ["destroyed", "burnt"])]; burnt++; }
  if (burnt) keepTown(ex, tw);
  const where = whereabouts(ex);
  const how = kind === "short"
    ? `You find a step out of the way in ${where.place} and sit an hour while Caerwyn goes past without you.`
    : `You find somewhere to sleep the clock round (the story waits for you; Caerwyn doesn't, but it doesn't mind).`;
  return { text: [...out.lines, ...(more?.lines ?? []), how, ...(burnt ? ["The fires have burned themselves out."] : [])].join("\n"), lines: out.lines };
}

/** A Stealth check against whoever's watching (the sharpest eyes about), and out of sight if it's made. */
async function hideNow(c: Ctx, tw: TownWorld): Promise<Done> {
  const { session, ex } = c;
  const watchers = Object.values(tw.world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !e.player && !e.states.some(s => ["gone", "down", "unconscious"].includes(s)) && e.at && steps(tileOfFeet(e.at), ex.at) <= 8);
  const passive = (e: Entity) => (e.stats?.statblock === "guard" ? 12 : e.cast ? 13 : 10);
  const dc = Math.max(10, ...watchers.map(passive));
  const sharpest = watchers.sort((a, b) => passive(b) - passive(a))[0];
  const roll = await skillCheck(session, "stealth", dc);
  ex.hidden = roll.success || undefined;
  if (!ex.hidden) delete ex.hidden;
  const line = describeRoll(roll, sharpest ? `to slip out of sight of ${the(sharpest.name)}` : "to slip out of sight");
  const said = roll.success
    ? (watchers.length ? "You're out of sight. Nobody about is looking your way, which in Caerwyn on Assembly eve is an achievement." : "Out of sight, with nobody about to be out of sight of. It's good practice.")
    : sharpest ? `${capital(the(sharpest.name))} is looking right at you, with interest.` : "There's nowhere much to hide here: anyone who came along would see you.";
  return { text: `${line}\n${said}`, lines: [line] };
}

/** A leap to a tile: the rules' jump (within reach it simply happens; farther takes Athletics), and where you land. */
async function leapNow(c: Ctx, tw: TownWorld, at: Tile2): Promise<Done> {
  const { session, ex } = c;
  const actors = tw.mapActors;
  const feet = feetBetween(ex.at, at);
  const dir = { x: Math.sign(at.x - ex.at.x), y: Math.sign(at.y - ex.at.y) };
  const way = overleap(tw.map, actors, ex.at, at);
  const out = await jump(session, { feet, runUp: runUp(tw.map, actors, ex.at, at, ex.story), drop: 0 });
  const over = way.low.length ? ` over ${way.low.slice(0, 2).join(" and ")}` : "";
  const lines = [...out.lines];
  if (out.made) {
    ex.at = { ...at };
    ex.facing = dir;
    lines.push(`You land neatly${over ? `, having gone${over}` : ""}.`);
    const opened = stepsInto(c, at);
    if (opened) return { text: [...lines, opened.text].join("\n"), scene: true, lines: out.lines };
    return { text: lines.join("\n"), lines: out.lines };
  }
  // Short: the river, if that's what was under you, or the last place you could have come down.
  const path = line(ex.at, at).slice(1, -1);
  const short = [...path].reverse().find(p => steps(p, ex.at) * FEET <= out.reach && standable(tw.map, actors, p, ex.story));
  if (way.water && !short) {
    lines.push("You come down in the river. It's cold, fast and smells of the whole town; you haul yourself out on the bank, soaked.");
    return { text: lines.join("\n"), lines: out.lines };
  }
  const got = short ? feetBetween(ex.at, short) : 0;
  if (short) { ex.at = { ...short }; ex.facing = dir; }
  lines.push(short ? `You come down short, ${got} ft on.` : "You think better of it at the last moment, which is its own kind of leap.");
  return { text: lines.join("\n"), lines: out.lines };
}

export { direction, rangeFeet };
