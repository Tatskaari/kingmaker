import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseScene, SceneFormatError, sceneDocumentOf, type SceneDocument } from "./document.ts";
import { sceneOf } from "./load.ts";
import { validateScene } from "./types.ts";

/** The scene format (docs/scene-format.md): a .kmscene file parsed, what's wrong with one said, and the runtime's Scene made from it. */

const FILE = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn", "scenes", "hanged-clerk.kmscene");
const TEXT = readFileSync(FILE, "utf8");
const clerk = () => JSON.parse(TEXT) as SceneDocument;

/** The problems a changed copy of the hanged clerk is refused for. */
function problemsOf(change: (d: SceneDocument & Record<string, unknown>) => void): string[] {
  const d = clerk() as SceneDocument & Record<string, unknown>;
  change(d);
  try {
    sceneDocumentOf(d, "hanged-clerk.kmscene");
  } catch (e) {
    assert.ok(e instanceof SceneFormatError);
    return e.problems;
  }
  return [];
}

test("the hanged clerk parses as it is, unknown keys kept", () => {
  const doc = parseScene(TEXT, "hanged-clerk.kmscene");
  assert.equal(doc.id, "hanged-clerk");
  assert.deepEqual(doc.nodes.map(n => [n.id, n.data.kind]), [["start", "start"], ["murder", "beat"], ["motive", "beat"], ["hobb", "beat"], ["cart-arrives", "beat"], ["murder-unknown", "exit"], ["suspicious", "exit"], ["failed", "exit"]]);
  const kept = sceneDocumentOf({ ...clerk(), plugin: { zoom: 1.5 } });
  assert.deepEqual((kept as unknown as { plugin: unknown }).plugin, { zoom: 1.5 });
});

