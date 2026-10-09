import assert from "node:assert/strict";
import { test } from "node:test";
import Mustache from "mustache";
import catalog from "../packages/prompts/src/catalog.js";
import { readPromptCatalog } from "../packages/prompts/src/catalog.js";
import { renderPrompt as renderEvalPrompt } from "../packages/evals/src/prompts.js";
import { renderPrompt } from "../packages/prompts/src/index.js";

test("all authored templates parse and contain prompt text", () => {
  for (const [id, entry] of Object.entries(catalog)) {
    assert.ok(entry.trim(), id);
    assert.doesNotThrow(() => Mustache.parse(entry), id);
  }
});

test("runtime evidence is plain text and is never evaluated as another template", () => {
  const markdown = '<map x="1"> & {{secret}}';
  assert.equal(renderPrompt("lore-context", { path: "Map/room.md", markdown }), `# Lore: Map/room.md\n${markdown}`);
  assert.throws(() => renderPrompt("lore-context", { path: "Map/room.md" }), /Missing prompt variable: markdown/);
  let called = false;
  assert.throws(() => renderPrompt("lore-context", { path: "room", markdown: () => { called = true; } }), /cannot execute/);
  assert.equal(called, false);
});

test("planner template receives the observed map and optional action feedback", () => {
  const values = { characterId: "guard", feedback: "", intent: "Duty", goal: "Watch", observedMap: "Visible room only", history: "None yet." };
  const expected = "Who you are: guard\n\nDuty\n\nCurrent execution task:\nWatch\n\nWorld state:\nVisible room only\n\nRecent history (completed actions and events you perceived, oldest first):\nNone yet.";
  assert.equal(renderPrompt("planner-context", values), expected);
  assert.equal(renderPrompt("planner-context", { ...values, feedback: "Door blocked" }), expected.replace("guard\n\n", "guard\n\nPrevious action result:\nDoor blocked\n\n"));
});

test("eval templates load separately from the game catalog", () => {
  const evalCatalog = readPromptCatalog(new URL("../evals/prompts/", import.meta.url));
  assert.equal(Object.keys(evalCatalog).length, 15);
  for (const [id, entry] of Object.entries(evalCatalog)) {
    assert.equal(catalog[id], undefined, id);
    assert.doesNotThrow(() => Mustache.parse(entry), id);
    assert.throws(() => renderPrompt(id), /Unknown prompt/);
  }
  assert.ok(renderEvalPrompt("jev-scorer-instructions", { criterion: "Keep facts grounded" }).includes("Keep facts grounded"));
  assert.throws(() => renderEvalPrompt("jev-scorer-instructions"), /Missing prompt variable: criterion/);
});
