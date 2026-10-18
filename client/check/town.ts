// New (town-design §4, package C): the action menu as the client gets it, for the screen check, the tests and the demo, until the shared menu is the simulation's copy (S's, over K's stubs): the ready-made wizard's catalogue as the rules make it (the prototype's src/rules/actions.ts at 44c6d4a, its words and numbers, for the sheet in fixtures/sheet-wizard.json), and a TownMenu that offers, aims and greys out by plain geometry on the real map (reach in 5-ft tiles, an area as the tiles round its spot), in the prototype's menu.ts words; and a talk with Kell as its rows give it.
import { actorsHere, tileName, type ExploreState } from "../../shared/map/explore.ts";
import { getMap } from "../../shared/map/maps.ts";
import type { AimAt, AimView, MenuCtx, MenuItem, MenuView } from "../../shared/map/menu.ts";
import { inBounds, steps, tileAt } from "../../shared/map/tiles.ts";
import type { MapActor, Tile2 } from "../../shared/map/types.ts";
import { entryLabel, type Catalogue, type Entry, type Section } from "../../shared/rules/aim.ts";
import { FAREWELL } from "../../shared/scene/talk.ts";
import type { TownMenu } from "../explore/town.ts";
import type { SceneView } from "../scene/view.ts";
import { YARD } from "./fixture.ts";
import { ratWaiting, storyOf } from "./story.ts";

// ---------------------------------------------------------------------------------------------
// The catalogue: the ready-made wizard of the third level (Fire Bolt, Ray of Frost, Light; Burning
// Hands, Magic Missile, Shield, Sleep, Thunderwave; Scorching Ray), whole and fresh, in the morning.

const spell = (id: string, name: string, level: number, summary: string, aim: Entry["aim"], effect: Entry["effect"], more: Partial<Entry> & { element?: string; concentration?: boolean } = {}): Entry => {
  const { element, concentration, ...rest } = more;
  return {
    key: `spell:${id}`, group: level ? "spells" : "cantrips", name, summary, aim, effect, act: `cast_${id}`,
    spell: { id, level, slot: level, concentration: !!concentration, ...(element ? { element } : {}) }, ...rest,
  };
};

const NOT_IN_A_FIGHT = "only in a fight";
const FRESH = "nothing to rest off: you're whole and fresh";

