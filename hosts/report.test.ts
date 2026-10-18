import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Identity, TimeDuration, Timestamp } from "spacetimedb";
import type { GameAnswer, GameReport } from "../shared/report/format.ts";
import { rowsFromParsed } from "../shared/report/rows.ts";
import { all, TEST_CLERK } from "../simulation/src/host/testing.ts";
import { onTop, quietGm } from "./dev/fake.ts";
import { readCampaignFiles } from "./dev/campaign.ts";
import { localHost } from "./local.ts";

/**
 * A report of a problem (V16, M5: docs/migration-log.md), from a real game: played on the local host
 * (the simulation and the AI service in one process, on the fake model), its rows and the AI
 * service's own of it given to its owner alone.
 */

const FILES = { ...readCampaignFiles(join(import.meta.dirname, "..", "campaigns", "caerwyn")), "scenes/hanged-clerk.kmscene": readFileSync(TEST_CLERK, "utf8") };
const WREN = new Identity(0x1001n);
const SDK = { Identity, Timestamp, TimeDuration };

/** A game played a few turns on the local host: made, walked into the yard (its opening), and two lines said. */
async function played() {
  const local = await localHost({ seed: 7, fake: () => onTop(quietGm(), { replies: ["Kell looks at you a long moment. “Go on.”"] }), files: FILES });
  assert.equal(local.sim.as(WREN).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a quick-witted investigator lent to the case by the King", build: "ranger" }), undefined);
  assert.equal(local.sim.as(WREN).walk({ toward: "lead" }), undefined);
  await local.sim.drain();
  for (const text of ["Sergeant, who found him?", "(I look closely at Prout's boots)"]) {
    assert.equal(local.sim.as(WREN).say({ text }), undefined);
    await local.sim.drain();
  }
  return { local, game: all(local.sim.db.game)[0]! };
}

test("report_game: every table's rows of the owner's game, and the AI service's calls, memory reviews and docs for it; another's game, or none, refused", async () => {
  const { local, game } = await played();
  try {
    const answer = JSON.parse(await local.sim.report(WREN, game.id)) as GameAnswer;
    assert.ok(!("refusal" in answer), JSON.stringify(answer).slice(0, 300));
    const report = answer as GameReport;

    assert.deepEqual([report.kind, report.id, report.uid, report.campaign], ["kingmaker-game", String(game.id), game.uid, "caerwyn@0.1.0"]);
    const rows = rowsFromParsed(report.rows, SDK);
    assert.equal(rows.game!.length, 1);
    assert.deepEqual(rows.game![0]!.id, game.id, "a u64 comes back a bigint");
    assert.ok((rows.player![0]!.identity as Identity).isEqual(WREN), "an identity comes back an Identity");
    assert.ok(rows.transcript!.some(r => r.text === "(I look closely at Prout's boots)"));
    for (const table of ["player", "seat", "sheet", "dice", "scene", "gmState", "turn", "transcript", "place", "entity", "position", "rulesState", "explore", "onStage"]) {
      assert.ok(rows[table]!.length > 0, `${table} has the game's rows`);
    }
    assert.ok(!("error" in report.ai), "the AI service's own came");
    if ("error" in report.ai) return;
    const ops = report.ai.calls.calls.map(c => c.operation);
    assert.ok(ops.includes("two-part.opening") && ops.includes("two-part.reply"), ops.join(", "));
    assert.equal(report.ai.calls.total.calls, report.ai.calls.calls.length);
    assert.equal(report.ai.docs.game, game.uid);

    assert.deepEqual(JSON.parse(await local.sim.report(new Identity(0x2002n), game.id)).refusal.code, "not_yours");
    assert.deepEqual(JSON.parse(await local.sim.report(WREN, 999n)).refusal.code, "unknown");
  } finally {
    local.close();
  }
});

test("restore_game: a reported game made a new game, for the owner alone, every row pointing at the new ones, the player's keys rewritten, played on from where it was reported; the game it came from untouched", async () => {
  const { local, game } = await played();
  const target = await localHost({ seed: 9, fake: () => onTop(quietGm(), { replies: ["Cob shrugs. “Ask the river.”"] }), files: FILES });
  try {
    const report = JSON.parse(await local.sim.report(WREN, game.id)) as GameReport;
    const TAM = new Identity(0x3003n);
    const args = { rows: JSON.stringify(report.rows), identity: TAM.toHexString(), uid: `${game.uid}-r1` };

    assert.equal(target.sim.as(TAM).restoreGame(args)?.code, "not_admin", "only the database's owner restores");
    assert.match(target.sim.as(target.sim.owner).restoreGame({ ...args, rows: "{" })?.text ?? "", /its rows aren't JSON/);
    assert.equal(target.sim.as(target.sim.owner).restoreGame(args), undefined);
    assert.match(target.sim.as(target.sim.owner).restoreGame(args)?.text ?? "", /won't do as its uid/, "a uid a game here has is refused");

    // The new game: its own ids, the restorer seated as its host, its rows pointing at its own.
    const restored = all(target.sim.db.game).find(g => g.uid === args.uid)!;
    const host = target.sim.db.player.id.find(restored.hostId)!;
    assert.ok(host.identity.isEqual(TAM));
    assert.equal(target.sim.view(TAM).mySeat()?.gameId, restored.id);
    const pc = all(target.sim.db.entity).find(e => e.key === `pc:${host.id}`);
    assert.ok(pc && pc.gameId === restored.id, "the player's character's key names the new player");
    assert.equal(host.characterId, pc.id);
    const scene = all(target.sim.db.scene).find(s => s.gameId === restored.id)!;
    const lines = all(target.sim.db.transcript).filter(t => t.sceneId === scene.id);
    assert.deepEqual(lines.filter(l => l.kind === "player").map(l => [l.speaker, l.text]), [[`player:${host.id}`, "Sergeant, who found him?"], [`player:${host.id}`, "(I look closely at Prout's boots)"]]);
    assert.equal(target.sim.db.place.id.find(scene.placeId)?.gameId, restored.id);
    assert.ok(all(target.sim.db.position).every(p => target.sim.db.entity.id.find(p.entityId)?.placeId === p.placeId), "every component points at its entity's place");

    // Played on: one more line, answered.
    assert.equal(target.sim.as(TAM).say({ text: "And the boy with the stones?" }), undefined);
    await target.sim.drain();
    const turns = all(target.sim.db.turn).filter(t => t.sceneId === scene.id).sort((a, b) => a.n - b.n);
    assert.deepEqual(turns.map(t => [t.n, t.phase]), [[0, "done"], [1, "done"], [2, "done"], [3, "done"]]);
    assert.ok(all(target.sim.db.transcript).some(t => t.sceneId === scene.id && /Ask the river/.test(t.text)));

    // Restored again where it came from: new ids beside the game it came from, which stays as it was.
    const before = JSON.stringify(rowsFromParsed(JSON.parse(await local.sim.report(WREN, game.id)).rows, SDK), (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v));
    assert.equal(local.sim.as(local.sim.owner).restoreGame({ ...args, uid: `${game.uid}-r2` }), undefined);
    const after = JSON.stringify(rowsFromParsed(JSON.parse(await local.sim.report(WREN, game.id)).rows, SDK), (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v));
    assert.equal(after, before, "the game it came from is as it was");
    assert.equal(all(local.sim.db.game).length, 2);
  } finally {
    local.close();
    target.close();
  }
});
