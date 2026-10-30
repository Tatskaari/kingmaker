import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  asCampaignFile, asMapFile, asPlaceFile, FormatError, loadMap, loadPlace, loadScenario, mapDocumentOf, mapPath, parseMap, parsePlace, parseScenario,
  placeDocumentOf, placePath, scenarioDocumentOf, scenarioPath, scenarioPathIn, type MapDocument, type PlaceDocument, type ScenarioDocument,
} from "./scenario.ts";

/** The scenario format (docs/scenario-format.md): Caerwyn's scenario, maps and places parsed, what's wrong with one said, and the game's shapes made from them. */

const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const text = (path: string) => readFileSync(join(CAERWYN, path), "utf8");
const scenario = () => JSON.parse(text(scenarioPath("caerwyn"))) as ScenarioDocument & Record<string, unknown>;
const town = () => JSON.parse(text(mapPath("caerwyn"))) as MapDocument & Record<string, unknown>;
const yard = () => JSON.parse(text(placePath("granary-yard"))) as PlaceDocument & Record<string, unknown>;

/** The problems a changed copy is refused for, by the parse given. */
function problemsOf<T>(made: () => T, parse: (value: unknown, where: string) => unknown, change: (d: T) => void): string[] {
  const d = made();
  change(d);
  try {
    parse(d, "the file");
  } catch (e) {
    assert.ok(e instanceof FormatError);
    return e.problems;
  }
  return [];
}

test("Caerwyn's files parse as they are, each written as the scenes are, unknown keys kept", () => {
  const files = [scenarioPath("caerwyn"), ...readdirSync(join(CAERWYN, "maps")).map(f => `maps/${f}`), ...readdirSync(join(CAERWYN, "places")).map(f => `places/${f}`)];
  assert.deepEqual(files, ["caerwyn.kmscenario", "maps/caerwyn.kmmap", "maps/drowned-rat.kmmap", "maps/heron.kmmap", "maps/palace.kmmap", "places/dressing-room.kmplace", "places/drowned-rat.kmplace", "places/granary-yard.kmplace", "places/heron.kmplace"]);
  for (const path of files) assert.equal(text(path), `${JSON.stringify(JSON.parse(text(path)), null, 2)}\n`, `${path}: JSON.stringify with two spaces, and a newline`);

  const doc = parseScenario(text(scenarioPath("caerwyn")), scenarioPath("caerwyn"));
  assert.deepEqual([doc.format, doc.version, doc.kind, doc.id, doc.title, doc.campaignVersion], ["kingmaker", 2, "scenario", "caerwyn", "Caerwyn", "0.1.0"]);
  assert.deepEqual(doc.maps, ["caerwyn", "drowned-rat", "heron", "palace"]);
  assert.deepEqual(parseMap(text(mapPath("palace"))).title, "The Palace");
  assert.deepEqual(parsePlace(text(placePath("granary-yard"))).title, "The yard behind the King's Granary");
  assert.deepEqual((scenarioDocumentOf({ ...scenario(), plugin: { zoom: 2 } }) as unknown as { plugin: unknown }).plugin, { zoom: 2 });
  assert.deepEqual((mapDocumentOf({ ...town(), painter: "stone" }) as unknown as { painter: unknown }).painter, "stone");
});

test("the game's shapes: campaign.json's, maps/<key>.json's and places/<key>.json's fields, in their order", () => {
  const campaign = loadScenario(text(scenarioPath("caerwyn")));
  assert.deepEqual(Object.keys(campaign), ["id", "title", "version", "firstScene", "startPlace", "start", "level", "rulesPack", "scenes", "talk", "places", "maps", "startingPurse", "creation", "quests"]);
  assert.deepEqual([campaign.id, campaign.version, campaign.firstScene], ["caerwyn", "0.1.0", "hanged-clerk"]);

  const map = loadMap(text(mapPath("caerwyn")));
  assert.deepEqual(Object.keys(map), ["id", "name", "music", "grid", "legend", "regions", "exits", "people"]);
  assert.deepEqual([map.id, map.name, map.grid.length, map.grid[0]!.length], ["caerwyn", "Caerwyn", 46, 64]);

  const place = loadPlace(text(placePath("granary-yard")));
  assert.deepEqual(Object.keys(place), ["key", "name", "description", "size", "areas", "things", "people"]);
  assert.deepEqual([place.key, place.name, place.size], ["granary-yard", "The yard behind the King's Granary", { w: 52, h: 40 }]);

  // The envelope's own and the plugin's layout stay with the file; anything else unknown goes on.
  const { layout: _, ...withoutLayout } = asCampaignFile({ ...scenario(), layout: { "hanged-clerk": { x: 0, y: 0 } }, extra: 1 } as ScenarioDocument) as unknown as Record<string, unknown>;
  assert.deepEqual([withoutLayout.extra, "layout" in withoutLayout, "description" in withoutLayout, "format" in withoutLayout], [1, false, false, false]);
  assert.equal(asMapFile(town()).name, "Caerwyn");
  assert.equal(asPlaceFile(yard()).key, "granary-yard");
});

