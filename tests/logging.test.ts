import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const loggingModule = new URL("../packages/observability/src/logging.ts", import.meta.url).href;

test("test preload persists structured records even when a process fails", () => {
  const directory = mkdtempSync(join(tmpdir(), "kingmaker-logs-"));
  try {
    const child = spawnSync(process.execPath, ["--import", "tsx", "--import", "./scripts/test-logging.ts",
      "--input-type=module", "-e", `
        import { gameLogger } from ${JSON.stringify(loggingModule)};
        gameLogger('events').info('Event observed', { eventId: 'event-1', roll: 0.42 });
        process.exit(1);
      `], { env: { ...process.env, KINGMAKER_LOG_DIR: directory }, encoding: "utf8" });
    assert.equal(child.status, 1, child.stderr);
    const records = readdirSync(directory).flatMap(file => readFileSync(join(directory, file), "utf8").trim().split("\n").map(line => JSON.parse(line)));
    const record = records.find(record => record.message === "Event observed");
    assert.deepEqual(record.properties, { eventId: "event-1", roll: 0.42 });
    assert.equal(record.logger, "kingmaker.events");
    assert.equal(child.stdout, "");
    assert.equal(child.stderr, "");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("browser setup routes structured properties to the console", () => {
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import './apps/web/src/logging.ts';
    import { gameLogger } from ${JSON.stringify(loggingModule)};
    let args;
    console.debug = (...values) => { args = values; };
    gameLogger('events').debug('Perception roll', { eventId: 'event-2', roll: 0.7 });
    assert.deepEqual(args.at(-1), { eventId: 'event-2', roll: 0.7 });
    assert.match(args[0], /kingmaker.events debug/);
  `], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
});
