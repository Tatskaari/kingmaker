import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { campaigns } from "../service/campaigns.ts";
import { folderStores } from "../service/folder-stores.ts";
import { CAERWYN, hangedClerk, stateIn } from "./fixtures.ts";
import { linkMarks } from "./knowledge.ts";
import { storyOf, type Vocabulary } from "./story.ts";
import { everyday, storyScenes, vetting } from "./suggest.ts";

/**
 * The story the suggested lines are vetted against (v5-design §3.8): the campaign's installed
 * scenes, read live, and its vocabulary.json for the prototype's others. With the arc's six scenes
 * installed (story-design §4.6), the vetting is still the prototype's: its story is the hanged clerk,
 * caerwyn-afternoon, the Rat, wharf-night, the Heron and the King's morning (by the prototype's
 * storyScenes, checked once against its own code: A-report §2), and its everyday words the other 19
 * scenes' prep and the GM's prompts, 2,560 stems.
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

test("the campaign's story: the scenes it installs, their places as their worlds, and the vocabulary's stubs for the rest", async () => {
  const story = (await installed()).story;
  const yard = story.scene("hanged-clerk")!;
  const rat = story.scene("drowned-rat")!;
  const ambush = story.scene("crossroads-ambush")!; // one of the 19 the campaign doesn't install

  assert.equal(story.id, "caerwyn@0.1.0");
  assert.equal(story.all().length, 25, "the prototype's 25 scenes, the arc's six among them");
  assert.equal(yard.prep, undefined, "an installed scene's prep is read from it, live");
  assert.ok(yard.world?.areas.some(a => a.name === "the lane"), "its place's areas and things, by name");
  assert.ok(yard.exits.some(e => e.id === "own-ending"), "as play has it: an ending of its own");
  assert.equal(rat.prep, undefined, "the Rat is installed now, so it's read live too");
  assert.match(rat.cast.find(c => c.id === "nan-quill")?.voice ?? "", /\S/, "its cards whole");
  assert.match(ambush.prep ?? "", /milestone/);
  assert.deepEqual(ambush.cast.find(c => c.id === "tam"), { id: "tam", name: "Tam Hollis", look: "", voice: "", wants: "", knows: [], attitude: "" });
  assert.deepEqual(ambush.exits.map(e => [e.id, e.next]), [["to-crossroads-aftermath", "crossroads-aftermath"], ["own-ending", "crossroads-aftermath"]], "its ways on, and an ending of its own that goes the same way, as sceneById has it");
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

test("a version PUT again is vetted with its new words: what the vetting keeps goes with the story it was kept for", async () => {
  const stores = folderStores(mkdtempSync(join(scratch, "store-")));
  const all = campaigns(stores.campaigns, stores.docsRoot);
  const files = filesOf(CAERWYN);
  const scene = hangedClerk();
  const vettingNow = () => vetting(scene, { ...stateIn("hanged-clerk"), story: all.use("caerwyn", "0.1.0").story });
  await all.put("caerwyn", "0.1.0", files);
  const before = vettingNow();

  // Hobb comes from the installed Rat and Heron (and the vocabulary's entries for them): rename him in every file.
  const withoutHobb = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, text.replaceAll("Hobb", "Someone")]));
  await all.put("caerwyn", "0.1.0", withoutHobb);
  const after = vettingNow();

  assert.deepEqual([before.names.includes("Hobb"), before.proper.includes("Hobb")], [true, true], "Hobb, from the Rat and the Heron, is a name the player hasn't heard");
  assert.deepEqual([after.names.includes("Hobb"), after.proper.includes("Hobb")], [false, false], "gone from the words PUT since, in the same process");
});

test("so does the notes' index of the public lore: a version PUT again links a phrase by its new lore", async () => {
  const stores = folderStores(mkdtempSync(join(scratch, "store-")));
  const all = campaigns(stores.campaigns, stores.docsRoot);
  const files = filesOf(CAERWYN);
  const linked = (phrase: string) => {
    const story = all.use("caerwyn", "0.1.0").story;
    const text = `She nods towards ${phrase}.`;
    const start = text.indexOf(phrase);
    const marks = linkMarks({ speech: [], marks: [{ start, end: start + phrase.length, kind: "know", note: "Where the grain is sold." }] }, text, hangedClerk(), { ...stateIn("hanged-clerk"), story }).marks;
    return marks[0]!.link;
  };
  await all.put("caerwyn", "0.1.0", files);
  const before = [linked("the market square"), linked("the Corn Exchange")];

  const { "lore/Places/Market Square.md": square, ...rest } = files;
  await all.put("caerwyn", "0.1.0", { ...rest, "lore/Places/Corn Exchange.md": square!.replace("# The market square and the Corn Exchange", "# The Corn Exchange") });
  const after = [linked("the market square"), linked("the Corn Exchange")];

  assert.deepEqual(before, [{ kind: "lore", path: "Places/Market Square.md" }, undefined]);
  assert.deepEqual(after, [undefined, { kind: "lore", path: "Places/Corn Exchange.md" }]);
});
