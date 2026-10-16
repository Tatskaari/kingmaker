import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fakeFetch, type FakeOptions, type Request } from "../../llm/fake-openrouter.ts";
import type { BackstoriesRequest, BackstoryOp } from "../../../shared/protocol/ai.ts";
import { creationKey } from "../../../shared/protocol/keys.ts";
import { callContext } from "../calls.ts";
import { campaigns } from "../campaigns.ts";
import type { AiContext } from "../context.ts";
import { folderStores } from "../folder-stores.ts";
import { canned } from "./canned.ts";
import { pipeline } from "./pipeline.ts";

/**
 * POST /v1/backstories (v1-design §3.7, §4.1): the four ops through the shared backstory code, on
 * the stand-in for OpenRouter, for the world in the campaign's creation block; with no model (the
 * canned GM's null); and with a model that fails. Each answer is the prototype's, as a 200.
 */

const CAERWYN = join(import.meta.dirname, "..", "..", "..", "campaigns", "caerwyn");
const UID = "7b2c3d4e-0000-4000-8000-0000000000b5";
const WHO = { name: "Tamsin Vell", concept: "a disgraced palace auditor with a ledger-keeper's eye", build: "halfling rogue 3 (Thief), criminal background" };
const NEPHEW = "I'm the King's nephew, though nobody at court will say so. I owe Fat Jory three crowns, and I've slept in the granary loft since the Treasury let me go.";

function filesOf(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string) => { for (const name of readdirSync(at)) { const p = join(at, name); if (statSync(p).isDirectory()) walk(p); else files[relative(dir, p)] = readFileSync(p, "utf8"); } };
  walk(dir);
  return files;
}

/** The campaign installed in a fresh store (its creation block changed by `world`, if given), and a request's context on the stand-in. */
async function setUp(options: FakeOptions = {}, world: (creation: Record<string, unknown>) => Record<string, unknown> = c => c) {
  const stores = folderStores(mkdtempSync(join(tmpdir(), "km-backstories-")));
  const files = filesOf(CAERWYN);
  const file = JSON.parse(files["campaign.json"]!) as { creation: Record<string, unknown> };
  files["campaign.json"] = JSON.stringify({ ...file, creation: world(file.creation) });
  const installed = campaigns(stores.campaigns, stores.docsRoot);
  await installed.put("caerwyn", "0.1.0", files);
  const fake = fakeFetch(options);
  const contextFor = (key: string): AiContext => {
    const { calls, usage } = callContext({ fetch: fake.fetch, apiKey: "test" }, stores, { game: UID, key, attempt: 1 });
    return { campaign: installed.use("caerwyn", "0.1.0"), calls, usage, attempt: 1, stream: () => { throw new Error("creation streams nothing"); } };
  };
  return { fake, contextFor };
}

const request = (op: BackstoryOp, text = op === "draft" ? "" : NEPHEW, rev = 1): BackstoriesRequest => ({ key: creationKey(UID, rev, op), game: { id: UID, campaign: "caerwyn", version: "0.1.0" }, op, who: WHO, text });

/** A Responses call's instructions and its one user message. */
const asked = (body: Request) => ({ instructions: body.instructions ?? "", input: body.input?.find(m => m.role === "user")?.content ?? "" });

