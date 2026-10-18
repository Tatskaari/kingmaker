import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import * as verbs from "../client/headless.ts";
import { portLink } from "../client/net/port.ts";
import { Replica } from "../client/net/replica.ts";
import { callDetail, rowsDetail, summary, turnDetail } from "../qa/report/inspect.ts";
import { findReport, readReport } from "../qa/report/read.ts";
import { restoreReport } from "../qa/report/restore.ts";
import type { Content } from "../web/server/content.ts";
import { memoryDatabase } from "../web/server/database.ts";
import { fakeModel } from "../web/server/model.ts";
import { openStorage } from "../web/server/sim-store.ts";
import { portDuplex } from "../web/server/transport.ts";
import { reportsDir, terminalReporting } from "./reports.ts";
import { startHost, type PageHost } from "./web/page-host.ts";
import { Identity, TimeDuration, Timestamp } from "spacetimedb";
import type { GameAnswer, GameReport } from "../shared/report/format.ts";
import { rowsFromParsed } from "../shared/report/rows.ts";
import { all, TEST_CLERK } from "../simulation/src/host/testing.ts";
import { devFake, onTop, quietGm } from "./dev/fake.ts";
import { readCampaignFiles } from "./dev/campaign.ts";
import { localHost } from "./local.ts";

/**
 * A report of a problem (V16, M5: docs/migration-log.md), from a real game: played on the local host
 * (the simulation and the AI service in one process, on the fake model), its rows and the AI
 * service's own of it given to its owner alone.
 */

const FILES = { ...readCampaignFiles(join(import.meta.dirname, "..", "campaigns", "caerwyn")), "scenes/hanged-clerk.kmscene": readFileSync(TEST_CLERK, "utf8") };
const WREN = new Identity(0x1001n);
const SDK = { Identity, Timestamp, TimeDuration };
/** The page host's dice, fixed: a test never rolls the page's own randomness. */
const DICE = 7;

