import { test } from "node:test";
import assert from "node:assert/strict";
import type { OpenRequest } from "../../../shared/protocol/ai.ts";
import type { MemoryHost } from "../host/memory.ts";
import { all, hostWithCampaign, identity, madeCharacter, sceneNow, traitsOf } from "../host/testing.ts";
import { TABLES } from "../tables.ts";

/**
 * A made game, set off in, continued and deleted (v1-design §3.2-3.3, §3.5), on the memory host:
 * choose_again puts the made game away whole, begin opens the first scene as the prototype's
 * opening does, and delete_game leaves no row of the game in any table.
 */

/** How many rows each table has: a game's rows all gone puts every count back. */
const counts = (host: MemoryHost) => Object.fromEntries(Object.keys(TABLES).map(t => [t, Number((host.db as unknown as Record<string, { count(): bigint }>)[t]!.count())]));

test("choose again: the made game put away with every row of it, back at the three builds with the backstory kept", async () => {
  const { host } = hostWithCampaign();
  const tamsin = identity(1);
  const before = counts(host);
  const { creation, game } = await madeCharacter(host, tamsin, { story: "I kept ledgers." });

  assert.equal(host.as(tamsin).chooseAgain(), undefined);

  const again = host.view(tamsin).myCreation()!;
  assert.deepEqual([again.step, again.gameId, again.uid, again.story, again.backstory], ["choose", undefined, creation.uid, "I kept ledgers.", undefined]);
  assert.equal(host.db.game.id.find(game.id), null);
  assert.deepEqual({ ...counts(host), creation: 0 }, { ...before, creation: 0 }, "no row of the made game in any table");
  assert.equal(host.view(tamsin).mySeat(), undefined);
  assert.deepEqual(host.view(tamsin).myGames(), []);

  host.as(tamsin).chooseBuild({ index: 2 });
  host.as(tamsin).skipBackstory();
  const remade = host.view(tamsin).myCreation()!;
  assert.equal(host.db.game.id.find(remade.gameId!)!.uid, creation.uid, "made again under the same uid");
  assert.equal(host.db.sheet.playerId.find(host.db.game.id.find(remade.gameId!)!.hostId)!.build, "human fighter 3 (Champion), soldier background");
});

test("begin: the first scene opens with the character's purse and gear, coming to drawing the dice's first roll; the creation is done with", async () => {
  const { host, script } = hostWithCampaign();
  const tamsin = identity(1);
  const { game, player } = await madeCharacter(host, tamsin, { story: "I'm the King's nephew." });

  assert.equal(host.as(tamsin).begin(), undefined);

  const scene = all(host.db.scene)[0]!;
  assert.deepEqual([scene.gameId, scene.sceneKey, scene.status, scene.controllerId], [game.id, "hanged-clerk", "opening", player.id]);
  assert.equal(host.db.dice.gameId.find(game.id)!.rolls, 1, "coming to draws one roll, so the first check is the seed's second");
  assert.equal(host.view(tamsin).myCreation(), undefined);
  assert.ok(host.db.player.id.find(player.id)!.lastPlayedAt.microsSinceUnixEpoch >= player.lastPlayedAt.microsSinceUnixEpoch);
  const held = [...host.db.entity.placeId.filter(scene.placeId)].filter(e => e.parentId === host.db.player.id.find(player.id)!.characterId).map(e => e.name);
  assert.deepEqual(held, ["silver crowns", "shillings", "pennies", "Tamsin's rapier", "Tamsin's shortbow", "Tamsin's dagger", "Tamsin's leather armor"]);
  assert.deepEqual(JSON.parse(host.db.sheet.playerId.find(player.id)!.pockets).purse.map((p: { name: string }) => p.name), ["silver crowns", "shillings", "pennies"], "the purse read from the world now");
  assert.match(host.logs.join("\n"), /\[rules\] begin \d+ ms/);

  await host.drain();
  const opening = script.to("open")[0]!.body as OpenRequest;
  assert.deepEqual(opening.party[0]!.backstory, traitsOf("I'm the King's nephew."), "the GM is told who they are");
  assert.equal(sceneNow(host, scene.id).scene.status, "live");
  assert.deepEqual(host.as(tamsin).begin(), { code: "already_begun", text: "(The story has already begun.)" });
});

