import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { apiKey, respondJson } from "../../llm/openrouter.ts";
import { COLOR_NAMES, PALETTE, type ColorName } from "./color.ts";
import { NERD_NAMES } from "./glyphs.ts";
import type { Motion } from "./roles.ts";

/**
 * Looks for things the rules don't recognise. The GM invents freely ("a disgruntled swan", "the
 * Purveyor's grain cart in garlands", "a sackbut"), and a look has to come from somewhere: a small
 * Luna call (no reasoning) picks a glyph from a curated menu, a colour from the palette, a Nerd Font
 * icon if one fits, and how it moves. The answer is cached on disk by the name's key, so it costs
 * once per kind of thing, ever; rendering never waits for it (the thing is drawn with a guess until
 * the answer lands, then with the answer).
 *
 *   KM_LOOK_CACHE   where the cache lives (default runs/look-cache.json)
 *   KM_LOOK_MODEL   "off" to never call the model (guesses only)
 */

export interface Invention {
  glyph: string;
  /** A Nerd Font icon name (nf-md-*), or undefined. */
  nerd?: string;
  color: ColorName;
  motion: Motion;
  light: boolean;
  being: boolean;
  group: boolean;
  material?: string;
}

export interface CachedInvention extends Invention { name: string; kind?: string; model: string; at: string }

/** The glyphs the model may choose from, and what each is for (it reads the labels). */
export const GLYPH_MENU: Array<[string, string]> = [
  ["☻", "a person"], ["☺", "a child"], ["♔", "royalty"], ["v", "a bird (flying or perched)"], ["d", "a dog, wolf or fox"], ["f", "a cat or frog"],
  ["r", "a rat, mouse or small beast"], ["u", "a horse or donkey"], ["q", "cattle, sheep, goats, pigs"], ["α", "a fish"], ["S", "a snake"], ["B", "a bat"],
  ["s", "a spider or scorpion"], ["g", "a goblin, imp or small folk"], ["O", "an ogre, troll or giant"], ["D", "a dragon"], ["Z", "undead, a skeleton"],
  ["G", "a ghost"], ["&", "a monster or demon"], ["·", "insects, a swarm, specks"], ["♣", "a tree or bush"], ["♠", "a pine or conifer"],
  ["\"", "grass, straw, an amulet"], ["*", "a flower, a gem, a spark, a star"], ["'", "a leaf, a feather, a shard"], ["/", "a stick, branch, blade, club or staff"],
  ["|", "a pole, post or spear"], ["-", "a knife or dagger"], ["(", "a tool"], ["}", "a bow"], ["↑", "an arrow"], ["[", "clothes, cloth, armour"],
  ["ⁿ", "a hat"], ["⌡", "a boot or shoe"], ["∞", "spectacles, a chain"], ["=", "a ring"], ["$", "money, coins"], ["⌐", "a key"], ["!", "a bottle, flask or potion"],
  ["ô", "a jar or jug"], ["ü", "a cup, mug or tankard"], ["Ü", "a bucket, tub or basket"], ["ö", "a pot, kettle or cauldron"], ["Ö", "a barrel, keg or cask"],
  ["○", "a plate, bowl, wheel or hoop"], ["•", "a small round thing, a stone, a ball"], ["●", "a boulder, a big ball"], ["°", "an egg, a watch, something small and light"],
  ["%", "food, or remains"], ["≡", "papers, a book, a sign, a shelf"], ["♪", "a musical instrument"], ["Ω", "a statue or bell"], ["¥", "a brazier or candelabra"],
  ["¡", "a candle or torch"], ["¤", "a lantern or lamp"], ["▲", "a fire, a tent, a peak"], ["☼", "a machine, a contraption, magic, the sun"], ["π", "a table or desk"],
  ["╥", "a chair, stool or throne"], ["═", "a bench or beam"], ["▬", "a tray, plank, boat or coffin"], ["■", "a box or crate"], ["δ", "a sack, bag or purse"],
  ["⌂", "a chest or trunk"], ["▓", "a wardrobe, cupboard or big block"], ["▒", "a pane of glass, grain, a haze"], ["░", "smoke, steam, mist"],
  ["#", "a net, web or grate"], ["§", "rope, a coil"], ["~", "a liquid, an eel, a worm"], ["≈", "water, waves"], ["+", "a door or gate"], ["□", "a hatch or trapdoor"],
  ["∩", "a gravestone or arch"], ["╫", "a ladder"], ["{", "a fountain or well"], ["¬", "a hook or bracket"], ["╤", "a hoist, gibbet or crane"],
  ["◘", "dice, a block"], ["æ", "a cart or wagon"], ["ò", "a bomb"],
];
const LETTERS = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"];
export const MENU_GLYPHS = [...new Set([...GLYPH_MENU.map(([g]) => g), ...LETTERS])];
const MOTIONS: Motion[] = ["still", "flicker", "shimmer", "sway", "flutter", "pulse", "drift", "swarm", "drip", "bob"];
const MATERIALS = ["none", "cloth", "paper", "rope", "glass", "ice", "crystal", "wood", "bone", "leather", "stone", "iron", "steel", "brass", "silver", "flesh", "liquid"];

