// Copied from the prototype's src/world/stage.test.ts at 44c6d4a (what's settled, and a reply recalling it), with the schema's ids and the operations returned rather than applied: the world is the simulation's to change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeFetch } from "../llm/fake-openrouter.ts";
import { hangedClerk, viewAt } from "./fixtures.ts";
import { stageManage } from "./stage.ts";

/**
 * The stage manager holds to what was settled before the exchange, as the GM is told to: a reply
 * that recalls a trade the GM's ruling decided ("the hand that held the crown now holds two silver
 * pieces") isn't the trade made again, the other way round.
 */

const scene = hangedClerk();

test("the stage manager is told what's settled, and that a reply recalling it isn't it happening again", async () => {
  const world = viewAt(scene).world!;
  const fake = fakeFetch({ byName: { world_ops: { ops: [] } } });
  const settled = ["Moll traded the wheat-ear crown to the player for two silver crowns: it worked."];
  await stageManage(world, { name: "Maud Harrow" }, "Who did he say this morning?", "Moll's eyes go to the hand that held the wheat-ear crown; now it holds two plain silver pieces.", { settled }, { fetch: fake.fetch, apiKey: "k", log: () => {}, cost: () => {} });

  const body = fake.sent.find(b => b.text?.format?.name === "world_ops")!;
  const said = body.input!.map(m => m.content).join("\n");
  assert.match(said, /## Settled before this exchange \(it stands, and the world already shows it\)\n- Moll traded the wheat-ear crown/);
  assert.match(JSON.stringify(body), /isn't it happening again: write nothing that repeats or reverses it/);
});

test("the operations may name only the world's ids, and come back as written, sixteen at most, the world untouched", async () => {
  const world = viewAt(scene).world!;
  const op = { op: "move", what: "kell", to: "player", how: "", feet: 0, name: "", kind: "", text: "", add: [], remove: [], quantity: 0 };
  const fake = fakeFetch({ byName: { world_ops: { ops: Array.from({ length: 20 }, () => op) } } });
  const before = structuredClone(world);
  const staged = await stageManage(world, { name: "Maud Harrow" }, "Over here, Sergeant.", "Kell comes over.", {}, { fetch: fake.fetch, apiKey: "k", log: () => {}, cost: () => {} });

  const schema = fake.sent[0]!.text!.format!.schema as { properties: { ops: { items: { properties: { what: { enum: string[] } } } } } };
  assert.deepEqual(schema.properties.ops.items.properties.what.enum, ["", ...Object.keys(world.entities).filter(id => id !== world.root)]);
  assert.equal(staged.ops.length, 16);
  assert.deepEqual(staged.ops[0], op);
  assert.deepEqual(world, before);
});
