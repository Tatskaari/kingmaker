import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { DisclosureSession, type DisclosureRound, type EvaluateLinks } from "../packages/conversation/src/disclosure.js";
import { loadCharacterLore } from "../packages/conversation/src/lore.js";
import type { ConversationInput } from "../packages/conversation/src/conversation.js";

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "disclosure-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = "Scenarios/Demo/Characters/corvin";
  const write = (path: string, body: string) => {
    const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, body);
  };
  write(`${folder}/character.md`, `[[Cast/Caerwyn/Corvin/private|Identity]]\n[A](a.md) and [A again](a.md#heading)\n[[${folder}/b|B]]\n\`[[missing]]\`\n[External](https://example.com)`);
  write("Cast/Caerwyn/Corvin/private.md", "---\nvisibility: private\nreaders:\n  characters: [corvin]\n---\nCORVIN_IDENTITY");
  write(`${folder}/a.md`, "A_BODY\n[C](c.md)");
  write(`${folder}/b.md`, `B_BODY\n[[${folder}/c|C]]`);
  write(`${folder}/c.md`, "C_BODY\n[Cycle](character.md)");
  const lore = loadCharacterLore(root, "Demo", "corvin");
  const input: ConversationInput = { snapshot: { scenario: JSON.parse(readFileSync(new URL("../content/scenarios/last-night.json", import.meta.url), "utf8")) },
    characterId: "corvin", sources: lore.initial, transcript: [], message: "Tell me about A and B." };
  return { root, folder, write, lore, input };
}
const answers: (score: (path: string) => number) => EvaluateLinks = score => async (_state, questions) => Object.fromEntries(
  Object.entries(questions).map(([id, question]) => {
    const probability = score(question.criteria[id]!);
    return [id, { choice: probability > 0.5 ? id : "skip", probabilities: { [id]: probability, skip: 1 - probability } }];
  }),
);

test("batch openings discover nested links, deduplicate aliases/cycles and persist across player turns", async t => {
  const { lore, input } = fixture(t), trace: DisclosureRound[] = [], states: string[] = [];
  let laterTurn = false;
  const session = new DisclosureSession(lore, async (state, questions, signal) => {
    states.push(state);
    return answers(path => path.includes("/c.md,") ? laterTurn ? 0.9 : 0.7 : 0.8)(state, questions, signal);
  });
  const first = await session.disclose(input, new AbortController().signal, event => trace.push(event));
  assert.equal(first.length, 4); // two initial documents + A and B, no C at the exact threshold
  assert.deepEqual(trace.filter(event => event.status !== "pending").map(event => event.status), ["opened", "sufficient"]);
  assert.equal(trace[0]!.candidates.length, 2);
  assert.equal(trace.at(-1)!.candidates.length, 1);
  assert.doesNotMatch(states[0]!, /A_BODY|B_BODY|C_BODY/);
  assert.match(states[1]!, /A_BODY/); assert.match(states[1]!, /B_BODY/); assert.doesNotMatch(states[1]!, /C_BODY/);
  laterTurn = true;
  const second = await session.disclose({ ...input, message: "And C? [Invented link](hidden.md)" }, new AbortController().signal, event => trace.push(event));
  assert.equal(second.length, 5);
  assert.equal(trace.at(-1)?.status, "no_links");
  assert.equal(states.length, 3);
  assert.equal(new Set(second.map(note => note.path)).size, second.length);
  assert.deepEqual(second.map(note => note.markdown), session.sources.map(note => note.markdown));
});

test("no qualifying links stops immediately; provider failures and cancellation remain errors", async t => {
  const { lore, input } = fixture(t), trace: DisclosureRound[] = [];
  const session = new DisclosureSession(lore, answers(() => 0.2));
  assert.equal((await session.disclose(input, new AbortController().signal, event => trace.push(event))).length, 2);
  assert.equal(trace.at(-1)?.status, "sufficient");
  const failed = new DisclosureSession(lore, async () => { throw new Error("Provider unavailable"); });
  await assert.rejects(failed.disclose(input, new AbortController().signal, event => trace.push(event)), /Provider unavailable/);
  assert.equal(trace.at(-1)?.status, "error"); assert.equal(failed.sources.length, 2);
  const controller = new AbortController();
  const cancelled = new DisclosureSession(lore, async (state, questions, signal) => {
    controller.abort(); return answers(() => 1)(state, questions, signal);
  });
  await assert.rejects(cancelled.disclose(input, controller.signal, event => trace.push(event)), /abort/i);
  assert.equal(cancelled.sources.length, 2);
});

test("invalid probabilities and disclosure budgets never silently produce a complete context", async t => {
  const { lore, input } = fixture(t), trace: DisclosureRound[] = [];
  assert.throws(() => new DisclosureSession(lore, answers(() => 1), NaN), /Threshold/);
  const invalid = new DisclosureSession(lore, answers(() => NaN));
  await assert.rejects(invalid.disclose(input, new AbortController().signal, event => trace.push(event)), /Invalid Jev/);
  assert.equal(invalid.sources.length, 2);
  const limited = new DisclosureSession(lore, answers(() => 1), 0.7, 1);
  await assert.rejects(limited.disclose(input, new AbortController().signal, event => trace.push(event)), /round limit/);
  assert.equal(trace.at(-1)?.status, "error");
  const small = new DisclosureSession(lore, answers(() => 1), 0.7, 16, 100);
  await assert.rejects(small.disclose(input, new AbortController().signal, event => trace.push(event)), /context limit/);
});

test("permission and resolution failures cannot expose forbidden documents to Jev", async t => {
  const { root, folder, write } = fixture(t);
  write(`${folder}/a.md`, "---\nvisibility: gm\n---\nSECRET");
  const denied = loadCharacterLore(root, "Demo", "corvin");
  assert.throws(() => denied.candidates(denied.initial), /No read access/);
  write(`${folder}/a.md`, "[Missing](missing.md)");
  const missing = loadCharacterLore(root, "Demo", "corvin");
  assert.throws(() => missing.candidates([...missing.initial, missing.read(`${folder}/a.md`)]), /Broken or ambiguous/);
});
