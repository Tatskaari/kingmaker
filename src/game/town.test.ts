import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorld, joinWorld, type SceneWorld, type WorldSpec } from "../world/scene-world.ts";
import type { SessionState } from "../runtime/session.ts";
import { hangedClerkWorld } from "../../scenes/worlds/hanged-clerk.ts";
import { drownedRatWorld } from "../../scenes/worlds/drowned-rat.ts";
import { CAST, dressingRoomWorld, heronWorld } from "./map/index.ts";
import type { GameState } from "./play.ts";
import { exploreState, leadTarget, targets, town, townOf } from "./town.ts";
import { townText } from "./views.ts";

/**
 * The town explorer as the game core drives it (src/game/play.ts): observe, act on action ids, and
 * the scene hooks in the order the core calls them (enterScene as a scene opens; leaveScene with
 * the world still there; afterScene once the story has moved on). No model calls: scenes are
 * stand-ins that build their world and end.
 */

const WORLDS: Record<string, [WorldSpec, string[]]> = {
  "hanged-clerk": [hangedClerkWorld, ["kell", "cob", "moll"]],
  "drowned-rat": [drownedRatWorld, ["kell", "nan-quill", "arlo", "dilly", "hobb", "cob"]],
  "heron-warehouse": [heronWorld, ["kell", "saul", "hep", "scrope", "hobb"]],
  "kings-morning": [dressingRoomWorld, ["kell", "king", "holt"]],
};
const NEXT: Record<string, { lead?: string; time?: GameState["story"]["time"] }> = {
  "hanged-clerk": { lead: "drowned-rat", time: "evening" }, "drowned-rat": { lead: "heron-warehouse", time: "night" },
  "heron-warehouse": { lead: "kings-morning", time: "next-morning" }, "kings-morning": {},
};

function newGame(): { game: GameState; session: SessionState } {
  const game: GameState = { version: 1, id: "test", mode: "explore", story: { time: "morning", played: [], lead: "hanged-clerk", flags: {} }, explore: {}, recent: [] };
  const session = { id: "test", sceneId: "hanged-clerk", history: [], player: { name: "Tester", concept: "", modifiers: {} } } as unknown as SessionState;
  town.start(game);
  return { game, session };
}

/** Act, as the core does: an action that opens the scene opens it (enterScene, then the scene's world). */
function act(game: GameState, session: SessionState, id: string): { text: string; scene?: boolean } {
  const done = town.act(game, session, id);
  if (done.scene) {
    game.mode = "scene";
    town.enterScene!(game, session);
    const [spec, cast] = WORLDS[session.sceneId]!;
    const people = cast.map(c => ({ id: c, name: CAST[c]!.name }));
    session.world = buildWorld(session.sceneId, spec, people, { name: "Tester" }) as SceneWorld;
    joinWorld(session.world, people, 0);
  }
  return done;
}

/** The scene ends: the explorer keeps the world, then the story moves on (as the core's afterScene and onward do). */
function endScene(game: GameState, session: SessionState): void {
  game.story.played.push(session.sceneId);
  town.leaveScene!(game, session);
  (session.history as Array<{ sceneId: string }>).push({ sceneId: session.sceneId });
  delete session.world;
  const next = NEXT[session.sceneId]!;
  if (next.lead) { session.sceneId = next.lead; game.story.lead = next.lead; game.story.time = next.time!; game.mode = "explore"; }
  else { delete game.story.lead; game.mode = "end"; }
  town.afterScene!(game, session);
}

/** go_to_lead until the scene opens (a few goes: through a door to another map, then on). */
function walkToLead(game: GameState, session: SessionState): string[] {
  const said: string[] = [];
  for (let i = 0; i < 6 && game.mode === "explore"; i++) {
    assert.ok(town.actions(game, session).some(a => a.id === "go_to_lead"), `go_to_lead is offered (${session.sceneId}, try ${i + 1})`);
    said.push(act(game, session, "go_to_lead").text);
  }
  assert.equal(game.mode, "scene", `the lead scene opened: ${said.join(" | ")}`);
  return said;
}

test("the explorer's state is plain JSON in the game, and observe shows the map, where you are, the lead and what's in sight", () => {
  const { game, session } = newGame();
  const o = town.observe(game, session);
  assert.match(o, /Caerwyn: the granary lane, morning/);
  assert.match(o, /@/, "the iso view has the player");
  assert.match(o, /The story is heading for The Hanged Clerk/);
  assert.match(o, /About: Sergeant Kell/);
  assert.match(o, /Further off: .*a porter/);
  assert.ok(!town.actions(game, session).some(a => /satchel|loose_board|body/.test(a.id)), "the yard's clues wait for the scene");
  const copy = JSON.parse(JSON.stringify(game)) as GameState;
  assert.deepEqual(townOf(copy).ex.at, townOf(game).ex.at);
  const ids = town.actions(game, session).map(a => a.id);
  for (const id of ["go_to_lead", "talk_kell", "walk_north", "look"]) assert.ok(ids.includes(id), `${id} in ${ids.join(", ")}`);
  assert.equal(new Set(ids).size, ids.length, "action ids are unique");
  // Walking a step works and is remembered.
  const before = { ...townOf(game).ex.at };
  act(game, session, "walk_west");
  assert.notDeepEqual(townOf(game).ex.at, before);
  assert.match(town.observe(game, session), /Recently:|granary lane/);
});