test("draft: a backstory from who they are, for the campaign's world: its primer and premise, and the build's line", async () => {
  const { fake, contextFor } = await setUp({ byName: { backstory: { story: "I kept the Treasury's ledgers for nine years.\n\nThis morning the King asked me to see Prout done right by." } } }, c => ({ ...c, premise: "PREMISE: the King asked them this morning, once Prout was found." }));
  const req = request("draft");
  const answer = await pipeline.backstories(req, contextFor(req.key));

  const { instructions, input } = asked(fake.sent[0]!);
  assert.deepEqual(answer.asked, { ok: true, value: "I kept the Treasury's ledgers for nine years.\n\nThis morning the King asked me to see Prout done right by." });
  assert.match(instructions, /^You write a player character's backstory for a tabletop roleplaying game/);
  assert.match(input, /^## The player character\nTamsin Vell: a disgraced palace auditor with a ledger-keeper's eye\. In game terms: halfling rogue 3 \(Thief\), criminal background\./);
  assert.match(input, /## The world: Caerwyn\n/);
  assert.match(input, /## The story this backstory leads into\nPREMISE: the King asked them this morning, once Prout was found\.$/, "the campaign's premise, not the code's");
  assert.equal(answer.usage.byOperation["backstory.draft"]?.calls, 1);
});

test("work: the player's notes worked into a story, keeping their names and numbers; the build is left out of the prompt", async () => {
  const story = "I'm the King's nephew, though nobody at court will say so. I owe Fat Jory three crowns, and since the Treasury let me go I've slept in the granary loft.";
  const { fake, contextFor } = await setUp({ byName: { backstory: { story } } });
  const req = request("work");
  const answer = await pipeline.backstories(req, contextFor(req.key));

  assert.deepEqual(answer.asked, { ok: true, value: story });
  assert.equal(fake.sent.length, 1, "nothing left out, so asked once");
  assert.match(asked(fake.sent[0]!).input, /^## The player character\nTamsin Vell: a disgraced palace auditor with a ledger-keeper's eye\.\n\n## The player's notes, word for word\nI'm the King's nephew/);
});

test("check: what doesn't fit the world, each with a fix, the quote found in the story; the lore read is the world's public docs and the places it names", async () => {
  const issue = { quote: "i'm the KING'S nephew", problem: "The King has no nephew at court that the lore records.", fix: "I did the King's household accounts" };
  const { fake, contextFor } = await setUp({ byName: { lore_check: { issues: [issue] } } });
  const req = request("check");
  const answer = await pipeline.backstories(req, contextFor(req.key));

  const { input } = asked(fake.sent[0]!);
  assert.deepEqual(answer.checked, { ok: true, value: [{ quote: "I'm the King's nephew", problem: issue.problem, fix: issue.fix }] });
  assert.match(input, /### World\/Caerwyn\.md\n/);
  assert.match(input, /### Places\/Granary Yard\.md\n/, "the story names the granary");
  assert.doesNotMatch(input, /### Places\/Heron Warehouse\.md/, "nor the Heron");
  assert.doesNotMatch(input, /### World\/Fronts\.md/, "not canon");
  assert.match(input, /## Their backstory, word for word\nI'm the King's nephew/);
});

test("traits: what the backstory says of them, for the sheet and every brief", async () => {
  const traits = { summary: "Tamsin Vell, a sacked Treasury auditor and the King's unacknowledged nephew, owes Fat Jory three crowns.", personality: ["Exact", " "], ideals: ["Accounts should balance"], bonds: ["Fat Jory, to whom she owes three crowns"], flaws: ["Sleeps in a granary loft"] };
  const { contextFor } = await setUp({ byName: { traits } });
  const req = request("traits");
  const answer = await pipeline.backstories(req, contextFor(req.key));

  assert.deepEqual(answer.backstory, { text: NEPHEW, summary: traits.summary, personality: ["Exact"], ideals: traits.ideals, bonds: traits.bonds, flaws: traits.flaws });
  assert.equal(answer.usage.calls, 1);
});

test("with no model (the canned GM): no draft, nothing to work in, the backstory unchecked, its traits from the player's own words; no call made", async () => {
  const { fake, contextFor } = await setUp();
  const run = async (op: BackstoryOp) => canned.backstories(request(op), contextFor(request(op).key));

  assert.deepEqual((await run("draft")).asked, { ok: false, why: "The GM is offline, so there's nobody to ask: write it yourself, or skip it." });
  assert.deepEqual((await run("work")).asked, { ok: false, why: "The GM is offline, so there's nobody to ask: write it yourself, or skip it." });
  assert.deepEqual((await run("check")).checked, { ok: false, why: "The GM is offline, so nobody has checked it against the world: it goes in as you wrote it.", reason: "the GM is offline" });
  const traits = (await run("traits")).backstory!;
  assert.equal(traits.summary, `Tamsin Vell, in their own words: "I'm the King's nephew, though nobody at court will say so. I owe Fat Jory three crowns, and I've slept in the granary loft since the Treasury let me go."`);
  assert.deepEqual(traits.bonds, ["I owe Fat Jory three crowns, and I've slept in the granary loft since the Treasury let me go."]);
  assert.equal(fake.sent.length, 0);
});

test("with a model that fails: each op says why, as a 200 (the check goes in unchecked, the traits from their own words), and what it cost is in the usage", async () => {
  const { contextFor } = await setUp({ capped: { backstory: 0.001, lore_check: 0.001, traits: 0.001 } });
  const run = async (op: BackstoryOp) => pipeline.backstories(request(op), contextFor(request(op).key));

  const drafted = await run("draft");
  const checked = await run("check");
  const finished = await run("traits");

  assert.match(drafted.asked!.ok ? "" : drafted.asked!.why, /^The GM couldn't be reached \(OpenRouter backstory\.draft: response incomplete \(max_output_tokens\)\)\.$/);
  assert.deepEqual(checked.checked, { ok: false, why: "The GM couldn't be reached (OpenRouter backstory.check: response incomplete (max_output_tokens)). It goes in as you wrote it.", reason: "the GM couldn't be reached (OpenRouter backstory.check: response incomplete (max_output_tokens))" });
  assert.match(finished.backstory!.summary, /^Tamsin Vell, in their own words: /);
  assert.equal(drafted.usage.calls, 2, "tried once more, as the model client does, and both billed");
  assert.equal(Math.round(drafted.usage.costUsd * 1000), 2);
});
