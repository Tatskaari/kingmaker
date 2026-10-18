import { after, test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeFetch } from "../llm/fake-openrouter.ts";
import { respond } from "../llm/openrouter.ts";
import { callContext, transports } from "./calls.ts";
import { readConfig } from "./config.ts";
import { folderStores } from "./folder-stores.ts";
import { memoryStores, type Persistence } from "./memory-stores.ts";
import type { StoredAnswer, Stores } from "./stores.ts";

/** Every test's folder store is a folder in this one, removed once the file's tests are done. */
const SCRATCH = mkdtempSync(join(tmpdir(), "km-store-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));
const fresh = () => mkdtempSync(join(SCRATCH, "store-"));

/** A kind of store, made fresh, and how a test reads back its logs (the interface only writes them). */
interface Kind { stores: Stores; lines(log: "calls" | "reviews", game: string): unknown[] }

const KINDS: Record<string, () => Kind> = {
  folder() {
    const root = fresh();
    const file = (log: "calls" | "reviews", game: string) => join(root, "games", game, log === "calls" ? "calls.jsonl" : "memory-reviews.jsonl");
    return { stores: folderStores(root), lines: (log, game) => readFileSync(file(log, game), "utf8").trim().split("\n").map(l => JSON.parse(l)) };
  },
  memory() {
    const host = keeping();
    return { stores: memoryStores(host), lines: (log, game) => host.lines.filter(l => l.log === log && l.game === game).map(l => l.line) };
  },
};

/** A host's persistence that keeps what it's handed in arrays, starting from what it's given as kept. */
function keeping(kept: Persistence["kept"] = {}) {
  const host = {
    kept, answers: [] as Array<[string, StoredAnswer]>, forgotten: [] as string[], docs: [] as Array<[string, string, string]>,
    lines: [] as Array<{ log: string; game: string; line: Record<string, unknown> }>, ledgerLines: [] as Array<Record<string, unknown>>,
    async answer(key: string, answer: StoredAnswer) { host.answers.push([key, answer]); },
    forget(keys: string[]) { host.forgotten.push(...keys); },
    doc(game: string, path: string, text: string) { host.docs.push([game, path, text]); },
    line(log: "calls" | "reviews", game: string, line: Record<string, unknown>) { host.lines.push({ log, game, line }); },
    ledger(line: Record<string, unknown>) { host.ledgerLines.push(line); },
  };
  return host;
}

const ANSWER: StoredAnswer = { requestHash: "abc", status: 200, body: "{\"entries\":[]}", at: new Date().toISOString() };
const DAY = 86_400_000;

/**
 * The stores' contract (stores.ts), the same for every kind: answers by key, swept once they're
 * older than asked; a campaign version's files, replaced whole by a PUT again; each game's own copy
 * of the lore, which outlives the volume it was written through; each game's logs, and today's spend.
 */
for (const [name, make] of Object.entries(KINDS)) {
  test(`the stores' contract: ${name}`, async () => {
    const { stores, lines } = make();

    await stores.answers.put("g1:s1:t3:reply", ANSWER);
    assert.deepEqual(await stores.answers.get("g1:s1:t3:reply"), ANSWER);
    assert.equal(await stores.answers.get("g1:s1:t3:settle"), undefined);
    assert.equal(await stores.answers.sweep?.(7 * DAY), 0, "nothing a week old");
    assert.equal(await stores.answers.sweep?.(7 * DAY, Date.now() + 8 * DAY), 1, "a week on, swept");
    assert.equal(await stores.answers.get("g1:s1:t3:reply"), undefined);

    await stores.campaigns.put("caerwyn", "0.1.0", { "campaign.json": "{}", "lore/World/Old.md": "old" });
    await stores.campaigns.put("caerwyn", "0.1.0", { "campaign.json": "{}", "lore/World/New.md": "new" });
    const files = stores.campaigns.files("caerwyn", "0.1.0")!;
    assert.deepEqual([files.read("lore/World/New.md"), files.read("lore/World/Old.md"), files.paths().sort()], ["new", undefined, ["campaign.json", "lore/World/New.md"]]);
    assert.deepEqual([stores.campaigns.list(), stores.campaigns.files("caerwyn", "0.2.0")], [["caerwyn@0.1.0"], undefined]);

    stores.docs.overlay("g1").write("Cast/Kell/memories/index.md", "# Memories");
    stores.docs.overlay("g1").write("Cast/Kell/.draft.md", "hidden");
    assert.equal(stores.docs.overlay("g1").read("Cast/Kell/memories/index.md"), "# Memories", "a later volume reads what an earlier one wrote");
    assert.deepEqual([stores.docs.overlay("g1").list(), stores.docs.overlay("g2").list()], [["Cast/Kell/memories/index.md"], []]);
    assert.equal(stores.docs.overlay("g2").read("Cast/Kell/memories/index.md"), undefined, "another game's copy is its own");

    stores.calls.append("g1", { operation: "gm.reply" });
    stores.reviews.append("g1", { turn: 1 });
    stores.ledger.append({ at: new Date(Date.now() - DAY).toISOString(), costUsd: 4 });
    stores.ledger.append({ at: new Date().toISOString(), costUsd: 0.25 });
    stores.ledger.append({ at: new Date().toISOString(), costUsd: 0.5 });
    assert.deepEqual([lines("calls", "g1"), lines("reviews", "g1")], [[{ operation: "gm.reply" }], [{ turn: 1 }]]);
    assert.equal(await stores.ledger.spentToday(), 0.75, "yesterday's doesn't count");
  });
}

test("memory: the host hears each write as it's made, and an answer before put returns; new stores start from what it kept", async () => {
  const host = keeping();
  const stores = memoryStores(host);
  const today = new Date().toISOString();
  let putDone = false;
  const put = stores.answers.put("g1:s1:t1:remember", { ...ANSWER, at: today }).then(() => { putDone = true; });
  assert.equal(putDone, false);
  await put;
  stores.docs.overlay("g1").write("Cast/Kell/memories/a1b2c3d4.md", "She watched.");
  stores.ledger.append({ at: today, costUsd: 0.5 });
  await stores.answers.sweep?.(0, Date.now() + 1);
  assert.deepEqual([host.answers.map(([key]) => key), host.forgotten, host.docs, host.ledgerLines], [["g1:s1:t1:remember"], ["g1:s1:t1:remember"], [["g1", "Cast/Kell/memories/a1b2c3d4.md", "She watched."]], [{ at: today, costUsd: 0.5 }]]);

  const again = memoryStores(keeping({ answers: { "g1:s1:t2:reply": ANSWER }, docs: { g1: { "Cast/Kell/memories/a1b2c3d4.md": "She watched." } }, ledger: host.ledgerLines }));
  assert.deepEqual(await again.answers.get("g1:s1:t2:reply"), ANSWER);
  assert.equal(again.docs.overlay("g1").read("Cast/Kell/memories/a1b2c3d4.md"), "She watched.");
  assert.equal(await again.ledger.spentToday(), 0.5);
});

test("answers are kept by key, a key's characters safe in a file's name", async () => {
  const root = fresh();
  const { answers } = folderStores(root);
  const key = "5f0c2b7e-aaaa:s1:t3:reply";
  await answers.put(key, { requestHash: "abc", status: 200, body: "{\"entries\":[]}", at: "2026-10-16T00:00:00.000Z" });

  assert.deepEqual(await answers.get(key), { requestHash: "abc", status: 200, body: "{\"entries\":[]}", at: "2026-10-16T00:00:00.000Z" });
  assert.equal(await answers.get("5f0c2b7e-aaaa:s1:t3:settle"), undefined);
  assert.deepEqual(readdirSync(join(root, "answers")), [`${encodeURIComponent(key)}.json`]);
});

test("answers older than a week are swept by their files' times, the rest kept", async () => {
  const root = fresh();
  const stores = folderStores(root);
  await stores.answers.put("old:s1:t1:decide", { requestHash: "a", status: 200, body: "{}", at: "" });
  await stores.answers.put("new:s1:t1:decide", { requestHash: "b", status: 200, body: "{}", at: "" });
  const eightDaysAgo = (Date.now() - 8 * 86_400_000) / 1000;
  utimesSync(join(root, "answers", `${encodeURIComponent("old:s1:t1:decide")}.json`), eightDaysAgo, eightDaysAgo);

  assert.equal(await stores.answers.sweep?.(7 * 86_400_000), 1);
  assert.equal(await stores.answers.get("old:s1:t1:decide"), undefined);
  assert.ok(await stores.answers.get("new:s1:t1:decide"));
});

test("a campaign version is a folder on disk as PUT, and each game's copy of the lore one beside its logs", async () => {
  const root = fresh();
  const stores = folderStores(root);
  await stores.campaigns.put("caerwyn", "0.1.0", { "campaign.json": "{}", "lore/World/New.md": "new" });
  stores.docs.overlay("g1").write("Player/Wren.md", "# Wren");

  assert.equal(readFileSync(join(root, "campaigns", "caerwyn", "0.1.0", "lore", "World", "New.md"), "utf8"), "new");
  assert.equal(readFileSync(join(root, "games", "g1", "docs", "Player", "Wren.md"), "utf8"), "# Wren");
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
    model: "openrouter", fake: {}, gm: "pipeline", streamMs: 200, dailyUsd: 5, faults: {},
  });
  const set = readConfig({ KM_AI_TOKEN: "t", KM_AI_LISTEN: "11.0.0.1:8787, 127.0.0.1:8787,[::1]:0", KM_STDB_URL: "http://127.0.0.1:3310/", KM_STDB_TOKEN: "s", KM_AI_MODEL: "fake", KM_AI_FAKE: "{\"streamMs\":3000}", KM_AI_GM: "canned", KM_AI_STREAM_MS: "50", KM_AI_FAULTS: "exit-after-store:settle", OPENROUTER_API_KEY: " sk-or-1 " });
  assert.deepEqual(set.listen, [{ host: "11.0.0.1", port: 8787 }, { host: "127.0.0.1", port: 8787 }, { host: "::1", port: 0 }]);
  assert.deepEqual(set.stdb, { url: "http://127.0.0.1:3310", db: "kingmaker", token: "s" });
  assert.deepEqual([set.model, set.fake, set.gm, set.streamMs, set.faults, set.apiKey], ["fake", { streamMs: 3000 }, "canned", 50, { exitAfterStore: "settle" }, "sk-or-1"]);
  assert.throws(() => readConfig({ KM_AI_TOKEN: "t", KM_AI_MODEL: "gpt" }), /KM_AI_MODEL/);
  assert.throws(() => readConfig({ KM_AI_TOKEN: "t", KM_AI_FAULTS: "exit-after-store:lunch" }), /KM_AI_FAULTS/);
  assert.throws(() => readConfig({ KM_AI_TOKEN: "t", KM_AI_LISTEN: "8787" }), /KM_AI_LISTEN/);
});

