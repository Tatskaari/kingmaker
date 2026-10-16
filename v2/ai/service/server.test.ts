import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { DecideRequest, NotesRequest, NotesResponse, OpenRequest, ReplyRequest, ReplyResponse, SettleRequest, SuggestRequest, SuggestResponse } from "../../shared/protocol/ai.ts";
import { initialGm } from "../../shared/gm/state.ts";
import { campaigns } from "./campaigns.ts";
import { Failure, type Endpoints } from "./context.ts";
import { canned } from "./endpoints/canned.ts";
import { pipeline } from "./endpoints/pipeline.ts";
import { folderStores } from "./folder-stores.ts";
import { aiService, type AiHttpRequest, type ServiceOptions } from "./server.ts";

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
    token: TOKEN, stores, campaigns: campaigns(stores.campaigns, stores.docsRoot), endpoints: counted,
    transport: () => ({}), stream: { url: "http://127.0.0.1:9", db: "kingmaker", periodMs: 200 },
    serves: { model: "fake", gm: "canned" }, faults: {}, log: line => lines.push(line), exit: code => exits.push(code),
    ...overrides,
  });
  return { ai, stores, ran, exits, lines };
}

const put = (version = "0.1.0", files = filesOf(CAERWYN)): AiHttpRequest => ({ method: "PUT", path: `/v1/campaigns/caerwyn/${version}`, headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ files }) });

function decideRequest(n = 1, text = "Sergeant, who found him?"): DecideRequest {
  const gm = initialGm({ start: "yard" });
  return {
    key: `${GAME}:s1:t${n}:decide`, game: { id: GAME, campaign: "caerwyn", version: "0.1.0" }, player: { id: "1", name: "Wren Ashdown" },
    turn: {
      scene: { id: "1", key: "hanged-clerk", kind: "scene", turn: n }, pc: "pc:1", gm, transcript: [{ turn: n, speaker: "player:1", kind: "player", text }],
      line: { speaker: "player:1", text }, world: { place: { id: "1", key: "granary-yard", name: "The granary yard", rootId: "2", sizeW: 40, sizeH: 30, round: 0, rev: 1 }, entity: [], position: [], area: [], material: [], health: [], stack: [], surface: [], creature: [], playerCharacter: [], gear: [], narrative: [], gmNote: [], worldLog: [] },
      party: [{ name: "Wren Ashdown", concept: "a hedge wizard", skills: {} }], present: [], story: { time: "morning", day: 1, flags: {} },
    },
    landed: [],
  };
}

function openRequest(): OpenRequest {
  const { turn } = decideRequest();
  return { key: `${GAME}:s1:t0:open`, game: { id: GAME, campaign: "caerwyn", version: "0.1.0" }, player: { id: "1", name: "Wren" }, scene: { id: "1", key: "hanged-clerk", kind: "scene" }, pc: "pc:1", gm: turn.gm, world: turn.world, party: turn.party, story: turn.story, stream: { turn: "1" } };
}

function replyRequest(n = 1): ReplyRequest {
  const { game, player, turn } = decideRequest(n);
  return { key: `${GAME}:s1:t${n}:reply`, game, player, turn, decision: { earned: false, daft: false, outOfCharacter: false }, outcome: { lines: [], directives: [], wasStuck: false }, stream: { turn: "2" } };
}

function settleRequest(n = 1): SettleRequest {
  const { game, player, turn } = decideRequest(n);
  return { key: `${GAME}:s1:t${n}:settle`, game, player, turn, reply: "Kell looks up.", lines: [], settled: [] };
}

function notesRequest(n = 1): NotesRequest {
  const { game, player, turn: { line: _, ...turn } } = decideRequest(n);
  return { key: `${GAME}:s1:t${n}:notes`, game, player, turn, reply: { seq: 2, text: "Kell looks up.", speech: [], drafted: [{ start: 0, end: 4, kind: "why" }] } };
}

