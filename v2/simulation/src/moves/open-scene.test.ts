import { test } from "node:test";
import assert from "node:assert/strict";
import type { OpenRequest } from "../../../shared/protocol/ai.ts";
import { keyParts } from "../../../shared/protocol/keys.ts";
import { all, hostWithCampaign, identity, sceneNow } from "../host/testing.ts";

/** new_game, the opening's job, and its commit (v0-design §4.3, §10.1), on the memory host. */

test("new_game makes the game, opens the scene in its place and queues the opening's think", () => {
  const { host } = hostWithCampaign();
  const wren = identity(1);

  assert.equal(host.as(wren).newGame({ campaign: "caerwyn", name: "  Wren Ashdown ", concept: "a hedge wizard from the fens", build: "ranger" }), undefined);

  const game = all(host.db.game)[0]!;
  const player = all(host.db.player)[0]!;
  const scene = all(host.db.scene)[0]!;
  assert.deepEqual([game.campaign, game.campaignVersion, game.title, game.time, game.day, game.hostId], ["caerwyn", "0.1.0", "Caerwyn", "morning", 1, player.id]);
  assert.deepEqual([player.name, player.role, player.sceneId, player.placeId, player.online], ["Wren Ashdown", "host", scene.id, scene.placeId, true]);
  assert.equal(host.db.seat.identity.find(wren)?.playerId, player.id);
  assert.equal(host.db.sheet.playerId.find(player.id)?.build, "elf ranger 3 (Hunter), soldier background");
  assert.ok(host.db.dice.gameId.find(game.id)!.seed > 0);

  const now = sceneNow(host, scene.id);
  assert.deepEqual([scene.sceneKey, scene.title, scene.status, scene.controllerId, scene.turns], ["hanged-clerk", "The Hanged Clerk", "opening", player.id, 0]);
  assert.match(scene.hook, /Wendell Prout/);
  assert.deepEqual(now.turns.map(t => [t.n, t.phase]), [[0, "replying"]]);
  assert.equal(scene.turnId, now.turns[0]!.id);
  assert.deepEqual(now.gm.beat, "yard");
  assert.deepEqual(now.jobs.map(j => [j.move, j.step, j.state, j.endpoint]), [["openScene", "open", "queued", "/v1/scenes/open"]]);
  assert.equal(all(host.db.jobDispatch).length, 1);
});

test("the opening's place: the yard built, the cast present, the character with the campaign's purse and the build's gear", () => {
  const { host } = hostWithCampaign();
  host.as(identity(1)).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard", build: "ranger" });
  const scene = all(host.db.scene)[0]!;
  const player = host.db.player.id.find(scene.controllerId)!;
  const entities = [...host.db.entity.placeId.filter(scene.placeId)].sort((a, b) => a.ord - b.ord);
  const key = (k: string) => entities.find(e => e.key === k);

  assert.equal(host.db.place.id.find(scene.placeId)?.rootId, key("granary-yard")!.id);
  assert.equal(host.db.place.id.find(scene.placeId)?.sceneId, scene.id);
  assert.deepEqual(entities.slice(0, 5).map(e => e.key), ["granary-yard", "granary-yard/lane", "granary-yard/yard", "granary-yard/loft", `pc:${player.id}`]);
  assert.equal(player.characterId, key(`pc:${player.id}`)!.id);
  assert.deepEqual(entities.map(e => e.ord), entities.map((_, i) => i + 1));
  assert.deepEqual(["kell", "cob", "moll"].map(k => key(k)?.called), [undefined, "the boy in the too-big boots", "the girl in the shawl"]);
  assert.equal(key("tull"), undefined, "Tull comes with the dead-cart");

  const held = entities.filter(e => e.parentId === player.characterId).map(e => e.name);
  assert.deepEqual(held, ["silver crowns", "shillings", "pennies", "Wren's longbow", "Wren's shortsword", "Wren's studded leather"]);
  assert.deepEqual([...host.db.gear.placeId.filter(scene.placeId)].map(g => g.engineItem).sort(), ["longbow", "shortsword", "studded-leather"]);
  assert.equal([...host.db.playerCharacter.placeId.filter(scene.placeId)][0]?.playerId, player.id);
  assert.match([...host.db.worldLog.placeId.filter(scene.placeId)].map(l => l.text).join("\n"), /Wren Ashdown now has 12 pennies/);
});

