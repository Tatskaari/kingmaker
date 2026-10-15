import { carryGear, hazard } from "../../rules/dnd.ts";
import { carriedBy } from "../../runtime/engine.ts";
import type { SessionState } from "../../runtime/session.ts";
import { startingPurse } from "../../world/inventory.ts";
import { applyOps, areaAt, areaOf, buildWorld, positionOf, tick, type Entity, type SceneWorld, type WorldOp } from "../../world/scene-world.ts";
import { castOf } from "../map/looks.ts";
import type { ExploreState } from "../map/explore.ts";
import type { GameState } from "../play.ts";
import { op, point, zooOf, type Ctx, type Wing } from "./model.ts";

/**
 * The wings' worlds, and the player in them. A wing's world is live on its map all the time (the
 * explore state's roam), with the exhibits' things and people in it. The player's own things are
 * carried as the story carries them between scenes (the session's carried things: the sheet's purse
 * reads them), and go into a wing's world only while the player does something there: then the
 * player stands in it where they stand on the map, with everything they carry, and the session's
 * world is the wing's, so the rules reach it exactly as they reach a scene's.
 */

/** A wing's world, fresh: its things where its spec has them, its people, the cast among them by their ids. */
export function freshWorld(wing: Wing, player: { name: string }): SceneWorld {
  const cast = Object.keys(wing.world.people).filter(id => id !== "player" && (wing.cast?.[id] || castOf(id)))
    .map(id => ({ id, name: wing.cast?.[id]?.name ?? castOf(id)!.name, ...(wing.cast?.[id]?.description ? { description: wing.cast[id]!.description! } : {}) }));
  const world = buildWorld(wing.id, wing.world, cast, player);
  for (const [id, stats] of Object.entries(wing.stats ?? {})) if (world.entities[id]) world.entities[id]!.stats = { ...stats };
  wing.setup?.(world);
  return world;
}

const COIN = /pennies|shillings|crowns/;

/**
 * What the player carries, as a scene's world would have them carry it: a purse to start with, and
 * their gear (weapons, armour, a shield) as things, so it can be handed over and the sheet follows.
 * Gear a new build doesn't have any more is put away; the new build's comes out.
 */
export function outfit(session: SessionState): void {
  const gear = new Set((session.rules?.gear ?? []).map(g => g.id));
  const carried = (session.carried ?? []).filter(e => !e.gear || gear.has(e.gear));
  if (!carried.some(e => COIN.test(e.name))) {
    for (const coin of startingPurse()) carried.push({ id: coin.name.replace(/\s+/g, "-"), name: coin.name, kind: "item", parent: "player", tags: [], states: [], notes: [], quantity: coin.quantity, description: coin.description });
  }
  const first = session.player.name.split(" ")[0]!;
  for (const g of session.rules?.gear ?? []) {
    if (session.rules?.gone?.includes(g.id) || carried.some(e => e.gear === g.id)) continue;
    let id = `${first}-${g.name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    for (let n = 2; carried.some(e => e.id === id); n++) id = `${id}-${n}`;
    carried.push({ id, name: `${first}'s ${g.name.toLowerCase()}`, kind: "item", parent: "player", tags: [g.kind], states: g.slot ? [g.slot === "mainHand" || g.slot === "offHand" ? "in hand" : "worn"] : [], notes: [], gear: g.id });
  }
  session.carried = carried;
}

/**
 * Do something in a wing with the player in its world: where they stand on the map, carrying what
 * they carry, the session's world the wing's for the while (the rules read and write it there).
 * Afterwards what they carry comes back out with them, whatever changed hands.
 */
export async function inWing<T>(game: GameState, session: SessionState, ex: ExploreState, wing: Wing, fn: (z: Ctx) => T | Promise<T>): Promise<T> {
  const world = ex.roam?.[wing.id];
  if (!world) throw new Error(`The ${wing.name} has no world (the zoo's state is missing it)`);
  const zoo = zooOf(game);
  const me = world.entities.player ?? (world.entities.player = { id: "player", name: session.player.name, kind: "person", parent: world.root, tags: [], states: [], notes: [], player: true });
  me.at = point(ex.at);
  me.parent = areaAt(world, me.at).id;
  me.states = me.states.filter(s => s !== "gone");
  for (const e of session.carried ?? []) world.entities[e.id] = { ...e, parent: e.parent && session.carried!.some(c => c.id === e.parent) ? e.parent : "player" };
  delete session.carried;
  const was = session.world;
  session.world = world;
  const z: Ctx = {
    game, session, ex, zoo, wing, world, turn: zoo.turns[wing.id] ?? 1,
    ops: ops => {
      const { changes, problems } = applyOps(world, ops.map(o => op(o) as WorldOp), z.turn, "stage");
      for (const p of problems) world.log.push({ turn: z.turn, text: `(not done) ${p}`, by: "stage" });
      return [...changes, ...problems.map(p => `(not done) ${p}`)];
    },
    tick: () => {
      const turn = (zoo.turns[wing.id] = (zoo.turns[wing.id] ?? 1) + 1);
      z.turn = turn;
      return tick(world, turn, session.seed + 31337 * turn);
    },
    at: id => { const p = positionOf(world, id); if (!p) throw new Error(`${id} isn't in the ${wing.name}`); return p; },
    thing: id => { const e = world.entities[id]; if (!e) throw new Error(`${id} isn't in the ${wing.name}`); return e; },
  };
  try {
    return await fn(z);
  } finally {
    session.carried = carriedBy(world.entities, "player");
    for (const e of session.carried) delete world.entities[e.id];
    if (was && was !== world) session.world = was; else delete session.world;
  }
}

/** A turn of story time in a wing, with the player's part in it: an explosion they're standing in catches them (a save, as in a scene). */
export async function passTurn(z: Ctx): Promise<string[]> {
  const lines = z.tick();
  const here = areaOf(z.world, "player");
  if (z.session.rules && here?.states.includes("exploded") && lines.some(l => /explosion/i.test(l))) {
    const blast = await hazard(z.session, "fire", "serious").catch(() => undefined);
    if (blast) lines.push(...blast.lines);
  }
  return lines;
}

/** Gear the world moved away from the player, or back, changes their sheet (as after a scene's turn). */
export async function syncGear(z: Ctx): Promise<string[]> {
  const out: string[] = [];
  for (const e of Object.values(z.world.entities).filter(x => x.gear)) {
    let holder = e.parent ? z.world.entities[e.parent] : undefined;
    for (let n = 0; n < 20 && holder && holder.kind !== "person" && holder.kind !== "area" && holder.kind !== "place" && holder.parent; n++) holder = z.world.entities[holder.parent];
    const carried = holder?.player === true && !e.states.includes("destroyed") && !e.states.includes("gone");
    const line = await carryGear(z.session, e.gear!, carried).catch(() => undefined);
    if (line) out.push(line);
  }
  return out;
}

/** The newest entity with this name (what a create op just made). */
export const made = (world: SceneWorld, name: string): Entity | undefined =>
  Object.values(world.entities).filter(e => e.name === name).sort((a, b) => (b.created ?? -1) - (a.created ?? -1))[0];
