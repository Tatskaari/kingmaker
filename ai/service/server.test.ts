import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type {
  AiRequest, BackstoriesRequest, BackstoryOp, BoundaryRequest, BoundaryResponse, CharactersRequest, Entry, OpenRequest, ReactionsRequest, ReplyRequest, ReplyResponse,
  SettleRequest, SuggestRequest, SuggestResponse, TurnContext,
} from "../../shared/protocol/ai.ts";
import { creationKey } from "../../shared/protocol/keys.ts";
import { initialGm } from "../../shared/gm/state.ts";
import { withTestClerk } from "../gm/fixtures.ts";
import { campaigns } from "./campaigns.ts";
import { readConfig } from "./config.ts";
import { Failure, type Endpoints } from "./context.ts";
import { canned } from "./endpoints/canned.ts";
import { pipeline } from "./endpoints/pipeline.ts";
import { folderStores } from "./folder-stores.ts";
import { respond } from "../llm/openrouter.ts";
import { aiService, KEY_REFUSED, type AiHttpRequest, type ServiceOptions } from "./server.ts";

const CAERWYN = join(import.meta.dirname, "..", "..", "campaigns", "caerwyn");
const TOKEN = "the-bearer";
const GAME = "5f0c2b7e-0000-4000-8000-000000000001";

/** Every test's store is a folder in this one, removed once the file's tests are done (a store holds a whole campaign: left behind, a run's worth fills a tmpfs's inodes in a few hundred runs). */
const SCRATCH = mkdtempSync(join(tmpdir(), "km-ai-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** A campaign folder as the install tool PUTs it: every file, by its path in the folder. */
function filesOf(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(dir, path)] = readFileSync(path, "utf8");
    }
  };
  walk(dir);
  return files;
}

/** A service on a fresh store, its endpoints counting what they're asked (canned answers), its exits recorded. */
function service(overrides: Partial<ServiceOptions> & { slowMs?: number } = {}) {
  const stores = folderStores(mkdtempSync(join(SCRATCH, "store-")));
  const ran: string[] = [];
  const exits: number[] = [];
  const lines: string[] = [];
  const counted = Object.fromEntries(Object.entries(canned).map(([step, handler]) => [step, async (req: unknown, ctx: Parameters<typeof handler>[1]) => {
    ran.push(step);
    if (overrides.slowMs) await new Promise(resolve => setTimeout(resolve, overrides.slowMs));
    return (handler as (r: unknown, c: typeof ctx) => Promise<unknown>)(req, ctx);
  }])) as unknown as Endpoints;
  const ai = aiService({
    token: TOKEN, stores, campaigns: campaigns(stores.campaigns, stores.docs), endpoints: counted,
    transport: () => ({}), stream: { url: "http://127.0.0.1:9", db: "kingmaker", periodMs: 200 },
    serves: { model: "fake", gm: "canned" }, faults: {}, log: line => lines.push(line), exit: code => exits.push(code),
    ...overrides,
  });
  return { ai, stores, ran, exits, lines };
}

const put = (version = "0.1.0", files = withTestClerk(filesOf(CAERWYN))): AiHttpRequest => ({ method: "PUT", path: `/v1/campaigns/caerwyn/${version}`, headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ files }) });

/** What every turn's think is sent: the game, the player, and the turn (its scene, the bookkeeping, the line, the world, the party). */
function turnParts(n = 1, text = "Sergeant, who found him?"): { game: AiRequest["game"]; player: AiRequest["player"]; turn: TurnContext } {
  const gm = initialGm({ start: "yard" });
  return {
    game: { id: GAME, campaign: "caerwyn", version: "0.1.0" }, player: { id: "1", name: "Wren Ashdown" },
    turn: {
      scene: { id: "1", key: "hanged-clerk", kind: "scene", turn: n }, pc: "pc:1", gm, transcript: [{ turn: n, speaker: "player:1", kind: "player", text }],
      line: { speaker: "player:1", text }, world: { place: { id: "1", key: "granary-yard", name: "The granary yard", rootId: "2", sizeW: 40, sizeH: 30, round: 0, rev: 1 }, entity: [], position: [], area: [], material: [], health: [], stack: [], surface: [], creature: [], playerCharacter: [], gear: [], narrative: [], gmNote: [], worldLog: [] },
      party: [{ name: "Wren Ashdown", concept: "a hedge wizard", skills: {} }], present: [], story: { time: "morning", day: 1, flags: {} },
    },
  };
}

function openRequest(): OpenRequest {
  const { turn } = turnParts();
  return { key: `${GAME}:s1:t0:open`, game: { id: GAME, campaign: "caerwyn", version: "0.1.0" }, player: { id: "1", name: "Wren" }, scene: { id: "1", key: "hanged-clerk", kind: "scene" }, pc: "pc:1", gm: turn.gm, world: turn.world, party: turn.party, story: turn.story, stream: { turn: "1" } };
}

function replyRequest(n = 1): ReplyRequest {
  const { game, player, turn } = turnParts(n);
  return { key: `${GAME}:s1:t${n}:reply`, game, player, turn, outcome: { lines: [], directives: [] }, stream: { turn: "2" } };
}

/** The reactions to what the rules decided the player did (world-bridge-design §3.1). */
function reactionsRequest(n = 1): ReactionsRequest {
  const { game, player, turn } = turnParts(n);
  return { key: `${GAME}:s1:t${n}:reactions`, game, player, turn, act: { what: "cast Burning Hands at Sergeant Agnes Kell, setting the yard gate burning or breaking it", victims: ["kell"], property: ["gate"] } };
}

