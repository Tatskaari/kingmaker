import { test } from "node:test";
import assert from "node:assert/strict";
import type { After, Decision, DecideResponse, OpenRequest, SettleResponse } from "../../../shared/protocol/ai.ts";
import { exploreOf } from "../../../shared/map/rows.ts";
import { actions } from "../../../shared/map/town.ts";
import { keysFor, rowsToWorld } from "../../../shared/world/rows.ts";
import { all, hostWithCampaign, identity, madeCharacter, sceneNow, type Scripted } from "../host/testing.ts";
import type { MemoryHost } from "../host/memory.ts";
import { mapRowsOf } from "./rows.ts";

/**
 * The simulation's half of the map (map-design §3.2-3.5, package S's done-when), on the memory host
 * with the campaign starting on its map: the lane in the morning with the yard built and its scene
 * waiting; walking or talking into it, which opens it as V1 opened it; a bump; a spectator following
 * in and back out; and the way out after the ending, the yard as play left it.
 */

const none = { calls: 0, costUsd: 0, byOperation: {} };
const decided = (d: Partial<Decision> = {}): DecideResponse => ({ decision: { earned: false, daft: false, outOfCharacter: false, ...d }, opened: [], usage: none });
const read = (a: Partial<After> = {}, ops: SettleResponse["ops"] = []): SettleResponse => ({ ops, after: { landed: [], hinted: [], unanswered: false, theirs: false, ...a }, usage: none });

/** A new game on the map: Wren in the lane, the game, and her explore row as it stands. */
function onMap(seed = 7) {
  const { host, script } = hostWithCampaign(seed, { map: true });
  const wren = identity(1);
  assert.equal(host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "ranger" }), undefined);
  const game = all(host.db.game)[0]!;
  const yard = () => all(host.db.scene).find(s => s.sceneKey === "hanged-clerk")!;
  return { host, script, wren, game, yard, explore: () => host.db.explore.playerId.find(game.hostId)!, wrenNow: () => host.db.player.id.find(game.hostId)! };
}

/** The ids the map offers from where the walker stands, made from the rows as a client makes them. */
function offered(host: MemoryHost, gameId: bigint): string[] {
  return host.transact(tx => {
    const game = tx.db.game.id.find(gameId)!;
    const rows = mapRowsOf(tx, game, tx.db.explore.playerId.find(game.hostId)!);
    return actions(exploreOf(rows), rows.unheard).map(a => a.id);
  });
}

/** The opening's request with its world as the AI service reads it (rowsToWorld): the same whatever the rows' ids. */
function asRead(request: OpenRequest) {
  return { ...request, world: rowsToWorld(request.world, keysFor(request.world.place.key, request.scene.key, request.pc)) };
}

test("a new game starts in the granary lane in the morning: the town's place, the yard built on the map with its people waiting, its scene waiting, nothing asked of the AI service", () => {
  const { host, script, wren, game, yard, explore, wrenNow } = onMap();

  const e = explore();
  assert.deepEqual([e.map, e.at, e.facing, e.steps, e.acts, e.said, e.scene], ["caerwyn", { x: 42, y: 9 }, { x: 0, y: 1 }, 0, 0, "", undefined]);
  assert.equal(host.db.game.id.find(game.id)!.leadScene, "hanged-clerk");

  const places = all(host.db.place);
  const town = places.find(p => p.key === "map:caerwyn")!;
  const yardPlace = places.find(p => p.key === "granary-yard")!;
  assert.deepEqual([town.mapKey, town.region, town.origin, town.active, town.sceneId], ["caerwyn", undefined, { x: 0, y: 0 }, true, undefined]);
  assert.deepEqual([yardPlace.mapKey, yardPlace.region, yardPlace.origin, yardPlace.active, yardPlace.sceneId], ["caerwyn", "granary-yard", { x: 40, y: 9 }, true, yard().id]);
  assert.deepEqual([yard().status, yard().placeId, yard().controllerId], ["waiting", yardPlace.id, wrenNow().id]);

  const there = [...host.db.entity.placeId.filter(yardPlace.id)].map(e => e.key);
  assert.ok(["kell", "cob", "moll", "granary-yard/prout"].every(k => there.includes(k)), "Kell, Cob and Moll waiting, Prout hanging");
  assert.ok(!there.some(k => k.startsWith("pc:")) && !all(host.db.playerCharacter).length, "nobody playing in it yet");

  assert.deepEqual([wrenNow().placeId, wrenNow().sceneId, wrenNow().characterId], [town.id, undefined, undefined]);
  assert.deepEqual(host.view(wren).mySeat(), { playerId: wrenNow().id, gameId: game.id, placeId: town.id, sceneId: undefined, role: "host" });
  assert.deepEqual(host.view(wren).myNames().map(n => [n.key, n.name]).sort(), [["cob", "the boy in the too-big boots"], ["kell", "Sergeant Agnes Kell"], ["moll", "the girl in the shawl"]]);
  assert.deepEqual(host.view(wren).myGames().map(g => [g.where, g.begun]), [["heading for The Hanged Clerk", true]]);

  assert.deepEqual([all(host.db.job).length, script.sent.length], [0, 0], "nothing is asked of the AI service until the scene opens");
  assert.equal(host.as(wren).say({ text: "Hello?" })?.code, "not_in_scene");
  assert.ok(offered(host, game.id).includes("go_to_lead") && offered(host, game.id).includes("talk_kell"), "the lead, and Kell to talk to");
});

