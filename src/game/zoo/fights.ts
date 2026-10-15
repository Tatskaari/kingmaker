import type { SessionState } from "../../runtime/session.ts";
import { areaAt, positionOf, type Entity, type SceneWorld } from "../../world/scene-world.ts";
import { engineReady, startCombat, TacticalFight, type TacticalFights } from "../combat/index.ts";
import { solid } from "../combat/grid.ts";
import { mapFights } from "../fights.ts";
import { battlefield, feetToTile, getMap, roamRegion, tileToFeet } from "../map/index.ts";
import type { Fight, GameState } from "../play.ts";
import { exploreState } from "../town.ts";
import type { CombatantSetup, CombatResult, CombatSetup, Tile2 } from "../types.ts";
import { ARENAS, type Arena } from "./arenas.ts";
import { onArenaOver } from "./explorer.ts";
import { zooOf } from "./model.ts";
import { ROOMS, wingOf, type Room } from "./wings/index.ts";
import { sceneById } from "../../../scenes/index.ts";
import { freshWorld } from "./world.ts";

/**
 * The zoo's fights, behind the play loop's FightFactory:
 *
 * - The arena's rings are fights started from the map (a bell rung by the gate): on the arena
 *   wing's own map, its world the session's while it lasts, everyone where the world has them, the
 *   ring's lanterns, brazier, grain dust and sacks in it, and the ring's gate the way out.
 * - A zoo scene's fight (the tavern's) is fought on its booth's floor: everyone where the scene's
 *   world has them, its lights to bring down, the booth's door the way out, Kell beside you if
 *   she's walking with you. The scene picks up from it afterwards, as the story's do.
 * - A rehearsal's fight is the story's own (src/game/fights.ts): the Heron on its floor, the others
 *   in a plain room.
 */

await engineReady();

export function zooFights(): TacticalFights {
  const story = mapFights();
  const factory: TacticalFights = {
    async start(game: GameState, session: SessionState): Promise<Fight> {
      const ring = game.fromMap ? zooOf(game).fight : undefined;
      const room = !ring && session.world ? ROOMS.find(r => r.sceneId === session.sceneId) : undefined;
      if (!ring && !room) return story.start(game, session);
      let setup: CombatSetup;
      if (ring) {
        const arena = ARENAS[ring.arena];
        if (!arena) throw new Error(`There's no ring called ${ring.arena} in the arena.`);
        setup = enterRing(game, session, arena);
      } else setup = roomFight(game, session, room!);
      const combat = await startCombat(setup, session);
      const fight = new TacticalFight(combat, [], () => factory.pace);
      fight.begin();
      return fight;
    },
    load: (saved, session) => story.load(saved, session),
  };
  // The app paces the other side's turns through whichever factory it was given: the story's fights hear it too.
  Object.defineProperty(factory, "pace", { get: () => story.pace, set: v => { story.pace = v; }, enumerable: true });
  return factory;
}

/** Free spots near where people want to stand, inside a rectangle of tiles. */
function placer(map: CombatSetup["map"], rect: { x: number; y: number; w: number; h: number }): (want: Tile2) => Tile2 {
  const taken: Tile2[] = [];
  const inside = (t: Tile2) => t.x >= rect.x && t.y >= rect.y && t.x < rect.x + rect.w && t.y < rect.y + rect.h;
  const free = (t: Tile2) => !solid(map, t) && !taken.some(o => o.x === t.x && o.y === t.y);
  return want => {
    for (let d = 0; d < 6; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      const t = { x: want.x + dx, y: want.y + dy };
      if (Math.max(Math.abs(dx), Math.abs(dy)) === d && inside(t) && free(t)) { taken.push(t); return t; }
    }
    taken.push(want);
    return want;
  };
}

/**
 * A zoo scene's fight, on its booth's floor: its ending's line-up (startCombat: the leader and how
 * many) from the scene's cast where its world has them, the booth's lights, its door the way out.
 */
