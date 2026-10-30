import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadScene } from "../../shared/scene/load.ts";
import { checkCampaign, packOf, readCampaignFiles, type CampaignFiles } from "./campaign.ts";
import { prepText } from "../../ai/gm/suggest.ts";
import { vocabularyOf, type Vocabulary } from "../../ai/gm/story.ts";
import { entryOf, vocabularyProblems } from "./vocabulary.ts";

const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const files = readCampaignFiles(CAERWYN);
const VOCAB = "vocabulary.json", SCENE = "scenes/hanged-clerk.kmscene";
const vocabulary = vocabularyOf(files[VOCAB]!) as Vocabulary;
const ARC = ["hanged-clerk", "caerwyn-afternoon", "drowned-rat", "wharf-night", "heron-warehouse", "kings-morning"];

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

test("caerwyn's vocabulary is fit: the prototype's scenes the campaign doesn't install, each once, every way on an entry or an installed scene", () => {
  const ids = vocabulary.scenes.map(e => e.id);

  assert.deepEqual(checkCampaign(files), []);
  assert.deepEqual(vocabularyProblems(files, packOf(files)), []);
  assert.equal(vocabulary.source, "44c6d4a");
  assert.equal(ids.length, 19, "the prototype's 25 scenes but the arc's six, which the campaign installs");
  assert.equal(new Set(ids).size, 19);
  assert.ok(!ids.some(id => ARC.includes(id)));
  assert.ok(vocabulary.scenes.every(e => e.next.every(id => ids.includes(id) || ARC.includes(id))));
});

test("an installed scene is read from its file, in an entry's place: what the tool would write for it comes from the scene", () => {
  const scene = loadScene(files[SCENE]!, SCENE);
  const entry = entryOf(scene, packOf(files).places.find(p => p.key === "granary-yard"));

  assert.deepEqual([entry.id, entry.next, entry.prep], ["hanged-clerk", ["caerwyn-afternoon"], prepText(scene)]);
  assert.deepEqual(entry.cast.map(c => c.called ?? c.name), ["Sergeant Agnes Kell", "the boy in the too-big boots", "the girl in the shawl", "the corporal", "the old porter"]);
  assert.ok(entry.worldNames!.includes("the lane"));
});

test("an entry for a scene the campaign installs is out of date by being there: it's found", () => {
  const stale = changed(VOCAB, v => { v.scenes.push({ id: "hanged-clerk", hook: "x", next: [], cast: [], prep: "x" }); });

  assert.deepEqual(checkCampaign(stale), ["vocabulary.json: hanged-clerk has an entry, but the campaign installs it: the AI service reads it from its file, so drop the entry"]);
});

test("an id twice, or a way on to nowhere, is found", () => {
  const twice = changed(VOCAB, v => { v.scenes.push({ ...v.scenes[0] }); });
  const nowhere = changed(VOCAB, v => { v.scenes.find((e: any) => e.id === "stranger-crossroads").next.push("the-moon"); });

  assert.deepEqual(checkCampaign(twice), ["vocabulary.json: stranger-crossroads is there twice"]);
  assert.deepEqual(checkCampaign(nowhere), ["vocabulary.json: stranger-crossroads leads to the-moon, which is neither an entry nor an installed scene"]);
});

test("a way on to a scene the campaign installs needs no entry", () => {
  const installedOnly = changed(VOCAB, v => { v.scenes.find((e: any) => e.id === "stranger-crossroads").next.push("hanged-clerk"); });

  assert.deepEqual(checkCampaign(installedOnly), []);
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
  const KING = "scenes/kings-morning.kmscene";
  const king = JSON.parse(files[KING]!);
  king.nodes.find((n: any) => n.id === "justice").data.next = "garrows-toll";
  const leadsBeyond = { ...none, [KING]: JSON.stringify(king) };

  assert.deepEqual(checkCampaign(none), []);
  assert.deepEqual(checkCampaign(leadsBeyond), [
    "scenes/kings-morning.kmscene: ending justice goes on to garrows-toll, which isn't one of the campaign's scenes",
    "vocabulary.json is missing, and kings-morning leads to garrows-toll, which the campaign doesn't install (the prototype's tools/v2/export-vocabulary.mts wrote it: git show bc2ab1f:tools/v2/export-vocabulary.mts)",
  ]);
});