/** A turn's settle (the two-part GM's co-GM, after the reply): the think these tests ask of a turn when any would do. */
function settleRequest(n = 1, text?: string): SettleRequest {
  const { game, player, turn } = turnParts(n, text);
  return { key: `${GAME}:s1:t${n}:settle`, game, player, turn, reply: "Kell looks up.", lines: [], settled: [] };
}

function suggestRequest(n = 1): SuggestRequest {
  const { game, player, turn: { line: _, ...turn } } = turnParts(n);
  return { key: `${GAME}:s1:t${n}:suggest`, game, player, turn, offered: [] };
}

/** A request with one part taken out (a dotted path, "turn.line"), as a sender with a bug might send it. */
function without<T extends { key: string }>(request: T, path: string): T {
  const copy = structuredClone(request) as unknown as Record<string, Record<string, unknown>>;
  const parts = path.split(".");
  const parent = parts.slice(0, -1).reduce<Record<string, unknown>>((at, part) => at[part] as Record<string, unknown>, copy);
  delete parent[parts.at(-1)!];
  return copy as unknown as T;
}

/** A creation's backstory step, as the simulation sends it (a creation's uid is its game's id). */
const UID = "6a1b2c3d-0000-4000-8000-0000000000c1";
function backstoriesRequest(op: BackstoryOp = "draft", rev = 1): BackstoriesRequest {
  return { key: creationKey(UID, rev, op), game: { id: UID, campaign: "caerwyn", version: "0.1.0" }, op, who: { name: "Tamsin Vell", concept: "a disgraced palace auditor", build: "halfling rogue 3 (Thief), criminal background" }, text: op === "draft" ? "" : "I owe Fat Jory three crowns." };
}

/** A creation's three builds, as the simulation asks for them (with any part changed, as a sender with a bug might send it). */
function charactersRequest(changes: Partial<CharactersRequest> = {}): CharactersRequest {
  return { key: creationKey(UID, 2, "offer"), game: { id: UID, campaign: "caerwyn", version: "0.1.0" }, who: { name: "Tamsin Vell", concept: "a disgraced palace auditor" }, level: 3, ask: { kind: "three" }, ...changes };
}

function post(path: string, body: { key: string }, headers: Record<string, string> = {}): AiHttpRequest {
  return { method: "POST", path, headers: { authorization: `Bearer ${TOKEN}`, "idempotency-key": body.key, "x-km-attempt": "1", ...headers }, body: JSON.stringify(body) };
}

test("health needs no bearer, and says whether the one it got is accepted", async () => {
  const { ai } = service();
  const ask = async (authorization?: string) => JSON.parse((await ai.answer({ method: "GET", path: "/v1/health", headers: { authorization }, body: "" })).body);

  assert.deepEqual(await ask(), { ok: true, model: "fake", gm: "canned", campaigns: [], token: "absent", budget: { dailyUsd: 0, spentToday: 0 } });
  assert.equal((await ask("Bearer wrong")).token, "refused");
  assert.equal((await ask(`Bearer ${TOKEN}`)).token, "accepted");
});

test("every other route wants the bearer", async () => {
  const { ai } = service();
  const unauthorised = await ai.answer({ ...post("/v1/turns/settle", settleRequest()), headers: { "idempotency-key": settleRequest().key } });
  const wrong = await ai.answer(post("/v1/turns/settle", settleRequest(), { authorization: "Bearer nope" }));

  assert.equal(unauthorised.status, 401);
  assert.equal(JSON.parse(unauthorised.body).error.code, "unauthorised");
  assert.equal(wrong.status, 401);
  assert.equal((await ai.answer({ ...put(), headers: {} })).status, 401);
});

test("a campaign PUT installs every file, loads its scenes with their words, and shows in health", async () => {
  const { ai } = service();
  const answer = await ai.answer(put());
  const health = JSON.parse((await ai.answer({ method: "GET", path: "/v1/health", headers: {}, body: "" })).body);

  assert.equal(answer.status, 200);
  assert.deepEqual(JSON.parse(answer.body), { campaign: "caerwyn", version: "0.1.0", files: Object.keys(withTestClerk(filesOf(CAERWYN))).length, scenes: ["hanged-clerk", "caerwyn-afternoon", "drowned-rat", "wharf-night", "heron-warehouse", "kings-morning"] });
  assert.deepEqual(health.campaigns, ["caerwyn@0.1.0"]);
});

