import { after, test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeFetch } from "../llm/fake-openrouter.ts";
import { respond } from "../llm/openrouter.ts";
import { callContext, transports } from "./calls.ts";
import { readConfig } from "./config.ts";
import { folderStores } from "./folder-stores.ts";

/** Every test's store is a folder in this one, removed once the file's tests are done. */
const SCRATCH = mkdtempSync(join(tmpdir(), "km-store-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));
const fresh = () => mkdtempSync(join(SCRATCH, "store-"));

test("answers are kept by key, a key's characters safe in a file's name", async () => {
  const root = fresh();
  const { answers } = folderStores(root);
  const key = "5f0c2b7e-aaaa:s1:t3:reply";
  await answers.put(key, { requestHash: "abc", status: 200, body: "{\"entries\":[]}", at: "2026-10-16T00:00:00.000Z" });

  assert.deepEqual(await answers.get(key), { requestHash: "abc", status: 200, body: "{\"entries\":[]}", at: "2026-10-16T00:00:00.000Z" });
  assert.equal(await answers.get("5f0c2b7e-aaaa:s1:t3:settle"), undefined);
  assert.deepEqual(readdirSync(join(root, "answers")), [`${encodeURIComponent(key)}.json`]);
});

test("answers older than a week are swept, the rest kept", async () => {
  const root = fresh();
  const stores = folderStores(root);
  await stores.answers.put("old:s1:t1:decide", { requestHash: "a", status: 200, body: "{}", at: "" });
  await stores.answers.put("new:s1:t1:decide", { requestHash: "b", status: 200, body: "{}", at: "" });
  const eightDaysAgo = (Date.now() - 8 * 86_400_000) / 1000;
  utimesSync(join(root, "answers", `${encodeURIComponent("old:s1:t1:decide")}.json`), eightDaysAgo, eightDaysAgo);

  assert.equal(stores.sweepAnswers(7 * 86_400_000), 1);
  assert.equal(await stores.answers.get("old:s1:t1:decide"), undefined);
  assert.ok(await stores.answers.get("new:s1:t1:decide"));
});

test("a campaign version is the whole folder as PUT, replaced whole when it's PUT again", async () => {
  const root = fresh();
  const { campaigns } = folderStores(root);
  await campaigns.put("caerwyn", "0.1.0", { "campaign.json": "{}", "lore/World/Old.md": "old" });
  await campaigns.put("caerwyn", "0.1.0", { "campaign.json": "{}", "lore/World/New.md": "new" });

  const at = campaigns.root("caerwyn", "0.1.0")!;
  assert.equal(readFileSync(join(at, "lore", "World", "New.md"), "utf8"), "new");
  assert.equal(existsSync(join(at, "lore", "World", "Old.md")), false);
  assert.deepEqual(campaigns.list(), ["caerwyn@0.1.0"]);
  assert.equal(campaigns.root("caerwyn", "0.2.0"), undefined);
});

test("a request's calls go to its game's call log with its key and attempt (as each starts, and when it's done), and its costs to the ledger and its usage", async () => {
  const root = fresh();
  const stores = folderStores(root);
  const { calls, usage } = callContext({ fetch: fakeFetch().fetch, apiKey: "k" }, stores, { game: "g1", key: "g1:s1:t2:reply", attempt: 2 });
  await respond({ operation: "gm.reply", input: [{ role: "user", content: "Hello" }], calls });
  await respond({ operation: "gm.reply", input: [{ role: "user", content: "Again" }], calls });

  const logged = readFileSync(join(root, "games", "g1", "calls.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
  const ledger = readFileSync(join(root, "ledger.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
  assert.deepEqual(logged.map(e => [e.key, e.attempt, e.operation, e.started ?? "done"]), [["g1:s1:t2:reply", 2, "gm.reply", "/api/v1/responses"], ["g1:s1:t2:reply", 2, "gm.reply", "done"], ["g1:s1:t2:reply", 2, "gm.reply", "/api/v1/responses"], ["g1:s1:t2:reply", 2, "gm.reply", "done"]]);
  assert.deepEqual(ledger.map(l => [l.game, l.key, l.operation, l.costUsd]), [["g1", "g1:s1:t2:reply", "gm.reply", 0.0002], ["g1", "g1:s1:t2:reply", "gm.reply", 0.0002]]);
  assert.equal(usage().calls, 2);
  assert.equal(usage().byOperation["gm.reply"]?.calls, 2);
});

test("the ledger says what today's (UTC) lines cost: yesterday's don't count, and nor does a line not yet whole", async () => {
  const root = fresh();
  const { ledger } = folderStores(root);
  const today = new Date().toISOString(), yesterday = new Date(Date.now() - 86_400_000).toISOString();

  assert.equal(await ledger.spentToday(), 0, "no ledger yet");
  ledger.append({ at: yesterday, operation: "gm.reply", costUsd: 4 });
  ledger.append({ at: today, operation: "gm.reply", costUsd: 0.25 });
  ledger.append({ at: today, operation: "rules.builds", costUsd: 0.5 });
  assert.equal(await ledger.spentToday(), 0.75);

  appendFileSync(join(root, "ledger.jsonl"), `{"at":"${today}","costUsd":1`);
  assert.equal(await ledger.spentToday(), 0.75, "half a line is read when it's whole");
  appendFileSync(join(root, "ledger.jsonl"), "}\nnot a line at all\n");
  assert.equal(await ledger.spentToday(), 1.75);
});

test("the ledger is read on from where the last read ended: what was there already isn't read again", async () => {
  const root = fresh();
  const { ledger } = folderStores(root);
  const today = new Date().toISOString();
  ledger.append({ at: today, costUsd: 0.1 });
  assert.equal(await ledger.spentToday(), 0.1);

  // The line already read, changed in place (the same length): a reader from the start would see 0.9.
  const file = join(root, "ledger.jsonl");
  writeFileSync(file, readFileSync(file, "utf8").replace('"costUsd":0.1', '"costUsd":0.9'));
  ledger.append({ at: today, costUsd: 0.2 });
  assert.equal(Math.round((await ledger.spentToday()) * 100) / 100, 0.3);

  // A ledger that shrank was replaced: read again from its start.
  writeFileSync(file, `${JSON.stringify({ at: today, costUsd: 2 })}\n`);
  assert.equal(await ledger.spentToday(), 2);
});

test("on the stand-in, each turn hears its own reply first, and the same turn always the same", async () => {
  const transport = transports("fake", { fake: { replies: ["Zero.", "One.", "Two."] } });
  const first = async (turn: number) => (await respond({ operation: "gm.reply", input: [{ role: "user", content: "Hi" }], calls: { ...transport(turn), log: () => {}, cost: () => {} } })).text;

  assert.deepEqual([await first(0), await first(1), await first(2), await first(3), await first(1)], ["Zero.", "One.", "Two.", "Zero.", "One."]);
  assert.deepEqual(transports("openrouter", { apiKey: "sk-or-x", fake: {} })(4), { apiKey: "sk-or-x" });
});

test("on the stand-in, each turn's suggested lines are its own set, when there are several", async () => {
  const suggest = { operation: "scene.suggest", instructions: "You suggest what the player might say or do next.", input: [{ role: "user" as const, content: "Hi" }] };
  const lines = (fake: Parameters<typeof transports>[1]["fake"]) => async (turn: number) => (await respond({ ...suggest, calls: { ...transports("fake", { fake })(turn), log: () => {}, cost: () => {} } })).text;
  const sets = lines({ suggestions: ["say: Zero.", "say: One."] });
  const one = lines({ suggestions: "say: Always." });

  assert.deepEqual([await sets(0), await sets(1), await sets(2)], ["say: Zero.", "say: One.", "say: Zero."]);
  assert.deepEqual([await one(0), await one(1)], ["say: Always.", "say: Always."]);
});

test("the config: the bearer required, the defaults, and the values checked", () => {
  assert.throws(() => readConfig({}), /KM_AI_TOKEN is required/);
  assert.deepEqual(readConfig({ KM_AI_TOKEN: "t" }), {
    listen: [{ host: "127.0.0.1", port: 8787 }], token: "t", store: "runs/ai", stdb: { url: "http://127.0.0.1:3300", db: "kingmaker" },
    model: "openrouter", fake: {}, gm: "pipeline", streamMs: 200, dailyUsd: 5, considerDeadlineMs: 12_000, faults: {},
  });
  const set = readConfig({ KM_AI_TOKEN: "t", KM_AI_LISTEN: "11.0.0.1:8787, 127.0.0.1:8787,[::1]:0", KM_STDB_URL: "http://127.0.0.1:3310/", KM_STDB_TOKEN: "s", KM_AI_MODEL: "fake", KM_AI_FAKE: "{\"streamMs\":3000}", KM_AI_GM: "canned", KM_AI_STREAM_MS: "50", KM_AI_FAULTS: "exit-after-store:settle", OPENROUTER_API_KEY: " sk-or-1 " });
  assert.deepEqual(set.listen, [{ host: "11.0.0.1", port: 8787 }, { host: "127.0.0.1", port: 8787 }, { host: "::1", port: 0 }]);
  assert.deepEqual(set.stdb, { url: "http://127.0.0.1:3310", db: "kingmaker", token: "s" });
  assert.deepEqual([set.model, set.fake, set.gm, set.streamMs, set.faults, set.apiKey], ["fake", { streamMs: 3000 }, "canned", 50, { exitAfterStore: "settle" }, "sk-or-1"]);
  assert.throws(() => readConfig({ KM_AI_TOKEN: "t", KM_AI_MODEL: "gpt" }), /KM_AI_MODEL/);
  assert.throws(() => readConfig({ KM_AI_TOKEN: "t", KM_AI_FAULTS: "exit-after-store:lunch" }), /KM_AI_FAULTS/);
  assert.throws(() => readConfig({ KM_AI_TOKEN: "t", KM_AI_LISTEN: "8787" }), /KM_AI_LISTEN/);
});

test("the config: a considered turn's review is cut off at KM_CONSIDER_DEADLINE_MS, and its step and the background ones are faults", () => {
  assert.equal(readConfig({ KM_AI_TOKEN: "t", KM_CONSIDER_DEADLINE_MS: "2000" }).considerDeadlineMs, 2000);
  assert.throws(() => readConfig({ KM_AI_TOKEN: "t", KM_CONSIDER_DEADLINE_MS: "soon" }), /KM_CONSIDER_DEADLINE_MS/);
  assert.deepEqual(["consider", "remember", "repair"].map(step => readConfig({ KM_AI_TOKEN: "t", KM_AI_FAULTS: `exit-after-store:${step}` }).faults), [
    { exitAfterStore: "consider" }, { exitAfterStore: "remember" }, { exitAfterStore: "repair" },
  ]);
});

test("the config: the daily ceiling in dollars (0 for none), and a creation's steps as faults", () => {
  assert.deepEqual([readConfig({ KM_AI_TOKEN: "t", KM_AI_DAILY_USD: "0.25" }).dailyUsd, readConfig({ KM_AI_TOKEN: "t", KM_AI_DAILY_USD: "0" }).dailyUsd], [0.25, 0]);
  assert.throws(() => readConfig({ KM_AI_TOKEN: "t", KM_AI_DAILY_USD: "five" }), /KM_AI_DAILY_USD: "five" isn't a number of dollars/);
  assert.throws(() => readConfig({ KM_AI_TOKEN: "t", KM_AI_DAILY_USD: "-1" }), /KM_AI_DAILY_USD/);
  assert.deepEqual(readConfig({ KM_AI_TOKEN: "t", KM_AI_FAULTS: "exit-after-store:check" }).faults, { exitAfterStore: "check" });
  assert.deepEqual(readConfig({ KM_AI_TOKEN: "t", KM_AI_FAULTS: "exit-after-store:offer" }).faults, { exitAfterStore: "offer" });
});