test("talking to Kell by her id walks over and opens the hanged clerk; examining townsfolk says something", () => {
  const { game, session } = newGame();
  const porter = targets(game, session).find(t => t.id.startsWith("talk_porter"));
  assert.ok(porter, "a porter about in the lane");
  const said = act(game, session, porter!.id);
  assert.ok(!said.scene && /Shocking business/.test(said.text), said.text);
  const done = act(game, session, "talk_kell");
  assert.equal(done.scene, true, done.text);
  assert.equal(exploreState(game).scene, "hanged-clerk");
  assert.match(townText(game, session, { w: 80, h: 24 }), /@/, "the scene view has the player in the yard");
});

test("the whole arc on foot: the granary, dusk at the Rat, the Heron at night, the King's morning (a summons), The End", () => {
  const { game, session } = newGame();
  walkToLead(game, session);
  assert.equal(session.sceneId, "hanged-clerk");
  endScene(game, session);
  const ex = exploreState(game);
  assert.equal(ex.story.time, "evening");
  assert.equal(ex.followers[0]?.id, "kell", "Kell walks with the investigator now");
  assert.ok(!ex.scene && ex.map === "caerwyn", "back in the town");
  assert.match(town.observe(game, session), /The story is heading for The Drowned Rat/);

  // Dusk: across town, through the Rat's door, into the Rat.
  const rat = walkToLead(game, session);
  assert.ok(rat.some(s => /Drowned Rat/.test(s)), rat.join(" | "));
  assert.equal(exploreState(game).scene, "drowned-rat");
  endScene(game, session);
  assert.equal(exploreState(game).story.time, "night");

  // Night: out of the Rat (wherever the scene left you), down to the wharves, along to the Heron.
  walkToLead(game, session);
  assert.equal(exploreState(game).scene, "heron-warehouse");
  endScene(game, session);

  // The King's morning is a summons: the core opens it straight away.
  assert.equal(leadTarget(game)?.label, "the palace");
  game.mode = "scene";
  town.enterScene!(game, session);
  assert.equal(exploreState(game).map, "palace");
  endScene(game, session);
  assert.equal(game.mode, "end");
  assert.deepEqual(exploreState(game).story.played, ["hanged-clerk", "drowned-rat", "heron-warehouse", "kings-morning"]);
});

test("between scenes, talking to someone who walks with you stops for a word with them (a talk), not the story's scene", () => {
  const { game, session } = newGame();
  walkToLead(game, session);
  endScene(game, session);
  assert.equal(exploreState(game).followers[0]?.id, "kell");
  assert.ok(town.actions(game, session).some(a => a.id === "talk_kell"), "Kell is there to talk to");
  const at = { ...exploreState(game).at };
  const done = town.act(game, session, "talk_kell");
  assert.deepEqual(done.talk?.with, "kell", done.text);
  assert.ok(!done.scene, "the story's scene waits");
  assert.match(done.text, /You go over to Sergeant Kell/);
  assert.match(done.talk!.where, /Caerwyn, evening$/);
  assert.deepEqual(exploreState(game).at, at, "Kell is beside you: no walk");
  assert.equal(game.story.lead, "drowned-rat", "the lead stays the lead");
  // The app's e does the same.
  const facing = exploreState(game).followers[0]!.at;
  exploreState(game).facing = { x: Math.sign(facing.x - at.x), y: Math.sign(facing.y - at.y) };
  assert.equal(town.act(game, session, "interact").talk?.with, "kell");
});

test("a scene's place keeps what the scene did to it (leaveScene before the world goes)", () => {
  const { game, session } = newGame();
  walkToLead(game, session);
  const world = session.world!;
  const elm = Object.values(world.entities).find(e => /elm/.test(e.name));
  if (elm) elm.states.push("burning");
  endScene(game, session);
  const overlay = townOf(game).ex.overlay.scenes["hanged-clerk"];
  assert.ok(overlay, "the overlay has the granary yard");
  if (elm) assert.ok(overlay!.things.some(t => (t.states ?? []).includes("burning")), "the burning elm is remembered");
});

test("unknown and out-of-sight actions say so", () => {
  const { game, session } = newGame();
  assert.throws(() => town.act(game, session, "talk_sallow"), /Unavailable action/);
  assert.throws(() => town.act(game, session, "open_door_sideways"), /Unavailable action/);
});