function suggestRequest(n = 1): SuggestRequest {
  const { game, player, turn: { line: _, ...turn } } = decideRequest(n);
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

function post(path: string, body: { key: string }, headers: Record<string, string> = {}): AiHttpRequest {
  return { method: "POST", path, headers: { authorization: `Bearer ${TOKEN}`, "idempotency-key": body.key, "x-km-attempt": "1", ...headers }, body: JSON.stringify(body) };
}

test("health needs no bearer, and says whether the one it got is accepted", async () => {
  const { ai } = service();
  const ask = async (authorization?: string) => JSON.parse((await ai.answer({ method: "GET", path: "/v1/health", headers: { authorization }, body: "" })).body);

  assert.deepEqual(await ask(), { ok: true, model: "fake", gm: "canned", campaigns: [], token: "absent" });
  assert.equal((await ask("Bearer wrong")).token, "refused");
  assert.equal((await ask(`Bearer ${TOKEN}`)).token, "accepted");
});

test("every other route wants the bearer", async () => {
  const { ai } = service();
  const unauthorised = await ai.answer({ ...post("/v1/turns/decide", decideRequest()), headers: { "idempotency-key": decideRequest().key } });
  const wrong = await ai.answer(post("/v1/turns/decide", decideRequest(), { authorization: "Bearer nope" }));

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
  assert.deepEqual(JSON.parse(answer.body), { campaign: "caerwyn", version: "0.1.0", files: Object.keys(filesOf(CAERWYN)).length, scenes: ["hanged-clerk"] });
  assert.deepEqual(health.campaigns, ["caerwyn@0.1.0"]);
});

test("a campaign whose scene doesn't load, or whose paths climb out, is a 400 and isn't installed", async () => {
  const { ai } = service();
  const files = filesOf(CAERWYN);
  delete files["scenes/hanged-clerk/cast/kell.md"];
  const missing = await ai.answer(put("0.1.0", files));
  const climbing = await ai.answer(put("0.1.0", { ...filesOf(CAERWYN), "../outside.md": "no" }));

  assert.equal(missing.status, 400);
  assert.match(JSON.parse(missing.body).error.message, /hanged-clerk doesn't load: .*cast\/kell\.md/);
  assert.equal(climbing.status, 400);
  assert.equal(JSON.parse((await ai.answer({ method: "GET", path: "/v1/health", headers: {}, body: "" })).body).campaigns.length, 0);
});

test("a campaign whose vocabulary.json doesn't read as the story reads it is a 400 and isn't installed", async () => {
  const { ai } = service();
  const vocabulary = JSON.parse(filesOf(CAERWYN)["vocabulary.json"]!) as { scenes: Array<Record<string, unknown>> };
  const withVocabulary = (text: string) => put("0.1.0", { ...filesOf(CAERWYN), "vocabulary.json": text });
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
  const first = await ai.answer(post("/v1/turns/decide", decideRequest()));
  const again = await ai.answer(post("/v1/turns/decide", decideRequest(), { "x-km-attempt": "2" }));

  assert.equal(first.status, 200);
  assert.equal(first.headers["x-km-replayed"], undefined);
  assert.equal(again.status, 200);
  assert.equal(again.headers["x-km-replayed"], "1");
  assert.equal(again.body, first.body);
  assert.deepEqual(ran, ["decide"]);
});

test("a duplicate that comes while the first is still running joins it: one run, one answer", async () => {
  const { ai, ran } = service({ slowMs: 50 });
  await ai.answer(put());
  const [a, b] = await Promise.all([ai.answer(post("/v1/turns/decide", decideRequest())), ai.answer(post("/v1/turns/decide", decideRequest(), { "x-km-attempt": "2" }))]);

  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.body, b.body);
  assert.deepEqual(ran, ["decide"]);
});

test("the same key with another request is 409 key_reused, stored or still running", async () => {
  const { ai } = service({ slowMs: 30 });
  await ai.answer(put());
  const running = ai.answer(post("/v1/turns/decide", decideRequest()));
  const meanwhile = await ai.answer(post("/v1/turns/decide", decideRequest(1, "Something else entirely")));
  await running;
  const afterwards = await ai.answer(post("/v1/turns/decide", decideRequest(1, "Something else again")));

  assert.equal(meanwhile.status, 409);
  assert.equal(JSON.parse(meanwhile.body).error.code, "key_reused");
  assert.equal(afterwards.status, 409);
});

test("what can't be answered is a 400: unreadable, a key that isn't the header's or the endpoint's, a campaign not installed, a scene it hasn't got", async () => {
  const { ai } = service();
  const code = async (request: AiHttpRequest) => { const r = await ai.answer(request); return `${r.status} ${JSON.parse(r.body).error.code}`; };
  const notInstalled = await code(post("/v1/turns/decide", decideRequest()));
  await ai.answer(put());
  const open: OpenRequest = { key: `${GAME}:s1:t0:open`, game: { id: GAME, campaign: "caerwyn", version: "0.1.0" }, player: { id: "1", name: "Wren" }, scene: { id: "1", key: "no-such-scene", kind: "scene" }, pc: "pc:1", gm: initialGm({ start: "yard" }), world: decideRequest().turn.world, party: decideRequest().turn.party, story: decideRequest().turn.story, stream: { turn: "1" } };

  assert.equal(notInstalled, "400 bad_request");
  assert.equal(await code({ ...post("/v1/turns/decide", decideRequest()), body: "{not json" }), "400 bad_request");
  assert.equal(await code(post("/v1/turns/decide", decideRequest(), { "idempotency-key": "someone-else:s1:t1:decide" })), "400 bad_request");
  assert.equal(await code(post("/v1/turns/reply", decideRequest())), "400 bad_request");
  assert.equal(await code(post("/v1/scenes/open", open)), "400 bad_request");
  assert.equal(await code({ method: "GET", path: "/v1/nowhere", headers: {}, body: "" }), "404 bad_request");
});

test("a version other than the one served is 409 other_campaign: the docs service has one lore root", async () => {
  const { ai } = service();
  await ai.answer(put());
  const files = filesOf(CAERWYN);
  files["campaign.json"] = files["campaign.json"]!.replace('"0.1.0"', '"0.2.0"');
  const other = await ai.answer(put("0.2.0", files));

  assert.equal(other.status, 409);
  assert.equal(JSON.parse(other.body).error.code, "other_campaign");
});

test("anything an endpoint throws but a refusal is 500 model_failed, and nothing is stored", async () => {
  const failing: Endpoints = { ...canned, decide: async () => { throw new Error("OpenRouter director.before HTTP 502"); } };
  const { ai, stores } = service({ endpoints: failing });
  await ai.answer(put());
  const answer = await ai.answer(post("/v1/turns/decide", decideRequest()));

  assert.equal(answer.status, 500);
  assert.deepEqual(JSON.parse(answer.body), { error: { code: "model_failed", message: "OpenRouter director.before HTTP 502" } });
  assert.equal(await stores.answers.get(decideRequest().key), undefined);
});

test("a refusal an endpoint throws keeps its own status", async () => {
  const refusing: Endpoints = { ...canned, decide: async () => { throw new Failure(400, "bad_request", "no such route"); } };
  const { ai } = service({ endpoints: refusing });
  await ai.answer(put());

  assert.equal((await ai.answer(post("/v1/turns/decide", decideRequest()))).status, 400);
});

test("exit-after-store: the process exits (137) with the answer stored and not sent", async () => {
  const { ai, stores, exits, lines } = service({ faults: { exitAfterStore: "decide" } });
  await ai.answer(put());
  await ai.answer(post("/v1/turns/decide", decideRequest()));

  assert.deepEqual(exits, [137]);
  assert.ok(await stores.answers.get(decideRequest().key));
  assert.ok(lines.some(l => /exit-after-store/.test(l)));
});

test("shutting down, it takes nothing new: 503 not_ready", async () => {
  const { ai } = service();
  await ai.answer(put());
  await ai.shutdown(10);
  const answer = await ai.answer(post("/v1/turns/decide", decideRequest()));

  assert.equal(answer.status, 503);
  assert.equal(JSON.parse(answer.body).error.code, "not_ready");
});

test("shutting down over HTTP: a think in flight is answered before the shutdown is over, so a process that exits then has sent it", async () => {
  const { ai, ran } = service({ slowMs: 300 });
  await ai.answer(put());
  const server = createServer((req, res) => ai.handle(req, res));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const request = post("/v1/turns/decide", decideRequest());
  try {
    const asked = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/turns/decide`, { method: "POST", headers: request.headers as Record<string, string>, body: request.body });
    while (!ran.length) await new Promise(resolve => setTimeout(resolve, 5));

    await ai.shutdown(10_000);
    server.closeAllConnections(); // what process.exit does to the sockets, at the moment hosts/ai.ts calls it

    const answered = await asked;
    assert.equal(answered.status, 200);
    assert.deepEqual((await answered.json() as { decision: unknown }).decision, { earned: false, daft: false, outOfCharacter: false });
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
    const decided = await fetch(`${base}/v1/turns/decide`, { method: "POST", headers: post("/v1/turns/decide", decideRequest()).headers as Record<string, string>, body: JSON.stringify(decideRequest()) });
    const huge = await fetch(`${base}/v1/turns/decide`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: "x".repeat(3 << 20) });

    assert.deepEqual([health.status, (await health.json() as { token: string }).token], [200, "accepted"]);
    assert.equal(installed.status, 200);
    assert.equal(decided.status, 200);
    assert.deepEqual((await decided.json() as { decision: unknown }).decision, { earned: false, daft: false, outOfCharacter: false });
    assert.equal(huge.status, 413);
  } finally {
    server.close();
  }
});

test("canned: someone of the cast says a line in each reply, the notes put a why on it with its card, and the same four lines are suggested", async () => {
  const { ai } = service();
  await ai.answer(put());
  const { line: _, ...scene } = decideRequest(1).turn;
  const reply: ReplyRequest = { ...decideRequest(1), key: `${GAME}:s1:t1:reply`, decision: { earned: false, daft: false, outOfCharacter: false }, outcome: { lines: [], directives: [], wasStuck: false }, stream: { turn: "4" } };
  const said = (JSON.parse((await ai.answer(post("/v1/turns/reply", reply))).body) as ReplyResponse).entries[0]!;
  const notes: NotesRequest = { key: `${GAME}:s1:t1:notes`, game: reply.game, player: reply.player, turn: { ...scene, transcript: [...scene.transcript, { turn: 1, ...said }] }, reply: { seq: 2, text: said.text, speech: said.markup!.speech, drafted: [] } };
  const noted = JSON.parse((await ai.answer(post("/v1/turns/notes", notes))).body) as NotesResponse;
  const suggest: SuggestRequest = { key: `${GAME}:s1:t1:suggest`, game: reply.game, player: reply.player, turn: notes.turn, offered: [] };
  const suggested = JSON.parse((await ai.answer(post("/v1/turns/suggest", suggest))).body) as SuggestResponse;
  const again = await ai.answer(post("/v1/turns/suggest", { ...suggest, key: `${GAME}:s1:t1:suggest-2` }));

  assert.equal(said.text, "You said: “Sergeant, who found him?” “Go on, then,” says the boy in the too-big boots. (Canned: no model was asked.)");
  assert.deepEqual(said.markup!.speech.map(s => [said.text.slice(s.start, s.end), s.speaker]), [["“Sergeant, who found him?”", "you"], ["“Go on, then,”", "cob"]]);
  assert.deepEqual(noted.marks, [{
    start: said.markup!.speech[1]!.start, end: said.markup!.speech[1]!.end, kind: "why", note: "The boy in the too-big boots wants to hear more. (Canned: no model was asked.)",
    link: { kind: "person", id: "cob" }, card: { title: "The boy in the too-big boots", lines: ["You met them in this scene.", "Last said to you (turn 1): “Go on, then,”"] },
  }]);
  assert.deepEqual(suggested.lines.map(l => l.kind), ["say", "say", "do", "try"]);
  assert.equal(again.status, 200, "a second ask of the same turn has a key of its own");
});

test("canned: a reply with nobody of the cast speaking gets no notes", async () => {
  const { ai } = service();
  await ai.answer(put());
  const { line: _, ...scene } = decideRequest(1).turn;
  const text = "The rain comes on. “Hm,” you say.";
  const notes: NotesRequest = { key: `${GAME}:s1:t1:notes`, game: decideRequest().game, player: decideRequest().player, turn: scene, reply: { seq: 2, text, speech: [{ start: 19, end: 23, speaker: "you" }], drafted: [] } };

  assert.deepEqual((JSON.parse((await ai.answer(post("/v1/turns/notes", notes))).body) as NotesResponse).marks, []);
});

test("a think missing what its endpoint reads is a 400 before any model is asked (the module fails the turn rather than retry it), and nothing is kept", async () => {
  const asked: string[] = [];
  const { ai, stores } = service({ endpoints: pipeline, transport: () => ({ apiKey: "test", fetch: async input => { asked.push(String(input)); throw new Error("no model may be asked"); } }) });
  await ai.answer(put());
  const malformed: Array<[string, { key: string }, RegExp]> = [
    ["/v1/scenes/open", without(openRequest(), "scene"), /scene \{ key \}/],
    ["/v1/scenes/open", without(openRequest(), "stream"), /stream \{ turn \}/],
    ["/v1/turns/decide", without(decideRequest(), "turn"), /turn\.scene .*turn\.line .*turn\.gm/],
    ["/v1/turns/decide", without(decideRequest(), "turn.line"), /turn\.line \{ text \}$/],
    ["/v1/turns/decide", without(decideRequest(), "turn.world"), /turn\.world \(the place's rows\)$/],
    ["/v1/turns/decide", without(decideRequest(), "turn.gm.path"), /turn\.gm \(the scene's bookkeeping\)$/],
    ["/v1/turns/reply", without(replyRequest(), "outcome"), /outcome/],
    ["/v1/turns/reply", without(replyRequest(), "decision"), /decision/],
    ["/v1/turns/settle", without(settleRequest(), "reply"), /reply \(the reply's text\)$/],
    ["/v1/turns/settle", without(settleRequest(), "settled"), /settled/],
    ["/v1/turns/notes", without(notesRequest(), "reply"), /reply \{ seq, text, speech, drafted \}$/],
    ["/v1/turns/notes", without(notesRequest(), "turn.world"), /turn\.world \(the place's rows\)$/],
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

test("a campaign PUT the service can't read is a 400: a name that isn't one, a campaign.json that isn't a campaign's", async () => {
  const { ai } = service();
  const withCampaign = (text: string) => ({ ...put(), body: JSON.stringify({ files: { ...filesOf(CAERWYN), "campaign.json": text } }) });
  const campaign = JSON.parse(filesOf(CAERWYN)["campaign.json"]!) as Record<string, unknown>;
  const answers = [
    await ai.answer({ ...put(), path: "/v1/campaigns/caerwyn/%E0%A4%A" }),
    await ai.answer(withCampaign("null")),
    await ai.answer(withCampaign("[]")),
    await ai.answer(withCampaign(JSON.stringify({ ...campaign, scenes: undefined }))),
    await ai.answer(withCampaign(JSON.stringify({ ...campaign, title: 7 }))),
  ];

  assert.deepEqual(answers.map(a => `${a.status} ${JSON.parse(a.body).error.code}`), Array(5).fill("400 bad_request"));
  assert.match(JSON.parse(answers[3]!.body).error.message, /campaign\.json/);
});
