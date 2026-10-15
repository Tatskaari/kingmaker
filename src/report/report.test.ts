import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
const RUNS = mkdtempSync(join(tmpdir(), "km-report-"));
process.env.KM_RUNS_DIR = RUNS;
process.env.KM_COST_LEDGER = join(RUNS, "cost-ledger.jsonl");
process.env.KM_LOOK_MODEL = "off";
process.env.KM_GLYPHS = "ascii";
process.env.KM_APP_STEP_MS = "0";
process.env.KM_APP_COMBAT_DELAY_MS = "0";
process.env.OPENROUTER_API_KEY = "offline";
const { fileReport, KEEP_CALLS, KEEP_SNAPSHOTS, makeDump, setReportSink } = await import("./dump.ts");
const { forgetRecent, noteError, noteScreen } = await import("./recent.ts");
const { callDetail, readDump, snapshotDetail, summary, worldDiff } = await import("./inspect.ts");
const { restoreDump } = await import("./restore.ts");
const { sessionDir } = await import("../runtime/session.ts");
const { setBackgroundRunner } = await import("../runtime/background.ts");
const { recordCost, setCallLog } = await import("../llm/openrouter.ts");
const { fakeOpenRouter } = await import("../llm/fake-openrouter.ts");
const { Game: Core } = await import("../game/play.ts");
const { exploreState, town } = await import("../game/town.ts");
const { mapFights } = await import("../game/fights.ts");
const { PREGENS } = await import("../game/combat/index.ts");
const { placePlayer, triggerById, triggerTile } = await import("../game/zoo/explorer.ts");
const { Game } = await import("../app/game.ts");

/**
 * Reporting a problem (src/report): what goes in a report and what never does (the key), reading
 * one made from a real game (played through the real turn, with a stand-in for OpenRouter), and
 * restoring its game as a new session that plays on.
 */

/** A key shaped like OpenRouter's, planted where a report picks things up. */
const PLANTED = `sk-or-v1-${"5e1f".repeat(16)}`;
/** The key in use: shaped like nobody's, so only knowing it's the key takes it out. */
const CURRENT = "kingmaker-test-key-7Hq2Lx9Vb4Nm6Zr1";

// The GM's notes between turns would be processes of their own, with the real OpenRouter: not here.
setBackgroundRunner(() => {});

/** The file a report went to, from what the game said of it. */
const fileOf = (said: string) => join(RUNS, "reports", /tell Claude 'report (.+?)'/.exec(said)![1]!);

/** The commit this checkout is at, if git can say (a report's build is that commit). */
const COMMIT = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return undefined; } })();

