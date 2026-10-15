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
const { contrast, rgbOf } = await import("./look/color.ts");
const { BEING_CONTRAST } = await import("./look/light.ts");
const { CAST, enterScene, newExploration, renderExplore, toPlain } = await import("./map/index.ts");
const { town } = await import("./town.ts");
const { fightEffects, fightLooks, fightView, stageView, townView } = await import("./views.ts");
const { StagePicks } = await import("./look/stage.ts");
import type { GameState } from "./play.ts";
import type { StyledLine } from "./types.ts";
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

test("a scene's place from above says what's drawn where, for the mouse (people over things, the rope under Prout, the walls the world knows), and lights up what the pointer's on", () => {
  const scene = sceneById("hanged-clerk");
  const world = buildWorld(scene.id, scene.world!, ["kell", "cob", "moll"].map(id => ({ id, name: scene.cast.find(c => c.id === id)!.name })), { name: "Odo" });
  const session = { sceneId: scene.id, world } as unknown as SessionState;
  const size = { w: 50, h: 15 };
  const pick = new StagePicks();
  const plain = stageView(session, size, { t: 1000, time: "morning", glyphs: "ascii", pick })!;
  for (const id of ["player", "kell", "cob", "moll", "prout", "satchel", "water-butt"]) {
    const at = pick.cellOf(id);
    assert.ok(at, `${id} is drawn somewhere`);
    if (id !== "prout") assert.equal(pick.at(at.x, at.y)?.id, id, `a click on ${id} is on them`);
  }
  assert.equal(plain.glyph[pick.cellOf("player")!.y * size.w + pick.cellOf("player")!.x], "@", "where the player is picked is where the @ is");
  const prout = pick.cellOf("hoist-rope")!;
  assert.deepEqual(pick.at(prout.x, prout.y), { ...pick.at(prout.x, prout.y), id: "prout", under: ["hoist-rope", "hoist-beam"] }, "Prout hangs from the rope, on the beam: they're under him");
  assert.ok(pick.shown().includes("hoist-beam"), "what's covered is still in the place");
  // The yard wall the dressing draws is the world's yard wall; the floor says what it is.
  const cells = Array.from({ length: size.w * size.h }, (_, i) => pick.at(i % size.w, Math.floor(i / size.w))!);
  assert.ok(cells.some(c => c.id === "yard-wall" && c.wall === "stone"), "the yard wall");
  assert.ok(cells.some(c => !c.id && c.area === "yard" && c.ground === "cobbles"), "the yard's cobbles");
  assert.ok(cells.some(c => !c.id && c.area === "loft" && c.wall === "timber"), "the loft's timber walls are only walls");
  // The pointer lights up everyone it's on, and nothing else; a cell of floor by itself.
  const lit = stageView(session, size, { t: 1000, time: "morning", glyphs: "ascii", hover: "kell" })!;
  const changed = (a: typeof plain, b: typeof plain) => [...a.bg.keys()].filter(i => a.bg[i] !== b.bg[i]);
  const kell = pick.cellOf("kell")!;
  assert.deepEqual(changed(plain, lit), [kell.y * size.w + kell.x], "Kell's cell, lit up");
  assert.deepEqual(changed(plain, stageView(session, size, { t: 1000, time: "morning", glyphs: "ascii", hover: { x: 3, y: 9 } })!), [9 * size.w + 3]);
  const hidden = stageView(session, size, { t: 1000, time: "morning", glyphs: "ascii", hover: "hoist-rope" })!;
  assert.deepEqual(changed(plain, hidden), [prout.y * size.w + prout.x], "the rope under Prout lights up where it is");
});

test("people stay findable in the dark and keep their colours: the Rat in the evening and at night, the Heron at night, from above and on the map", () => {
  const cells = (lines: StyledLine[]) => lines.flatMap((line, y) => { let x = 0; return line.flatMap(s => [...s.text].map(ch => ({ ch, x: x++, y, fg: s.fg ?? "", bg: s.bg ?? "" }))); });
  const views: Array<[string, "evening" | "night", string[]]> = [["drowned-rat", "evening", ["kell", "nan-quill", "arlo", "cob", "hobb"]], ["drowned-rat", "night", ["kell", "hobb"]], ["heron-warehouse", "night", ["kell", "saul", "hep", "hobb"]]];
  for (const [sceneId, time, ids] of views) {
    const scene = sceneById(sceneId);
    const world = buildWorld(sceneId, scene.world!, ids.map(id => ({ id, name: scene.cast.find(c => c.id === id)!.name })), { name: "Odo" });
    const session = { sceneId, world } as unknown as SessionState;
    const ex = newExploration({ time, played: [], lead: sceneId, flags: {} });
    enterScene(ex, sceneId);
    // Letters (whatever glyph fonts this machine has), read off the frames.
    const glyphs = "ascii" as const;
    for (const [view, lines] of [["from above", stageView(session, { w: 58, h: 30 }, { t: 2400, time, glyphs })!.toLines()], ["on the map", renderExplore(ex, { w: 120, h: 40 }, { world, t: 2400, glyphs })]] as const) {
      for (const id of ids) {
        const drawn = cells(lines).filter(c => c.ch === CAST[id]!.glyph);
        assert.ok(drawn.length, `${id} is drawn ${view} (${sceneId}, ${time})`);
        for (const c of drawn) assert.ok(contrast(rgbOf(c.fg), rgbOf(c.bg)) >= BEING_CONTRAST, `${id} ${view} (${sceneId}, ${time}) stands out: ${c.fg} on ${c.bg}`);
      }
    }
    if (sceneId === "drowned-rat" && time === "night") {
      // By the blue driftwood fire, Hobb is still Hobb: orange, only cooler (the light's colour doesn't wash him grey).
      const hobb = cells(renderExplore(ex, { w: 120, h: 40 }, { world, t: 2400, glyphs })).find(c => c.ch === "H")!;
      const [r, , b] = [16, 8, 0].map(k => (rgbOf(hobb.fg) >> k) & 255);
      assert.ok(r! > b! + 40, `Hobb by the blue fire is warm: ${hobb.fg}`);
    }
  }
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

test("everyone in a fight has a letter of their own: the cast as everywhere, and a porter's S isn't Saul's", () => {
  const looks = fightLooks({
    pc: { name: "Wren Ashdown", glyph: "@", color: "#ffffff" },
    kell: { name: "Sergeant Agnes Kell", castId: "kell", glyph: "K", color: "#6d9eeb" },
    "crake-1": { name: "the talking Crake", castId: "crake-1", glyph: "C", color: "#9a8f80" },
    floury: { name: "a floury porter", glyph: "F", color: "#c04040" },
    small: { name: "a small, fierce porter", glyph: "S", color: "#c04040" },
    boy: { name: "a boy with a lantern", glyph: "d", color: "#c0c040" },
  });
  assert.deepEqual([looks.pc!.glyph, looks.kell!.glyph, looks["crake-1"]!.glyph, looks.floury!.glyph], ["@", "K", "C", "F"], "the player, the cast, and a letter nobody else has, as they were");
  assert.ok(looks.small!.glyph !== "S" && looks.small!.glyph === looks.small!.glyph.toUpperCase(), `the small porter's S is Saul's: now ${looks.small!.glyph}, still a capital (the other side)`);
  assert.ok(looks.boy!.glyph !== "d" && looks.boy!.glyph === looks.boy!.glyph.toLowerCase(), `an ally's d is Duchess's: now ${looks.boy!.glyph}, still small`);
  assert.equal(new Set(Object.values(looks).map(l => l.glyph)).size, 6, "no letter twice");
});