/** A game played a few turns on the local host: made, walked into the yard (its opening), and two lines said. */
async function played() {
  const local = await localHost({ seed: 7, fake: () => onTop(quietGm(), { replies: ["Kell looks at you a long moment. “Go on.”"] }), files: FILES });
  assert.equal(local.sim.as(WREN).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a quick-witted investigator lent to the case by the King", build: "ranger" }), undefined);
  assert.equal(local.sim.as(WREN).walk({ toward: "lead" }), undefined);
  await local.sim.drain();
  for (const text of ["Sergeant, who found him?", "(I look closely at Prout's boots)"]) {
    assert.equal(local.sim.as(WREN).say({ text }), undefined);
    await local.sim.drain();
  }
  return { local, game: all(local.sim.db.game)[0]! };
}

test("report_game: every table's rows of the owner's game, and the AI service's calls, memory reviews and docs for it; another's game, or none, refused", async () => {
  const { local, game } = await played();
  try {
    const answer = JSON.parse(await local.sim.report(WREN, game.id)) as GameAnswer;
    assert.ok(!("refusal" in answer), JSON.stringify(answer).slice(0, 300));
    const report = answer as GameReport;

    assert.deepEqual([report.kind, report.id, report.uid, report.campaign], ["kingmaker-game", String(game.id), game.uid, "caerwyn@0.1.0"]);
    const rows = rowsFromParsed(report.rows, SDK);
    assert.equal(rows.game!.length, 1);
    assert.deepEqual(rows.game![0]!.id, game.id, "a u64 comes back a bigint");
    assert.ok((rows.player![0]!.identity as Identity).isEqual(WREN), "an identity comes back an Identity");
    assert.ok(rows.transcript!.some(r => r.text === "(I look closely at Prout's boots)"));
    for (const table of ["player", "seat", "sheet", "dice", "scene", "gmState", "turn", "transcript", "place", "entity", "position", "rulesState", "explore", "onStage"]) {
      assert.ok(rows[table]!.length > 0, `${table} has the game's rows`);
    }
    assert.ok(!("error" in report.ai), "the AI service's own came");
    if ("error" in report.ai) return;
    const ops = report.ai.calls.calls.map(c => c.operation);
    assert.ok(ops.includes("two-part.opening") && ops.includes("two-part.reply"), ops.join(", "));
    assert.equal(report.ai.calls.total.calls, report.ai.calls.calls.length);
    assert.equal(report.ai.docs.game, game.uid);

    assert.deepEqual(JSON.parse(await local.sim.report(new Identity(0x2002n), game.id)).refusal.code, "not_yours");
    assert.deepEqual(JSON.parse(await local.sim.report(WREN, 999n)).refusal.code, "unknown");
  } finally {
    local.close();
  }
});

test("restore_game: a reported game made a new game, for the owner alone, every row pointing at the new ones, the player's keys rewritten, played on from where it was reported; the game it came from untouched", async () => {
  const { local, game } = await played();
  const target = await localHost({ seed: 9, fake: () => onTop(quietGm(), { replies: ["Cob shrugs. “Ask the river.”"] }), files: FILES });
  try {
    const report = JSON.parse(await local.sim.report(WREN, game.id)) as GameReport;
    const TAM = new Identity(0x3003n);
    const args = { rows: JSON.stringify(report.rows), identity: TAM.toHexString(), uid: `${game.uid}-r1` };

    assert.equal(target.sim.as(TAM).restoreGame(args)?.code, "not_admin", "only the database's owner restores");
    assert.match(target.sim.as(target.sim.owner).restoreGame({ ...args, rows: "{" })?.text ?? "", /its rows aren't JSON/);
    assert.equal(target.sim.as(target.sim.owner).restoreGame(args), undefined);
    assert.match(target.sim.as(target.sim.owner).restoreGame(args)?.text ?? "", /won't do as its uid/, "a uid a game here has is refused");

    // The new game: its own ids, the restorer seated as its host, its rows pointing at its own.
    const restored = all(target.sim.db.game).find(g => g.uid === args.uid)!;
    const host = target.sim.db.player.id.find(restored.hostId)!;
    assert.ok(host.identity.isEqual(TAM));
    assert.equal(target.sim.view(TAM).mySeat()?.gameId, restored.id);
    const pc = all(target.sim.db.entity).find(e => e.key === `pc:${host.id}`);
    assert.ok(pc && pc.gameId === restored.id, "the player's character's key names the new player");
    assert.equal(host.characterId, pc.id);
    const scene = all(target.sim.db.scene).find(s => s.gameId === restored.id)!;
    const lines = all(target.sim.db.transcript).filter(t => t.sceneId === scene.id);
    assert.deepEqual(lines.filter(l => l.kind === "player").map(l => [l.speaker, l.text]), [[`player:${host.id}`, "Sergeant, who found him?"], [`player:${host.id}`, "(I look closely at Prout's boots)"]]);
    assert.equal(target.sim.db.place.id.find(scene.placeId)?.gameId, restored.id);
    assert.ok(all(target.sim.db.position).every(p => target.sim.db.entity.id.find(p.entityId)?.placeId === p.placeId), "every component points at its entity's place");

    // Played on: one more line, answered.
    assert.equal(target.sim.as(TAM).say({ text: "And the boy with the stones?" }), undefined);
    await target.sim.drain();
    const turns = all(target.sim.db.turn).filter(t => t.sceneId === scene.id).sort((a, b) => a.n - b.n);
    assert.deepEqual(turns.map(t => [t.n, t.phase]), [[0, "done"], [1, "done"], [2, "done"], [3, "done"]]);
    assert.ok(all(target.sim.db.transcript).some(t => t.sceneId === scene.id && /Ask the river/.test(t.text)));

    // Restored again where it came from: new ids beside the game it came from, which stays as it was.
    const before = JSON.stringify(rowsFromParsed(JSON.parse(await local.sim.report(WREN, game.id)).rows, SDK), (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v));
    assert.equal(local.sim.as(local.sim.owner).restoreGame({ ...args, uid: `${game.uid}-r2` }), undefined);
    const after = JSON.stringify(rowsFromParsed(JSON.parse(await local.sim.report(WREN, game.id)).rows, SDK), (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v));
    assert.equal(after, before, "the game it came from is as it was");
    assert.equal(all(local.sim.db.game).length, 2);
  } finally {
    local.close();
    target.close();
  }
});

// ---------------------------------------------------------------------------------------------
// The whole way: a game played on the fake model, reported from the headless client as the terminal's
// reports are kept, inspected, restored as `npm run report -- restore` does (its HTTP the page host's
// own), and played on a turn by the session it was restored for.

/** What the build's content.json holds, made from the repo: the campaign's files, the prompts by name, the dev fake (answering at once). */
function repoContent(): Content {
  const prompts = join(import.meta.dirname, "..", "ai", "prompts");
  const names = readdirSync(prompts, { recursive: true, encoding: "utf8" }).filter(path => path.endsWith(".md") && path !== "README.md");
  return {
    campaign: readCampaignFiles(join(import.meta.dirname, "..", "campaigns", "caerwyn")),
    prompts: Object.fromEntries(names.map(path => [relative(prompts, join(prompts, path)).split(sep).join("/").slice(0, -3), readFileSync(join(prompts, path), "utf8")])),
    fake: onTop(devFake(), { streamMs: 0, suggestDelayMs: 0 }),
  };
}

/** What a verb printed. */
function printed() {
  const lines: string[] = [];
  return { lines, out: { print: (text: string) => { lines.push(text); }, progress: () => {} }, last: () => lines[lines.length - 1] ?? "" };
}

/** SpacetimeDB's and the AI service's HTTP as the restore asks them, answered by the page host in this process. */
function inProcess(host: PageHost): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = String(init?.body ?? "");
    if (url.pathname.endsWith("/call/restore_game")) {
      const refused = host.sim.as(host.sim.owner).restoreGame(JSON.parse(body) as { rows: string; identity: string; uid: string });
      return new Response(refused ? JSON.stringify(refused) : "", { status: refused ? 530 : 200 });
    }
    const answer = await host.ai.answer({ method: init?.method ?? "GET", path: url.pathname, headers: Object.fromEntries(new Headers(init?.headers).entries()), body });
    return new Response(answer.body, { status: answer.status });
  }) as typeof fetch;
}

