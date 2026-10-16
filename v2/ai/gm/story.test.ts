import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { campaigns } from "../service/campaigns.ts";
import { folderStores } from "../service/folder-stores.ts";
import { CAERWYN, hangedClerk, stateIn } from "./fixtures.ts";
import { storyOf, type Vocabulary } from "./story.ts";
import { everyday, storyScenes, vetting } from "./suggest.ts";

/**
 * The story the suggested lines are vetted against (v5-design §3.8): the campaign's installed
 * scenes, read live, and its vocabulary.json for the prototype's others. With the hanged clerk the
 * only scene installed, the vetting is the prototype's: its story is itself, caerwyn-afternoon, the
 * Rat, wharf-night, the Heron and the King's morning (by the prototype's storyScenes, checked once
 * against its own code: A-report §2), and its everyday words the other 19 scenes' prep and the GM's
 * prompts, 2,560 stems.
 */

function filesOf(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string) => { for (const name of readdirSync(at)) { const p = join(at, name); if (statSync(p).isDirectory()) walk(p); else files[relative(dir, p)] = readFileSync(p, "utf8"); } };
  walk(dir);
  return files;
}

/** Where the tests' stores go, removed when they're done. */
const scratch = mkdtempSync(join(tmpdir(), "km-story-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** The campaign as the AI service has it once the install tool has PUT it. */
async function installed() {
  const stores = folderStores(mkdtempSync(join(scratch, "store-")));
  const all = campaigns(stores.campaigns, stores.docsRoot);
  await all.put("caerwyn", "0.1.0", filesOf(CAERWYN));
  return all.use("caerwyn", "0.1.0");
}

test("the campaign's story: the scene it installs, its place as its world, and the vocabulary's stubs for the rest", async () => {
  const story = (await installed()).story;
  const yard = story.scene("hanged-clerk")!;
  const rat = story.scene("drowned-rat")!;

  assert.equal(story.id, "caerwyn@0.1.0");
  assert.equal(story.all().length, 25, "the prototype's 25 scenes, the hanged clerk among them");
  assert.equal(yard.prep, undefined, "an installed scene's prep is read from it, live");
  assert.ok(yard.world?.areas.some(a => a.name === "the lane"), "its place's areas and things, by name");
  assert.ok(yard.exits.some(e => e.id === "own-ending"), "as play has it: an ending of its own");
  assert.match(rat.prep ?? "", /Nan Quill/);
  assert.deepEqual(rat.cast.find(c => c.id === "nan-quill"), { id: "nan-quill", name: "Nan Quill", called: "the landlady", look: "", voice: "", wants: "", knows: [], attitude: "" });
  assert.deepEqual(rat.exits.map(e => [e.id, e.next]), [["to-wharf-night", "wharf-night"], ["own-ending", "wharf-night"]], "its ways on, and an ending of its own that goes the same way, as sceneById has it");
  assert.equal(story.scene("no-such-scene"), undefined);
});

test("an installed scene wins over its entry in the vocabulary", () => {
  const vocabulary = JSON.parse(readFileSync(join(CAERWYN, "vocabulary.json"), "utf8")) as Vocabulary;
  const tampered = { ...vocabulary, scenes: vocabulary.scenes.map(e => (e.id === "hanged-clerk" ? { ...e, prep: "Tampered.", cast: [] } : e)) };
  const story = storyOf("caerwyn@tampered", { keys: ["hanged-clerk"], scene: () => hangedClerk() }, tampered);

  assert.notEqual(story.scene("hanged-clerk")!.prep, "Tampered.");
  assert.deepEqual(story.scene("hanged-clerk")!.cast.map(c => c.id), ["kell", "cob", "moll", "tull"]);
  assert.equal(story.all().find(s => s.id === "hanged-clerk")!.prep, undefined);
});

test("the hanged clerk's story and the words any other scene might use are the prototype's", async () => {
  const story = (await installed()).story;
  const scene = hangedClerk();
  const state = { ...stateIn("hanged-clerk"), story };
  const played = storyScenes(scene, state);

  assert.deepEqual(played.map(s => s.id), ["hanged-clerk", "caerwyn-afternoon", "drowned-rat", "wharf-night", "heron-warehouse", "kings-morning"]);
  assert.equal(everyday(played, story).size, 2560);
  // The Heron is a name of the story's, and its river door a place of it, though nobody has said either.
  const v = vetting(scene, state);
  assert.ok(v.proper.includes("Heron"));
  assert.ok(v.places?.includes("river door"));
});
