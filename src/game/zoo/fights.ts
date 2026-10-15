import { rest } from "../../rules/dnd.ts";
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
 * - A fight that breaks out in a wing (the action menu's violence, and a guard about: src/game/menu.ts)
 *   is set out where everyone stands, as the town's is, and its end is kept in the wing's world.
 */

await engineReady();

export function zooFights(): TacticalFights {
  const story = mapFights();
  const factory: TacticalFights = {
    async start(game: GameState, session: SessionState): Promise<Fight> {
      const ring = game.fightOnMap ? zooOf(game).fight : undefined;
      const room = !ring && session.world ? ROOMS.find(r => r.sceneId === session.sceneId) : undefined;
      if (!ring && !room) return story.start(game, session);
      let setup: CombatSetup;
      if (ring) {
        const arena = ARENAS[ring.arena];
        if (!arena) throw new Error(`There's no ring called ${ring.arena} in the arena.`);
        // Every ring starts fresh, the visitor too: the attendants patch you up and hand your slots back (a night's rest).
        await rest(session, "long");
        // The ring's own people come back whole as well: the rules make them afresh, as at their first fight.
        fresh(session, [...arena.enemies.flatMap(e => (e.castId ? [e.castId] : [])), "kell"]);
        setup = enterRing(game, session, arena);
      } else {
        // Kell comes to a booth's fight patched up after the last one (the scene's own people keep their bruises).
        fresh(session, ["kell"]);
        setup = roomFight(game, session, room!);
      }
      const combat = await startCombat(setup, session);
      const fight = new TacticalFight(combat, [], () => factory.pace);
      fight.begin();
      return fight;
    },
    load: (saved, session) => story.load(saved, session),
    // A fight that broke out in a wing, as it stands: the story's way of setting one out.
    startWith: (setup, session) => story.startWith!(setup, session),
  };
  // The app paces the other side's turns through whichever factory it was given: the story's fights hear it too.
  Object.defineProperty(factory, "pace", { get: () => story.pace, set: v => { story.pace = v; }, enumerable: true });
  return factory;
}

/**
 * The rules forget who these people were in the last fight: the next fight makes them afresh from
 * their statblocks, at full health and with nothing on them (a ring's fighters, Kell).
 */
function fresh(session: SessionState, castIds: string[]): void {
  for (const id of castIds) if (session.rules?.npcs[id]) delete session.rules.npcs[id];
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
  if (game.story.flags.kell === true) {
    combatants.push({ id: "kell", castId: "kell", name: "Sergeant Agnes Kell", side: "ally", role: "ally", statblock: "guard", weapon: "club", at: spot(where("player")) });
    // The booth's scene was written without her: its GM hears who she is for the aftermath.
    const kell = "Sergeant Agnes Kell of the watch (she: forties, a rain cape, an oilcloth notebook, a truncheon she has never been seen to draw) came in with the player and fought at their side.";
    if (!session.established.includes(kell)) session.established.push(kell);
  }
  // The leader first, then the rest of the cast who are there and can fight, up to the number the ending asked for.
  const present = scene.cast.filter(c => c.statblock && c.id !== "kell" && world.entities[c.id] && !world.entities[c.id]!.states.includes("gone"));
  const ordered = [...present.filter(c => c.id === wanted?.leader), ...present.filter(c => c.id !== wanted?.leader)];
  for (const c of ordered.slice(0, Math.max(1, wanted?.count ?? ordered.length))) {
    combatants.push({ id: c.id, castId: c.id, name: c.name, side: "enemy", role: c.id === wanted?.leader ? "bruiser" : "brawler", statblock: c.statblock!, ...(c.weapon ? { weapon: c.weapon } : {}), at: spot(where(c.id)) });
  }
  const inside = (t: Tile2) => t.x >= rect.x && t.y >= rect.y && t.x < rect.x + rect.w && t.y < rect.y + rect.h;
  const out = { x: room.door.x + (room.door.x - insideOf(rect, room.door).x), y: room.door.y + (room.door.y - insideOf(rect, room.door).y) };
  return {
    map: { ...field.map, exits: [{ at: room.door, to: { map: room.map, at: out }, label: `the door of ${room.name}` }] }, combatants, sceneId: session.sceneId, place: room.name,
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
    map: { ...field.map, exits: [gate] }, combatants, sceneId: arena.wing, seed: (session.seed + 7919 * (session.rollCount + 1)) >>> 0, place: "the Arena",
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
  if (!ring) return afterBrawl(game, result);
  if (!world || world.scene !== ring.wing) return `The fight: ${result.summary}`;
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
  // The summary says who went down, gave up or ran: the ring's world has them so.
  const on = /\bpit$/.test(ring.name) ? "in" : "on";
  return [`The fight ${on} the ${ring.name}: ${result.summary}`, fled ? "You're out through the gate." : "The ring stays as the fight left it until its bell is rung again."].join(" ");
});

/**
 * A fight that broke out in a wing (its people came at the visitor, as the town's do): you stand
 * where it left you, and the wing's world keeps how it left its people (who went down lies where
 * they fell, who ran has gone, who gave up cowers) until the wing's lever puts it back.
 */
function afterBrawl(game: GameState, result: CombatResult): string {
  const ex = exploreState(game);
  const map = getMap(ex.map);
  const world = ex.roam?.[ex.map];
  const region = world ? roamRegion(map, world) : undefined;
  const at = result.positions?.["player"];
  if (at && !solid(map, at)) ex.at = { ...at };
  const fell: string[] = [];
  for (const c of world && region ? result.casualties : []) {
    const e = world!.entities[c.id];
    const states = c.state === "down" || c.state === "dead" ? ["down"] : c.state === "fled" ? ["gone"] : c.state === "surrendered" ? ["cowering"] : undefined;
    if (!e || !states) continue;
    e.states = [...e.states.filter(s => !["hurt", "badly hurt", "down", "unconscious", "prone", "cowering"].includes(s)), ...states];
    const there = result.positions?.[c.id];
    if (there && !states.includes("gone")) { e.at = tileToFeet(region!, there); e.parent = areaAt(world!, e.at).id; }
    if (states[0] === "down") fell.push(e.name);
  }
  const lies = fell.length ? `${fell.join(" and ").replace(/^./, ch => ch.toUpperCase())} ${fell.length === 1 ? "lies" : "lie"} where they fell, and will until the wing is put back.` : "";
  return [`The fight: ${result.summary}`, lies].filter(Boolean).join("\n\n");
}
