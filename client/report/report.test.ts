import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import type { Filed, Report } from "../../shared/report/format.ts";
import { KEYED_SCREEN, REMOVED } from "../../shared/report/redact.ts";
import type { Reporting } from "./file.ts";
import { ReportModel, SAY_SOMETHING, NOWHERE, edited, type ReportApp, type ReportStep } from "./model.ts";

/**
 * Reporting a problem (V16, M5), as the client makes one (after the prototype's src/report/report.test.ts
 * at 44c6d4a): what goes in a report and what never does, a key, planted everywhere a report reads;
 * and the question over the screen, the screen it keeps, the line typed, sending, and where it went.
 */

/** A key shaped like OpenRouter's, planted where a report picks things up. */
const PLANTED = `sk-or-v1-${"5e1f".repeat(16)}`;
/** A key the host knows of, shaped like nobody's: only knowing it's a key takes it out. */
const CURRENT = "kingmaker-test-key-7Hq2Lx9Vb4Nm6Zr1";

/** The game as a host answers report_game, with keys planted in its rows, its calls and its docs. */
const GAME = JSON.stringify({
  kind: "kingmaker-game", id: "7", uid: "g7-test", campaign: "caerwyn@0.1.0",
  rows: {
    game: [{ id: { $big: "7" }, uid: "g7-test" }],
    transcript: [{ id: { $big: "1" }, speaker: "player:1", kind: "player", text: `Here's my key: ${PLANTED}` }],
    player: [{ id: { $big: "1" }, concept: `an auditor who keeps her key (${CURRENT}) in her hat` }],
  },
  ai: {
    calls: { game: "g7-test", total: { calls: 2, reviews: 0 }, reviews: [], calls: [
      { operation: "two-part.reply", request: { headers: { Authorization: `Bearer ${PLANTED}` } }, text: "Kell looks up." },
      { operation: "two-part.co-gm", error: `HTTP 401: the key ${CURRENT} was refused` },
    ] },
    docs: { game: "g7-test", docs: [{ path: "Cast/Cob/notes.md", text: `The investigator dropped a card with ${PLANTED} on it.` }] },
  },
});

/** A host's reporting that keeps what it's given: the bytes, and the words it says. */
function keeping(keys: string[] = [CURRENT]) {
  const kept: Array<{ bytes: Uint8Array; at: string; game?: string }> = [];
  const reporting: Reporting = {
    build: () => ({ host: "terminal", commit: "abc123", dirty: false, node: "v26.9.0", platform: "linux x64" }),
    settings: () => ({ glyphs: "plain", terminal: { cols: 130, rows: 42 }, env: { KM_GLYPHS: "plain" } }),
    keys: () => keys,
    keep: async packed => { kept.push(packed); return { file: "20261018-120000-game7.json.gz", said: "Saved runs/reports/20261018-120000-game7.json.gz: tell Claude 'report 20261018-120000-game7.json.gz'" } satisfies Filed; },
  };
  return { reporting, kept, report: () => JSON.parse(gunzipSync(kept[kept.length - 1]!.bytes).toString("utf8")) as Report };
}

/** The app as a report reads it: where the player is, the game, and its host's answer for it. */
function app(game: bigint | "none" = 7n): ReportApp & { asked: bigint[] } {
  const asked: bigint[] = [];
  return {
    asked,
    where: from => ({ screen: "scene", ...(from ? { overlay: from } : {}), game: "7", scene: { id: "3", title: "The Hanged Clerk", turn: 2, phase: "done" } }),
    game: () => (game === "none" ? undefined : game),
    backend: { reportGame: async g => { asked.push(g); return GAME; } },
  };
}

