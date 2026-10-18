import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SceneDocument } from "./document.ts";
import type { CampaignFile, PlaceFile } from "./files.ts";
import { effectiveScene, IMPROVISED_EXIT_ID } from "./graph.ts";
import { loadScene, sceneOf } from "./load.ts";
import { validateScene } from "./types.ts";

/** Every scene of the campaign loads as the game loads it (scenes/<id>.kmscene, parsed and made the runtime's Scene), whole. */

const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const read = (path: string) => readFileSync(join(CAERWYN, path), "utf8");
const campaign = JSON.parse(read("campaign.json")) as CampaignFile;
const keys = [...campaign.scenes, campaign.talk!];
const doc = (key: string) => JSON.parse(read(`scenes/${key}.kmscene`)) as SceneDocument;

test("each of the campaign's scenes and its talk template loads, holds together, and has its place", () => {
  for (const key of keys) {
    const scene = loadScene(read(`scenes/${key}.kmscene`), `${key}.kmscene`);
    // (Its place as its world would say the Rat's page isn't its own: the story carries it in, with Cob.)
    const place = doc(key).place ? (JSON.parse(read(`places/${doc(key).place}.json`)) as PlaceFile) : undefined;
    assert.equal(scene.id, key);
    assert.equal(place?.key, doc(key).place, key);
    assert.deepEqual(validateScene(scene), [], key);
    assert.ok(scene.exits.length > 0 && scene.beats.some(b => b.id === scene.start), key);
    assert.deepEqual(scene.routes.map(r => r.id), doc(key).edges.map(e => e.id), `${key}: every route, in the file's order`);
  }
});

test("the arc's scenes as play has them: an ending of their own added; the story's leads carried", () => {
  const essentials = Object.fromEntries(campaign.scenes.map(key => [key, (sceneOf(doc(key)).essentials ?? []).map(e => e.id)]));
  assert.deepEqual(essentials, {
    "hanged-clerk": ["motive", "hobb"], "caerwyn-afternoon": ["lead"], "drowned-rat": ["the-master", "the-heron", "prouts-page"],
    "wharf-night": ["lead"], "heron-warehouse": [], "kings-morning": [],
  });
  const clerk = effectiveScene(sceneOf(doc("hanged-clerk")), []);
  assert.ok(clerk.exits.some(e => e.id === IMPROVISED_EXIT_ID));
  assert.equal(clerk.exits.find(e => e.id === IMPROVISED_EXIT_ID)!.next, "caerwyn-afternoon", "its ways on all go to the afternoon, and so does an ending of their own");
});

test("the story's fields come through: an interlude, what it takes for granted, the rest, the milestone, every ending's effects (story-design §4.2)", () => {
  const afternoon = sceneOf(doc("caerwyn-afternoon")), wharf = sceneOf(doc("wharf-night")), king = sceneOf(doc("kings-morning"));
  assert.deepEqual([afternoon.interlude, afternoon.rest, afternoon.time, afternoon.exits.map(e => e.next)], [true, "short", "afternoon", ["drowned-rat"]]);
  assert.deepEqual([wharf.assumes?.length, wharf.overtaken], [1, "heron-warehouse"]);
  assert.deepEqual([king.rest, king.milestone, king.time, king.exits.every(e => !e.next)], ["long", true, "next-morning", true]);
  assert.deepEqual(sceneOf(doc("hanged-clerk")).onEnd, [{ op: "follow", who: "kell" }]);
  const plain = sceneOf({ ...doc("hanged-clerk"), onEnd: undefined });
  assert.ok(!["interlude", "assumes", "overtaken", "rest", "milestone", "background", "onEnd", "companion", "anytime"].some(k => k in plain));
});
