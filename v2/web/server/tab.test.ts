import assert from "node:assert/strict";
import { test } from "node:test";
import { claimTab, type Tab } from "./tab.ts";

/**
 * One tab at a time (browser-design §5), on Node's own Web Locks: a second tab says it's busy, with
 * the channel's name, and waits; once the first lets go it has the lock.
 */

test("a second tab says it's busy and waits; the first letting go of the lock hands it over", async () => {
  const name = `kingmaker-v2-web /tab-test-${process.pid}/`;
  const first = await claimTab(name, () => assert.fail("the first tab finds the lock free"), navigator.locks, 20);
  const busy: string[] = [];
  let second: Tab | undefined;
  const claimed = claimTab(name, channel => busy.push(channel), navigator.locks, 20).then(tab => { second = tab; });

  for (let n = 0; n < 100 && !busy.length; n++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual([busy, second], [[name], undefined], "busy, with the channel the page asks on, and waiting");
  first.release();
  await claimed;
  assert.ok(second, "the lock handed over");
  second.release();
});

test("without Web Locks, every tab plays its own copy", async () => {
  const tab = await claimTab("kingmaker-v2-web /no-locks/", () => assert.fail("never busy"), undefined);
  tab.release();
});
