import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_LINE, MAX_NAME } from "../../../shared/protocol/refusals.ts";
import { all, hostWithCampaign, http, identity, openedGame, sceneNow } from "../host/testing.ts";

/**
 * Every refusal a move makes (v0-design §3.4), in the game's words, and that a refused move writes
 * nothing.
 */

const code = (refusal: { code: string } | undefined) => refusal?.code;

test("new_game: no such campaign, no such build (naming those there are), a name too long or missing", () => {
  const { host } = hostWithCampaign();
  const tamsin = identity(2);
  const game = (args: Partial<{ campaign: string; name: string; build: string }>) => host.as(tamsin).newGame({ campaign: "caerwyn", name: "Tamsin", concept: "", build: "rogue", ...args });

  assert.deepEqual(game({ campaign: "nowhere" }), { code: "no_campaign", text: "(There's no campaign called nowhere here.)" });
  assert.deepEqual(game({ build: "bard" }), { code: "no_build", text: "(There's no ready-made build called bard: there's cleric, fighter, ranger, rogue and wizard.)" });
  assert.equal(code(game({ name: "   " })), "bad_name");
  assert.equal(code(game({ name: "x".repeat(MAX_NAME + 1) })), "bad_name");
  assert.deepEqual([all(host.db.game).length, all(host.db.player).length, all(host.db.seat).length], [0, 0, 0], "nothing written");
  assert.equal(game({ name: "x".repeat(MAX_NAME), campaign: "caerwyn@0.1.0" }), undefined);
});

test("say: not in a game; while the scene opens; a spectator's line; nothing said; too much said", async () => {
  const { host } = hostWithCampaign();
  const wren = identity(1), stranger = identity(9), tamsin = identity(2);

  assert.deepEqual(host.as(stranger).say({ text: "Hello" }), { code: "not_in_game", text: "(You're not in a game: start one with --new, or watch one with --join.)" });
  host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "", build: "ranger" });
  assert.deepEqual(host.as(wren).say({ text: "Hello" }), { code: "not_ready", text: "(The scene is still opening.)" });
  await host.drain();

  const game = all(host.db.game)[0]!;
  assert.equal(host.as(tamsin).joinGame({ game: game.id }), undefined);
  assert.deepEqual(host.as(tamsin).say({ text: "Me too!" }), { code: "not_controller", text: "(Wren Ashdown has the lead here: you're watching.)" });
  assert.equal(code(host.as(wren).say({ text: "  \n " })), "empty_line");
  assert.deepEqual(host.as(wren).say({ text: "x".repeat(MAX_LINE + 1) }), { code: "too_long", text: "(That's too much for one turn: 2,000 characters at most.)" });
  assert.equal(host.as(wren).say({ text: ` ${"x".repeat(MAX_LINE)} ` }), undefined, "2,000 characters, trimmed, are fine");
  assert.equal(sceneNow(host, all(host.db.scene)[0]!.id).turns.length, 2);
});

test("say: a turn deciding or replying; a failed turn; a scene that's over", async () => {
  const { host, script, wren, scene } = await openedGame();
  let whileDeciding: unknown, whileReplying: unknown;
  script.then("decide", () => { whileDeciding = host.as(wren).say({ text: "And?" }); return { decision: { earned: false, daft: false, outOfCharacter: false }, opened: [], usage: { calls: 0, costUsd: 0, byOperation: {} } }; });
  script.then("reply", () => { whileReplying = host.as(wren).say({ text: "And?" }); return http(400); });

  host.as(wren).say({ text: "Who found him?" });
  await host.drain();

  assert.deepEqual([code(whileDeciding as never), code(whileReplying as never)], ["turn_in_flight", "turn_in_flight"]);
  assert.deepEqual(host.as(wren).say({ text: "Hello?" }), { code: "turn_failed", text: "(The GM lost the thread: /retry to carry on.)" });

  host.transact(tx => tx.db.scene.id.update({ ...tx.db.scene.id.find(scene.id)!, status: "ended", turnId: undefined }));
  assert.deepEqual(host.as(wren).say({ text: "Hello?" }), { code: "scene_over", text: "(The scene is over.)" });
});

test("retry_turn: not in a game, no such turn, not the lead, a turn that hasn't failed", async () => {
  const { host, wren, scene } = await openedGame();
  const tamsin = identity(2);
  const turn0 = sceneNow(host, scene.id).turns[0]!;

  assert.equal(code(host.as(tamsin).retryTurn({ turn: turn0.id })), "not_in_game");
  host.as(tamsin).joinGame({ game: scene.gameId });
  assert.equal(code(host.as(tamsin).retryTurn({ turn: turn0.id })), "not_controller");
  assert.deepEqual(host.as(wren).retryTurn({ turn: 999n }), { code: "unknown", text: "(There's no such turn.)" });
  assert.deepEqual(host.as(wren).retryTurn({ turn: turn0.id }), { code: "not_failed", text: "(That turn hasn't failed: there's nothing to retry.)" });
});

test("join_game: no such game; a spectator watches the host's scene with no character; the host joining gets their lead back", async () => {
  const { host, wren, scene, player } = await openedGame();
  const tamsin = identity(2);

  assert.deepEqual(host.as(tamsin).joinGame({ game: 77n }), { code: "unknown", text: "(There's no such game here.)" });
  assert.equal(host.as(tamsin).joinGame({ game: scene.gameId }), undefined);
  const spectator = host.view(tamsin).mySeat()!;
  assert.deepEqual([spectator.role, spectator.sceneId, spectator.placeId], ["spectator", scene.id, scene.placeId]);
  assert.equal(host.db.player.id.find(spectator.playerId)!.characterId, undefined);
  assert.deepEqual(host.view(tamsin).myNames(), host.view(wren).myNames(), "names as the controller knows them");

  assert.equal(host.as(tamsin).joinGame({ game: scene.gameId }), undefined);
  assert.equal(all(host.db.player).length, 2, "joining again seats the same spectator");
  assert.equal(host.as(wren).joinGame({ game: scene.gameId }), undefined);
  assert.equal(host.view(wren).mySeat()!.playerId, player.id);

  assert.equal(host.as(tamsin).newGame({ campaign: "caerwyn", name: "Tamsin Vell", concept: "", build: "rogue" }), undefined);
  assert.deepEqual(all(host.db.player).filter(p => p.identity.isEqual(tamsin)).map(p => [p.role, p.online]), [["spectator", false], ["host", true]], "a seat taken elsewhere leaves the old player offline");
});

test("stream_reply and install_campaign: only their callers", async () => {
  const { host, wren } = await openedGame();
  assert.equal(code(host.streamReply({ turnId: 1n, attempt: 1, seq: 1, speaker: "gm", text: "x", done: false }, wren)), "not_service");
  assert.deepEqual(host.as(wren).installCampaign({ id: "x@1", campaign: "{}", scenes: "[]", places: "[]", builds: "{}", looks: "{}" }), { code: "not_admin", text: "Only the database's owner may install a campaign." });
});