const CANTRIPS: Entry[] = [
  spell("fire-bolt", "Fire Bolt", 0, "1d10 fire, 120 ft: sets things alight", { kind: "target", range: 120, self: false }, "harm", { element: "fire" }),
  spell("light", "Light", 0, "a thing shines like a torch for an hour", { kind: "target", range: 5, self: true }, "none"),
  spell("ray-of-frost", "Ray of Frost", 0, "1d8 cold, 60 ft, and it slows them", { kind: "creature", range: 60, self: false }, "harm", { element: "cold" }),
];
const FIRST: Entry[] = [
  spell("burning-hands", "Burning Hands", 1, "a 15-ft cone of fire, 3d6 (Dex save for half)", { kind: "area", range: 15, shape: "cone", size: 15, fromSelf: true }, "harm", { element: "fire" }),
  spell("magic-missile", "Magic Missile", 1, "three darts, 1d4+1 force each, never miss", { kind: "creature", range: 120, self: false }, "harm", { element: "force" }),
  spell("shield", "Shield", 1, "+5 AC against a blow that would land", { kind: "self" }, "help", { why: "a reaction: only in a fight" }),
  spell("sleep", "Sleep", 1, "puts 5d8 hit points of people to sleep, 60 ft", { kind: "area", range: 60, shape: "sphere", size: 5, fromSelf: false }, "harm", { concentration: true }),
  spell("thunderwave", "Thunderwave", 1, "a 15-ft cube of thunder, 2d8; it shoves", { kind: "area", range: 15, shape: "cube", size: 15, fromSelf: true }, "harm", { element: "thunder" }),
];
const SECOND: Entry[] = [
  spell("scorching-ray", "Scorching Ray", 2, "three rays, 2d6 fire each, 120 ft", { kind: "target", range: 120, self: false }, "harm", { element: "fire" }),
];
const FEATURES: Entry[] = [
  { key: "feature:arcane-recovery", group: "features", name: "Arcane Recovery", summary: "with a short rest: spent slots back (2 levels' worth)", aim: { kind: "none" }, effect: "none", act: "rest_short_recover", why: "no spell slots spent", uses: { current: 2, max: 2, recharge: "long rest" } },
];
const ACTIONS: Entry[] = [
  { key: "attack", group: "actions", name: "Attack (quarterstaff)", summary: "1d6-1 bludgeoning, in reach", aim: { kind: "target", range: 5, self: false }, effect: "harm", act: "attack" },
  { key: "jump", group: "actions", name: "Leap", summary: "8 ft with a run-up, 4 standing (more takes Athletics -1)", aim: { kind: "tile", range: 10, jump: { long: 8, standing: 4 } }, effect: "none", act: "jump" },
  { key: "hide", group: "actions", name: "Hide", summary: "slip out of sight: a Stealth check (+2)", aim: { kind: "none" }, effect: "none", act: "hide" },
  { key: "lift", group: "actions", name: "Lift a purse", summary: "pick someone's pocket: a Sleight of Hand check (+2), easier while they sleep", aim: { kind: "creature", range: 5, self: false }, effect: "none", act: "lift" },
  { key: "throw", group: "actions", name: "Throw something", summary: "a stone, or whatever's to hand: 1d4, 20 ft", aim: { kind: "target", range: 60, self: false }, effect: "harm", act: "throw" },
  { key: "shove", group: "actions", name: "Shove someone over", summary: "your Strength against theirs: down they go", aim: { kind: "creature", range: 5, self: false }, effect: "harm", act: "shove" },
  { key: "grapple", group: "actions", name: "Grab hold of someone", summary: "hold them fast, until they break free", aim: { kind: "creature", range: 5, self: false }, effect: "harm", act: "grapple" },
  { key: "help", group: "actions", name: "Help", summary: "give someone advantage on what they're trying", aim: { kind: "creature", range: 5, self: false }, effect: "help", act: "", why: "only when someone's trying something: in a fight, or a scene" },
  { key: "dash", group: "actions", name: "Dash", summary: "twice as far this turn", aim: { kind: "none" }, effect: "none", act: "", why: NOT_IN_A_FIGHT },
  { key: "dodge", group: "actions", name: "Dodge", summary: "blows at you have disadvantage", aim: { kind: "none" }, effect: "none", act: "", why: NOT_IN_A_FIGHT },
  { key: "disengage", group: "actions", name: "Disengage", summary: "walk away without a parting blow", aim: { kind: "none" }, effect: "none", act: "", why: NOT_IN_A_FIGHT },
  { key: "rest:short", group: "actions", name: "Short rest", summary: "an hour: Hit Dice (3 left) and some uses back", aim: { kind: "none" }, effect: "none", act: "rest_short", why: FRESH },
  { key: "rest:long", group: "actions", name: "Long rest", summary: "a night's sleep: everything back", aim: { kind: "none" }, effect: "none", act: "rest_long", why: FRESH },
];

const SECTIONS: Section[] = [
  { key: "cantrips", group: "cantrips", title: "Cantrips", entries: CANTRIPS },
  { key: "spells-1", group: "spells", title: "1st level", note: "4/4 slots", entries: FIRST },
  { key: "spells-2", group: "spells", title: "2nd level", note: "2/2 slots", entries: SECOND },
  { key: "features", group: "features", title: "Class features", entries: FEATURES },
  { key: "actions", group: "actions", title: "Actions", entries: ACTIONS },
];

/** What the ready-made wizard can do on the map (the sheet row's `actions`, as the simulation writes it). */
export const WIZARD_CATALOGUE: Catalogue = {
  sections: SECTIONS, entries: SECTIONS.flatMap(s => s.entries),
  reach: { long: 8, standingLong: 4, high: 2, standingHigh: 1 },
  weapon: { name: "Quarterstaff", range: 5, dice: "1d6-1", type: "bludgeoning" },
  you: { hurt: false, conditions: [] },
};

// ---------------------------------------------------------------------------------------------
// The menu, by plain geometry: what's in reach is what's within its feet, 5 ft a tile; an area
// covers the tiles round its spot (out from you, for a cone or a cube); a leap lands on open ground.

