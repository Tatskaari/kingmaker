import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.KM_LOOK_MODEL = "off";
const { KINGMAKER_GLYPHS, KINGMAKER_PIXELS, KINGMAKER_GRID, KINGMAKER_SOURCE } = await import("./kingmaker-glyphs.ts");
const { km, isKingmaker, glyphFor, inSet, detectGlyphSet } = await import("./glyphs.ts");
const { kmFlap, KM_VOCABULARY } = await import("./kingmaker.ts");
const { lookOf } = await import("./appearance.ts");
const { CAST_LOOKS } = await import("./people.ts");
const { frameAt } = await import("./vignettes.ts");
const { actorLook, lookFrame } = await import("./map.ts");
const { CAST } = await import("../map/looks.ts");
const { measureEditText } = await import("@opentui/core");

const ROOT = new URL("../../../", import.meta.url);
const asText = (line: Array<{ text: string }>) => line.map(s => s.text).join("");
const WIDTHS = ["unicode", "wcwidth", "unicode-wide"] as const;

/** The bitmaps file as the build script reads it: name, code point, what it is, and its rows. */
function bitmaps(): Array<{ name: string; code: number; about: string; rows: string[] }> {
  const lines = readFileSync(new URL("assets/glyphs/kingmaker.txt", ROOT), "utf8").split("\n").map(l => l.split(";")[0]!.trimEnd());
  const out: Array<{ name: string; code: number; about: string; rows: string[] }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\S+)\s+U\+([0-9A-Fa-f]{4,6})\s*(.*)$/.exec(lines[i]!.trim());
    if (!m) continue;
    out.push({ name: m[1]!, code: parseInt(m[2]!, 16), about: m[3]!.trim(), rows: lines.slice(i + 1, i + 1 + KINGMAKER_GRID[1]) });
    i += KINGMAKER_GRID[1];
  }
  return out;
}

/** The code points a TrueType font maps (its format 12 cmap). */
function cmapCodes(font: Buffer): Set<number> {
  let cmap = -1;
  for (let i = 0; i < font.readUInt16BE(4); i++) if (font.toString("latin1", 12 + i * 16, 16 + i * 16) === "cmap") cmap = font.readUInt32BE(20 + i * 16);
  const codes = new Set<number>();
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const at = cmap + font.readUInt32BE(cmap + 8 + i * 8);
    if (font.readUInt16BE(at) !== 12) continue;
    for (let g = 0; g < font.readUInt32BE(at + 12); g++) {
      for (let c = font.readUInt32BE(at + 16 + g * 12); c <= font.readUInt32BE(at + 20 + g * 12); c++) codes.add(c);
    }
  }
  return codes;
}

