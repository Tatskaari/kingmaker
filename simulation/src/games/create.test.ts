import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "spacetimedb";
import type { TxCtx } from "../context.ts";
import { newUid } from "./create.ts";

/**
 * A game's uid (games/create.ts newUid): the module's randomness repeats between transactions close
 * in time (its generator's seed is a 32-bit hash of the timestamp), so the uid starts with the
 * transaction's time, and the same randomness at another time is another uid.
 */

const at = (micros: bigint, uuid = "0f1e2d3c-4b5a-4968-8776-655443322110") => ({ now: new Timestamp(micros), uuid: () => uuid }) as unknown as TxCtx;

test("a uid is the transaction's time, then its randomness, shaped as a UUID; the same randomness a microsecond later is another uid", () => {
  const micros = 1_792_128_291_112_812n;
  const uid = newUid(at(micros));
  assert.match(uid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(uid.replace(/-/g, "").slice(0, 13), micros.toString(16).padStart(13, "0"));
  assert.equal(uid.replace(/-/g, "").slice(13), "0f1e2d3c4b5a49688776655443322110".slice(13), "the uuid's last 19 hex digits");
  assert.notEqual(newUid(at(micros + 1n)), uid);
  assert.notEqual(newUid(at(micros, "ffffffff-ffff-4fff-8fff-ffffffffffff")), uid, "and other randomness at the same time");
});
