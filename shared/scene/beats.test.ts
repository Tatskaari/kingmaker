import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initialGm, type GmState } from "../gm/state.ts";
import { endingOf, enteringAt, openRoutes, reachDiscoveries, reachedOf, stageOf, takeRoute, targetsOf, type Taken } from "./beats.ts";
import type { SceneDocument } from "./document.ts";
import { presentCast } from "./graph.ts";
import { sceneOf } from "./load.ts";
import { loadScenario, scenarioPath } from "./scenario.ts";

/** Where the scene is (docs/two-part-design.md "Where the scene is"), on the hanged clerk as the campaign has it. */

const DOC = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "campaigns", "caerwyn", "scenes", "hanged-clerk.kmscene"), "utf8")) as SceneDocument;
const scene = sceneOf(DOC);
const facts = DOC.facts!;
const ids = (list: Array<{ id: string }>) => list.map(x => x.id);

/** A move that must be made: its new state. */
function took(taken: Taken): GmState {
  if ("error" in taken) assert.fail(taken.error);
  return taken.gm;
}

/** A move that must be refused: why. */
function refused(taken: Taken): string {
  if (!("error" in taken)) assert.fail(`taken to ${taken.reached}`);
  return taken.error;
}

test("as the scene opens its start is reached and is the stage; its routes are open, the discoveries are its targets", () => {
  const gm = initialGm(scene);

  assert.deepEqual([reachedOf(gm), gm.beat, stageOf(scene, gm).id], [["start"], "start", "start"]);
  assert.deepEqual(ids(openRoutes(scene, gm)), ["find-murder", "find-motive", "find-hobb", "cart-comes", "case-lost"]);
  assert.deepEqual(ids(targetsOf(scene, gm)), ["murder", "motive", "hobb"]);
  assert.equal(endingOf(scene, gm), undefined);
  assert.deepEqual(reachedOf({ beat: "cart-arrives", reached: [] }), ["cart-arrives"], "a state from before M2: its stage stands for what's reached");
});

