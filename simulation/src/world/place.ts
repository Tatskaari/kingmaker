// openPlace's world (givePurse, giveGear) is copied from the prototype's src/runtime/engine.ts:171-189 at 44c6d4a: no history, no carried things, nothing owed yet, the purse and gear handed in from the campaign and the build. waitingPlace, joinPlace, builtWorld, handOut, withoutPlayer and inWorldOrder are the map unit's (claude/v2-map's world/place.ts, the same names and signatures), with what's owed (engine.ts:176, placeOwedThings) placed in the waiting place and what the player carries (engine.ts:174) joining with them, both moved from where they were (world/cross.ts).

import type { GmState } from "../../../shared/gm/state.ts";
import type { GearRow } from "../../../shared/rules/types.ts";
import type { CampaignFile, PlaceFile, WorldOpData } from "../../../shared/scene/files.ts";
import { presentCast } from "../../../shared/scene/graph.ts";
import type { Character, Scene } from "../../../shared/scene/types.ts";
import { inventory } from "../../../shared/world/inventory.ts";
import { fullKey, keysFor, opToLocal, pcKey, rowsToWorld, worldToRows, type Keys, type PlaceRows } from "../../../shared/world/rows.ts";
import { applyOps, buildWorld, joinWorld, type SceneWorld, type WorldOp } from "../../../shared/world/scene-world.ts";
import type { TxCtx } from "../context.ts";
import type { GameRow, PlayerRow, SceneRow } from "../rows.ts";
import { placeFileOf } from "../scenes.ts";
import { carriedFrom, dropEntity, owedInto } from "./cross.ts";
import { placeRows, writePlace } from "./rows-io.ts";
import { presentShown } from "./stage.ts";

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
 * The lead's place before its scene opens (map-design §3.3, story-design §4.3), written as rows: its
 * world built as openPlace builds it, the cast present at the scene's start where its file puts them
 * (the absent left out), but with no one playing in it yet. It's built with the player's character,
 * so everything else stands where it will when the scene opens, and then the character is taken out:
 * they join it when it opens (joinPlace). Those of the cast the game already has (Kell, from the
 * yard) move in, their entities kept, with what the story still owes the player that they hold (the
 * page in Cob's boot: owedInto); `renamed`, the owed things' keys as they move.
 */
export function waitingPlace(tx: TxCtx, game: GameRow, placeKey: string, graph: Scene, gm: GmState, host: PlayerRow): { placeId: bigint; renamed: Map<string, string>; owed: string[] } {
  const file = placeFileOf(tx, game, placeKey);
  const world = builtWorld(file, graph, gm, host.name);
  withoutPlayer(world);

  const keys = keysFor(file.key, graph.id, pcKey(host.id));
  const owed = owedInto(tx, game.id, world, gm.owed, keys, host.id);
  const written = writePlace(tx, inWorldOrder(worldToRows(world, keys), world, keys), { gameId: game.id, called: calledIn(graph), moving: owed.moving });
  return { placeId: written.placeId, renamed: owed.renamed, owed: owed.names };
}

/**
 * A waiting place's scene opens (map-design §3.5, story-design §4.3): the controller's character
 * joins the place as the rows have it, from wherever they were, with what they carry (engine.ts:174),
 * and what they start with is handed out when it's the game's first scene, as openPlace does it,
 * with their log's lines. The entities are then put in the order the prototype's openScene builds
 * them (entity.ord), the place's own first, so the world the opening's request carries is the one
 * the prototype's opening built. `renamed`: the keys the carried things had where they were.
 */
export function joinPlace(tx: TxCtx, game: GameRow, placeKey: string, graph: Scene, gm: GmState, controller: PlayerRow, start: Start | undefined, placeId: bigint): { placeId: bigint; characterId: bigint; world: SceneWorld; renamed: Map<string, string> } {
  const file = placeFileOf(tx, game, placeKey);
  const keys = keysFor(file.key, graph.id, pcKey(controller.id));
  const world = rowsToWorld(placeRows(tx, placeId), keys);

  const fresh = builtWorld(file, graph, gm, controller.name);
  const built = fresh.log.length;
  const carried = carriedFrom(tx, controller, fresh, keys);
  if (start) handOut(fresh, controller.name, start);
  world.entities = Object.fromEntries([
    ...Object.keys(fresh.entities).map(id => [id, carried.moving.has(`${keys.placeKey}/${id}`) ? fresh.entities[id]! : (world.entities[id] ?? fresh.entities[id]!)] as const),
    ...Object.entries(world.entities).filter(([id]) => !fresh.entities[id]),
  ]);
  world.log.push(...fresh.log.slice(built));

  // A carried thing in place of the place's own of the same id: the place's goes (the prototype's overwrite).
  for (const key of carried.replaced) {
    const own = [...tx.db.entity.placeId.filter(placeId)].find(e => e.key === key);
    if (own) dropEntity(tx, own.id);
  }
  const rows = placeRows(tx, placeId);
  const written = writePlace(tx, inWorldOrder(worldToRows(world, keys, rows), world, keys), { gameId: game.id, called: calledIn(graph), moving: carried.moving });
  return { placeId, characterId: written.idOf(keys.controller), world, renamed: carried.renamed };
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

/**
 * Whoever is on stage now, as the player has seen it, and not yet in the world (a cue's entrance,
 * once the reply that shows it is written: stage.ts presentShown) joins it at the way in. The names
 * of those who did.
 */
export function joinArrivals(world: SceneWorld, graph: Scene, gm: GmState, turn: number): string[] {
  return joinWorld(world, presentShown(graph, gm).map(personOf), turn);
}

/**
 * The stage manager's operations through the gate (applyOps, the prototype's own): at most 16, by
 * the world's local keys, each problem kept in the log as "(not done) …"; and a removal of the
 * player undone, since only walking out takes them out (engine.ts:917, 924-928): unless they did
 * (`left`, the read after the reply), when it stands.
 */
export function applyStage(place: PlaceWorld, ops: WorldOp[], turn: number, left = false): { changes: string[]; problems: string[] } {
  const local = ops.slice(0, MAX_OPS).map(op => opToLocal(completeOp(op), place.keys));
  const done = applyOps(place.world, local, turn, "stage");
  for (const problem of done.problems) place.world.log.push({ turn, text: `(not done) ${problem}`, by: "stage" });
  if (!left) keepPlayer(place.world, turn);
  return done;
}

/** What one of a scene file's operations came to: done, or not and why, in a few words ("give ledger-page"). */
export interface ScriptDone { said: string; done: boolean; why?: string }

/**
 * One of a scene file's world operations (an ending's effect: story/effects.ts) through the stage
 * manager's gate (applyOps, the prototype's own), so it does what the stage manager's of that op
 * does: a give puts the thing in the player's keeping (or a person's), a remove takes someone or
 * something off the place. As the author wrote it, by the world's own ids, `$player` the
 * controller's character; what it names must be in the world by that id (an "all …" selector as the
 * gate reads it), since the gate's loose matching is for a model's descriptions and would hand over a
 * stand-in for something that isn't here. By the rules, uncut; the player stays (only walking out
 * takes them out).
 */
export function scriptOp(place: PlaceWorld, data: WorldOpData, turn: number): ScriptDone {
  const op = completeOp({ ...data, what: playerIn(data.what), to: playerIn(data.to) });
  const said = `${op.op} ${op.what || op.name}`.trim();
  const named = [op.op === "create" || op.op === "spill" ? "" : op.what, op.to].filter(id => id && !/^all\b/i.test(id.trim()));
  const missing = named.find(id => !place.world.entities[id]);
  if (missing) return { said, done: false, why: `nothing here is ${missing}` };

  const done = applyOps(place.world, [op], turn, "rules");
  keepPlayer(place.world, turn);
  return done.problems.length ? { said, done: false, why: done.problems.join("; ") } : { said, done: true };
}

// ---------------------------------------------------------------------------------------------

/** `$player`, a scene file's name for the controller's character, as the world names them. */
const playerIn = (id: string | undefined) => (id?.trim() === "$player" ? "player" : (id ?? ""));

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

/** The player's character out of a world, and whatever they hold (through bags: positionOf's twelve holders at most). */
function withoutPlayer(world: SceneWorld): void {
  const theirs = (id: string | null, depth = 0): boolean => id === "player" || (!!id && depth < 12 && theirs(world.entities[id]?.parent ?? null, depth + 1));
  for (const id of Object.keys(world.entities).filter(id => theirs(id))) delete world.entities[id];
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
