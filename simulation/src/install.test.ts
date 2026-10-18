import { test } from "node:test";
import assert from "node:assert/strict";
import { mapOf, type MapFile } from "../../shared/map/tiles.ts";
import type { SceneDocument } from "../../shared/scene/document.ts";
import { installArgsOf, type CampaignPack, type InstallArgs } from "../../shared/scene/files.ts";
import { memoryHost } from "./host/memory.ts";
import { all, caerwynArgs, caerwynPack, identity } from "./host/testing.ts";

/** install_campaign (v0-design §8): the owner installs a version's structure; a pack that doesn't load is refused, saying why. */

const newHost = () => memoryHost({ ai: async () => ({ status: 500, body: "" }) });

test("the owner installs Caerwyn: the campaign, each scene's def (its file whole) and hook (the hanged clerk's first), its places", () => {
  const host = newHost();
  assert.equal(host.as(host.owner).installCampaign(caerwynArgs({ asIs: true })), undefined);

  const [campaign] = all(host.db.campaign);
  assert.deepEqual([campaign!.id, campaign!.key, campaign!.version, campaign!.title], ["caerwyn@0.1.0", "caerwyn", "0.1.0", "Caerwyn"]);
  assert.deepEqual(Object.keys(JSON.parse(campaign!.builds)), ["cleric", "fighter", "ranger", "rogue", "wizard"]);
  const defs = all(host.db.sceneDef);
  // The story's scenes, then the talk template (town-design §3.6: installed with them, never on the story's way).
  assert.deepEqual(defs.map(d => d.key), ["hanged-clerk", "caerwyn-afternoon", "drowned-rat", "wharf-night", "heron-warehouse", "kings-morning", "talk"]);
  const def = defs[0];
  assert.deepEqual([def!.id, def!.campaignId, def!.key, def!.title], ["caerwyn@0.1.0/hanged-clerk", "caerwyn@0.1.0", "hanged-clerk", "The Hanged Clerk"]);
  assert.match(def!.hook, /^This morning a palace clerk, Wendell Prout/);
  assert.deepEqual(JSON.parse(def!.json), caerwynPack({ asIs: true }).scenes[0], "the scene's .kmscene file, as it is");
  assert.deepEqual(all(host.db.placeDef).map(p => p.id), ["caerwyn@0.1.0/granary-yard", "caerwyn@0.1.0/drowned-rat", "caerwyn@0.1.0/heron", "caerwyn@0.1.0/dressing-room"]);
});

test("installing a version again replaces it; a game starts on the newest version unless it names one", () => {
  const host = newHost();
  const pack = caerwynPack();
  host.as(host.owner).installCampaign(installArgsOf(pack));
  host.as(host.owner).installCampaign(installArgsOf({ ...pack, campaign: { ...pack.campaign, title: "Caerwyn, again" } }));
  assert.deepEqual(all(host.db.campaign).map(c => c.title), ["Caerwyn, again"]);
  assert.equal(all(host.db.sceneDef).length, 7);

  host.as(host.owner).installCampaign(installArgsOf({ ...pack, campaign: { ...pack.campaign, version: "0.10.0" } }));
  host.as(identity(1)).newGame({ campaign: "caerwyn", name: "Wren", concept: "", build: "ranger" });
  host.as(identity(2)).newGame({ campaign: "caerwyn@0.1.0", name: "Tamsin", concept: "", build: "rogue" });
  assert.deepEqual(all(host.db.game).map(g => g.campaignVersion).sort(), ["0.1.0", "0.10.0"]);
});