test("the loader reads either: the campaign's version from campaignVersion, or a version written before the rename", () => {
  const { campaignVersion: _, ...before } = scenario();
  const doc = scenarioDocumentOf({ ...before, version: "0.1.0" });
  assert.equal(asCampaignFile(doc).version, "0.1.0");
  assert.deepEqual(problemsOf(scenario, scenarioDocumentOf, d => { delete (d as Partial<ScenarioDocument>).campaignVersion; }), ['it has no campaignVersion (the campaign\'s own version, "0.1.0": its version is the format\'s, 2)']);
  assert.deepEqual(problemsOf(scenario, scenarioDocumentOf, d => { (d as Record<string, unknown>).version = "0.1.0"; }), ['it isn\'t a scenario of the kingmaker format, version 2 (format "kingmaker", version "0.1.0", kind "scenario")']);
});

test("a file that isn't one of the format says why, naming where", () => {
  assert.throws(() => parseScenario("{ not json", "x.kmscenario"), /^FormatError: x\.kmscenario: it isn't JSON/);
  assert.deepEqual(problemsOf(scenario, scenarioDocumentOf, d => { d.kind = "map" as "scenario"; delete (d as Partial<ScenarioDocument>).description; }), [
    'it isn\'t a scenario of the kingmaker format, version 2 (format "kingmaker", version 2, kind "map")', "it has no description",
  ]);
  assert.deepEqual(problemsOf(scenario, scenarioDocumentOf, d => { d.start.time = "teatime" as "morning"; d.start.at = [1] as unknown as [number, number]; d.maps = undefined as unknown as string[]; d.startingPurse[0]!.quantity = "two" as unknown as number; }), [
    'its start\'s time "teatime" isn\'t one of morning, afternoon, evening, night, next-morning', "its start's at isn't a tile [x, y]", "its maps isn't a list of text", "startingPurse[0] isn't { name, quantity, description }",
  ]);
  assert.deepEqual(problemsOf(town, mapDocumentOf, d => { d.legend["ab"] = { terrain: "floor" }; d.legend["#"] = { style: "brick" } as never; d.regions[0]!.trigger = "shout" as "enter"; d.regions[1]!.worldOrigin = [40, 9] as never; d.exits[0]!.to = { at: { x: 1, y: 1 } } as never; d.people![0]!.times = "always" as never; }), [
    'legend "#" has no terrain', 'legend "ab" isn\'t one character', 'regions[0] (granary-yard)\'s trigger "shout" isn\'t enter or interact', "regions[1] (tally-loft)'s worldOrigin isn't a tile { x, y }",
    "exits[0] isn't { at: { x, y }, to: { map, at: { x, y } }, label }", "people[0] (a palace guard)'s times aren't a list of times of day",
  ]);
  assert.deepEqual(problemsOf(yard, placeDocumentOf, d => { d.size = { w: 52 } as never; d.things[0]!.material = "marzipan" as never; d.things[1]!.size = "vast" as never; d.people.kell = { at: [1, 2] } as never; }), [
    "it has no size { w, h } (in feet)", 'things[0] (elm)\'s material "marzipan" isn\'t one of cloth, paper, rope, glass, ice, crystal, wood, bone, leather, stone, iron, steel, brass, silver, flesh, liquid',
    `things[1] (${yard().things[1]!.id})'s size "vast" isn't one of tiny, small, medium, large, huge, gargantuan`, "people.kell isn't { in, at?: [x, y], note? }",
  ]);
});

test("a campaign folder's scenario is its one .kmscenario at the root", () => {
  assert.equal(scenarioPathIn(["builds.json", "caerwyn.kmscenario", "scenes/talk.kmscene"]), "caerwyn.kmscenario");
  assert.equal(scenarioPathIn(["old/caerwyn.kmscenario", "builds.json"]), undefined, "none at the root");
  assert.equal(scenarioPathIn(["a.kmscenario", "b.kmscenario"]), undefined, "two");
  assert.deepEqual([scenarioPath("caerwyn"), mapPath("palace"), placePath("heron")], ["caerwyn.kmscenario", "maps/palace.kmmap", "places/heron.kmplace"]);
});
