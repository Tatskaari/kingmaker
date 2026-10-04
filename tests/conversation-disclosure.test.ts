import { loadPlayableWorld } from "./fixtures.js";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { DisclosureSession as Session, type DisclosureRound, type EvaluateLinks } from "../packages/conversation/src/disclosure.js";
import { loadCharacterLore } from "../packages/conversation/src/lore.js";
import { ConversationRuntime } from "../packages/conversation/src/runtime.js";
import { runConversation } from "../packages/conversation/src/phases.js";
import { loreService } from "../packages/conversation/src/adapters.js";
import type { CharacterLore } from "../packages/conversation/src/lore.js";
import { conversationRequest } from "../packages/conversation/src/conversation.js";
import type { ConversationInput } from "../packages/conversation/src/conversation.js";

// Exercise the production phase loop without a renderer or dialogue provider.
class DisclosureSession extends Session {
  constructor(lore: CharacterLore, evaluate: EvaluateLinks, threshold = 0.7, private maxPasses = 16, maxCharacters = 120_000) {
    super(loreService(lore), { responses: async () => { throw new Error("unused"); },
      decisions: (state, questions, signal) => evaluate(String(state), questions, signal) }, threshold, maxCharacters);
  }
  async disclose(input: ConversationInput, signal: AbortSignal, trace: (event: DisclosureRound) => void) {
    const runtime = new ConversationRuntime({ maxPasses: this.maxPasses,
      services: { character: { respond: async () => ({ role: "assistant", content: "done" }) } },
      hooks: { conversation: this.hooks(trace) },
    });
    await runConversation(conversationRequest({ ...input, sources: this.sources }), runtime, signal);
    return this.sources;
  }
}

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "disclosure-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = "Scenarios/Demo/Characters/corvin";
  const write = (path: string, body: string) => {
    const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, body);
  };
  write(`${folder}/character.md`, `[[Cast/Caerwyn/Corvin/private|Identity]]\n[A](a.md) and [A again](a.md#heading)\n[[${folder}/b|B]]\n\`[[missing]]\`\n[External](https://example.com)`);
  write("Cast/Caerwyn/Corvin/private.md", "---\nvisibility: private\nreaders: ['character:corvin']\n---\nCORVIN_IDENTITY");
  write(`${folder}/a.md`, "A_BODY\n[C](c.md)");
  write(`${folder}/b.md`, `B_BODY\n[[${folder}/c|C]]`);
  write(`${folder}/c.md`, "C_BODY\n[Cycle](character.md)");
  const lore = loadCharacterLore(root, "Demo", "corvin");
  const input: ConversationInput = { snapshot: { world: loadPlayableWorld() },
    characterId: "corvin", sources: lore.initial, transcript: [], message: "Tell me about A and B." };
  return { root, folder, write, lore, input };
}
const answers: (score: (path: string) => number) => EvaluateLinks = score => async (_state, questions) => Object.fromEntries(
  Object.entries(questions).map(([id, question]) => {
    const probability = score(question.criteria[id]!);
    return [id, { choice: probability > 0.5 ? id : "skip", probabilities: { [id]: probability, skip: 1 - probability } }];
  }),
);

test("injected notes and previously opened notes cannot be offered or reopened by an adapter", async t => {
  const { lore, folder, input } = fixture(t);
  const extraPath = `${folder}/a.md`, opened: string[] = [], trace: DisclosureRound[] = [];
  let decisions = 0;
  const session = new Session({
    initial: lore.initial,
    // Deliberately return already-loaded notes, including the main characterization.
    links: () => [...lore.initial.map(note => note.path), extraPath].map(path => ({
      path, from: `${folder}/character.md`,
    })),
    async open(link) { opened.push(link.path); return lore.read(link.path); },
  }, {
    responses: async () => { throw new Error("unused"); },
    decisions: async (state, questions, signal) => {
      decisions++;
      assert.match(String(state), /CORVIN_IDENTITY/);
      assert.equal(Object.keys(questions).length, 1);
      assert.match(JSON.stringify(questions), /a\.md/);
      assert.doesNotMatch(JSON.stringify(questions), /private\.md/);
      return answers(() => 1)(String(state), questions, signal);
    },
  });
  for (let turn = 0; turn < 2; turn++) {
    const runtime = new ConversationRuntime({
      services: { character: { respond: async request => {
        for (const path of [...lore.initial.map(note => note.path), extraPath]) {
          assert.equal(request.messages.filter(message => message.content?.startsWith(`# Lore: ${path}\n`)).length, 1);
        }
        return { role: "assistant", content: "done" };
      } } },
      hooks: { conversation: session.hooks(event => trace.push(event)) },
    });
    await runConversation(conversationRequest({ ...input, sources: session.sources }), runtime, new AbortController().signal);
  }
  assert.equal(decisions, 1);
  assert.deepEqual(opened, [extraPath]);
  assert.deepEqual(trace.filter(event => event.status !== "pending").map(event => event.status),
    ["opened", "no_links", "no_links"]);
});

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

