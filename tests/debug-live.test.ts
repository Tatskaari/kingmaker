import assert from "node:assert/strict";
import test from "node:test";
import { coalescedRefresh } from "../apps/web/src/debug-live.js";

test("transcript updates coalesce bursts and serialize changes received during a read", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0;
  let finish!: () => void;
  const schedule = coalescedRefresh(async () => {
    reads++;
    await new Promise<void>(resolve => { finish = resolve; });
  });
  schedule(); schedule(); schedule();
  t.mock.timers.tick(100);
  assert.equal(reads, 1);
  schedule(); schedule();
  t.mock.timers.tick(100);
  assert.equal(reads, 1, "never overlap reads");
  finish();
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(100);
  assert.equal(reads, 2, "read again once for changes arriving during the first read");
  finish();
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(100);
  assert.equal(reads, 2, "stop reading when there are no new updates");
});

test("live transcript events update the panel without rendering and discard stale navigation results", async () => {
  const { readFileSync } = await import("node:fs");
  const { createContext, runInContext } = await import("node:vm");
  const { AlertLog } = await import("../apps/web/src/alerts.js");
  const sent: any[] = [];
  const updates: unknown[] = [];
  let receive!: (event: any) => void;
  let refresh!: () => Promise<void>;
  const panel = {};
  const context = createContext({
    URL, AlertLog, installDicePreview() {}, window: {}, devOpenRouterApiKey: "", newTraveller: () => ({}),
    coalescedRefresh(callback: () => Promise<void>) { refresh = callback; return callback; },
    updateTranscriptPanel(target: unknown, html: unknown) { assert.equal(target, panel); updates.push(html); },
    recentTranscriptsView(requests: unknown) { return requests; },
    document: { querySelector: () => panel, addEventListener() {} },
    Worker: class {
      addEventListener(_type: string, callback: typeof receive) { receive = callback; }
      postMessage(message: any) { sent.push(message); }
    },
  });
  const source = readFileSync(new URL("../apps/web/src/app.js", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replaceAll("import.meta.url", JSON.stringify(import.meta.url))
    .replace(/if \(apiKey\) run\(\(\) => configure\(apiKey\)\);\s*else render\(\);/, "");
  runInContext(`${source}
    render = () => { throw new Error("Live updates must not rebuild the screen"); };
    debugOpen = true; debugTab = "transcripts"; debugData = { requests: ["existing"] };
  `, context);
  receive({ data: { type: "transcripts_changed" } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "debug_transcripts");
  assert.equal(runInContext("debugData.requests[0]", context), "existing", "keep content while reading");
  receive({ data: { id: sent[0].id, ok: true, value: { requests: ["fresh"], agentRuns: {} } } });
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(updates, [["fresh"]]);
  const pending = refresh();
  runInContext('debugTab = "overview"; debugReadSequence++;', context);
  receive({ data: { id: sent[1].id, ok: true, value: { requests: ["stale"], agentRuns: {} } } });
  await pending;
  assert.deepEqual(updates, [["fresh"]], "a response from the old tab must not overwrite the new screen");
});
