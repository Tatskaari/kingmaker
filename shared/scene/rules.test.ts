import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SceneDocument } from "./document.ts";
import type { CampaignFile, PlaceFile } from "./files.ts";
import { sceneRuleProblems, sceneStoryProblems, type SceneContext } from "./rules.ts";

/**
 * The scene format's per-scene rules as an editor runs them: each problem with where it is (the
 * campaign check's messages themselves are hosts/dev/campaign.test.ts's), from a context that is
 * only what the rules need of the campaign.
 */

const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const read = (path: string) => readFileSync(join(CAERWYN, path), "utf8");
const campaign = JSON.parse(read("campaign.json")) as CampaignFile;
const scenes = [...campaign.scenes, campaign.talk!].map(key => JSON.parse(read(`scenes/${key}.kmscene`)) as SceneDocument);
const loreFiles = new Set(readdirSync(join(CAERWYN, "lore"), { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(join(CAERWYN, "lore").length + 1)));

function contextFor(doc: SceneDocument): SceneContext {
  return {
    hasLore: path => loreFiles.has(path),
    scenes: campaign.scenes,
    talk: campaign.talk!,
    places: campaign.places.map(key => JSON.parse(read(`places/${key}.json`)) as PlaceFile),
    quests: campaign.quests ?? {},
    others: scenes.filter(other => other.id !== doc.id),
  };
}

const clerk = () => structuredClone(scenes[0]!);

test("every scene of the campaign keeps the rules, as the campaign check finds", () => {
  const ids = new Set(scenes.map(s => s.id));
  for (const doc of scenes) {
    assert.deepEqual(sceneRuleProblems(doc.id, doc, contextFor(doc)), [], doc.id);
    assert.deepEqual(sceneStoryProblems(doc, ids), [], doc.id);
  }
});

test("each problem says where it is: the scene and its field, a node, a route, a person, and the part of it", () => {
  const doc = clerk();
  doc.premise = "";
  doc.cast[1]!.look = " ";
  doc.nodes.find(n => n.id === "murder")!.data.lore = ["Places/Atlantis.md"];
  doc.edges.find(e => e.id === "cart-comes")!.data.condition = "";
  doc.place = "the-moon";

  assert.deepEqual(sceneRuleProblems("hanged-clerk", doc, contextFor(doc)), [
    { message: "it has no premise", at: { kind: "scene", field: "premise" } },
    { message: "cob has no look", at: { kind: "cast", id: "cob", field: "look" } },
    { message: "lore Places/Atlantis.md isn't in lore/", at: { kind: "node", id: "murder", field: "lore" } },
    { message: "route cart-comes has no condition, and only a route into a discovery may go without", at: { kind: "route", id: "cart-comes", field: "condition" } },
    { message: "its place the-moon isn't one of the campaign's places", at: { kind: "scene", field: "place" } },
    { message: "afterwards: remove names unknown prout", at: { kind: "scene", field: "afterwards.0" } },
  ]);
});

test("a scene's file name is its id, and what's unreachable is the node's; what the story needs of an overtaken scene is the scene's", () => {
  const doc = clerk();
  doc.edges = doc.edges.filter(e => e.id !== "find-hobb");
  doc.overtaken = "atlantis";

  const problems = sceneRuleProblems("the-hanged-clerk", doc, contextFor(doc));
  assert.deepEqual(problems[0], { message: "its id hanged-clerk isn't its file's name", at: { kind: "scene", field: "id" } });
  assert.ok(problems.some(p => p.message === "hobb can't be reached from the start" && p.at.kind === "node" && p.at.id === "hobb"));
  assert.deepEqual(sceneStoryProblems(doc, new Set(scenes.map(s => s.id))).map(p => p.at), [{ kind: "scene", field: "overtaken" }, { kind: "scene", field: "assumes" }]);
});

test("the carried things another scene brings in count: Prout's page comes into the Rat with the granary's motive", () => {
  const rat = scenes.find(s => s.id === "drowned-rat")!;
  const alone: SceneContext = { ...contextFor(rat), others: [] };
  assert.deepEqual(sceneRuleProblems(rat.id, rat, contextFor(rat)), []);
  assert.deepEqual(sceneRuleProblems(rat.id, rat, alone), [{ message: "beat prouts-page carries ledger-page, which isn't a thing of its place, nor carried from another scene", at: { kind: "node", id: "prouts-page", field: "carry" } }]);
});
