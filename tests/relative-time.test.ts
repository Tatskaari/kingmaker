import assert from "node:assert/strict";
import test from "node:test";
import { formatElapsedTime } from "../apps/web/src/relative-time.js";

test("formatElapsedTime uses compact elapsed time units", () => {
  const now = Date.UTC(2026, 8, 27, 12);
  assert.equal(formatElapsedTime(now, now), "1s");
  assert.equal(formatElapsedTime(now - 59_000, now), "59s");
  assert.equal(formatElapsedTime(now - 120_000, now), "2m");
  assert.equal(formatElapsedTime(now - 3_600_000, now), "1h");
  assert.equal(formatElapsedTime(now - 172_800_000, now), "2d");
});
