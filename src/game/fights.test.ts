import assert from "node:assert/strict";
import { test } from "node:test";
import { sceneById } from "../../scenes/index.ts";
import { presentCast } from "../runtime/brief.ts";
import { forceEnding } from "../runtime/engine.ts";
import type { SessionState } from "../runtime/session.ts";
import { applyOps, buildWorld, joinWorld, type WorldOp } from "../world/scene-world.ts";
import { pregenSession } from "./combat/pregen.ts";
import { encounterFor, TacticalFight } from "./combat/index.ts";
import { mapFights } from "./fights.ts";
import { battlefield } from "./map/index.ts";
import type { GameState } from "./play.ts";
import { fightView } from "./views.ts";
import { toPlain } from "./map/index.ts";

/**
 * The Heron fight on the map module's Heron, set up from the scene's world: everyone starts where
 * the world has them, the lanterns and braziers are the fight's to knock over, the dusty floor is
 * the dust, and when it's over the world shows where everyone ended up.
 */

const BLANK = { what: "", to: "", how: "", name: "", kind: "", text: "", add: [], remove: [] };

async function heronAtMidnight(seed = 3): Promise<SessionState> {
  const session = await pregenSession({ pregen: "fighter", level: 3, seed });
  Object.assign(session, { sceneId: "heron-warehouse", beat: "midnight", entered: ["sallow"] });
  session.established.push("Master Sallow has come to the Heron.");
  const scene = sceneById("heron-warehouse");
  const cast = presentCast(scene, session);
  session.world = buildWorld(scene.id, scene.world!, cast.map(c => ({ id: c.id, name: c.name })), session.player);
  joinWorld(session.world, cast.map(c => ({ id: c.id, name: c.name, ...(c.members ? { members: c.members } : {}) })), 0);
  return session;
}

const field = (session: SessionState) => {
  const b = battlefield(session.sceneId, session.world!)!;
  return { map: b.map, at: b.people, props: b.lights, dust: b.dust, fuel: b.fuel };
};

test("the battlefield: the world's lights, its dusty floor, what burns, and doors as the world has them", async () => {
  const session = await heronAtMidnight();
  const b = battlefield("heron-warehouse", session.world!)!;
  for (const id of ["saul-brazier", "floor-brazier", "lantern-west", "lantern-east", "boys-lantern"]) assert.ok(b.lights.some(l => l.id === id), `${id} is a light`);
  assert.ok(b.lights.every(l => l.kind === "object" && (l.id === "boys-lantern" ? l.ref === "lantern-boy" : !l.ref)), "lights stand where they are (only the boy carries his)");
  assert.ok(b.dust.length > 40 && b.dust.every(t => t.x >= 9 && t.x <= 18), "the dust is the re-sacking floor");
  assert.ok(b.fuel.length >= 6, "the sack stacks burn");
  const land = b.map.tiles[5]![8]!;
  assert.equal(land.terrain, "door");
  assert.ok(land.blocks, "the land door is barred, as the world has it");
  applyOps(session.world!, [{ ...BLANK, op: "state", what: "land-door", add: ["open"], remove: ["closed", "barred"] } as WorldOp], 1);
  const opened = battlefield("heron-warehouse", session.world!)!;
  assert.ok(!opened.map.tiles[5]![8]!.blocks && !opened.map.tiles[6]![8]!.blocks, "opened in the world, both leaves open on the map");
  const stack = b.obstacles.find(o => o.id === "wheat-ear-sacks")!;
  assert.ok(b.map.tiles[stack.at.y]![stack.at.x]!.blocks, "the sack stacks stand in the way in a fight");
});

test("everyone starts where the world has them; Sallow's people by him; the land door opens if the sides can't reach each other", async () => {
  const session = await heronAtMidnight();
  // The player and Kell inside on the floor, Sallow and the Crakes out on the wharf behind the barred door.
  applyOps(session.world!, [{ ...BLANK, op: "move", what: "player", to: "floor" }, { ...BLANK, op: "move", what: "kell", to: "floor" }] as WorldOp[], 1);
  forceEnding(session, "fight");
  const b = battlefield("heron-warehouse", session.world!)!;
  const setup = encounterFor(session, { field });
  const at = (id: string) => setup.combatants.find(c => c.id === id)!.at;
  assert.deepEqual(at("player"), b.people.player);
  assert.deepEqual(at("sallow"), b.people.sallow);
  assert.ok(Math.max(Math.abs(at("crake-1").x - at("sallow").x), Math.abs(at("crake-1").y - at("sallow").y)) <= 3, "a Crake at Sallow's side");
  assert.ok(!setup.map.tiles[5]![8]!.blocks, "the land door is thrown open: the fight can reach the player");
  assert.ok(setup.props!.some(p => p.id === "lantern-west"), "the hanging lanterns are props");
});

test("the fight through the play loop: paced turns, the result, and the world written back", async () => {
  const session = await heronAtMidnight(5);
  forceEnding(session, "fight");
  const game: GameState = { version: 1, id: "t", mode: "combat", story: { time: "night", played: [], flags: {} }, explore: {}, recent: [] };
  const fights = mapFights();
  const paced: number[] = [];
  fights.pace = async lines => { paced.push(lines.length); };
  const fight = await fights.start(game, session);
  assert.ok(fight instanceof TacticalFight);
  const lines = toPlain(fightView(fight.controller, session, { w: 80, h: 24 }));
  assert.match(lines, /@/, "the fight is drawn on the map with the player in it");
  for (let i = 0; i < 80 && !fight.result(); i++) await fight.act("auto");
  const result = fight.result();
  assert.ok(result, "the fight ends");
  assert.ok(paced.length > 0, "the other side's turns were paced one at a time");
  const G = fight.controller.state();
  const me = G.units[G.pc]!;
  const feet = session.world!.entities.player!.at!;
  assert.deepEqual({ x: Math.floor(feet.x / 5) + 2, y: Math.floor(feet.y / 5) + 1 }, me.at, "the world has the player where the fight left them");
  const crake = session.world!.entities["crake-1"]!;
  assert.ok(crake.states.some(s => ["down", "surrendered", "hurt", "badly hurt", "dead", "gone", "arrested"].includes(s)) || G.units["crake-1"]!.state === "fighting");
});
