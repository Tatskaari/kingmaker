import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PlaceFile, SceneFile } from "./files.ts";
import { effectiveScene, IMPROVISED_EXIT_ID } from "./graph.ts";
import { sceneOf } from "./load.ts";
import { validateScene } from "./types.ts";

const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const DIR = join(CAERWYN, "scenes", "hanged-clerk");
const file = JSON.parse(readFileSync(join(DIR, "scene.json"), "utf8")) as SceneFile;
const place = JSON.parse(readFileSync(join(CAERWYN, "places", "granary-yard.json"), "utf8")) as PlaceFile;
const words = (path: string) => (existsSync(join(DIR, path)) ? readFileSync(join(DIR, path), "utf8") : undefined);
const routesOf = (scene: ReturnType<typeof sceneOf>) => [...scene.beats.flatMap(b => b.transitions), ...(scene.anytime ?? [])];

test("the hanged clerk loads with its words: 5 beats, 37 routes, 5 exits (6 with an ending of their own)", () => {
  const scene = sceneOf(file, words);

  assert.equal(scene.beats.length, 5);
  assert.equal(routesOf(scene).length, 37);
  assert.equal(scene.exits.length, 5);
  assert.equal(effectiveScene(scene, []).exits.length, 6);
  assert.ok(effectiveScene(scene, []).exits.some(e => e.id === IMPROVISED_EXIT_ID));
  assert.match(scene.opening, /\S/);
  assert.ok((scene.cast.find(c => c.id === "kell")?.knows.length ?? 0) > 0);
  assert.deepEqual(validateScene({ ...scene, world: place }), []);
});

test("its routes' facts resolve to the sentences the GM is told", () => {
  const sentences = new Set(Object.values(file.facts));
  const established = routesOf(sceneOf(file)).flatMap(t => [...(t.establishes ?? []), ...(t.check?.establishes?.success ?? []), ...(t.check?.establishes?.failure ?? [])]);

  assert.equal(Object.keys(file.facts).length, 5);
  assert.ok(established.length > 0);
  assert.deepEqual(established.filter(s => !sentences.has(s)), []);
});

test("without its words the scene is the same structure, every Markdown field empty", () => {
  const full = sceneOf(file, words);
  const bare = sceneOf(file);

  assert.deepEqual(routesOf(bare), routesOf(full));
  assert.deepEqual(bare.exits.map(e => [e.id, e.kind, e.title, e.next, e.effects]), full.exits.map(e => [e.id, e.kind, e.title, e.next, e.effects]));
  assert.deepEqual(bare.cast.map(c => [c.id, c.name, c.called, c.enters]), full.cast.map(c => [c.id, c.name, c.called, c.enters]));
  assert.deepEqual([bare.setting, bare.premise, bare.hook, bare.opening, bare.limits], ["", "", "", "", []]);
  assert.equal(bare.cast[0]!.look, "");
});

test("with words, a missing file or a card without a section it needs doesn't load", () => {
  assert.throws(() => sceneOf(file, path => (path === "opening.md" ? undefined : words(path))), /hanged-clerk: no opening\.md/);
  assert.throws(() => sceneOf(file, path => (path === "cast/kell.md" ? "## Look\n\nTall.\n" : words(path))), /cast\/kell\.md has no "## Voice"/);
});

test("the story's fields come through: an interlude, what it takes for granted, the rest, the milestone, every ending's effects (story-design §4.2)", () => {
  const story: SceneFile = {
    ...file, interlude: true, assumes: ["The barge hasn't sailed."], overtaken: "kings-morning", rest: "long", milestone: true,
    background: ["Sallow came at midnight."], onEnd: [{ op: "follow", who: "kell" }],
  };
  const scene = sceneOf(story);

  assert.deepEqual([scene.interlude, scene.assumes, scene.overtaken, scene.rest, scene.milestone, scene.background, scene.onEnd],
    [true, ["The barge hasn't sailed."], "kings-morning", "long", true, ["Sallow came at midnight."], [{ op: "follow", who: "kell" }]]);
  const plain = sceneOf(file);
  assert.ok(!["interlude", "assumes", "overtaken", "rest", "milestone", "background", "onEnd"].some(k => k in plain));
});
