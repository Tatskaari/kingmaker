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
  assert.match(said, /The fight on the porters' floor: /);
  assert.equal(again.state.mode, "explore");
  assert.equal(again.state.fightOnMap, undefined);
  assert.equal(exploreState(again.state).map, "zoo-arena");
  const world = wingWorld(again.state, "zoo-arena")!;
  assert.ok(world, "the arena's world is back on the map");
  // Whichever side won, the fight's end is written into the ring: who's down, hurt or gave up.
  const marked = [...arena.enemies.map(e => e.id), "player"].filter(id => world.entities[id]?.states.some(s => ["down", "surrendered", "dead", "gone", "hurt", "badly hurt"].includes(s)));
  assert.ok(marked.length > 0, "the fight's end is written into the ring");
  assert.equal(again.session.world, undefined);
});

test("a ring's fight saved by the zoo's own builds (fromMap, as they called it) still ends back on the map", async () => {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { sessionDir } = await import("../../runtime/session.ts");
  const game = await newZoo({ seed: 15 });
  const arena = ARENAS["porters"]!;
  placePlayer(game.state, arena.wing, arena.outside);
  await game.act("use_bell-porters");
  game.save();
  const file = join(sessionDir(game.state.id), "game.json");
  const { fightOnMap, ...rest } = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  assert.equal(fightOnMap, true);
  writeFileSync(file, JSON.stringify({ ...rest, fromMap: true }));
  const again = loadZoo(game.state.id);
  assert.equal(again.state.fightOnMap, true);
  for (let i = 0; i < 80 && !again.currentFight?.result(); i++) await again.act("auto");
  assert.deepEqual(again.observe().actions.map(a => a.label), ["Back to the map"]);
  assert.match(await again.act("continue"), /The fight on the porters' floor: /);
  assert.equal(again.state.mode, "explore");
  assert.equal(exploreState(again.state).map, "zoo-arena");
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

test("each ring starts fresh: its people made afresh by the rules, and Kell too, whatever the last fight left of them", async () => {
  const game = await newZoo({ seed: 19 });
  const arena = ARENAS["heron"]!;
  const units = () => {
    const fight = game.currentFight as unknown as { controller: { state(): { units: Record<string, { id: string; engineId: string }> } } };
    return Object.fromEntries(Object.values(fight.controller.state().units).map(u => [u.id, u.engineId]));
  };
  const rings: Array<Record<string, string>> = [];
  for (let ring = 1; ring <= 2; ring++) {
    placePlayer(game.state, arena.wing, arena.outside);
    assert.match(await game.act("use_bell-heron"), /Roll for initiative/);
    rings.push(units());
    for (let i = 0; i < 150 && !game.currentFight?.result(); i++) await game.act("auto");
    await game.act("continue");
  }
  // Not the same people, bruised, carried over from the last fight: each is new to the rules.
  for (const id of ["sallow", "crake-1", "crake-2", "lantern-boy", "kell"]) assert.notEqual(rings[1]![id], rings[0]![id], `${id} is made afresh for the second ring`);
  // And the fight's end says where it was, not the Heron.
  const notebook = game.session.rules?.npcs ?? {};
  assert.ok(notebook.sallow, "the rules know who Sallow was in the last ring");
});

test("a sign read asks the screen to show it in full, once", async () => {
  const game = await newZoo({ seed: 20 });
  const sign = EXHIBITS.find(e => e.id === "wardrobe")!;
  await game.act(`look@${sign.sign.x},${sign.sign.y}`);
  const shown = zooOf(game.state).show!;
  assert.equal(shown.kind, "sign");
  assert.equal(shown.id, "wardrobe");
  await game.act(`look@${sign.sign.x},${sign.sign.y}`);
  assert.ok(zooOf(game.state).show!.seq > shown.seq, "read again, shown again");
});

test("the hall's window, its curtain cord and the Theatre's house-style lever and boundary desk", async () => {
  const { readDoc, seedDoc } = await import("../../lore/docs.ts");
  const { ZOO_FRONTS } = await import("./fronts.ts");
  const game = await newZoo({ seed: 21 });
  placePlayer(game.state, "zoo-hall", WINGS[0]!.entry);
  assert.match(await game.act("use_first-morning"), /granary gate.*The lead is/s);
  assert.equal(zooOf(game.state).show?.kind, "window");
  assert.match(await game.act("use_ring-down"), /THE END.*bar tab/s);
  assert.equal(zooOf(game.state).show?.kind, "end");
  assert.equal(game.state.mode, "explore", "the zoo's End is a look at one: the visit carries on");
  // The lever goes round the approaches, and back to the game's own.
  placePlayer(game.state, "zoo-theatre", WINGS.find(w => w.id === "zoo-theatre")!.entry);
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) { await game.act("use_approach-lever"); seen.push(game.session.approach); }
  assert.deepEqual(seen, ["v2-straight", "actors", "v2-pressure", "v2"]);
  // Nothing played yet: nothing to hand on.
  assert.match(await game.act("use_boundary-desk"), /Nothing to hand on/);
  // A booth played, the desk hands it on (offline, the plain hand-off), with the zoo's fronts in the visit's own copy.
  const room = ROOMS.find(r => r.sceneId === "zoo-pie-stall")!;
  placePlayer(game.state, room.map, { x: room.door.x, y: room.door.y + 1 });
  await game.act(`walk@${room.door.x},${room.door.y - 1}`).catch(() => "");
  await game.endScene("bought");
  const said = await game.act("use_boundary-desk");
  assert.match(said, /The Last Pie \(Bought, fair and square\).*The hand-off: .*The next scene, The Noon Bell/s);
  assert.ok(readDoc(game.session.id, ZOO_FRONTS), "the zoo's fronts are in the visit's docs");
  assert.equal(seedDoc(ZOO_FRONTS), undefined, "and not in the authored lore");
});

test("a booth plays at its own hour and the zoo's clock comes back after; a lever puts you back too", async () => {
  const game = await newZoo({ seed: 22 });
  placePlayer(game.state, "zoo-hall", WINGS[0]!.entry);
  for (let i = 0; i < 3; i++) await game.act("use_clock-on");
  assert.equal(game.state.story.time, "night");
  const room = ROOMS.find(r => r.sceneId === "zoo-pie-stall")!;
  placePlayer(game.state, room.map, { x: room.door.x, y: room.door.y + 1 });
  await game.act(`walk@${room.door.x},${room.door.y - 1}`).catch(() => "");
  assert.equal(game.state.story.time, "afternoon", "the pie stall's own hour");
  await game.endScene("bought");
  assert.equal(game.state.story.time, "night", "the zoo's clock again");
  // Two Fireballs, then the gallery's lever: slots back.
  placePlayer(game.state, "zoo-fire", WINGS.find(w => w.id === "zoo-fire")!.entry);
  await game.act("use_fireball-scarecrow");
  await game.act("use_fire-reset");
  assert.match(game.session.rules?.status ?? "", /3rd 2\/2/);
});

test("the Works' hoist: the Hanged Clerk's own afterwards takes Prout away; the cone catches three straw men; coins join the purse", async () => {
  const game = await newZoo({ seed: 23 });
  const works = WINGS.find(w => w.id === "zoo-works")!;
  placePlayer(game.state, works.id, works.entry);
  assert.match(await game.act("use_run-afterwards"), /taken away/);
  assert.ok(wingWorld(game.state, works.id)!.entities.prout!.states.includes("gone"));
  assert.match(await game.act("use_cone-burning-hands"), /catching a straw man, a second straw man, a third straw man/);
  await game.act("use_take-shilling");
  const coins = (game.session.carried ?? []).filter(e => e.name === "shillings");
  assert.equal(coins.length, 1, "one stack of shillings");
  assert.equal(coins[0]!.quantity, 7);
});

test("the bump alley: each kind of wall's own line first, and a fence, a hedge or a window is never called a wall", async () => {
  const game = await newZoo({ seed: 24 });
  const annexe = WINGS.find(w => w.id === "zoo-annexe")!;
  placePlayer(game.state, annexe.id, annexe.entry);
  const said: Record<string, string> = {};
  for (const id of ["bump-palace", "bump-plaster", "bump-brick", "bump-timber", "bump-fence", "bump-hedge", "bump-window"]) said[id] = await game.act(`use_${id}`);
  assert.match(said["bump-palace"]!, /[Pp]alace/);
  assert.match(said["bump-plaster"]!, /plaster|front wall/i);
  assert.match(said["bump-brick"]!, /brick/i);
  for (const id of ["bump-fence", "bump-hedge", "bump-window"]) assert.doesNotMatch(said[id]!, /\bwall\b/i, `${id}: ${said[id]}`);
});

test("the action menu acts on a wing's own world: a Fireball at the scarecrow burns it there, plays as the zoo's news, and nothing goes in the town's overlay", async () => {
  const { actionMenu, aimAt } = await import("../town.ts");
  const game = await newZoo({ seed: 25 });
  placePlayer(game.state, "zoo-fire", { x: 30, y: 9 });
  // The menu's targets are the wing's own things and people.
  const fireball = actionMenu(game.state, game.session)?.sections.flatMap(s => s.entries).find(e => e.key === "spell:fireball");
  assert.ok(fireball && !fireball.why, `Fireball is on offer (${fireball?.why})`);
  const check = aimAt(game.state, game.session, "spell:fireball", { x: 36, y: 4 })!;
  assert.equal(check.ok, true, check.why ?? "");
  assert.match(check.target ?? "", /scarecrow/);
  const seq = zooOf(game.state).seq;
  const text = await game.act(check.id!);
  assert.match(text, /Fireball/);
  const world = wingWorld(game.state, "zoo-fire")!;
  assert.ok(world.entities.scarecrow!.states.some(s => ["burning", "destroyed", "burnt"].includes(s)), `the scarecrow burns in the wing's world (${world.entities.scarecrow!.states.join(", ")})`);
  const news = zooOf(game.state).news;
  assert.ok(news && news.seq > seq && news.map === "zoo-fire" && news.lines.some(l => /Fireball/.test(l)), "the zoo's news has it, for the map to play");
  assert.equal(exploreState(game.state).overlay.town?.["zoo-fire"], undefined, "the town's overlay isn't the zoo's");
  // Kept with the visit: a reload has the scarecrow as the Fireball left it.
  game.save();
  assert.deepEqual(wingWorld(loadZoo(game.state.id).state, "zoo-fire")!.entities.scarecrow!.states, world.entities.scarecrow!.states);
});

test("hidden in the zoo until you step out into the open; a use_ that isn't an exhibit's is the menu's", async () => {
  const game = await newZoo({ seed: 26 });
  const fire = wingOf("zoo-fire")!;
  placePlayer(game.state, fire.id, fire.entry);
  exploreState(game.state).hidden = true;
  assert.doesNotMatch(await game.act("look"), /plain sight/, "looking about doesn't show you");
  assert.equal(exploreState(game.state).hidden, true);
  assert.match(await game.act("walk_east"), /plain sight again/);
  assert.equal(exploreState(game.state).hidden, undefined);
  await assert.rejects(game.act("use_a-thing-nobody-has"), /Unavailable action: use_a-thing-nobody-has/);
});

test("a fight that breaks out in a wing is fought on its map, and its end is kept in the wing's world", async () => {
  const { aimAt } = await import("../town.ts");
  const game = await newZoo({ seed: 27 });
  const world = wingWorld(game.state, "zoo-fire")!;
  // A guard about, as the Works' delegate brings one: hurting someone in front of him starts a fight.
  world.entities["test-guard"] = { id: "test-guard", name: "a guard", kind: "person", parent: world.entities.porter!.parent, at: { x: 7 * 5 + 2.5, y: 15 * 5 + 2.5 }, tags: [], states: [], notes: [], stats: { statblock: "guard" } };
  placePlayer(game.state, "zoo-fire", { x: 9, y: 19 });
  const check = aimAt(game.state, game.session, "spell:fire-bolt", { x: 9, y: 15 })!;
  assert.equal(check.ok, true, check.why ?? "");
  const text = await game.act(check.id!);
  assert.match(text, /A guard comes at you/);
  assert.equal(game.state.mode, "combat");
  assert.equal(game.state.fightOnMap, true);
  for (let i = 0; i < 80 && !game.currentFight!.result(); i++) {
    const acts = game.currentFight!.actions();
    if (!acts.length) break;
    await game.act(acts.some(a => a.id === "auto") ? "auto" : "end_turn");
  }
  const result = game.currentFight!.result();
  assert.ok(result, "the fight ends");
  const after = await game.act("continue");
  assert.match(after, /^The fight: /);
  assert.equal(game.state.mode, "explore");
  assert.equal(game.state.fightOnMap, undefined);
  assert.equal(exploreState(game.state).map, "zoo-fire");
  const guard = result!.casualties.find(c => c.id === "test-guard");
  if (guard && guard.state !== "standing") assert.ok(world.entities["test-guard"]!.states.some(s => ["down", "gone", "cowering"].includes(s)), `the guard as the fight left him (${guard.state})`);
  assert.equal(exploreState(game.state).overlay.town?.["zoo-fire"], undefined, "kept in the wing's world, not the town's overlay");
});
