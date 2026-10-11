import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { SimulationStateSchema } from "../packages/contracts/src/v2.js";
import { createSimulationAuthority } from "../packages/core/src/simulation-authority.js";
import { updateFixture, type FixtureUpdate } from "../packages/core/src/update-fixture.js";

const setup = () => createSimulationAuthority(create(SimulationStateSchema, {
  map: { fixtures: [{ id: "cart", name: "Cart", container: true }] },
}));

test("fixture callbacks edit the latest draft and preserve previous state and unrelated fields", () => {
  const authority = setup(), before = authority.read();
  authority.executeMove(updateFixture, "cart", fixture => { fixture.name = "Updated cart"; });
  authority.executeMove(updateFixture, "cart", fixture => { fixture.open = fixture.name === "Updated cart"; });
  assert.equal(before.map!.fixtures[0]!.name, "Cart");
  assert.equal(before.map!.fixtures[0]!.open, false);
  assert.equal(authority.read().map!.fixtures[0]!.open, true);
  assert.equal(authority.read().map!.fixtures[0]!.container, true);
  assert.equal(authority.read().map!.revision, 2);
});

test("invalid, throwing and asynchronous updates publish nothing", async () => {
  const authority = setup(), before = authority.read();
  const rejected: FixtureUpdate[] = [
    fixture => { fixture.id = "changed"; },
    fixture => { fixture.open = true; throw new Error("rejected"); },
    async fixture => { fixture.open = true; await Promise.resolve(); fixture.name = "Too late"; },
    fixture => { fixture.open = true; return Promise.reject(new Error("failed async work")); },
  ];
  for (const update of rejected) {
    assert.throws(() => authority.executeMove(updateFixture, "cart", update));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(authority.read(), before);
  }
  assert.throws(() => authority.executeMove(updateFixture, "missing", () => {}));
  assert.equal(authority.read(), before);
});
