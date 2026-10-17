// New (the world bridge's §3.5): the scene's place from the rows the client holds, as the simulation's world/rows-io.ts reads them and its world/place.ts rebuilds them (placeWorldOf), and what the place's menu needs of the other rows.
import { keysFor, pcKey, rowsToWorld, type PlaceRows, type WorldNote } from "../../shared/world/rows.ts";
import type { Area, Creature, Entity, Gear, Health, Material, Narrative, Place, PlayerCharacter, Position, Sheet, Stack, Surface, WorldLog } from "../module_bindings/types.ts";
import type { SpellFacts } from "../../shared/rules/types.ts";
import type { PlaceView, TimeOfDay } from "./view.ts";

/**
 * The place's rows as the client subscribes to them (net/connection.ts): its row and its world's
 * component rows where place_id is the scene's place, the bindings' types narrowed to what the world
 * is rebuilt from. gm_note is the module's alone, so the world has no descriptions (the menu never
 * shows them anyway). With the scene's key: the world's scene, which the stage dresses it by.
 */
export interface PlaceTables {
  sceneKey: string;
  place: Pick<Place, "id" | "key" | "name" | "rootId" | "sizeW" | "sizeH" | "round" | "rev">;
  entity: Array<Pick<Entity, "id" | "placeId" | "ord" | "key" | "parentId" | "name" | "called" | "kind" | "prefab" | "createdTurn" | "gone">>;
  position: Position[];
  area: Area[];
  material: Material[];
  health: Health[];
  stack: Stack[];
  surface: Surface[];
  creature: Creature[];
  playerCharacter: PlayerCharacter[];
  gear: Gear[];
  narrative: Narrative[];
  worldLog: Array<Pick<WorldLog, "placeId" | "seq" | "round" | "text" | "by" | "cause">>;
}

/**
 * What the place's view needs besides the place's own rows: the game's time of day (the light), the
 * scene's lead (their character is the world's "player"), the names they know the cast by (my_names),
 * and their sheet's spells.
 */
export interface PlaceSources {
  tables: PlaceTables;
  time: string;
  lead: bigint;
  names: Array<{ entityId: bigint; key: string; name: string }>;
  sheet?: LeadSheet | undefined;
}

/**
 * The lead's sheet as the menu reads it: its spells (sheet.spells), and what the rules say of each
 * one's reach, `spellFacts` (JSON SpellFacts[], written by the rules' sheetRows). On a sheet from
 * before the column, or one the rules haven't written yet, it's "": then the spells go with their
 * names alone, and the menu offers each anywhere (the rules have the last word), as the prototype's
 * does before its facts load.
 */
export type LeadSheet = Partial<Pick<Sheet, "spells" | "spellFacts">>;