test("a campaign whose scene doesn't load, or whose paths climb out, is a 400 and isn't installed", async () => {
  const { ai } = service();
  const files = withTestClerk(filesOf(CAERWYN));
  const clerk = JSON.parse(files["scenes/hanged-clerk.kmscene"]!) as { cast: Array<Record<string, unknown>> };
  delete clerk.cast[0]!.voice;
  const broken = await ai.answer(put("0.1.0", { ...files, "scenes/hanged-clerk.kmscene": JSON.stringify(clerk) }));
  const missing = await ai.answer(put("0.1.0", Object.fromEntries(Object.entries(files).filter(([path]) => path !== "scenes/drowned-rat.kmscene"))));
  const climbing = await ai.answer(put("0.1.0", { ...withTestClerk(filesOf(CAERWYN)), "../outside.md": "no" }));

  assert.equal(broken.status, 400);
  assert.match(JSON.parse(broken.body).error.message, /^scene hanged-clerk doesn't load: scenes\/hanged-clerk\.kmscene: cast\[0\] \(kell\) has no voice/);
  assert.equal(missing.status, 400);
  assert.match(JSON.parse(missing.body).error.message, /^scene drowned-rat doesn't load: no scenes\/drowned-rat\.kmscene/);
  assert.equal(climbing.status, 400);
  assert.equal(JSON.parse((await ai.answer({ method: "GET", path: "/v1/health", headers: {}, body: "" })).body).campaigns.length, 0);
});

test("a campaign without the world a backstory is written for, or whose places' words don't compile, is a 400", async () => {
  const { ai } = service();
  const files = withTestClerk(filesOf(CAERWYN));
  const file = JSON.parse(files["caerwyn.kmscenario"]!) as { creation: { places: unknown[] } };
  const unwritten = await ai.answer(put("0.1.0", { ...files, "caerwyn.kmscenario": JSON.stringify({ ...file, creation: { ...file.creation, primer: undefined } }) }));
  const broken = await ai.answer(put("0.1.0", { ...files, "caerwyn.kmscenario": JSON.stringify({ ...file, creation: { ...file.creation, places: [{ doc: "Places/Granary Yard.md", words: "\\b(granary" }] } }) }));

  assert.equal(unwritten.status, 400);
  assert.match(JSON.parse(unwritten.body).error.message, /the scenario's creation isn't/);
  assert.equal(broken.status, 400);
});

test("a campaign whose vocabulary.json doesn't read as the story reads it is a 400 and isn't installed", async () => {
  const { ai } = service();
  const vocabulary = JSON.parse(withTestClerk(filesOf(CAERWYN))["vocabulary.json"]!) as { scenes: Array<Record<string, unknown>> };
  const withVocabulary = (text: string) => put("0.1.0", { ...withTestClerk(filesOf(CAERWYN)), "vocabulary.json": text });
  const answers = [
    await ai.answer(withVocabulary("{")),
    await ai.answer(withVocabulary("{}")),
    await ai.answer(withVocabulary(JSON.stringify({ ...vocabulary, scenes: vocabulary.scenes.map((e, i) => (i === 1 ? { ...e, prep: undefined, next: "wharf-night" } : e)) }))),
  ];

  assert.deepEqual(answers.map(a => `${a.status} ${JSON.parse(a.body).error.code}`), Array(3).fill("400 bad_request"));
  const [garbled, shapeless, entry] = answers.map(a => JSON.parse(a.body).error.message as string);
  assert.match(garbled!, /^vocabulary\.json isn't JSON: /);
  assert.equal(shapeless, "vocabulary.json: isn't { source, scenes: [...] }");
  assert.match(entry!, /^vocabulary\.json: scenes\[1\] \([a-z-]+\): next isn't a list of scene ids; vocabulary\.json: scenes\[1\] \([a-z-]+\): no prep$/);
  assert.equal(JSON.parse((await ai.answer({ method: "GET", path: "/v1/health", headers: {}, body: "" })).body).campaigns.length, 0);
  assert.equal((await ai.answer(put())).status, 200, "the campaign as it is installs");
});

test("a think is answered once by its key: the same POST again comes from the store, with no model call", async () => {
  const { ai, ran } = service();
  await ai.answer(put());
  const first = await ai.answer(post("/v1/turns/settle", settleRequest()));
  const again = await ai.answer(post("/v1/turns/settle", settleRequest(), { "x-km-attempt": "2" }));

  assert.equal(first.status, 200);
  assert.equal(first.headers["x-km-replayed"], undefined);
  assert.equal(again.status, 200);
  assert.equal(again.headers["x-km-replayed"], "1");
  assert.equal(again.body, first.body);
  assert.deepEqual(ran, ["settle"]);
});

test("an answer kept under node:crypto's hash of its request is still found by Web Crypto's: the same hex", async () => {
  const { ai, stores, ran } = service();
  await ai.answer(put());
  const request = post("/v1/turns/settle", settleRequest());
  await stores.answers.put(settleRequest().key, { requestHash: createHash("sha256").update(request.body).digest("hex"), status: 200, body: '{"kept":true}', at: new Date().toISOString() });
  const answer = await ai.answer(request);

  assert.equal(answer.status, 200);
  assert.equal(answer.headers["x-km-replayed"], "1");
  assert.equal(answer.body, '{"kept":true}');
  assert.deepEqual(ran, []);
});

test("a duplicate that comes while the first is still running joins it: one run, one answer", async () => {
  const { ai, ran } = service({ slowMs: 50 });
  await ai.answer(put());
  const [a, b] = await Promise.all([ai.answer(post("/v1/turns/settle", settleRequest())), ai.answer(post("/v1/turns/settle", settleRequest(), { "x-km-attempt": "2" }))]);

  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.body, b.body);
  assert.deepEqual(ran, ["settle"]);
});

test("the same key with another request is 409 key_reused, stored or still running", async () => {
  const { ai } = service({ slowMs: 30 });
  await ai.answer(put());
  const running = ai.answer(post("/v1/turns/settle", settleRequest()));
  const meanwhile = await ai.answer(post("/v1/turns/settle", settleRequest(1, "Something else entirely")));
  await running;
  const afterwards = await ai.answer(post("/v1/turns/settle", settleRequest(1, "Something else again")));

  assert.equal(meanwhile.status, 409);
  assert.equal(JSON.parse(meanwhile.body).error.code, "key_reused");
  assert.equal(afterwards.status, 409);
});

test("what can't be answered is a 400: unreadable, a key that isn't the header's or the endpoint's, a campaign not installed, a scene it hasn't got", async () => {
  const { ai } = service();
  const code = async (request: AiHttpRequest) => { const r = await ai.answer(request); return `${r.status} ${JSON.parse(r.body).error.code}`; };
  const notInstalled = await code(post("/v1/turns/settle", settleRequest()));
  await ai.answer(put());
  const open: OpenRequest = { key: `${GAME}:s1:t0:open`, game: { id: GAME, campaign: "caerwyn", version: "0.1.0" }, player: { id: "1", name: "Wren" }, scene: { id: "1", key: "no-such-scene", kind: "scene" }, pc: "pc:1", gm: initialGm({ start: "yard" }), world: turnParts().turn.world, party: turnParts().turn.party, story: turnParts().turn.story, stream: { turn: "1" } };

  assert.equal(notInstalled, "400 bad_request");
  assert.equal(await code({ ...post("/v1/turns/settle", settleRequest()), body: "{not json" }), "400 bad_request");
  assert.equal(await code(post("/v1/turns/settle", settleRequest(), { "idempotency-key": "someone-else:s1:t1:settle" })), "400 bad_request");
  assert.equal(await code(post("/v1/turns/reply", settleRequest())), "400 bad_request");
  assert.equal(await code(post("/v1/scenes/open", open)), "400 bad_request");
  assert.equal(await code({ method: "GET", path: "/v1/nowhere", headers: {}, body: "" }), "404 bad_request");
});

test("a creation's step is a think too, answered by its key: the same POST again comes from the store", async () => {
  const { ai, ran, lines } = service();
  await ai.answer(put());
  const first = await ai.answer(post("/v1/backstories", backstoriesRequest("check")));
  const again = await ai.answer(post("/v1/backstories", backstoriesRequest("check"), { "x-km-attempt": "2" }));

  assert.equal(first.status, 200);
  assert.deepEqual(JSON.parse(first.body).checked, { ok: false, why: "The GM is offline, so nobody has checked it against the world: it goes in as you wrote it.", reason: "the GM is offline" });
  assert.equal(again.headers["x-km-replayed"], "1");
  assert.equal(again.body, first.body);
  assert.deepEqual(ran, ["backstories"]);
  assert.ok(lines.some(l => l.startsWith(`[ai] check ${UID}:c1:check attempt 1: 200`)), "logged by its step");
});

test("a key is for its step's endpoint: a creation's step at a scene's endpoint, or at the other creation endpoint, is a 400, and so is an op that isn't the key's", async () => {
  const { ai, ran } = service();
  await ai.answer(put());
  const code = async (request: AiHttpRequest) => { const r = await ai.answer(request); return `${r.status} ${JSON.parse(r.body).error?.code ?? "answered"}`; };

  assert.equal(await code(post("/v1/characters", backstoriesRequest("draft"))), "400 bad_request");
  assert.equal(await code(post("/v1/turns/settle", backstoriesRequest("draft"))), "400 bad_request");
  assert.equal(await code(post("/v1/backstories", settleRequest())), "400 bad_request");
  assert.equal(await code(post("/v1/backstories", { ...backstoriesRequest("check"), op: "draft" } as BackstoriesRequest)), "400 bad_request");
  assert.equal(await code(post("/v1/backstories", { ...backstoriesRequest("work"), who: { concept: "nobody" } } as unknown as BackstoriesRequest)), "400 bad_request");
  assert.deepEqual(ran, [], "the op and who are checked before the endpoint runs, as a scene's request is");
});

test("exit-after-store names a creation's step too", async () => {
  const { ai, stores, exits } = service({ faults: { exitAfterStore: "traits" } });
  await ai.answer(put());
  await ai.answer(post("/v1/backstories", backstoriesRequest("check")));
  await ai.answer(post("/v1/backstories", backstoriesRequest("traits")));

  assert.deepEqual(exits, [137]);
  assert.ok(await stores.answers.get(backstoriesRequest("traits").key));
});

test("past the daily ceiling, a think that would call a model is 402 over_budget before it runs, in the words the game shows; one it can't read is still a 400", async () => {
  const { ai, stores, ran } = service({ serves: { model: "fake", gm: "pipeline" }, dailyUsd: 5 });
  await ai.answer(put());
  stores.ledger.append({ at: new Date().toISOString(), operation: "gm.reply", costUsd: 5 });
  const settled = await ai.answer(post("/v1/turns/settle", settleRequest()));
  const drafted = await ai.answer(post("/v1/backstories", backstoriesRequest("draft")));
  const unread = [
    await ai.answer(post("/v1/turns/settle", without(settleRequest(2), "turn.line"))),
    await ai.answer(post("/v1/backstories", { ...backstoriesRequest("work"), who: { concept: "nobody" } } as unknown as BackstoriesRequest)),
    await ai.answer(post("/v1/characters", charactersRequest({ level: 0 }))),
  ];

  assert.equal(settled.status, 402);
  assert.deepEqual(JSON.parse(settled.body), { error: { code: "over_budget", message: "The GM has spent today's budget ($5.00): it starts again at midnight UTC, or raise KM_AI_DAILY_USD." } });
  assert.equal(drafted.status, 402);
  assert.deepEqual(unread.map(r => `${r.status} ${JSON.parse(r.body).error.code}`), Array(3).fill("400 bad_request"), "a scene's and a creation's alike");
  assert.deepEqual(ran, [], "no endpoint ran");
  assert.equal(await stores.answers.get(settleRequest().key), undefined, "nothing kept: the move fails, and /retry asks again");
});

test("past the ceiling, the host's own words for it are what the game shows (the page's: its browser's ceiling)", async () => {
  const words = "The GM has spent today's budget in this browser ($5.00): it starts again at midnight UTC.";
  const { ai, stores } = service({ serves: { model: "fake", gm: "pipeline" }, dailyUsd: 5, overBudget: words });
  await ai.answer(put());
  stores.ledger.append({ at: new Date().toISOString(), operation: "gm.reply", costUsd: 5 });
  const settled = await ai.answer(post("/v1/turns/settle", settleRequest()));

  assert.deepEqual([settled.status, JSON.parse(settled.body)], [402, { error: { code: "over_budget", message: words } }]);
});

test("past the ceiling, a kept answer is still served, and what calls no model still runs: own's step, the canned GM", async () => {
  const overSpent = async (overrides: Partial<ServiceOptions>) => {
    const made = service({ dailyUsd: 1, ...overrides });
    await made.ai.answer(put());
    return { ...made, spend: () => made.stores.ledger.append({ at: new Date().toISOString(), costUsd: 3 }) };
  };
  const pipelined = await overSpent({ serves: { model: "fake", gm: "pipeline" } });
  const first = await pipelined.ai.answer(post("/v1/turns/settle", settleRequest()));
  pipelined.spend();
  const kept = await pipelined.ai.answer(post("/v1/turns/settle", settleRequest(), { "x-km-attempt": "2" }));

  const own = { key: creationKey(UID, 4, "own"), game: { id: UID, campaign: "caerwyn", version: "0.1.0" }, who: { name: "Pell Marrow", concept: "a hedge-wizard" }, level: 3, ask: { kind: "own", picks: { speciesId: "gnome", classId: "wizard", subclassId: "evoker", backgroundId: "sage" } } };
  const owning = await overSpent({ serves: { model: "fake", gm: "pipeline" }, endpoints: { ...canned, characters: async () => ({ refusal: "a stand-in's", usage: { calls: 0, costUsd: 0, byOperation: {} } }) } });
  owning.spend();
  const cannedGm = await overSpent({});
  cannedGm.spend();

  assert.equal(first.status, 200);
  assert.equal(kept.status, 200);
  assert.equal(kept.headers["x-km-replayed"], "1");
  assert.equal((await owning.ai.answer(post("/v1/characters", own))).status, 200);
  assert.equal((await cannedGm.ai.answer(post("/v1/backstories", backstoriesRequest("traits")))).status, 200);
});

test("health says what the ceiling is and what today's calls have cost", async () => {
  const { ai, stores } = service({ dailyUsd: 5 });
  stores.ledger.append({ at: new Date().toISOString(), costUsd: 0.0123 });
  stores.ledger.append({ at: new Date().toISOString(), costUsd: 0.0002 });

  assert.deepEqual(JSON.parse((await ai.answer({ method: "GET", path: "/v1/health", headers: {}, body: "" })).body).budget, { dailyUsd: 5, spentToday: 0.0125 });
});

test("a version other than the one served is 409 other_campaign: the docs service has one lore root", async () => {
  const { ai } = service();
  await ai.answer(put());
  const files = withTestClerk(filesOf(CAERWYN));
  files["caerwyn.kmscenario"] = files["caerwyn.kmscenario"]!.replace('"0.1.0"', '"0.2.0"');
  const other = await ai.answer(put("0.2.0", files));

  assert.equal(other.status, 409);
  assert.equal(JSON.parse(other.body).error.code, "other_campaign");
});

test("anything an endpoint throws but a refusal is 500 model_failed, and nothing is stored", async () => {
  const failing: Endpoints = { ...canned, settle: async () => { throw new Error("OpenRouter director.before HTTP 502"); } };
  const { ai, stores } = service({ endpoints: failing });
  await ai.answer(put());
  const answer = await ai.answer(post("/v1/turns/settle", settleRequest()));

  assert.equal(answer.status, 500);
  assert.deepEqual(JSON.parse(answer.body), { error: { code: "model_failed", message: "OpenRouter director.before HTTP 502" } });
  assert.equal(await stores.answers.get(settleRequest().key), undefined);
});

test("OpenRouter turning the key down is 403 key_refused, in the host's words for the player: asked once, and nothing stored", async () => {
  const asked: string[] = [];
  const refusing: typeof fetch = async input => {
    asked.push(String(input));
    return new Response('{"error":{"message":"User not found.","code":401}}', { status: 401 });
  };
  const calling: Endpoints = { ...canned, settle: async (_req, ctx) => { await respond({ operation: "director.before", input: [{ role: "user", content: "Who found him?" }], calls: ctx.calls }); throw new Error("the model answered"); } };
  const page = service({ endpoints: calling, transport: () => ({ apiKey: "sk-or-v1-turned-down", fetch: refusing }), keyRefused: "OpenRouter turned the key down: change it from the bar under the game." });
  const own = service({ endpoints: calling, transport: () => ({ apiKey: "sk-or-v1-turned-down", fetch: refusing }) });
  await page.ai.answer(put());
  await own.ai.answer(put());
  const answer = await page.ai.answer(post("/v1/turns/settle", settleRequest()));

  assert.equal(answer.status, 403);
  assert.deepEqual(JSON.parse(answer.body), { error: { code: "key_refused", message: "OpenRouter turned the key down: change it from the bar under the game." } });
  assert.deepEqual(asked, ["https://openrouter.ai/api/v1/responses"], "never asked again");
  assert.equal(await page.stores.answers.get(settleRequest().key), undefined);
  assert.equal(JSON.parse((await own.ai.answer(post("/v1/turns/settle", settleRequest()))).body).error.message, KEY_REFUSED, "a key that's the service's own: its own words");
});

test("a refusal an endpoint throws keeps its own status", async () => {
  const refusing: Endpoints = { ...canned, settle: async () => { throw new Failure(400, "bad_request", "no such route"); } };
  const { ai } = service({ endpoints: refusing });
  await ai.answer(put());

  assert.equal((await ai.answer(post("/v1/turns/settle", settleRequest()))).status, 400);
});

test("exit-after-store: the process exits (137) with the answer stored and not sent", async () => {
  const { ai, stores, exits, lines } = service({ faults: { exitAfterStore: "settle" } });
  await ai.answer(put());
  await ai.answer(post("/v1/turns/settle", settleRequest()));

  assert.deepEqual(exits, [137]);
  assert.ok(await stores.answers.get(settleRequest().key));
  assert.ok(lines.some(l => /exit-after-store/.test(l)));
});

test("the reactions to the player's violence (world-bridge-design §3.1): without the act it's a 400; the canned GM has nobody react, kept by the key; exit-after-store names the step", async () => {
  const { ai, stores, exits } = service({ faults: { exitAfterStore: "reactions" } });
  await ai.answer(put());
  const missing = await ai.answer(post("/v1/turns/reactions", without(reactionsRequest(), "act")));
  const answer = await ai.answer(post("/v1/turns/reactions", reactionsRequest()));

  assert.equal(missing.status, 400);
  assert.match(JSON.parse(missing.body).error.message, /act \{ what, victims, property \}/);
  assert.equal(answer.status, 200);
  assert.deepEqual(JSON.parse(answer.body), { reactions: {}, usage: { calls: 0, costUsd: 0, byOperation: {} } });
  assert.deepEqual(exits, [137]);
  assert.ok(await stores.answers.get(reactionsRequest().key));
  assert.deepEqual(readConfig({ KM_AI_TOKEN: "t", KM_AI_FAULTS: "exit-after-store:reactions" }).faults, { exitAfterStore: "reactions" });
});

test("shutting down, it takes nothing new: 503 not_ready", async () => {
  const { ai } = service();
  await ai.answer(put());
  await ai.shutdown(10);
  const answer = await ai.answer(post("/v1/turns/settle", settleRequest()));

  assert.equal(answer.status, 503);
  assert.equal(JSON.parse(answer.body).error.code, "not_ready");
});

test("shutting down over HTTP: a think in flight is answered before the shutdown is over, so a process that exits then has sent it", async () => {
  const { ai, ran } = service({ slowMs: 300 });
  await ai.answer(put());
  const server = createServer((req, res) => ai.handle(req, res));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const request = post("/v1/turns/settle", settleRequest());
  try {
    const asked = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/turns/settle`, { method: "POST", headers: request.headers as Record<string, string>, body: request.body });
    while (!ran.length) await new Promise(resolve => setTimeout(resolve, 5));

    await ai.shutdown(10_000);
    server.closeAllConnections(); // what process.exit does to the sockets, at the moment hosts/ai.ts calls it

    const answered = await asked;
    assert.equal(answered.status, 200);
    assert.deepEqual((await answered.json() as { coGm: unknown }).coGm, { roles: {}, moves: [], log: [] });
  } finally {
    server.close();
  }
});

test("over HTTP on node's server (port 0): the same answers, and a body over its limit is a 413", async () => {
  const { ai } = service();
  const server = createServer((req, res) => ai.handle(req, res));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const health = await fetch(`${base}/v1/health`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const installed = await fetch(`${base}/v1/campaigns/caerwyn/0.1.0`, { method: "PUT", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: put().body });
    const settled = await fetch(`${base}/v1/turns/settle`, { method: "POST", headers: post("/v1/turns/settle", settleRequest()).headers as Record<string, string>, body: JSON.stringify(settleRequest()) });
    const huge = await fetch(`${base}/v1/turns/settle`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: "x".repeat(3 << 20) });

    assert.deepEqual([health.status, (await health.json() as { token: string }).token], [200, "accepted"]);
    assert.equal(installed.status, 200);
    assert.equal(settled.status, 200);
    assert.deepEqual((await settled.json() as { coGm: unknown }).coGm, { roles: {}, moves: [], log: [] });
    assert.equal(huge.status, 413);
  } finally {
    server.close();
  }
});

test("canned: someone of the cast says a line in each reply, and the same four lines are suggested", async () => {
  const { ai } = service();
  await ai.answer(put());
  const { line: _, ...scene } = turnParts(1).turn;
  const reply: ReplyRequest = { ...turnParts(1), key: `${GAME}:s1:t1:reply`, outcome: { lines: [], directives: [] }, stream: { turn: "4" } };
  const said = (JSON.parse((await ai.answer(post("/v1/turns/reply", reply))).body) as ReplyResponse).entries[0]!;
  const suggest: SuggestRequest = { key: `${GAME}:s1:t1:suggest`, game: reply.game, player: reply.player, turn: { ...scene, transcript: [...scene.transcript, { turn: 1, ...said }] }, offered: [] };
  const suggested = JSON.parse((await ai.answer(post("/v1/turns/suggest", suggest))).body) as SuggestResponse;
  const again = await ai.answer(post("/v1/turns/suggest", { ...suggest, key: `${GAME}:s1:t1:suggest-2` }));

  assert.equal(said.text, "You said: “Sergeant, who found him?” “Go on, then,” says the boy in the too-big boots. (Canned: no model was asked.)");
  assert.deepEqual(said.markup!.speech.map(s => [said.text.slice(s.start, s.end), s.speaker]), [["“Sergeant, who found him?”", "you"], ["“Go on, then,”", "cob"]]);
  assert.deepEqual(suggested.lines.map(l => l.kind), ["say", "say", "do", "try"]);
  assert.equal(again.status, 200, "a second ask of the same turn has a key of its own");
});

test("canned: the story goes to the first scene it could, with the prototype's fallback hand-off and the scene's last moments (story-design §4.4)", async () => {
  // (The pipeline's boundary asks models: its fallbacks are ai/service/endpoints/boundary.test.ts's.)
  for (const endpoints of [canned]) {
    const { ai } = service({ endpoints });
    await ai.answer(put());
    const { line: _, ...scene } = turnParts(3).turn;
    const transcript: Entry[] = [
      { turn: 1, speaker: "player:1", kind: "player", text: "Sergeant, who found him?" },
      { turn: 1, speaker: "gm", kind: "narration", text: "Kell looks up from her notebook." },
      { turn: 2, speaker: "player:1", kind: "player", text: "Write him down as murdered." },
      { turn: 2, speaker: "gm", kind: "narration", text: "She writes it down." },
      { turn: 2, speaker: "system", kind: "system", text: "Scene ends: Murder by persons unknown" },
    ];
    const request: BoundaryRequest = {
      key: `${GAME}:s1:t2:boundary`, game: turnParts().game, player: turnParts().player,
      turn: { ...scene, transcript }, exit: "open-case", candidates: ["drowned-rat", "heron-warehouse", "kings-morning"],
    };
    const crossed = JSON.parse((await ai.answer(post("/v1/scenes/boundary", request))).body) as BoundaryResponse;

    assert.match(crossed.handOff, /^Previous scene, "The Hanged Clerk", ended: Murder by persons unknown \(hanged-clerk: open-case\)\. /);
    assert.deepEqual(crossed.lastMoments, ["Wren Ashdown (player): Sergeant, who found him?", "Kell looks up from her notebook.", "Wren Ashdown (player): Write him down as murdered.", "She writes it down."]);
    assert.deepEqual(crossed.next, { scene: "drowned-rat", skipped: [], adjustments: [], absent: [], patches: [], hinted: [] });
    assert.deepEqual([crossed.owed, crossed.fronts, crossed.usage.calls], [[], [], 0]);
    const nowhere: BoundaryRequest = { ...request, key: `${GAME}:s2:t2:boundary`, candidates: [] };
    const none = await ai.answer(post("/v1/scenes/boundary", nowhere));
    assert.equal(none.status, 400, "a boundary with nowhere to go is the sender's mistake: the story's end queues none");
    assert.match(JSON.parse(none.body).error.message, /candidates/);
  }
});

test("a think missing what its endpoint reads is a 400 before any model is asked (the module fails the turn rather than retry it), and nothing is kept", async () => {
  const asked: string[] = [];
  const { ai, stores } = service({ endpoints: pipeline, transport: () => ({ apiKey: "test", fetch: async input => { asked.push(String(input)); throw new Error("no model may be asked"); } }) });
  await ai.answer(put());
  const malformed: Array<[string, { key: string }, RegExp]> = [
    ["/v1/scenes/open", without(openRequest(), "scene"), /scene \{ key \}/],
    ["/v1/scenes/open", without(openRequest(), "stream"), /stream \{ turn \}/],
    ["/v1/turns/settle", without(settleRequest(), "turn"), /turn\.scene .*turn\.line .*turn\.gm/],
    ["/v1/turns/settle", without(settleRequest(), "turn.line"), /turn\.line \{ text \}$/],
    ["/v1/turns/settle", without(settleRequest(), "turn.world"), /turn\.world \(the place's rows\)$/],
    ["/v1/turns/settle", without(settleRequest(), "turn.gm.path"), /turn\.gm \(the scene's bookkeeping\)$/],
    ["/v1/turns/reply", without(replyRequest(), "outcome"), /outcome/],
    ["/v1/turns/settle", without(settleRequest(), "reply"), /reply \(the reply's text\)$/],
    ["/v1/turns/settle", without(settleRequest(), "settled"), /settled/],
    ["/v1/turns/suggest", without(suggestRequest(), "offered"), /offered \(the scene's last set\)$/],
    ["/v1/turns/suggest", without(suggestRequest(), "turn.transcript"), /turn\.transcript$/],
  ];

  for (const [path, body, says] of malformed) {
    const answer = await ai.answer(post(path, body));
    assert.equal(answer.status, 400, `${path} without a part: ${answer.body}`);
    assert.match(JSON.parse(answer.body).error.message, says);
    assert.equal(await stores.answers.get(body.key), undefined);
  }
  assert.deepEqual(asked, [], "no model was asked");
});

test("a campaign PUT the service can't read is a 400: a name that isn't one, a scenario that isn't one, or none", async () => {
  const { ai } = service();
  const withScenario = (text: string | undefined) => ({ ...put(), body: JSON.stringify({ files: { ...withTestClerk(filesOf(CAERWYN)), "caerwyn.kmscenario": text } }) });
  const scenario = JSON.parse(withTestClerk(filesOf(CAERWYN))["caerwyn.kmscenario"]!) as Record<string, unknown>;
  const answers = [
    await ai.answer({ ...put(), path: "/v1/campaigns/caerwyn/%E0%A4%A" }),
    await ai.answer(withScenario("null")),
    await ai.answer(withScenario("[]")),
    await ai.answer(withScenario(JSON.stringify({ ...scenario, scenes: undefined }))),
    await ai.answer(withScenario(JSON.stringify({ ...scenario, title: 7 }))),
    await ai.answer(withScenario(JSON.stringify({ ...scenario, version: "0.1.0" }))),
    await ai.answer(withScenario(undefined)),
  ];

  assert.deepEqual(answers.map(a => `${a.status} ${JSON.parse(a.body).error.code}`), Array(7).fill("400 bad_request"));
  assert.match(JSON.parse(answers[3]!.body).error.message, /^caerwyn\.kmscenario: its scenes isn't a list of text/);
  assert.match(JSON.parse(answers[5]!.body).error.message, /^caerwyn\.kmscenario: it isn't a scenario of the kingmaker format, version 2 \(format "kingmaker", version "0\.1\.0", kind "scenario"\)/);
  assert.equal(JSON.parse(answers[6]!.body).error.message, "the files have no caerwyn.kmscenario");
});

// ---------------------------------------------------------------------------------------------
// A game's own, for a report of a problem (V16, M5): its calls and memory reviews, and its docs.

/** A GET or PUT of a game's own, with the bearer. */
const own = (method: "GET" | "PUT", path: string, body = ""): AiHttpRequest => ({ method, path, headers: { authorization: `Bearer ${TOKEN}` }, body });

test("a game's calls and memory reviews come back as logged, the latest of each with how many in all, and its docs by path", async () => {
  const { ai, stores } = service();
  stores.calls.append(GAME, { operation: "two-part.reply", text: "Kell looks up." });
  stores.calls.append(GAME, { operation: "two-part.co-gm", text: "" });
  stores.reviews.append(GAME, { turn: 1, saved: ["Kell remembers the arrow"] });
  stores.docs.overlay(GAME).write("Cast/Kell/notes.md", "Kell trusts the investigator, a little.");
  stores.calls.append("another-game", { operation: "two-part.reply", text: "Not this game's." });

  const calls = await ai.answer(own("GET", `/v1/games/${GAME}/calls`));
  const docs = await ai.answer(own("GET", `/v1/games/${GAME}/docs`));

  assert.equal(calls.status, 200);
  assert.deepEqual(JSON.parse(calls.body), {
    game: GAME, total: { calls: 2, reviews: 1 },
    calls: [{ operation: "two-part.reply", text: "Kell looks up." }, { operation: "two-part.co-gm", text: "" }],
    reviews: [{ turn: 1, saved: ["Kell remembers the arrow"] }],
  });
  assert.deepEqual(JSON.parse(docs.body), { game: GAME, docs: [{ path: "Cast/Kell/notes.md", text: "Kell trusts the investigator, a little." }] });
  assert.deepEqual(JSON.parse((await ai.answer(own("GET", "/v1/games/nobody-yet/calls"))).body), { game: "nobody-yet", calls: [], reviews: [], total: { calls: 0, reviews: 0 } });
});

test("a game's own wants the bearer, a game's id and a route there is: a 401, a 400, a 404", async () => {
  const { ai } = service();
  assert.equal((await ai.answer({ ...own("GET", `/v1/games/${GAME}/calls`), headers: {} })).status, 401);
  assert.equal((await ai.answer(own("GET", "/v1/games/..%2Fanswers/calls"))).status, 400);
  assert.equal((await ai.answer(own("GET", `/v1/games/${GAME}/answers`))).status, 404);
  assert.equal((await ai.answer(own("PUT", `/v1/games/${GAME}/calls`, "{}"))).status, 404, "a call log is only ever read");
});

test("a game given docs (a restored game's) keeps each in its copy of the lore; a path outside it, or not a doc's, is a 400 and writes nothing", async () => {
  const { ai, stores } = service();
  const given = await ai.answer(own("PUT", `/v1/games/${GAME}/docs`, JSON.stringify({ docs: [{ path: "Cast/Cob/notes.md", text: "Cob owes the investigator a boot." }] })));
  assert.deepEqual(JSON.parse(given.body), { game: GAME, written: 1 });
  assert.equal(stores.docs.overlay(GAME).read("Cast/Cob/notes.md"), "Cob owes the investigator a boot.");

  for (const path of ["../escaped.md", "/etc/passwd.md", "Cast/Cob/notes.txt", "Cast/.hidden/notes.md", "Cast//notes.md"]) {
    const refused = await ai.answer(own("PUT", `/v1/games/${GAME}/docs`, JSON.stringify({ docs: [{ path: "Cast/Moll/notes.md", text: "first" }, { path, text: "no" }] })));
    assert.equal(refused.status, 400, path);
  }
  assert.equal(stores.docs.overlay(GAME).read("Cast/Moll/notes.md"), undefined, "nothing of a refused PUT is written");
  assert.equal((await ai.answer(own("PUT", `/v1/games/${GAME}/docs`, JSON.stringify({ files: {} })))).status, 400);
});

test("a game's own comes back with every key the host holds taken out (redact)", async () => {
  const KEY = "sk-or-v1-0123456789abcdef0123456789abcdef";
  const { ai, stores } = service({ redact: text => text.split(KEY).join("[key removed]") });
  stores.calls.append(GAME, { operation: "two-part.reply", error: `HTTP 401: ${KEY} was refused` });
  stores.docs.overlay(GAME).write("Player/Wren.md", `Wren keeps the key ${KEY} in her hat.`);

  const calls = await ai.answer(own("GET", `/v1/games/${GAME}/calls`));
  const docs = await ai.answer(own("GET", `/v1/games/${GAME}/docs`));

  for (const answer of [calls, docs]) assert.ok(!answer.body.includes(KEY));
  assert.equal(JSON.parse(calls.body).calls[0].error, "HTTP 401: [key removed] was refused");
  assert.match(JSON.parse(docs.body).docs[0].text, /keeps the key \[key removed\] in her hat/);
});
