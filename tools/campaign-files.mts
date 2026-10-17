// M4: a campaign folder's campaign.json, maps/*.json and places/*.json as the scenario format's files
// (docs/scenario-format.md): <id>.kmscenario, maps/<key>.kmmap and places/<key>.kmplace, each its old
// file's fields under the envelope, written as JSON.stringify(doc, null, 2) and a newline as the scenes
// are (so the plugin saves them byte for byte). Each file written is parsed back with the game's parse
// and made into the game's shape again, which must be the old file's exactly (its keys in their order);
// then the old files go. Run once: node --no-warnings --import tsx tools/campaign-files.mts campaigns/caerwyn
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MapFile } from "../shared/map/tiles.ts";
import type { CampaignFile, PlaceFile } from "../shared/scene/files.ts";
import { asCampaignFile, asMapFile, asPlaceFile, mapPath, parseMap, parsePlace, parseScenario, placePath, scenarioPath, type MapDocument, type PlaceDocument, type ScenarioDocument } from "../shared/scene/scenario.ts";

const dir = resolve(process.argv[2] ?? "campaigns/caerwyn");
const read = <T,>(path: string): { text: string; value: T } => {
  const text = readFileSync(join(dir, path), "utf8");
  return { text, value: JSON.parse(text) as T };
};
const write = (path: string, doc: object) => writeFileSync(join(dir, path), `${JSON.stringify(doc, null, 2)}\n`);

/** The one line each file's envelope needs that the old files hadn't got (a place had its own already). */
const SCENARIO_DESCRIPTION: Record<string, string> = {
  caerwyn: "A palace clerk found hanged behind the King's Granary on the eve of the Centennial Assembly, and the King's investigator sent to see him done right by: from the granary yard, down the river stairs to the Drowned Rat and the Heron, to the King's morning.",
};
const MAP_DESCRIPTIONS: Record<string, string> = {
  caerwyn: "The town on the eve of the Assembly: the palace and its gate, the watch house, the granary lane and the King's Granary, the market square and the Corn Exchange, Bank Street, the river stairs down to the Drowned Rat's door, and the wharves to the Heron.",
  "drowned-rat": "The Drowned Rat, halfway down the river stairs: the landing, the skiff-hull bar, the fireside corner and the scullery.",
  heron: "The Heron warehouse at the downriver end of the wharves: the wharf outside, the re-sacking floor and its counting-box, the plank walk and the barge Patience.",
  palace: "The palace's long gallery, the old kings' portraits propped along it for the Assembly, the back stairs down to the gate, and the King's dressing room.",
};

const done: string[] = [];
const same = (made: unknown, old: string, what: string) => {
  if (JSON.stringify(made) !== JSON.stringify(JSON.parse(old))) throw new Error(`${what}: the game's shape made from the new file isn't the old file's`);
};

// The scenario: campaign.json's fields under the envelope, its version the campaign's own (campaignVersion).
const campaign = read<CampaignFile & Record<string, unknown>>("campaign.json");
const { id, title, version, ...fields } = campaign.value;
const description = SCENARIO_DESCRIPTION[id];
if (!description) throw new Error(`no description written for the scenario ${id}`);
const scenario = { format: "kingmaker", version: 2, kind: "scenario", id, title, description, campaignVersion: version, ...fields } as ScenarioDocument;
write(scenarioPath(id), scenario);
same(asCampaignFile(parseScenario(readFileSync(join(dir, scenarioPath(id)), "utf8"), scenarioPath(id))), campaign.text, scenarioPath(id));
done.push(`campaign.json -> ${scenarioPath(id)}`);

// Each map: maps/<key>.json's fields under the envelope, its name the title.
for (const key of campaign.value.maps ?? []) {
  const old = read<MapFile & Record<string, unknown>>(`maps/${key}.json`);
  const { id: mapId, name, ...rest } = old.value;
  const mapDescription = MAP_DESCRIPTIONS[key];
  if (!mapDescription) throw new Error(`no description written for the map ${key}`);
  const doc = { format: "kingmaker", version: 2, kind: "map", id: mapId, title: name, description: mapDescription, ...rest } as MapDocument;
  write(mapPath(key), doc);
  same(asMapFile(parseMap(readFileSync(join(dir, mapPath(key)), "utf8"), mapPath(key))), old.text, mapPath(key));
  done.push(`maps/${key}.json -> ${mapPath(key)}`);
}

// Each place: places/<key>.json's fields under the envelope, its key the id and its name the title (its description was the world's).
for (const key of campaign.value.places) {
  const old = read<PlaceFile & Record<string, unknown>>(`places/${key}.json`);
  const { key: placeKey, name, description: placeDescription, ...rest } = old.value;
  const doc = { format: "kingmaker", version: 2, kind: "place", id: placeKey, title: name, description: placeDescription, ...rest } as PlaceDocument;
  write(placePath(key), doc);
  same(asPlaceFile(parsePlace(readFileSync(join(dir, placePath(key)), "utf8"), placePath(key))), old.text, placePath(key));
  done.push(`places/${key}.json -> ${placePath(key)}`);
}

// Nothing old left behind: every .json in maps/ and places/ was one of the campaign's.
const strays = ["maps", "places"].flatMap(folder => readdirSync(join(dir, folder)).filter(name => name.endsWith(".json")).map(name => `${folder}/${name}`))
  .filter(path => !done.some(line => line.startsWith(`${path} `)));
if (strays.length) throw new Error(`files the campaign doesn't list: ${strays.join(", ")}`);
for (const line of done) rmSync(join(dir, line.split(" -> ")[0]!));
console.log(done.join("\n"));
