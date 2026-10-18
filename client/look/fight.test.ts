import assert from "node:assert/strict";
import { test } from "node:test";
import type { Unit } from "../../shared/fight/types.ts";
import { activeTint, blowFrames, blowStyle, flightGlyph, hitFlash, hpGauge, octant, tagsOf, unitActor } from "./fight.ts";

/**
 * How a fight looks (M6's screen): the way across the isometric screen from one tile to another (a
 * step east goes up and right, south down and right), a shot's glyph along it and a blade's sweep
 * across it, a bite and a knock; the hit-point gauge; the tags; a hit's flicker; whose turn's light;
 * and who's who on the board, a fall tipping their letter over to an x.
 */

const wolf: Unit = {
  id: "wolf-1", name: "a grey wolf", called: "a grey wolf", side: "enemy", role: "bruiser", engineId: "e1", weapons: [], at: { x: 3, y: 2 },
  hp: 11, maxHp: 11, ac: 13, speed: 40, initiative: 12, state: "fighting", conditions: [], glyph: "W", color: "#e06666",
};

test("the way across the screen: east up and right, south down and right, north-east straight up, south-east straight right", () => {
  const o = { x: 5, y: 5 };
  assert.equal(octant(o, { x: 6, y: 5 }), 7);
  assert.equal(octant(o, { x: 5, y: 6 }), 1);
  assert.equal(octant(o, { x: 6, y: 4 }), 6);
  assert.equal(octant(o, { x: 6, y: 6 }), 0);
  assert.deepEqual([flightGlyph(o, { x: 9, y: 9 }), flightGlyph(o, { x: 9, y: 1 }), flightGlyph(o, { x: 9, y: 5 }), flightGlyph(o, { x: 5, y: 9 })], ["-", "|", "/", "\\"]);
});

test("a blade sweeps across the blow's way; a bite closes; a club knocks", () => {
  assert.equal(blowFrames("blade", { x: 5, y: 5 }, { x: 6, y: 6 }), "\\|/", "a blow to the right sweeps down through it");
  assert.equal(blowFrames("bite", { x: 5, y: 5 }, { x: 6, y: 6 }), "v∩∙");
  assert.deepEqual([blowStyle("Wolf Bite"), blowStyle("Club"), blowStyle("Scimitar"), blowStyle("Shove")], ["bite", "blunt", "blade", "blunt"]);
});

test("the hit-point gauge: filled for what's left, its colour by how much; plain text in plain", () => {
  assert.deepEqual(hpGauge(11, 11, 6, "ascii"), { filled: "██████", empty: "", color: "#7bd389" });
  assert.deepEqual(hpGauge(4, 11, 6, "ascii"), { filled: "██", empty: "░░░░", color: "#f4a259" });
  assert.deepEqual(hpGauge(1, 28, 6, "plain"), { filled: "#", empty: "-----", color: "#ff6b6b" });
  assert.equal(hpGauge(0, 11, 6, "ascii").filled, "");
});

test("tags: conditions shown short, the engine's bookkeeping not, and how they are when they're out of it first", () => {
  assert.deepEqual(tagsOf(["prone", "dodged", "attack-active"], "fighting").map(t => t.text), ["prone", "dodging"]);
  assert.deepEqual(tagsOf(["unconscious"], "down").map(t => t.text), ["down"]);
  assert.deepEqual(tagsOf([], "surrendered", true).map(t => t.text), ["gave up", "in irons"]);
});

test("a hit flickers twice and is over before its beat is; whose turn breathes, brightest as it begins", () => {
  assert.deepEqual(hitFlash(0), { fg: "#ffffff", bg: "#b8261e" });
  assert.notDeepEqual(hitFlash(0.2), hitFlash(0));
  assert.equal(hitFlash(0.5), undefined);
  assert.notEqual(activeTint(0, 1), activeTint(0, 0));
});

test("who's who on the board: a wolf by its letter (a creature), bloodied below half; down, an x; falling, their letter lit then tipping over; gone, off the board", () => {
  const stance = { at: { x: 3, y: 2 }, hp: 11, maxHp: 11, state: "fighting" as const, conditions: [] };
  assert.deepEqual(unitActor(wolf, stance, "zoo-wolves"), { id: "wolf-1", name: "a grey wolf", map: "zoo-wolves", at: { x: 3, y: 2 }, kind: "creature", glyph: "W", color: "#e06666" });
  assert.deepEqual(unitActor(wolf, { ...stance, hp: 4 }, "m")!.states, ["bloodied"]);
  const down = unitActor(wolf, { ...stance, hp: 0, state: "down" }, "m")!;
  assert.deepEqual([down.glyph, down.states], ["x", ["fallen"]]);
  assert.deepEqual([0.1, 0.4, 0.6, 0.9].map(k => unitActor(wolf, { ...stance, hp: 0, state: "down" }, "m", k)!.glyph), ["W", "/", "_", "x"]);
  assert.equal(unitActor(wolf, { ...stance, state: "fled" }, "m"), undefined);
  assert.equal(unitActor({ ...wolf, id: "player", glyph: "@", side: "player", color: "#ffffff" }, stance, "m")!.kind, "player");
  assert.equal(unitActor({ ...wolf, id: "kell", castId: "kell", name: "Sergeant Agnes Kell", side: "ally", glyph: "K" }, stance, "m")!.ref, "kell", "the cast keep their own look");
});
