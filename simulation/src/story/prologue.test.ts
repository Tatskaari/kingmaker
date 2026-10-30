import { test } from "node:test";
import assert from "node:assert/strict";
import { all, hostWithCampaign, identity } from "../host/testing.ts";

/**
 * The prologue on the King's Road (campaigns/caerwyn as it is: `prologue`), on the memory host with
 * the AI service scripted: the first scene comes to the player as the game begins (a scene's
 * `summons`, docs/scene-format.md), open on the cart on the road's own map; its ending leaves the
 * toll bridge waiting a walk along the road; the bridge's ending brings the King's thanks to the
 * player at once, in the palace; and the King's leaves the hanged clerk waiting in the morning, a walk
 * from the palace to the granary yard.
 */

async function prologue() {
  const { host, script } = hostWithCampaign(7, { prologue: true, map: true, asIs: true });
  const wren = identity(1);
  assert.equal(host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "ranger" }), undefined);
  await host.drain();
  const game = all(host.db.game)[0]!;
  const sceneOf = (key: string) => all(host.db.scene).find(s => s.gameId === game.id && s.sceneKey === key);
  const gameRow = () => host.db.game.id.find(game.id)!;
  const player = () => host.db.player.id.find(all(host.db.player).find(p => p.gameId === game.id)!.id)!;
  const explore = () => host.db.explore.playerId.find(player().id)!;
  const placeKey = (key: string) => host.db.place.id.find(sceneOf(key)!.placeId)!.key;
  const end = async (exit: string) => { assert.equal(host.as(host.owner).endScene({ game: game.id, exit }), undefined); await host.drain(); };
  return { host, script, wren, game, sceneOf, gameRow, player, explore, placeKey, end };
}

test("the King's Road comes to the player: a new game opens it at once, on the cart on the road's own map, in the afternoon, with the cushions' quest", async () => {
  const { host, sceneOf, gameRow, player, explore, placeKey } = await prologue();
  const road = sceneOf("kings-road")!;

  assert.deepEqual([road.status, road.time, gameRow().time, gameRow().leadScene], ["live", "afternoon", "afternoon", "kings-road"], "opened, its opening in, with no walk to it");
  assert.equal(player().sceneId, road.id, "the seat in it");
  assert.deepEqual([explore().map, explore().at, explore().scene], ["kings-road", { x: 12, y: 12 }, "kings-road"], "on the cart, where the road's place starts the player");
  assert.equal(placeKey("kings-road"), "kings-road");
  assert.deepEqual(all(host.db.quest).map(q => [q.key, q.title, q.status]), [["assembly-cushions", "The Assembly's Cushions", "active"]], "the cushions' quest, from the first moment");
  assert.ok(host.logs.some(l => l.startsWith("[start kings-road] applied: quest assembly-cushions start")));
});

test("the road's ending leaves the toll bridge waiting at dusk, a walk along the road; its ending brings the King's thanks to the player at once, in his parlour", async () => {
  const { host, wren, sceneOf, gameRow, player, explore, placeKey, end } = await prologue();

  await end("on-to-the-bridge");
  const bridge = sceneOf("toll-bridge")!;
  assert.deepEqual([bridge.status, bridge.time, gameRow().time, gameRow().leadScene], ["waiting", "evening", "evening", "toll-bridge"], "it waits for the player");
  assert.equal(explore().map, "kings-road", "still on the road");
  assert.equal(host.as(wren).walk({ toward: "lead" }), undefined);
  await host.drain();
  assert.equal(sceneOf("toll-bridge")!.status, "live", "walked onto the bridge, it opens");
  assert.equal(player().sceneId, bridge.id);

  await end("to-the-king");
  const thanks = sceneOf("kings-thanks")!;
  assert.deepEqual([thanks.status, thanks.time, gameRow().leadScene], ["live", "evening", "kings-thanks"], "a guard taking them to the King: it comes to the player");
  assert.equal(player().sceneId, thanks.id, "the seat moved with it");
  assert.deepEqual([placeKey("kings-thanks"), explore().map], ["kings-parlour", "palace"], "in the King's parlour, on the palace's map");
  assert.ok(host.logs.some(l => /\[story\] toll-bridge ended by to-the-king: kings-thanks summons/.test(l)));
});

test("the King's guest: the crowns in the player's purse, the cushions' quest done, and the hanged clerk waiting in the morning, a walk from the palace to the granary yard", async () => {
  const { host, wren, sceneOf, gameRow, player, explore, end } = await prologue();
  await end("on-to-the-bridge");
  assert.equal(host.as(wren).walk({ toward: "lead" }), undefined);
  await host.drain();
  await end("to-the-king");
  const crowns = () => (JSON.parse(host.db.sheet.playerId.find(player().id)!.pockets).purse as Array<{ name: string; quantity: number }>).find(p => p.name === "silver crowns")?.quantity ?? 0;
  const before = crowns();

  await end("kings-guest");
  assert.equal(crowns(), before + 5, "the King's five silver crowns, in with the purse's");
  assert.equal(all(host.db.quest).find(q => q.key === "assembly-cushions")!.status, "complete");
  const clerk = sceneOf("hanged-clerk")!;
  assert.deepEqual([clerk.status, clerk.time, gameRow().time, gameRow().leadScene], ["waiting", "morning", "morning", "hanged-clerk"], "it waits for the player, the next morning");
  assert.equal(explore().map, "palace", "they wake in the palace");
  for (let walks = 0; walks < 4 && sceneOf("hanged-clerk")!.status === "waiting"; walks++) {
    assert.equal(host.as(wren).walk({ toward: "lead" }), undefined);
    await host.drain();
  }
  assert.equal(sceneOf("hanged-clerk")!.status, "live", "out of the palace gate and on to the granary yard, which opens it");
  assert.equal(explore().map, "caerwyn");
});
