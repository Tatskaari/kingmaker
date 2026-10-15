import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
process.env.KM_RUNS_DIR = mkdtempSync(join(tmpdir(), "km-zoo-"));
process.env.KM_LOOK_MODEL = "off";
process.env.KM_GLYPHS = "ascii";
process.env.OPENROUTER_API_KEY = "offline";
const { ZOO_SCENES, SCENES, sceneById } = await import("../../../scenes/index.ts");
const { validateScene } = await import("../../runtime/scene.ts");
const { PLACES } = await import("../map/places.ts");
const { actorsHere, getMap, pathTo, scenePlace } = await import("../map/index.ts");
const { isStructure, tileAt } = await import("../map/tiles.ts");
const { exploreState } = await import("../town.ts");
const { available, EXHIBITS, placePlayer, triggerById, triggerTile, wingWorld, zooLead } = await import("./explorer.ts");
const { loadZoo, newZoo } = await import("./game.ts");
const { zooOf } = await import("./model.ts");
const { ROOMS, WINGS, wingOf } = await import("./wings/index.ts");
const { ARENAS } = await import("./arenas.ts");
const { freshWorld } = await import("./world.ts");
const { runTour } = await import("./touring.ts");
const { resumable, zooVisits } = await import("../../app/save.ts");

/**
 * The zoo (src/game/zoo): its wings are well formed and every sign and trigger can be reached; it's
 * a game of its own, kept apart from the story; its scenes open on their rooms and end back on the
 * map; its arena's fights start from the map and end back on it; its worlds are live on the map.
 * Offline: no model is asked.
 */

const zoo = await newZoo({ seed: 11 });

test("every wing's grid is a rectangle, and its signs and triggers stand on open floor its way in can reach", () => {
  for (const wing of WINGS) {
    const map = getMap(wing.id);
    if (!wing.compiled) {
      const rows = wing.map.grid.replace(/^\n/, "").replace(/\n\s*$/, "").split("\n");
      assert.ok(rows.every(r => [...r].length === [...rows[0]!].length), `${wing.id}: every row of the grid is as wide as the first`);
    }
    placePlayer(zoo.state, wing.id, wing.entry);
    const ex = exploreState(zoo.state);
    const open = (t: { x: number; y: number }) => { const tile = tileAt(map, t); return !!tile && !tile.blocks && !isStructure(tile); };
    assert.ok(open(wing.entry), `${wing.id}: the way in is open floor`);
    for (const e of wing.exhibits) {
      assert.ok(open(e.sign), `${wing.id}/${e.id}: its sign stands on open floor`);
      assert.ok(pathTo(ex, e.sign) !== undefined, `${wing.id}/${e.id}: its sign can be reached from the way in`);
      for (const t of e.triggers) {
        const at = triggerTile(ex, wing, t);
        assert.ok(at, `${t.id}: it's somewhere in ${wing.id}`);
        assert.ok(pathTo(ex, at!) !== undefined, `${t.id}: it can be reached from the way in`);
      }
    }
  }
});

test("trigger ids are unique across the zoo, and a trigger at a thing has its thing in the wing's world", () => {
  const ids = WINGS.flatMap(w => w.exhibits.flatMap(e => e.triggers.map(t => t.id)));
  assert.equal(new Set(ids).size, ids.length, `duplicates: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(", ")}`);
  for (const wing of WINGS) {
    const world = freshWorld(wing, { name: "you" });
    for (const t of wing.exhibits.flatMap(e => e.triggers)) if (typeof t.at === "string") assert.ok(world.entities[t.at], `${t.id}: ${t.at} is in ${wing.id}'s world`);
    for (const e of wing.exhibits) for (const id of e.tour ?? []) assert.ok(triggerById(id), `${wing.id}/${e.id}: its tour's ${id} is a trigger`);
  }
  // Each sign's exhibit has words, and a title to read them by.
  for (const e of EXHIBITS) assert.ok(e.title && e.text.length > 40, `${e.id} has a sign worth reading`);
});

test("the zoo's own scenes are well formed, and each has its room", () => {
  for (const scene of ZOO_SCENES) {
    assert.deepEqual(validateScene(scene), [], scene.id);
    assert.ok(ROOMS.some(r => r.sceneId === scene.id), `${scene.id} has a room to walk into`);
    assert.ok(scenePlace(scene.id), `${scene.id} has a place on the map`);
  }
  // None of them is a scene of the story's, and the story's places don't know them.
  for (const scene of ZOO_SCENES) {
    assert.ok(!SCENES.some(s => s.id === scene.id));
    assert.equal(PLACES[scene.id], undefined);
  }
});

