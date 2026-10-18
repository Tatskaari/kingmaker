import assert from "node:assert/strict";
import { test } from "node:test";
import type { Unit } from "../../shared/fight/types.ts";
import { luminance, rgbOf } from "./color.ts";
import { activeTint, blowFrames, blowStyle, FALLS_AT, flightGlyph, hitFlash, hpGauge, octant, tagsOf, unitActor } from "./fight.ts";
import { km } from "./glyphs.ts";
import { actorLook } from "./map.ts";

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

test("who's who on the board: a wolf by its letter (a creature), bloodied below half; down, an x on the floor; falling, up and lit until FALLS_AT, then tipping over; gone, off the board", () => {
  const stance = { at: { x: 3, y: 2 }, hp: 11, maxHp: 11, state: "fighting" as const, conditions: [] };
  assert.deepEqual(unitActor(wolf, stance, "zoo-wolves"), { id: "wolf-1", name: "a grey wolf", map: "zoo-wolves", at: { x: 3, y: 2 }, kind: "creature", glyph: "W", color: "#e06666" });
  assert.deepEqual(unitActor(wolf, { ...stance, hp: 4 }, "m")!.states, ["bloodied"]);
  const down = unitActor(wolf, { ...stance, hp: 0, state: "down" }, "m")!;
  assert.deepEqual([down.glyph, down.kind, down.states], ["x", "creature", ["fallen", "down"]], "the look layer's down: a dim letter, a sprite lying down, the renderer's mark at their feet");
  assert.deepEqual(unitActor(wolf, { ...stance, hp: 0, state: "dead" }, "m")!.states, ["fallen", "dead"]);
  assert.deepEqual([0.1, 0.4, 0.8, 1].map(k => unitActor(wolf, { ...stance, hp: 0, state: "down" }, "m", k)!.glyph), ["W", "/", "_", "x"]);
  assert.ok(!unitActor(wolf, { ...stance, hp: 0, state: "down" }, "m", FALLS_AT - 0.01)!.states?.includes("down"), "still up as the fall begins (the board lights them red)");
  assert.equal(unitActor(wolf, { ...stance, state: "fled" }, "m"), undefined);
  assert.equal(unitActor({ ...wolf, id: "player", glyph: "@", side: "player", color: "#ffffff" }, stance, "m")!.kind, "player");
  const kell: Unit = { ...wolf, id: "kell", castId: "kell", name: "Sergeant Agnes Kell", side: "ally", glyph: "K" };
  assert.equal(unitActor(kell, stance, "m")!.ref, "kell", "the cast keep their own look");
  const kellDown = unitActor(kell, { ...stance, hp: 0, state: "down" }, "m", 0.5)!;
  assert.deepEqual([kellDown.ref, kellDown.states], ["kell", ["fallen", "down"]], "down, and as they fall, the cast keep their look, lying down (no letter of the fight's own to tip over)");
  assert.deepEqual(unitActor(kell, { ...stance, conditions: ["unconscious"] }, "m")!.states, ["asleep"], "asleep on their feet's worth of the fight (a Sleep spell): lying down, with a Z");
});

test("on the board as the look layer draws them: Kell down lies down (a sprite) or dims (a letter); the Crakes each in their own letter and colour; asleep, a sleeper", () => {
  const frame = (glyphs: "ascii" | "kingmaker") => ({ t: 0, time: "afternoon" as const, glyphs });
  const stance = { at: { x: 3, y: 2 }, hp: 11, maxHp: 11, state: "fighting" as const, conditions: [] };
  const kell: Unit = { ...wolf, id: "kell", castId: "kell", name: "Sergeant Agnes Kell", side: "ally", glyph: "K", color: "#6d9eeb" };
  const up = (g: "ascii" | "kingmaker") => actorLook(unitActor(kell, stance, "m")!, frame(g));
  const down = (g: "ascii" | "kingmaker") => actorLook(unitActor(kell, { ...stance, hp: 0, state: "down" }, "m")!, frame(g));
  assert.equal(down("kingmaker").glyph, km("lying"), "lying down, in Kingmaker Glyphs");
  assert.notEqual(down("kingmaker").glyph, up("kingmaker").glyph);
  assert.equal(down("ascii").glyph, "K");
  assert.ok(luminance(rgbOf(down("ascii").fg)) < luminance(rgbOf(up("ascii").fg)), "dimmed in a letter");
  const crake = (id: string, name: string, glyph: string, color: string): Unit => ({ ...wolf, id, castId: id, name, glyph, color });
  const talking = actorLook(unitActor(crake("crake-1", "the talking Crake", "C", "#d0a070"), stance, "m")!, frame("ascii"));
  const silent = actorLook(unitActor(crake("crake-2", "the silent Crake", "c", "#8f9aa6"), stance, "m")!, frame("ascii"));
  assert.deepEqual([talking.glyph, silent.glyph], ["C", "c"], "the fight's own letters, where the cast table has one for every Crake");
  assert.notEqual(talking.fg, silent.fg);
  const asleep = actorLook(unitActor(crake("crake-1", "the talking Crake", "C", "#d0a070"), { ...stance, conditions: ["unconscious"] }, "m")!, frame("kingmaker"));
  assert.equal(asleep.glyph, km("sleeper"));
});
