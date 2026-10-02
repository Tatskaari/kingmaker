import assert from "node:assert/strict";
import test from "node:test";
import { loadConversationCheckEval, scoreConversationChecks } from "../packages/evals/src/conversation-check-eval.js";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("classification scoring distinguishes roll detection from skill accuracy", () => {
  assert.deepEqual(scoreConversationChecks(["deception", "sleight_of_hand"], ["deception", "intimidation"]), {
    exact: false, rollCorrect: true, truePositive: 1, falsePositive: 1, falseNegative: 1,
    missed: ["sleight_of_hand"], extra: ["intimidation"],
  });
  assert.equal(scoreConversationChecks([], []).exact, true);
  assert.equal(scoreConversationChecks([], ["persuasion"]).rollCorrect, false);
  assert.equal(scoreConversationChecks(["insight"], []).rollCorrect, false);
  assert.equal(scoreConversationChecks(["deception", "insight"], ["insight", "deception"]).exact, true);
});

test("scenario-backed input includes the king's real context and leaves labels for review", () => {
  const fixture = loadConversationCheckEval("evals/jev/king-threat.json");
  assert.equal(fixture.expected, undefined);
  assert.equal(fixture.input.playerTurn, fixture.input.messages!.at(-1)!.content);
  const prompt = fixture.input.messages!.map(message => message.content).join("\n");
  assert.match(prompt, /Tomas Vey/);
  assert.match(prompt, /# Dialogue objectives/);
  assert.match(prompt, /# Known world state/);
  assert.match(prompt, /Lady Elinor Ash \(elinor\)/);
});

test("labels distinguish pending review from no roll and reject invalid skills", () => {
  const dir = mkdtempSync(join(tmpdir(), "check-eval-")), file = join(dir, "case.json");
  const source = { name: "test", transcript: [
    { type: "character_conversation_sys_prompt", character: resolve("evals/characters/king.json") },
    { type: "user_message", value: "May I speak?" },
    { type: "assistant_message", value: "Go on." },
    { type: "user_message", value: "Good evening." },
  ] };
  try {
    for (const expected of [[], ["intimidation"]]) {
      writeFileSync(file, JSON.stringify({ ...source, expected }));
      const loaded = loadConversationCheckEval(file);
      assert.deepEqual(loaded.expected, expected);
      assert.equal(loaded.input.playerTurn, "Good evening.");
      assert.deepEqual(loaded.input.messages!.slice(-3).map(message => message.content), ["May I speak?", "Go on.", "Good evening."]);
      assert.equal(Object.hasOwn(loaded.input, "expected"), false);
    }
    writeFileSync(file, JSON.stringify({ ...source, expected: ["invented"] }));
    assert.throws(() => loadConversationCheckEval(file), /supported skills/);
    writeFileSync(file, JSON.stringify({ ...source, transcript: source.transcript.slice(0, 1) }));
    assert.throws(() => loadConversationCheckEval(file), /current player turn/);
  } finally { rmSync(dir, { recursive: true }); }
});


test("Rook regressions replay the captured pre-ruling inputs without label leakage", () => {
  for (const name of ["rook-claimed-voyage", "rook-claimed-favor"]) {
    const fixture = loadConversationCheckEval(`evals/jev/${name}.json`);
    const captured = JSON.parse(readFileSync(`evals/transcripts/${name}-input.json`, "utf8"));
    assert.deepEqual(fixture.input, captured);
    assert.deepEqual(fixture.expected, ["deception"]);
    assert.equal(fixture.input.messages!.at(-1)!.content, fixture.input.playerTurn);
    assert.equal(Object.hasOwn(fixture.input, "expected"), false);
    assert.equal(Object.hasOwn(fixture.input, "rationale"), false);
    assert.equal(fixture.input.messages!.some(message => message.role === "tool"), false);
    const recordedFailure = scoreConversationChecks(fixture.expected!, []);
    assert.equal(recordedFailure.rollCorrect, false);
    assert.deepEqual(recordedFailure.missed, ["deception"]);
  }
});

test("captured inputs reject a mismatched current turn and ambiguous sources", () => {
  const dir = mkdtempSync(join(tmpdir(), "captured-check-eval-")), file = join(dir, "case.json");
  try {
    writeFileSync(file, JSON.stringify({ name: "capture", capturedInput: "input.json" }));
    writeFileSync(join(dir, "input.json"), JSON.stringify({ playerTurn: "Now", messages: [{ role: "user", content: "Earlier" }] }));
    assert.throws(() => loadConversationCheckEval(file), /exact playerTurn/);
    writeFileSync(file, JSON.stringify({ name: "capture", capturedInput: "input.json", transcript: [] }));
    assert.throws(() => loadConversationCheckEval(file), /not both/);
  } finally { rmSync(dir, { recursive: true }); }
});
