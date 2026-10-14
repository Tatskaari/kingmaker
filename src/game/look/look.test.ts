import { test } from "node:test";
import assert from "node:assert/strict";
process.env.KM_LOOK_MODEL = "off";
const { applyOps, buildWorld, damageThing, tick } = await import("../../world/scene-world.ts");
const { douse, spill } = await import("../../world/systems.ts");
const { drownedRatWorld } = await import("../../../scenes/worlds/drowned-rat.ts");
const { hangedClerkWorld } = await import("../../../scenes/worlds/hanged-clerk.ts");
const { lookOf, describeLook } = await import("./appearance.ts");
const { parseName } = await import("./names.ts");
const { plainOf, glyphFor, nerd, detectGlyphSet } = await import("./glyphs.ts");
const { surfacesOf } = await import("./surfaces.ts");
const { Effects } = await import("./effects.ts");
const { Director } = await import("./director.ts");
const { frameAt, VIGNETTES } = await import("./vignettes.ts");
const { actorLook, lookFrame, surfaceLayer, groundAt } = await import("./map.ts");
const { rgbOf, luminance } = await import("./color.ts");

const rat = () => buildWorld("drowned-rat", drownedRatWorld, [{ id: "kell", name: "Sergeant Agnes Kell" }, { id: "hobb", name: "Big Hobb Mallory" }], { name: "Odo" });
const yard = () => buildWorld("hanged-clerk", hangedClerkWorld, [{ id: "kell", name: "Sergeant Agnes Kell" }, { id: "cob", name: "Cob" }, { id: "moll", name: "Moll" }], { name: "Odo" });

test("names: head nouns, states and colours in adjectives, groups, piles, surfaces, vessels", () => {
  const p = parseName("a flock of pigeons");
  assert.equal(p.head, "pigeon"); assert.equal(p.group, "flock"); assert.ok(p.plural);
  assert.deepEqual(parseName("a burning branch").states, ["burning"]);
  assert.deepEqual(parseName("a singed pigeon").states, ["scorched"]);
  assert.equal(parseName("the blue driftwood fire").head, "fire");
  assert.deepEqual(parseName("the blue driftwood fire").colors, ["blue"]);
  assert.equal(parseName("the jar of gin with the drowned rat in it").head, "jar");
  assert.equal(parseName("the jar of gin with the drowned rat in it").contents, "gin");
  assert.equal(parseName("a fistful of gutter stones").head, "stone");
  assert.equal(parseName("an oil slick").head, "oil");
  assert.equal(parseName("an oil slick").surface, "slick");
  assert.equal(parseName("a pool of blood").surface, "pool");
  assert.equal(parseName("Prout's good black boots").head, "boots");
  assert.equal(parseName("a folded page sewn into the left boot's lining").head, "page");
  assert.equal(parseName("a stub of candle").head, "candle");
  assert.equal(parseName("a quantity of marzipan").key, "marzipan");
  assert.equal(parseName("porters going down to the night shift").head, "porter");
  // The cache key drops what states and owners say: one look per kind of thing.
  assert.equal(parseName("a singed pigeon").key, parseName("the pigeon").key);
});

test("every authored thing in the scene worlds gets a look from the rules, not a guess", () => {
  for (const world of [rat(), yard()]) {
    for (const e of Object.values(world.entities)) {
      if (e.kind === "place" || e.kind === "area") continue;
      const d = describeLook(e);
      assert.notEqual(d.source, "guess", `${e.name} fell through to a guess`);
      assert.ok(d.ascii.length >= 1);
    }
  }
});

test("the rules read what things are", () => {
  const w = rat();
  const role = (id: string) => describeLook(w.entities[id]!).role;
  assert.equal(role("ale-keg"), "barrel");
  assert.equal(role("long-table"), "table");
  assert.equal(role("bar-counter"), "hull-bar");
  assert.equal(role("fire"), "hearth");
  assert.equal(role("cards"), "cards");
  assert.equal(role("gin-jar"), "jar");
  assert.equal(role("regulars"), "crowd");
  assert.equal(role("manners"), "club"); // by its "weapon" tag: the name says nothing
  // The GM's inventions.
  const look = (name: string, kind: string) => describeLook({ name, kind, created: 1, material: "wood" });
  assert.equal(look("a flock of pigeons", "creature").role, "pigeon");
  assert.equal(look("a burning branch", "item").role, "branch");
  assert.equal(look("ale", "item").role, "ale");
  assert.equal(look("a tea tray", "item").role, "tray");
  assert.equal(look("a bat", "creature").role, "bat");
  assert.equal(look("a cricket bat", "item").role, "club");
  assert.equal(look("the watch", "person").role, "guard");
  assert.equal(look("a pocket watch", "item").role, "clock");
  // Cast: the same letter everywhere; the player is @.
  assert.equal(lookOf(w.entities.kell!).glyph, "K");
  assert.equal(lookOf(w.entities.player!).glyph, "@");
});

