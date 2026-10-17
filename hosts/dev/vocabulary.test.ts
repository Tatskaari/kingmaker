import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { sceneOf } from "../../shared/scene/load.ts";
import type { SceneFile } from "../../shared/scene/files.ts";
import { checkCampaign, packOf, readCampaignFiles, type CampaignFiles } from "./campaign.ts";
import { prepText } from "../../ai/gm/suggest.ts";
import { vocabularyOf, type Vocabulary } from "../../ai/gm/story.ts";
import { entryOf, vocabularyProblems } from "./vocabulary.ts";

const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const files = readCampaignFiles(CAERWYN);
const VOCAB = "vocabulary.json", SCENE = "scenes/hanged-clerk/scene.json";
const vocabulary = vocabularyOf(files[VOCAB]!) as Vocabulary;

/** The campaign with one file changed: JSON edited in place, or text replaced (undefined deletes it). */
function changed(path: string, edit: ((json: any) => void) | string | undefined): CampaignFiles {
  const copy = { ...files };
  if (typeof edit === "function") {
    const json = JSON.parse(copy[path]!);
    edit(json);
    copy[path] = JSON.stringify(json);
  } else if (edit === undefined) delete copy[path];
  else copy[path] = edit;
  return copy;
}

/** The vocabulary with the hanged clerk's entry edited. */
const clerkEdited = (edit: (entry: any) => void) => changed(VOCAB, v => edit(v.scenes.find((e: any) => e.id === "hanged-clerk")));

test("caerwyn's vocabulary is fit: the prototype's 25 scenes, each once, every way on an entry", () => {
  const ids = vocabulary.scenes.map(e => e.id);

  assert.deepEqual(checkCampaign(files), []);
  assert.deepEqual(vocabularyProblems(files, packOf(files)), []);
  assert.equal(vocabulary.source, "44c6d4a");
  assert.equal(ids.length, 25);
  assert.equal(new Set(ids).size, 25);
  assert.deepEqual(ids.slice(8, 14), ["hanged-clerk", "caerwyn-afternoon", "drowned-rat", "wharf-night", "heron-warehouse", "kings-morning"]);
  assert.ok(vocabulary.scenes.every(e => e.next.every(id => ids.includes(id))));
});

test("the installed hanged clerk, loaded with its words, gives its entry: prep, hook, ways on, cast and world names", () => {
  const file = JSON.parse(files[SCENE]!) as SceneFile;
  const scene = sceneOf(file, path => files[`scenes/hanged-clerk/${path}`]);
  const entry = vocabulary.scenes.find(e => e.id === "hanged-clerk")!;

  assert.deepEqual(entryOf(scene, packOf(files).places[0]), entry);
  assert.equal(prepText(scene), entry.prep);
  assert.equal(entry.prep.length, 46_333);
  assert.deepEqual(entry.cast.map(c => c.called ?? c.name), ["Sergeant Agnes Kell", "the boy in the too-big boots", "the girl in the shawl", "the corporal"]);
});

test("a tampered prep fails: the entry's, or the scene's (the conversion)", () => {
  const entry = clerkEdited(e => { e.prep = e.prep.replace("Moll", "Molly"); });
  const card = changed("scenes/hanged-clerk/cast/moll.md", files["scenes/hanged-clerk/cast/moll.md"]!.replace("## Secrets\n", "## Secrets\n\n- She keeps a ferret.\n"));

  for (const tampered of [entry, card]) {
    const problems = checkCampaign(tampered);
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /^vocabulary\.json: hanged-clerk's prep isn't the installed scene's \(line \d+: /);
  }
});

test("the hook, the ways on, the cast and the world names are each checked against the installed scene", () => {
  const problems = checkCampaign(clerkEdited(e => {
    e.hook += " Also a dragon.";
    e.next = ["drowned-rat"];
    e.cast[1].called = "the boy";
    e.worldNames.pop();
  }));

  assert.deepEqual(problems.map(p => p.replace(/ \(line .*$/, "")), ["hook", "next", "cast", "worldNames"].map(f => `vocabulary.json: hanged-clerk's ${f} isn't the installed scene's`));
});

test("an id twice, or a way on to nowhere, is found", () => {
  const twice = changed(VOCAB, v => { v.scenes.push({ ...v.scenes[0] }); });
  const nowhere = changed(VOCAB, v => { v.scenes.find((e: any) => e.id === "stranger-crossroads").next.push("the-moon"); });

  assert.deepEqual(checkCampaign(twice), ["vocabulary.json: stranger-crossroads is there twice"]);
  assert.deepEqual(checkCampaign(nowhere), ["vocabulary.json: stranger-crossroads leads to the-moon, which is neither an entry nor an installed scene"]);
});

test("a way on to a scene the campaign installs needs no entry; an installed scene without one is found", () => {
  const installedOnly = changed(VOCAB, v => {
    v.scenes = v.scenes.filter((e: any) => e.id !== "hanged-clerk");
    v.scenes.find((e: any) => e.id === "stranger-crossroads").next.push("hanged-clerk");
  });

  assert.deepEqual(checkCampaign(installedOnly), ["vocabulary.json: no entry for hanged-clerk, which the campaign installs"]);
});

test("a vocabulary that isn't JSON, or isn't the tool's shape, says so", () => {
  const garbled = checkCampaign(changed(VOCAB, "{ scenes: "));
  const shapes = checkCampaign(changed(VOCAB, v => {
    v.scenes[0].next = "crossroads-ambush";
    delete v.scenes[1].prep;
    v.scenes[2].cast = [{ id: "x" }];
  }));

  assert.equal(garbled.length, 1);
  assert.match(garbled[0]!, /^vocabulary\.json isn't JSON/);
  assert.deepEqual(checkCampaign(changed(VOCAB, "[]")), ["vocabulary.json: isn't { source, scenes: [...] }"]);
  assert.deepEqual(shapes, [
    "vocabulary.json: scenes[0] (stranger-crossroads): next isn't a list of scene ids",
    "vocabulary.json: scenes[1] (crossroads-ambush): no prep",
    "vocabulary.json: scenes[2] (crossroads-aftermath): cast isn't a list of { id, name, called?, aka? }",
  ]);
});

test("no vocabulary is missed only when a scene leads beyond what the campaign installs", () => {
  // The whole story is installed, from the yard to the King's morning, whose endings go nowhere.
  const none = changed(VOCAB, undefined);
  const KING = "scenes/kings-morning/scene.json";
  const leadsBeyond = { ...none, [KING]: JSON.stringify({ ...JSON.parse(files[KING]!), exits: { ...JSON.parse(files[KING]!).exits, justice: { ...JSON.parse(files[KING]!).exits.justice, next: "garrows-toll" } } }) };

  assert.deepEqual(checkCampaign(none), []);
  assert.deepEqual(checkCampaign(leadsBeyond), [
    "scenes/kings-morning: exit justice goes on to garrows-toll, which isn't one of the campaign's scenes",
    "vocabulary.json is missing, and kings-morning leads to garrows-toll, which the campaign doesn't install (tools/v2/export-vocabulary.mts writes it)",
  ]);
});
