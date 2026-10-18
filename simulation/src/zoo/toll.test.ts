import { test } from "node:test";
import assert from "node:assert/strict";
import type { CombatMove, CombatRequest, ReplyResponse, SettleResponse } from "../../../shared/protocol/ai.ts";
import { all, hostWithCampaign, identity, installZoo, sceneNow } from "../host/testing.ts";

/**
 * The zoo's Crakes' toll (docs/combat-gm.md): a scene exhibit, opened by a visit as the story opens a
 * scene and played by the GM; a fight in the conversation breaks out in it, is played to its end, and
 * the co-GM takes the scene to the ending the fight earned, which ends the visit's scene.
 */

const usage = { calls: 1, costUsd: 0.001, byOperation: {} };

test("a visit to the Crakes' toll: the scene opens on the GM; it comes to blows, the fight is played out, and the co-GM ends the scene on the fight's outcome", async () => {
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
  const plays = (request: unknown): CombatMove => {
    const c = (request as CombatRequest).combat;
    if (c.over) return { kind: "end_combat", outcome: c.over.outcome, narration: "The Crakes are done." };
    const foe = c.fighters.find(f => f.side === "foes" && !f.down && !f.out)?.id ?? "crake-1";
    if (c.whose === "player" && c.done.length === 0) return { kind: "act", act: { action: "move", target: foe, narration: "You go for him." } };
    if (c.whose === "player" && c.done.length === 1) return { kind: "act", act: { action: "attack", target: foe, narration: "You swing." } };
    return { kind: "end_turn", narration: "Breathing hard." };
  };
  for (let i = 0; i < 200; i++) script.then("combat", (r: unknown) => ({ move: plays(r), entries: [{ speaker: "gm", kind: "narration", text: "…" }], usage }));
  script.then("settle", { ops: [], coGm: { roles: {}, moves: [], log: [] }, usage } satisfies SettleResponse);

  const say = async (text: string) => {
    const refused = host.as(wren).say({ text });
    assert.equal(refused, undefined, `"${text}" was refused: ${refused?.text}`);
    await host.drain();
    return sceneNow(host, scene.id);
  };
  let now = await say("I punch the talking one in the mouth.");
  for (let i = 0; i < 20 && now.gm.combat; i++) now = await say("I hit him again.");
  assert.equal(now.gm.combat, undefined, "the fight is over");
  const over = now.lines.find(l => l.kind === "system" && l.text.startsWith("The fight is over"))!;
  assert.ok(over, "the fight's end is in the transcript");

  const won = /you won|they gave up/.test(over.text);
  script.then("settle", { ops: [], coGm: { roles: {}, moves: [{ route: won ? "won-the-fight" : "lost-the-fight", outcome: "none", why: "The fight was fought and is over." }], log: [] }, usage } satisfies SettleResponse);
  now = await say("I catch my breath.");
  assert.equal(now.gm.closing?.exitId, won ? "beaten" : "beaten-back");
  now = await say("Right. Out we go.");
  assert.equal(now.scene.status, "ended");
  assert.equal(now.scene.exitKey, won ? "beaten" : "beaten-back");
});
