import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SceneDocument } from "../scene/document.ts";
import type { CampaignFile } from "../scene/files.ts";
import { loadMap, loadPlace, loadScenario, mapPath, placePath, scenarioPath } from "../scene/scenario.ts";
import { exhibitIn, exhibitLayout, exhibitProblems, exhibitShapeProblems, lineUpOf, ZOO, type ExhibitFiles } from "./exhibits.ts";

/**
 * The zoo's exhibits (M6, campaigns/zoo/README.md): the combat ring as the zoo's files have it, set
 * out with each of its line-ups (everyone where the ring's place starts them, the brazier a fight's
 * prop), and the rules an exhibit is held to, each broken on a copy.
 */

const DIR = join(import.meta.dirname, "..", "..", "campaigns", ZOO);
const text = (path: string) => readFileSync(join(DIR, path), "utf8");

/** The zoo's campaign and files as the game keeps them, fresh copies each time. */
function zoo(): { campaign: CampaignFile; files: ExhibitFiles } {
  const campaign = loadScenario(text(scenarioPath(ZOO)), scenarioPath(ZOO));
  return {
    campaign,
    files: {
      scenes: campaign.scenes.map(key => JSON.parse(text(`scenes/${key}.kmscene`)) as SceneDocument),
      places: campaign.places.map(key => loadPlace(text(placePath(key)), placePath(key))),
      maps: (campaign.maps ?? []).map(key => loadMap(text(mapPath(key)), mapPath(key))),
    },
  };
}

test("the zoo's files are written as the format writes them (JSON.stringify with two spaces, and a newline)", () => {
  for (const path of [scenarioPath(ZOO), mapPath("ring"), placePath("ring"), "scenes/ring.kmscene", "builds.json", "looks.json"]) {
    assert.equal(text(path), `${JSON.stringify(JSON.parse(text(path)), null, 2)}\n`, path);
  }
});

test("the combat ring, as the zoo's files have it: its line-ups, Sallow and the Crakes first, each set out on the ring's map", () => {
  const { campaign, files } = zoo();
  assert.deepEqual(exhibitProblems(campaign, files), []);
  const ring = exhibitIn(campaign, "ring")!;
  assert.equal(ring.title, "The combat ring");
  assert.deepEqual(ring.fight?.foes.map(f => [f.id, f.title]), [["sallow", "Sallow and the Crakes"], ["crakes", "The Crakes alone"], ["dogs", "A pack of dogs"]]);
  assert.equal(lineUpOf(ring)?.id, "sallow", "with none picked, the first");
  assert.equal(lineUpOf(ring, "dogs")?.id, "dogs");
  assert.equal(lineUpOf(ring, "wolves"), undefined);

  const sallow = exhibitLayout(ring, lineUpOf(ring, "sallow")!, files);
  assert.equal(sallow.map.id, "ring");
  assert.deepEqual(sallow.player, { x: 7, y: 9 });
  assert.deepEqual(sallow.fighters.map(f => [f.id, f.side, f.role, f.card.statblock, `${f.at.x},${f.at.y}`]), [
    ["kell", "ally", "ally", "guard", "8,9"],
    ["sallow", "enemy", "villain", "sword-cane-duellist", "8,2"],
    ["crake-1", "enemy", "bruiser", "river-bruiser", "6,3"],
    ["crake-2", "enemy", "bruiser", "river-bruiser", "10,3"],
  ]);
  assert.deepEqual(sallow.props.map(p => [p.id, p.name, p.glyph, `${p.at.x},${p.at.y}`, p.states]), [["brazier", "brazier", "&", "4,8", ["lit"]]], "the brazier, lit, to knock over");

  const dogs = exhibitLayout(ring, lineUpOf(ring, "dogs")!, files);
  assert.deepEqual(dogs.fighters.map(f => [f.id, f.side, f.card.statblock]), [["kell", "ally", "guard"], ["dog-1", "enemy", "mastiff"], ["dog-2", "enemy", "mastiff"], ["dog-3", "enemy", "mastiff"]]);
});

test("an exhibit is held to the files it names: its scene and cast, where its place starts everyone, how they fight, its line-ups", () => {
  const broken = (change: (c: CampaignFile, f: ExhibitFiles) => void) => {
    const { campaign, files } = zoo();
    change(campaign, files);
    return exhibitProblems(campaign, files).map(p => p.message);
  };
  const ring = (c: CampaignFile) => c.exhibits![0]!;
  const foes = (c: CampaignFile, id: string) => ring(c).fight!.foes.find(f => f.id === id)!;

  assert.deepEqual(broken(c => { ring(c).scene = "theatre"; }), ["ring's scene theatre isn't one of the scenario's scenes"]);
  assert.deepEqual(broken(c => { foes(c, "dogs").fighters["dog-4"] = "brawler"; }), ["dog-4 isn't in ring's cast", "ring doesn't start dog-4 anywhere"]);
  assert.deepEqual(broken(c => { foes(c, "crakes").fighters["crake-1"] = "berserker" as never; }), ["crake-1 fights as \"berserker\", which isn't one of ally, bruiser, villain, coward, brawler, archer, bystander"]);
  assert.deepEqual(broken(c => { foes(c, "crakes").fighters["kell"] = "bruiser"; }), ["kell is an ally and one of line-up crakes's foes", "kell and kell both start at (8, 9)"]);
  assert.deepEqual(broken((_c, f) => { f.places[0]!.people["crake-2"] = { in: "sand", at: [32, 17] }; }), [
    "crake-2 and crake-1 both start at (6, 3)", "crake-2 and crake-1 both start at (6, 3)",
  ]);
  assert.deepEqual(broken((_c, f) => { f.places[0]!.people["dog-2"] = { in: "sand", at: [27, 27] }; }), ["dog-2 starts at (5, 5) on ring, where nobody can stand"], "on a pillar");
  assert.deepEqual(broken((_c, f) => { delete f.scenes[0]!.cast.find(c => c.id === "dog-3")!.statblock; }), ["dog-3 has no statblock to fight with"]);
  assert.deepEqual(broken((_c, f) => { f.maps[0]!.regions = []; }), ["no map lays ring's scene ring (a region with its sceneId and a worldOrigin)"]);
  assert.deepEqual(broken(c => { ring(c).fight!.foes.push({ ...foes(c, "dogs") }); }), ["the line-up dogs is there twice"]);
  assert.deepEqual(broken(c => { ring(c).fight!.foes = []; }), ["ring has no line-up of foes to fight"]);
  assert.deepEqual(broken(c => { c.exhibits!.push({ ...ring(c), id: "Ring" }); }), ["the exhibit id \"Ring\" isn't a slug ([a-z0-9][a-z0-9-]*)"]);
});

test("the exhibits' shape: a list of { id, title, description, scene, fight? }, a fight's line-ups each { id, title, fighters }", () => {
  assert.deepEqual(exhibitShapeProblems(undefined), [], "a campaign that isn't a zoo has none");
  assert.deepEqual(exhibitShapeProblems({ ring: {} }), ["its exhibits aren't a list"]);
  assert.deepEqual(exhibitShapeProblems([{ id: "ring", title: "The ring", scene: "ring", fight: { foes: [{ id: "x", fighters: { a: 3 } }] } }]), [
    "exhibits[0] (ring) has no description", "exhibits[0] (ring)'s foes[0] (x) has no title", "exhibits[0] (ring)'s foes[0] (x)'s fighters aren't { cast id: how they fight }",
  ]);
  assert.deepEqual(exhibitShapeProblems(zoo().campaign.exhibits), []);
});