test("walking toward the lead walks into the yard and opens the hanged clerk, as V1 opened it: the opening's request is the same", async () => {
  const { host, script, wren, yard, explore, wrenNow } = onMap();

  assert.equal(host.as(wren).walk({ toward: "lead" }), undefined);
  const e = explore();
  assert.equal(e.scene, "hanged-clerk");
  assert.deepEqual(e.at, { x: 42, y: 11 }, "where the yard's world starts her");
  assert.match(e.said, /^You walk \d+ steps? towards the granary yard\./);
  assert.deepEqual([yard().status, wrenNow().sceneId, wrenNow().placeId], ["opening", yard().id, yard().placeId]);
  assert.ok(wrenNow().characterId, "her character joined the yard");
  await host.drain();
  assert.equal(sceneNow(host, yard().id).scene.status, "live");

  const v1 = hostWithCampaign();
  v1.host.as(identity(1)).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "ranger" });
  await v1.host.drain();

  const [walked] = script.to("open"), [direct] = v1.script.to("open");
  const opened = asRead(walked!.body as OpenRequest);
  assert.equal(Object.keys(opened.world.entities)[4], "player", "her character where V1's opening puts it, after the place and its areas");
  assert.deepEqual(["kell", "pennies", "wren-longbow"].map(id => !!opened.world.entities[id]), [true, true, true], "the cast, and what she starts with");
  assert.deepEqual(opened, asRead(direct!.body as OpenRequest));
});

test("talking to Kell opens it too, the walk over and the word with her said", async () => {
  const { host, wren, yard, explore } = onMap();

  assert.equal(host.as(wren).interact({ verb: "talk", target: "kell" }), undefined);
  assert.equal(yard().status, "opening");
  assert.equal(explore().scene, "hanged-clerk");
  assert.match(explore().said, /You walk|You go over to Sergeant Agnes Kell/);
  assert.equal(host.as(wren).walk({ toward: "south" })?.code, "scene_on", "no walking off in the middle of a scene");
});

test("a step into a wall says a bump line and moves nothing; an id that isn't on offer is refused", () => {
  const { host, wren, game, explore } = onMap();
  const was = explore();

  const wall = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"].find(dir => !offered(host, game.id).includes(`walk_${dir}`));
  assert.ok(wall, "something in the way somewhere round the lane");
  // Walk up to the wall's side until a step goes nowhere.
  assert.equal(host.as(wren).walk({ toward: wall }), undefined);
  const bumped = explore();
  assert.deepEqual([bumped.at, bumped.steps, bumped.acts], [was.at, was.steps, was.acts + 1]);
  assert.ok(bumped.said.length > 0, "a line for the bump");
  assert.deepEqual(bumped.log, [bumped.said]);

  assert.equal(host.as(wren).interact({ verb: "talk", target: "nobody" })?.code, "unavailable");
  assert.equal(explore().acts, bumped.acts, "a refusal writes nothing");
});

test("along the wharf to the Heron: onto its map, the seats with her, and back along the wharves", () => {
  const { host, wren, game, explore, wrenNow } = onMap();
  const tam = identity(2);
  host.as(tam).joinGame({ game: game.id });
  const placeOf = (key: string) => all(host.db.place).find(p => p.key === key);

  assert.equal(host.as(wren).walk({ to: { x: 51, y: 38 } }), undefined);
  assert.equal(explore().map, "heron", explore().said);
  assert.match(explore().said, /Along the wharf to the Heron/);
  const heron = placeOf("map:heron")!;
  assert.deepEqual([heron.mapKey, heron.active, heron.origin], ["heron", true, { x: 0, y: 0 }]);
  assert.deepEqual([wrenNow().placeId, [...host.db.player.identity.filter(tam)][0]!.placeId], [heron.id, heron.id]);

  assert.equal(host.as(wren).travel({ way: "back_along_the_wharves" }), undefined);
  assert.deepEqual([explore().map, explore().at], ["caerwyn", { x: 50, y: 38 }]);
  assert.equal(wrenNow().placeId, placeOf("map:caerwyn")!.id);
});

test("a game a character was made for starts on the map at begin, and can be watched from there", async () => {
  const { host } = hostWithCampaign(7, { map: true });
  const tamsin = identity(3);
  const made = await madeCharacter(host, tamsin);
  assert.equal(host.as(identity(4)).joinGame({ game: made.game.id })?.code, "not_begun");

  assert.equal(host.as(tamsin).begin(), undefined);
  const row = host.db.explore.playerId.find(made.player.id)!;
  assert.deepEqual([row.map, row.at], ["caerwyn", { x: 42, y: 9 }]);
  assert.equal(all(host.db.scene).find(s => s.gameId === made.game.id)?.status, "waiting");
  assert.equal(host.view(tamsin).myCreation(), undefined, "the creation is done with");
  assert.equal(host.as(identity(4)).joinGame({ game: made.game.id }), undefined);
  assert.equal(host.as(tamsin).walk({ toward: "lead" }), undefined);
  assert.equal(all(host.db.scene).find(s => s.gameId === made.game.id)?.status, "opening");
});

