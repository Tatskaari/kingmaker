import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeStackFile, type StackFile } from "../dev/stack-file.ts";
import { runningStack, stackOn } from "./stack.ts";

/** A runs/ folder with a stack in each of `stacks`, by folder: its ports, and whether it's running. */
function runs(stacks: Record<string, { stdb: number; ai: number; running: boolean }>): string {
  const dir = mkdtempSync(join(tmpdir(), "km-live-stack-"));
  for (const [name, s] of Object.entries(stacks)) {
    const root = join(dir, name);
    mkdirSync(root);
    writeStackFile({ root, ports: { stdb: s.stdb, ai: s.ai }, pids: s.running ? { stdb: 1, ai: 2 } : {} } as StackFile);
  }
  return dir;
}

test("a live run finds the running stack on its ports, runs/dev first", () => {
  const dir = runs({ "dev-e": { stdb: 3300, ai: 8787, running: true }, dev: { stdb: 3300, ai: 8787, running: true }, f: { stdb: 3450, ai: 8950, running: true }, old: { stdb: 3460, ai: 8960, running: false } });
  try {
    assert.equal(stackOn(dir, 3300, 8787)?.root, join(dir, "dev"));
    assert.equal(stackOn(dir, 3450, 8950)?.root, join(dir, "f"));
    assert.equal(stackOn(dir, 3460, 8960), undefined);
    assert.equal(runningStack(dir, { port: 3450, aiPort: 8950, portsGiven: true }).root, join(dir, "f"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no stack on the ports, or a folder on other ports, says so", () => {
  const dir = runs({ dev: { stdb: 3300, ai: 8787, running: true } });
  try {
    assert.throws(() => runningStack(dir, { port: 3450, aiPort: 8950, portsGiven: true }), /no dev stack running on ports 3450 and 8950: start one with npm run dev -- --port 3450 --ai-port 8950/);
    assert.throws(() => runningStack(dir, { port: 3450, aiPort: 8950, portsGiven: true, stack: join(dir, "dev") }), /is on ports 3300 and 8787, not 3450 and 8950/);
    assert.equal(runningStack(dir, { port: 3300, aiPort: 8787, portsGiven: false, stack: join(dir, "dev") }).root, join(dir, "dev"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
