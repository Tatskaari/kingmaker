import assert from "node:assert/strict";
import { test } from "node:test";
process.env.KM_LOOK_MODEL = "off";
const { sceneById } = await import("../../scenes/index.ts");
const { presentCast } = await import("../runtime/brief.ts");
const { forceEnding } = await import("../runtime/engine.ts");
const { applyOps, buildWorld, joinWorld } = await import("../world/scene-world.ts");
const { pregenSession } = await import("./combat/pregen.ts");
const { TacticalFight } = await import("./combat/index.ts");
const { mapFights } = await import("./fights.ts");
const { Effects } = await import("./look/effects.ts");
const { toPlain } = await import("./map/index.ts");
const { town } = await import("./town.ts");
const { fightEffects, fightView, stageView, townView } = await import("./views.ts");
import type { GameState } from "./play.ts";
import type { SessionState } from "../runtime/session.ts";

// These read letters off the frames: draw with letters whatever this machine has installed.
process.env.KM_GLYPHS ??= "ascii";

/**
 * The game's views with the look wired in: a scene's place from above and on the map, with its
 * effects; a fight on its battlefield with its dust, its fire and its effects. No model calls.
 */

const BLANK = { what: "", to: "", how: "", name: "", kind: "", text: "", add: [], remove: [] };
const fiery = (hex: string) => { const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return r > 110 && r > g * 1.6 && r > b * 2.5; };

test("a scene's place: from above (the stage, dressed), and on the map with the scene's effects over it", () => {
  const game: GameState = { version: 1, id: "views", mode: "explore", story: { time: "evening", played: ["hanged-clerk"], lead: "drowned-rat", flags: {} }, explore: {}, recent: [] };
  town.start(game);
  const scene = sceneById("drowned-rat");
  const world = buildWorld(scene.id, scene.world!, ["kell", "nan-quill", "hobb"].map(id => ({ id, name: scene.cast.find(c => c.id === id)!.name })), { name: "Odo" });
  const session = { sceneId: scene.id, world } as unknown as SessionState;
  game.mode = "scene";
  town.enterScene!(game, session);
  const stage = stageView(session, { w: 60, h: 24 }, { t: 1000, time: "evening" })!;
  assert.match(stage.toPlain(), /@/, "the player is on the stage");
  assert.match(stage.toPlain(), /K/, "and Kell");
  const fx = new Effects({ now: () => 0 });
  fx.bark("hobb", "That was a full keg.", {}, 0);
  const plain = toPlain(townView(game, session, { w: 80, h: 24 }, { t: 500, effects: fx }));
  assert.match(plain, /full keg/, "the bark is over the map of the place");
  assert.doesNotMatch(toPlain(townView(game, session, { w: 80, h: 24 }, { color: false, effects: fx })), /full keg/, "but not in plain text");
});

test("a fight on its battlefield: the dust hangs, the fire burns, the lanterns are lanterns, and its log plays as effects", async () => {
  const session = await pregenSession({ pregen: "wizard", level: 3, seed: 4 });
  Object.assign(session, { sceneId: "heron-warehouse", beat: "midnight", entered: ["sallow"] });
  session.established.push("Master Sallow has come to the Heron.");
  const scene = sceneById("heron-warehouse");
  const cast = presentCast(scene, session);
  session.world = buildWorld(scene.id, scene.world!, cast.map(c => ({ id: c.id, name: c.name })), session.player);
  joinWorld(session.world, cast.map(c => ({ id: c.id, name: c.name, ...(c.members ? { members: c.members } : {}) })), 0);
  applyOps(session.world, [{ ...BLANK, op: "move", what: "player", to: "floor" }, { ...BLANK, op: "move", what: "kell", to: "floor" }] as never, 1);
  forceEnding(session, "fight");
  const fights = mapFights();
  fights.pace = async () => {};
  const fight = await fights.start({ version: 1, id: "v", mode: "combat", story: { time: "night", played: [], flags: {} }, explore: {}, recent: [] }, session);
  assert.ok(fight instanceof TacticalFight);
  const c = fight.controller;
  const G = c.state();
  assert.ok(G.dust.length > 20, "the floor is dusty");
  const size = { w: 100, h: 34 };
  const dusty = fightView(c, session, size, { t: 1000, time: "night" });
  const lantern = toPlain(dusty);
  assert.match(lantern, /¤/, "the hanging lanterns are drawn as lanterns");
  // Fire on the floor where the brazier went over (staged for the picture: the fight's own rules decide when).
  const fire = G.fuel.slice(0, 4);
  const staged = { ...c, state: () => ({ ...G, fire }), view: () => ({ ...c.view(), hazards: { dust: [], fire: fire.map(k => ({ x: Number(k.split(",")[0]), y: Number(k.split(",")[1]) })) } }) } as typeof c;
  const burning = fightView(staged, session, size, { t: 1000, time: "night" });
  assert.ok(burning.flat().filter(s => s.bg && fiery(s.bg)).length > dusty.flat().filter(s => s.bg && fiery(s.bg)).length + 4, "the fire burns on its tiles");
  // The log as effects: a spell from the caster, a blow's sparks, a number over the hurt.
  const fx = new Effects({ now: () => 0 });
  const crake = Object.values(G.units).find(u => u.castId === "crake-1")!;
  const shown = fightEffects(fx, c, [
    { text: `You cast Fire Bolt (cantrip) at ${crake.called}` },
    { text: `Fire Bolt: your attack on ${crake.called}: 17 +5 = 22 vs AC 12: hit` },
    { text: "Damage: 1d10 (8) fire" },
    { text: `${crake.called.charAt(0).toUpperCase()}${crake.called.slice(1)} takes 8 fire damage (badly hurt)` },
  ], 0);
  assert.equal(shown, 3);
  const frame = fx.frame(400, () => undefined);
  assert.ok(frame.sprites.length > 0 && frame.texts.some(t => t.text === "8"), "the bolt, the sparks, and the 8");
  const lines = fightView(c, session, size, { t: 400, time: "night", effects: fx });
  assert.notDeepEqual(lines, fightView(c, session, size, { t: 400, time: "night" }), "and they're drawn on the battlefield");
});
