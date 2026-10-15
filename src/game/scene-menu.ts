import { ownerOf } from "../world/inventory.ts";
import { areaOf, distance, heldBy, positionOf, type Entity, type Point, type SceneWorld } from "../world/scene-world.ts";
import type { StagePick } from "./look/stage.ts";
import type { Action } from "./play.ts";

/**
 * Pointing at things in a scene's place, and the right-click menu there (the scene's side of what
 * the map's actionsAt is for the town): what the pointer is on, in a line; what a glance at it
 * shows (its states, where it is or who has it, what the story has said of it); and what can be
 * done with it, worded for the scene. A glance is instant and doesn't use the turn. It never
 * shows the world's descriptions: those are written for the GM, and hold what the scene means to
 * be found by looking properly (the cord mark under the noose, the countersign in the Roll), so
 * looking properly is a deed the GM answers ("(I take a close look at the tally desk)"). Talking
 * starts the player's line with the name ("Cob, "). The rest are deeds, sent as the player's turn
 * as if typed, in brackets ("(I pick up Prout's satchel)"), so the director, the rules and the GM
 * take them as they take typed ones. Only what fits is offered: nobody picks up a door, or a
 * burning desk, or talks to a puddle; and a blow at someone takes two clicks (with what?), so a
 * stray one never starts a fight.
 */

/**
 * What the pointer is on in a scene's place: someone or something in its world (and what's under
 * them there), or a bit of floor (and the cell of the stage's frame it was pointed at).
 */
export type SceneTarget = { id: string; under?: string[] } | { floor: StagePick; cell?: { x: number; y: number } };

/** Two targets are the same thing (the same someone, or the same cell of floor). */
export function sameTarget(a: SceneTarget | undefined, b: SceneTarget | undefined): boolean {
  if (!a || !b) return a === b;
  if ("id" in a || "id" in b) return "id" in a && "id" in b && a.id === b.id;
  return a.cell?.x === b.cell?.x && a.cell?.y === b.cell?.y && a.floor.area === b.floor.area;
}

/** Something to do with what was clicked: one of the map menu's kind of actions, and what it does in a scene. */
export interface SceneAction extends Action {
  /** A deed: the player's turn, as if typed ("(I pick up Prout's satchel)"). */
  line?: string;
  /** Talking: what the player's line starts with, in the box ("Cob, "). */
  start?: string;
  /** Looking: what a glance shows, at once (it doesn't use the turn). */
  look?: string;
  /** A further choice (what to give, which spell, something else that's there): its menu's title, and its actions. */
  title?: string;
  choices?: SceneAction[];
}

export interface ThingActions {
  /** What it is, for the menu's title: "Cob", "the boy in the too-big boots", "Prout's satchel", "the yard". */
  title: string;
  /** What can be done with it, the most natural first (talking, for someone; looking, for something). */
  actions: SceneAction[];
}

/**
 * One of the player's spells, with what the rules say of its reach when that's known: its range
 * ("Self", "Touch", "120 feet", "Self (15-foot cone)"), its effects' kinds (attack, save, heal,
 * buff...), and whether it fills an area.
 */
export interface SpellFacts { id: string; name: string; level: number; range?: string; effects?: string[]; area?: boolean }