test("a spectator follows the host onto the map, into the scene and back out, and can't walk", async () => {
  const { host, script, wren, game, yard, wrenNow } = onMap();
  const tam = identity(2);

  assert.equal(host.as(tam).joinGame({ game: game.id }), undefined);
  const tamNow = () => [...host.db.player.identity.filter(tam)][0]!;
  assert.deepEqual([tamNow().role, tamNow().placeId, tamNow().sceneId], ["spectator", wrenNow().placeId, undefined]);
  assert.equal(host.as(tam).walk({ toward: "lead" })?.code, "not_controller");

  host.as(wren).walk({ toward: "lead" });
  assert.deepEqual([tamNow().placeId, tamNow().sceneId], [yard().placeId, yard().id]);
  await host.drain();

  await endScene(host, script, wren);
  assert.equal(host.as(wren).walk({ toward: "out" }), undefined);
  const town = all(host.db.place).find(p => p.key === "map:caerwyn")!;
  assert.deepEqual([tamNow().placeId, tamNow().sceneId, wrenNow().placeId, wrenNow().sceneId], [town.id, undefined, town.id, undefined]);
});

test("walking out after the ending: where the scene left her, Kell beside her, free to leave the yard and locked out once she has, the yard as play left it", async () => {
  const { host, script, wren, game, yard, explore } = onMap();
  host.as(wren).walk({ toward: "lead" });
  await host.drain();
  assert.equal(host.as(wren).walk({ toward: "out" })?.code, "scene_on", "not while the scene's being played");

  // She drops her pennies in the yard as it ends.
  await endScene(host, script, wren, [{ op: "drop", what: "granary-yard/pennies", to: "", how: "", name: "", kind: "", text: "", add: [], remove: [] }]);
  assert.equal(yard().status, "ended");

  assert.equal(host.as(wren).walk({ toward: "out" }), undefined);
  const out = explore();
  assert.equal(out.scene, undefined);
  assert.deepEqual([out.map, out.log], ["caerwyn", []], "back on the map; what was said before the scene is old news");
  assert.ok(out.at.x >= 40 && out.at.x <= 46 && out.at.y >= 11 && out.at.y <= 16, `in the yard, where the scene left her (${out.at.x},${out.at.y})`);
  assert.deepEqual(out.followers.map(f => f.id), ["kell"], "Kell walks with her now");
  assert.equal(host.as(wren).walk({ toward: "out" })?.code, "unavailable", "she's out already");

  // The pennies lie where she dropped them, and she can pick them up again.
  assert.ok(offered(host, game.id).includes("take_pennies"), "the pennies on the cobbles");
  assert.equal(host.as(wren).interact({ verb: "take", target: "pennies" }), undefined);
  assert.match(explore().said, /You pick up 12 pennies\./);
  const pennies = [...host.db.entity.placeId.filter(yard().placeId)].find(e => e.key === "granary-yard/pennies")!;
  assert.equal(pennies.parentId, host.db.player.id.find(game.hostId)!.characterId, "back in her hands");

  // Out through the gate, and the yard's locked behind her: back through the gate, the step into the yard says so.
  assert.equal(host.as(wren).walk({ to: { x: 42, y: 8 } }), undefined);
  assert.deepEqual(explore().at, { x: 42, y: 8 });
  // The story has moved on (story-design §4.3): the Rat is the lead now, a walk away down the river stairs.
  assert.equal(host.db.game.id.find(game.id)!.leadScene, "drowned-rat");
  for (const y of [9, 10]) {
    host.as(wren).walk({ toward: "south" });
    assert.deepEqual(explore().at, { x: 42, y }, "down the lane to the gate");
  }
  assert.equal(host.as(wren).walk({ toward: "south" }), undefined);
  assert.deepEqual(explore().at, { x: 42, y: 10 }, "she can't walk back in");
  assert.match(explore().said, /The yard's been locked up for the Assembly/);
});

/** The scene ended through its exit as the player chooses it: closing on one line, its wind-down the next. `ops`: what the first line's settle does to the yard. */
async function endScene(host: MemoryHost, script: ReturnType<typeof hostWithCampaign>["script"], who: ReturnType<typeof identity>, ops: SettleResponse["ops"] = []) {
  const line = async (text: string, settle?: Scripted) => {
    script.then("decide", decided());
    if (settle) script.then("settle", settle);
    assert.equal(host.as(who).say({ text }), undefined, `"${text}" was refused`);
    await host.drain();
  };
  await line("I'll take the page to the King myself.", read({ ending: { exitId: "case-made", probability: 0.9 }, theirs: true }, ops));
  await line("Thank you, Sergeant.");
}