const FEET = 5;
const the = (name: string) => (/^(a|an|the)\s/i.test(name) || /^[A-Z]/.test(name) ? name.replace(/^(A|An)\s/, m => m.toLowerCase()) : `the ${name}`);
const isPerson = (a: MapActor) => a.kind === "person" || a.kind === "creature";

/** Who and what can be aimed at on the player's map: everyone and everything about but the player, and what hangs overhead. */
function aimables(ex: ExploreState): MapActor[] {
  return actorsHere(ex).filter(a => a.kind !== "player" && !(a.states ?? []).includes("overhead") && a.map === ex.map)
    .sort((a, b) => steps(a.at, ex.at) - steps(b.at, ex.at));
}

const at = (ex: ExploreState, t: Tile2) => aimables(ex).find(a => a.at.x === t.x && a.at.y === t.y);

/** The tiles an area covers aimed at a tile: round its spot, or out from you towards it (a cone, a cube, a line). */
function areaTiles(ex: ExploreState, aim: Extract<Entry["aim"], { kind: "area" }>, spot: Tile2): Tile2[] {
  const map = getMap(ex.map);
  const r = Math.max(1, Math.floor(aim.size / FEET));
  const out: Tile2[] = [];
  const d = { x: Math.sign(spot.x - ex.at.x), y: Math.sign(spot.y - ex.at.y) };
  for (let y = -r - 1; y <= r + 1; y++) for (let x = -r - 1; x <= r + 1; x++) {
    const t = aim.fromSelf ? { x: ex.at.x + x, y: ex.at.y + y } : { x: spot.x + x, y: spot.y + y };
    if (!inBounds(map, t) || tileAt(map, t).terrain === "wall") continue;
    if (aim.fromSelf) {
      const n = steps(t, ex.at);
      // Out from you, the way you point it: in front, as far as it reaches.
      if (n === 0 || n > r || (d.x && Math.sign(t.x - ex.at.x) === -d.x) || (d.y && Math.sign(t.y - ex.at.y) === -d.y)) continue;
      if (!d.x && t.x !== ex.at.x && Math.abs(t.x - ex.at.x) > Math.abs(t.y - ex.at.y)) continue;
      if (!d.y && t.y !== ex.at.y && Math.abs(t.y - ex.at.y) > Math.abs(t.x - ex.at.x)) continue;
    } else if (Math.max(Math.abs(x), Math.abs(y)) > r) continue;
    out.push(t);
  }
  return out;
}

/** Can an entry be aimed at a tile from where the player stands, and what would it do there (the prototype's checkAim, by plain geometry)? */
function check(c: MenuCtx, entry: Entry, to: Tile2): AimAt {
  const ex = c.ex;
  const map = getMap(ex.map);
  const feet = steps(ex.at, to) * FEET;
  const name = entryLabel(entry);
  const no = (why: string, more: Partial<AimAt> = {}): AimAt => ({ ok: false, why, label: name, feet, ...more });
  if (entry.why) return no(entry.why);
  const aim = entry.aim;
  if (aim.kind === "none" || aim.kind === "self") return { ok: true, id: entry.act, label: name, feet: 0 };
  if (!inBounds(map, to)) return no("off the map");
  if (aim.kind === "area") {
    if (aim.fromSelf && feet === 0) return no("which way? Point it away from you");
    if (!aim.fromSelf && feet > aim.range) return no(`out of reach: ${feet} ft (it reaches ${aim.range} ft)`);
    const there = at(ex, to);
    const where = there ? the(there.name) : tileName(ex, to);
    const area = areaTiles(ex, aim, to);
    const inside = (t: Tile2) => area.some(a => a.x === t.x && a.y === t.y);
    const caught = [...(inside(ex.at) ? ["you"] : []), ...aimables(ex).filter(a => inside(a.at)).map(a => a.name)];
    return { ok: true, id: `${entry.act}@${to.x},${to.y}`, label: `${name} ${aim.fromSelf ? "towards" : "on"} ${where}`, target: `${aim.fromSelf ? "towards " : ""}${where}`, area, caught: [...new Set(caught)], feet };
  }
  if (aim.kind === "tile") {
    if (feet === 0) return no("you're already here");
    if (feet > aim.range) return no(`too far: ${feet} ft (${aim.range} ft at most)`);
    const t = tileAt(map, to);
    if (t.blocks || t.terrain === "wall" || t.terrain === "deep-water" || at(ex, to)?.blocks) return no(`nowhere to land: ${tileName(ex, to)}`);
    return { ok: true, id: `${entry.act}@${to.x},${to.y}`, label: `Leap ${feet} ft`, target: tileName(ex, to), feet };
  }
  if (to.x === ex.at.x && to.y === ex.at.y) return aim.self ? { ok: true, id: `${entry.act}_self`, label: `${name} on yourself`, target: "yourself", feet: 0 } : no("not on yourself");
  const who = at(ex, to);
  if (!who) return no(aim.kind === "creature" ? "nobody there" : "nobody and nothing there");
  if (aim.kind === "creature" && !isPerson(who)) return no(`not on ${the(who.name)}`);
  const range = Math.max(aim.range, FEET);
  if (feet > range) return no(`out of reach: ${feet} ft (it reaches ${range} ft)`);
  return { ok: true, id: `${entry.act}@${to.x},${to.y}`, label: `${name} ${entry.effect === "harm" ? "at" : "on"} ${the(who.name)}`, target: the(who.name), feet };
}

