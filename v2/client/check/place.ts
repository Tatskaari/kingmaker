// New: the granary yard as its place's rows would give the client (the world bridge's §3.5), for the screen check, the demo and the client's tests: the world the simulation's openPlace builds (simulation/src/world/place.ts: the place's file, the cast present placed as it says, the lead's character with the campaign's purse and their gear), through shared/world's worldToRows, as the tables the connection subscribes to.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CampaignFile, PlaceFile, SceneFile } from "../../shared/scene/files.ts";
import { inventory } from "../../shared/world/inventory.ts";
import { keysFor, pcKey, worldToRows, type Keys, type PlaceRows } from "../../shared/world/rows.ts";
import { buildWorld, joinWorld, type SceneWorld } from "../../shared/world/scene-world.ts";
import type { SpellFacts } from "../scene/menu.ts";
import { placeRowsOf, type PlaceTables } from "../scene/place-rows.ts";
import type { SceneRows } from "../scene/rows.ts";
import { YARD, yardRows } from "./fixture.ts";
import spellFacts from "./fixtures/spell-facts-wizard.json" with { type: "json" };

const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const read = <T>(path: string): T => JSON.parse(readFileSync(join(CAERWYN, path), "utf8")) as T;

/** The scene the yard is the place of, and the place's id in the fixtures' rows (the scene's is 7). */
export const YARD_SCENE = "hanged-clerk";
export const YARD_PLACE = 9n;

/** What the rules engine says of the ready-made wizard's spells (fixtures/spell-facts-wizard.json): the sheet's spellFacts as the rules' sheetRows writes it (the same JSON). */
export const WIZARD_SPELLS = spellFacts as SpellFacts[];

/**
 * The yard as the scene opens, the lead (player 1, `name`) in it with the campaign's purse and the
 * ready-made wizard's quarterstaff and dagger, as openPlace hands out the build's gear.
 */
export function yardWorld(name = "Pell Marrow"): SceneWorld {
  const scene = read<SceneFile>(`scenes/${YARD_SCENE}/scene.json`);
  const present = scene.cast.filter(c => !c.enters).map(c => ({ id: c.id, name: c.name }));
  const world = buildWorld(YARD_SCENE, read<PlaceFile>("places/granary-yard.json"), present, { name });
  joinWorld(world, present, 0);
  for (const coin of read<CampaignFile>("campaign.json").startingPurse) inventory(world, 0).add("player", coin);
  const first = name.split(" ")[0]!;
  const gear = (item: string, states: string[]) => {
    const id = `${first}-${item}`.toLowerCase();
    world.entities[id] = { id, name: `${first}'s ${item}`, kind: "item", parent: "player", tags: ["weapon"], states, notes: [], gear: `${item}-1` };
  };
  gear("quarterstaff", ["in hand"]);
  gear("dagger", []);
  return world;
}

/** The fixtures' keys: the yard in the hanged clerk, player 1's character as "player". */
export const yardKeys = (lead = 1n): Keys => keysFor("granary-yard", YARD_SCENE, pcKey(lead));

/**
 * A world as the place's tables (bigint ids, as the bindings have them): the rows worldToRows makes
 * of it, after `prev` (the rows the world was rebuilt from, so ids are kept and new ones come next),
 * with each provisional id made a number. Returns the rows too, to write the next world after.
 */
