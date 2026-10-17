// Copied from the prototype's src/game/menu.ts at 44c6d4a, lines 477-928 but isMenuAct and mapWhy (shared/map/menu.ts's): doing what the action menu offers, the simulation's (the client never loads it). The usual edits (world-bridge-design §2): the host's Rules and the player's RulesSession are handed in (ActCtx), each rules act takes the Rules first and none awaits, skillCheck is rollFor; the companions' cards are handed in, not looked up in SCENES; townFight makes a TownFight (its map by key); a landing in the lead's place reads the story's lead. A refusal is thrown (NotDone: its code, town-design §3.2, and the prototype's own sentence), where the prototype said it, so a refused act writes nothing; an id that names nothing on the menu is town.ts's Unavailable. liftNow's pennies go into session.carried as the prototype's did, which the simulation moves into the player's pockets through the world's inventory. ES2021: townFight's .at(-1) is the last index.
import { describeRoll } from "../dice.ts";
import type { RefusalCode } from "../protocol/refusals.ts";
import { arcaneRecovery, attack as rulesAttack, castSpell, jump, rest, useFeature, useItem, wrestle, type RulesOutcome } from "../rules/acts.ts";
import { catalogue } from "../rules/actions.ts";
import type { Catalogue, Entry } from "../rules/aim.ts";
import { rollFor } from "../rules/character.ts";
import type { Mechanic, Rules, RulesSession } from "../rules/types.ts";
import type { Character } from "../scene/types.ts";
import type { Entity } from "../world/scene-world.ts";
import { tileName, whereabouts, type ExploreState } from "./explore.ts";
import { getMap } from "./maps.ts";
import { aimedAt, BLOW, capital, checkAim, FEET, feetBetween, line, mapWhy, overleap, restedNow, runUp, standable, STEM, the, type Aimed, type MenuCtx, type Story } from "./menu.ts";
import { isLive, regionOpen } from "./presence.ts";
import { direction, inRect, steps, type PlaceRegion } from "./tiles.ts";
import { feetOf, keepTown, tileOfFeet, townWorld, type TownWorld } from "./town-world.ts";
import { Unavailable } from "./town.ts";
import type { CombatantSetup, Tile2, TownFight } from "./types.ts";

/**
 * Doing what the action menu offers on the map (town-design §3.2-3.4): the rules on the town's
 * world (shared/map/town-world.ts), then the town's people reacting by their table; an act aimed at
 * someone whose scene is waiting (or that would hurt Kell, or work on her mind) opens that scene or
 * a talk instead, the act its first turn; resting, hiding, lifting a purse, leaping. The simulation
 * makes ActCtx from the rows, runs one of these in a move's transaction, pinned, and writes back what
 * it changed: the ExploreState (where the player is, hidden or not), the keep, the town's changes
 * (ex.overlay.town), the character and the dice.
 */

/**
 * What doing something on the map needs beyond the menu's own context: the rules (the host's engine
 * and the player's rules session, its world swapped for the town's while an act runs), the cards of
 * whoever walks with the player (the rules take their stats from them: the scene they came from's
 * cast), and the story's lead (a landing in its place opens it).
 */
export interface ActCtx extends MenuCtx { rules: Rules; session: RulesSession; companions: Character[]; lead?: string }

/** What doing something on the map came to (the prototype's menu.ts Done), for the simulation to write. */
export interface Done {
  text: string;
  /** The lead scene opens (the act is its first turn). */
  scene?: boolean;
  /** A talk with someone walking with the player opens (the act is its first turn). */
  talk?: { with: string; where: string };
  /** The player's first turn in the scene or talk that opens: what they do (in brackets), and what the rules resolve (the decide request's `forced`). */
  act?: { text: string; mechanic: Mechanic };
  /** A fight breaks out on the map: recorded on the explore row for V12. */
  fight?: TownFight;
  /** The rules' lines (for the look layer's effects). */
  lines?: string[];
}

/** A menu act the map won't do (town-design §3.2): its refusal's code, and the prototype's sentence for it, "(<what>: <why not>.)". Thrown, so nothing it changed is kept. */
export class NotDone extends Error {
  readonly code: RefusalCode;
  readonly text: string;
  constructor(code: RefusalCode, text: string) {
    super(text);
    this.code = code;
    this.text = text;
  }
}