test("the code points and the fonts were built from the bitmaps as they are (else: npm run glyphs:build)", () => {
  const drawn = bitmaps();
  assert.deepEqual(drawn.map(g => g.name), Object.keys(KINGMAKER_GLYPHS));
  for (const g of drawn) {
    assert.deepEqual(KINGMAKER_GLYPHS[g.name as keyof typeof KINGMAKER_GLYPHS], [g.code, g.about], g.name);
    assert.equal(KINGMAKER_PIXELS[g.name as keyof typeof KINGMAKER_PIXELS], g.rows.join("/"), `${g.name}'s pixels`);
    assert.ok(g.rows.every(r => r.length === KINGMAKER_GRID[0] && /^[#.]+$/.test(r)), `${g.name} is ${KINGMAKER_GRID[0]} wide`);
  }
  for (const style of ["Regular", "Bold"]) {
    const font = readFileSync(new URL(`assets/fonts/KingmakerGlyphs-${style}.ttf`, ROOT));
    assert.ok(font.includes(Buffer.from(KINGMAKER_SOURCE, "latin1")), `${style} was built from other bitmaps`);
    const codes = cmapCodes(font);
    for (const g of drawn) assert.ok(codes.has(g.code), `${style} has ${g.name}`);
    assert.equal(codes.size, drawn.length);
  }
});

test("the sprites live in Supplementary Private Use Area-B, clear of Nerd Fonts, and each is one cell to OpenTUI", () => {
  for (const { name, code, glyph } of KM_VOCABULARY) {
    assert.ok(code >= 0x10e000 && code <= 0x10efff, name);
    assert.ok(isKingmaker(glyph));
    for (const widthMethod of WIDTHS) assert.equal(measureEditText(glyph, { widthMethod }), 1, `${name} under ${widthMethod}`);
  }
  const row = KM_VOCABULARY.map(v => v.glyph).join("");
  for (const widthMethod of WIDTHS) assert.equal(measureEditText(`[${row}]`, { widthMethod }), KM_VOCABULARY.length + 2);
  // The control: OpenTUI does measure wide characters as two.
  assert.equal(measureEditText("🐀", { widthMethod: "unicode" }), 2);
});

test("the cast: a sprite each (the Crakes share one), the same in the look layer and on the map", () => {
  const seen = new Map<string, string>();
  for (const [id, look] of Object.entries(CAST_LOOKS)) {
    assert.ok(look.km && isKingmaker(look.km), `${id} has a sprite`);
    assert.equal(CAST[id]?.km, look.km, `${id}: the map's CAST agrees`);
    assert.ok(!seen.has(look.km), `${id} has ${seen.get(look.km)}'s sprite`);
    seen.set(look.km, id);
  }
  const kell = { name: "Sergeant Agnes Kell", kind: "person", id: "kell" };
  assert.equal(lookOf(kell, { glyphs: "kingmaker" }).glyph, km("kell"));
  assert.equal(lookOf(kell, { glyphs: "ascii" }).glyph, "K", "the ascii set is as it was");
  assert.equal(lookOf({ name: "the silent Crake", kind: "person", cast: "crake-2" }, { glyphs: "kingmaker" }).glyph, km("crake"));
  assert.equal(lookOf({ name: "the lantern-boy", kind: "person", cast: "lantern-boy" }, { glyphs: "kingmaker" }).glyph, km("lantern-boy"));
  assert.equal(lookOf({ name: "Duchess", kind: "creature", id: "duchess" }, { glyphs: "kingmaker" }).glyph, km("duchess"));
  // Named people who aren't the cast: by the words in their name, else anyone.
  assert.equal(lookOf({ name: "Captain Bray of the watch", kind: "person", cast: "bray" }, { glyphs: "kingmaker" }).glyph, km("guard"));
  assert.equal(lookOf({ name: "Odo", kind: "person", cast: "odo" }, { glyphs: "kingmaker" }).glyph, km("man"));
});

test("invented names find a sprite by their words, or keep their ascii letter", () => {
  const look = (name: string, kind: string, states: string[] = []) => lookOf({ name, kind, created: 1, states }, { glyphs: "kingmaker", t: 0 });
  assert.equal(look("a goblin", "creature").glyph, km("goblin"));
  assert.equal(look("an old watchman", "person").glyph, km("watchman"));
  assert.equal(look("an old woman", "person").glyph, km("old-woman"));
  assert.equal(look("a doddering old man", "person").glyph, km("old-man"));
  assert.equal(look("a woman haggling over cabbages", "person").glyph, km("woman"));
  assert.equal(look("an eel-seller packing up", "person").glyph, km("merchant"));
  assert.equal(look("porters going down to the night shift", "person").glyph, km("porter"));
  assert.equal(look("a vast mastiff", "creature").glyph, km("duchess"));
  assert.equal(look("a bear", "creature").glyph, km("bear"), "no rule knows bears: the words alone");
  assert.equal(look("a gibbering homunculus", "creature").glyph, km("monster"));
  assert.equal(look("a startled goat", "creature").glyph, km("goat"));
  const flock = look("a flock of pigeons", "creature");
  assert.ok(flock.glyph === km("pigeon") || flock.glyph === km("pigeon-flap"));
  assert.equal(flock.group, 6);
  // No sprite: the ascii letter. Things stay things, but for bodies.
  assert.equal(look("a cow", "creature").glyph, "q");
  assert.equal(look("a cricket bat", "item").glyph, "/");
  assert.equal(look("a pocket watch", "item").glyph, "°");
  assert.equal(look("a lantern", "item", ["lit"]).glyph, "¤");
  assert.equal(lookOf({ name: "the clerk's body", kind: "object", tags: ["body"] }, { glyphs: "kingmaker" }).glyph, km("body"));
  // The dead lie down (and the hanged hang upright); a dead creature is remains.
  assert.equal(look("a porter", "person", ["dead"]).glyph, km("body"));
  assert.equal(lookOf({ name: "Wendell Prout's body", kind: "object", tags: ["body"], states: ["hanging"] }, { glyphs: "kingmaker" }).glyph, km("man"));
  assert.equal(look("a rat", "creature", ["dead"]).glyph, "%");
});

test("the kingmaker set's plumbing: chosen by KM_GLYPHS, ascii for all but beings, crowds and wingbeats", () => {
  assert.equal(detectGlyphSet({ KM_GLYPHS: "kingmaker" }).set, "kingmaker");
  assert.equal(glyphFor({ ascii: "♣" }, "kingmaker"), "♣");
  assert.equal(glyphFor({ ascii: "d", km: km("dog") }, "kingmaker"), km("dog"));
  assert.equal(glyphFor({ ascii: "d", km: km("dog") }, "ascii"), "d");
  assert.equal(inSet("☺", "kingmaker"), km("child"));
  assert.equal(inSet("≈", "kingmaker"), "≈");
  // Birds beat their wings; nothing else does.
  const frames = new Set(Array.from({ length: 40 }, (_, k) => lookOf({ name: "a pigeon", kind: "creature" }, { glyphs: "kingmaker", t: k * 75 }).glyph));
  assert.deepEqual([...frames].sort(), [km("pigeon"), km("pigeon-flap")].sort());
  assert.equal(kmFlap(km("dog"), true), km("dog"));
  assert.equal(kmFlap("v", true), "v");
});

test("the yard and the Rat in the kingmaker set: the cast as sprites, and every row exactly the view's width to OpenTUI", () => {
  const yard = frameAt("yard", 2400, { w: 100, h: 34, glyphs: "kingmaker" });
  const rat = frameAt("rat", 3700, { w: 100, h: 34, glyphs: "kingmaker" });
  for (const ch of [km("kell"), km("cob"), km("moll")]) assert.ok(yard.toPlain().includes(ch), `the yard has ${KM_VOCABULARY.find(v => v.glyph === ch)!.name}`);
  for (const ch of [km("nan"), km("hobb"), km("arlo"), km("dilly")]) assert.ok(rat.toPlain().includes(ch), `the Rat has ${KM_VOCABULARY.find(v => v.glyph === ch)!.name}`);
  for (const frame of [yard, rat]) for (const line of frame.toLines()) {
    assert.equal([...asText(line)].length, 100);
    for (const widthMethod of WIDTHS) assert.equal(measureEditText(asText(line), { widthMethod }), 100);
  }
});

test("the map stays aligned with sprites on it: every row of the Rat and the Heron measures the viewport's width", async () => {
  const { buildWorld } = await import("../../world/scene-world.ts");
  const { drownedRatWorld } = await import("../../../scenes/worlds/drowned-rat.ts");
  const { newExploration, enterScene, actorsHere, render, getMap, regionForScene, heronWorld } = await import("../map/index.ts");
  const viewport = { w: 90, h: 30 };
  for (const [scene, world, people] of [["drowned-rat", drownedRatWorld, ["kell", "nan-quill", "dilly", "hobb", "arlo", "cob"]], ["heron-warehouse", heronWorld, ["kell", "saul", "hep", "scrope", "hobb", "duchess"]]] as const) {
    const ex = newExploration({ time: "night", played: ["hanged-clerk"], lead: scene, flags: {} });
    enterScene(ex, scene);
    const w = buildWorld(scene, world, people.map(id => ({ id, name: CAST[id]!.name })), { name: "you" });
    const frame = lookFrame(3, "night", "kingmaker");
    // As the integrated renderer will draw them: every actor's glyph from the look layer, in the kingmaker set.
    const actors = actorsHere(ex, w).map(a => ({ ...a, glyph: actorLook(a, frame).glyph }));
    const sprites = actors.filter(a => isKingmaker(a.glyph));
    assert.ok(sprites.length >= 4, `${scene}: the cast are sprites`);
    const r = regionForScene(scene)!.region.rect;
    const lines = render(getMap(ex.map), actors, { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) }, viewport, { time: "night", roofs: false, tick: 3 });
    assert.equal(lines.length, viewport.h);
    const drawn = lines.map(asText).join("");
    assert.ok(sprites.some(a => drawn.includes(a.glyph)), `${scene}: sprites on screen`);
    for (const line of lines) for (const widthMethod of WIDTHS) assert.equal(measureEditText(asText(line), { widthMethod }), viewport.w, `${scene} under ${widthMethod}`);
  }
});