function roomFight(game: GameState, session: SessionState, room: Room): CombatSetup {
  const world = session.world!;
  const scene = sceneById(session.sceneId);
  const field = battlefield(session.sceneId, world)!;
  const rect = room.rooms[0]!;
  const spot = placer(field.map, rect);
  const op = session.ended?.operations.find(o => o.op === "startCombat")?.args as { enemies?: Array<{ leader?: string; count?: number }> } | undefined;
  const wanted = op?.enemies?.[0];
  const where = (id: string) => field.people[id] ?? { x: rect.x + Math.floor(rect.w / 2), y: rect.y + Math.floor(rect.h / 2) };
  const combatants: CombatantSetup[] = [{ id: "player", name: session.player.name, side: "player", role: "player", at: spot(where("player")) }];
  if (game.story.flags.kell === true) combatants.push({ id: "kell", castId: "kell", name: "Sergeant Agnes Kell", side: "ally", role: "ally", statblock: "guard", weapon: "club", at: spot(where("player")) });
  // The leader first, then the rest of the cast who are there and can fight, up to the number the ending asked for.
  const present = scene.cast.filter(c => c.statblock && c.id !== "kell" && world.entities[c.id] && !world.entities[c.id]!.states.includes("gone"));
  const ordered = [...present.filter(c => c.id === wanted?.leader), ...present.filter(c => c.id !== wanted?.leader)];
  for (const c of ordered.slice(0, Math.max(1, wanted?.count ?? ordered.length))) {
    combatants.push({ id: c.id, castId: c.id, name: c.name, side: "enemy", role: c.id === wanted?.leader ? "bruiser" : "brawler", statblock: c.statblock!, ...(c.weapon ? { weapon: c.weapon } : {}), at: spot(where(c.id)) });
  }
  const inside = (t: Tile2) => t.x >= rect.x && t.y >= rect.y && t.x < rect.x + rect.w && t.y < rect.y + rect.h;
  const out = { x: room.door.x + (room.door.x - insideOf(rect, room.door).x), y: room.door.y + (room.door.y - insideOf(rect, room.door).y) };
  return {
    map: { ...field.map, exits: [{ at: room.door, to: { map: room.map, at: out }, label: `the door of ${room.name}` }] }, combatants, sceneId: session.sceneId,
    seed: (session.seed + 7907 * (session.rollCount + 1)) >>> 0,
    props: field.lights.filter(l => inside(l.at) || (l.ref && combatants.some(c => c.id === l.ref))), dust: field.dust.filter(inside), fuel: field.fuel.filter(inside),
  };
}

/** The tile just inside a room's door. */
function insideOf(rect: { x: number; y: number; w: number; h: number }, door: Tile2): Tile2 {
  const around = [[0, -1], [0, 1], [-1, 0], [1, 0]].map(([dx, dy]) => ({ x: door.x + dx!, y: door.y + dy! }));
  return around.find(t => t.x >= rect.x && t.y >= rect.y && t.x < rect.x + rect.w && t.y < rect.y + rect.h) ?? door;
}

/** The ring's people, lights, dust and floor as the zoo opened: each fight in a ring starts fresh. */
export function freshRing(world: SceneWorld, fresh: SceneWorld, arena: Arena): void {
  const r = arena.ring;
  const inRing = (w: SceneWorld, id: string) => {
    const p = positionOf(w, id);
    return !!p && p.x >= r.x * 5 && p.y >= r.y * 5 && p.x < (r.x + r.w) * 5 && p.y < (r.y + r.h) * 5;
  };
  // What the last fight left in the ring goes (spills, a scorch, someone the stage made), and the ring's own come back.
  for (const id of Object.keys(world.entities)) if (id !== "player" && !fresh.entities[id] && inRing(world, id)) delete world.entities[id];
  for (const [id, e] of Object.entries(fresh.entities)) if (id !== "player" && (inRing(fresh, id) || arena.enemies.some(x => x.id === id))) world.entities[id] = structuredClone(e) as Entity;
}

