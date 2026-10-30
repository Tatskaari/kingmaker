import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initialGm, type GmState } from "../gm/state.ts";
import { endingNeeds, endingOf, enteringAt, fightsAhead, limitOf, openRoutes, storyNeeds, oweName, owedLeads, reachDiscoveries, reachedOf, reachedTurns, stageOf, takeRoute, targetsOf, type Taken } from "./beats.ts";
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
  assert.deepEqual(ids(openRoutes(scene, cart)), ["find-murder", "find-motive", "find-hobb", "case-lost", "porters-come"], "the start's routes stay open, and the porters' break opens; neither signing is, with nothing found");

  const error = refused(takeRoute(scene, cart, "signed-murder", "none", 3));
  assert.match(error, /^\[signed-murder\] isn't open: it requires The victim was murdered \[murder\] and Hobb was spotted at the scene \[hobb\], not reached yet\. The open routes: \[find-murder\] It was murder \(to The victim was murdered\); /);
  assert.match(error, /\[case-lost\] Last resort \(to Failed\); \[porters-come\] The porters' break \(to The porters' noon break; a cue\)\.$/);

  const hobb = took(takeRoute(scene, cart, "find-hobb", "none", 3));
  assert.deepEqual(ids(openRoutes(scene, hobb)).filter(id => id.startsWith("signed")), ["signed-suicide"], "the lead alone: Kell can only object in writing");
  assert.match(refused(takeRoute(scene, hobb, "signed-murder", "none", 4)), /it requires The victim was murdered \[murder\], not reached yet/);
  assert.equal(stageOf(scene, hobb).id, "cart-arrives", "a discovery doesn't move the stage");
});

test("the porters' noon break, after the cart: its outer limit is four exchanges from the cart and stops once the lead is reached; it brings Old Wat on, and the signing goes on from the cart (QA round qa3-1018's H6: the clerk's lead never reached two players before their turns ran out)", () => {
  const porters = scene.routes.find(r => r.id === "porters-come")!;
  assert.deepEqual(limitOf(porters, initialGm(scene), 20), { counts: [{ exchanges: 4, after: "cart-arrives" }], overdue: false }, "before the cart, it isn't counting");
  const cart = took(takeRoute(scene, initialGm(scene), "cart-comes", "none", 11));
  assert.equal(limitOf(porters, cart, 14)!.overdue, false, "the cart shown in reply 12");
  assert.equal(limitOf(porters, cart, 15)!.overdue, true, "overdue after reply 15, so the porters come in in reply 16");
  const lead = took(takeRoute(scene, cart, "find-hobb", "none", 13));
  assert.deepEqual(limitOf(porters, lead, 15), { counts: [{ exchanges: 4, after: "cart-arrives", reachedOn: 11, next: 4, stopped: "hobb" }], overdue: false }, "not once the lead is reached");

  const noon = took(takeRoute(scene, cart, "porters-come", "none", 14));
  assert.deepEqual([stageOf(scene, noon).id, ids(enteringAt(scene, "porters-break"))], ["porters-break", ["wat"]]);
  assert.ok(["tull", "wat"].every(id => ids(presentCast(scene, noon)).includes(id)), "Old Wat comes in, and the corporal is still here");
  const told = took(takeRoute(scene, took(takeRoute(scene, noon, "find-hobb", "none", 15)), "find-murder", "none", 15));
  assert.ok(ids(openRoutes(scene, told)).includes("signed-murder"), "the signing goes on from the cart, wherever the stage is");
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
  // The zoo ring's combat exit, fought (story/fight.ts's stand-in, the board's fight): its ending no longer reached, and spent.
  const ring = sceneOf(JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "campaigns", "zoo", "scenes", "ring.kmscene"), "utf8")) as SceneDocument);
  const gm = took(takeRoute(ring, initialGm(ring), "to-blows", "none", 1));
  assert.equal(gm.closing?.exitId, "fight");
  const after: GmState = { ...gm, reached: gm.reached.filter(id => id !== "fight"), fought: ["fight"] };
  delete after.closing;

  const open = ids(openRoutes(ring, after));
  assert.ok(!open.includes("to-blows"), "no way back into the fight");
  assert.ok(open.includes("walk-out"), "the other ending is open again");
  assert.match(refused(takeRoute(ring, after, "to-blows", "none", 2)), /^\[to-blows\] isn't open: it goes to .* \[fight\], a fight already fought\./);
});