test("continue: the caller's seat moves to their character in another of their games; never to someone else's", async () => {
  const { host } = hostWithCampaign();
  const tamsin = identity(1), pell = identity(2);
  const first = await madeCharacter(host, tamsin, { name: "Tamsin Vell" });
  host.as(tamsin).begin();
  const second = await madeCharacter(host, tamsin, { name: "Tamsin's Sister" });
  const pells = await madeCharacter(host, pell, { name: "Pell Marrow" });
  assert.equal(host.view(tamsin).mySeat()!.gameId, second.game.id);

  assert.equal(host.as(tamsin).continueGame({ game: first.game.id }), undefined);
  assert.deepEqual([host.view(tamsin).mySeat()!.gameId, host.view(tamsin).mySeat()!.playerId], [first.game.id, first.player.id]);
  assert.deepEqual(host.as(tamsin).continueGame({ game: pells.game.id }), { code: "not_yours", text: "(That isn't one of your games.)" });
  assert.deepEqual(host.as(tamsin).continueGame({ game: 99n }), { code: "unknown", text: "(There's no such game here.)" });
});

test("delete: every row of the game, in every table, the seats on it and the jobs in flight included; another's game untouched", async () => {
  const { host } = hostWithCampaign();
  const tamsin = identity(1), wren = identity(2), watcher = identity(3);
  host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "", build: "wizard" });
  await host.drain();
  const before = counts(host);

  const { game } = await madeCharacter(host, tamsin);
  host.as(tamsin).begin();
  await host.drain();
  host.as(watcher).joinGame({ game: game.id });
  host.as(tamsin).say({ text: "Sergeant, who found him?" });
  await host.drain();
  host.as(tamsin).say({ text: "And when?" });
  assert.ok(all(host.db.job).some(j => j.gameId === game.id), "a turn in flight");

  assert.deepEqual(host.as(wren).deleteGame({ game: game.id }), { code: "not_yours", text: "(That isn't one of your games.)" });
  assert.deepEqual(host.as(watcher).deleteGame({ game: game.id }), { code: "not_yours", text: "(That isn't one of your games.)" }, "a spectator can't");
  assert.equal(host.as(tamsin).deleteGame({ game: game.id }), undefined);

  assert.deepEqual({ ...counts(host), creation: 0 }, { ...before, creation: 0 }, "every count back where it was");
  assert.deepEqual([host.view(tamsin).mySeat(), host.view(watcher).mySeat(), host.view(tamsin).myCreation()], [undefined, undefined, undefined]);
  await host.drain();
  assert.equal(host.view(wren).mySeat()!.gameId !== game.id, true);
  assert.deepEqual(host.as(tamsin).deleteGame({ game: game.id }), { code: "unknown", text: "(There's no such game here.)" });
});

test("delete a made game not yet begun: the creation that made it goes too", async () => {
  const { host } = hostWithCampaign();
  const tamsin = identity(1);
  const { game } = await madeCharacter(host, tamsin);
  assert.equal(host.as(tamsin).deleteGame({ game: game.id }), undefined);
  assert.equal(host.view(tamsin).myCreation(), undefined);
  assert.deepEqual(all(host.db.player), []);
});

test("my_games: each of the caller's games as the title lists it, newest first, before begin, in a scene, and over", async () => {
  const { host } = hostWithCampaign();
  const tamsin = identity(1);
  const ended = await madeCharacter(host, tamsin, { name: "Tamsin Vell" });
  host.as(tamsin).begin();
  await host.drain();
  host.transact(tx => {
    const scene = [...tx.db.scene.gameId.filter(ended.game.id)][0]!;
    tx.db.scene.id.update({ ...scene, status: "ended" });
  });
  host.advance(60_000);
  const playing = await madeCharacter(host, tamsin, { name: "Odo" });
  host.as(tamsin).begin();
  host.advance(60_000);
  const heading = await madeCharacter(host, tamsin, { name: "Pell Marrow" });

  const games = host.view(tamsin).myGames();
  assert.deepEqual(games.map(g => [g.gameId, g.name, g.time, g.where, g.begun]), [
    [heading.game.id, "Pell Marrow", "morning", "heading for The Hanged Clerk", false],
    [playing.game.id, "Odo", "morning", "in The Hanged Clerk", true],
    [ended.game.id, "Tamsin Vell", "morning", "The Hanged Clerk, over", true],
  ]);
  assert.ok(games.every(g => /^This morning a palace clerk, Wendell Prout/.test(g.hook)));
  assert.deepEqual(host.view(identity(9)).myGames(), []);
});