test("a report holds the player's words, the build, the settings, where, the screens, the game's files, calls and notes, its ledger lines and the errors, and no key", async () => {
  forgetRecent();
  const id = "planted-game";
  const dir = sessionDir(id);
  mkdirSync(join(dir, "snapshots"), { recursive: true });
  mkdirSync(join(dir, "docs", "Cast", "Cob", "memories"), { recursive: true });
  const state = {
    id, sceneId: "hanged-clerk", approach: "v2", beat: "yard", turn: 2, turnsInBeat: 2, path: [], metrics: [], history: [],
    player: { name: "Tamsin Vell", concept: `an auditor who keeps her key (${PLANTED}) in her hat`, modifiers: {} },
    transcript: [{ turn: 1, scene: "hanged-clerk", speaker: "player", kind: "player", text: "Who found him?" }],
  };
  writeFileSync(join(dir, "state.json"), JSON.stringify(state));
  writeFileSync(join(dir, "game.json"), JSON.stringify({ version: 1, id, mode: "scene", story: { time: "morning", played: [], lead: "hanged-clerk", flags: {} }, explore: { ex: { map: "caerwyn", at: { x: 42, y: 11 } } }, recent: [] }));
  writeFileSync(join(dir, "app.json"), JSON.stringify({ version: 2, sessionId: id, messages: ["You come into the granary lane."], journal: [], savedAt: "" }));
  writeFileSync(join(dir, "snapshots", "hanged-clerk-turn-001.json"), JSON.stringify({ ...state, turn: 1, notes: `the co-GM saw ${CURRENT}` }));
  const call = (at: string, operation: string, more: object) => JSON.stringify({ at, provider: "openrouter", operation, model: "openai/gpt-6-luna", latencyMs: 812, costUsd: 0.0012, ...more });
  writeFileSync(join(dir, "calls.jsonl"), [
    call("2026-10-15T10:00:01.000Z", "gm.opening", { request: { instructions: "Open the scene." }, text: "Prout turns on the hoist." }),
    call("2026-10-15T10:00:05.000Z", "gm.reply", { request: { headers: { Authorization: `Bearer ${PLANTED}` } }, error: `HTTP 401: the key ${CURRENT} was refused` }),
    "{ a line cut short by a crash",
  ].join("\n") + "\n");
  writeFileSync(join(dir, "memory-reviews.jsonl"), `${JSON.stringify({ turn: 1, saved: ["Kell remembers the arrow"] })}\n`);
  writeFileSync(join(dir, "repair-001.json"), JSON.stringify({ sceneId: "hanged-clerk", turn: 1, notes: "Cob is the way in" }));
  writeFileSync(join(dir, "docs", "Cast", "Cob", "memories", "index.md"), `---\nsummary: "Cob's memories"\n---\nThe investigator dropped a card with ${PLANTED} on it.\n`);
  writeFileSync(join(dir, "remember-2.lock"), "2");
  writeFileSync(process.env.KM_COST_LEDGER!, [
    // From before the ledger named games: matched by one of this game's calls (its time, operation, cost and latency).
    { at: "2026-10-15T10:00:01.000Z", provider: "openrouter", operation: "gm.opening", model: "openai/gpt-6-luna", costUsd: 0.0012, latencyMs: 812.4 },
    { at: "2026-10-15T10:00:03.000Z", provider: "jev", operation: "memory.disclose.cob", model: "jev", costUsd: 0.0001, latencyMs: 300, session: id },
    { at: "2026-10-15T10:00:03.000Z", provider: "jev", operation: "memory.disclose.cob", model: "jev", costUsd: 0.0001, latencyMs: 300, session: "another-game" },
    { at: "2026-10-14T10:00:01.000Z", provider: "openrouter", operation: "gm.opening", model: "openai/gpt-6-luna", costUsd: 0.0012, latencyMs: 812 },
  ].map(l => JSON.stringify(l)).join("\n") + "\n");
  noteError("a turn", new Error(`OpenRouter turned down ${PLANTED}`));
  noteScreen("explore", "the map, with nothing secret on it");

  process.env.OPENROUTER_API_KEY = CURRENT;
  let filed;
  try {
    filed = await fileReport({
      words: `Kell keeps asking. (Here's my key: ${PLANTED})`, session: id, where: { screen: "scene", busy: "The GM is thinking…" },
      // The key typed into the box, wrapped across its rows.
      screen: `│ the box: ${CURRENT.slice(0, 20)} │\n│ ${CURRENT.slice(20)} │`, terminal: { cols: 130, rows: 42 }, glyphs: "ascii",
    });
  } finally {
    process.env.OPENROUTER_API_KEY = "offline";
  }

  // No key survives, anywhere in it: the planted one in the call log, the state (and its snapshot),
  // the docs, the error (its message and its stack) and the words; the one in use, in the snapshot,
  // a call's error and the screen.
  const bytes = readFileSync(filed.path!);
  const text = gunzipSync(bytes).toString("utf8");
  for (const key of [PLANTED, CURRENT]) assert.ok(!text.includes(key) && !bytes.includes(key), `a key survived: ${key.slice(0, 12)}…`);
  assert.doesNotMatch(text, /sk-or-v1-[0-9a-f]{8}/);
  const dump = readDump(filed.path!);
  assert.equal(dump.redacted, 9, "each one counted (the screen isn't kept at all)");
  assert.equal(dump.words, "Kell keeps asking. (Here's my key: [key removed])");
  assert.match((dump.game!.files.state as { player: { concept: string } }).player.concept, /keeps her key \(\[key removed\]\) in her hat/);
  assert.match(String(dump.game!.calls.kept[1]!["error"]), /the key \[key removed\] was refused/);
  assert.equal(dump.screens.now, "(This screen had something like a key on it, so it isn't kept.)");
  assert.match(dump.errors[0]!.message, /turned down \[key removed\]/);
  assert.match(dump.errors[0]!.stack ?? "", /report\.test\.ts/, "the error keeps its stack");

  // What's in it.
  assert.equal(dump.build.host, "terminal");
  assert.equal(dump.build.commit, COMMIT);
  assert.deepEqual(dump.settings.terminal, { cols: 130, rows: 42 });
  assert.equal(dump.settings.glyphs, "ascii");
  assert.equal(dump.settings.approach, "v2");
  assert.equal(dump.settings.offline, true, "the key in use isn't an OpenRouter key");
  assert.ok(!Object.keys(dump.settings.env).some(k => /KEY/.test(k)));
  assert.equal(dump.where.busy, "The GM is thinking…");
  assert.deepEqual(dump.where.place, { player: "Tamsin Vell", mode: "scene", scene: "hanged-clerk", beat: "yard", turn: 2, turnsInBeat: 2, time: "morning", lead: "hanged-clerk", map: "caerwyn", at: { x: 42, y: 11 } });
  assert.deepEqual(dump.screens.recent.map(s => s.text), ["the map, with nothing secret on it"]);
  const game = dump.game!;
  assert.equal(game.id, id);
  assert.ok(game.files.game && game.files.app);
  assert.deepEqual(game.snapshots.map(s => s.name), ["hanged-clerk-turn-001.json"]);
  assert.equal(game.calls.total, 3);
  assert.deepEqual(game.calls.kept[2], { unreadable: "{ a line cut short by a crash" });
  assert.equal(game.memoryReviews.length, 1);
  assert.deepEqual(game.repairs.map(r => r.name), ["repair-001.json"]);
  assert.deepEqual(game.docs.map(d => d.path), ["Cast/Cob/memories/index.md"]);
  assert.deepEqual(game.ledger.map(l => `${l["operation"]} ${l["session"] ?? "-"}`), ["gm.opening -", `memory.disclose.cob ${id}`], "its own ledger lines, and none of another game's or another day's");
  assert.deepEqual(game.others, ["remember-2.lock"]);

  // Where it went, and what the game says of it (the whole path, as it's outside where the game was started).
  assert.match(filed.file, /^\d{8}-\d{6}-planted-game\.json\.gz$/);
  assert.equal(filed.path, join(RUNS, "reports", filed.file));
  assert.equal(filed.said, `Saved ${filed.path}: tell Claude 'report ${filed.file}'`);
});

