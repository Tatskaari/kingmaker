// openPlace's world (givePurse, giveGear) is copied from the prototype's src/runtime/engine.ts:171-189 at 44c6d4a: no history, no carried things, nothing owed yet, the purse and gear handed in from the campaign and the build.

import type { GmState } from "../../../shared/gm/state.ts";
import type { GearRow } from "../../../shared/rules/types.ts";
import type { CampaignFile, PlaceFile } from "../../../shared/scene/files.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import type { Character, Scene } from "../../../shared/scene/types.ts";
import { inventory } from "../../../shared/world/inventory.ts";
import { fullKey, keysFor, opToLocal, pcKey, rowsToWorld, worldToRows, type Keys, type PlaceRows } from "../../../shared/world/rows.ts";
import { applyOps, buildWorld, joinWorld, type SceneWorld, type WorldOp } from "../../../shared/world/scene-world.ts";
import type { TxCtx } from "../context.ts";
import type { GameRow, PlayerRow, SceneRow } from "../rows.ts";
import { placeFileOf } from "../scenes.ts";
import { placeRows, writePlace } from "./rows-io.ts";

/**
 * A scene's place as the prototype's SceneWorld: built when the scene opens, rebuilt from its rows
 * when a commit changes it (who arrives, what the stage manager says the reply did), and written
 * back. The world code is shared/world's, the prototype's own; this is only where it meets the rows.
 */

/** The most operations the gate takes from one settle (the stage manager's own cut, stage.ts:93). */
const MAX_OPS = 16;

/** What a character starts the game with: the campaign's purse, and their gear as rules_state has it, but what's gone (engine item instances, v1-design §3.6). Only the game's first scene hands it out. */
export interface Start { purse: CampaignFile["startingPurse"]; gear: GearRow[] }

/** A place's world as a commit works on it: the rows it was rebuilt from, and the keys that map the two. */
export interface PlaceWorld { rows: PlaceRows; world: SceneWorld; keys: Keys }

/**
 * The place a scene opens in, written as rows: its world built from the place's file with the cast
 * present placed as it says, the controller's character in it, and what they start with in their
 * hands. Returns the place, the character's entity, and the world as built (their pockets are read
 * from it).
 */
export function openPlace(tx: TxCtx, game: GameRow, placeKey: string, graph: Scene, gm: GmState, controller: PlayerRow, start: Start | undefined): { placeId: bigint; characterId: bigint; world: SceneWorld } {
  const file = placeFileOf(tx, game, placeKey);
  const world = builtWorld(file, graph, gm, controller.name);
  if (start) handOut(world, controller.name, start);

  const keys = keysFor(file.key, graph.id, pcKey(controller.id));
  const written = writePlace(tx, worldToRows(world, keys), { gameId: game.id, called: calledIn(graph) });
  return { placeId: written.placeId, characterId: written.idOf(keys.controller), world };
}

/**
 * The lead's place before its scene opens (map-design §3.3), written as rows: its world built as
 * openPlace builds it, the cast present at the scene's start where its file puts them, but with no
 * one playing in it yet. It's built with the player's character, so everything else stands where it
 * will when the scene opens (a spot found for someone is found round them), and then the character
 * is taken out: they join it when it opens (joinPlace). The map draws it from these rows.
 */
export function waitingPlace(tx: TxCtx, game: GameRow, placeKey: string, graph: Scene, gm: GmState, host: PlayerRow): { placeId: bigint } {
  const file = placeFileOf(tx, game, placeKey);
  const world = builtWorld(file, graph, gm, host.name);
  withoutPlayer(world);

  const keys = keysFor(file.key, graph.id, pcKey(host.id));
  return { placeId: writePlace(tx, worldToRows(world, keys), { gameId: game.id, called: calledIn(graph) }).placeId };
}

/**
 * A waiting place's scene opens (map-design §3.5): the controller's character joins the place as
 * the rows have it, and what they start with is handed out, as openPlace does it, with their log's
 * lines. The entities are then put in the order openPlace's world has them (entity.ord), the
 * place's own after it, so the world the opening's request carries is the one V0's opening built.
 */
export function joinPlace(tx: TxCtx, game: GameRow, placeKey: string, graph: Scene, gm: GmState, controller: PlayerRow, start: Start | undefined, placeId: bigint): { placeId: bigint; characterId: bigint; world: SceneWorld } {
  const file = placeFileOf(tx, game, placeKey);
  const rows = placeRows(tx, placeId);
  const keys = keysFor(file.key, graph.id, pcKey(controller.id));
  const world = rowsToWorld(rows, keys);

  const fresh = builtWorld(file, graph, gm, controller.name);
  const built = fresh.log.length;
  if (start) handOut(fresh, controller.name, start);
  world.entities = Object.fromEntries([
    ...Object.keys(fresh.entities).map(id => [id, world.entities[id] ?? fresh.entities[id]!] as const),
    ...Object.entries(world.entities).filter(([id]) => !fresh.entities[id]),
  ]);
  world.log.push(...fresh.log.slice(built));

  const written = writePlace(tx, inWorldOrder(worldToRows(world, keys, rows), world, keys), { gameId: game.id, called: calledIn(graph) });
  return { placeId, characterId: written.idOf(keys.controller), world };
}