test("a discovery reached: added, its fact settled, carried (landed), its route shut; the stage stays", () => {
  const before = initialGm(scene);
  const gm = took(takeRoute(scene, before, "find-hobb", "none", 3));

  assert.deepEqual(gm.reached, ["start", "hobb"]);
  assert.deepEqual(gm.established, [facts["hobb-at-granary"]]);
  assert.deepEqual(gm.landed, ["hobb"], "a beat the story carries, reached, isn't owed");
  assert.deepEqual([gm.beat, stageOf(scene, gm).id, gm.closing], ["start", "start", undefined]);
  assert.deepEqual(gm.path, [{ turn: 3, from: "start", to: "hobb", via: "find-hobb", source: "post", known: 0 }]);
  assert.deepEqual(ids(targetsOf(scene, gm)), ["murder", "motive"]);
  assert.ok(!ids(openRoutes(scene, gm)).includes("find-hobb"));
  assert.deepEqual([before.reached, before.established, before.path], [["start"], [], []], "the state it was handed is as it was");

  const murder = took(takeRoute(scene, gm, "find-murder", "success", 4));
  assert.deepEqual([murder.reached, murder.landed], [["start", "hobb", "murder"], ["hobb"]], "a discovery the story doesn't carry is reached, not landed");
  assert.match(refused(takeRoute(scene, murder, "find-murder", "none", 5)), /^\[find-murder\] isn't open: it goes to The victim was murdered \[murder\], which the scene has reached already\. The open routes: \[find-motive\]/);
});

test("the cue moves the stage to the event and brings on who enters there; the routes from it open, an ending's only once what it requires is reached", () => {
  const cart = took(takeRoute(scene, initialGm(scene), "cart-comes", "none", 2));

  assert.deepEqual([cart.beat, stageOf(scene, cart).id, cart.turnsInBeat], ["cart-arrives", "cart-arrives", 0]);
  assert.deepEqual(ids(enteringAt(scene, "cart-arrives")), ["tull"]);
  assert.ok(ids(presentCast(scene, cart)).includes("tull"), "the corporal is here now");
  assert.ok(!ids(presentCast(scene, initialGm(scene))).includes("tull"), "and wasn't before");
  assert.deepEqual(ids(openRoutes(scene, cart)), ["find-murder", "find-motive", "find-hobb", "case-lost"], "the start's routes stay open; neither signing is, with nothing found");

  const error = refused(takeRoute(scene, cart, "signed-murder", "none", 3));
  assert.match(error, /^\[signed-murder\] isn't open: it requires The victim was murdered \[murder\] and Hobb was spotted at the scene \[hobb\], not reached yet\. The open routes: \[find-murder\] It was murder \(to The victim was murdered\); /);
  assert.match(error, /\[case-lost\] Last resort \(to Failed\)\.$/);

  const hobb = took(takeRoute(scene, cart, "find-hobb", "none", 3));
  assert.deepEqual(ids(openRoutes(scene, hobb)).filter(id => id.startsWith("signed")), ["signed-suicide"], "the lead alone: Kell can only object in writing");
  assert.match(refused(takeRoute(scene, hobb, "signed-murder", "none", 4)), /it requires The victim was murdered \[murder\], not reached yet/);
  assert.equal(stageOf(scene, hobb).id, "cart-arrives", "a discovery doesn't move the stage");
});

test("an ending reached sets closing; after it nothing is open and no route is taken", () => {
  let gm = took(takeRoute(scene, initialGm(scene), "find-murder", "none", 1));
  gm = took(takeRoute(scene, gm, "find-hobb", "none", 2));
  gm = took(takeRoute(scene, gm, "cart-comes", "none", 3));
  gm = took(takeRoute(scene, gm, "signed-murder", "none", 4));

  assert.deepEqual(gm.closing, { exitId: "murder-unknown", turn: 4 });
  assert.deepEqual([gm.reached, gm.beat], [["start", "murder", "hobb", "cart-arrives", "murder-unknown"], "cart-arrives"]);
  assert.equal(endingOf(scene, gm)?.id, "murder-unknown");
  assert.deepEqual(openRoutes(scene, gm), []);
  assert.equal(refused(takeRoute(scene, gm, "case-lost", "none", 5)), "The scene has reached its ending, Murder by persons unknown [murder-unknown]: it closes on the next reply, and no route is open.");
  assert.deepEqual(gm.established, [facts["killed-not-suicide"], facts["hobb-at-granary"]]);
});

test("a dice route: it refuses none; success goes to its target, settling its facts; failure goes to onFailure, or stays where it is", () => {
  // The clerk's routes have no dice: the test gives the corporal a check, failure into the mixed ending.
  const doc = structuredClone(DOC);
  doc.edges.push({ id: "talk-tull-round", source: "cart-arrives", target: "murder-unknown", type: "smoothstep", label: "Talk the corporal round", data: { condition: "The player argues the corporal into taking Prout in as a murder.", phase: "outcome", requires: ["hobb"], skill: "persuasion", dc: 15, onFailure: "suspicious", establishes: ["motive-known"] } });
  doc.edges.push({ id: "climb", source: "start", target: "murder", type: "smoothstep", label: "Climb to the body", data: { condition: "The player climbs the hoist to look at the body.", phase: "outcome", skill: "athletics", dc: 13 } });
  const dice = sceneOf(doc);
  let gm = took(takeRoute(dice, initialGm(dice), "find-hobb", "none", 1));
  gm = took(takeRoute(dice, gm, "cart-comes", "none", 2));

  assert.equal(refused(takeRoute(dice, gm, "talk-tull-round", "none", 3)), "[talk-tull-round] is decided by dice (persuasion DC 15): move it on the check's outcome, success or failure.");
  assert.equal(refused(takeRoute(dice, gm, "cart-comes", "failure", 3)), "[cart-comes] isn't open: it goes to The dead-cart arrives [cart-arrives], which the scene has reached already. " + refused(takeRoute(dice, gm, "nowhere", "none", 3)).replace("There's no route [nowhere] in this scene. ", ""));
  assert.match(refused(takeRoute(dice, gm, "find-murder", "failure", 3)), /^\[find-murder\] has no dice/);

  const won = took(takeRoute(dice, gm, "talk-tull-round", "success", 3));
  assert.deepEqual([won.closing, won.established.at(-1)], [{ exitId: "murder-unknown", turn: 3 }, facts["motive-known"]]);
  const lost = took(takeRoute(dice, gm, "talk-tull-round", "failure", 3));
  assert.deepEqual([lost.closing, lost.reached.at(-1), lost.established.includes(facts["motive-known"]!)], [{ exitId: "suspicious", turn: 3 }, "suspicious", false]);

  const fell = takeRoute(dice, gm, "climb", "failure", 3);
  const stayed = took(fell);
  assert.equal("reached" in fell ? fell.reached : undefined, undefined, "nowhere to go: the scene stays where it is");
  assert.deepEqual([stayed.reached, stayed.beat, stayed.path.at(-1)], [gm.reached, "cart-arrives", { turn: 3, from: "cart-arrives", to: "cart-arrives", via: "climb", source: "post", known: 1 }]);
  assert.ok(ids(openRoutes(dice, stayed)).includes("climb"), "and the route is still there to try again");
});

test("a fight already fought isn't offered again: the scene picked up after it can end another way", () => {
  // The Heron's fight, fought by the stand-in (story/fight.ts): its ending no longer reached, and spent.
  const heron = sceneOf(JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "campaigns", "caerwyn", "scenes", "heron-warehouse.kmscene"), "utf8")) as SceneDocument);
  let gm = took(takeRoute(heron, initialGm(heron), "master-comes", "none", 1));
  gm = took(takeRoute(heron, gm, "cornered", "none", 2));
  assert.equal(gm.closing?.exitId, "fight");
  const after: GmState = { ...gm, reached: gm.reached.filter(id => id !== "fight"), fought: ["fight"] };
  delete after.closing;

  const open = ids(openRoutes(heron, after));
  assert.ok(!open.includes("cornered") && !open.includes("attack"), "no way back into the fight");
  assert.ok(open.includes("overpowered") || open.includes("cast-off"), "the night's other endings are open again");
  assert.match(refused(takeRoute(heron, after, "attack", "none", 3)), /^\[attack\] isn't open: it goes to Roll for initiative \[fight\], a fight already fought\./);
});

