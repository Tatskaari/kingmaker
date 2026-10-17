// Adapted from the prototype's src/game/town.test.ts at 44c6d4a: the town explorer as the simulation drives it, on an ExploreState made from rows (exploreOf) and written back (exploreRowOf), where the prototype's drove it on the game and the session. The yard's rows are its place file built with its cast, as the simulation keeps a waiting place (and, after its scene, a played one); the maps are the campaign's files. Talks, the action menu, fights and observe aren't the copy's (V11, V10, V12, the client's), so their tests aren't here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PlaceFile, SceneFile } from "../scene/files.ts";
import { sceneOf } from "../scene/load.ts";
import { strangers } from "../scene/names.ts";
import { keysFor, pcKey, rowsToWorld, worldToRows, type PlaceRows } from "../world/rows.ts";
import { buildWorld, type SceneWorld } from "../world/scene-world.ts";
import { actorsHere, leaveScene } from "./explore.ts";
import { CAST } from "./looks.ts";
import { exploreOf, exploreRowOf, type ExploreRow, type MapPlace, type MapRows } from "./rows.ts";
import type { MapFile } from "./tiles.ts";
import { act, actions, actionsAt, targets, Unavailable } from "./town.ts";

const CAMPAIGN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const read = (path: string) => JSON.parse(readFileSync(join(CAMPAIGN, path), "utf8"));
const MAPS = (read("campaign.json").maps as string[]).map(key => read(`maps/${key}.json`)) as MapFile[];
const YARD = read("places/granary-yard.json") as PlaceFile;
const YARD_RECT = { x: 40, y: 11, w: 7, h: 6 };
const inYard = (p: { x: number; y: number }) => p.x >= YARD_RECT.x && p.y >= YARD_RECT.y && p.x < YARD_RECT.x + YARD_RECT.w && p.y < YARD_RECT.y + YARD_RECT.h;

/** The yard's rows, as the simulation keeps them: its place file built with its cast, and the walker's character in it once they've played it. */
function yardRows(options: { player?: boolean; edit?: (w: SceneWorld) => void } = {}): PlaceRows {
  const world = buildWorld("hanged-clerk", YARD, ["kell", "cob", "moll"].map(id => ({ id, name: CAST[id]!.name })), { name: "Wren Ashdown" });
  if (!options.player) delete world.entities.player;
  options.edit?.(world);
  return worldToRows(world, keysFor("granary-yard", "hanged-clerk", pcKey("1")));
}

const yard = (status: string, rows = yardRows()): MapPlace => ({ key: "granary-yard", mapKey: "caerwyn", region: "granary-yard", origin: { x: 40, y: 9 }, scene: { key: "hanged-clerk", status, time: "morning" }, rows });

const row = (over: Partial<ExploreRow> = {}): ExploreRow => ({
  playerId: "1", gameId: "1", map: "caerwyn", at: { x: 42, y: 9 }, facing: { x: 0, y: 1 }, steps: 0, hidden: false, followers: [], quips: 0, styles: [], acts: 0, said: "", log: [], ...over,
});

/** The lane in the morning, the yard waiting: a new game's rows. */
const morning = (over: Partial<ExploreRow> = {}): MapRows => ({ maps: MAPS, explore: row(over), story: { time: "morning", lead: "hanged-clerk", played: [] }, places: [yard("waiting")], unheard: [] });

/** After the hanged clerk: the yard as play left it (the walker's character in it), the lead where it was (V3 moves it on). */
const after = (over: Partial<ExploreRow> = {}, edit?: (w: SceneWorld) => void): MapRows => ({
  maps: MAPS, explore: row(over), story: { time: "morning", lead: "hanged-clerk", played: ["hanged-clerk"] }, places: [yard("ended", yardRows({ player: true, ...(edit ? { edit } : {}) }))], unheard: [],
});

