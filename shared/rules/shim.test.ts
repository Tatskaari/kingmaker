import { test } from "node:test";
import assert from "node:assert/strict";
import { pinned, shimmed, type Pin } from "./shim.ts";
import * as E from "../../vendor/dnd-srd-engine/dnd-srd-engine.module.js";
import { rng } from "../dice.ts";

/**
 * The shim (shim.ts), with the module-ready bundle loaded after it as the hosts load it: the bundle
 * loads (without the shim it throws "secure crypto unusable" in an ES module), ulid takes the shim's
 * crypto, and a pinned call's ids and clock are the pin's, so the same pin makes the same ids. Outside
 * a pin, Node's own crypto and clock, as the AI service has them.
 */

const PlatformDate = Date;
const T = Date.UTC(2026, 9, 16, 9, 30); // 09:30 UTC, 16 Oct 2026
/** A pin as withEngine makes one: bytes from a seeded generator, and a fixed time. */
const pin = (seed: number, nowMs = T): Pin => {
  const next = rng(seed);
  return { fill: bytes => bytes.forEach((_, i) => { bytes[i] = Math.floor(next() * 256); }), nowMs };
};
/** A ULID's time part: its first ten characters, Crockford's base 32, in milliseconds. */
const timeOf = (ulid: string) => [...ulid.slice(0, 10)].reduce((ms, c) => ms * 32 + "0123456789ABCDEFGHJKMNPQRSTVWXYZ".indexOf(c), 0);

test("the bundle loads after the shim, which gave ulid its crypto and can replace Date", () => {
  assert.equal(typeof E.createEngine, "function");
  assert.deepEqual(shimmed, { ids: true, clock: true });
});

test("a pinned call's ids are the pin's: the same pin makes the same ids, at the pin's time", () => {
  const ids = (seed: number) => pinned(pin(seed), () => [E.newEventId(), E.newCharacterId(), E.newItemInstanceId()]);
  const first = ids(7);
  assert.deepEqual(ids(7), first);
  assert.notDeepEqual(ids(8), first);
  assert.equal(new Set(first).size, 3, "each id its own");
  assert.ok(first.every(id => timeOf(id) === T), "stamped with the pinned time");
});

test("a pinned call's clock is the pin's, and the platform's Date is back after", () => {
  const seen = pinned(pin(1), () => ({ made: new Date().getTime(), now: Date.now(), iso: new Date().toISOString(), given: new Date(0).getTime() }));
  assert.deepEqual(seen, { made: T, now: T, iso: "2026-10-16T09:30:00.000Z", given: 0 });
  assert.equal(Date, PlatformDate);
  assert.ok(Math.abs(Date.now() - T) > 60_000, "the real clock again");
});

test("a date made before a pin is still a Date in it, and one made in it after", () => {
  const before = new Date();
  const inside = pinned(pin(1), () => ({ before: before instanceof Date, made: new Date() }));
  assert.equal(inside.before, true);
  assert.ok(inside.made instanceof Date);
});

test("pins nest, and a throw puts back what was pinned before", () => {
  const nested = pinned(pin(1, 1000), () => {
    const inner = pinned(pin(2, 2000), () => Date.now());
    assert.throws(() => pinned(pin(3, 3000), () => { throw new Error("boom"); }), /boom/);
    return [inner, Date.now()];
  });
  assert.deepEqual(nested, [2000, 1000]);
  assert.equal(Date, PlatformDate);
});

test("outside a pin, ids come from the platform's crypto (the AI service's Node)", () => {
  const [a, b] = [E.newEventId(), E.newEventId()];
  assert.notEqual(a, b);
  assert.ok(Math.abs(timeOf(a) - Date.now()) < 60_000, "stamped now");
});
