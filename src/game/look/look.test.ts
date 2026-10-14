import { test } from "node:test";
import assert from "node:assert/strict";
process.env.KM_LOOK_MODEL = "off";
const { applyOps, buildWorld, damageThing, tick } = await import("../../world/scene-world.ts");
const { douse, spill } = await import("../../world/systems.ts");
const { drownedRatWorld } = await import("../../../scenes/worlds/drowned-rat.ts");
const { hangedClerkWorld } = await import("../../../scenes/worlds/hanged-clerk.ts");
const { lookOf, describeLook } = await import("./appearance.ts");
const { parseName } = await import("./names.ts");
const { plainOf, plainText, glyphFor, nerd, detectGlyphSet } = await import("./glyphs.ts");
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

test("every authored thing in the scene worlds gets a look from the rules, not a guess", async () => {
  const { heronWorld } = await import("../../../scenes/worlds/heron-warehouse.ts");
  const { dressingRoomWorld } = await import("../../../scenes/worlds/kings-morning.ts");
  const heron = buildWorld("heron-warehouse", heronWorld, [], { name: "Odo" }), king = buildWorld("kings-morning", dressingRoomWorld, [], { name: "Odo" });
  // Sacks hold grain here (not the old wine): the Heron's stacks are sacks.
  assert.equal(describeLook(heron.entities["heron-sacks"]!).role, "sack");
  for (const world of [rat(), yard(), heron, king]) {
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

test("names the rules used to misread, from generated places", () => {
  const look = (name: string, kind = "object") => describeLook({ name, kind });
  // An oven is a warm dome, not a blaze; its peel is a paddle; a lime pit is a pit, not a lime tree.
  assert.equal(look("the brick oven").role, "oven");
  assert.notEqual(look("the brick oven").ascii, look("a driftwood fire").ascii);
  assert.equal(look("a squat stone stove").role, "oven");
  assert.equal(look("a wooden oven peel").role, "oar");
  assert.equal(look("a lime pit").role, "pit");
  // A sign showing a lamp is a sign; tins of oil aren't oil; a plunge pool is a pool; a rope-counter is a counter.
  assert.equal(look("a sign showing a lamp and a length of rope").role, "sign");
  assert.equal(look("a stack of oil tins").role, "crate");
  assert.equal(look("the cold plunge pool").role, "puddle");
  assert.equal(look("the rope-counter").role, "table");
  assert.equal(look("a stack of hay bales").role, "grain");
  // People with names of their own are themselves (an initial), not their surnames; crowds and royalty stay.
  assert.equal(look("Dilly Sparrow", "person").ascii, "D");
  assert.equal(look("Mara Wick", "person").ascii, "M");
  assert.equal(look("Captain Brine", "person").ascii, "B");
  assert.equal(look("the biggest man in the room", "person").role, "person");
  assert.equal(look("the Patience's bargees", "person").role, "person");
  assert.equal(look("Hep Grist's gang", "person").role, "crowd");
  assert.equal(look("the Queen", "person").role, "royal");
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
  assert.equal(plainText("No credit—not for bluebottles… “not ever”"), "No credit-not for bluebottles... \"not ever\"", "the GM's typography, plain");
  assert.equal(glyphFor({ ascii: "♣" }, "nerd"), "♣"); // no icon: falls back
  assert.equal(detectGlyphSet({ KM_GLYPHS: "nerd" }).set, "nerd");
  assert.equal(detectGlyphSet({ TERM: "dumb" }).set, "plain");
  assert.equal(detectGlyphSet({ TERM: "xterm-256color", LANG: "en_GB.UTF-8" }).set, "ascii");
});

test("plain is seven-bit on the stage too: a bark in the GM's own punctuation", async () => {
  const { dressingFor } = await import("./dressings.ts");
  const { renderStage } = await import("./stage.ts");
  const fx = new Effects({ now: () => 0 });
  fx.bark("kell", "No credit—not for bluebottles… “not ever”", {}, 0);
  const plain = renderStage(rat(), dressingFor("drowned-rat"), { w: 80, h: 30, t: 400, time: "evening", glyphs: "plain", effects: fx }).toPlain();
  assert.match(plain, /No credit-not for/);
  assert.deepEqual([...plain].filter(ch => ch !== "\n" && ch.charCodeAt(0) >= 128), [], "seven-bit only");
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

test("the director reads the rules' lines: spells cast, damage to people (by alias), the player hurt and healed, short lines barked", () => {
  const w = rat();
  const fx = new Effects({ now: () => 0, seed: 4 });
  const director = new Director(fx);
  director.prime(w);
  // A Fireball on the long table: a ball of fire flies from the player and bursts there.
  const n = director.spellsFrom(w, ["Cast Fireball (3rd-level slot): a 20-foot sphere on the long table, catching the long table", "Damage to things in it: 8d6 (3+4+5+6+2+1+4+3) 28 fire (things don't dodge)", "The long table takes 28 fire damage and is destroyed"], 0);
  assert.equal(n, 1);
  const table = w.entities["long-table"]!.at!;
  const burst = fx.frame(900, () => undefined).areas.filter(a => Math.hypot(a.x - table.x, a.y - table.y) < 1);
  assert.ok(burst.some(a => a.kind === "fire"), "the fire bursts over the table");
  // Fire Bolt at someone the player calls "the big man": a bolt to Hobb, the number over him.
  const hobb = w.entities.hobb!.at!;
  director.spellsFrom(w, ["Cast Fire Bolt (cantrip) on the big man", "Fire Bolt: your attack on the big man: 15 +5 = 20 vs AC 12: hit", "Damage: 1d10 (7) fire"], 2000, { hobb: "the big man" });
  const bolt = fx.frame(2050, () => undefined).sprites;
  assert.ok(bolt.length > 0, "a bolt in flight");
  assert.equal(director.rulesLines(w, ["Damage: 1d10 (7) fire", "the big man takes 7 damage (hurt)", "You take 3 damage (HP 21/24)", "Odo regains 5 HP"], 2000, { hobb: "the big man" }), 3);
  const texts = fx.frame(2400, () => undefined).texts;
  const over = (p: { x: number; y: number }, text: string) => texts.some(t => t.text === text && Math.hypot(t.x - p.x, t.y - p.y) < 0.5);
  assert.ok(over(hobb, "7"), "Hobb takes 7 (fire, from the roll before it)");
  assert.ok(over(w.entities.player!.at!, "3") && over(w.entities.player!.at!, "+5"), "the player's damage and healing float over the player");
  // Barks from a reply go over whoever is speaking, not whoever is only mentioned.
  const said = (reply: string) => director.barksFrom(w, reply, 2500).map(b => `${b.id}: ${b.text}`);
  assert.deepEqual(said("Two men built like bollards bar the way. One looks from Kell to you. “You two asking after Big Hobb?”"), [], "a stranger asks; Kell is only looked at");
  assert.deepEqual(said("Kell taps her pencil against her notebook. “Investigator.”"), ["kell: Investigator."]);
  assert.deepEqual(said("Hobb doesn't look up. “That was a full keg,” Kell says."), ["kell: That was a full keg"], "the speech verb after the quote wins");
  assert.deepEqual(said("“Not here,” says Hobb, and Kell writes it down."), ["hobb: Not here"]);
  assert.deepEqual(said("Kell sets down her pencil. “That's a penny,” she says, without looking at Hobb."), ["kell: That's a penny"], "Hobb is only named after the tag: the lead-in says who");
  assert.deepEqual(said("You ask Kell what she makes of it. “Suicide, the Captain says,” you add."), [], "the player's own words are nobody's bark");
  // Before the player knows their names, people go by what the story calls them.
  assert.deepEqual(director.barksFrom(w, "The big man with the bandaged hand flexes it. “Who's asking?”", 2600, { hobb: "the big man with the bandaged hand" }).map(b => b.id), ["hobb"]);
  // A cast member's short line, over their head; a long one isn't a bark.
  assert.ok(director.barkLine(w, "kell", "Calmly. CALMLY, everyone.", 3000));
  assert.ok(!director.barkLine(w, "kell", "I have written down every word of this, investigator, and I will be reading it back to you at length.", 3000));
  assert.ok(fx.frame(3200, id => w.entities[id]?.at).texts.some(t => t.style === "bark" && /^Calmly\./.test(t.text)));
});

test("a fire burning on floats one number a turn: the rules' line, not the line and the hurt again", () => {
  const w = rat();
  const fx = new Effects({ now: () => 0, seed: 1 });
  const director = new Director(fx);
  director.prime(w);
  // The table catches; then, between replies, it burns on (the engine's tick): each a burst of lines, as the app animates them.
  const burst = (t: number, lines: string[]) => { director.spellsFrom(w, lines, t); director.rulesLines(w, lines, t); director.observe(w, t); };
  burst(1000, damageThing(w, w.entities["long-table"]!, 3, "fire", 1));
  director.observe(w, 1500);
  burst(5000, tick(w, 2, 69));
  const where = (id: string) => w.entities[id]?.at;
  const table = where("long-table")!;
  const over = fx.frame(5300, where).texts.filter(t => t.style === "damage" && Math.hypot(t.x - table.x, t.y - table.y) < 0.5);
  assert.equal(over.length, 1, `one number over the table as it burns on (${over.map(t => t.text).join(", ")})`);
  // Hurt the lines don't speak of still floats.
  const chair = w.entities["champions-chair"]!;
  chair.hp!.current -= 4;
  director.observe(w, 9000);
  assert.ok(fx.frame(9200, where).texts.some(t => t.text === "4"), "the hurt the lines didn't speak of floats");
});

test("the stage: the Heron is dressed (walls, glass, the river), its sacks are stacks, and puddles indoors hold the room", async () => {
  const { heronWorld } = await import("../../../scenes/worlds/heron-warehouse.ts");
  const { dressingFor } = await import("./dressings.ts");
  const { renderStage } = await import("./stage.ts");
  const { puddleOver } = await import("./terrain.ts");
  const w = buildWorld("heron-warehouse", heronWorld, [{ id: "hep", name: "Hepzibah Grist" }], { name: "Odo" });
  const dressing = dressingFor("heron-warehouse");
  assert.ok((dressing.walls ?? []).length >= 8 && (dressing.walls ?? []).some(x => x.style === "glass"), "the Heron has walls, and the counting-box glass");
  const plain = renderStage(w, dressing, { w: 100, h: 34, t: 1000, time: "night" }).toPlain();
  assert.match(plain, /[▓█║]/, "walls drawn");
  assert.match(plain, /[≈~]/, "the river");
  assert.equal(lookOf(w.entities["heron-sacks"]!).stamp, "stack", "the heron sacks are a stack");
  assert.equal(lookOf({ name: "Prout's satchel", kind: "item", size: "small" }).stamp, undefined, "a satchel isn't");
  const under = { glyph: " ", fg: rgbOf("#403020"), bg: rgbOf("#302018") };
  const outside = puddleOver(under, 3, 3, 1, { t: 0, time: "evening" }), inside = puddleOver(under, 3, 3, 1, { t: 0, time: "evening", indoor: true });
  assert.notEqual(outside.bg, inside.bg, "indoors a puddle doesn't hold the evening sky");
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