test("the lane in the morning, from rows: Kell waits in the yard, and what's in sight goes by the QA console's ids", () => {
  const ex = exploreOf(morning());
  assert.deepEqual([ex.map, ex.at, ex.story.time, ex.story.lead], ["caerwyn", { x: 42, y: 9 }, "morning", "hanged-clerk"]);
  assert.ok(ex.waiting?.["hanged-clerk"], "the yard's world, from its rows");
  const kell = actorsHere(ex).find(a => a.ref === "kell");
  assert.equal(kell?.interaction?.kind, "scene", "Kell waits for the player: talking to her opens the scene");
  assert.ok(targets(ex, []).some(t => t.id === "talk_kell"));
  const ids = actions(ex, []).map(a => a.id);
  for (const id of ["go_to_lead", "talk_kell", "enter_granary_yard", "walk_north", "look"]) assert.ok(ids.includes(id), `${id} in ${ids.join(", ")}`);
  assert.equal(new Set(ids).size, ids.length, "action ids are unique");
  assert.ok(!ids.some(id => /satchel|loose_board|body|prout/.test(id)), "the yard's clues wait for the scene");
  // Walking a step works, and is written back.
  const done = act(ex, [], "walk_west");
  const written = exploreRowOf(ex, row(), done.text);
  assert.deepEqual([written.at, written.acts], [{ x: 41, y: 9 }, 1]);
  assert.deepEqual(exploreOf({ ...morning(), explore: JSON.parse(JSON.stringify(written)) as ExploreRow }).at, { x: 41, y: 9 });
});

test("go to the lead walks through the gate into the yard, and the hanged clerk opens", () => {
  const ex = exploreOf(morning());
  const done = act(ex, [], "go_to_lead");
  assert.equal(done.scene, true, done.text);
  assert.match(done.text, /^You walk \d+ steps? towards the granary yard\./);
  assert.ok(inYard(ex.at), `in the yard (${ex.at.x}, ${ex.at.y})`);
});

test("talking to Kell by her id walks over and opens the hanged clerk; examining townsfolk says something", () => {
  const ex = exploreOf(morning());
  const porter = targets(ex, []).find(t => t.id.startsWith("talk_porter"));
  assert.ok(porter, "a porter about in the lane");
  const said = act(ex, [], porter!.id);
  assert.ok(!said.scene && /Shocking business/.test(said.text), said.text);
  const done = act(ex, [], "talk_kell");
  assert.equal(done.scene, true, done.text);
  assert.match(done.text, /You go over to Sergeant Kell\./);
  // A right-click on her offers the same.
  const kell = actorsHere(exploreOf(morning())).find(a => a.ref === "kell")!;
  assert.deepEqual(actionsAt(exploreOf(morning()), [], kell.at).actions[0], { id: "talk_kell", label: "Talk to Sergeant Kell", kind: "talk" });
});

test("the Rat's door is shut in the morning, however it's tried, and nothing moves; at dusk it opens", () => {
  for (const id of ["walk_east", "travel_drowned_rats_door", "interact", "travel@26,35", "door@26,35"]) {
    const ex = exploreOf(morning({ at: { x: 25, y: 35 }, facing: { x: 1, y: 0 } }));
    const done = act(ex, [], id);
    assert.match(done.text, /OPENS AT DUSK/, `${id}: ${done.text}`);
    assert.deepEqual([ex.map, ex.at], ["caerwyn", { x: 25, y: 35 }], `${id}: nothing moves`);
  }
  // The palace gate too: the guards cross their halberds.
  const gate = exploreOf(morning({ at: { x: 11, y: 13 }, facing: { x: 0, y: -1 } }));
  assert.match(act(gate, [], "travel_through_the_palace_gate").text, /halberds/);
  assert.equal(gate.map, "caerwyn");
  const dusk = exploreOf({ ...after({ at: { x: 25, y: 35 } }), story: { time: "evening", lead: "drowned-rat", played: ["hanged-clerk"] } });
  act(dusk, [], "travel_drowned_rats_door");
  assert.equal(dusk.map, "drowned-rat");
});

test("both sides build the same state from the same rows: the GM's notes make no difference", () => {
  const rows = morning();
  assert.ok(rows.places[0]!.rows.gmNote.length > 0, "the yard's rows have the GM's notes");
  const noNotes: MapRows = { ...rows, places: rows.places.map(p => ({ ...p, rows: { ...p.rows, gmNote: [] } })) };
  assert.deepEqual(exploreOf(rows), exploreOf(noNotes));
  assert.deepEqual(actions(exploreOf(rows), []), actions(exploreOf(noNotes), []));
});

