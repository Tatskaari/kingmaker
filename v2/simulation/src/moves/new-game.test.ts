import { test } from "node:test";
import assert from "node:assert/strict";
import { Identity } from "spacetimedb";
import { idempotencyKey, isGameId, keyParts } from "../../../shared/protocol/keys.ts";
import { memoryHost } from "../host/memory.ts";
import { all, caerwynArgs, identity, scriptedAi } from "../host/testing.ts";

/**
 * A game's uid (games/create.ts gameUid): unique by construction, never by chance. SpacetimeDB 2.12's
 * generator gives about 3% of transactions one uuid, this one (v0-design §14), and new_game took it
 * whole for a uid that must be unique: a game made with it once, the next panicked.
 */

const SINK = "00fffffc-6218-4f1b-a283-f850e4929bf0";
/** Two databases' identities, as SpacetimeDB makes them: c200, then a hash. */
const ONE = new Identity("c200094661adbe7391691c07f5219b69a2d5bfa96837702674466aac4e567abc");
const ANOTHER = new Identity("c20012516e9c8d38779fddd20dcb25d257ede728f4cc381a928639e09c5f4ffd");

/** A memory host with the campaign in, as one database; its uuids come from `uuid`. */
function database(options: { uuid?: () => string; database?: Identity } = {}) {
  const host = memoryHost({ ai: scriptedAi().ai, ...options });
  assert.equal(host.as(host.owner).installCampaign(caerwynArgs()), undefined);
  return host;
}

const newGame = (host: ReturnType<typeof database>, n: number) =>
  host.as(identity(n)).newGame({ campaign: "caerwyn", name: `Player ${n}`, concept: "a hedge wizard", build: "wizard" });

test("new_game survives a uuid that repeats: three games in the same microsecond, each with its own uid", () => {
  const host = database({ uuid: () => SINK, database: ONE });

  for (const n of [1, 2, 3]) assert.equal(newGame(host, n), undefined);

  const games = all(host.db.game);
  const uids = games.map(g => g.uid);
  assert.equal(new Set(uids).size, 3);
  assert.deepEqual(games.map(g => g.createdAt.microsSinceUnixEpoch), Array(3).fill(host.now().microsSinceUnixEpoch), "the clock didn't move");
  for (const game of games) {
    assert.equal(game.uid, `g${game.id}-${host.now().microsSinceUnixEpoch.toString(36)}-094661adbe73-00fffffc`);
    assert.ok(isGameId(game.uid), `${game.uid} is a game's id as the AI service takes it`);
    assert.equal(keyParts(idempotencyKey(game.uid, 1n, 3, "reply"))?.game, game.uid);
  }
  assert.deepEqual(all(host.db.scene).map(s => s.status), ["opening", "opening", "opening"]);
});

test("a game's uid is no other database's: another database, or this one's data deleted and started again", () => {
  const first = database({ uuid: () => SINK, database: ONE });
  const other = database({ uuid: () => SINK, database: ANOTHER });
  const again = database({ uuid: () => SINK, database: ONE });
  again.advance(60_000);

  for (const host of [first, other, again]) assert.equal(newGame(host, 1), undefined);

  const [a, b, c] = [first, other, again].map(host => all(host.db.game)[0]!);
  assert.deepEqual([a!.id, b!.id, c!.id], [1n, 1n, 1n], "game 1 in each");
  assert.equal(new Set([a!.uid, b!.uid, c!.uid]).size, 3, `${a!.uid}, ${b!.uid}, ${c!.uid}`);
});

test("the uid is in every request and key of the game's", async () => {
  const script = scriptedAi();
  const host = memoryHost({ ai: script.ai });
  host.as(host.owner).installCampaign(caerwynArgs());
  newGame(host, 1);
  await host.drain();

  const game = all(host.db.game)[0]!;
  assert.match(game.uid, /^g1-[0-9a-z]+-[0-9a-f]{12}-[0-9a-f]{8}$/);
  const [open] = script.to("open");
  assert.equal(keyParts(open!.key)?.game, game.uid);
  assert.equal(open!.body.game.id, game.uid);
});