test("the stage: the controller's character and the cast present, with their looks; names as the hook and the cards let them be known", () => {
  const { host } = hostWithCampaign();
  const wren = identity(1);
  host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard", build: "ranger" });
  const scene = all(host.db.scene)[0]!;
  const entity = (id: bigint) => host.db.entity.id.find(id)!;

  const stage = [...host.db.onStage.sceneId.filter(scene.id)].map(s => [entity(s.entityId).key, s.role]);
  assert.deepEqual(stage.sort(), [["cob", "cast"], ["kell", "cast"], ["moll", "cast"], [`pc:${scene.controllerId}`, "controller"]]);
  assert.deepEqual(all(host.db.look).map(l => [entity(l.entityId).key, l.glyph, l.fg]).sort(), [["cob", "c", "#e8b15a"], ["kell", "K", "#6d9eeb"], ["moll", "m", "#e07ab0"]]);
  assert.deepEqual(all(host.db.heard).map(h => h.entityKey), ["kell"], "someone with no `called` is known; Cob, Moll and Tull go by what they look like until they're named");

  const names = host.view(wren).myNames().map(n => [n.key, n.name]).sort();
  assert.deepEqual(names, [["cob", "the boy in the too-big boots"], ["kell", "Sergeant Agnes Kell"], ["moll", "the girl in the shawl"]]);
  assert.deepEqual(host.view(wren).mySeat(), { playerId: scene.controllerId, gameId: scene.gameId, placeId: scene.placeId, sceneId: scene.id, role: "host" });
});

test("the opening's request: its key, the working set as the transaction saw it, the stream's turn", async () => {
  const { host, script } = hostWithCampaign();
  host.as(identity(1)).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard", build: "ranger" });
  await host.drain();

  const [sent] = script.to("open");
  const request = sent!.body as OpenRequest;
  const game = all(host.db.game)[0]!, scene = all(host.db.scene)[0]!, turn0 = sceneNow(host, scene.id).turns[0]!;
  assert.deepEqual(keyParts(request.key), { game: game.uid, scene: String(scene.id), turn: 0, step: "open" });
  assert.equal(sent!.attempt, "1");
  assert.deepEqual(request.game, { id: game.uid, campaign: "caerwyn", version: "0.1.0" });
  assert.deepEqual(request.player, { id: String(scene.controllerId), name: "Wren Ashdown" });
  assert.deepEqual(request.scene, { id: String(scene.id), key: "hanged-clerk", kind: "scene" });
  assert.equal(request.pc, `pc:${scene.controllerId}`);
  assert.equal(request.stream.turn, String(turn0.id));
  assert.equal(request.gm.beat, "yard");
  assert.equal(request.party[0]!.status, "HP 28/28, spell slots 1st 3/3");
  assert.equal(request.party[0]!.skills.perception, 4);
  assert.deepEqual(request.story, { time: "morning", day: 1, flags: {} });
  assert.equal(request.world.place.key, "granary-yard");
  assert.equal(request.world.entity.length, [...host.db.entity.placeId.filter(scene.placeId)].length);
  assert.ok(request.world.worldLog.length <= 6, "the log's last six");
});

test("the opening's commit: the GM's entry, the draft gone, the scene live, turn 0 done with its cost, the lease released", async () => {
  const { host, script } = hostWithCampaign();
  const wren = identity(1);
  host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard", build: "ranger" });
  script.then("open", (request: OpenRequest) => {
    host.streamReply({ turnId: BigInt(request.stream.turn), attempt: 1, seq: 1, speaker: "gm", text: "Sergeant Kell", done: false });
    return { present: ["kell", "cob", "moll"], entries: [{ speaker: "gm", kind: "narration", text: "Sergeant Kell looks up. A boy is lobbing stones at the body: \"Cob, stop that.\"", markup: { speech: [{ start: 40, end: 54, tag: "Kell" }], marks: [] } }], opened: [{ path: "Cast/Kell.md", title: "Kell", scope: "character:kell", turn: 0, p: 0.95 }], usage: { calls: 3, costUsd: 0.0021, byOperation: {} } };
  });
  await host.drain();

  const scene = all(host.db.scene)[0]!;
  const now = sceneNow(host, scene.id);
  assert.equal(now.scene.status, "live");
  assert.equal(now.scene.turnId, undefined);
  assert.deepEqual(now.turns.map(t => [t.n, t.phase, t.calls, t.costMicros]), [[0, "done", 3 + 1 + 2, 2100n + 200n + 800n]], "the opening's calls, then its notes' and its lines'");
  assert.ok(now.turns[0]!.firstTextAt, "the stream set the first text's time");
  assert.deepEqual(now.lines.map(l => [l.seq, l.turn, l.speaker, l.kind]), [[1, 0, "gm", "narration"]]);
  assert.deepEqual(JSON.parse(now.lines[0]!.markup!), { speech: [{ start: 40, end: 54, tag: "Kell" }], marks: [] });
  assert.equal(all(host.db.replyDraft).length, 0);
  assert.deepEqual(now.gm.opened, [{ path: "Cast/Kell.md", title: "Kell", scope: "character:kell", turn: 0 }]);
  assert.deepEqual(all(host.db.job), [], "the move is done");
  assert.ok(all(host.db.heard).some(h => h.entityKey === "cob"), "Cob's name was said in the opening");
  assert.match(host.logs.join("\n"), /\[job \d+ .+:s\d+:t0:open attempt 1\] 200 in \d+ ms: committed/);
});
