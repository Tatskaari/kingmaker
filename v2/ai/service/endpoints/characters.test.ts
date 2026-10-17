import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fakeFetch, type FakeOptions, type Request } from "../../llm/fake-openrouter.ts";
import type { CharactersAsk, CharactersRequest } from "../../../shared/protocol/ai.ts";
import { creationKey, type CreationStep } from "../../../shared/protocol/keys.ts";
import { callContext } from "../calls.ts";
import { campaigns } from "../campaigns.ts";
import type { AiContext } from "../context.ts";
import { folderStores } from "../folder-stores.ts";
import { canned } from "./canned.ts";
import { pipeline } from "./pipeline.ts";

/** Each test's store, in a folder of this file's own that goes when its tests are done. */
const SCRATCH = mkdtempSync(join(tmpdir(), "km-characters-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

/**
 * POST /v1/characters (v1-design §3.7, §4.1) on the stand-in for OpenRouter: the model's three
 * made legal and made by the engine, a class it doubled made up from the defaults, the model
 * failing (the defaults, and a note saying why); the model's one; the player's own and its refusal,
 * with the lists to pick from and no model call; and the canned GM's offline answers.
 */

const CAERWYN = join(import.meta.dirname, "..", "..", "..", "campaigns", "caerwyn");
const UID = "8c3d4e5f-0000-4000-8000-0000000000c4";
const TAMSIN = { name: "Tamsin Vell", concept: "a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier" };

function filesOf(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string) => { for (const name of readdirSync(at)) { const p = join(at, name); if (statSync(p).isDirectory()) walk(p); else files[relative(dir, p)] = readFileSync(p, "utf8"); } };
  walk(dir);
  return files;
}

async function setUp(options: FakeOptions = {}) {
  const stores = folderStores(mkdtempSync(join(SCRATCH, "store-")));
  const installed = campaigns(stores.campaigns, stores.docs);
  await installed.put("caerwyn", "0.1.0", filesOf(CAERWYN));
  const fake = fakeFetch(options);
  const contextFor = (key: string): AiContext => {
    const { calls, usage } = callContext({ fetch: fake.fetch, apiKey: "test" }, stores, { game: UID, key, attempt: 1 });
    return { campaign: installed.use("caerwyn", "0.1.0"), calls, usage, attempt: 1, stream: () => { throw new Error("creation streams nothing"); } };
  };
  return { fake, contextFor };
}

const STEP: Record<CharactersAsk["kind"], CreationStep> = { three: "offer", one: "pick", own: "own" };
const request = (ask: CharactersAsk, who = TAMSIN): CharactersRequest => ({ key: creationKey(UID, 1, STEP[ask.kind]), game: { id: UID, campaign: "caerwyn", version: "0.1.0" }, who, level: 3, ask });

/** What a stand-in's suggestion for one build looks like. */
const suggested = (classId: string, rest: Record<string, unknown> = {}) => ({ classId, subclassId: "", speciesId: "human", backgroundId: "sage", abilities: [], skills: [], feat: "", cantrips: [], spells: [], weapons: [], armor: "none", shield: false, style: "", plays: `Plays as a ${classId}.`, ...rest });

test("three: the model's three (one call), each made legal by the engine, with its card", async () => {
  const { fake, contextFor } = await setUp({ byName: { builds: {
    first: suggested("rogue", { subclassId: "thief", speciesId: "halfling", backgroundId: "criminal", abilities: ["DEX", "INT"], skills: ["investigation", "insight"], weapons: ["rapier", "dagger"], armor: "leather-armor", plays: "Reads the ledgers, then the room." }),
    second: suggested("bard", { subclassId: "college-of-lore", speciesId: "human", backgroundId: "sage", abilities: ["CHA"], weapons: ["rapier"], armor: "leather-armor" }),
    third: suggested("wizard", { subclassId: "evoker", speciesId: "gnome", abilities: ["INT"] }),
  } } });
  const req = request({ kind: "three" });
  const answer = await pipeline.characters(req, contextFor(req.key));

  const body = fake.sent[0]! as Request;
  assert.equal(fake.sent.length, 1);
  assert.match(body.instructions!, /^You turn a tabletop character concept into three D&D \(2024 rules, SRD 5\.2\.1\) builds for a level 3 character/);
  assert.match(body.input![0]!.content, /^Character concept: Tamsin Vell: a disgraced palace auditor/);
  assert.equal(body.text?.format?.name, "builds");
  assert.equal(answer.offer!.note, undefined);
  assert.deepEqual(answer.offer!.options.map(o => [o.build.classId, o.from]), [["rogue", "model"], ["bard", "model"], ["wizard", "model"]]);
  const rogue = answer.offer!.options[0]!;
  assert.match(rogue.line, /^halfling rogue 3 \(Thief\), criminal background$/);
  assert.equal(rogue.plays, "Reads the ledgers, then the room.");
  assert.ok(rogue.card.hp > 0 && rogue.card.ac > 10 && rogue.card.attack, `HP ${rogue.card.hp}, AC ${rogue.card.ac}`);
  assert.equal(answer.usage.byOperation["rules.builds"]?.calls, 1);
});

test("three: a class the model doubled is made up from the class defaults the concept's words suggest", async () => {
  const { contextFor } = await setUp({ byName: { builds: { first: suggested("rogue"), second: suggested("rogue"), third: suggested("wizard") } } });
  const req = request({ kind: "three" });
  const answer = await pipeline.characters(req, contextFor(req.key));

  assert.deepEqual(answer.offer!.options.map(o => [o.build.classId, o.from]), [["rogue", "model"], ["wizard", "model"], ["bard", "defaults"]], "an auditor with a sharp tongue: the rogue, then the bard");
});

test("three: the model failing gives the class defaults, and a note saying the GM couldn't be reached and why", async () => {
  const { contextFor } = await setUp({ capped: { builds: 0.0005 } });
  const req = request({ kind: "three" });
  const answer = await pipeline.characters(req, contextFor(req.key));

  assert.equal(answer.offer!.note, "The GM couldn't be reached, so here are three from the class defaults that best match your words (OpenRouter rules.builds: response incomplete (max_output_tokens)).");
  assert.deepEqual(answer.offer!.options.map(o => o.from), ["defaults", "defaults", "defaults"]);
  assert.equal(answer.usage.calls, 2, "what it spent is still in the usage");
});

test("one: the model's own build for the concept, made legal, with its card and its class's line on how it plays", async () => {
  const { fake, contextFor } = await setUp({ byName: { build: suggested("ranger", { subclassId: "hunter", speciesId: "elf", backgroundId: "soldier", weapons: ["longbow", "shortsword"], armor: "studded-leather", abilities: ["DEX", "WIS"] }) } });
  const req = request({ kind: "one" }, { name: "Wren Ashdown", concept: "a quick-witted half-elf ranger with a longbow" });
  const answer = await pipeline.characters(req, contextFor(req.key));

  assert.deepEqual(fake.sent.map(b => b.text?.format?.name), ["build"]);
  assert.match(fake.sent[0]!.input![0]!.content, /^Character concept: Wren Ashdown: a quick-witted half-elf ranger with a longbow\n\n/);
  const option = answer.option!;
  assert.deepEqual([option.build.classId, option.build.style, option.from], ["ranger", "archery", "model"]);
  assert.match(option.line, /^elf ranger 3 \(Hunter\), soldier background$/);
  assert.ok(option.card.attack?.name, "a weapon to hit someone with");
  assert.equal(answer.offer, undefined);
});

test("own: the player's picks made legal by the engine, with the lists to pick from, and no model call", async () => {
  const { fake, contextFor } = await setUp();
  const req = request({ kind: "own", picks: { speciesId: "orc", classId: "rogue", subclassId: "thief", backgroundId: "criminal" } });
  const answer = await pipeline.characters(req, contextFor(req.key));

  assert.deepEqual([answer.option!.build.speciesId, answer.option!.build.classId, answer.option!.build.subclassId, answer.option!.from], ["orc", "rogue", "thief", "own"]);
  assert.equal(answer.lists!.classes.length, 12);
  assert.equal(answer.lists!.level, 3);
  assert.equal(answer.refusal, undefined);
  assert.equal(fake.sent.length, 0);
  assert.equal(answer.usage.calls, 0);
});

test("own: a pick that isn't on the SRD's lists is refused in its words, saying what is, with the lists", async () => {
  const { contextFor } = await setUp();
  const req = request({ kind: "own", picks: { speciesId: "elf", classId: "necromancer", backgroundId: "soldier" } });
  const answer = await pipeline.characters(req, contextFor(req.key));

  assert.match(answer.refusal!, /^No class "necromancer" in the SRD: one of barbarian, bard/);
  assert.equal(answer.option, undefined);
  assert.equal(answer.lists!.species.length, 9);
});

test("canned (no model): three from the class defaults with the offline note, the one settleBuild's fallbacks make, the player's own made", async () => {
  const { fake, contextFor } = await setUp();
  const run = (ask: CharactersAsk) => canned.characters(request(ask), contextFor(request(ask).key));

  const offer = (await run({ kind: "three" })).offer!;
  const one = (await run({ kind: "one" })).option!;
  const own = (await run({ kind: "own", picks: { speciesId: "gnome", classId: "wizard", subclassId: "evoker", backgroundId: "sage" } })).option!;

  assert.equal(offer.note, "The GM is offline: three from the class defaults that best match your words.");
  assert.deepEqual(offer.options.map(o => o.build.classId), ["rogue", "bard", "fighter"]);
  assert.deepEqual([one.build.classId, one.from], ["rogue", "defaults"]);
  assert.match(own.line, /^gnome wizard 3 \(Evoker\), sage background$/);
  assert.equal(fake.sent.length, 0);
});

test("a request it can't read is a 400: no name, a level out of range, picks that aren't ids, an ask that isn't the key's step's", async () => {
  const { contextFor } = await setUp();
  const status = async (req: CharactersRequest) => {
    try { await pipeline.characters(req, contextFor(req.key)); return 200; } catch (error) { return (error as { status?: number }).status ?? 500; }
  };

  assert.equal(await status({ ...request({ kind: "three" }), who: { name: " ", concept: "x" } }), 400);
  assert.equal(await status({ ...request({ kind: "three" }), level: 0 }), 400);
  assert.equal(await status(request({ kind: "own", picks: { speciesId: "elf", classId: 7, backgroundId: "sage" } as never })), 400);
  assert.equal(await status({ ...request({ kind: "three" }), ask: { kind: "one" } }), 400);
});
