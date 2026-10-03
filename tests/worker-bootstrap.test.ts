import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "vite";

test("browser worker bundle boots without a DOM and registers its RPC handler", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kingmaker-worker-"));
  try {
    await build({ logLevel: "silent", build: { outDir: directory } });
    const filename = (await readdir(join(directory, "assets"))).find(name => /^game\.worker-.*\.js$/.test(name))!;
    assert.ok(filename);
    const worker = pathToFileURL(join(directory, "assets", filename)).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { readFileSync } from 'node:fs';
      let listening = false;
      globalThis.self = { location: { href: 'http://localhost/' }, addEventListener() { listening = true; }, postMessage() {} };
      globalThis.fetch = async () => new Response(readFileSync(${JSON.stringify(resolve("content/palace-map.json"))}, 'utf8'));
      await import(${JSON.stringify(worker)});
      await new Promise(resolve => setImmediate(resolve));
      if (!listening) throw new Error('Worker did not register its RPC handler');
    `], { encoding: "utf8", timeout: 20000 });
    assert.equal(result.status, 0, result.stderr);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
