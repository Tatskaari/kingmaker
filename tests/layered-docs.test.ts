import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { WorldStateSchema as MapSchema } from "../packages/contracts/src/index.js";
import { worldState } from "../packages/lore/src/world-state.js";
import { createLayeredDocumentServices, loadDocumentLayers } from "../packages/service-tools/src/layered-docs.js";

test("document layers override whole files and isolate service writes and repeated runs", async () => {
  const root = mkdtempSync(join(tmpdir(), "kingmaker-doc-layers-"));
  try {
    const base = join(root, "base"), overlay = join(root, "overlay"), path = "Scenarios/Test/scenario.md";
    for (const directory of [base, overlay]) mkdirSync(join(directory, "Scenarios/Test"), { recursive: true });
    writeFileSync(join(base, path), "---\nsummary: Base scenario\nvisibility: gm\n---\nOriginal.");
    writeFileSync(join(base, "Scenarios/Test/index.md"), "Index.");
    const replacement = "---\nsummary: Variant scenario\nvisibility: gm\n---\nVariant.";
    writeFileSync(join(overlay, path), replacement);
    const layers = loadDocumentLayers([base, overlay]);
    assert.equal(layers.markdown.get(path), replacement);
    assert.equal(layers.markdown.get("Scenarios/Test/index.md"), "Index.");
    const build = () => createLayeredDocumentServices([base, overlay], ({ markdown }) => worldState(create(MapSchema), markdown, "Test"));
    const first = build(), second = build();
    const before = await first.docs.read(path);
    await first.docs.replace(path, before.sha, "Variant.", "Changed in memory.");
    assert.match((await first.docs.read(path)).text, /Changed in memory/);
    assert.match((await second.docs.read(path)).text, /Variant\./);
    assert.equal(readFileSync(join(overlay, path), "utf8"), replacement);
    await assert.rejects(first.docs.replace(path, before.sha, "Variant.", "Stale write"), /changed/);
    writeFileSync(join(overlay, path), "---\nsummary: [unterminated\n---\nBad YAML");
    assert.throws(build, /scenario.md/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("layer loading rejects missing roots and empty configurations", () => {
  assert.throws(() => loadDocumentLayers([]), /At least one/);
  assert.throws(() => loadDocumentLayers(["/nonexistent/kingmaker-eval-layer"]), /ENOENT/);
});