test("a thorough end's discoveries: each the scene can reach taken through its open route in the scene's order, its facts settled and a carried one landed; the stage stays; a dice route on its success", () => {
  const before = initialGm(scene);
  const done = reachDiscoveries(scene, before, 6);

  assert.deepEqual(done.reached, ["murder", "motive", "hobb"]);
  assert.deepEqual([done.gm.reached, done.gm.landed], [["start", "murder", "motive", "hobb"], ["motive", "hobb"]]);
  assert.deepEqual(done.gm.established, [facts["killed-not-suicide"], facts["motive-known"], facts["hobb-at-granary"]]);
  assert.deepEqual(done.gm.path.map(p => [p.turn, p.from, p.to, p.via]), [[6, "start", "murder", "find-murder"], [6, "start", "motive", "find-motive"], [6, "start", "hobb", "find-hobb"]]);
  assert.deepEqual([done.gm.beat, done.gm.closing, targetsOf(scene, done.gm)], ["start", undefined, []], "no event, no ending");
  assert.deepEqual([before.reached, before.landed], [["start"], []], "the state it was handed is as it was");
  assert.deepEqual(reachDiscoveries(scene, done.gm, 7), { gm: done.gm, reached: [] }, "nothing left to reach");

  const cart = reachDiscoveries(scene, took(takeRoute(scene, initialGm(scene), "cart-comes", "none", 1)), 2);
  assert.deepEqual([cart.reached, cart.gm.beat], [["murder", "motive", "hobb"], "cart-arrives"], "from the stage it's at");

  const doc = structuredClone(DOC);
  doc.edges = doc.edges.filter(e => e.id !== "find-murder");
  doc.edges.push({ id: "climb", source: "start", target: "murder", type: "smoothstep", label: "Climb to the body", data: { condition: "The player climbs the hoist to look at the body.", phase: "outcome", skill: "athletics", dc: 13 } });
  const climbed = reachDiscoveries(sceneOf(doc), initialGm(sceneOf(doc)), 1);
  assert.deepEqual(climbed.gm.path.find(p => p.to === "murder")?.via, "climb");
});

test("a thorough end on every scene of the story: every discovery reached but one behind an event (the King's Sallow, once he's sent for), every carried one landed", () => {
  const dir = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
  const campaign = loadScenario(readFileSync(join(dir, scenarioPath("caerwyn")), "utf8"), scenarioPath("caerwyn"));
  for (const key of campaign.scenes) {
    const each = sceneOf(JSON.parse(readFileSync(join(dir, "scenes", `${key}.kmscene`), "utf8")) as SceneDocument);
    const done = reachDiscoveries(each, initialGm(each), 1).gm;
    assert.deepEqual(ids(targetsOf(each, done)), key === "kings-morning" ? ["sallow-slips"] : [], `${key}: what's left to find`);
    assert.deepEqual((each.essentials ?? []).filter(e => !done.landed.includes(e.id)).map(e => e.id), [], `${key}: nothing carried is owed on`);
    assert.deepEqual([done.beat, done.closing], [each.start, undefined], `${key}: the stage stays`);
  }
});