export interface SceneContext {
  /** What to call the cast whose names the player hasn't heard yet, by cast id ("the boy in the too-big boots"). */
  unnamed?: Record<string, string>;
  /** The names people use for some of the cast, by cast id ("Hep" for Hepzibah Grist). */
  aka?: Record<string, string[]>;
  /** The player's spells, as the rules have them ready (cantrips and prepared). */
  spells?: SpellFacts[];
  /** The GM has the floor: what's instant still works (looking, starting a line); deeds wait. */
  busy?: boolean;
  /** The scene is over: there's only looking. */
  over?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Names.

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const isPerson = (e: Entity) => e.kind === "person" || e.kind === "creature";
const present = (e: Entity | undefined): e is Entity => !!e && !e.states.includes("gone");
/** "a loose board behind the water butt" is "the loose board behind the water butt" once it's been pointed at. */
const the = (name: string) => name.replace(/^(a|an)\s+/i, "the ");
/** An area's name without its stage directions: "the tally loft (above the yard, inside the granary)" is the tally loft. */
const bare = (name: string) => name.replace(/\s*\([^)]*\)/g, "").trim();
/** The player's own gear goes by their first name in the world ("Tamsin's shortsword"). */
const GEAR = /^\S+['’]s\s+/;

/**
 * What the player calls someone or something: "you"; a cast member by their name, or by what
 * they're called until the name's been heard ("the boy in the too-big boots"); what the player
 * carries as theirs ("your shortsword", "12 pennies"); anything else by its name.
 */
export function nameOf(world: SceneWorld, e: Entity, ctx: SceneContext = {}): string {
  if (e.player) return "you";
  if (isPerson(e)) return ctx.unnamed?.[e.cast ?? e.id] ?? e.name;
  if (e.kind === "area" || e.kind === "place") return bare(e.name);
  if (ownerOf(world, e.id)?.player) {
    if (e.gear && GEAR.test(e.name)) return `your ${e.name.replace(GEAR, "")}`;
    if ((e.quantity ?? 1) > 1) return `${e.quantity} ${e.name}`;
  }
  return e.name;
}

const TITLES = new Set(["sergeant", "corporal", "captain", "marshal", "master", "mister", "mistress", "madam", "lady", "lord", "sir", "dame", "king", "queen", "prince", "princess", "doctor", "warden", "constable", "father", "mother"]);
const NOT_NAMES = new Set(["big", "old", "young", "little", "tall", "short", "fat"]);

/**
 * How the player starts a line to someone: their name as it's said ("Cob", "Sergeant Kell",
 * "Master Sallow", "Hep", "Hobb" for Big Hobb Mallory), or, before the player has heard it, what
 * they're called ("Boy" for the boy in the too-big boots, "Landlady", "Corporal").
 */
export function addressOf(e: Entity, ctx: SceneContext = {}): string {
  const cast = e.cast ?? e.id;
  const called = ctx.unnamed?.[cast];
  if (called) {
    const head = called.replace(/^(the|a|an)\s+/i, "").split(/\s+(?:with|in|of|on|at|from|by)\s+/i)[0]!.split(/\s+/);
    return capital((head.length > 1 && /^(old|young|little)$/i.test(head[0]!) ? head.slice(1) : head).join(" "));
  }
  const aka = ctx.aka?.[cast]?.[0];
  if (aka) return aka;
  const words = e.name.replace(/^(the|a|an)\s+/i, "").split(/\s+/).filter(Boolean);
  if (words.length >= 3 && TITLES.has(words[0]!.toLowerCase())) return `${words[0]} ${words.at(-1)}`;
  if (words.length === 2 && TITLES.has(words[0]!.toLowerCase())) return words.join(" ");
  return capital(words.find(w => !NOT_NAMES.has(w.toLowerCase())) ?? words[0] ?? e.name);
}

/** What the player calls what they carry, in their own words: "my shortsword", "one of my pennies"; the rest by name ("the gin jar"). */
function mine(e: Entity): string {
  if (e.gear && GEAR.test(e.name)) return `my ${e.name.replace(GEAR, "")}`;
  if ((e.quantity ?? 1) > 1) return `one of my ${e.name}`;
  return the(e.name);
}

/** What the player has on them: in hand, in their pockets, in their purse (not what's inside those). */
export function carried(world: SceneWorld): Entity[] {
  const me = world.entities.player;
  if (!me) return [];
  return Object.values(world.entities).filter(e => e.parent === me.id && present(e) && (e.kind === "item" || e.kind === "object"))
    .sort((a, b) => Number(a.states.includes("worn")) - Number(b.states.includes("worn")));
}

/**
 * Who has a thing, or what it's in, on or hanging from, in a few words: "you have it", "Cob has
 * it", "in the water butt", "on the tally desk", "hanging from the hoist rope". Nothing for what
 * stands in the place itself.
 */
export function heldWords(world: SceneWorld, e: Entity, ctx: SceneContext = {}): string | undefined {
  const holder = heldBy(world, e);
  if (!holder) return undefined;
  if (holder.player) return "you have it";
  if (isPerson(holder)) return `${nameOf(world, holder, ctx)} has it`;
  const name = nameOf(world, holder, ctx);
  if (e.states.includes("hanging") || e.tags.includes("hanging")) return `hanging from ${name}`;
  if (holder.tags.includes("container") || CONTAINER.test(headOf(holder.name))) return `in ${name}`;
  if (holder.tags.includes("furniture") || /\b(table|desk|bench|shelf|counter|bar|tray)\b/.test(headOf(holder.name))) return `on ${name}`;
  return `with ${name}`;
}

/**
 * What a thing is, by the head of its name: the loose board behind the water butt is a board, not
 * a butt; the jar of gin with the drowned rat in it is a jar.
 */
const headOf = (name: string) => name.toLowerCase().replace(/^(a|an|the|some)\s+/, "").split(/\s+(?:behind|beside|by|in|on|of|with|under|over|at|from|for|near|marked|hung|full|and)\s+/)[0]!;
const CONTAINER = /\b(sacks?|chests?|barrels?|butts?|kegs?|casks?|buckets?|baskets?|crates?|box(es)?|jars?|bottles?|pots?|satchels?|bags?|purses?|pouch(es)?|wardrobes?|cupboards?|trunks?|coffers?|boots)\b/;
const LIGHT = /\b(lanterns?|lamps?|candles?|torch(es)?|braziers?|fire|hearth|sconces?)\b/;
const READABLE = /\b(book|ledger|roll|page|letter|notice|sign|signboard|placard|scroll|note|notebook)\b/;

/** States worth saying (gone things aren't pointed at; hanging goes without saying when it's said what from). */
const states = (e: Entity, held?: string) => e.states.filter(s => s !== "gone" && !(s === "hanging" && held?.startsWith("hanging")));

/**
 * What the story has said of someone or something, as the world has it noted (the latest first):
 * where people stood as the scene opened, then what the narration and the rules established.
 */
const doing = (e: Entity) => [...e.notes].reverse().map(n => n.text.replace(/\.$/, ""));

// ---------------------------------------------------------------------------------------------
// The floor.

const GROUND_WORDS: Record<string, string> = {
  cobbles: "cobbles", flags: "flagstones", boards: "boards", loft: "dusty boards", dirt: "beaten earth", mud: "mud", grass: "grass", straw: "straw",
  carpet: "carpet", steps: "steps", sand: "sand", rubble: "rubble", scorched: "scorched ground", water: "water", "deep-water": "deep water", river: "the river", puddle: "a puddle",
};
const PATCH_WORDS: Record<string, string> = { water: "a puddle", mud: "mud", straw: "straw", blood: "blood", oil: "oil", ale: "spilled ale", slops: "slops", ash: "ash", dust: "dust", grain: "spilled grain" };

const WALL_WORDS: Record<string, string> = { stone: "a stone wall", brick: "a brick wall", bank: "an earth bank", palace: "a palace wall", plaster: "a plastered wall", timber: "a timber wall", hedge: "a hedge", glass: "a glass wall" };

/** What the floor is in a few words: "cobbles, and a puddle"; "a stone wall"; "a window". */
function floorWords(pick: StagePick): string {
  if (pick.window) return "a window";
  if (pick.wall) return WALL_WORDS[pick.wall] ?? "a wall";
  const ground = GROUND_WORDS[pick.ground ?? ""] ?? pick.ground ?? "the floor";
  const patch = pick.patch ? PATCH_WORDS[pick.patch] ?? pick.patch : undefined;
  return patch ? `${ground}, and ${patch}` : ground;
}

const floorArea = (world: SceneWorld, pick: StagePick) => (pick.area ? world.entities[pick.area] : undefined);

// ---------------------------------------------------------------------------------------------
// The pointer's line, and looking.

/** What the pointer's on, for the status line: its name, and what it's doing, its states, or who has it. */
export function pointedAt(world: SceneWorld, target: SceneTarget, ctx: SceneContext = {}): { title: string; detail: string } | undefined {
  if ("floor" in target) {
    const pick = target.floor;
    if (pick.ground === "void" && !pick.area) return undefined;
    const area = floorArea(world, pick);
    return { title: capital(area ? nameOf(world, area, ctx) : "the floor"), detail: floorWords(pick) };
  }
  const e = world.entities[target.id];
  if (!present(e)) return undefined;
  const held = isPerson(e) ? undefined : heldWords(world, e, ctx);
  const bits = [states(e, held).join(", "), isPerson(e) ? doing(e)[0] ?? "" : held ?? ""].filter(Boolean);
  return { title: e.player ? `You (${e.name})` : capital(nameOf(world, e, ctx)), detail: bits.join(" · ") };
}

/** In, on or at a part of the place, as it's said: in the tally loft, on the floor, at the bar. */
const into = (area: string) => `${/\b(floor|stairs|steps|wharf|walk|barge|landing|deck|roof|quay)\b/i.test(area) ? "on" : /\b(bar|counter)\b/i.test(area) ? "at" : "in"} ${area}`;

/**
 * Where someone or something is from the player, in a few words: "beside you", "about 20 feet
 * away", "about 30 feet away, in the tally loft" (another part of the place). No distance for what
 * the place is built of (a wall, the river: they're everywhere along it).
 */
function whereFrom(world: SceneWorld, e: Entity, ctx: SceneContext): string {
  const here = areaOf(world, "player"), there = areaOf(world, e.id);
  const part = here && there && there.kind === "area" && here.id !== there.id ? into(nameOf(world, there, ctx)) : "";
  const d = e.kind === "feature" && (e.size === "huge" || e.size === "gargantuan") ? Infinity : feetFrom(world, e.id);
  const far = !Number.isFinite(d) ? "" : d <= 5 ? "beside you" : `about ${Math.max(10, Math.round(d / 5) * 5)} feet away`;
  return [far, part].filter(Boolean).join(", ");
}

/** Sentences from bits: each trimmed, capitalised, its full stop its own. */
const said = (parts: string[]) => parts.map(p => p.trim().replace(/\.$/, "")).filter(Boolean).map(capital).join(". ");

/**
 * A glance at what was clicked: what anyone could see from where they stand. Its name (as the
 * player knows it), how it is (its states), who has it or what it's in, on or hanging from, what
 * the story has said of it (the world's notes), and where it is from the player; for the player,
 * what they carry; for the floor, the part of the place and what's underfoot. Never the world's
 * descriptions: they're written for the GM ("a level cord mark under the noose burn", "countersigned
 * J. Sallow"), and what they hold is found by looking properly, which is a turn the GM answers.
 */
export function lookText(world: SceneWorld, target: SceneTarget, ctx: SceneContext = {}): string {
  if ("floor" in target) {
    const pick = target.floor;
    const area = floorArea(world, pick);
    const what = pick.wall || pick.window ? capital(floorWords(pick)) : `Underfoot: ${floorWords(pick)}`;
    if (!area) return `${what}.`;
    const st = area.states.filter(s => s !== "gone");
    return `${said([`${capital(nameOf(world, area, ctx))}${st.length ? `, ${st.join(", ")}` : ""}`, ...doing(area).slice(0, 2), what])}.`;
  }
  const e = world.entities[target.id];
  if (!present(e)) return "There's nothing there any more.";
  const held = isPerson(e) ? undefined : heldWords(world, e, ctx);
  const st = states(e, held);
  if (e.player) {
    const things = carried(world).map(c => `${nameOf(world, c, ctx)}${c.states.length ? ` (${c.states.join(", ")})` : ""}`);
    const have = things.length ? `You have ${things.length > 1 ? `${things.slice(0, -1).join(", ")} and ${things.at(-1)}` : things[0]}` : "Your hands are empty";
    return `${said([`You${st.length ? `, ${st.join(", ")}` : ""}`, ...doing(e).slice(0, 2), have])}.`;
  }
  const head = `${capital(nameOf(world, e, ctx))}${st.length ? `, ${st.join(", ")}` : ""}`;
  // What you carry is yours ("your shortsword", "12 pennies"): no saying who has it, or where.
  if (ownerOf(world, e.id)?.player) return `${said([head, ...doing(e).slice(0, 2)])}.`;
  return `${said([held ? `${head}: ${held}` : head, ...doing(e).slice(0, 2), whereFrom(world, e, ctx)])}.`;
}

// ---------------------------------------------------------------------------------------------
// The menu.

const deed = (text: string) => `(I ${text})`;
const levelWords = (level: number) => (level ? `level ${level}` : "cantrip");

/** Where the player is, and how far something is from them, in feet. */
function feetFrom(world: SceneWorld, id: string): number {
  const me = positionOf(world, "player"), it = positionOf(world, id);
  return me && it ? distance(me, it) : Infinity;
}

/**
 * Can the player pick it up and pocket it: something small (a satchel, the spectacles, a jar of
 * pennies), loose (not fixed, chained, burning or hanging), not a body, a stick of furniture, or
 * something full of drink (the ale keg, the jar of gin).
 */
function takeable(e: Entity): boolean {
  if (e.kind !== "item" && e.kind !== "object") return false;
  if (!["tiny", "small"].includes(e.size ?? (e.kind === "item" ? "tiny" : "medium"))) return false;
  if (e.tags.some(t => ["fixed", "furniture", "body", "hanging", "liquid"].includes(t)) || e.states.some(s => ["chained", "fixed", "burning", "hanging", "destroyed"].includes(s))) return false;
  return e.material !== "liquid";
}

/**
 * What's worth striking at, and what that's called: a shut door (broken down) or a shut box
 * (broken open), what would spill or catch (a keg, a jar of spirits, a lit lantern) and glass, all
 * smashed. Not everything with hit points: nobody needs to attack the spectacles, the rules board,
 * a cleat or the fire.
 */
function breaking(e: Entity): { label: string; text: string } | undefined {
  if (!e.hp || e.states.includes("destroyed") || e.tags.includes("body") || e.material === "liquid" || e.size === "gargantuan") return undefined;
  const st = new Set(e.states);
  if (e.tags.includes("door")) {
    if (st.has("open") || st.has("broken")) return undefined;
    return e.size === "large" || e.size === "huge" ? { label: "Break it down", text: "try to break down" } : { label: "Break it open", text: "try to break open" };
  }
  if (e.material === "glass" && e.kind === "feature") return { label: "Smash it", text: "smash" };
  if (e.size === "huge") return undefined;
  if ((e.tags.includes("container") || CONTAINER.test(headOf(e.name))) && (st.has("closed") || st.has("shut") || st.has("locked"))) return { label: "Break it open", text: "break open" };
  const lamp = e.tags.includes("light") && !e.tags.includes("fire") && !e.tags.includes("hearth") && (st.has("lit") || st.has("burning"));
  if (lamp || e.tags.includes("liquid") || e.tags.includes("spirits")) return { label: "Smash it", text: "smash" };
  return undefined;
}

/** What can be done to a thing in particular (open it, light it, put it out, read it, get it down...), in the scene's words. */
function uses(world: SceneWorld, e: Entity): SceneAction[] {
  const out: SceneAction[] = [];
  const own = !!ownerOf(world, e.id)?.player;
  const name = own ? mine(e) : the(nameOf(world, e));
  const head = headOf(e.name);
  const st = new Set(e.states);
  const add = (id: string, label: string, text: string) => out.push({ id, label, kind: "use", line: deed(text) });
  if (st.has("destroyed")) return out;
  const light = (e.tags.includes("light") || LIGHT.test(head)) && !st.has("broken") && !/\b(smashed|broken)\b/.test(head);
  if (st.has("burning") && !light) add("put-out", "Put the fire out", `try to put out the fire on ${name}`);
  if (e.tags.includes("door")) {
    if (st.has("open")) add("close", "Close it", `close ${name}`);
    else if (st.has("locked") || st.has("barred") || st.has("bolted")) add("open", "Try to open it", `try to open ${name}`);
    else add("open", "Open it", `open ${name}`);
  } else if (e.tags.includes("container") || CONTAINER.test(head)) {
    if (st.has("closed") || st.has("shut") || st.has("locked")) add("open", "Open it", `open ${name}`);
    // What's in a keg or a jar of gin goes without saying.
    else if (!st.has("empty") && e.material !== "liquid" && !e.tags.includes("liquid")) add("look-inside", "Look inside", `look inside ${name}`);
  }
  if (light) {
    if (st.has("lit") || st.has("burning")) add("put-out", "Put it out", `put out ${name}`);
    else add("light", "Light it", `light ${name}`);
  }
  if (e.tags.includes("passage")) add("go-through", "Go through it", `go through ${name}`);
  // Something hanging (a body from a rope, a lantern from the beams) can be got down; a rope with something on it, cut.
  if ((st.has("hanging") || (e.tags.includes("body") && heldBy(world, e))) && !own) add("get-down", "Get it down", `get ${name} down`);
  if (/\b(rope|cord|line|noose)\b/.test(head) && Object.values(world.entities).some(c => c.parent === e.id && present(c))) add("cut", "Cut it", `cut ${name}`);
  if (e.tags.includes("sign") || READABLE.test(head)) add("read", "Read it", `read ${name}`);
  return out;
}

/** What the rules' effects of a spell do to whoever it's aimed at, as against what it does for them. */
const HOSTILE = new Set(["attack", "auto-hit", "save", "hp-pool-knockout", "weaponAttack", "aura-damage"]);
const HELPFUL = new Set(["heal", "buff", "stabilize"]);
/** The odd spell that only makes sense on some things (the rules give it no effects to go by): mending what's broken. */
const ONLY_ON: Record<string, (e: Entity) => boolean> = {
  mending: e => e.states.some(s => /\b(broken|damaged|bent|torn|cracked|smashed)\b/.test(s)) || /\b(broken|smashed|torn|bent|cracked)\b/i.test(e.name),
};

/**
 * Does a spell fit what it would be cast at? Nothing that calls something up (Find Familiar, an
 * Unseen Servant): that's cast at nobody. On someone else: what harms or helps them, or fills an
 * area round them (not Shield, Mage Hand or Light), and what's thrown from the hand (Produce
 * Flame); on yourself: what only reaches you, or helps (Shield, Detect Magic, Cure Wounds), not
 * what harms or goes out from you (Fire Bolt, Burning Hands) or works on things (Mage Hand); on a
 * thing or a spill: what works on things (a bolt, an area, a light, a hand), not healing,
 * blessing or putting to sleep; on your own things, only the gentle kind (Light, Mending). A spell
 * the rules haven't described yet fits anything: the rules have the last word.
 */
function fits(sp: SpellFacts, at: "someone" | "self" | "thing" | "own", e?: Entity): boolean {
  if (sp.range === undefined) return true;
  if (e && ONLY_ON[sp.id] && !ONLY_ON[sp.id]!(e)) return false;
  const effects = sp.effects ?? [];
  if (effects.includes("summon")) return false;
  const hostile = effects.some(k => HOSTILE.has(k));
  const helpful = effects.some(k => HELPFUL.has(k));
  const selfOnly = /^self$/i.test(sp.range.trim());
  if (at === "someone") return hostile || helpful || (!!sp.area && !selfOnly);
  if (at === "self") return !hostile && !/^self\s*\(/i.test(sp.range) && (selfOnly || helpful);
  if (at === "own") return !hostile && !helpful && !selfOnly && !sp.area && !effects.length;
  return !helpful && !effects.includes("hp-pool-knockout") && (!selfOnly || effects.includes("attack"))
    && (!!sp.area || !effects.length || effects.some(k => k === "attack" || k === "auto-hit" || k === "zone"));
}

/**
 * The spells that fit, to cast at someone or something, cantrips first: what harms is cast at
 * them ("(I cast Fire Bolt at Cob)"), what helps or works on them on them ("(I cast Cure Wounds on
 * Sergeant Agnes Kell)", "(I cast Light on the hoist rope)"); "on myself" for the player.
 */
function spellChoices(ctx: SceneContext, at: "someone" | "self" | "thing" | "own", who: string, e?: Entity): SceneAction[] {
  return [...(ctx.spells ?? [])].filter(sp => fits(sp, at, e)).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
    .map(sp => {
      const harms = sp.range === undefined || (sp.effects ?? []).some(k => HOSTILE.has(k)) || !!sp.area;
      return { id: `cast:${sp.id}`, label: `${sp.name} (${levelWords(sp.level)})`, kind: "use" as const, line: deed(`cast ${sp.name} ${at === "self" || at === "own" || !harms ? "on" : "at"} ${who}`) };
    });
}

/** A spell to cast, if any fit: the choice's menu. */
function castAt(ctx: SceneContext, at: "someone" | "self" | "thing" | "own", who: string, label: string, title: string, e?: Entity): SceneAction[] {
  const choices = spellChoices(ctx, at, who, e);
  return choices.length ? [{ id: "cast", label, kind: "use", title, choices }] : [];
}

/** A blow at someone, with what: each weapon the player carries, or their bare hands (the rules' unarmed strike). */
function withWhat(world: SceneWorld, ctx: SceneContext, who: string): SceneAction[] {
  return [
    ...carried(world).filter(c => c.tags.includes("weapon")).map((w): SceneAction => ({ id: `attack:${w.id}`, label: capital(nameOf(world, w, ctx)), kind: "fight", line: deed(`attack ${who} with ${mine(w)}`) })),
    { id: "attack:unarmed", label: "Your bare hands", kind: "fight", line: deed(`attack ${who} with my bare hands`) },
  ];
}

/**
 * What can be done with what was clicked in a scene's place, the most natural first (the left
 * click's): for someone, talk to them, look (a glance), look them over (a turn), give them
 * something you carry, go over, cast at them, and last attack them (with what: two clicks, never
 * one); for yourself, look, your things (each with its own menu), and cast on yourself; for a
 * thing, look, put it out if it's burning, look closely, take it, what it's for (open it, light
 * it, put it out, get it down, read it...), give it or put it down if it's yours, go over, cast at
 * it, and last break or smash it if that's worth doing; for a surface, look, put it out if it's
 * burning, look closely, go over, cast at it; for the floor, look, and go over there if it's
 * somewhere else. Whatever else is drawn there (the rope Prout hangs from) comes last, with its
 * own menu. While the GM has the floor, deeds wait (only looking and starting a line); once the
 * scene is over, there's only looking.
 */
export function thingActions(world: SceneWorld, target: SceneTarget, ctx: SceneContext = {}): ThingActions {
  const look: SceneAction = { id: "look", label: "Look", kind: "examine", look: lookText(world, target, ctx) };
  const deeds = !ctx.busy && !ctx.over;
  if ("floor" in target) {
    const pick = target.floor;
    const area = floorArea(world, pick);
    const title = capital(area ? nameOf(world, area, ctx) : floorWords(pick));
    const actions: SceneAction[] = [{ ...look, label: "Look" }];
    const here = areaOf(world, "player");
    if (deeds && area && !pick.wall && !pick.window) {
      if (area.id !== here?.id && area.kind === "area") actions.push({ id: "go", label: "Go over there", kind: "move", line: deed(`go over to ${the(nameOf(world, area, ctx))}`) });
      else {
        // Within the same area, somewhere is by something.
        const by = nearestTo(world, pick.at, e => !isPerson(e) && !heldBy(world, e) && e.kind !== "surface", 6);
        if (by && feetFrom(world, by.id) > 6) actions.push({ id: "go", label: "Go over there", kind: "move", line: deed(`go over by ${the(nameOf(world, by, ctx))}`) });
      }
    }
    return { title, actions };
  }
  const e = world.entities[target.id];
  if (!present(e)) return { title: "Nothing", actions: [] };
  const name = nameOf(world, e, ctx);
  const title = e.player ? "You" : capital(name);
  const actions: SceneAction[] = [];
  /** Someone or something else's own menu, as a choice in this one. */
  const menuOf = (id: string, as: string): SceneAction => { const more = thingActions(world, { id }, ctx); return { id: `${as}:${id}`, label: `${more.title}…`, kind: "examine", title: more.title, choices: more.actions }; };
  const also = (target.under ?? []).map(id => world.entities[id]).filter(present).filter(u => u.id !== e.id).map(u => menuOf(u.id, "also"));
  const people = Object.values(world.entities).filter(p => isPerson(p) && present(p) && !p.player);
  if (e.player) {
    actions.push({ ...look, label: "Look at yourself" });
    // What you carry isn't drawn: it's here, each thing with its own menu (give it, put it down, cast on it).
    const things = carried(world);
    if (things.length) actions.push({ id: "things", label: "Your things…", kind: "examine", title: "Your things", choices: things.map(c => menuOf(c.id, "thing")) });
    if (deeds) actions.push(...castAt(ctx, "self", "myself", "Cast a spell on yourself…", "Cast on yourself…"));
    return { title, actions: [...actions, ...also] };
  }
  if (isPerson(e)) {
    const them = e.kind === "creature" ? "it" : "them";
    if (!ctx.over) actions.push({ id: "talk", label: `Talk to ${them}`, kind: "talk", start: `${addressOf(e, ctx)}, ` });
    actions.push({ ...look, label: `Look at ${them}` });
    if (deeds) {
      actions.push({ id: "examine", label: `Look ${them} over`, kind: "examine", line: deed(`take a good look at ${name}`) });
      const mineNow = carried(world);
      if (mineNow.length) actions.push({ id: "give", label: `Give ${them} something…`, kind: "use", title: `Give ${name}…`, choices: mineNow.map(c => ({ id: `give:${c.id}`, label: capital(nameOf(world, c, ctx)), kind: "use", line: deed(`give ${name} ${mine(c)}`) })) });
      if (feetFrom(world, e.id) > 5) actions.push({ id: "go", label: `Go over to ${them}`, kind: "move", line: deed(`go over to ${name}`) });
      actions.push(...castAt(ctx, "someone", name, `Cast a spell at ${them}…`, `Cast at ${name}…`));
      // Last, and two clicks: a blow starts a fight (or an arrest, or a brawl), and a stray click mustn't.
      actions.push({ id: "attack", label: `Attack ${them}…`, kind: "fight", title: `Attack ${name} with…`, choices: withWhat(world, ctx, name) });
    }
    return { title, actions: [...actions, ...also] };
  }
  actions.push({ ...look, label: "Look at it" });
  if (!deeds) return { title, actions: [...actions, ...also] };
  const holder = heldBy(world, e);
  const owner = ownerOf(world, e.id);
  const yours = !!owner?.player;
  const it = the(name);
  // What it's for, after a close look (but a fire is put out first).
  const doings: SceneAction[] = [];
  if (e.kind === "surface") {
    if (e.states.includes("burning")) doings.push({ id: "put-out", label: "Put the fire out", kind: "use", line: deed(`try to put out the fire on ${it}`) });
  } else if (yours) {
    doings.push(...uses(world, e));
    if (people.length) doings.push({ id: "give", label: "Give it to someone…", kind: "use", title: `Give ${name} to…`, choices: people.map(p => ({ id: `give-to:${p.id}`, label: capital(nameOf(world, p, ctx)), kind: "use", line: deed(`give ${nameOf(world, p, ctx)} ${mine(e)}`) })) });
    doings.push({ id: "put-down", label: "Put it down", kind: "use", line: deed(`put down ${mine(e)}`) });
  } else if (owner && isPerson(owner)) {
    // Someone else has it: it's theirs to hand over, or to have taken from them.
    doings.push({ id: "take", label: `Take it from ${nameOf(world, owner, ctx)}`, kind: "use", line: deed(`take ${it} from ${nameOf(world, owner, ctx)}`) });
  } else {
    if (takeable(e)) doings.push({ id: "take", label: "Take it", kind: "use", line: deed(holder ? `take ${it} from ${the(nameOf(world, holder, ctx))}` : `pick up ${it}`) });
    doings.push(...uses(world, e));
  }
  const fire = e.states.includes("burning") ? doings.findIndex(a => a.id === "put-out") : -1;
  if (fire >= 0) actions.push(...doings.splice(fire, 1));
  actions.push({ id: "examine", label: "Look closely", kind: "examine", line: deed(`take a close look at ${yours ? mine(e) : it}`) }, ...doings);
  // Over to it: to whoever has it, or what it lies in or on; what hangs is gone over to itself.
  const lies = holder && !isPerson(holder) && !e.states.includes("hanging") && !e.tags.includes("hanging") && !e.tags.includes("body");
  const where = owner && isPerson(owner) ? owner : lies ? holder : e;
  if (!yours && feetFrom(world, where.id) > 5) actions.push({ id: "go", label: "Go over to it", kind: "move", line: deed(`go over to ${where === e ? it : isPerson(where) ? nameOf(world, where, ctx) : the(nameOf(world, where, ctx))}`) });
  actions.push(...(yours ? castAt(ctx, "own", mine(e), "Cast a spell on it…", `Cast on ${name}…`, e) : castAt(ctx, "thing", it, "Cast a spell at it…", `Cast at ${name}…`, e)));
  // Last: breaking it, where that's worth doing (a shut door, a keg, a lit lantern).
  const blow = !yours && e.kind !== "surface" && !(owner && isPerson(owner)) ? breaking(e) : undefined;
  if (blow) actions.push({ id: "attack", label: blow.label, kind: "fight", line: deed(`${blow.text} ${it}`) });
  return { title, actions: [...actions, ...also] };
}

/** The nearest of something to a point, within some feet. */
function nearestTo(world: SceneWorld, p: Point, test: (e: Entity) => boolean, feet: number): Entity | undefined {
  let best: { e: Entity; d: number } | undefined;
  for (const e of Object.values(world.entities)) {
    if (e.kind === "place" || e.kind === "area" || !present(e) || e.player || !test(e)) continue;
    const q = positionOf(world, e.id);
    const d = q ? distance(p, q) : Infinity;
    if (d <= feet && (!best || d < best.d)) best = { e, d };
  }
  return best?.e;
}

/**
 * The order Tab goes through what's in the place: the people (nearest the player first), then
 * things and spills (nearest first), then what the place is built of (its walls, the river, the
 * elm), then the player. `shown` is what the stage drew (StagePicks).
 */
export function pointOrder(world: SceneWorld, shown: string[]): string[] {
  const rank = (id: string) => {
    const e = world.entities[id];
    if (!e) return 4;
    return e.player ? 3 : isPerson(e) ? 0 : e.size === "huge" || e.size === "gargantuan" ? 2 : 1;
  };
  return [...new Set(shown)].filter(id => present(world.entities[id])).sort((a, b) => rank(a) - rank(b) || feetFrom(world, a) - feetFrom(world, b) || a.localeCompare(b));
}