test("states change the look: burning, burnt out, wet, hidden, hanging, lit, open", () => {
  const w = yard();
  const elm = w.entities.elm!;
  const calm = lookOf(elm, { t: 0 });
  assert.ok(!calm.glow && !calm.light);
  elm.states.push("burning");
  const burning = lookOf(elm, { t: 0 });
  assert.ok(burning.glow, "burning things glow");
  assert.ok(burning.light && burning.light.radius > 10, "and light their surroundings");
  assert.ok((burning.burning ?? 0) > 0);
  // It flickers: the colour changes from moment to moment.
  const colours = new Set([0, 90, 180, 270, 360, 450].map(t => lookOf(elm, { t }).fg));
  assert.ok(colours.size >= 3, "a fire flickers");
  // Burnt out: a charred heap that smoulders.
  elm.states = ["destroyed", "smouldering"];
  const wreck = lookOf(elm, { t: 100 });
  assert.equal(wreck.wreck, "char");
  assert.equal(wreck.glyph, "%");
  // Wet things are darker and bluer.
  const satchel = w.entities.satchel!;
  const dry = rgbOf(lookOf(satchel).fg);
  satchel.states.push("wet");
  const wet = rgbOf(lookOf(satchel, { t: 0 }).fg);
  assert.ok(luminance(wet) < luminance(dry));
  // Hidden: faint. Hanging: raised. A door: open or shut.
  satchel.states.push("hidden");
  assert.ok((lookOf(satchel).alpha ?? 1) < 0.5);
  assert.ok((lookOf(w.entities.prout!).lift ?? 0) > 0);
  assert.equal(lookOf(w.entities.gate!).glyph, "'");
  assert.equal(lookOf(w.entities["loft-door"]!).glyph, "+");
  // A lit lantern lights; a smashed one doesn't.
  assert.ok(lookOf({ name: "a lantern", kind: "item", states: ["lit"] }).light);
  assert.ok(!lookOf(w.entities["smashed-lantern"]!).light);
});

test("blue fire burns blue: colour words in names change flames and their light", () => {
  const w = rat();
  const fire = lookOf(w.entities.fire!, { t: 500 });
  assert.ok(fire.light);
  const c = rgbOf(fire.light!.color);
  assert.ok((c & 255) > ((c >> 16) & 255), "the driftwood fire's light is blue");
  const spirits = lookOf({ name: "a pool of spilled spirits", kind: "surface", tags: ["spirits", "flammable"], states: ["burning"] }, { t: 0 });
  assert.equal(spirits.flame, "blue");
});

test("one cast table: the look, the map and the app all take the map's CAST", async () => {
  const { CAST } = await import("../map/looks.ts");
  const { castLook } = await import("./people.ts");
  const { glyphOf, personColor } = await import("../../app/theme.ts");
  for (const [id, cast] of Object.entries(CAST)) {
    if (id === "player") continue;
    assert.deepEqual([castLook(id, cast.name).glyph, castLook(id, cast.name).color], [cast.glyph, cast.color], id);
    assert.equal(lookOf({ name: cast.name, kind: "person", cast: id, id }, { glyphs: "ascii" }).glyph, cast.glyph, id);
    assert.equal(glyphOf(id, cast.name), cast.glyph, id);
    assert.equal(personColor(id), cast.color, id);
  }
  // Hobb is H everywhere (the app had him as B); the Crakes are one of a kind.
  assert.equal(glyphOf("hobb", "Big Hobb Mallory"), "H");
  assert.equal(castLook("crake-2", "the silent Crake").glyph, CAST.crake!.glyph);
  assert.equal(lookOf({ name: "the talking Crake", kind: "person", id: "crake-1" }).glyph, CAST.crake!.glyph);
  assert.equal(lookOf({ name: "you", kind: "person", player: true }).glyph, CAST.player!.glyph);
});

