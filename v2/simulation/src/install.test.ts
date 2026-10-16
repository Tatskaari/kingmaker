import { test } from "node:test";
import assert from "node:assert/strict";
import { installArgsOf, type CampaignPack, type InstallArgs, type SceneFile } from "../../shared/scene/files.ts";
import { memoryHost } from "./host/memory.ts";
import { all, caerwynArgs, caerwynPack, identity } from "./host/testing.ts";

/** install_campaign (v0-design §8): the owner installs a version's structure; a pack that doesn't load is refused, saying why. */

const newHost = () => memoryHost({ ai: async () => ({ status: 500, body: "" }) });

test("the owner installs the hanged clerk: the campaign, its scene's def and hook, its place", () => {
  const host = newHost();
  assert.equal(host.as(host.owner).installCampaign(caerwynArgs()), undefined);

  const [campaign] = all(host.db.campaign);
  assert.deepEqual([campaign!.id, campaign!.key, campaign!.version, campaign!.title], ["caerwyn@0.1.0", "caerwyn", "0.1.0", "Caerwyn"]);
  assert.deepEqual(Object.keys(JSON.parse(campaign!.builds)), ["cleric", "fighter", "ranger", "rogue", "wizard"]);
  const [def] = all(host.db.sceneDef);
  assert.deepEqual([def!.id, def!.campaignId, def!.key, def!.title], ["caerwyn@0.1.0/hanged-clerk", "caerwyn@0.1.0", "hanged-clerk", "The Hanged Clerk"]);
  assert.match(def!.hook, /^This morning a palace clerk, Wendell Prout/);
  assert.deepEqual(all(host.db.placeDef).map(p => p.id), ["caerwyn@0.1.0/granary-yard"]);
});

test("installing a version again replaces it; a game starts on the newest version unless it names one", () => {
  const host = newHost();
  const pack = caerwynPack();
  host.as(host.owner).installCampaign(installArgsOf(pack));
  host.as(host.owner).installCampaign(installArgsOf({ ...pack, campaign: { ...pack.campaign, title: "Caerwyn, again" } }));
  assert.deepEqual(all(host.db.campaign).map(c => c.title), ["Caerwyn, again"]);
  assert.equal(all(host.db.sceneDef).length, 1);

  host.as(host.owner).installCampaign(installArgsOf({ ...pack, campaign: { ...pack.campaign, version: "0.10.0" } }));
  host.as(identity(1)).newGame({ campaign: "caerwyn", name: "Wren", concept: "", build: "ranger" });
  host.as(identity(2)).newGame({ campaign: "caerwyn@0.1.0", name: "Tamsin", concept: "", build: "rogue" });
  assert.deepEqual(all(host.db.game).map(g => g.campaignVersion).sort(), ["0.1.0", "0.10.0"]);
});

test("a pack that doesn't load is refused, saying why, and nothing is installed", () => {
  const host = newHost();
  const pack = caerwynPack();
  const [install] = pack.scenes;
  const refusedArgs = (args: InstallArgs) => host.as(host.owner).installCampaign(args)?.text;
  const refusedPack = (broken: CampaignPack) => refusedArgs(installArgsOf(broken));
  const withScene = (scene: Partial<SceneFile>): CampaignPack => ({ ...pack, scenes: [{ ...install!, scene: { ...install!.scene, ...scene } }] });

  assert.match(refusedArgs({ ...caerwynArgs(), scenes: "[not json" })!, /^The campaign pack doesn't load: its JSON doesn't parse/);
  assert.equal(refusedArgs({ ...caerwynArgs(), id: "caerwyn@9.9.9" }), "The campaign pack doesn't load: its id caerwyn@9.9.9 isn't campaign.json's caerwyn@0.1.0.");
  assert.equal(refusedPack(withScene({ start: "nowhere" })), "The campaign pack doesn't load: scene hanged-clerk: start beat nowhere missing.");
  assert.equal(refusedPack({ ...pack, places: [] }), "The campaign pack doesn't load: scene hanged-clerk: its place granary-yard isn't in the pack.");
  const yard = install!.scene.beats.yard!;
  assert.match(refusedPack(withScene({ beats: { ...install!.scene.beats, yard: { ...yard, routes: [{ id: "x", on: "attempt", when: "w", to: "doubt", establishes: ["no-such-fact"] }] } } }))!, /unknown fact no-such-fact/);
  assert.deepEqual([all(host.db.campaign).length, all(host.db.sceneDef).length, all(host.db.placeDef).length], [0, 0, 0]);
});