/**
 * Why not, as a refusal's code (town-design §3.2's table), from the prototype's own words for it:
 * no clear line or way; past its reach, or nothing there to aim at; a leap past its most, or nowhere
 * to land; no slot; a feature's or an item's uses spent; a place shut at this hour (`shut`: the tile
 * aimed at is in one); anything else, not now.
 */
export function codeOf(why: string, shut = false): RefusalCode {
  if (/no clear line|can't see a clear way/.test(why)) return "no_line";
  if (shut && /^(nobody|nowhere to land|not on )/.test(why)) return "shut";
  if (/^(out of reach|nobody there|nobody and nothing there|not on |off the map|nobody (and nothing )?in reach)|is past it$/.test(why)) return "out_of_reach";
  if (/^(too far|nowhere to land)|in the way: no leap clears that/.test(why)) return "too_far";
  if (/slots left/.test(why)) return "no_slot";
  if (/no uses left|^used today/.test(why)) return "not_ready";
  return "not_now";
}

/** Is a tile in a place shut at this hour (the Drowned Rat's door before dusk, the palace gate)? */
function shutAt(ex: ExploreState, at: Tile2): boolean {
  const map = getMap(ex.map);
  const gate = (map.regions as PlaceRegion[]).filter(r => r.shut && inRect(r.rect, at)).sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
  return !!gate && !regionOpen(ex.story, gate);
}

/** The catalogue the act goes by: the one the simulation made for it (with the rests taken at this time of day), else made now. */
const catalogueOf = (c: ActCtx): Catalogue | undefined => c.catalogue ?? catalogue(c.rules, c.session, { rested: restedNow(c) });

/** The rules' work on the town's world: the session's world for as long as it takes, then back as it was. */
function onTown<T>(session: RulesSession, tw: TownWorld, run: () => T): T {
  const had = session.world;
  session.world = tw.world;
  try { return run(); }
  finally { if (had) session.world = had; else delete session.world; }
}

/** The cards of whoever walks with the player (the rules take their stats from them), for the rules' `cast`. v2: handed in (ActCtx.companions: their cards in the scenes they came from). */
function companions(c: ActCtx, tw: TownWorld): Character[] {
  return Object.values(tw.world.entities).filter(e => e.cast).map(e => c.companions.find(card => card.id === e.cast)).filter((card): card is Character => !!card);
}

/**
 * An act aimed at one of the story's people (someone whose scene is waiting; Kell, for what would
 * hurt her or work on her mind): the scene or the talk it opens, at once (no rules on the map: the
 * scene's resolve it, as its first turn). Undefined for anything else.
 */
export function storyRoute(c: ActCtx, id: string): Done | undefined {
  const m = STEM.exec(id) ?? BLOW.exec(id);
  const x = m?.[m.length - 2], y = m?.[m.length - 1];
  if (!m || x === undefined || y === undefined || !c.session.rules) return undefined;
  const at = { x: Number(x), y: Number(y) };
  const stem = id.replace(/@\d+,\d+$/, "");
  const entry = catalogueOf(c)?.entries.find(e => e.act === stem && e.act);
  if (!entry || entry.why || entry.key === "jump") return undefined;
  const tw = townWorld(c.ex);
  const target = aimedAt(tw, c.ex, at);
  if (target?.kind !== "waiting" && !(target?.kind === "being" && target.companion && (entry.effect === "harm" || entry.effect === "social"))) return undefined;
  if (!checkAim(c, tw, entry, at).ok) return undefined;
  delete c.ex.hidden;
  return target.kind === "waiting" ? storyAct(c, entry, target, at) : talkAct(c, tw, entry, target);
}

/** Do one of the menu's acts. */
export function doMenuAct(c: ActCtx, id: string): Done {
  const { session, ex } = c;
  if (!session.rules) throw new NotDone("not_now", "(No rules character: nothing to do it with.)");
  const cat = catalogueOf(c)!;
  const tw = townWorld(ex);
  const at = (() => { const m = STEM.exec(id) ?? BLOW.exec(id); const x = m?.[m.length - 2], y = m?.[m.length - 1]; return x !== undefined && y !== undefined ? { x: Number(x), y: Number(y) } : undefined; })();
  const stem = id.replace(/@\d+,\d+$/, "").replace(/_self$/, "");
  const entry = cat.entries.find(e => e.act === stem && e.act);
  if (!entry) throw new Unavailable(`Unavailable action: ${id}. Observe again for what you can do.`);
  const why = entry.why ?? mapWhy(c, entry);
  if (why) throw new NotDone(codeOf(why), `(${entry.name}: not now, ${why}.)`);
  // Aimed: is it in reach from here, at something it can be aimed at?
  const self = id.endsWith("_self");
  if (at || self) {
    const check = checkAim(c, tw, entry, self ? ex.at : at!);
    if (!check.ok) throw new NotDone(codeOf(check.why ?? "", shutAt(ex, self ? ex.at : at!)), `(${check.label}: ${check.why}.)`);
  } else if (entry.aim.kind !== "none" && entry.aim.kind !== "self") {
    throw new NotDone("not_now", `(${entry.name} needs aiming: ${entry.act}@x,y${entry.aim.kind !== "area" && entry.aim.kind !== "tile" && entry.aim.self ? ` or ${entry.act}_self` : ""}.)`);
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
  if (entry.group === "items") return result(c, tw, useItem(c.rules, session, id.slice("use_".length)), { act: entry, wasHidden });
  const target = self ? undefined : at ? aimedAt(tw, ex, at) : undefined;
  // Someone the story keeps for a scene, or who walks with you, is the scene's or the talk's to play: say it there.
  if (entry.key === "lift") {
    if (target?.kind === "being" && !target.companion) return liftNow(c, target.entity);
    throw new NotDone("not_now", "(Lift a purse: not theirs, on the map: in a scene, say how you go about it.)");
  }
  // Someone the story is keeping for a scene: the act opens it.
  if (target?.kind === "waiting") return storyAct(c, entry, target, at!);
  if (target?.kind === "being" && target.companion && (entry.effect === "harm" || entry.effect === "social")) return talkAct(c, tw, entry, target);
  const cast = companions(c, tw);
  const targetId = target && target.kind !== "self" ? (target as { entity: Entity }).entity.id : undefined;
  let out: RulesOutcome;
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
    out = onTown(session, tw, () => castSpell(c.rules, session, cast, spell.id, targets, spell.ritual ? { ritual: true } : {}));
    if (marker) delete tw.world.entities[marker];
    const cast_ = !/^\(/.test(out.lines[0] ?? "");
    if (cast_) {
      // What the rules leave to the world here: a lock opened or shut, a light lit, a step through mist.
      if (spell.id === "knock" && target?.kind === "thing") out = { ...out, lines: [...out.lines, ...openLock(target.entity)] };
      if (spell.id === "arcane-lock" && target?.kind === "thing") out = { ...out, lines: [...out.lines, ...shutLock(target.entity)] };
      if ((spell.id === "light" || spell.id === "continual-flame") && target?.kind === "thing" && !target.entity.states.includes("lit")) { target.entity.states.push("lit"); out = { ...out, lines: [...out.lines, `${capital(target.name)} shines like a torch`] }; }
      if (entry.aim.kind === "tile" && at) {
        // Where you come out, said before you're there (after, it's only "you").
        const there = `${feetBetween(ex.at, at)} ft ${direction(ex.at, at)}, on ${tileName(ex, at)}`;
        ex.at = { ...at };
        out = { ...out, lines: [...out.lines, `You step out of the mist ${there}`] };
        const opened = stepsInto(c, at);
        if (opened) return { text: [...out.lines, opened.text].join("\n"), scene: true, lines: out.lines };
      }
    }
  } else if (entry.key.startsWith("feature:")) {
    out = onTown(session, tw, () => useFeature(c.rules, session, cast, entry.key.slice("feature:".length), self || !targetId ? "self" : targetId));
  } else if (entry.key === "attack" || entry.key === "throw") {
    out = onTown(session, tw, () => rulesAttack(c.rules, session, cast, targetId!, entry.key === "throw" ? "improvised" : undefined));
  } else if (entry.key === "shove" || entry.key === "grapple") {
    out = onTown(session, tw, () => wrestle(c.rules, session, cast, targetId!, entry.key === "shove" ? "prone" : "grapple"));
  } else throw new NotDone("not_now", `(${entry.name}: not something the map can do yet.)`);
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
function stepsInto(c: ActCtx, at: Tile2): { text: string } | undefined {
  const map = getMap(c.ex.map);
  const r = (map.regions as PlaceRegion[]).find(r => r.trigger === "enter" && r.sceneId && inRect(r.rect, at) && isLive(c.ex.story, r.sceneId));
  return r && r.sceneId === (c.lead ?? c.ex.story.lead) ? { text: `You ${(r.label ?? `go into ${r.name}`).charAt(0).toLowerCase()}${(r.label ?? `go into ${r.name}`).slice(1)}.` } : undefined;
}

/**
 * After the rules: keep what they did to the town, let the people about react to any violence,
 * and say it all (the rules' lines, then what the town did about it).
 */
function result(c: ActCtx, tw: TownWorld, out: RulesOutcome, how: { act: Entry; target?: Aimed; wasHidden?: boolean }): Done {
  const { ex } = c;
  const lines = [...out.lines];
  // Refused, or a help (a heal for someone who's down, a blessing): nobody's the worse for it, so nobody minds.
  const refused = /^\(/.test(lines[0] ?? "") || how.act.effect === "help";
  // A blow or a harmful spell at someone is violence whether or not it lands.
  const aimed = how.target?.kind === "being" && how.act.effect === "harm" ? [how.target.entity] : [];
  const hurt = refused ? [] : [...new Set([...aimed, ...victims(tw)])];
  const property = refused ? [] : wrecked(tw);
  let fight: TownFight | undefined;
  if (!refused && (hurt.length || (property.length && how.act.effect === "harm"))) {
    const react = townReactions(tw, ex, { victims: hurt, property, hidden: !!how.wasHidden, seed: c.session.seed + 131 * c.session.rollCount });
    lines.push(...react.lines);
    if (react.fighters.length) fight = townFight(c, tw, react.fighters);
  }
  keepTown(ex, tw);
  return { text: lines.join("\n"), lines: out.lines, ...(fight ? { fight } : {}) };
}

/** How hurt the rules have someone: brought round from down to hurt is better, not a new hurt. */
const SEVERITY: Record<string, number> = { hurt: 1, "badly hurt": 2, down: 3, unconscious: 3, dead: 4 };
const worst = (states: string[]) => Math.max(0, ...states.map(s => SEVERITY[s] ?? 0));

/** People the rules just hurt (or hurt worse), knocked down, set alight or took hold of. */
function victims(tw: TownWorld): Entity[] {
  return Object.values(tw.world.entities).filter(e => {
    if ((e.kind !== "person" && e.kind !== "creature") || e.player) return false;
    const was = statesBefore(tw, e);
    return worst(e.states) > worst(was) || e.states.some(s => ["burning", "prone", "grappled", "restrained", "frightened", "poisoned", "blinded", "paralyzed", "asleep"].includes(s) && !was.includes(s));
  });
}

const statesBefore = (tw: TownWorld, e: Entity) => (tw.before.get(e.id) ?? "").split("#")[0]!.split("|").filter(Boolean);

/** Things the rules just set burning or broke. */
function wrecked(tw: TownWorld): Entity[] {
  return Object.values(tw.world.entities).filter(e => (e.kind === "object" || e.kind === "item" || e.kind === "feature") && changedTo(tw, e, ["burning", "destroyed", "damaged"]));
}

function changedTo(tw: TownWorld, e: Entity, states: string[]): boolean {
  const was = statesBefore(tw, e);
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
/** A name that's more than one ("pigeons", "porters going down to the Rat"): no article, and its first word a plural. */
const plural = (name: string) => !/^(a|an|the)\s/i.test(name) && /^[a-z]+s\b/.test(name);

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
  // Who's the story's own (Kell walking with you): nobody in a zoo wing's world is (its waxworks are waxworks).
  const cast = (e: Entity | undefined) => (tw.roam ? undefined : e?.cast);
  for (const e of near) {
    const victim = act.victims.includes(e);
    const guard = e.stats?.statblock === "guard";
    let r: TownReaction;
    if (cast(e)) r = "intervene";
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
  const order = (id: string) => (reactions[id] === "fight" ? 0 : cast(tw.world.entities[id]) ? 1 : act.victims.some(v => v.id === id) ? 2 : 3);
  const said = Object.keys(reactions).sort((a, b) => order(a) - order(b));
  const groups: Array<{ name: string; r: TownReaction; ids: string[] }> = [];
  for (const id of said) {
    const e = tw.world.entities[id]!, r = reactions[id]!;
    const same = groups.find(g => g.name === e.name && g.r === r && !cast(e));
    if (same) same.ids.push(id); else groups.push({ name: e.name, r, ids: [id] });
  }
  for (const g of groups.slice(0, 5)) {
    const e = tw.world.entities[g.ids[0]!]!;
    // From hiding, nobody knows it was you: Kell wants to know who, and the guards look about them (below).
    if (cast(e) === "kell") { lines.push(act.hidden ? `Kell: "Who did that?" She looks about her, and writes it down.` : `Kell: "Investigator! ${hurtPerson ? "That is assault, and I am the watch." : "That was somebody's."}" She writes it down.`); continue; }
    if (/goose/i.test(e.name) && g.r === "unmoved") { lines.push("The goose looks at you as if you owe it money. You may, now."); continue; }
    if (act.hidden && g.r === "intervene") continue;
    // Pigeons run; a pair of guards are both of them.
    const base = e.name.replace(/^(a|an|the)\s+/i, "");
    const many = g.ids.length > 1 || plural(e.name);
    const who = g.ids.length > 1 ? `${g.ids.length === 2 ? "Both" : `All ${g.ids.length}`} ${plural(e.name) ? base : `${base}s`}` : capital(e.name);
    lines.push(`${who} ${(many ? SAY_MANY : SAYS)[g.r]}${g.r === "fight" && !act.hidden ? `, and mean${many ? "" : "s"} it` : ""}.`);
  }
  if (groups.length > 5) lines.push(`Everyone else about gets out of the way.`);
  if (act.hidden && near.some(e => e.stats?.statblock === "guard")) lines.push("Nobody saw who did it. The guards look about them, very sternly.");
  return { reactions, lines, fighters };
}

/** A fight on the map: the player, and whoever came at them, where they stand. */
function townFight(c: ActCtx, tw: TownWorld, fighters: Entity[]): TownFight {
  const used = new Set<string>();
  const clean = (name: string) => { const base = name.toLowerCase().replace(/^(a|an|the)\s+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "someone"; let id = base; for (let n = 2; used.has(id); n++) id = `${base}-${n}`; used.add(id); return id; };
  const combatants: CombatantSetup[] = [{ id: "player", name: c.session.player.name, side: "player", role: "player", at: { ...c.ex.at } }];
  // Two of a kind are told apart: the first palace guard (G), the second (g).
  const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth"];
  const kinds = new Map<string, number>();
  for (const f of fighters) kinds.set(f.name, (kinds.get(f.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const f of fighters) {
    const statblock = f.stats?.statblock ?? "commoner";
    const n = seen.get(f.name) ?? 0;
    seen.set(f.name, n + 1);
    const base = f.name.replace(/^(a|an|the)\s+/i, "");
    const twins = (kinds.get(f.name) ?? 1) > 1;
    const name = twins ? `the ${ORDINALS[n] ?? `${n + 1}th`} ${base}` : f.name;
    const parts = base.split(/\s+/);
    const letter = (parts[parts.length - 1] ?? base).charAt(0);
    const glyph = twins ? (n === 0 ? letter.toUpperCase() : n === 1 ? letter.toLowerCase() : String(n + 1)) : undefined;
    combatants.push({ id: clean(f.name), castId: f.id, name, side: "enemy", role: statblock === "guard" ? "bruiser" : "brawler", statblock, ...(statblock === "guard" ? { weapon: "spear" } : {}), ...(glyph ? { glyph } : {}), at: tileOfFeet(f.at!) });
  }
  // Its lines say where it is ("Palace Street is on fire"), not the Heron. v2: its map by key.
  return { map: tw.map.id, combatants, seed: (c.session.seed + 7 * (c.session.rollCount + 1)) >>> 0, place: whereabouts(c.ex).place };
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

/**
 * What the rules resolve, as a scene's first turn. `feet`: how far off the player stood on the map,
 * so the scene's rules do it from as far away (the scene puts the player at its own start, which
 * for the granary yard is beside Kell: a Fireball at her from the lane would catch you there too).
 */
function mechanicFor(entry: Entry, target: string, feet = 0): Mechanic {
  const from = feet > FEET ? { from: { backOff: feet } } : {};
  if (entry.spell) return { kind: "cast", spell: entry.spell.id, targets: [target], ...from };
  if (entry.key === "attack") return { kind: "attack", target, ...from };
  if (entry.key === "throw") return { kind: "attack", target, weapon: "improvised", ...from };
  if (entry.key === "shove") return { kind: "wrestle", target, how: "prone" };
  if (entry.key === "grapple") return { kind: "wrestle", target, how: "grapple" };
  return { kind: "feature", feature: entry.key.replace(/^feature:/, ""), target };
}

/** Anything done to someone or something whose scene is waiting opens it: the act is its first turn, for the scene's rules to resolve. */
function storyAct(c: ActCtx, entry: Entry, who: Story, at: Tile2): Done {
  const weapon = entry.key === "attack" ? catalogueOf(c)?.weapon?.name : undefined;
  const reach = feetBetween(c.ex.at, at);
  return {
    text: reach > FEET ? `You turn to ${the(who.name)}.` : `You go over to ${the(who.name)}.`,
    scene: true,
    act: { text: actText(entry, the(who.name), weapon), mechanic: mechanicFor(entry, who.id, reach) },
  };
}

/** What would hurt Kell, or work on her mind, is a talk's to play (she has a say in it). */
function talkAct(c: ActCtx, tw: TownWorld, entry: Entry, who: { name: string; entity: Entity }): Done {
  const w = whereabouts(c.ex);
  const weapon = entry.key === "attack" ? catalogueOf(c)?.weapon?.name : undefined;
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
function restNow(c: ActCtx, kind: "short" | "long", recover: boolean): Done {
  const { session, ex } = c;
  const r = c.keep.rested && c.keep.rested.time === ex.story.time ? c.keep.rested : { time: ex.story.time };
  const out = rest(c.rules, session, kind);
  const more = recover ? arcaneRecovery(c.rules, session) : undefined;
  c.keep.rested = { ...r, [kind]: true, ...(kind === "long" ? { short: true } : {}) };
  // What's burning in the town has burned out by the time you've rested.
  const tw = townWorld(ex);
  let burnt = 0;
  for (const e of Object.values(tw.world.entities)) if (e.states.includes("burning")) { e.states = [...e.states.filter(s => s !== "burning"), ...(e.kind === "surface" ? [] : ["destroyed", "burnt"])]; burnt++; }
  if (burnt) keepTown(ex, tw);
  const where = whereabouts(ex);
  // A zoo's wing isn't Caerwyn: its exhibits wait for you.
  const zoo = !!tw.roam;
  const how = kind === "short"
    ? `You find a step out of the way in ${where.place} and sit an hour while ${zoo ? "the zoo" : "Caerwyn"} goes past without you.`
    : zoo ? "You find a bench to sleep the clock round on. The exhibits wait: they have nowhere else to be."
    : `You find somewhere to sleep the clock round (the story waits for you; Caerwyn doesn't, but it doesn't mind).`;
  return { text: [...out.lines, ...(more?.lines ?? []), how, ...(burnt ? ["The fires have burned themselves out."] : [])].join("\n"), lines: out.lines };
}

/** How far off people see you, for hiding (in steps). */
const SIGHT = 8;

/**
 * A Stealth check against whoever's watching (the sharpest eyes about, the town's people and
 * whoever waits for their scene), and out of sight if it's made: until you move or do something
 * (town.ts). Failed, they've seen you try: not again from here before the clock moves on.
 */
function hideNow(c: ActCtx, tw: TownWorld): Done {
  const { session, ex } = c;
  const town = Object.values(tw.world.entities).filter(e => (e.kind === "person" || e.kind === "creature") && !e.player && !e.states.some(s => ["gone", "down", "unconscious"].includes(s)) && e.at && steps(tileOfFeet(e.at), ex.at) <= SIGHT)
    .map(e => ({ name: e.name, passive: e.stats?.statblock === "guard" ? 12 : e.cast && !tw.roam ? 13 : 10 }));
  // The story's people are sharp: Kell is the watch, and Cob and Moll live by noticing.
  const theirs = [...tw.waiting.values()].filter(w => w.person && steps(w.at, ex.at) <= SIGHT).map(w => ({ name: w.name, passive: 13 }));
  const watchers = [...town, ...theirs];
  const dc = Math.max(10, ...watchers.map(w => w.passive));
  const sharpest = watchers.sort((a, b) => b.passive - a.passive)[0];
  const roll = rollFor(c.rules, session, "stealth", dc);
  ex.hidden = roll.success || undefined;
  if (!ex.hidden) delete ex.hidden;
  if (!roll.success && sharpest) c.keep.spotted = { time: ex.story.time, at: { ...ex.at }, by: sharpest.name };
  const line = describeRoll(roll, sharpest ? `to slip out of sight of ${the(sharpest.name)}` : "to slip out of sight");
  const said = roll.success
    ? (watchers.length ? `You're out of sight. Nobody about is looking your way, which ${tw.roam ? "in a zoo whose exhibits look back" : "in Caerwyn on Assembly eve"} is an achievement.` : "Out of sight, with nobody about to be out of sight of. It's good practice.")
    : sharpest ? `${capital(the(sharpest.name))} is looking right at you, with interest.` : "There's nowhere much to hide here: anyone who came along would see you.";
  return { text: `${line}\n${said}`, lines: [line] };
}

/**
 * A pocket picked on the map: a Sleight of Hand check, DC 10 while they sleep and 15 while they're
 * awake. Made, a few coins go into the player's pockets (`carried`, which the next scene and the
 * sheet read); missed, they wake (or turn) with a hand on your wrist, and you back off with nothing.
 * Either way, not them again before the clock moves on.
 */
function liftNow(c: ActCtx, who: Entity): Done {
  const { session, ex } = c;
  const tried = c.keep.lifted?.time === ex.story.time ? c.keep.lifted.who : [];
  if (tried.includes(who.id)) throw new NotDone("not_now", `(Lift a purse: not now, you've tried ${the(who.name)} already.)`);
  c.keep.lifted = { time: ex.story.time, who: [...tried, who.id] };
  const asleep = /\basleep\b/i.test(who.name) || who.states.includes("asleep");
  const roll = rollFor(c.rules, session, "sleight_of_hand", asleep ? 10 : 15);
  const line = describeRoll(roll, `to lift ${the(who.name)}'s purse`);
  if (!roll.success) return { text: `${line}
${capital(the(who.name))} ${asleep ? "wakes with a grunt" : "turns"} and a hand closes on your wrist. You let go, and back off with nothing but a look to remember.`, lines: [line] };
  const pennies = 1 + ((session.seed + 7 * session.rollCount) % 6);
  const pockets = (session.carried ??= []);
  const like = pockets.find(e => e.name === "pennies" && e.parent === "player" && e.quantity !== undefined);
  if (like) like.quantity = (like.quantity ?? 0) + pennies;
  else pockets.push({ id: pockets.some(e => e.id === "pennies") ? `pennies-${pockets.length + 1}` : "pennies", name: "pennies", kind: "item", parent: "player", tags: [], states: [], notes: [], quantity: pennies });
  return { text: `${line}
A light touch, and ${pennies} ${pennies === 1 ? "penny" : "pennies"} ${pennies === 1 ? "is" : "are"} yours. ${capital(the(who.name))} ${asleep ? "sleeps on" : "doesn't notice a thing"}.`, lines: [line] };
}

/** A leap to a tile: the rules' jump (within reach it simply happens; farther takes Athletics), and where you land. */
function leapNow(c: ActCtx, tw: TownWorld, at: Tile2): Done {
  const { session, ex } = c;
  const actors = tw.mapActors;
  const feet = feetBetween(ex.at, at);
  const dir = { x: Math.sign(at.x - ex.at.x), y: Math.sign(at.y - ex.at.y) };
  const way = overleap(tw.map, actors, ex.at, at);
  const out = jump(c.rules, session, { feet, runUp: runUp(tw.map, actors, ex.at, at, ex.story), drop: 0 });
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