test("a report holds the player's words, the build, the settings, where, the screens, the game its host gave and the errors, and no key: none planted survives, the screen with one isn't kept, each one counted", async () => {
  const { reporting, kept, report } = keeping();
  const reports = new ReportModel(app(), reporting);
  reports.noted.game = "7";
  reports.noted.error("a turn", new Error(`OpenRouter turned down ${PLANTED}`));
  reports.noted.screen("explore", "the map, with nothing secret on it");
  // The key typed into the scene's box, wrapped across its rows.
  reports.screen = () => `│ the box: ${CURRENT.slice(0, 20)} │\n│ ${CURRENT.slice(20)} │`;

  reports.ask("/report");
  await reports.send(`Kell keeps asking. (Here's my key: ${PLANTED})`);

  const bytes = kept[0]!.bytes;
  const text = gunzipSync(bytes).toString("utf8");
  for (const key of [PLANTED, CURRENT]) assert.ok(!text.includes(key) && !Buffer.from(bytes).includes(key), `a key survived: ${key.slice(0, 12)}…`);
  assert.doesNotMatch(text, /sk-or-v1-[0-9a-f]{8}/);

  const r = report();
  assert.equal(r.redacted, 8, "each one counted, the error's stack too (the screen isn't kept at all)");
  assert.equal(r.words, `Kell keeps asking. (Here's my key: ${REMOVED})`);
  assert.equal(r.screens.now, KEYED_SCREEN);
  assert.deepEqual(r.screens.recent.map(s => s.text), ["the map, with nothing secret on it"]);
  assert.match(r.errors[0]!.message, /turned down \[key removed\]/);
  assert.match(r.errors[0]!.stack ?? "", /report\.test\.ts/, "the error keeps its stack");
  assert.equal(r.errors[0]!.game, "7");
  assert.deepEqual([r.kind, r.format, r.build.commit, r.settings.terminal, r.where.overlay, r.where.scene?.title], ["kingmaker-report", 2, "abc123", { cols: 130, rows: 42 }, "/report", "The Hanged Clerk"]);
  const game = r.game as { rows: Record<string, Array<Record<string, unknown>>>; ai: { calls: { calls: Array<Record<string, unknown>> }; docs: { docs: Array<{ text: string }> } } };
  assert.match(String(game.rows.transcript![0]!.text), /Here's my key: \[key removed\]/);
  assert.match(String(game.rows.player![0]!.concept), /keeps her key \(\[key removed\]\) in her hat/);
  assert.match(String(game.ai.calls.calls[1]!.error), /the key \[key removed\] was refused/);
  assert.match(game.ai.docs.docs[0]!.text, /a card with \[key removed\] on it/);
  assert.equal(kept[0]!.game, "7");
});

test("the question over the screen: the screen as it was kept (from an Esc menu, the last noted before it), the line typed, nothing sent until there's something to say, then where it went", async () => {
  const { reporting, kept } = keeping();
  const reports = new ReportModel(app(), reporting);
  const filed: string[] = [];
  reports.onFiled = said => filed.push(said);
  reports.noted.screen("explore", "the map before the menu");
  reports.screen = () => "the menu over the map";

  reports.ask("menu");
  assert.deepEqual(reports.state, { step: "asking", text: "", cursor: 0 });
  reports.key({ name: "return" });
  assert.deepEqual(reports.state, { step: "asking", text: "", cursor: 0, problem: SAY_SOMETHING }, "Enter with nothing typed says so, and sends nothing");
  for (const ch of "Cob walked off") reports.key({ name: ch === " " ? "space" : ch, sequence: ch });
  reports.key({ name: "left" });
  reports.key({ name: "backspace" });
  reports.paste("ff the\nedge");
  assert.equal(reports.state?.step === "asking" && reports.state.text, "Cob walked off the edgef");

  const sending = reports.send("Cob walked off the edge of the world");
  assert.equal(reports.state?.step, "sending");
  reports.key({ name: "escape" });
  assert.equal(reports.state?.step, "sending", "never put away while it's being saved");
  await sending;

  const said = reports.state as ReportStep | undefined;
  assert.equal(said?.step === "said" && said.said, "Saved runs/reports/20261018-120000-game7.json.gz: tell Claude 'report 20261018-120000-game7.json.gz'");
  assert.deepEqual(filed, [said?.step === "said" ? said.said : ""], "the map's What happens keeps it too");
  const r = JSON.parse(gunzipSync(kept[0]!.bytes).toString("utf8")) as Report;
  assert.equal(r.screens.now, "the map before the menu");
  reports.key({ name: "return" });
  assert.equal(reports.state, undefined, "Enter, once it's said, puts it away");
});

test("from the title it's about the latest game; with none, there's no game in it; with nowhere to keep it (the demo), it says so", async () => {
  const none = keeping();
  const reports = new ReportModel(app("none"), none.reporting);
  reports.ask("the title");
  await reports.send("The tagline fell off");
  assert.equal(none.report().game, undefined);
  assert.equal(none.kept[0]!.game, undefined);

  const nowhere = new ReportModel(app());
  nowhere.ask("b");
  await nowhere.send("nobody keeps this");
  assert.deepEqual(nowhere.state, { step: "said", said: NOWHERE, failed: true });
});

test("the line's editing: typed where the cursor is, Backspace and Delete, the arrows, Home and End, Ctrl+U and Ctrl+W; a key that doesn't edit, none", () => {
  const at = (text: string, cursor = text.length) => ({ text, cursor });
  assert.deepEqual(edited(at("Kel"), { name: "l", sequence: "l" }), at("Kell"));
  assert.deepEqual(edited(at("Kell", 2), { name: "backspace" }), at("Kll", 1));
  assert.deepEqual(edited(at("Kell", 0), { name: "delete" }), at("ell", 0));
  assert.deepEqual(edited(at("Kell asked twice"), { name: "w", ctrl: true }), at("Kell asked "));
  assert.deepEqual(edited(at("Kell asked", 4), { name: "u", ctrl: true }), at(" asked", 0));
  assert.deepEqual([edited(at("abc", 1), { name: "home" }), edited(at("abc", 1), { name: "end" })], [at("abc", 0), at("abc", 3)]);
  assert.equal(edited(at("abc"), { name: "up", sequence: "\u001b[A" }), undefined);
  assert.equal(edited(at("abc"), { name: "c", sequence: "c", ctrl: true }), undefined);
});
