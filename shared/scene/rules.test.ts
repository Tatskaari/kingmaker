import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SceneDocument } from "./document.ts";
import type { CampaignFile, PlaceFile } from "./files.ts";
import { sceneRuleProblems, sceneStoryProblems, talkTemplateProblems, type SceneContext } from "./rules.ts";

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

test("an effect that would do nothing is a problem: a world op that doesn't say what it acts on (a create, what it creates), a flag without a name", () => {
  const doc = clerk();
  const failed = doc.nodes.find(n => n.id === "failed")!.data as { effects: Array<Record<string, unknown>> };
  failed.effects.push({ op: "give", what: "", to: "$player" }, { op: "create", name: " ", kind: "object" }, { op: "flag", name: "", value: "x" }, { op: "ignite", what: "hoist-rope" });
  const at = (i: number) => ({ kind: "node", id: "failed", field: `effects.${i}` });
  const n = failed.effects.length;
  assert.deepEqual(sceneRuleProblems("hanged-clerk", doc, contextFor(doc)), [
    { message: "ending failed: give doesn't say what it acts on", at: at(n - 4) },
    { message: "ending failed: create doesn't name what it creates", at: at(n - 3) },
    { message: "ending failed: flag has no name", at: at(n - 2) },
  ]);
});

test("the carried things another scene brings in count: Prout's page comes into the Rat with the granary's motive", () => {
  const rat = scenes.find(s => s.id === "drowned-rat")!;
  const alone: SceneContext = { ...contextFor(rat), others: [] };
  assert.deepEqual(sceneRuleProblems(rat.id, rat, contextFor(rat)), []);
  assert.deepEqual(sceneRuleProblems(rat.id, rat, alone), [{ message: "beat prouts-page carries ledger-page, which isn't a thing of its place, nor carried from another scene", at: { kind: "node", id: "prouts-page", field: "carry" } }]);
});

test("a cue's outer limit counts from and until beats: one that names an ending is the route's problem, at that count", () => {
  const rat = structuredClone(scenes.find(s => s.id === "drowned-rat")!);
  const bell = rat.edges.find(e => e.id === "bell-rings")!;
  bell.data.limit = [{ exchanges: 15, until: ["hobb-fled"] }, { exchanges: 8, after: "arlos-challenge" }];
  assert.deepEqual(sceneRuleProblems(rat.id, rat, contextFor(rat)), [
    { message: "route bell-rings's outer limit counts from or until hobb-fled, which isn't a beat", at: { kind: "route", id: "bell-rings", field: "limit.0" } },
  ]);
});

test("the talk template's own rules, each where it is: the companion, the start's role for them, told a discovery, a way into goodbye from the start, no place", () => {
  const template = scenes.find(s => s.id === campaign.talk)!;
  assert.deepEqual(talkTemplateProblems(template), []);
  const wrong = structuredClone(template);
  wrong.companion = "kell";
  delete (wrong.nodes[0]!.data as { cast?: unknown }).cast;
  const told = wrong.nodes.find(n => n.id === "told")!.data as { revelation?: string; paths?: unknown };
  delete told.revelation;
  delete told.paths;
  wrong.edges = wrong.edges.filter(e => e.target !== "goodbye");
  wrong.place = "granary-yard";
  assert.deepEqual(talkTemplateProblems(wrong), [
    { message: 'the talk template\'s companion is "kell", not "{companion}"', at: { kind: "scene", field: "companion" } },
    { message: "the talk template's start has no role for {companion} (their opening role, the co-GM's first note)", at: { kind: "node", id: "talk", field: "cast" } },
    { message: "the talk template has no discovery told (the one thing they might confide, which each talk's prep fills in)", at: { kind: "node", id: "told", field: "kind" } },
    { message: "the talk template has no way into goodbye from its start (saying goodbye ends a talk wherever it's got to)", at: { kind: "node", id: "goodbye", field: "ways-in" } },
    { message: "the talk template has a place (a talk is wherever the player stopped)", at: { kind: "scene", field: "place" } },
  ]);
});