test("Jev follows label-authorized briefing links without preloading their bodies", async t => {
  const { root, folder, write, input } = fixture(t);
  write(`${folder}/character.md`, `---\nlabels: [court-informed]\n---\n[[Cast/Caerwyn/Corvin/private|Identity]]\n[[Briefing]]`);
  write("Briefing.md", "---\nvisibility: private\nreaders: ['label:court-informed']\n---\nCOURT_BRIEFING [[Delegation]]");
  write("Delegation.md", "---\nvisibility: private\nreaders: ['label:court-informed']\n---\nDELEGATION_OVERVIEW");
  const lore = loadCharacterLore(root, "Demo", "corvin");
  assert.doesNotMatch(JSON.stringify(lore.initial), /COURT_BRIEFING|DELEGATION_OVERVIEW/);
  const session = new DisclosureSession(lore, answers(() => 1));
  const opened = await session.disclose(input, new AbortController().signal, () => {});
  assert.ok(opened.some(note => note.markdown.includes("DELEGATION_OVERVIEW")));
  write(`${folder}/character.md`, "[[Cast/Caerwyn/Corvin/private|Identity]]\n[[Briefing]]");
  const unlabelled = loadCharacterLore(root, "Demo", "corvin");
  assert.throws(() => unlabelled.candidates(unlabelled.initial), /No read access/);
});

test("Jev sees a permitted summary before deciding, without the unopened body", async t => {
  const { root, folder, write, input } = fixture(t);
  write(`${folder}/a.md`, "---\nsummary: The Nine Furrows wizards and their magical specialties.\n---\nUNOPENED_WIZARD_DETAILS");
  const lore = loadCharacterLore(root, "Demo", "corvin");
  assert.match(lore.candidates(lore.initial).find(link => link.path.endsWith("/a.md"))!.summary!, /wizards/);
  const trace: DisclosureRound[] = [];
  let considered = false;
  const session = new DisclosureSession(lore, async (state, questions, signal) => {
    const question = Object.values(questions).find(question => Object.values(question.criteria).some(value => value.includes("Document summary:")));
    if (question) {
      considered = true;
      assert.match(Object.values(question.criteria)[0]!, /^Document summary: .*wizards/);
      assert.doesNotMatch(state + JSON.stringify(questions), /UNOPENED_WIZARD_DETAILS/);
    }
    return answers(path => path.includes("Document summary:") ? 1 : 0)(state, questions, signal);
  });
  const opened = await session.disclose({ ...input, message: "Tell me about the wizards." }, new AbortController().signal, event => trace.push(event));
  assert.ok(considered);
  assert.ok(opened.some(note => note.markdown.includes("UNOPENED_WIZARD_DETAILS")));
  assert.match(trace[0]!.candidates.find(link => link.path.endsWith("/a.md"))!.summary!, /wizards/);
});

test("forbidden or malformed summaries never reach Jev and previews count toward its budget", async t => {
  const { root, folder, write, input } = fixture(t);
  write(`${folder}/a.md`, "---\nvisibility: gm\nsummary: FORBIDDEN_SUMMARY\n---\nSECRET");
  let calls = 0;
  const evaluate: EvaluateLinks = async (state, questions, signal) => { calls++; return answers(() => 1)(state, questions, signal); };
  const denied = new DisclosureSession(loadCharacterLore(root, "Demo", "corvin"), evaluate);
  await assert.rejects(denied.disclose(input, new AbortController().signal, () => {}), /No read access/);
  for (const value of ["[nested]", "42", "null", "''"]) {
    write(`${folder}/a.md`, `---\nsummary: ${value}\n---\nBODY`);
    const invalid = new DisclosureSession(loadCharacterLore(root, "Demo", "corvin"), evaluate);
    await assert.rejects(invalid.disclose(input, new AbortController().signal, () => {}), /summary must be nonempty text/);
  }
  write(`${folder}/a.md`, `---\nsummary: ${"x".repeat(120_001)}\n---\nBODY`);
  const oversized = new DisclosureSession(loadCharacterLore(root, "Demo", "corvin"), evaluate);
  await assert.rejects(oversized.disclose(input, new AbortController().signal, () => {}), /context limit/);
  assert.equal(calls, 0);
});

test("filesystem disclosure derives factions from the character entry only", t => {
  const { root, folder, write } = fixture(t);
  write(`${folder}/character.md`, "---\nfactions: [nine-furrows]\n---\n[[Cast/Caerwyn/Corvin/private|Identity]]\n[[Academic]]");
  write("Academic.md", "---\nvisibility: private\nreaders: ['faction:nine-furrows']\nsummary: Academic history.\n---\nACADEMIC_FACT");
  const member = loadCharacterLore(root, "Demo", "corvin");
  assert.equal(member.candidates(member.initial)[0]?.summary, "Academic history.");
  write(`${folder}/character.md`, "[[Cast/Caerwyn/Corvin/private|Identity]]\n[[Academic]]");
  write("Cast/Caerwyn/Corvin/private.md", "---\nvisibility: private\nreaders: ['character:corvin']\nfactions: [nine-furrows]\n---\nCORVIN_IDENTITY");
  const outsider = loadCharacterLore(root, "Demo", "corvin");
  assert.throws(() => outsider.candidates(outsider.initial), /No read access/);
});
