import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fakeFetch, type Request } from "../llm/fake-openrouter.ts";
import { callContext } from "../service/calls.ts";
import { campaigns } from "../service/campaigns.ts";
import type { AiContext } from "../service/context.ts";
import { pipeline } from "../service/endpoints/pipeline.ts";
import { folderStores } from "../service/folder-stores.ts";
import type { Who } from "../../shared/creation/types.ts";
import type { BackstoriesRequest, BackstoriesResponse, CharactersRequest, CharactersResponse } from "../../shared/protocol/ai.ts";
import { creationKey, type CreationStep } from "../../shared/protocol/keys.ts";

/** Each test's store, in a folder of this file's own that goes when its tests are done. */
const SCRATCH = mkdtempSync(join(tmpdir(), "km-creation-parity-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

/**
 * Creation's prompt parity (v1-design §4.2): POST /v1/characters and /v1/backstories ask the models
 * what the prototype's character creation asks, byte for byte, for the same request. golden/ holds
 * the prototype's calls at 44c6d4a (tools/v2/record-v1-golden.mts, golden/README.md), a case a
 * file: what was called with what, the stand-in's answers, every request body as it was sent, and
 * what the prototype made of the answers. Each case becomes the request the simulation would send,
 * v2's endpoint runs on a stand-in told the same answers, with the campaign's creation block, and
 * its calls (instructions, input, schema: the whole body) and its answer are compared.
 */

const GOLDEN = join(import.meta.dirname, "golden");
const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const UID = "9d4e5f60-0000-4000-8000-0000000000aa";

interface Golden { file: string; about: string; fn: string; args: Record<string, unknown>; byName?: Record<string, unknown>; calls: Array<{ operation: string; body: Request }>; result: unknown }

const cases = readdirSync(GOLDEN).filter(f => f.endsWith(".json")).sort().map(file => ({ file, ...JSON.parse(readFileSync(join(GOLDEN, file), "utf8")) }) as Golden);

test("the golden recording is there: each of creation's model calls, the builds for three concepts", () => {
  assert.deepEqual([...new Set(cases.flatMap(c => c.calls.map(x => x.operation)))].sort(), ["backstory.check", "backstory.draft", "backstory.traits", "backstory.work", "rules.build", "rules.builds"]);
  assert.equal(cases.filter(c => c.fn === "threeBuilds").length, 3);
});

for (const golden of cases) {
  test(`${golden.file}: ${golden.about}`, async () => {
    const { answer, sent } = await asked(golden);

    assert.equal(sent.length, golden.calls.length, "as many calls");
    golden.calls.forEach((theirs, i) => assert.equal(JSON.stringify(sent[i]), JSON.stringify(theirs.body), `${theirs.operation}:\n${firstDifference(theirs.body, sent[i])}`));
    sameMade(golden, answer);
  });
}

// ---------------------------------------------------------------------------------------------
// A case as the simulation would ask it, on a stand-in told the recording's answers.

/** Each recorded call, as a step of creation: its endpoint's request, from the call's arguments. */
function requestOf(golden: Golden): { characters: CharactersRequest } | { backstories: BackstoriesRequest } {
  const a = golden.args as { name?: string; concept?: string; level?: number; who?: Who; story?: string; notes?: string; text?: string };
  const game = { id: UID, campaign: "caerwyn", version: "0.1.0" };
  const characters = (step: CreationStep, ask: CharactersRequest["ask"]) => ({ characters: { key: creationKey(UID, 1, step), game, who: { name: a.name!, concept: a.concept! }, level: a.level!, ask } });
  const backstories = (op: BackstoriesRequest["op"], text: string) => ({ backstories: { key: creationKey(UID, 1, op), game, op, who: a.who!, text } });
  switch (golden.fn) {
    case "threeBuilds": return characters("offer", { kind: "three" });
    case "chooseBuild": case "createCharacter": return characters("pick", { kind: "one" });
    case "draftBackstory": return backstories("draft", "");
    case "workIn": return backstories("work", a.notes!);
    case "checkLore": return backstories("check", a.story!);
    case "finishBackstory": return backstories("traits", a.text!);
    default: throw new Error(`${golden.file}: no step makes ${golden.fn}`);
  }
}

/** The case's request through v2's endpoint, on the campaign as installed, the stand-in answering by schema name as the recording's did. */
async function asked(golden: Golden): Promise<{ answer: CharactersResponse | BackstoriesResponse; sent: Request[] }> {
  const stores = folderStores(mkdtempSync(join(SCRATCH, "store-")));
  const installed = campaigns(stores.campaigns, stores.docs);
  await installed.put("caerwyn", "0.1.0", filesOf(CAERWYN));
  const fake = fakeFetch({ byName: golden.byName ?? {} });
  const request = requestOf(golden);
  const key = "characters" in request ? request.characters.key : request.backstories.key;
  const { calls, usage } = callContext({ fetch: fake.fetch, apiKey: "parity" }, stores, { game: UID, key, attempt: 1 });
  const ctx: AiContext = { campaign: installed.use("caerwyn", "0.1.0"), calls, usage, attempt: 1, stream: () => { throw new Error("creation streams nothing"); } };

  const answer = "characters" in request ? await pipeline.characters(request.characters, ctx) : await pipeline.backstories(request.backstories, ctx);
  return { answer, sent: fake.sent };
}

/**
 * What v2 made of the answers is what the prototype made: the offer (its cards the engine's); the
 * model's build settled and styled, its line, and the card's AC and HP the character's (the
 * prototype's createCharacter line); the backstory's asking, its check or its traits.
 */
function sameMade(golden: Golden, answer: CharactersResponse | BackstoriesResponse): void {
  const a = answer as CharactersResponse & BackstoriesResponse;
  if (golden.fn === "threeBuilds") return assert.deepEqual(a.offer, golden.result);
  if (golden.fn === "chooseBuild" || golden.fn === "createCharacter") {
    const theirs = golden.result as { line: string; buildLine: string; build: unknown };
    const option = a.option!;
    assert.deepEqual(option.build, theirs.build);
    assert.equal(option.line, theirs.buildLine);
    return assert.equal(`${golden.args.name}: ${option.line}. AC ${option.card.ac}, HP ${option.card.hp}/${option.card.hp}.`, theirs.line);
  }
  assert.deepEqual(a.asked ?? a.checked ?? a.backstory, golden.result);
}

/** Where two bodies first part, for the failure's message. */
function firstDifference(theirs: Request, ours: Request | undefined): string {
  if (!ours) return "(v2 made none)";
  const a = JSON.stringify(theirs, null, 1).split("\n"), b = JSON.stringify(ours, null, 1).split("\n");
  const i = a.findIndex((line, k) => line !== b[k]);
  return i < 0 ? "(the same)" : `line ${i}:\n  prototype: ${a[i]?.slice(0, 400)}\n  v2:        ${b[i]?.slice(0, 400)}`;
}

function filesOf(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string) => { for (const name of readdirSync(at)) { const p = join(at, name); if (statSync(p).isDirectory()) walk(p); else files[relative(dir, p)] = readFileSync(p, "utf8"); } };
  walk(dir);
  return files;
}