/** The bindings' rows as shared/world's PlaceRows: ids as strings, the log in order, no GM's notes. */
export function placeRowsOf(t: PlaceTables): PlaceRows {
  const id = (n: bigint) => String(n);
  const at = (r: { entityId: bigint; placeId: bigint }) => ({ entityId: id(r.entityId), placeId: id(r.placeId) });
  return {
    place: { id: id(t.place.id), key: t.place.key, name: t.place.name, rootId: id(t.place.rootId), sizeW: t.place.sizeW, sizeH: t.place.sizeH, round: t.place.round, rev: t.place.rev },
    entity: [...t.entity].sort((a, b) => a.ord - b.ord).map(e => ({
      id: id(e.id), placeId: id(e.placeId), ord: e.ord, key: e.key, name: e.name, kind: e.kind, gone: e.gone,
      ...(e.parentId !== undefined ? { parentId: id(e.parentId) } : {}), ...(e.called !== undefined ? { called: e.called } : {}),
      ...(e.prefab !== undefined ? { prefab: e.prefab } : {}), ...(e.createdTurn !== undefined ? { createdTurn: e.createdTurn } : {}),
    })),
    position: t.position.map(r => ({ ...at(r), x: r.x, y: r.y })),
    area: t.area.map(r => ({ ...at(r), x: r.x, y: r.y, w: r.w, h: r.h })),
    material: t.material.map(r => ({ ...at(r), ...(r.material !== undefined ? { material: r.material } : {}), ...(r.size !== undefined ? { size: r.size } : {}) })),
    health: t.health.map(r => ({ ...at(r), hp: r.hp, maxHp: r.maxHp, ...(r.ac !== undefined ? { ac: r.ac } : {}) })),
    stack: t.stack.map(r => ({ ...at(r), quantity: r.quantity })),
    surface: t.surface.map(r => ({ ...at(r), ...(r.radiusFt !== undefined ? { radiusFt: r.radiusFt } : {}), ...(r.roundsLeft !== undefined ? { roundsLeft: r.roundsLeft } : {}) })),
    creature: t.creature.map(r => ({ ...at(r), ...(r.castKey !== undefined ? { castKey: r.castKey } : {}), ...(r.statblock !== undefined ? { statblock: r.statblock } : {}), ...(r.weapon !== undefined ? { weapon: r.weapon } : {}) })),
    playerCharacter: t.playerCharacter.map(r => ({ ...at(r), playerId: id(r.playerId) })),
    gear: t.gear.map(r => ({ ...at(r), engineItem: r.engineItem })),
    narrative: t.narrative.map(r => ({ ...at(r), states: [...r.states], tags: [...r.tags], notes: r.notes.map(n => ({ text: n.text, turn: n.turn, by: n.by as WorldNote["by"] })) })),
    gmNote: [],
    worldLog: [...t.worldLog].sort((a, b) => a.seq - b.seq).map(l => ({ placeId: id(l.placeId), seq: l.seq, round: l.round, text: l.text, by: l.by, ...(l.cause !== undefined ? { cause: l.cause } : {}) })),
  };
}

/**
 * The place's view: the world rebuilt from its rows (the lead's character as "player", as the
 * simulation and the AI service rebuild it), the light, the names the lead knows the cast by, and
 * their spells. None when the rows don't make a world (a place half arrived, or written by a module
 * this client doesn't know): the side panel lists who's there instead.
 */
export function placeViewOf(s: PlaceSources): PlaceView | undefined {
  const t = s.tables;
  let world;
  try {
    world = rowsToWorld(placeRowsOf(t), keysFor(t.place.key, t.sceneKey, pcKey(s.lead)));
  } catch {
    return undefined;
  }
  if (!world.entities[world.root]?.rect) return undefined;
  return { rev: `${t.place.id}:${t.place.rev}`, world, time: timeOf(s.time), unnamed: unnamedOf(t, s.names), spells: spellsOf(s.sheet) };
}

/** The cast the lead hasn't heard named, by what they call them (my_names gives the name heard, or the cast's `called`). */
function unnamedOf(t: PlaceTables, names: PlaceSources["names"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const e = t.entity.find(r => r.id === n.entityId);
    if (e && n.name !== e.name) out[n.key] = n.name;
  }
  return out;
}

/** The lead's spells for the menu: what the rules say of each (spellFacts), else ("") their names and levels alone. */
export function spellsOf(sheet: LeadSheet | undefined): SpellFacts[] {
  const facts = parsed(sheet?.spellFacts);
  if (Array.isArray(facts)) return facts.filter(isSpell);
  return (sheet?.spells ?? []).map(s => ({ id: s.id, name: s.name, level: s.level }));
}

const isSpell = (s: unknown): s is SpellFacts => !!s && typeof (s as SpellFacts).id === "string" && typeof (s as SpellFacts).name === "string" && typeof (s as SpellFacts).level === "number";

function parsed(json: string | undefined): unknown {
  if (!json) return undefined;
  try { return JSON.parse(json); } catch { return undefined; }
}

const TIMES: readonly TimeOfDay[] = ["morning", "afternoon", "evening", "night", "next-morning"];

/** The game's time of day as the look layer lights it: morning, unless it's one it knows. */
const timeOf = (word: string): TimeOfDay => (TIMES.includes(word as TimeOfDay) ? word as TimeOfDay : "morning");