/** What an entry can be aimed at from here (the prototype's aimView, by plain geometry). */
function view(c: MenuCtx, entry: Entry): AimView {
  const ex = c.ex;
  const map = getMap(ex.map);
  const reach = entry.aim.kind === "none" || entry.aim.kind === "self" ? 0 : entry.aim.range;
  const r = Math.floor(reach / FEET);
  const ring: Tile2[] = [];
  if (r > 0 && r <= 40) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const p = { x: ex.at.x + dx, y: ex.at.y + dy };
    if (Math.max(Math.abs(dx), Math.abs(dy)) === r && inBounds(map, p)) ring.push(p);
  }
  const targets: AimView["targets"] = [];
  if (entry.aim.kind === "target" || entry.aim.kind === "creature" || entry.aim.kind === "area") {
    for (const a of aimables(ex)) {
      const ok = check(c, entry, a.at);
      if (ok.ok && ok.id && !targets.some(t => t.at.x === a.at.x && t.at.y === a.at.y)) targets.push({ at: { ...a.at }, name: a.name, id: ok.id });
    }
  } else if (entry.aim.kind === "tile") {
    for (const [dx, dy] of [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as const) {
      for (let d = r; d >= 1; d--) {
        const p = { x: ex.at.x + dx * d, y: ex.at.y + dy * d };
        const ok = check(c, entry, p);
        if (ok.ok && ok.id) { targets.push({ at: p, name: tileName(ex, p), id: ok.id }); break; }
      }
    }
  }
  const self = (entry.aim.kind === "target" || entry.aim.kind === "creature") && entry.aim.self;
  const clear = entry.aim.kind === "area" ? targets.find(t => !(check(c, entry, t.at).caught ?? []).includes("you")) : undefined;
  const start = clear ?? targets[0];
  return { entry, ring, targets, self, selfReady: self && check(c, entry, ex.at).ok, ...(start ? { start: { ...start.at } } : {}) };
}

/** The menu now (the prototype's menuOf, by plain geometry): the catalogue's kinds, each entry with what's in reach for it, or why not. */
function menu(c: MenuCtx, to?: Tile2): MenuView | undefined {
  const cat = c.catalogue;
  if (!cat) return undefined;
  const there = to ? at(c.ex, to) : undefined;
  const sections = cat.sections.map(s => ({ ...s, entries: s.entries.map((e): MenuItem => {
    if (e.why) return e;
    if (e.aim.kind === "none" || e.aim.kind === "self") return { ...e, id: e.act };
    if (to) {
      const ok = check(c, e, to);
      if (!ok.ok) return { ...e, why: ok.why ?? "not there" };
      return e.aim.kind === "area" ? { ...e, aiming: true } : { ...e, id: ok.id! };
    }
    if (e.aim.kind === "area") return { ...e, aiming: true };
    const v = view(c, e);
    if (!v.targets.length && !v.selfReady) return { ...e, why: e.aim.kind === "tile" ? `nowhere to land within ${e.aim.range} ft` : `${e.aim.kind === "creature" ? "nobody" : "nobody and nothing"} in reach (${Math.max(FEET, e.aim.range)} ft)` };
    return { ...e, aiming: true };
  }) }));
  return { title: to ? `Do something: ${there ? the(there.name) : tileName(c.ex, to)}` : "What will you do?", sections, ...(to ? { at: to } : {}) };
}

