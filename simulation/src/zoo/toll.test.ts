import { test } from "node:test";
import assert from "node:assert/strict";
import type { FightBoard, FightResult } from "../../../shared/fight/types.ts";
import { OUT } from "../../../shared/map/moves.ts";
import type { OpenResponse, ReplyResponse, SettleResponse } from "../../../shared/protocol/ai.ts";
import { fightOf } from "../fight/rows.ts";
import { all, hostWithCampaign, identity, installZoo, sceneNow } from "../host/testing.ts";

/**
 * The zoo's Crakes' toll (docs/combat-gm.md): a scene exhibit, opened by a visit as the story opens a
 * scene and played by the GM; a fight breaks out in it, is set out on the toll's own map and fought
 * on the board to its end, the scene picks up after it, and the co-GM takes the scene to the ending
 * the fight earned, which ends the visit's scene.
 */

const usage = { calls: 1, costUsd: 0.001, byOperation: {} };

test("a visit to the Crakes' toll: the scene opens on the GM; it comes to blows, the fight is fought on the board, and the co-GM ends the scene on how it went", async () => {
  const { host, script } = hostWithCampaign(7, { map: true });
  installZoo(host);
  const wren = identity(1);
  assert.equal(host.as(wren).visitZoo({ exhibit: "toll", build: "fighter" }), undefined);
  await host.drain();
  const game = all(host.db.game).find(g => g.campaign === "zoo")!;
  const scene = all(host.db.scene).find(s => s.gameId === game.id)!;
  assert.deepEqual([scene.sceneKey, scene.status], ["toll", "live"], "the toll's scene opened, as a lead opens");
  assert.equal(host.db.explore.playerId.find(game.hostId)!.map, "toll");

  script.then("reply", { entries: [{ speaker: "gm", kind: "narration", text: "The talking Crake drops the cup. Roll for initiative!" }], gm: {}, firstTextMs: 3, initiative: { foes: ["crake-1", "crake-2"], allies: ["kell"], why: "the toll refused with a fist" }, usage } satisfies ReplyResponse);
  const say = async (text: string) => {
    const refused = host.as(wren).say({ text });
    assert.equal(refused, undefined, `"${text}" was refused: ${refused?.text}`);
    await host.drain();
    return sceneNow(host, scene.id);
  };
  let now = await say("I punch the talking one in the mouth.");
  assert.equal(now.scene.status, "fighting", "the scene is at its fight");
  assert.equal(now.lines.at(-1)!.text, "Roll for initiative! Against you: the big man with the tin cup, the other big man. Beside you: Sergeant Agnes Kell.", "as the player knows them");
  assert.equal(host.as(wren).say({ text: "Wait!" })?.code, "not_now", "no words while it's fought");

  // On to it: on the toll's own map, everyone where the world has them, the player's sheet kept.
  assert.equal(host.as(wren).fightItOut(), undefined);
  const fight = () => host.transact(tx => fightOf(tx, game.id))!;
  const board = JSON.parse(fight().board) as FightBoard;
  assert.deepEqual([fight().mapKey, board.scene, board.keep, fight().title], ["toll", String(scene.id), true, "A fight in the ring"]);
  assert.deepEqual(Object.values(board.units).map(u => [u.id, u.side, u.role]).sort(), [["crake-1", "enemy", "bruiser"], ["crake-2", "enemy", "bruiser"], ["kell", "ally", "ally"], ["player", "player", "player"]]);
  for (let i = 0; i < 600 && fight().status === "on"; i++) {
    if (fight().options) assert.equal(host.as(wren).fightTurn({ act: "auto" }), undefined);
    else { host.advance(5000); host.fightSteps(); }
  }
  const result = JSON.parse(fight().result!) as FightResult;
  script.then("open", { present: ["kell", "crake-1", "crake-2"], entries: [{ speaker: "gm", kind: "narration", text: "The dust settles on the toll." }], ops: [], usage } satisfies OpenResponse);
  assert.equal(host.as(wren).walk({ toward: OUT }), undefined, "out, back to the scene");
  await host.drain();
  now = sceneNow(host, scene.id);
  assert.equal(now.scene.status, "live", "the scene picked up after its fight");
  assert.ok(now.lines.some(l => l.kind === "system" && l.text === `The fight: ${result.told}`), "how it went is in the transcript");
  assert.equal(now.lines.at(-1)!.text, "The dust settles on the toll.", "the GM's aftermath");

  const won = result.outcome === "victory" || result.outcome === "surrender";
  script.then("settle", { ops: [], coGm: { roles: {}, moves: [{ route: won ? "won-the-fight" : "lost-the-fight", outcome: "none", why: "The fight was fought and is over." }], log: [] }, usage } satisfies SettleResponse);
  now = await say("I catch my breath.");
  assert.equal(now.gm.closing?.exitId, won ? "beaten" : "beaten-back");
  now = await say("Right. Out we go.");
  assert.equal(now.scene.status, "ended");
  assert.equal(now.scene.exitKey, won ? "beaten" : "beaten-back");
});