test("who the story needs here: whoever the scene's endings have walk with the player, and the holders of a discovery it can't end well without until it's made", () => {
  assert.deepEqual([...storyNeeds(scene, initialGm(scene))].sort(), ["cob", "kell", "moll", "wat"], "Kell walks with the player; Hobb's lead is held by Cob, Moll, Wat and Kell");
  const found = took(takeRoute(scene, initialGm(scene), "find-hobb", "none", 1));
  assert.deepEqual([...storyNeeds(scene, found)], ["kell"], "the lead made, only Kell");
});

test("the Heron's blades out is an event with a fight (docs/combat-gm.md): on offer once the Master's in, by either route; reached, it's the stage, nothing leads back into it, and the night's endings are open from it", () => {
  const heron = sceneOf(JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "campaigns", "caerwyn", "scenes", "heron-warehouse.kmscene"), "utf8")) as SceneDocument);
  const blades = heron.beats.find(b => b.id === "fight")!;
  assert.deepEqual(blades.fight, { foes: ["sallow", "crake-1", "crake-2"], allies: ["kell"] });
  assert.deepEqual(fightsAhead(heron, initialGm(heron)), [], "nothing before the Master comes");
  const midnight = took(takeRoute(heron, initialGm(heron), "master-comes", "none", 1));
  assert.deepEqual(fightsAhead(heron, midnight).map(f => [f.route.id, f.beat.id]), [["cornered", "fight"], ["attack", "fight"]]);

  const fought = took(takeRoute(heron, midnight, "cornered", "none", 2));
  assert.deepEqual([fought.beat, fought.closing, stageOf(heron, fought).title], ["fight", undefined, "Blades out"], "an event: the scene's stage, not its end");
  assert.deepEqual(fightsAhead(heron, fought), [], "no way back into it");
  const open = ids(openRoutes(heron, fought));
  assert.ok(!open.includes("cornered") && !open.includes("attack"));
  assert.ok(["cast-off", "book-destroyed"].every(id => open.includes(id)), "the night plays on from it (the endings needing the grain or the book once they're found)");
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

/** What a thorough end can't reach, being behind an event it doesn't stage: the King's Sallow, once he's sent for; what the goblins carry and where they came from, once the crossroads' fight is fought; the patrol and Garrow's book, once the toll bridge's rearguard's is. */
const BEHIND_AN_EVENT: Record<string, string[]> = { "kings-morning": ["sallow-slips"], "kings-road": ["be-seen", "the-bridge"], "toll-bridge": ["the-patrol", "garrows-ledger"] };

test("a thorough end on every scene of the story: every discovery reached but those behind an event (the King's Sallow, once he's sent for; the prologue's, once its fights are fought), every carried one landed", () => {
  const dir = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
  const campaign = loadScenario(readFileSync(join(dir, scenarioPath("caerwyn")), "utf8"), scenarioPath("caerwyn"));
  for (const key of campaign.scenes) {
    const each = sceneOf(JSON.parse(readFileSync(join(dir, "scenes", `${key}.kmscene`), "utf8")) as SceneDocument);
    const done = reachDiscoveries(each, initialGm(each), 1).gm;
    assert.deepEqual(ids(targetsOf(each, done)), BEHIND_AN_EVENT[key] ?? [], `${key}: what's left to find`);
    assert.deepEqual((each.essentials ?? []).filter(e => !done.landed.includes(e.id)).map(e => e.id), [], `${key}: nothing carried is owed on`);
    assert.deepEqual([done.beat, done.closing], [each.start, undefined], `${key}: the stage stays`);
  }
});