/** A scene's place, read: its rows and the world rebuilt from them, the controller's character as "player". */
export function placeWorldOf(tx: TxCtx, scene: SceneRow): PlaceWorld {
  const rows = placeRows(tx, scene.placeId);
  const keys = keysFor(rows.place.key, scene.sceneKey, pcKey(scene.controllerId));
  return { rows, world: rowsToWorld(rows, keys), keys };
}

/** The world written back over the rows it was rebuilt from: only what changed. */
export function savePlaceWorld(tx: TxCtx, scene: SceneRow, place: PlaceWorld, graph: Scene): void {
  writePlace(tx, worldToRows(place.world, place.keys, place.rows), { gameId: scene.gameId, called: calledIn(graph) });
}

/** Whoever is on stage now and not yet in the world (a cue's entrance) joins it at the way in. The names of those who did. */
export function joinArrivals(world: SceneWorld, graph: Scene, gm: GmState, turn: number): string[] {
  return joinWorld(world, presentCast(graph, gm).map(personOf), turn);
}

/**
 * The stage manager's operations through the gate (applyOps, the prototype's own): at most 16, by
 * the world's local keys, each problem kept in the log as "(not done) …"; and a removal of the
 * player undone, since only walking out takes them out (engine.ts:917, 924-928).
 */
export function applyStage(place: PlaceWorld, ops: WorldOp[], turn: number): { changes: string[]; problems: string[] } {
  const local = ops.slice(0, MAX_OPS).map(op => opToLocal(completeOp(op), place.keys));
  const done = applyOps(place.world, local, turn, "stage");
  for (const problem of done.problems) place.world.log.push({ turn, text: `(not done) ${problem}`, by: "stage" });
  keepPlayer(place.world, turn);
  return done;
}

// ---------------------------------------------------------------------------------------------

const personOf = (c: Character) => ({ id: c.id, name: c.name, ...(c.members ? { members: c.members } : {}) });

/** A place's world as its scene opens it (engine.ts:171-176): its file built with the player's character and the cast present, and whoever the file didn't place joining it. */
function builtWorld(file: PlaceFile, graph: Scene, gm: GmState, playerName: string): SceneWorld {
  const present = presentCast(graph, gm);
  const world = buildWorld(graph.id, file, present.map(c => ({ id: c.id, name: c.name })), { name: playerName });
  joinWorld(world, present.map(personOf), 0);
  return world;
}

/** What the character starts the story with, in their hands (engine.ts:178-188). */
function handOut(world: SceneWorld, playerName: string, start: Start): void {
  givePurse(world, start.purse);
  giveGear(world, playerName, start.gear);
}

/** The player's character out of a world, and whatever they hold. */
function withoutPlayer(world: SceneWorld): void {
  const theirs = (id: string | null): boolean => id === "player" || (!!id && !!world.entities[id] && theirs(world.entities[id]!.parent));
  for (const id of Object.keys(world.entities).filter(theirs)) delete world.entities[id];
}

/** Rows whose entities are numbered (entity.ord) in the world's order, as worldToRows numbers a world it builds afresh. */
function inWorldOrder(rows: PlaceRows, world: SceneWorld, keys: Keys): PlaceRows {
  const ord = new Map(Object.entries(world.entities).map(([local, e], i) => [fullKey(local, e, keys), i + 1]));
  return { ...rows, entity: rows.entity.map(e => ({ ...e, ord: ord.get(e.key) ?? e.ord })).sort((a, b) => a.ord - b.ord) };
}

/** What players call a cast member until they've heard the name (the cast's `called`), for their entity row. */
const calledIn = (graph: Scene) => (key: string) => graph.cast.find(c => c.id === key)?.called;

/** A purse at the start of the story (engine.ts:178-180). */
function givePurse(world: SceneWorld, purse: Start["purse"]): void {
  for (const coin of purse) inventory(world, 0).add("player", coin);
}

/** The player's own gear is in the world too, so the story can part them from it (engine.ts:182-188). */
function giveGear(world: SceneWorld, playerName: string, gear: Start["gear"]): void {
  const first = playerName.split(" ")[0]!;
  for (const g of gear) {
    if (Object.values(world.entities).some(e => e.gear === g.id)) continue;
    let id = `${first}-${g.name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    for (let n = 2; world.entities[id]; n++) id = `${id}-${n}`;
    world.entities[id] = { id, name: `${first}'s ${g.name.toLowerCase()}`, kind: "item", parent: "player", tags: [g.kind], states: g.slot ? [g.slot === "mainHand" || g.slot === "offHand" ? "in hand" : "worn"] : [], notes: [], gear: g.id };
  }
}

/** An operation as the gate reads it, every field there (the AI service's JSON may leave empty ones out). */
function completeOp(op: Partial<WorldOp> & Pick<WorldOp, "op">): WorldOp {
  return { what: "", to: "", how: "", name: "", kind: "", text: "", add: [], remove: [], ...op };
}

function keepPlayer(world: SceneWorld, turn: number): void {
  const me = world.entities.player;
  if (!me?.states.includes("gone")) return;
  me.states = me.states.filter(s => s !== "gone");
  world.log.push({ turn, text: "(not done) remove: the player leaves only by walking out", by: "stage" });
}