test("glyph sets: nerd icons where they help, plain ASCII always, ascii as the default", () => {
  const pigeon = { name: "a pigeon", kind: "creature" };
  assert.equal(lookOf(pigeon, { glyphs: "nerd" }).glyph, nerd("bird"));
  assert.equal(lookOf(pigeon, { glyphs: "ascii" }).glyph, "v");
  // People keep their letters in every set.
  assert.equal(lookOf({ name: "Sergeant Kell", kind: "person", cast: "kell", id: "kell" }, { glyphs: "nerd" }).glyph, "K");
  for (const name of ["a tea tray", "the old elm", "a sack of grain", "a flock of pigeons", "a burning branch", "the blue driftwood fire", "a pool of blood", "a lantern"]) {
    const g = lookOf({ name, kind: "item", states: name.includes("burning") ? ["burning"] : [] }, { glyphs: "plain", t: 0 }).glyph;
    assert.ok(/^[\x20-\x7e]$/.test(g), `${name}: "${g}" isn't seven-bit`);
  }
  assert.equal(plainOf("≈"), "~");
  assert.equal(glyphFor({ ascii: "♣" }, "nerd"), "♣"); // no icon: falls back
  assert.equal(detectGlyphSet({ KM_GLYPHS: "nerd" }).set, "nerd");
  assert.equal(detectGlyphSet({ TERM: "dumb" }).set, "plain");
  assert.equal(detectGlyphSet({ TERM: "xterm-256color", LANG: "en_GB.UTF-8" }).set, "ascii");
});

test("surfaces from the world's physics: spills, a douse's puddle and steam, burning patches", () => {
  const w = rat();
  spill(w, "oil", { x: 12, y: 30 }, 6, 1);
  spill(w, "blood", { x: 20, y: 30 }, 3, 1);
  const table = w.entities["long-table"]!;
  damageThing(w, table, 3, "fire", 1);
  assert.ok(table.states.includes("burning"));
  douse(w, table, 2);
  const { surfaces, clouds } = surfacesOf(w);
  const kinds = surfaces.map(s => s.kind).sort();
  assert.deepEqual(kinds, ["blood", "oil", "water"]);
  assert.ok(clouds.some(c => c.kind === "steam"), "a douse leaves a puff of steam");
  // The map's surface layer draws them, burning ones alight.
  const oil = Object.values(w.entities).find(e => e.kind === "surface" && e.tags.includes("oil"))!;
  oil.states.push("burning");
  const layer = surfaceLayer(w, lookFrame(3, "night"));
  const under = { glyph: " ", fg: "#404040", bg: "#202020" };
  const onOil = layer.at({ x: 12, y: 30 }, under, 10, 10);
  assert.ok(onOil && onOil.glow, "a burning slick glows");
  assert.equal(layer.lights.length, 1);
  assert.equal(layer.at({ x: 2, y: 2 }, under, 0, 0), undefined, "nothing where nothing was spilled");
});

test("effects are exact: the same calls give the same frames; numbers rise and fade; barks follow speakers", () => {
  const make = () => {
    const fx = new Effects({ now: () => 0, seed: 3 });
    fx.effect("fireball", { from: { x: 0, y: 0 }, at: { x: 30, y: 10 }, radius: 20 }, 0);
    fx.float({ x: 30, y: 10 }, "28", { damage: "fire" }, 300);
    fx.bark("kell", "Was that strictly necessary?", {}, 100);
    return fx;
  };
  let kell = { x: 5, y: 5 };
  const a = make().frame(700, () => kell), b = make().frame(700, () => kell);
  assert.deepEqual(a, b);
  assert.ok(a.sprites.length > 10 && a.areas.length > 0 && a.lights.length > 0);
  const early = make().frame(400, () => kell).texts.find(t => t.text === "28")!;
  const late = make().frame(1400, () => kell).texts.find(t => t.text === "28")!;
  assert.ok(late.rows > early.rows && late.alpha < early.alpha, "damage numbers rise and fade");
  kell = { x: 9, y: 2 };
  assert.equal(make().frame(700, () => kell).texts.find(t => t.style === "bark")!.x, 9, "barks follow the speaker");
  assert.equal(make().frame(60_000, () => kell).sprites.length, 0, "and it's all over");
});

test("the director turns world changes into motion", () => {
  const w = rat();
  const fx = new Effects({ now: () => 0 });
  const director = new Director(fx);
  director.prime(w);
  applyOps(w, [{ op: "move", what: "hobb", to: "doorway", how: "", name: "", kind: "", text: "", add: [], remove: [] }], 1);
  damageThing(w, w.entities["long-table"]!, 3, "fire", 1);
  const did = director.observe(w, 1000);
  assert.ok(did.includes("Big Hobb Mallory moves"));
  assert.ok(did.includes("the long table catches fire"));
  // Hobb walks: mid-way he's somewhere between.
  const mid = director.positionAt(w, "hobb", 1300)!;
  const end = w.entities.hobb!.at!;
  assert.ok(Math.hypot(mid.x - end.x, mid.y - end.y) > 1);
  douse(w, w.entities["long-table"]!, 2);
  assert.ok(director.observe(w, 2000).includes("the long table is doused"));
  assert.ok(fx.busy(2100));
  tick(w, 3, 7);
});

