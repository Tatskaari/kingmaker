import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CONCEPT, MAX_LINE, MAX_NAME, MAX_STORY } from "../../../shared/protocol/refusals.ts";
import { all, hostWithCampaign, http, identity, madeCharacter, openedGame, sceneNow } from "../host/testing.ts";

/**
 * Every refusal a move makes (v0-design §3.4, v1-design §3.4), in the game's words, and that a
 * refused move writes nothing.
 */

const code = (refusal: { code: string } | undefined) => refusal?.code;

test("new_game: no such campaign, no such build (naming those there are), a name too long or missing, a concept too long", () => {
  const { host } = hostWithCampaign();
  const tamsin = identity(2);
  const game = (args: Partial<{ campaign: string; name: string; concept: string; build: string }>) => host.as(tamsin).newGame({ campaign: "caerwyn", name: "Tamsin", concept: "", build: "rogue", ...args });

  assert.deepEqual(game({ campaign: "nowhere" }), { code: "no_campaign", text: "(There's no campaign called nowhere here.)" });
  assert.deepEqual(game({ build: "bard" }), { code: "no_build", text: "(There's no ready-made build called bard: there's cleric, fighter, ranger, rogue and wizard.)" });
  assert.equal(code(game({ name: "   " })), "bad_name");
  assert.equal(code(game({ name: "x".repeat(MAX_NAME + 1) })), "bad_name");
  assert.deepEqual(game({ concept: "a rogue ".repeat(MAX_CONCEPT) }), { code: "bad_concept", text: "(Your character's concept needs to be 300 characters or fewer.)" });
  assert.deepEqual([all(host.db.game).length, all(host.db.player).length, all(host.db.seat).length], [0, 0, 0], "nothing written");
  assert.equal(game({ name: "x".repeat(MAX_NAME), concept: ` ${"x".repeat(MAX_CONCEPT)} `, campaign: "caerwyn@0.1.0" }), undefined, "300 characters of concept, trimmed, are fine");
  assert.equal(all(host.db.player)[0]!.concept, "x".repeat(MAX_CONCEPT));
});

test("say: not in a game; while the scene opens; a spectator's line; nothing said; too much said", async () => {
  const { host } = hostWithCampaign();
  const wren = identity(1), stranger = identity(9), tamsin = identity(2);

  assert.deepEqual(host.as(stranger).say({ text: "Hello" }), { code: "not_in_game", text: "(You're not in a game: start one, or watch someone's.)" });
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

test("say: a turn replying, or settling with a line waiting already; a failed turn; a scene that's over", async () => {
  const { host, script, wren, scene } = await openedGame();
  let whileReplying: unknown, waits: unknown, whileWaiting: unknown;
  script.then("reply", () => { whileReplying = host.as(wren).say({ text: "And?" }); return { entries: [{ speaker: "gm", kind: "narration", text: "Kell shrugs." }], gm: { repeated: null }, firstTextMs: 3, usage: { calls: 0, costUsd: 0, byOperation: {} } }; });
  script.then("settle", () => { waits = host.as(wren).say({ text: "And when?" }); whileWaiting = host.as(wren).say({ text: "And?" }); return http(400); });

  host.as(wren).say({ text: "Who found him?" });
  await host.drain();

  assert.deepEqual([code(whileReplying as never), code(waits as never), code(whileWaiting as never)], ["turn_in_flight", undefined, "turn_in_flight"]);
  assert.deepEqual(host.as(wren).say({ text: "Hello?" }), { code: "turn_failed", text: "(The GM lost the thread: /retry to carry on.)" });

  host.transact(tx => tx.db.scene.id.update({ ...tx.db.scene.id.find(scene.id)!, status: "ended", turnId: undefined }));
  assert.deepEqual(host.as(wren).say({ text: "Hello?" }), { code: "scene_over", text: "(The scene is over.)" });
});

test("say: an opening that failed is a failed turn: its lead is told to /retry it, a spectator who has the lead", async () => {
  const { host, script } = hostWithCampaign();
  const wren = identity(1), tamsin = identity(2);
  script.then("open", http(400));
  host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "", build: "ranger" });
  await host.drain();
  const scene = all(host.db.scene)[0]!;
  const opening = sceneNow(host, scene.id).turns[0]!;
  assert.deepEqual([scene.status, opening.n, opening.phase, scene.turnId], ["opening", 0, "failed", opening.id]);

  assert.deepEqual(host.as(wren).say({ text: "Hello?" }), { code: "turn_failed", text: "(The GM lost the thread: /retry to carry on.)" });
  host.as(tamsin).joinGame({ game: scene.gameId });
  assert.equal(code(host.as(tamsin).say({ text: "Hello?" })), "not_controller");
  assert.equal(sceneNow(host, scene.id).turns.length, 1, "nothing said");

  assert.equal(host.as(wren).retryTurn({ turn: opening.id }), undefined);
  await host.drain();
  assert.equal(host.db.scene.id.find(scene.id)!.status, "live");
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
  assert.deepEqual(host.as(wren).installCampaign({ id: "x@1", campaign: "{}", scenes: "[]", places: "[]", builds: "{}", looks: "{}", maps: "[]" }), { code: "not_admin", text: "Only the database's owner may install a campaign." });
});