// ---------------------------------------------------------------------------------------------
// The cache on disk.

export class LookCache {
  readonly path: string;
  private looks: Record<string, CachedInvention> | undefined;
  constructor(path = process.env.KM_LOOK_CACHE ?? "runs/look-cache.json") { this.path = path; }
  private load(): Record<string, CachedInvention> {
    if (this.looks) return this.looks;
    try {
      const file = JSON.parse(readFileSync(this.path, "utf8")) as { version?: number; looks?: Record<string, CachedInvention> };
      this.looks = file.looks ?? {};
    } catch { this.looks = {}; }
    return this.looks;
  }
  get(key: string): CachedInvention | undefined { return this.load()[key]; }
  has(key: string): boolean { return key in this.load(); }
  set(key: string, look: CachedInvention): void { this.load()[key] = look; }
  get size(): number { return Object.keys(this.load()).length; }
  entries(): Array<[string, CachedInvention]> { return Object.entries(this.load()); }
  /** Write atomically (a half-written cache would cost every look again). */
  save(): void {
    const looks = this.load();
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, looks }, null, 1)}\n`);
    renameSync(tmp, this.path);
  }
}

let cache: LookCache | undefined;
export function lookCache(): LookCache { return (cache ??= new LookCache()); }
/** Point the look layer at another cache (tests, a session's own). */
export function setLookCache(next: LookCache | undefined): void { cache = next; version++; }

// ---------------------------------------------------------------------------------------------
// The model.

export interface InventRequest { key: string; name: string; kind?: string }
export type Inventor = (items: InventRequest[]) => Promise<Record<string, Invention>>;

const INSTRUCTIONS = [
  "You decide how things look on a Caves of Qud-style ASCII map, in a comic fantasy game (Pratchett, Monty Python). A game master has just invented these things; each needs a look a player can read at a glance.",
  "For each thing choose:",
  "- glyph: from the menu, the shape that reads best. Creatures and people may instead be a letter: the first letter of what they are (lowercase if small, uppercase if big).",
  "- nerd: a Nerd Font icon name from the list if one fits well, else \"none\".",
  "- color: a palette name. The colour of what it's made of, or its mood. Red and orange mean fire; blue means water; green means plants or poison; violet means magic.",
  "- motion: \"still\" unless it lives or burns: flutter (birds, bats), swarm (insects), sway (plants, hanging things, flags), shimmer (liquids, glass, gems, metal that glints), flicker (flames), pulse (magic, embers), drift (smoke, steam, mist), bob (small animals), drip (wet things).",
  "- light: true only if it gives off light. being: true for creatures and people. group: true if it is many (a flock, a crowd, a swarm). material: what it's mostly made of.",
  "Answer every key you're given, once each.",
].join("\n");

function prompt(items: InventRequest[]): string {
  const menu = GLYPH_MENU.map(([g, what]) => `${g}  ${what}`).join("\n");
  const things = items.map(i => `- key "${i.key}": ${i.name}${i.kind ? ` (${i.kind})` : ""}`).join("\n");
  return `Glyph menu:\n${menu}\n\nThings:\n${things}`;
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["looks"],
  properties: {
    looks: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["key", "glyph", "nerd", "color", "motion", "light", "being", "group", "material"],
        properties: {
          key: { type: "string" },
          glyph: { type: "string", enum: MENU_GLYPHS },
          nerd: { type: "string", enum: ["none", ...NERD_NAMES] },
          color: { type: "string", enum: COLOR_NAMES },
          motion: { type: "string", enum: MOTIONS },
          light: { type: "boolean" }, being: { type: "boolean" }, group: { type: "boolean" },
          material: { type: "string", enum: MATERIALS },
        },
      },
    },
  },
};

export const LOOK_MODEL = "openai/gpt-6-luna";

/** Luna, no reasoning, one call for a batch of things. */
export const lunaInventor: Inventor = async items => {
  type Answer = { key: string; glyph: string; nerd: string; color: string; motion: string; light: boolean; being: boolean; group: boolean; material: string };
  const result = await respondJson<{ looks: Answer[] }>({
    model: LOOK_MODEL, effort: "none", operation: "look.invent", instructions: INSTRUCTIONS,
    input: [{ role: "user", content: prompt(items) }],
    json: { name: "looks", schema: SCHEMA }, maxOutputTokens: 120 * items.length + 200,
  });
  const out: Record<string, Invention> = {};
  for (const a of result.looks ?? []) {
    if (!items.some(i => i.key === a.key)) continue;
    out[a.key] = {
      glyph: MENU_GLYPHS.includes(a.glyph) ? a.glyph : "?",
      ...(a.nerd && a.nerd !== "none" && NERD_NAMES.includes(a.nerd) ? { nerd: a.nerd } : {}),
      color: (COLOR_NAMES as string[]).includes(a.color) ? a.color as ColorName : "grey",
      motion: (MOTIONS as string[]).includes(a.motion) ? a.motion as Motion : "still",
      light: !!a.light, being: !!a.being, group: !!a.group,
      ...(a.material && a.material !== "none" ? { material: a.material } : {}),
    };
  }
  return out;
};

function defaultInventor(): Inventor | undefined {
  if (process.env.KM_LOOK_MODEL === "off") return undefined;
  try { apiKey(); } catch { return undefined; } // no key, no model: guesses only
  return lunaInventor;
}

let inventor: Inventor | undefined | null = null; // null: not decided yet
/** Swap the model (tests use a fake; undefined turns invention off). */
export function setInventor(next: Inventor | undefined): void { inventor = next; }
const currentInventor = (): Inventor | undefined => (inventor === null ? (inventor = defaultInventor()) : inventor);

// ---------------------------------------------------------------------------------------------
// The queue: lookups never wait; unknowns go out in batches.

const pending = new Map<string, InventRequest>();
const failed = new Map<string, number>();
let flushing: Promise<number> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let version = 0;
let spent = 0;

/** Bumps whenever an invention lands, so cached looks know to look again. */
export const inventionVersion = () => version;
/** Model calls made by this process (for the gallery's footnote and the tests). */
export const inventionCalls = () => spent;

/** The cached invention for a key, if there is one. */
export function invented(key: string): CachedInvention | undefined { return lookCache().get(key); }

/** Ask for a look in the background (no-op if cached, pending, recently failed or the model is off). */
export function requestInvention(request: InventRequest): void {
  if (!currentInventor() || lookCache().has(request.key) || pending.has(request.key)) return;
  const lastFail = failed.get(request.key);
  if (lastFail && Date.now() - lastFail < 60_000) return;
  pending.set(request.key, request);
  if (!timer) {
    timer = setTimeout(() => { timer = undefined; void flushInventions(); }, 40);
    timer.unref?.();
  }
}

/** Send what's pending (in batches of up to 20) and wait for the answers. Returns how many landed. */
export async function flushInventions(): Promise<number> {
  if (flushing) { await flushing; if (!pending.size) return 0; }
  const run = async () => {
    const make = currentInventor();
    let landed = 0;
    while (make && pending.size) {
      const batch = [...pending.values()].slice(0, 20);
      for (const b of batch) pending.delete(b.key);
      try {
        spent++;
        const answers = await make(batch);
        for (const item of batch) {
          const a = answers[item.key];
          if (!a) { failed.set(item.key, Date.now()); continue; }
          lookCache().set(item.key, { ...a, name: item.name, ...(item.kind ? { kind: item.kind } : {}), model: make === lunaInventor ? LOOK_MODEL : "custom", at: new Date().toISOString() });
          landed++;
        }
        if (landed) { lookCache().save(); version++; }
      } catch {
        for (const item of batch) failed.set(item.key, Date.now());
      }
    }
    return landed;
  };
  flushing = run();
  try { return await flushing; } finally { flushing = undefined; }
}

/** A named colour's hex. */
export const inventionColor = (look: Invention) => PALETTE[look.color] ?? PALETTE.grey;
