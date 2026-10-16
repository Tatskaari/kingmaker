// Copied from the prototype's src/game/look/invent.ts at 44c6d4a, less the model half (the openrouter import, INSTRUCTIONS, prompt, SCHEMA, LOOK_MODEL, lunaInventor and askLuna, and GLYPH_BY_NAME, MOTIONS and MATERIALS, which only they read): no inventor, so guesses only, as the prototype offline.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PALETTE, type ColorName } from "./color.ts";
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

/**
 * The glyphs the model may choose from: by name (strict structured output won't take quotes and
 * odd characters in an enum, and names read better anyway), each with what it's for. "letter"
 * means a letter of the model's choosing, for creatures (the roguelike way).
 */
export const GLYPH_MENU: Array<[string, string, string]> = [
  ["person", "☻", "a person"], ["child", "☺", "a child"], ["royal", "♔", "royalty"], ["bird", "v", "a bird (flying or perched)"], ["fish", "α", "a fish"],
  ["swarm", "·", "insects, a swarm, specks"], ["tree", "♣", "a tree or bush"], ["pine", "♠", "a pine or conifer"], ["grass", "\"", "grass, straw, an amulet"],
  ["star", "*", "a flower, a gem, a spark, a star"], ["leaf", "'", "a leaf, a feather, a shard"], ["stick", "/", "a stick, branch, blade, club or staff"],
  ["pole", "|", "a pole, post or spear"], ["knife", "-", "a knife or dagger"], ["tool", "(", "a tool"], ["bow", "}", "a bow"], ["arrow", "↑", "an arrow"],
  ["cloth", "[", "clothes, cloth, armour"], ["hat", "ⁿ", "a hat"], ["boot", "⌡", "a boot or shoe"], ["chain", "∞", "spectacles, a chain"], ["ring", "=", "a ring"],
  ["money", "$", "money, coins"], ["key", "⌐", "a key"], ["bottle", "!", "a bottle, flask or potion"], ["jar", "ô", "a jar or jug"], ["cup", "ü", "a cup, mug or tankard"],
  ["bucket", "Ü", "a bucket, tub or basket"], ["pot", "ö", "a pot, kettle or cauldron"], ["barrel", "Ö", "a barrel, keg or cask"],
  ["round", "○", "a plate, bowl, wheel or hoop"], ["pebble", "•", "a small round thing, a stone, a ball"], ["boulder", "●", "a boulder, a big ball"],
  ["small", "°", "an egg, a watch, something small and light"], ["food", "%", "food, or remains"], ["papers", "≡", "papers, a book, a sign, a shelf"],
  ["music", "♪", "a musical instrument"], ["statue", "Ω", "a statue or bell"], ["brazier", "¥", "a brazier or candelabra"], ["candle", "¡", "a candle or torch"],
  ["lantern", "¤", "a lantern or lamp"], ["flame", "▲", "a fire, a tent, a peak"], ["machine", "☼", "a machine, a contraption, magic, the sun"],
  ["table", "π", "a table or desk"], ["chair", "╥", "a chair, stool or throne"], ["bench", "═", "a bench or beam"], ["plank", "▬", "a tray, plank, boat or coffin"],
  ["box", "■", "a box or crate"], ["sack", "δ", "a sack, bag or purse"], ["chest", "⌂", "a chest or trunk"], ["block", "▓", "a wardrobe, cupboard or big block"],
  ["pane", "▒", "a pane of glass, grain, a haze"], ["haze", "░", "smoke, steam, mist"], ["net", "#", "a net, web or grate"], ["coil", "§", "rope, a coil"],
  ["liquid", "~", "a liquid, an eel, a worm"], ["waves", "≈", "water, waves"], ["door", "+", "a door or gate"], ["hatch", "□", "a hatch or trapdoor"],
  ["arch", "∩", "a gravestone or arch"], ["ladder", "╫", "a ladder"], ["well", "{", "a fountain or well"], ["hook", "¬", "a hook or bracket"],
  ["gibbet", "╤", "a hoist, gibbet or crane"], ["dice", "◘", "dice, a block"], ["cart", "æ", "a cart or wagon"], ["bomb", "ò", "a bomb"],
  ["letter", "", "a letter (give it in \"letter\"): creatures and monsters, the first letter of what they are, lowercase if small"],
];
export const MENU_GLYPHS = [...GLYPH_MENU.map(([, g]) => g).filter(Boolean), ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"];

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

/** The client calls no model: no inventor, guesses only, as the prototype has it offline (a test may set one). */
function defaultInventor(): Inventor | undefined {
  return undefined;
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
let lastError: string | undefined;
/** Why the last model call failed, if it did. */
export const lastInventionError = () => lastError;

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
          lookCache().set(item.key, { ...a, name: item.name, ...(item.kind ? { kind: item.kind } : {}), model: "custom", at: new Date().toISOString() });
          landed++;
        }
        if (landed) { lookCache().save(); version++; }
      } catch (error) {
        // Never fatal: the guesses stand, and these names are tried again in a minute.
        lastError = error instanceof Error ? error.message.slice(0, 300) : String(error);
        for (const item of batch) failed.set(item.key, Date.now());
      }
    }
    return landed;
  };
  flushing = run();
  try { return await flushing; } finally { flushing = undefined; }
}

/** What inventing some looks now cost: model calls, dollars, wall-clock milliseconds. */
export interface InventSpend { landed: number; calls: number; costUsd: number; ms: number }

/**
 * Looks for these names now, not through the queue, and what they cost: for a caller that counts
 * the model calls it causes (a place generated at runtime counts its looks in its own time and
 * cost). Names already cached are skipped; one call per 20.
 */
export async function inventNow(requests: InventRequest[]): Promise<InventSpend> {
  const spend: InventSpend = { landed: 0, calls: 0, costUsd: 0, ms: 0 };
  const make = currentInventor();
  const todo = [...new Map(requests.filter(r => !lookCache().has(r.key)).map(r => [r.key, r])).values()];
  if (!make || !todo.length) return spend;
  for (const r of todo) pending.delete(r.key); // the queue won't ask again
  const started = performance.now();
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20);
    try {
      spent++; spend.calls++;
      const { looks, costUsd } = { looks: await make(batch), costUsd: 0 };
      spend.costUsd += costUsd;
      for (const item of batch) {
        const a = looks[item.key];
        if (!a) { failed.set(item.key, Date.now()); continue; }
        lookCache().set(item.key, { ...a, name: item.name, ...(item.kind ? { kind: item.kind } : {}), model: "custom", at: new Date().toISOString() });
        spend.landed++;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 300) : String(error);
      for (const item of batch) failed.set(item.key, Date.now());
    }
  }
  if (spend.landed) { lookCache().save(); version++; }
  spend.ms = performance.now() - started;
  return spend;
}

/** A named colour's hex. */
export const inventionColor = (look: Invention) => PALETTE[look.color] ?? PALETTE.grey;
