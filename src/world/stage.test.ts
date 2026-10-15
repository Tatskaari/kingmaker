import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
const RUNS = mkdtempSync(join(tmpdir(), "km-stage-"));
process.env.KM_RUNS_DIR = RUNS;
process.env.KM_COST_LEDGER = join(RUNS, "cost-ledger.jsonl");
process.env.OPENROUTER_API_KEY = "offline";
const { sceneById } = await import("../../scenes/index.ts");
const { presentCast } = await import("../runtime/brief.ts");
const { buildWorld } = await import("./scene-world.ts");
const { stageManage } = await import("./stage.ts");
const { fakeOpenRouter } = await import("../llm/fake-openrouter.ts");

/**
 * The stage manager (src/world/stage.ts) holds to what was settled before the exchange, as the GM
 * is told to: a reply that recalls a trade the GM's ruling decided ("the hand that held the crown now
 * holds two silver pieces") isn't the trade made again, the other way round.
 */

test("the stage manager is told what's settled, and that a reply recalling it isn't it happening again", async () => {
  const scene = sceneById("hanged-clerk");
  const player = { name: "Maud Harrow", concept: "a paladin", modifiers: {} };
  const world = buildWorld(scene.id, scene.world!, presentCast(scene, { entered: [], absent: [], beat: "yard", path: [] } as never).map(c => ({ id: c.id, name: c.name })), player);
  const fake = fakeOpenRouter({ byName: { world_ops: { ops: [] } } });
  try {
    const settled = ["Moll traded the wheat-ear crown to the player for two silver crowns: it worked."];
    await stageManage(world, player, "Who did he say this morning?", "Moll's eyes go to the hand that held the wheat-ear crown; now it holds two plain silver pieces.", 11, { settled });
    const body = fake.sent.find(b => b.text?.format?.name === "world_ops")!;
    const said = body.input!.map(m => m.content).join("\n");
    assert.match(said, /## Settled before this exchange \(it stands, and the world already shows it\)\n- Moll traded the wheat-ear crown/);
    assert.match(JSON.stringify(body), /isn't it happening again: write nothing that repeats or reverses it/);
  } finally {
    fake.restore();
  }
});