test("a zoo visit is a game of its own: no lead, nothing played, and never offered as a story game to Continue", async () => {
  const visit = await newZoo({ seed: 10 });
  assert.equal(visit.state.hub, "zoo");
  assert.equal(visit.state.story.lead, undefined);
  assert.deepEqual(visit.state.story.played, []);
  assert.equal(exploreState(visit.state).map, "zoo-hall");
  assert.match(visit.session.player.build ?? "", /wizard 5/);
  visit.save();
  assert.ok(zooVisits().some(r => r.id === visit.state.id), "listed as a zoo visit");
  assert.ok(!resumable().some(r => r.id === visit.state.id), "not a story game to Continue");
  // The next exhibit is the first one not seen, in the hall where the visit starts.
  assert.match(zooLead(visit.state)?.label ?? "", /Welcome to the Zoo/);
});

test("reading a sign marks its exhibit seen, and the next exhibit moves on", async () => {
  const game = await newZoo({ seed: 12 });
  const first = EXHIBITS[0]!;
  const said = await game.act(`look@${first.sign.x},${first.sign.y}`);
  assert.match(said, new RegExp(first.title.toUpperCase()));
  assert.ok(zooOf(game.state).seen.includes(first.id));
  assert.notEqual(zooLead(game.state)?.label.startsWith(first.title), true);
});

