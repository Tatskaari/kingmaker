import assert from "node:assert/strict";
import test from "node:test";
import { create } from "@bufbuild/protobuf";
import { WorldStateSchema as MapSchema } from "../packages/contracts/src/index.js";
import { createScenarioServices } from "../packages/lore/src/services.js";
import { worldState } from "../packages/lore/src/world-state.js";

const entry = "Scenarios/Test/Characters/alice/character.md";
const shared = "---\nvisibility: private\nreaders: ['label:court']\n---\n";
function fixture() {
  return createScenarioServices(worldState(create(MapSchema), new Map([
    ["Scenarios/Test/scenario.md", `[[${entry}]]`], ["Scenarios/Test/index.md", "Index"],
    [entry, "---\nlabels: [court]\n---\n[[Shared]]"],
    ["Shared.md", shared + "Public history."], ["GM.md", "---\nvisibility: gm\n---\nSECRET_SENTINEL"],
    ["A/Duplicate.md", ""], ["B/Duplicate.md", ""],
  ]), "Test"));
}

test("GM preflight reports proposed private, broken and ambiguous links without writing", async () => {
  const { docs, scenario } = fixture(), before = scenario.snapshot();
  assert.deepEqual(await docs.validate(), []);
  const findings = await docs.validate({ path: "Shared.md", text: shared + "[[GM]] [[Missing]] [[Duplicate]]" });
  assert.ok(findings.some(f => f.kind === "denied" && JSON.stringify(f.trail) === JSON.stringify([entry, "Shared.md", "GM.md"])));
  assert.ok(findings.some(f => f.kind === "broken" && f.trail.at(-1) === "Missing"));
  assert.ok(findings.some(f => f.kind === "ambiguous" && f.trail.at(-1) === "Duplicate"));
  assert.ok(!JSON.stringify(findings).includes("SECRET_SENTINEL"));
  assert.deepEqual(scenario.snapshot(), before);
  assert.ok((await docs.validate({ path: "unused.md", text: "[[Missing]]" })).some(f => f.kind === "broken"));
  assert.ok((await docs.validate({ path: "Shared.md", text: "---\nvisibility: [\n---\n" })).some(f => f.kind === "invalid"));
});

test("preflight catches permission changes and live audience revocation", async () => {
  const { docs } = fixture();
  const note = await docs.read("Shared.md"), character = await docs.read(entry);
  assert.ok((await docs.validate({ path: note.path, text: note.text.replace("private", "gm") })).some(f => f.kind === "denied"));
  const revoked = character.text.replace("- court", "- elsewhere");
  assert.notEqual(revoked, character.text);
  assert.ok((await docs.validate({ path: entry, text: revoked })).some(f => f.kind === "denied"));
  await docs.replace(entry, character.sha, character.text, revoked);
  assert.ok((await docs.validate()).some(f => f.kind === "denied"));
  const restored = await docs.read(entry);
  await docs.replace(entry, restored.sha, restored.text, character.text);
  assert.deepEqual(await docs.validate(), []);
});

test("pre-existing defects remain visible while unrelated repairs are allowed", async () => {
  const source = fixture().scenario.snapshot();
  source.docs["Shared.md"]!.body += " [[GM]]";
  const { docs } = createScenarioServices(source);
  assert.ok((await docs.validate()).some(f => f.kind === "denied"));
  const note = await docs.read("Shared.md");
  const changed = await docs.replace(note.path, note.sha, "Public history.", "Updated history.");
  await docs.replace(note.path, changed.sha, " [[GM]]", "");
  assert.deepEqual(await docs.validate(), []);
});