test("after the scene: back where it left you, Kell at your side, the yard as play left it, and locked once you're out", () => {
  // The scene ends: the explore row still has it, the character where the world left them (the place file's start, in the yard).
  const ex = exploreOf(after({ scene: "hanged-clerk", at: { x: 42, y: 11 } }));
  const world = rowsToWorld(after().places[0]!.rows, keysFor("granary-yard", "hanged-clerk", pcKey("1")));
  leaveScene(ex, world);
  assert.equal(ex.scene, undefined);
  assert.ok(inYard(ex.at), `in the yard where the scene left the player (${ex.at.x}, ${ex.at.y})`);
  assert.equal(ex.followers[0]?.id, "kell", "Kell walks with the investigator now");
  assert.ok(Math.max(Math.abs(ex.followers[0]!.at.x - ex.at.x), Math.abs(ex.followers[0]!.at.y - ex.at.y)) <= 2, "beside them");
  // The yard as play left it: its things on the map, its people gone with the story.
  const left = actorsHere(ex).filter(a => a.id.startsWith("hanged-clerk:"));
  assert.ok(left.some(a => a.ref === "prout") && left.some(a => a.ref === "water-butt"), left.map(a => a.ref).join(", "));
  assert.ok(!left.some(a => a.kind === "person"), "people move on with the story");
  // The lead goes nowhere until the story moves on (V3), and once out of the yard there's no way back in.
  assert.equal(act(ex, [], "go_to_lead").text, "Nowhere to walk to: the story comes to you from here.");
  const out = exploreOf(after({ at: { x: 42, y: 10 } }));
  const locked = act(out, [], "walk_south");
  assert.match(locked.text, /locked up for the Assembly/);
  assert.deepEqual(out.at, { x: 42, y: 10 });
});

test("unknown and out-of-sight actions say so", () => {
  const ex = exploreOf(morning());
  assert.throws(() => act(ex, [], "talk_sallow"), Unavailable);
  assert.throws(() => act(ex, [], "open_door_sideways"), Unavailable);
  assert.throws(() => act(ex, [], "talk@30,30"), (e: unknown) => e instanceof Unavailable && /Unavailable action/.test(e.message), "nobody to talk to there");
});

test("people go by what the player would call them until their names are heard", () => {
  const scene = sceneOf(read("scenes/hanged-clerk/scene.json") as SceneFile);
  const hook = readFileSync(join(CAMPAIGN, "scenes", "hanged-clerk", "hook.md"), "utf8").trim();
  const unheard = strangers([scene], { transcript: [] }, [hook]);
  assert.deepEqual(unheard.map(u => u.called), ["the boy in the too-big boots", "the girl in the shawl", "the corporal"]);
  const ex = exploreOf(morning());
  const label = (id: string) => targets(ex, unheard).find(t => t.id === id)?.label;
  assert.equal(label("talk_cob"), "Talk to the boy in the too-big boots");
  assert.equal(label("talk_moll"), "Talk to the girl in the shawl");
  assert.equal(label("talk_kell"), "Talk to Sergeant Kell");
  // Once someone's said it, it's his name.
  const heard = strangers([scene], { transcript: [{ kind: "narration", text: "“Cob! Down off that wall.”" }] }, [hook]);
  assert.equal(targets(ex, heard).find(t => t.id === "talk_cob")?.label, "Talk to Cob");
});

test("coins a scene left on the cobbles can be picked up: off the map, and the simulation told what to take", () => {
  const coins = (w: SceneWorld) => { w.entities.pennies = { id: "pennies", name: "pennies", kind: "item", parent: "lane", at: { x: 22, y: 2 }, tags: [], states: [], notes: [], quantity: 3 }; };
  const ex = exploreOf(after({}, coins));
  const take = targets(ex, []).find(t => t.id === "take_pennies");
  assert.equal(take?.label, "Pick up 3 pennies");
  const done = act(ex, [], "take_pennies");
  assert.match(done.text, /You pick up 3 pennies\./);
  assert.deepEqual(done.take, { sceneId: "hanged-clerk", id: "pennies" });
  assert.ok(!targets(ex, []).some(t => t.id === "take_pennies"), "gone from the map");
});
