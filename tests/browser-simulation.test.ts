import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import test from "node:test";
import { build } from "vite";

test("production browser bundle executes movement with the same Immer draft implementation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kingmaker-browser-move-"));
  try {
    const entry = join(directory, "entry.ts");
    const modulePath = (path: string) => JSON.stringify(resolve(path));
    await writeFile(entry, `
      import { createSimulationAuthority } from ${modulePath("packages/core/src/simulation-authority.ts")};
      import { executeLocalMove } from ${modulePath("packages/core/src/local-move-executor.ts")};
      import { startMove } from ${modulePath("packages/core/src/simulation-movement.ts")};
      const initial = () => ({ runtimeCharacters: {}, map: { revision: 0,
        actors: [{ characterId: "player", position: { x: 0, y: 0 } }], doors: [], fixtures: [],
        layout: { width: 2, height: 1, rooms: [], tiles: [{ layers: [{ solid: false }] }, { layers: [{ solid: false }] }] }
      } });
      const request = { id: "walk", to: { x: 1, y: 0 }, startedAtMs: 1000, msPerTile: 100 };
      export function move() {
        const local = executeLocalMove(initial(), startMove, "player", request);
        const authority = createSimulationAuthority(initial());
        authority.executeMove(startMove, "player", request);
        return [local.map.actors[0].movement.path, authority.read().map.actors[0].movement.path];
      }
    `);
    const result = await build({ configFile: resolve("vite.config.ts"), logLevel: "silent",
      build: { write: false, minify: true, lib: { entry, formats: ["es"] },
        rollupOptions: { input: entry } } });
    const output = Array.isArray(result) ? result[0]! : result;
    assert.ok("output" in output);
    const chunk = output.output.find(item => item.type === "chunk" && item.isEntry);
    assert.ok(chunk?.type === "chunk");
    const bundle = join(directory, "bundle.mjs");
    await writeFile(bundle, chunk.code);
    const bundled = await import(pathToFileURL(bundle).href);
    for (const path of bundled.move()) assert.deepEqual(path.map(({ x, y }: { x: number; y: number }) => ({ x, y })), [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