test("the config: the background steps are faults; a considered turn's step, gone with the old pipeline, isn't", () => {
  assert.deepEqual(["remember", "repair"].map(step => readConfig({ KM_AI_TOKEN: "t", KM_AI_FAULTS: `exit-after-store:${step}` }).faults), [
    { exitAfterStore: "remember" }, { exitAfterStore: "repair" },
  ]);
  assert.throws(() => readConfig({ KM_AI_TOKEN: "t", KM_AI_FAULTS: "exit-after-store:consider" }), /KM_AI_FAULTS/);
});

test("the config: the daily ceiling in dollars (0 for none), and a creation's steps as faults", () => {
  assert.deepEqual([readConfig({ KM_AI_TOKEN: "t", KM_AI_DAILY_USD: "0.25" }).dailyUsd, readConfig({ KM_AI_TOKEN: "t", KM_AI_DAILY_USD: "0" }).dailyUsd], [0.25, 0]);
  assert.throws(() => readConfig({ KM_AI_TOKEN: "t", KM_AI_DAILY_USD: "five" }), /KM_AI_DAILY_USD: "five" isn't a number of dollars/);
  assert.throws(() => readConfig({ KM_AI_TOKEN: "t", KM_AI_DAILY_USD: "-1" }), /KM_AI_DAILY_USD/);
  assert.deepEqual(readConfig({ KM_AI_TOKEN: "t", KM_AI_FAULTS: "exit-after-store:check" }).faults, { exitAfterStore: "check" });
  assert.deepEqual(readConfig({ KM_AI_TOKEN: "t", KM_AI_FAULTS: "exit-after-store:offer" }).faults, { exitAfterStore: "offer" });
});