test("a file that isn't a scene says why, naming where", () => {
  assert.throws(() => parseScene("{ not json", "x.kmscene"), /^SceneFormatError: x\.kmscene: it isn't JSON/);
  assert.deepEqual(problemsOf(d => { d.version = 1 as 2; }), ['it isn\'t a scene of the kingmaker format, version 2 (format "kingmaker", version 1, kind "scene")']);
  assert.deepEqual(problemsOf(d => { delete (d as Partial<SceneDocument>).truth; }), ["it has no truth"]);
  const noStart = problemsOf(d => { d.nodes = d.nodes.filter(n => n.id !== "start"); });
  assert.ok(noStart.includes("it has 0 start nodes, not one"), noStart.join("\n"));
  assert.ok(noStart.includes('edges[0] (find-murder)\'s source "start" isn\'t a node of the scene'), noStart.join("\n"));
  assert.deepEqual(problemsOf(d => { d.nodes.push({ ...d.nodes[1]!, position: { x: 0, y: 0 } }); }), ["nodes[8] (murder): the node id murder is there twice"]);
  assert.deepEqual(problemsOf(d => { d.edges[0]!.data.skill = "lockpicking" as "insight"; }), ['edges[0] (find-murder)\'s skill "lockpicking" isn\'t a skill (or "" for no dice)']);
  assert.deepEqual(problemsOf(d => { d.edges[4]!.data.requires = ["murder", "nowhere"]; }), ["edges[4] (signed-murder) requires nowhere, which isn't a node of the scene"]);
  assert.deepEqual(problemsOf(d => { d.edges[0]!.data.establishes = ["no-such-fact"]; }), ["edges[0] (find-murder) establishes no-such-fact, which isn't one of its facts"]);
  assert.deepEqual(problemsOf(d => { d.edges.push({ ...d.edges[0]! }); }), ["edges[7] (find-murder): the route id find-murder is there twice"]);
  assert.deepEqual(problemsOf(d => { (d.nodes[1]!.data as { paths: Array<{ strength: string }> }).paths[0]!.strength = "damning"; }), ['nodes[1] (murder): paths[0] has strength "damning", not one of hook, suggestive, strong, proof']);
  assert.deepEqual(problemsOf(d => { (d.nodes[5]!.data as { result: string }).result = "great"; }), ['nodes[5] (murder-unknown): its result "great" isn\'t good, mixed or bad']);
  assert.deepEqual(problemsOf(d => { delete (d.cast[0] as Partial<SceneDocument["cast"][number]>).whyHere; }), ["cast[0] (kell) has no whyHere"]);
});

test("a cue's outer limit: each count a whole number of exchanges, after and until nodes of the scene; the runtime keeps a cue's, and only a cue's", () => {
  assert.deepEqual(problemsOf(d => { d.edges[3]!.data.limit = [{ exchanges: 0 }, { exchanges: 4, after: "nowhere", until: ["murder", "elsewhere"] }]; }), [
    "edges[3] (cart-comes)'s limit[0] has no whole number of exchanges",
    'edges[3] (cart-comes)\'s limit[1] counts after "nowhere", which isn\'t a node of the scene',
    "edges[3] (cart-comes)'s limit[1] counts until elsewhere, which isn't a node of the scene",
  ]);
  assert.deepEqual(problemsOf(d => { (d.edges[3]!.data as { limit: unknown }).limit = { exchanges: 12 }; }), ["edges[3] (cart-comes)'s limit isn't a list of { exchanges, after?, until? }"]);
  assert.deepEqual(sceneOf(clerk()).routes.find(r => r.id === "cart-comes")!.limit, [{ exchanges: 12 }], "the noon bell: twelve exchanges into the scene");
  const outcome = clerk();
  outcome.edges[4]!.data.limit = [{ exchanges: 3 }];
  assert.equal(sceneOf(outcome).routes.find(r => r.id === "signed-murder")!.limit, undefined, "an outcome route's limit is nothing in play");
});

test("its error's message names the file and the first problems, and how many more", () => {
  const e = (() => { try { sceneDocumentOf({ ...clerk(), format: "other", title: 1, hook: 2, setting: 3, premise: 4 }, "hanged-clerk.kmscene"); } catch (error) { return error as SceneFormatError; } })()!;
  assert.equal(e.problems.length, 5);
  assert.match(e.message, /^hanged-clerk\.kmscene: it isn't a scene of the kingmaker format.*; it has no title; it has no hook; it has no setting; and 1 more$/);
});

test("the runtime's Scene: the start and the beats with the routes that leave them, the endings, every route flat, and what the story needs carried as essentials", () => {
  const scene = sceneOf(clerk());

  assert.deepEqual([scene.start, scene.beats.map(b => b.id), scene.exits.map(e => [e.id, e.kind, e.result, e.next])], [
    "start", ["start", "murder", "motive", "hobb", "cart-arrives"],
    [["murder-unknown", "progress", "good", "caerwyn-afternoon"], ["suspicious", "progress", "mixed", "caerwyn-afternoon"], ["failed", "other", "bad", undefined]],
  ]);
  assert.equal(scene.opening, clerk().nodes[0]!.data.description);
  assert.equal(scene.anytime, undefined);
  assert.deepEqual(scene.beats.map(b => [b.id, b.transitions.map(t => `${t.id}:${t.on}:${t.to}`)]), [
    ["start", ["find-murder:outcome:murder", "find-motive:outcome:motive", "find-hobb:outcome:hobb", "cart-comes:cue:cart-arrives", "case-lost:outcome:failed"]],
    ["murder", []], ["motive", []], ["hobb", []],
    ["cart-arrives", ["signed-murder:outcome:murder-unknown", "signed-suicide:outcome:suspicious"]],
  ]);
  const start = scene.beats[0]!.transitions;
  assert.match(start[0]!.when, /^The player has come to understand this: Prout didn't hang himself/, "a route into a discovery with no condition: its revelation landing");
  assert.deepEqual(scene.beats[4]!.transitions[0]!.requires, ["murder", "hobb"]);
  assert.deepEqual(scene.routes.map(r => [r.id, r.source, r.target, r.phase, r.requires]), [
    ["find-murder", "start", "murder", "outcome", undefined], ["find-motive", "start", "motive", "outcome", undefined], ["find-hobb", "start", "hobb", "outcome", undefined],
    ["cart-comes", "start", "cart-arrives", "cue", undefined], ["signed-murder", "cart-arrives", "murder-unknown", "outcome", ["murder", "hobb"]],
    ["signed-suicide", "cart-arrives", "suspicious", "outcome", ["hobb"]], ["case-lost", "start", "failed", "outcome", undefined],
  ]);

  const hobb = scene.beats.find(b => b.id === "hobb")!;
  assert.deepEqual([hobb.required, hobb.establishes, hobb.paths?.length, hobb.revelation?.slice(0, 26)], [true, ["hobb-at-granary"], 4, "A huge man with a bandaged"]);
  assert.deepEqual(scene.essentials!.map(e => [e.id, e.placedWith, e.carriers, e.later !== undefined, e.things]), [
    ["motive", ["cob", "kell", "the tally loft", "tull"], ["cob", "kell", "tull"], true, ["ledger-page"]],
    ["hobb", ["cob", "moll", "the porters at the far gate", "kell"], ["cob", "moll", "kell"], true, undefined],
  ]);
  assert.equal(scene.essentials![0]!.what, scene.beats.find(b => b.id === "motive")!.revelation);

  const tull = scene.cast.find(c => c.id === "tull")!;
  assert.deepEqual([tull.enters, tull.called, tull.statblock, tull.whyHere?.slice(0, 20), tull.lore], ["cart-arrives", "the corporal", "guard", "Arrives with the dea", "Cast/Corporal Abner Tull/public.md"]);
  assert.ok(scene.cast.every(c => c.roles?.characterise));
  assert.deepEqual([Object.keys(scene.facts!), scene.truth?.slice(0, 11), scene.clock?.slice(0, 14)], [["killed-not-suicide", "motive-known", "hobb-at-granary"], "Prout found", "The dead-cart "]);
  assert.deepEqual([scene.onEnd, scene.afterwards?.length, scene.limits?.length, scene.fronts], [[{ op: "follow", who: "kell" }], 1, 9, "World/Fronts.md"]);
  assert.deepEqual(validateScene(scene), []);
});

test("a dice route is an attempt with its check, its facts settled on success; a talk's ways into its ending are anytime attempts", () => {
  const d = clerk();
  d.edges[4]!.data = { ...d.edges[4]!.data, skill: "persuasion", dc: 14, onFailure: "suspicious", establishes: ["motive-known"] };
  const signed = sceneOf(d).beats[4]!.transitions[0]!;
  assert.deepEqual([signed.on, signed.to, signed.establishes], ["attempt", undefined, undefined]);
  assert.deepEqual({ ...signed.check, success: undefined, failure: undefined }, {
    skill: "persuasion", dc: 14, success: undefined, failure: undefined, onSuccess: "murder-unknown", onFailure: "suspicious",
    establishes: { success: [d.facts!["motive-known"]] },
  });

  const talk = sceneOf({ ...clerk(), companion: "kell" });
  assert.deepEqual(talk.anytime?.map(t => [t.id, t.on, t.to]), [["signed-murder", "attempt", "murder-unknown"], ["signed-suicide", "attempt", "suspicious"], ["case-lost", "attempt", "failed"]]);
  assert.deepEqual(talk.beats.map(b => b.transitions.length), [4, 0, 0, 0, 0], "the ways into the discoveries and the cue stay where they leave from");
});