/** Into the ring: the arena's world becomes the session's, the ring set out fresh, the player at its start. */
function enterRing(game: GameState, session: SessionState, arena: Arena): CombatSetup {
  const ex = exploreState(game);
  const wing = wingOf(arena.wing);
  const world = ex.roam?.[arena.wing];
  if (!wing || !world) throw new Error(`The arena has no world (the zoo's state is missing ${arena.wing}).`);
  freshRing(world, freshWorld(wing, { name: session.player.name }), arena);
  const map = getMap(arena.wing);
  const region = roamRegion(map, world)!;
  const me = world.entities.player ?? (world.entities.player = { id: "player", name: session.player.name, kind: "person", parent: world.root, tags: [], states: [], notes: [], player: true });
  me.at = tileToFeet(region, arena.start);
  me.parent = areaAt(world, me.at).id;
  me.states = [];
  // The world is the fight's while it lasts (the fight writes its end into it), and comes back to the map after.
  delete ex.roam![arena.wing];
  session.world = world;
  const field = battlefield(arena.wing, world)!;
  const inside = (t: Tile2) => t.x >= arena.ring.x && t.y >= arena.ring.y && t.x < arena.ring.x + arena.ring.w && t.y < arena.ring.y + arena.ring.h;
  const spot = placer(field.map, arena.ring);
  const combatants: CombatantSetup[] = [{ id: "player", name: session.player.name, side: "player", role: "player", at: spot(arena.start) }];
  const kell = arena.kell || game.story.flags.kell === true;
  if (kell) combatants.push({ id: "kell", castId: "kell", name: "Sergeant Agnes Kell", side: "ally", role: "ally", statblock: "guard", weapon: "club", at: spot({ x: arena.start.x + 1, y: arena.start.y }) });
  for (const e of arena.enemies) {
    const person = world.entities[e.id];
    if (!person || person.states.includes("gone")) continue;
    const at = field.people[e.id] ?? feetToTile(region, positionOf(world, e.id) ?? tileToFeet(region, arena.start));
    combatants.push({ id: e.id, name: person.name, side: "enemy", role: e.role, statblock: e.statblock, ...(e.weapon ? { weapon: e.weapon } : {}), ...(e.castId ? { castId: e.castId } : {}), at: spot(at) });
  }
  // Only the ring's own lights, dust and sacks; its gate the one way out.
  const gate = { at: arena.gate, to: { map: arena.wing, at: arena.outside }, label: `the ${arena.name}'s gate` };
  return {
    map: { ...field.map, exits: [gate] }, combatants, sceneId: arena.wing, seed: (session.seed + 7919 * (session.rollCount + 1)) >>> 0,
    props: field.lights.filter(l => inside(l.at) || (l.ref && combatants.some(c => c.id === l.ref))),
    dust: field.dust.filter(inside), fuel: field.fuel.filter(inside),
  };
}

/**
 * Out of the ring: the arena's world goes back on the map as the fight left it (who's down, the
 * lanterns that fell, the floor burnt), and the player stands where they ended up, or outside the
 * gate if they left by it.
 */
onArenaOver((game: GameState, session: SessionState, result: CombatResult): string => {
  const z = zooOf(game);
  const ring = z.fight ? ARENAS[z.fight.arena] : undefined;
  delete z.fight;
  const ex = exploreState(game);
  const world = session.world;
  if (!ring || !world || world.scene !== ring.wing) return `The fight: ${result.summary}`;
  ex.roam = { ...(ex.roam ?? {}), [ring.wing]: world };
  delete session.world;
  const region = roamRegion(getMap(ring.wing), world)!;
  const me = world.entities.player;
  const fled = result.outcome === "fled";
  const at = !fled && me?.at ? feetToTile(region, me.at) : ring.outside;
  ex.map = ring.wing;
  ex.at = { ...at };
  delete ex.scene;
  for (const f of ex.followers) { f.map = ex.map; f.at = { ...ex.at }; }
  exploreState(game);
  const fell = result.casualties.filter(c => c.state !== "standing").map(c => `${c.name} ${c.state === "down" ? "is down" : c.state}`);
  return [`The fight in the ${ring.name}: ${result.summary}`, fell.length ? `${fell.join("; ")}.` : "", fled ? "You're out through the gate." : "The ring stays as the fight left it until its bell is rung again."].filter(Boolean).join(" ");
});
