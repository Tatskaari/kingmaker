import assert from "node:assert/strict";
import test from "node:test";
import { resolveDiceCheck } from "../apps/web/src/dice-roll.js";

test("ability checks include modifiers and succeed when the total meets the DC", () => {
  assert.deepEqual(resolveDiceCheck(12, 15, 3), { total: 15, success: true });
  assert.deepEqual(resolveDiceCheck(11, 15, 3), { total: 14, success: false });
  assert.deepEqual(resolveDiceCheck(17, 15, -3), { total: 14, success: false });
  assert.deepEqual(resolveDiceCheck(1, 5, 4), { total: 5, success: true });
  assert.deepEqual(resolveDiceCheck(20, 25, 0), { total: 20, success: false });
});

test("reject invalid dice results and non-integer or overflowing check parameters", () => {
  for (const roll of [0, 21, 1.5, NaN, Infinity]) assert.throws(() => resolveDiceCheck(roll, 15, 3), RangeError);
  for (const value of [NaN, Infinity, 1.5]) {
    assert.throws(() => resolveDiceCheck(12, value, 3), RangeError);
    assert.throws(() => resolveDiceCheck(12, 15, value), RangeError);
  }
  assert.throws(() => resolveDiceCheck(20, 15, Number.MAX_SAFE_INTEGER), RangeError);
});