test("the turn each node was reached on; a cue's outer limit counts from the opening or from the reply after its beat was reached, until a beat stops it, and is overdue once the next reply reaches a count", () => {
  const sceneFile = (id: string) => sceneOf(JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "campaigns", "caerwyn", "scenes", `${id}.kmscene`), "utf8")) as SceneDocument);
  const rat = sceneFile("drowned-rat");
  const bell = rat.routes.find(r => r.id === "bell-rings")!, arlo = rat.routes.find(r => r.id === "arlo-calls-him-out")!;
  let gm = initialGm(rat);
  assert.deepEqual(limitOf(bell, gm, 13), { counts: [{ exchanges: 15, next: 14 }, { exchanges: 8, after: "arlos-challenge" }], overdue: false }, "Arlo's challenge not reached: its count isn't running");
  assert.equal(limitOf(bell, gm, 14)!.overdue, true, "fifteen into the scene: overdue after reply 14, so it rings in reply 15");
  assert.equal(limitOf(arlo, gm, 4)!.overdue, false);
  assert.equal(limitOf(arlo, gm, 5)!.overdue, true, "by the sixth exchange in the room");

  gm = took(takeRoute(rat, gm, "arlo-calls-him-out", "none", 6));
  gm = took(takeRoute(rat, gm, "find-the-heron", "none", 9));
  assert.deepEqual([...reachedTurns(gm)], [["start", 0], ["arlos-challenge", 6], ["the-heron", 9]]);
  assert.deepEqual(limitOf(bell, gm, 13), { counts: [{ exchanges: 15, next: 14 }, { exchanges: 8, after: "arlos-challenge", reachedOn: 6, next: 7 }], overdue: false });
  assert.equal(limitOf(bell, gm, 14)!.overdue, true, "eight after Arlo's challenge, which showed in reply 7: overdue after reply 14");

  const talking = took(takeRoute(rat, initialGm(rat), "hobb-breaks", "none", 3));
  assert.deepEqual(limitOf(arlo, talking, 9), { counts: [{ exchanges: 6, next: 10, stopped: "hobb-talking" }], overdue: false }, "not once Hobb is talking");
  assert.equal(limitOf(rat.routes.find(r => r.id === "let-him-go")!, talking, 20), undefined, "an outcome route has no limit");

  const heron = sceneFile("heron-warehouse");
  const master = heron.routes.find(r => r.id === "master-comes")!;
  assert.equal(limitOf(master, initialGm(heron), 5)!.overdue, true, "six exchanges on the wharf without getting in");
  const inside = took(takeRoute(heron, initialGm(heron), "taken-on", "none", 3));
  assert.deepEqual(limitOf(master, inside, 7), { counts: [{ exchanges: 6, next: 8, stopped: "floor" }, { exchanges: 5, after: "floor", reachedOn: 3, next: 4 }], overdue: false }, "inside, the wharf's count stops and five inside runs");
  assert.equal(limitOf(master, inside, 8)!.overdue, true);
});

test("a discovery an ending's way in requires (a lead, where it names someone elsewhere); a lead's name owed is a step on the path that moves nothing, once, and not for a lead reached (QA round qa3-1018)", () => {
  assert.deepEqual(scene.beats.filter(b => endingNeeds(scene, b)).map(b => b.id), ["murder", "hobb"], "signed-murder needs both, signed-suicide Hobb; the motive no ending needs");
  const cart = took(takeRoute(scene, initialGm(scene), "cart-comes", "none", 2));
  const owed = oweName(scene, cart, "hobb", 5);
  assert.deepEqual(owed.path.at(-1), { turn: 5, from: "cart-arrives", to: "cart-arrives", via: "owed:hobb", source: "post" }, "from the stage to itself");
  assert.deepEqual([owedLeads(owed), owed.reached, owed.beat, [...reachedTurns(owed)]], [["hobb"], ["start", "cart-arrives"], "cart-arrives", [["start", 0], ["cart-arrives", 2]]], "nothing reached or moved");
  assert.equal(oweName(scene, owed, "hobb", 6), owed, "owed once");
  assert.deepEqual(ids(openRoutes(scene, owed)), ids(openRoutes(scene, cart)), "the routes as they were");
  assert.deepEqual(cart.path.length, 1, "the state it was handed is as it was");
  const found = took(takeRoute(scene, cart, "find-hobb", "none", 4));
  assert.equal(oweName(scene, found, "hobb", 5), found, "a lead reached is owed nothing");
});