/** The menu as a QA observation says it (the prototype's menuText). */
function text(c: MenuCtx): string {
  const m = menu(c);
  if (!m) return "";
  const lines = ["What you can do (the app's m; aimed ones take @x,y or _self):"];
  for (const s of m.sections) {
    lines.push(`  ${s.title}${s.note ? ` (${s.note})` : ""}:`);
    for (const e of s.entries) {
      let ids = e.id ?? "";
      if (!e.why && !e.id) {
        const v = view(c, e);
        ids = [...(v.selfReady ? [`${e.act}_self`] : []), ...v.targets.slice(0, 3).map(t => t.id), ...(e.aim.kind === "area" ? [`${e.act}@x,y`] : [])].join(", ");
      }
      lines.push(`    ${e.name}: ${e.summary}${e.why ? ` (not now: ${e.why})` : ids ? ` [${ids}]` : ""}`);
    }
  }
  return lines.join("\n");
}

/** The action menu by plain geometry, for the screen check, the tests and the demo (no town's world: what an act does isn't played on the map). */
export const FIXTURE_TOWN: TownMenu = {
  menu,
  aim: (c, key) => { const e = c.catalogue?.entries.find(x => x.key === key); return e ? view(c, e) : undefined; },
  check: (c, key, to) => { const e = c.catalogue?.entries.find(x => x.key === key); return e ? check(c, e, to) : undefined; },
  text,
  world: () => undefined,
};

// ---------------------------------------------------------------------------------------------
// A talk with Kell (town-design §3.6), as its rows give the client: a scene of kind talk on the
// town's own place (no world), her greeting, and the lines to choose from.

/** Kell's greeting, as the talk's opening has it. */
export const KELL_GREETING = "Kell is leaning on the lane wall with her notebook open on her knee, pencil behind her ear. She looks up as you come over. “Investigator. If this is about the yard, I've written it down. If it isn't, I've a minute.”";

/** The lines a talk's opening offers to choose from (its turn's scene_suggestion rows). */
export const KELL_LINES = [
  "How long have you been with the watch, Sergeant?",
  "What do you make of Prout, honestly?",
  "Does the Captain always take this much interest in a hanging?",
];

/** A talk with Kell, its greeting in and its lines to choose (the game's lead's own view). */
export function kellTalk(patch: Partial<SceneView> = {}): SceneView {
  return {
    ...YARD, sceneId: "9", title: "A word with Sergeant Agnes Kell", time: "Morning", hook: "A word with Sergeant Agnes Kell, between one thing and the next.",
    present: [YARD.present[0]!],
    entries: [{ turn: 0, speaker: "gm", kind: "narration", text: KELL_GREETING, markup: { speech: [{ start: KELL_GREETING.indexOf("“"), end: KELL_GREETING.length, speaker: "kell" }] } }],
    phase: "done", turn: 0, mayType: true, over: false,
    suggestions: KELL_LINES.map(text => ({ kind: "say" as const, text })), suggestionsComing: false, suggestionsOn: true,
    onMap: true, talk: true, story: storyOf(ratWaiting()),
    ...patch,
  };
}

/** The talk once the goodbye's been said and answered: over, its way on back to the map. */
export function kellTalkOver(): SceneView {
  const talk = kellTalk();
  return {
    ...talk, phase: "done", turn: 1, mayType: false, over: true, suggestions: [],
    entries: [...talk.entries,
      { turn: 1, speaker: "player:1", kind: "player", name: talk.player.name, text: FAREWELL },
      { turn: 1, speaker: "gm", kind: "narration", text: "Kell nods and goes back to her notebook. “Don't let me keep you.”" },
      { turn: 1, speaker: "system", kind: "system", text: "Scene ends: Goodbye for now" }],
  };
}