test("a game played on the fake model, reported from the headless client, inspected (its summary, a turn, a call, a table), restored for another session and played on a turn there", { timeout: 120_000 }, async (t: TestContext) => {
  const runs = mkdtempSync(join(tmpdir(), "km-report-"));
  const content = repoContent();
  const storage = await openStorage(memoryDatabase(), () => {});
  const host = await startHost({ model: fakeModel(content.fake), ownerMoves: true, log: () => {}, seed: DICE }, storage, content);
  const client = (session: string) => {
    const { port1, port2 } = new MessageChannel();
    host.serve(portDuplex(port2));
    const replica = new Replica(portLink(port1, { session }));
    t.after(() => { replica.close(); port1.close(); port2.close(); });
    return replica;
  };
  t.after(() => { host.stop(); rmSync(runs, { recursive: true, force: true }); });

  // Played: a ready-made ranger, into the yard (Kell's talk opens it), two lines.
  const game = client("wren");
  await game.ready;
  const quiet = printed();
  assert.equal(await verbs.newGame(game, { campaign: "caerwyn", name: "Wren Ashdown", concept: "a quick-witted investigator", build: "ranger" }, quiet.out), 0);
  assert.equal(await verbs.act(game, "talk_kell", quiet.out), 0);
  for (const line of ["Sergeant, who found him?", "(I look closely at Prout's boots)"]) assert.equal(await verbs.say(game, line, quiet.out, { settled: true }), 0, quiet.last());

  // Reported, as the headless client reports one: kept under runs/reports.
  const said = printed();
  assert.equal(await verbs.report(game, "Kell never says who found him", said.out, terminalReporting({ runs, host: "headless", env: {}, glyphs: () => "ascii" })), 0);
  const file = /tell Claude 'report (.+?)'$/.exec(said.last())?.[1];
  assert.match(file ?? "", /^\d{8}-\d{6}-game\d+\.json\.gz$/, said.last());
  const report = readReport(findReport(file!, { reports: reportsDir(runs), downloads: join(runs, "nowhere") }));

  // Inspected: the summary, a turn in full, a call, a table.
  const text = summary(report, { file });
  assert.match(text, /The player said: "Kell never says who found him"/);
  assert.match(text, /Build: [0-9a-f]{12}.*; the headless client \(npm run play\); Node v\d+/);
  assert.match(text, /Where: the scene screen\. The game: in the scene The Hanged Clerk \(row \d+\), turn 2 \(done\)/);
  assert.match(text, /── The screen as it was ──\nMODE: scene/);
  assert.match(text, /Turn 1 · The Hanged Clerk · \d\d:\d\d:\d\d · done\n> Wren Ashdown: Sergeant, who found him\?/);
  assert.match(text, /Turn 2 · The Hanged Clerk[^\n]*\n> Wren Ashdown: \(I look closely at Prout's boots\)/);
  assert.match(text, /── Calls by operation ──[\s\S]*two-part\.reply +2 /);
  const turn = turnDetail(report, "1");
  assert.match(turn, /^Turn 1 of The Hanged Clerk \(scene row \d+, hanged-clerk\) · done · \d\d:\d\d:\d\d → first text \+[\d.]+ s → done/);
  assert.match(turn, /── The reply \(#\d+ two-part\.reply[^)]*\) ──\n\S/);
  assert.match(turn, /── The co-GM \(#\d+ two-part\.co-gm[^)]*\) ──\n {2}(move|role|\(it changed nothing\))/);
  assert.match(turn, /── The stage manager \(#\d+ world\.stage[^)]*\) ──/);
  assert.match(callDetail(report, 1), /^Call #1 of \d+: two-part\.opening \(scene row \d+, turn 0, open\)[\s\S]*── Instructions ──/);
  assert.match(rowsDetail(report, "transcript"), /"text": "Sergeant, who found him\?"/);
  assert.match(rowsDetail(report), /^game +1$/m);

  // Restored for Tamsin, as the CLI restores into a stack; she carries it on from where it was reported.
  const tamsin = storage.sim.session("tamsin");
  const stack = { http: "http://stdb.local", db: "kingmaker", ownerToken: "owner", ai: "http://ai.local", bearer: "page-bearer" };
  const restored = await restoreReport(report, stack, tamsin.toHexString(), { fetch: inProcess(host) });
  assert.equal(restored.from, report.game && "id" in report.game ? report.game.id : "");
  const theirs = client("tamsin");
  await theirs.ready;
  assert.equal(theirs.view()?.entries.filter(e => e.kind === "player").map(e => e.text).join(" | "), "Sergeant, who found him? | (I look closely at Prout's boots)");
  const on = printed();
  assert.equal(await verbs.say(theirs, "And the boy with the stones?", on.out, { settled: true }), 0, on.last());
  assert.equal(theirs.view()?.turn, 3);
  assert.notEqual(theirs.home().seat?.gameId, game.home().seat?.gameId, "a new game, beside the one it came from");
});
