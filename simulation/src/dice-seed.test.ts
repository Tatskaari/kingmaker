import { test } from "node:test";
import assert from "node:assert/strict";
import { seedOf } from "./dice-seed.ts";
import { all, hostWithCampaign, identity } from "./host/testing.ts";

/**
 * The owner's fixed dice (dice-seed.ts) on the memory host, which runs set_dice_seed as the module
 * does: only the owner sets it; while it's set, each new game's seed is the seed and then one more a
 * game, whatever the host's own randomness, so two hosts rolling the same moves roll alike; none
 * gives the dice back to the host.
 */

const WREN = { campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "wizard" };
const TAMSIN = { ...WREN, name: "Tamsin Vell", concept: "a disgraced palace auditor" };

/** Each game's dice seed, in the order the games were made. */
const seeds = (host: ReturnType<typeof hostWithCampaign>["host"]) => all(host.db.game).map(g => host.db.dice.gameId.find(g.id)!.seed);

test("set_dice_seed is the owner's: a player's is refused in the game's words, and fixes nothing", () => {
  const { host } = hostWithCampaign();

  assert.deepEqual(host.as(identity(1)).setDiceSeed({ seed: 5 }), { code: "not_admin", text: "Only the database's owner may fix the dice." });
  assert.deepEqual(all(host.db.diceSeed), []);
});

test("while the owner has fixed the dice, the next game's seed is the seed, the one after it one more; set again, it starts again; none, and they're the host's again", () => {
  const { host } = hostWithCampaign();
  const [wren, tamsin] = [identity(1), identity(2)];

  assert.equal(host.as(host.owner).setDiceSeed({ seed: 1000 }), undefined);
  host.as(wren).newGame(WREN);
  host.as(tamsin).newGame(TAMSIN);
  assert.deepEqual(seeds(host), [1000, 1001]);
  assert.deepEqual(all(host.db.diceSeed), [{ id: 0, seed: 1000, given: 2 }]);

  host.as(host.owner).setDiceSeed({ seed: 999_999_999 });
  host.as(wren).newGame(WREN);
  host.as(tamsin).newGame(TAMSIN);
  assert.deepEqual(seeds(host).slice(2), [999_999_999, 0], "set again, from its seed; past the last seed, round to 0");

  assert.equal(host.as(host.owner).setDiceSeed({}), undefined);
  assert.deepEqual(all(host.db.diceSeed), []);
  assert.equal(host.transact(tx => seedOf(tx.db, () => 42)), 42, "the host's randomness again");
});

test("two hosts with randomness of their own roll the same moves alike once the owner has fixed the dice", () => {
  const cast = (own: number) => {
    const { host } = hostWithCampaign(own, { map: true });
    const wren = identity(1);
    host.as(host.owner).setDiceSeed({ seed: 4242 });
    host.as(wren).newGame(WREN);
    host.advance(1000);
    host.as(wren).walk({ to: { x: 22, y: 8 } });
    host.as(wren).cast({ spell: "fire-bolt", at: { x: 25, y: 6 } });
    const game = all(host.db.game)[0]!;
    return { dice: host.db.dice.gameId.find(game.id), said: host.db.explore.playerId.find(game.hostId)!.said };
  };

  const [one, two] = [cast(1), cast(2)];
  assert.equal(one.dice?.seed, 4242);
  assert.match(one.said, /^Cast Fire Bolt \(cantrip\) on the door of the watch house\nFire Bolt at the door of the watch house: \d+ \+5 = \d+ vs AC 15: /);
  assert.deepEqual(two, one);
});