test("a wing's world is live on the map: its people are about, and a trigger sets the physics off and reports it", async () => {
  const game = await newZoo({ seed: 13 });
  placePlayer(game.state, "zoo-fire", WINGS.find(w => w.id === "zoo-fire")!.entry);
  const ex = exploreState(game.state);
  assert.ok(actorsHere(ex).some(a => a.id === "zoo-fire:scarecrow"), "the scarecrow is on the map");
  assert.ok(available(game.state, game.session, "fireball-scarecrow"));
  const said = await game.act("use_fireball-scarecrow");
  assert.match(said, /Fireball/);
  const world = wingWorld(game.state, "zoo-fire")!;
  assert.ok(world.entities["scarecrow"]!.states.some(s => s === "burning" || s === "destroyed"), "the scarecrow caught");
  const news = zooOf(game.state).news!;
  assert.equal(news.map, "zoo-fire");
  assert.ok(news.lines.some(l => /^Cast Fireball/.test(l)), "the rules' lines are news, for the view to play");
  // A fighter's fireball is nothing at all: the robes are in the hall.
  placePlayer(game.state, "zoo-hall", WINGS[0]!.entry);
  await game.act("use_wear-fighter");
  placePlayer(game.state, "zoo-fire", WINGS.find(w => w.id === "zoo-fire")!.entry);
  assert.match(await game.act("use_fireball-scarecrow"), /isn't a spell .* has ready/);
});

test("a scene of the zoo's opens when you walk into its room, and ends back on the map with the story untouched", async () => {
  const game = await newZoo({ seed: 14 });
  const room = ROOMS.find(r => r.sceneId === "zoo-pie-stall")!;
  placePlayer(game.state, room.map, { x: room.door.x, y: room.door.y + 1 });
  // Offline, the GM's opening fails; the scene is open all the same.
  await game.act(`walk@${room.door.x},${room.door.y - 1}`).catch(() => "");
  assert.equal(game.state.mode, "scene");
  assert.equal(game.session.sceneId, "zoo-pie-stall");
  assert.ok(game.session.world, "the scene's world is built");
  const back = await game.endScene("bought");
  assert.match(back, /over: back on the map/);
  assert.equal(game.state.mode, "explore");
  assert.equal(exploreState(game.state).map, "zoo-theatre");
  assert.equal(exploreState(game.state).scene, undefined);
  assert.equal(game.session.world, undefined, "the scene's world goes with it");
  assert.equal(game.state.story.lead, undefined, "nothing chains on");
  assert.ok(game.session.history.some(h => h.sceneId === "zoo-pie-stall" && h.exitId === "bought"), "its ending is on the record (the notebook reads it)");
  // Played again, it opens afresh.
  placePlayer(game.state, room.map, { x: room.door.x, y: room.door.y + 1 });
  await game.act(`walk@${room.door.x},${room.door.y - 1}`).catch(() => "");
  assert.equal(game.state.mode, "scene");
  assert.equal(game.session.ended, undefined);
  await game.endScene("lost");
  assert.equal(game.state.mode, "explore");
});

test("an arena fight starts from the map, carries on after a save, and ends back on the map with the ring as it left it", async () => {
  const game = await newZoo({ seed: 15 });
  const arena = ARENAS["porters"]!;
  placePlayer(game.state, arena.wing, arena.outside);
  assert.match(await game.act("use_bell-porters"), /Roll for initiative/);
  assert.equal(game.state.mode, "combat");
  assert.equal(game.session.world?.scene, "zoo-arena", "the arena's world is the fight's");
  assert.equal(wingWorld(game.state, "zoo-arena"), undefined, "and off the map while it lasts");
  game.save();
  const again = loadZoo(game.state.id);
  for (let i = 0; i < 80 && !again.currentFight?.result(); i++) await again.act("auto");
  assert.ok(again.currentFight?.result(), "the fight ends");
  const said = await again.act("continue");
  assert.match(said, /The fight in the porters' floor/);
  assert.equal(again.state.mode, "explore");
  assert.equal(again.state.fromMap, undefined);
  assert.equal(exploreState(again.state).map, "zoo-arena");
  const world = wingWorld(again.state, "zoo-arena")!;
  assert.ok(world, "the arena's world is back on the map");
  // Whichever side won, the fight's end is written into the ring: who's down, hurt or gave up.
  const marked = [...arena.enemies.map(e => e.id), "player"].filter(id => world.entities[id]?.states.some(s => ["down", "surrendered", "dead", "gone", "hurt", "badly hurt"].includes(s)));
  assert.ok(marked.length > 0, "the fight's end is written into the ring");
  assert.equal(again.session.world, undefined);
});

test("a zoo scene's fight is fought on its booth's floor, and its aftermath ends back on the map", async () => {
  const game = await newZoo({ seed: 18 });
  const room = ROOMS.find(r => r.sceneId === "zoo-tavern")!;
  placePlayer(game.state, room.map, { x: room.door.x - 1, y: room.door.y });
  await game.act(`walk@${room.door.x + 1},${room.door.y}`).catch(() => "");
  assert.equal(game.session.sceneId, "zoo-tavern");
  assert.match(await game.endScene("fight"), /Roll for initiative/);
  const fight = game.currentFight as unknown as { controller: { state(): { map: { id: string }; units: Record<string, { castId?: string; at: { x: number; y: number } }> } } };
  const G = fight.controller.state();
  assert.equal(G.map.id, "zoo-theatre", "on the booth's own map");
  assert.ok(G.units["dunt"] && G.units["gubbins"], "the porters from the scene's cast");
  assert.ok(Object.values(G.units).every(u => u.at.x >= room.rooms[0]!.x - 1 && u.at.x <= room.rooms[0]!.x + room.rooms[0]!.w), "everyone in the booth");
  for (let i = 0; i < 80 && !game.currentFight?.result(); i++) await game.act("auto");
  await game.act("continue").catch(() => "");
  assert.equal(game.state.mode, "scene", "the scene picks up from the fight");
  await game.endScene("settled");
  assert.equal(game.state.mode, "explore");
  assert.equal(exploreState(game.state).map, "zoo-theatre");
});

test("Kell walks with you when asked, and goes back to her corner when asked", async () => {
  const game = await newZoo({ seed: 16 });
  const kell = wingOf("zoo-kell")!;
  placePlayer(game.state, kell.id, kell.entry);
  await game.act("use_kell-follow");
  assert.ok(exploreState(game.state).followers.some(f => f.id === "kell"));
  await game.act("use_kell-wait");
  assert.ok(!exploreState(game.state).followers.some(f => f.id === "kell"));
});

test("the tour goes round a wing offline and passes", async () => {
  const out = mkdtempSync(join(tmpdir(), "km-zoo-tour-"));
  const report = await runTour({ out, only: ["kell", "chandlery"], png: false, seed: 3 });
  assert.deepEqual(report.failures, []);
  assert.equal(report.seen, report.total);
  assert.ok(report.exhibits.some(x => x.steps.some(s => s.id === "scene:zoo-dictation" && s.ok)), "Kell's desk was played to an ending");
});

test("the story's places aren't the zoo's to register, and a hub's scene opens afresh each time", async () => {
  const { registerPlace } = await import("../map/places.ts");
  const { openHubScene, closeHubScene } = await import("../../runtime/engine.ts");
  assert.throws(() => registerPlace({ ...PLACES["hanged-clerk"]! }), /story's place/);
  const game = await newZoo({ seed: 17 });
  const s = game.session;
  openHubScene(s, "zoo-belfry");
  assert.equal(s.sceneId, "zoo-belfry");
  assert.equal(s.beat, sceneById("zoo-belfry").start);
  assert.equal(s.ended, undefined);
  assert.deepEqual(s.path, []);
  s.ended = { exitId: "noon", operations: [] } as unknown as NonNullable<typeof s.ended>;
  openHubScene(s, "zoo-belfry");
  assert.equal(s.ended, undefined, "played again, it starts again");
  closeHubScene(s);
  assert.equal(s.world, undefined);
});