test("a report keeps the last 300 calls and the last 10 snapshots", () => {
  const id = "long-game";
  const dir = sessionDir(id);
  mkdirSync(join(dir, "snapshots"), { recursive: true });
  writeFileSync(join(dir, "game.json"), JSON.stringify({ version: 1, id, mode: "scene", story: { time: "morning", played: [], flags: {} }, explore: {}, recent: [] }));
  writeFileSync(join(dir, "calls.jsonl"), Array.from({ length: KEEP_CALLS + 5 }, (_, n) => JSON.stringify({ at: "2026-10-15T10:00:00.000Z", operation: "gm.reply", n })).join("\n"));
  for (let turn = 1; turn <= KEEP_SNAPSHOTS + 2; turn++) {
    const file = join(dir, "snapshots", `hanged-clerk-turn-${String(turn).padStart(3, "0")}.json`);
    writeFileSync(file, JSON.stringify({ id, turn }));
    utimesSync(file, 1_000_000 + turn, 1_000_000 + turn);
  }
  const game = makeDump({ words: "a long game", session: id, where: { screen: "scene" } }).game!;
  assert.equal(game.calls.total, KEEP_CALLS + 5);
  assert.equal(game.calls.kept.length, KEEP_CALLS);
  assert.equal(game.calls.kept[0]!["n"], 5, "the latest are kept");
  assert.deepEqual(game.snapshots.map(s => (s.state as { turn: number }).turn), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test("the cost ledger names the game each call was for", () => {
  setCallLog(join(sessionDir("ledger-game"), "calls.jsonl"));
  recordCost("openrouter", "gm.reply", "openai/gpt-6-luna", 0.001, 100);
  const last = readFileSync(process.env.KM_COST_LEDGER!, "utf8").trim().split("\n").at(-1)!;
  assert.equal(JSON.parse(last).session, "ledger-game");
  setCallLog(undefined);
});

/** A real game, played: made, walked to the lead, its scene opened and two turns taken, with the GM, the decider and the stage manager stood in for. */
async function playedGame() {
  const core = await Core.create({ player: "Tamsin Vell: a disgraced palace auditor", level: 3, build: PREGENS.rogue!.build, explorer: town, fights: mapFights(), seed: 7 });
  setCallLog(join(sessionDir(core.state.id), "calls.jsonl"));
  for (let i = 0; i < 6 && core.state.mode === "explore"; i++) await core.act("go_to_lead");
  assert.equal(core.state.mode, "scene", "the walk to the lead opens its scene");
  await core.say("Who found him, Sergeant?");
  await core.say("(I look closely at Prout's boots)");
  return core;
}

const GM = [
  "Prout turns slowly on the hoist rope. Sergeant Kell looks up from her notebook. “Investigator. The Captain says suicide.”",
  "Kell taps her pencil against the notebook. “The porters found him at first light.” Cob throws another stone.",
  "Kell shrugs. “Boots are boots.” She writes something down anyway.",
];
/** The stage manager asks for something the world can't do: it's on record as "(not done)". */
const NOT_DONE = { world_ops: { ops: [{ op: "move", what: "cob", to: "the-moon", how: "", feet: 0, quantity: 0, name: "", kind: "", text: "", add: [], remove: [] }] } };

test("inspect reads a real game's report: where they were, the screen, each turn's line, the decider, the GM, the stage manager and what came of it, and the calls", async () => {
  forgetRecent();
  const fake = fakeOpenRouter({ replies: GM, byName: NOT_DONE });
  try {
    const core = await playedGame();
    const app = new Game();
    app.core = core;
    app.screen = "scene";
    app.screenText = () => "╭─ Tamsin Vell ──────────╮\n│ Who found him, Sergeant? │";
    app.terminalSize = () => ({ cols: 80, rows: 24 });
    app.openReport();
    assert.equal(app.overlay?.kind, "report");
    await app.sendReport("Kell never says who found him, and Cob walked off the edge of the world");
    const said = app.overlay?.kind === "report" ? app.overlay.said ?? "" : "";
    assert.match(said, /^Saved .*reports\/\d{8}-\d{6}-.*\.json\.gz: tell Claude 'report .*'$/);
    const dump = readDump(fileOf(said));
    const text = summary(dump, { file: basename(fileOf(said)) });
    assert.match(text, /The player said: "Kell never says who found him, and Cob walked off the edge of the world"/);
    assert.match(text, new RegExp(`Build: ${COMMIT ? COMMIT.slice(0, 12) : "commit unknown"}.*; the terminal app; Node v\\d+`));
    assert.match(text, /Settings: approach v2 · glyphs ascii · terminal 80x24/);
    assert.match(text, /Where: the scene screen\. The game: in the scene The Hanged Clerk \(hanged-clerk\), beat \S+, turn 2 \(\d+ in the beat\), morning\./);
    assert.match(text, /── The screen as it was \(80x24\) ──\n╭─ Tamsin Vell/);
    assert.match(text, /The GM, between turns \(after turn 0\) · The Hanged Clerk\n {2}GM \(#\d+ gm\.opening[^)]*\):\n {4}Prout turns slowly on the hoist rope/);
    assert.match(text, /Turn 1 · The Hanged Clerk · \d\d:\d\d:\d\d\n> Tamsin Vell: Who found him, Sergeant\?\n {2}decider \(#\d+ director\.before, \d+ ms[^)]*\): nothing out of the way \[attempt=none/);
    assert.match(text, /GM \(#\d+ gm\.reply[^)]*\):\n {4}Kell taps her pencil/);
    assert.match(text, /after \(#\d+ director\.after[^)]*\): [^\n]*\[status=on_track ending=not_yet/);
    assert.match(text, /stage \(#\d+ world\.stage[^)]*\): move cob → the-moon\n {4}→ stage: \(not done\) move: nothing matches "the-moon"/);
    assert.match(text, /timing: decided \d+ ms · first text \d+ ms/);
    assert.match(text, /Turn 2 · The Hanged Clerk[^\n]*\n> Tamsin Vell: \(I look closely at Prout's boots\)[\s\S]*Boots are boots/);
    assert.match(text, /── Calls by operation ──[\s\S]*gm\.reply +2 /);
    // A call in full, a snapshot, and the world between the turns.
    const reply = dump.game!.calls.kept.findIndex(c => c["operation"] === "gm.reply") + 1;
    assert.match(callDetail(dump, reply), /^Call #\d+ of \d+: gm\.reply \(turn 1\)[\s\S]*── Instructions ──[\s\S]*── Input \(developer\) ──[\s\S]*── Reply ──\nKell taps her pencil/);
    assert.match(snapshotDetail(dump, "1"), /^Snapshot hanged-clerk-turn-001\.json[\s\S]*> Tamsin Vell: Who found him, Sergeant\?[\s\S]*── The world from above ──/);
    assert.match(worldDiff(dump, "2"), /^The world from hanged-clerk-turn-001\.json to hanged-clerk-turn-002\.json[\s\S]*turn 2 · stage: \(not done\) move: nothing matches "the-moon"/);
  } finally {
    fake.restore();
  }
});

test("a report's game restores as a new session, as it was reported, which Continue and the QA console open and play on", async () => {
  const fake = fakeOpenRouter({ replies: [...GM, "Cob shrugs. “Ask the river.”"], byName: NOT_DONE });
  try {
    const core = await playedGame();
    const original = readFileSync(join(sessionDir(core.state.id), "state.json"), "utf8");
    const reporter = new Game();
    reporter.core = core;
    reporter.screen = "scene";
    reporter.openReport();
    await reporter.sendReport("restore me");
    const dump = readDump(fileOf(reporter.overlay?.kind === "report" ? reporter.overlay.said ?? "" : ""));
    const restored = restoreDump(dump);
    assert.ok(restored.id.startsWith(`${core.state.id}-r`), restored.id);
    // Its saves, under its own id (inside them too), as they were.
    const saved = (name: string) => JSON.parse(readFileSync(join(restored.dir, name), "utf8"));
    assert.equal(saved("game.json").id, restored.id);
    assert.equal(saved("state.json").id, restored.id);
    assert.equal(saved("app.json").sessionId, restored.id);
    assert.equal(saved("snapshots/hanged-clerk-turn-002.json").id, restored.id);
    assert.equal(saved("state.json").turn, 2);
    assert.deepEqual(saved("state.json").transcript, core.session.transcript);
    assert.equal(readFileSync(join(restored.dir, "calls.jsonl"), "utf8").trim().split("\n").length, dump.game!.calls.kept.length);
    // Continue offers it (the latest game), and the app takes it up in its scene.
    const app = new Game();
    app.loadSaves();
    assert.equal(app.saves[0]?.id, restored.id);
    await app.resume(app.saves[0]!);
    assert.equal(app.screen, "scene");
    assert.ok(app.lines.some(l => l.text === "(I look closely at Prout's boots)"));
    // The QA console's way: it's there by id, and a turn plays on it, under its own id.
    assert.ok(Core.exists(restored.id));
    const loaded = Core.load(restored.id, town, mapFights());
    setCallLog(join(sessionDir(restored.id), "calls.jsonl"));
    await loaded.say("And the boy with the stones?");
    assert.equal(loaded.session.turn, 3);
    assert.equal(JSON.parse(readFileSync(join(restored.dir, "state.json"), "utf8")).turn, 3);
    assert.equal(readFileSync(join(sessionDir(core.state.id), "state.json"), "utf8"), original, "the game reported on is as it was");
    // A restore never overwrites.
    assert.throws(() => restoreDump(dump, { id: restored.id }), /never overwrites/);
  } finally {
    fake.restore();
  }
});

test("from the zoo a report has the visit's own state; from the title it's about the latest game", async () => {
  forgetRecent();
  const app = new Game();
  await app.zoo();
  // The numbers bell (the burning gallery's), set off from its tile's menu.
  const found = triggerById("numbers-bell")!;
  placePlayer(app.core!.state, found.wing.id, found.wing.entry);
  const at = triggerTile(exploreState(app.core!.state), found.wing, found.trigger)!;
  app.openMenu(at, 10, 10);
  await app.chooseFromMenu(app.menu!.actions.findIndex(a => a.id === "use_numbers-bell"));
  // What went wrong can come with the command: it goes at once.
  assert.ok(app.peek("/report The numbers bell's numbers floated over the wrong post"));
  for (let i = 0; i < 100 && !(app.overlay?.kind === "report" && app.overlay.said); i++) await new Promise(r => setTimeout(r, 20));
  const said = app.overlay?.kind === "report" ? app.overlay.said ?? "" : "";
  assert.ok(app.messages.at(-1)?.startsWith("Saved "), "on the map, What happens says where it went too");
  const visit = readDump(fileOf(said));
  assert.equal(visit.words, "The numbers bell's numbers floated over the wrong post");
  assert.equal(visit.where.place?.hub, "zoo");
  assert.equal(visit.zoo?.["wing"], found.wing.id);
  assert.ok((visit.zoo?.["seen"] as string[]).includes(found.exhibit.id));
  assert.match(summary(visit), /── The zoo: in zoo-fire; \d+ exhibits seen ──[\s\S]*The last thing set off/);

  // Back on the title: the visit is the latest game played. What went wrong is noted as the game's it went wrong in.
  const id = app.core!.state.id;
  noteError("in the zoo", new Error("a lever stuck"));
  app.quitToTitle();
  noteError("on the title", new Error("the tagline fell off"));
  app.openReport();
  await app.sendReport("Continue wasn't offered");
  const title = readDump(fileOf(app.overlay?.kind === "report" ? app.overlay.said ?? "" : ""));
  assert.equal(title.where.screen, "title");
  assert.equal(title.where.latest, true);
  assert.equal(title.game?.id, id);
  assert.deepEqual(title.errors.map(e => e.game), [id, undefined]);
  assert.match(summary(title), /in the zoo: a lever stuck[\s\S]*on the title \(no game on\): the tagline fell off/);
});

test("the static build's reports go where its sink sends them (the page, to download)", async () => {
  const got: Array<{ bytes: Uint8Array; at: string; session?: string }> = [];
  setReportSink(async report => { got.push(report); return { file: "kingmaker-report-x.json.gz", said: "Downloaded kingmaker-report-x.json.gz" }; });
  try {
    const filed = await fileReport({ words: "in the browser", where: { screen: "title" } });
    assert.equal(filed.said, "Downloaded kingmaker-report-x.json.gz");
    const dump = JSON.parse(gunzipSync(got[0]!.bytes).toString("utf8"));
    assert.equal(dump.words, "in the browser");
    assert.equal(dump.game, undefined);
    assert.equal(got[0]!.session, undefined);
  } finally {
    setReportSink(undefined);
  }
});