test("start_creation: no such campaign, a name missing or too long, a concept too long, no such way to choose a build", () => {
  const { host } = hostWithCampaign();
  const tamsin = identity(2);
  const start = (args: Partial<{ campaign: string; name: string; concept: string; how: string }>) => host.as(tamsin).startCreation({ campaign: "caerwyn", name: "Tamsin", concept: "an auditor", how: "three", ...args });

  assert.equal(code(start({ campaign: "nowhere" })), "no_campaign");
  assert.equal(code(start({ name: " " })), "bad_name");
  assert.equal(code(start({ name: "x".repeat(MAX_NAME + 1) })), "bad_name");
  assert.deepEqual(start({ concept: "x".repeat(MAX_CONCEPT + 1) }), { code: "bad_concept", text: "(Your character's concept needs to be 300 characters or fewer.)" });
  assert.deepEqual(start({ how: "four" }), { code: "bad_how", text: "(That isn't a way to make a character: three, model, or own:<species>,<class>,<subclass>,<background>.)" });
  assert.equal(code(start({ how: "own:orc,rogue" })), "bad_how");
  assert.deepEqual([all(host.db.creation).length, all(host.db.job).length], [0, 0], "nothing written");
});

test("the creation's moves: not making one, the GM still at work, nothing to choose from or take, a story too big or too long, nothing to work in", async () => {
  const { host } = hostWithCampaign();
  const tamsin = identity(2);
  const as = host.as(tamsin);

  assert.deepEqual(as.chooseBuild({ index: 0 }), { code: "not_creating", text: "(You're not making a character: New game starts one.)" });
  assert.equal(code(as.setBackstory({ text: "x" })), "not_creating");
  assert.equal(code(as.chooseAgain()), "not_creating");

  as.startCreation({ campaign: "caerwyn", name: "Tamsin", concept: "an auditor", how: "three" });
  assert.deepEqual(as.chooseBuild({ index: 0 }), { code: "creation_busy", text: "(The GM is still working on it.)" });
  assert.equal(code(as.makeOwn({ from: 0 })), "creation_busy");
  await host.drain();

  assert.deepEqual(as.chooseBuild({ index: 3 }), { code: "not_offered", text: "(That isn't one of the builds on offer.)" });
  assert.deepEqual(as.takeProposal(), { code: "not_now", text: "(That doesn't apply just now.)" });
  for (const move of [as.leaveProposal, as.acceptFix, as.rewriteIssue, as.chooseAgain, as.takeOwn, as.skipBackstory]) assert.equal(code(move()), "not_now");
  assert.equal(code(as.finishBackstory({ text: "A story." })), "not_now", "no build chosen to make it from");
  assert.equal(code(as.pickOwn({ speciesId: "orc", classId: "rogue", backgroundId: "criminal" })), "not_now", "not making their own");

  as.chooseBuild({ index: 0 });
  const rev = host.view(tamsin).myCreation()!.rev;
  assert.deepEqual(as.setBackstory({ text: "x".repeat(MAX_STORY + 1) }), { code: "story_too_big", text: "(That's more than the box can keep.)" });
  assert.deepEqual(as.workInBackstory({ text: " \n " }), { code: "nothing_to_work_in", text: "There's nothing in the box to work in yet: write a few notes first, or Draft one." });
  const long = "word ".repeat(2001);
  assert.deepEqual(as.workInBackstory({ text: long }), { code: "story_too_long", text: "It's 2,001 words, and the GM reads all of it every turn: cut it to 2,000 or fewer." });
  assert.equal(code(as.finishBackstory({ text: long })), "story_too_long");
  assert.deepEqual([host.view(tamsin).myCreation()!.rev, host.view(tamsin).myCreation()!.story, all(host.db.job).length], [rev, "", 0], "nothing written");

  as.draftBackstory({ text: "" });
  assert.equal(code(as.finishBackstory({ text: "A story." })), "creation_busy");
  assert.equal(code(as.skipBackstory()), "creation_busy");
});

test("own: taking it while the engine is still making it", () => {
  const { host } = hostWithCampaign();
  const pell = identity(3);
  host.as(pell).startCreation({ campaign: "caerwyn", name: "Pell", concept: "a hedge-wizard", how: "own:gnome,wizard,evoker,sage" });
  assert.deepEqual(host.as(pell).takeOwn(), { code: "still_making", text: "(The rules engine is still making it.)" });
  assert.equal(code(host.as(pell).makeOwn({ from: 0 })), "creation_busy");
});

test("the games' moves: begin with no game or one already begun, a game that isn't theirs or doesn't exist, watching a game that hasn't begun", async () => {
  const { host } = hostWithCampaign();
  const tamsin = identity(2), stranger = identity(9);
  assert.deepEqual(host.as(tamsin).begin(), { code: "not_in_game", text: "(You're not in a game: start one, or watch someone's.)" });

  const { game } = await madeCharacter(host, tamsin);
  assert.deepEqual(host.as(stranger).joinGame({ game: game.id }), { code: "not_begun", text: "(That game hasn't begun: its player is still making their character.)" });
  assert.equal(code(host.as(tamsin).makeOwn({ from: 0 })), "not_creating", "made: only choose_again applies");
  assert.deepEqual(host.as(stranger).continueGame({ game: game.id }), { code: "not_yours", text: "(That isn't one of your games.)" });
  assert.equal(code(host.as(stranger).deleteGame({ game: game.id })), "not_yours");
  assert.equal(code(host.as(stranger).continueGame({ game: 404n })), "unknown");

  assert.equal(host.as(tamsin).begin(), undefined);
  assert.deepEqual(host.as(tamsin).begin(), { code: "already_begun", text: "(The story has already begun.)" });
  assert.equal(host.as(stranger).joinGame({ game: game.id }), undefined, "begun: there's something to watch");
});