export function yardTables(world: SceneWorld, prev?: PlaceRows, lead = 1n): { tables: PlaceTables; rows: PlaceRows } {
  const rows = worldToRows(world, yardKeys(lead), prev);
  // The ids as the simulation's writer would give them: kept from prev, the place's own, a new one's the next in order.
  const id = (text: string) => (text === "new:place" ? YARD_PLACE : text.startsWith("new:") ? BigInt(text.slice(4)) + 100n : BigInt(text));
  const big = (r: { entityId: string }) => ({ entityId: id(r.entityId), placeId: YARD_PLACE });
  const tables: PlaceTables = {
    sceneKey: YARD_SCENE,
    place: { id: YARD_PLACE, key: rows.place.key, name: rows.place.name, rootId: id(rows.place.rootId), sizeW: rows.place.sizeW, sizeH: rows.place.sizeH, round: rows.place.round, rev: rows.place.rev },
    entity: rows.entity.map(e => ({ id: id(e.id), placeId: YARD_PLACE, ord: e.ord, key: e.key, parentId: e.parentId === undefined ? undefined : id(e.parentId), name: e.name, called: e.called, kind: e.kind, prefab: e.prefab, createdTurn: e.createdTurn, gone: e.gone })),
    position: rows.position.map(r => ({ ...big(r), x: r.x, y: r.y })),
    area: rows.area.map(r => ({ ...big(r), x: r.x, y: r.y, w: r.w, h: r.h })),
    material: rows.material.map(r => ({ ...big(r), material: r.material, size: r.size })),
    health: rows.health.map(r => ({ ...big(r), hp: r.hp, maxHp: r.maxHp, ac: r.ac })),
    stack: rows.stack.map(r => ({ ...big(r), quantity: r.quantity })),
    surface: rows.surface.map(r => ({ ...big(r), radiusFt: r.radiusFt, roundsLeft: r.roundsLeft })),
    creature: rows.creature.map(r => ({ ...big(r), castKey: r.castKey, statblock: r.statblock, weapon: r.weapon })),
    playerCharacter: rows.playerCharacter.map(r => ({ ...big(r), playerId: BigInt(r.playerId) })),
    gear: rows.gear.map(r => ({ ...big(r), engineItem: r.engineItem })),
    narrative: rows.narrative.map(r => ({ ...big(r), states: r.states, tags: r.tags, notes: r.notes.map(n => ({ text: n.text, turn: n.turn, by: n.by })) })),
    worldLog: rows.worldLog.map(l => ({ placeId: YARD_PLACE, seq: l.seq, round: l.round, text: l.text, by: l.by, cause: l.cause })),
  };
  return { tables, rows: placeRowsOf(tables) };
}

/** The my_names rows for the yard's cast, as a lead who has heard only Kell's name knows them, by the tables' entity ids. */
export function yardNames(tables: PlaceTables): Array<{ entityId: bigint; key: string; name: string }> {
  const called: Record<string, string> = { cob: "the boy in the too-big boots", moll: "the girl in the shawl" };
  return tables.entity.filter(e => ["kell", "cob", "moll"].includes(e.key)).map(e => ({ entityId: e.id, key: e.key, name: called[e.key] ?? e.name }));
}

/**
 * The yard a few turns in (check/fixture.ts's rows: Pell Marrow, player 1, has the lead) with its
 * place: Pell's character and the cast on stage as the place's entities, by the names Pell knows
 * and in their looks' colours; Pell's sheet with the rules' word on the wizard's spells; `more`
 * entries after the transcript's.
 */
export function yardPlaceRows(tables: PlaceTables = yardTables(yardWorld()).tables, more: SceneRows["transcript"] = [], sheet?: SceneRows["sheets"][number]): SceneRows {
  const base = yardRows();
  const names = yardNames(tables);
  const lead = tables.entity.find(e => e.key === "pc:1")!;
  return {
    ...base,
    sheets: [sheet ?? { playerId: 1n, statusLine: YARD.player.status!, spellFacts: JSON.stringify(WIZARD_SPELLS) }],
    onStage: [{ entityId: lead.id, role: "controller" }, ...names.map(n => ({ entityId: n.entityId, role: "cast" }))],
    names,
    looks: names.flatMap(n => { const color = YARD.present.find(p => p.key === n.key)?.color; return color ? [{ entityId: n.entityId, fg: color }] : []; }),
    transcript: [...base.transcript, ...more.map((e, i) => ({ ...e, seq: base.transcript.length + i + 1 }))],
    place: tables,
  };
}