test("the map adapter: rules for world things, authored looks for decor, ground that lives", () => {
  const frame = lookFrame(5, "night");
  const flock = actorLook({ id: "pigeons", name: "a flock of pigeons", kind: "creature", glyph: "r", color: "#a08060", map: "caerwyn", at: { x: 3, y: 3 }, ref: "a-flock-of-pigeons" }, frame);
  assert.ok(flock.glyph === "v" || flock.glyph === "V", "world things get the rules' look, not the map's fallback");
  const decor = actorLook({ id: "stall", name: "a market stall", kind: "object", glyph: "Π", color: "#c08040", map: "caerwyn", at: { x: 1, y: 1 } }, frame);
  assert.equal(decor.glyph, "Π");
  const torch = actorLook({ id: "t", name: "a torch", kind: "object", glyph: "¡", map: "m", at: { x: 1, y: 1 }, states: ["burning"] }, frame);
  assert.ok(torch.glow && torch.above && torch.light);
  const kell = actorLook({ id: "kell", name: "Sergeant Kell", kind: "person", glyph: "K", map: "m", at: { x: 1, y: 1 }, ref: "kell" }, frame);
  assert.equal(kell.glyph, "K");
  const water = [0, 400, 800, 1200].map(t => groundAt("water", 10, 4, { ...frame, t }));
  assert.ok(new Set(water.map(c => `${c!.glyph}${c!.fg}${c!.bg}`)).size > 1, "water moves");
  assert.equal(groundAt("wall", 0, 0, frame), undefined, "walls are the renderer's own");
});

test("the map adapter takes the map module's own actors: every one of the Rat's gets a look", async () => {
  const { regionForScene, actorsFromWorld } = await import("../map/index.ts");
  const place = regionForScene("drowned-rat")!;
  const w = rat();
  spill(w, "oil", { x: 12, y: 30 }, 4, 1);
  damageThing(w, w.entities["card-table"]!, 3, "fire", 1);
  const actors = actorsFromWorld(place.region, w, { map: place.map });
  assert.ok(actors.length > 10);
  for (const frame of [lookFrame(0, "evening"), lookFrame(7, "night", "nerd"), lookFrame(3, "morning", "plain")]) {
    for (const a of actors) {
      const look = actorLook(a, frame);
      assert.ok(look.glyph.length > 0, a.name);
      assert.match(look.fg, /^#[0-9a-f]{6}$/, a.name);
    }
  }
  const table = actors.find(a => a.ref === "card-table")!;
  assert.ok(actorLook(table, lookFrame(1, "night")).glow, "the burning card table glows on the map");
});

test("vignette frames are exact and fill the view", () => {
  for (const v of VIGNETTES) {
    const t = Math.round(v.length * 0.4);
    const a = frameAt(v.id, t, { w: 90, h: 30, glyphs: "ascii" });
    const b = frameAt(v.id, t, { w: 90, h: 30, glyphs: "ascii" });
    assert.equal(a.toPlain(), b.toPlain(), `${v.id} isn't deterministic`);
    assert.deepEqual(a.toJSON(), b.toJSON());
    const lines = a.toLines();
    assert.equal(lines.length, 30);
    for (const line of lines) assert.equal(line.reduce((n, s) => n + [...s.text].length, 0), 90);
    for (const line of lines) for (const span of line) assert.match(span.fg ?? "", /^#[0-9a-f]{6}$/);
  }
  // The Rat: the player and Kell are on stage; by 8.6s the long table is alight.
  const rat = frameAt("rat", 8600, { w: 100, h: 34, glyphs: "ascii" }).toPlain();
  assert.match(rat, /@/);
  assert.match(rat, /K/);
  assert.match(rat, /▲|\^/);
  // The plain set is seven-bit through and through (but for the two boards that compare the sets on purpose).
  for (const v of VIGNETTES.filter(x => x.id !== "inventions" && x.id !== "glyphs")) for (const t of [2500, 9000, 15000]) {
    const plain = frameAt(v.id, t, { w: 100, h: 34, glyphs: "plain" }).toPlain();
    const odd = [...plain].filter(ch => ch !== "\n" && ch.charCodeAt(0) >= 128);
    assert.deepEqual(odd, [], `${v.id} at ${t}ms`);
  }
});
