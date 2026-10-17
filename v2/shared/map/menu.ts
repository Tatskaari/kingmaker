// Copied from the prototype's src/game/menu.ts at 44c6d4a, lines 1-474 (the map's geometry, aiming, the menu and its QA text) and 891-896 (mapWhy), with src/game/combat/grid.ts:123-137 (line): the half of the action menu both sides run, on the rows they share. Imports from v2/shared. Its context is MenuCtx (the ExploreState made from rows, the sheet's catalogue, the explore row's keep), not the game and the session, so it loads no rules code: the catalogue is the sheet's (its `you` is what youHurt and cureFor asked the engine), and areaPlacement is shared/rules/aim.ts's. The types are K's (v2/docs/town-design.md §2: Rested, Spotted, Lifted, Keep, MenuCtx, Story, Aimed, MenuItem, MenuView, AimAt, AimView), the same as the prototype's; Done, and doing it, are shared/map/menu-acts.ts's. aimedAt, aimables, areaReach, restedNow, overleap, runUp and the words (FEET, the, capital, LATER, OPENS, SOCIAL_WHY) are exported for menu-acts.ts. LATER names the scene by its place's lead (the client has no scene titles); ES2021: listing's .at(-1) is the last index. isMenuAct is K's, the prototype's own.
import { areaPlacement, entryLabel, type Aim, type Catalogue, type Entry, type Section } from "../rules/aim.ts";
import { caughtIn, inArea, positionOf, type Entity } from "../world/scene-world.ts";
import { doorState, tileName, type ExploreState } from "./explore.ts";
import { PLACES } from "./places.ts";
import { isLive } from "./presence.ts";
import { inBounds, isStructure, regionAt, steps, tileAt } from "./tiles.ts";
import { companion, entityAt, feetOf, tileOfFeet, townWorld, type TownWorld, type Waiting } from "./town-world.ts";
import type { MapActor, StoryState, Tile2, TileMap } from "./types.ts";

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
 *   lift@x,y                                                a pocket picked beside someone: Sleight of Hand, DC 10 asleep, 15 awake
 *   rest_short, rest_short_recover, rest_long               an hour (and Arcane Recovery), a night: once each before the clock moves on
 *   use_<item>                                              something carried that's used up (a potion)
 *
 * It's all resolved by the rules on the town's world (src/game/town-world.ts; in a zoo wing, the
 * wing's own): a Fireball at a door breaks it and opens the way, and it stays broken. Violence
 * draws the people about (some run, some cower, the guards come on), and if anyone fights, the
 * fight is on the map. Anything done to someone whose scene is waiting opens that scene, the act
 * its first turn (the scene's rules resolve it, slot and all); what would work on Kell's mind, or
 * hurt her, opens a talk with her the same way. Charming a passer-by isn't a thing the map can play.
 */

/** When the player last rested, by the story's clock: once each before the clock moves on (the explore row's `rested`). */
export interface Rested { time: StoryState["time"]; short?: boolean; long?: boolean }

/** Where the player was seen trying to hide, and by whom (by the story's clock): not again from there (`spotted`). */
export interface Spotted { time: StoryState["time"]; at: Tile2; by: string }

/** Whose pockets the player has tried, by the story's clock (`lifted`). */
export interface Lifted { time: StoryState["time"]; who: string[] }

/** What the explorer keeps between acts, for the menu (the prototype's Ctx.keep): the explore row's. */
export interface Keep { rested?: Rested; spotted?: Spotted; lifted?: Lifted }

/**
 * What the menu reads (the prototype's Ctx, less the game and the session): the ExploreState made
 * from rows (shared/map/rows.ts exploreOf, the town's changes in its overlay), the rules' catalogue
 * (the sheet row's `actions`; undefined without a rules character, or before the menu), and the keep.
 */
export interface MenuCtx { ex: ExploreState; catalogue: Catalogue | undefined; keep: Keep }

/** Someone or something of a place whose scene is still to come (Kell inside the granary gate, the gate itself): the scene's to play. `id` is theirs in the scene's world. */
export type Story = { kind: "waiting"; at: Tile2; name: string } & Pick<Waiting, "id" | "sceneId" | "person" | "live">;

/** Who or what is at a tile, as the menu aims at it. */
export type Aimed =
  | { kind: "self"; at: Tile2; name: "you" }
  | { kind: "being"; at: Tile2; name: string; entity: Entity; companion: boolean }
  | { kind: "thing"; at: Tile2; name: string; entity: Entity }
  | Story;

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
  /** More on how it goes, for the hint line: a leap's "over a cabbage cart", "Athletics, DC 12". */
  note?: string;
  /** The tiles an area covers, aimed here. */
  area?: Tile2[];
  /** Who and what that area catches (you included). */
  caught?: string[];
  feet: number;
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
  /**
   * Where the aim starts: the nearest target, and for an area the nearest whose area leaves you out
   * (a Fireball's nearest target is often the elm beside you); undefined with nothing in reach.
   */
  start?: Tile2;
}


export const FEET = 5;
export const feetBetween = (a: Tile2, b: Tile2) => steps(a, b) * FEET;
export const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
export const the = (name: string) => (/^(a|an|the)\s/i.test(name) || /^[A-Z]/.test(name) ? name.replace(/^(A|An)\s/, m => m.toLowerCase()) : `the ${name}`);

/** Rested this time of day already. */
export function restedNow(c: MenuCtx): { short?: boolean; long?: boolean } {
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
export function overleap(map: TileMap, actors: MapActor[], a: Tile2, b: Tile2): { tall?: string; low: string[]; water: boolean } {
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
export function runUp(map: TileMap, actors: MapActor[], from: Tile2, to: Tile2, story: StoryState): boolean {
  const dir = { x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) };
  return [1, 2].every(d => standable(map, actors, { x: from.x - dir.x * d, y: from.y - dir.y * d }, story));
}

/** States that say someone's hurt (the rules keep them on the town's people). */
const HURT = ["hurt", "badly hurt", "down", "unconscious"];

/** Is the player hurt, as the rules heal (below the engine's own maximum: shared/rules/actions.ts)? v2: the catalogue says (Catalogue.you). */
function youHurt(c: MenuCtx): boolean {
  return !!c.catalogue?.you.hurt;
}

const overhead = (states: string[]) => states.some(s => s === "hanging" || s === "overhead");
export const story = (w: Waiting, at: Tile2): Story => ({ kind: "waiting", id: w.id, sceneId: w.sceneId, person: w.person, live: w.live, name: w.name, at });

/** Who or what is at a tile, as the menu aims at it: you, someone of a scene still to come, else whoever or whatever the town has there. */
export function aimedAt(tw: TownWorld, ex: ExploreState, at: Tile2): Aimed | undefined {
  if (at.x === ex.at.x && at.y === ex.at.y) return { kind: "self", at, name: "you" };
  // The scene's own: whoever waits there, else what's there (not what hangs overhead, unless that's all).
  const theirs = [...tw.waiting.values()].filter(w => w.at.x === at.x && w.at.y === at.y);
  const w = theirs.find(x => x.person) ?? theirs.find(x => !overhead(x.states)) ?? theirs[0];
  if (w) return story(w, at);
  const e = entityAt(tw, at, { people: true, things: true });
  if (!e) return undefined;
  if (e.kind === "person" || e.kind === "creature") return { kind: "being", at, name: e.name, entity: e, companion: !!companion(tw, e.id) };
  return { kind: "thing", at, name: e.name, entity: e };
}

/** Everyone and everything the menu could aim at from here, nearest first. */
export function aimables(tw: TownWorld, ex: ExploreState): Aimed[] {
  const seen = new Set<string>();
  const out: Aimed[] = [{ kind: "self", at: { ...ex.at }, name: "you" }];
  for (const w of tw.waiting.values()) {
    const key = `${w.at.x},${w.at.y}`;
    if (seen.has(key) || (!w.person && overhead(w.states)) || steps(w.at, ex.at) > 32) continue;
    const a = aimedAt(tw, ex, w.at);
    if (!a || a.kind === "self") continue;
    seen.add(key);
    out.push(a);
  }
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

export const SOCIAL_WHY = "only someone the story knows (Kell, or someone whose scene is waiting): a passer-by has nothing to be talked round to";

/** "a, b and c". */
const listing = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** What an act at someone or something of a waiting scene says it does. */
export const OPENS = (w: Story) => (w.person ? " (their scene opens)" : " (the scene opens)");

/** Why not, at what a scene still to come keeps for later (a place that isn't the lead yet). */
export const LATER = (w: Story) => `${the(w.name)} belongs to a scene that's for later in the story (${PLACES[w.sceneId]?.lead.label ?? w.sceneId})`;

/**
 * Can an entry be aimed at a tile from where the player stands, and what would it do there?
 * `area`: work out what an area covers and catches (what the aim on screen shows; a list of targets needn't).
 */
export function checkAim(c: MenuCtx, tw: TownWorld, entry: Entry, at: Tile2, options: { area?: boolean } = {}): AimAt {
  const ex = c.ex, map = tw.map;
  const actors = tw.mapActors;
  const feet = feetBetween(ex.at, at);
  const name = entryLabel(entry);
  const no = (why: string, label = name, more: Partial<AimAt> = {}): AimAt => ({ ok: false, why, label, feet, ...more });
  if (entry.why) return no(entry.why);
  const aim = entry.aim;
  if (aim.kind === "none" || aim.kind === "self") return { ok: true, id: entry.act, label: name, feet: 0 };
  if (!inBounds(map, at)) return no("off the map");
  if (aim.kind === "area") {
    const fromSelf = aim.fromSelf;
    if (fromSelf && feet === 0) return no("which way? Point it away from you");
    if (!fromSelf && feet > aim.range) return no(`out of reach: ${feet} ft (it reaches ${aim.range} ft)`);
    if (!fromSelf && !clearLine(map, actors, ex.at, at)) return no("no clear line to there");
    const where = aimedAt(tw, ex, at);
    const there = where && where.kind !== "self" ? the(where.name) : tileName(ex, at);
    const reach = areaReach(tw, ex, aim, at, where, options.area !== false);
    const shown = reach.tiles ? { area: reach.tiles, caught: reach.caught! } : {};
    // What a scene still to come holds is the scene's: an area that reaches it is the scene's to play,
    // so it's aimed at one of them (the scene opens with it), or not at all.
    if (where?.kind === "waiting" && !where.live) return no(LATER(where), name, shown);
    const later = reach.scene.find(w => !w.live);
    if (later) return no(LATER(story(later, later.at)), name, shown);
    if (reach.scene.length && where?.kind !== "waiting") {
      const names = [...reach.scene].sort((a, b) => Number(b.person) - Number(a.person)).filter((w, i, all) => all.findIndex(x => x.name === w.name) === i).map(w => the(w.name));
      return no(`it would catch ${listing(names.slice(0, 2))}${names.length > 2 ? " and more" : ""}: aim it at ${reach.scene.length > 1 ? "one of them" : names[0]}, and their scene opens`, name, shown);
    }
    const opens = where?.kind === "waiting" ? OPENS(where) : "";
    return { ok: true, id: `${entry.act}@${at.x},${at.y}`, label: `${name} ${fromSelf ? "towards" : "on"} ${there}${opens}`, target: `${fromSelf ? "towards " : ""}${there}${opens}`, ...shown, feet };
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
      const over = way.low.length ? `over ${way.low.slice(0, 2).join(" and ")}` : "";
      const note = [over, hard.trim().replace(/^\(|\)$/g, "")].filter(Boolean).join(", ");
      return { ok: true, id: `${entry.act}@${at.x},${at.y}`, label: `Leap ${feet} ft${over ? ` ${over}` : ""}${hard}`, target: tileName(ex, at), ...(note ? { note } : {}), feet };
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
    if (entry.cures && !cureFor(c, entry)) return no("nothing to cure", `${name} on yourself`);
    return { ok: true, id: `${entry.act}_self`, label: `${name} on yourself`, target: "yourself", feet: 0 };
  }
  const thing = who.kind === "thing" || (who.kind === "waiting" && !who.person);
  if (aim.kind === "creature" && thing) return no(`not on ${the(who.name)}`);
  if (who.kind === "waiting" && !who.live) return no(LATER(who));
  if (who.kind === "thing" && who.entity.states.includes("destroyed")) return no(`${the(who.name)} is past it`);
  if (entry.effect === "social" && who.kind === "being" && !who.companion) return no(SOCIAL_WHY);
  // Healing someone who isn't hurt does nothing: the town's people are hurt when the rules hurt them,
  // and whoever waits for their scene is as the scene starts them (fine). Kell walking with you is a talk's.
  if (entry.heals && who.kind === "being" && !who.companion && !who.entity.states.some(s => HURT.includes(s))) return no(`${capital(the(who.name))} isn't hurt`);
  if (entry.heals && who.kind === "waiting") return no(`${capital(the(who.name))} isn't hurt`);
  if (entry.cures && (who.kind === "being" ? !who.companion && !who.entity.states.some(s => CURES.includes(s)) : who.kind === "waiting")) return no(`${the(who.name)} has nothing to cure`);
  const range = Math.max(aim.range, FEET);
  if (feet > range) return no(`out of reach: ${feet} ft (it reaches ${range} ft)`);
  if (feet > FEET && !clearLine(map, actors, ex.at, at)) return no("no clear line to there");
  const verb = entry.effect === "harm" ? "at" : "on";
  const opens = who.kind === "waiting" ? OPENS(who) : "";
  return { ok: true, id: `${entry.act}@${at.x},${at.y}`, label: `${name} ${verb} ${the(who.name)}${opens}`, target: `${the(who.name)}${opens}`, feet };
}

/**
 * What an area aimed at a tile reaches, as the rules will have it: castSpell's own placement (from
 * you towards the aim, centred where the aimed thing stands) and its own test of what's inside
 * (caughtIn, in feet; walls don't stop it). `tiles`: the tiles whose middles it covers, and who and
 * what it catches by name, you first; `scene`: what of a scene still to come it reaches.
 */
export function areaReach(tw: TownWorld, ex: ExploreState, aim: Extract<Aim, { kind: "area" }>, at: Tile2, where: Aimed | undefined, tiles: boolean): { tiles?: Tile2[]; caught?: string[]; scene: Waiting[] } {
  const target = where && (where.kind === "being" || where.kind === "thing") ? positionOf(tw.world, where.entity.id) : feetOf(at);
  const { origin, centre } = areaPlacement(tw.world, aim, aim.fromSelf, target);
  const inside = (p: { x: number; y: number }) => inArea(aim.shape, aim.size, origin, centre, p);
  const scene = [...tw.waiting.values()].filter(w => inside(feetOf(w.at)));
  if (!tiles) return { scene };
  const out: Tile2[] = [];
  const r = Math.ceil(aim.size / FEET) + 1;
  const a = tileOfFeet(origin), b = tileOfFeet(centre);
  for (let y = Math.max(0, Math.min(a.y, b.y) - r); y <= Math.min(tw.map.height - 1, Math.max(a.y, b.y) + r); y++) {
    for (let x = Math.max(0, Math.min(a.x, b.x) - r); x <= Math.min(tw.map.width - 1, Math.max(a.x, b.x) + r); x++) {
      const t = { x, y };
      if (tileAt(tw.map, t).terrain !== "wall" && inside(feetOf(t))) out.push(t);
    }
  }
  // Whoever and whatever it catches, as castSpell counts them (a cone or a cube from you leaves you out).
  const caught = caughtIn(tw.world, aim.shape, aim.size, origin, centre).filter(e => e.kind !== "surface" && !(e.player && aim.fromSelf));
  const rank = (e: Entity) => (e.player ? 0 : e.kind === "person" || e.kind === "creature" ? 1 : 2);
  const names = [...caught.sort((x, y) => rank(x) - rank(y)).map(e => (e.player ? "you" : e.name)), ...scene.map(w => w.name)];
  return { tiles: out, caught: [...new Set(names)], scene };
}

/** What a cure ends that the town's people can have (the rules keep them on them). */
const CURES = ["poisoned", "blinded", "deafened", "paralyzed", "paralysed"];

/** Has the player something this cure ends? v2: the conditions the catalogue says they have (Catalogue.you). */
function cureFor(c: MenuCtx, entry: Entry): boolean {
  const have = c.catalogue?.you.conditions ?? [];
  return (entry.cures ?? []).some(x => have.includes(x));
}

/** What an entry can be aimed at from here: its reach, and the targets in it. */
export function aimView(c: MenuCtx, tw: TownWorld, entry: Entry): AimView {
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
  const clear = entry.aim.kind === "area" ? targets.find(t => !(checkAim(c, tw, entry, t.at).caught ?? []).includes("you")) : undefined;
  const start = clear ?? targets[0];
  return { entry, ring, targets, self, selfReady: self && checkAim(c, tw, entry, ex.at).ok, ...(start ? { start: { ...start.at } } : {}) };
}

export const reachOf = (aim: Aim) => (aim.kind === "none" || aim.kind === "self" ? 0 : aim.range);

// ---------------------------------------------------------------------------------------------
// The menu.

/** The menu now: what the player can do, by kind, and what's in reach for each. `at`: aimed at a tile already. */
export function menuOf(c: MenuCtx, at?: Tile2): MenuView | undefined {
  const cat = c.catalogue;
  if (!cat) return undefined;
  const tw = townWorld(c.ex);
  const where = at ? aimedAt(tw, c.ex, at) : undefined;
  const sections = cat.sections.map(s => ({ ...s, entries: s.entries.map((e): MenuItem => {
    if (e.why) return e;
    const not = mapWhy(c, e);
    if (not) return { ...e, why: not };
    if (e.aim.kind === "none" || e.aim.kind === "self") return { ...e, id: e.act };
    if (at) {
      // Aimed already: at what was right-clicked. An area is aimed there on the map first, so you see
      // what it covers and who it catches (you, perhaps) before it goes off.
      const check = checkAim(c, tw, e, at, { area: false });
      if (!check.ok) return { ...e, why: check.why ?? "not there" };
      return e.aim.kind === "area" ? { ...e, aiming: true } : { ...e, id: check.id! };
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
        : e.cures ? `nobody in reach has anything it cures${view.self ? " (you included)" : ""}`
        : people ? SOCIAL_WHY : `${e.aim.kind === "creature" ? "nobody" : "nobody and nothing"} in reach (${reach} ft)`;
      return { ...e, why };
    }
    return { ...e, aiming: true };
  }) }));
  return { title: at ? `Do something: ${where && where.kind !== "self" ? the(where.name) : tileName(c.ex, at)}` : "What will you do?", sections, ...(at ? { at } : {}) };
}

/** The menu as a QA observation says it: each kind, what's in it, the ids to act with (or why not). */
export function menuText(c: MenuCtx): string {
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

/** Why the map won't do an entry now, whatever the rules say: you've been seen trying to hide here. */
export function mapWhy(c: MenuCtx, entry: Entry): string | undefined {
  const s = c.keep.spotted;
  if (entry.key === "hide" && s && s.time === c.ex.story.time && s.at.x === c.ex.at.x && s.at.y === c.ex.at.y) return `${the(s.by)} saw you try: somewhere else, perhaps`;
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// The menu's ids.

export const STEM = /^(cast|feature)_(.+?)(?:_(self)|@(\d+),(\d+))?$/;
export const BLOW = /^(attack|throw|shove|grapple|jump|lift)@(\d+),(\d+)$/;

/** Is this one of the menu's action ids? (menu.ts:479-483) */
export const isMenuAct = (id: string) => STEM.test(id) || BLOW.test(id) || /^(hide|rest_short|rest_short_recover|rest_long)$/.test(id) || /^use_.+$/.test(id);

/** The tiles on a straight line between two, both ends included (src/game/combat/grid.ts's Bresenham line). */
export function line(a: Tile2, b: Tile2): Tile2[] {
  const out: Tile2[] = [];
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - a.x), dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 500; guard++) {
    out.push({ x, y });
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return out;
}