test("a pack that doesn't load is refused, saying why, and nothing is installed", () => {
  const host = newHost();
  const pack = caerwynPack();
  const [clerk] = pack.scenes;
  const refusedArgs = (args: InstallArgs) => host.as(host.owner).installCampaign(args)?.text;
  const refusedPack = (broken: CampaignPack) => refusedArgs(installArgsOf(broken));
  const withScene = (scene: Partial<SceneDocument>): CampaignPack => ({ ...pack, scenes: [{ ...clerk!, ...scene }] });

  assert.match(refusedArgs({ ...caerwynArgs(), scenes: "[not json" })!, /^The campaign pack doesn't load: its JSON doesn't parse/);
  assert.equal(refusedArgs({ ...caerwynArgs(), id: "caerwyn@9.9.9" }), "The campaign pack doesn't load: its id caerwyn@9.9.9 isn't campaign.json's caerwyn@0.1.0.");
  assert.equal(refusedPack(withScene({ nodes: clerk!.nodes.filter(n => n.data.kind !== "start") }))?.split("; ")[0], "The campaign pack doesn't load: scene hanged-clerk: its file: it has 0 start nodes, not one");
  assert.equal(refusedPack({ ...pack, places: [] }), "The campaign pack doesn't load: scene hanged-clerk: its place granary-yard isn't in the pack.");
  const [first, ...rest] = clerk!.edges;
  assert.equal(refusedPack(withScene({ edges: [{ ...first!, data: { ...first!.data, establishes: ["no-such-fact"] } }, ...rest] })), `The campaign pack doesn't load: scene hanged-clerk: its file: edges[0] (${first!.id}) establishes no-such-fact, which isn't one of its facts.`);
  assert.equal(refusedPack(withScene({ cast: undefined as unknown as SceneDocument["cast"] })), "The campaign pack doesn't load: scene hanged-clerk: its file: it has no cast list.");
  assert.deepEqual([all(host.db.campaign).length, all(host.db.sceneDef).length, all(host.db.placeDef).length], [0, 0, 0]);
});

test("a ready-made build the rules engine's pack can't make is refused: a class, species, background or subclass it hasn't got", () => {
  const host = newHost();
  const pack = caerwynPack();
  const withRogue = (over: Partial<CampaignPack["builds"][string]["build"]>) => installArgsOf({ ...pack, builds: { ...pack.builds, rogue: { ...pack.builds.rogue!, build: { ...pack.builds.rogue!.build, ...over } } } });

  assert.equal(host.as(host.owner).installCampaign(withRogue({ classId: "artificer" }))?.text, "The campaign pack doesn't load: build rogue: its class artificer isn't in the rules engine's pack.");
  assert.equal(host.as(host.owner).installCampaign(withRogue({ speciesId: "kobold" }))?.text, "The campaign pack doesn't load: build rogue: its species kobold isn't in the rules engine's pack.");
  assert.equal(host.as(host.owner).installCampaign(withRogue({ backgroundId: "pirate" }))?.text, "The campaign pack doesn't load: build rogue: its background pirate isn't in the rules engine's pack.");
  assert.equal(host.as(host.owner).installCampaign(withRogue({ subclassId: "arcane-trickster" }))?.text, "The campaign pack doesn't load: build rogue: its subclass arcane-trickster isn't in the rules engine's pack.");
  assert.equal(all(host.db.campaign).length, 0);
});

test("a campaign's maps go in as map_def rows, built first: a map that doesn't build, or a start on a map it hasn't got, is refused (map-design §3.1)", () => {
  const host = newHost();
  const pack = caerwynPack();
  const lane: MapFile = {
    id: "lane", name: "A lane", grid: ["##", ".*"],
    legend: { "#": { terrain: "wall", style: "brick" }, ".": { terrain: "cobbles" }, "*": { terrain: "cobbles", decor: { name: "bunting", glyph: "▾", states: ["overhead"] } } },
    regions: [], exits: [],
  };
  const withMaps = (maps: MapFile[], start?: string) => installArgsOf({ ...pack, maps, campaign: { ...pack.campaign, start: { ...pack.campaign.start, ...(start ? { map: start, at: [0, 1] as [number, number] } : {}) } } });

  assert.equal(host.as(host.owner).installCampaign(withMaps([lane], "lane")), undefined);
  const [def] = all(host.db.mapDef);
  assert.deepEqual([def!.id, def!.campaignId, def!.key], ["caerwyn@0.1.0/lane", "caerwyn@0.1.0", "lane"]);
  assert.deepEqual(JSON.parse(def!.json), lane);
  assert.equal(mapOf(lane).decor.length, 1, "the bunting stands on its tile");

  assert.match(host.as(host.owner).installCampaign(withMaps([{ ...lane, grid: ["#?"] }]))!.text, /^The campaign pack doesn't load: map lane: Error: lane: no legend entry for "\?" at \(1, 0\)/);
  assert.equal(host.as(host.owner).installCampaign(withMaps([lane], "caerwyn"))?.text, "The campaign pack doesn't load: it starts on the map caerwyn, which it hasn't got.");
  assert.deepEqual(all(host.db.mapDef).map(m => m.id), ["caerwyn@0.1.0/lane"], "a refused install leaves the version's maps as they were");
});
