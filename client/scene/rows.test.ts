import assert from "node:assert/strict";
import { test } from "node:test";
import { YARD, yardRows } from "../check/fixture.ts";
import { markupOf, sceneViewOf, type SceneRows } from "./rows.ts";
import { linesOf } from "./view.ts";

type TurnRow = SceneRows["turns"][number];
type DraftRow = SceneRows["drafts"][number];
type LineRow = SceneRows["suggestions"][number];

const turn = (id: bigint, n: number, phase: string, more: Partial<TurnRow> = {}): TurnRow => ({ id, n, phase, note: undefined, error: undefined, suggest: "none", ...more });
const draft = (turnId: bigint, text: string, attempt = 1, seq = 1): DraftRow => ({ turnId, speaker: "gm", text, markup: undefined, attempt, seq });

/** Tamsin Vell (player 1) has the lead in the granary yard; Kell and Cob are on stage, Kell with her look. */
const base = (): SceneRows => ({
  me: 1n,
  game: { id: 3n, time: "morning" },
  scene: { id: 7n, title: "The Hanged Clerk", hook: "A clerk hangs in the granary yard.", status: "live", controllerId: 1n, turnId: undefined, turns: 0 },
  players: [{ id: 1n, name: "Tamsin Vell", suggestions: true }, { id: 2n, name: "Wren Ashdown", suggestions: true }],
  sheets: [{ playerId: 1n, statusLine: "HP 28/28" }],
  transcript: [
    { seq: 2, turn: 1, speaker: "player:1", kind: "player", text: "Sergeant, who found him?", markup: undefined },
    { seq: 1, turn: 0, speaker: "gm", kind: "narration", text: "“Sergeant Kell, of the watch.”", markup: JSON.stringify({ speech: [{ start: 0, end: 30, speaker: "kell" }] }) },
  ],
  drafts: [],
  turns: [turn(4n, 0, "done")],
  onStage: [{ entityId: 10n, role: "controller" }, { entityId: 20n, role: "cast" }, { entityId: 30n, role: "cast" }],
  names: [{ entityId: 20n, key: "kell", name: "Sergeant Agnes Kell" }, { entityId: 30n, key: "cob", name: "the boy in the too-big boots" }],
  looks: [{ entityId: 20n, fg: "#6d9eeb" }],
  suggestions: [],
});

test("the transcript in order, with names and markup; who's here, by the names the player knows, in their looks' colours", () => {
  const view = sceneViewOf(base());

  assert.deepEqual(view.entries.map(e => e.kind), ["narration", "player"]);
  assert.equal(view.entries[1]!.name, "Tamsin Vell");
  assert.equal(view.entries[0]!.markup?.speech[0]?.speaker, "kell");
  assert.deepEqual(view.present.map(p => [p.name, p.color !== undefined]), [["Sergeant Agnes Kell", true], ["the boy in the too-big boots", true]]);
  assert.equal(view.present[0]!.color, "#6d9eeb");
  assert.deepEqual([view.title, view.time, view.game, view.player.name, view.player.status], ["The Hanged Clerk", "Morning", "3", "Tamsin Vell", "HP 28/28"]);
  assert.equal(view.phase, "done");
  assert.equal(view.mayType, true);
  assert.equal(view.watching, undefined);
});

test("music gets the authored scene key and raw hour, even without a rendered place", () => {
  const rows = base();
  rows.scene.sceneKey = "hanged-clerk";
  rows.scene.time = "next-morning";
  const view = sceneViewOf(rows);
  assert.equal(view.sceneKey, "hanged-clerk");
  assert.equal(view.musicTime, "next-morning");
  assert.notEqual(view.musicTime, view.time);
  delete rows.scene.time;
  assert.equal(sceneViewOf(rows).musicTime, "morning", "the game clock supplies an unset scene hour");
  rows.scene.kind = "talk";
  rows.scene.sceneKey = "talk-kell-2";
  rows.talkTemplate = "companion-conversation";
  assert.equal(sceneViewOf(rows).sceneKey, "companion-conversation", "generated talks use the authored template's music");
});

test("a turn in flight: the phase, the draft with its attempt and seq, and no typing until it's settling", () => {
  const rows = base();
  rows.scene.turnId = 5n;
  rows.turns = [turn(5n, 1, "replying")];
  rows.drafts = [draft(5n, "Sergeant Kell glances up", 1, 3)];

  let view = sceneViewOf(rows);
  assert.equal(view.phase, "replying");
  assert.deepEqual(view.draft, { speaker: "gm", kind: "narration", text: "Sergeant Kell glances up", attempt: 1, seq: 3 });
  assert.equal(view.mayType, false);

  rows.turns = [turn(5n, 1, "settling")];
  rows.drafts = [];
  view = sceneViewOf(rows);
  assert.equal(view.mayType, true);
  assert.equal(view.draft, undefined);
});

test("a draft is the turn in flight's: a retried reply's restart comes through as its new attempt, and another turn's draft is stale", () => {
  const rows = base();
  rows.scene.turnId = 5n;
  rows.turns = [turn(5n, 1, "replying")];
  rows.drafts = [draft(4n, "an old draft", 1, 9), draft(5n, "Kell", 2, 12)];

  const view = sceneViewOf(rows);

  assert.equal(view.draft?.text, "Kell");
  assert.deepEqual([view.draft?.attempt, view.draft?.seq], [2, 12]);
});

test("a dialogue draft is named as the player knows its speaker", () => {
  const rows = base();
  rows.scene.turnId = 5n;
  rows.turns = [turn(5n, 1, "replying")];
  rows.drafts = [{ ...draft(5n, "Who's asking?"), speaker: "kell" }];

  const view = sceneViewOf(rows);

  assert.deepEqual([view.draft?.kind, view.draft?.name], ["dialogue", "Sergeant Agnes Kell"]);
});

test("a spectator never types: they're told who has the lead, and see that character's sheet", () => {
  const rows = base();
  rows.me = 2n;

  const view = sceneViewOf(rows);

  assert.equal(view.watching, "Tamsin Vell");
  assert.equal(view.mayType, false);
  assert.deepEqual(view.player, { name: "Tamsin Vell", status: "HP 28/28" });
  assert.deepEqual(view.entries, sceneViewOf(base()).entries);
});

test("a turn waiting on the AI service shows its note, until it fails; a lost connection says so first", () => {
  const rows = base();
  rows.scene.turnId = 5n;
  rows.turns = [turn(5n, 1, "replying", { note: "The GM has lost the thread for a moment: trying again." })];

  assert.equal(sceneViewOf(rows).note, "The GM has lost the thread for a moment: trying again.");
  assert.equal(sceneViewOf({ ...rows, trouble: "(Lost the game's server: reconnecting…)" }).note, "(Lost the game's server: reconnecting…)");

  rows.turns = [turn(5n, 1, "failed", { note: "The GM has lost the thread for a moment: trying again.", error: "The GM couldn't answer: 500 model_failed" })];
  const view = sceneViewOf(rows);
  assert.equal(view.note, undefined);
  assert.equal(view.failed, "The GM couldn't answer: 500 model_failed");
});

test("a connection that has stopped trying says why and what to do, in place of the turn's note, and shuts the box for good", () => {
  const rows = base();
  const turnedAway = "(The game's server turned this session away: /quit, then start again.)";
  assert.equal(sceneViewOf(rows).mayType, true);

  const view = sceneViewOf({ ...rows, trouble: turnedAway, cutOff: true });
  assert.deepEqual([view.note, view.cutOff, view.mayType], [turnedAway, true, false]);
  rows.scene.turnId = 5n;
  rows.turns = [turn(5n, 1, "replying", { note: "The GM has lost the thread for a moment: trying again." })];
  assert.equal(sceneViewOf({ ...rows, trouble: turnedAway, cutOff: true }).note, turnedAway);
});

test("a failed turn says why and shuts the box; a spectator is told who can retry it", () => {
  const rows = base();
  rows.scene.turnId = 5n;
  rows.turns = [turn(5n, 1, "failed", { error: "the AI API timed out" })];

  const view = sceneViewOf(rows);
  assert.equal(view.failed, "the AI API timed out");
  assert.equal(view.mayType, false);
  assert.equal(linesOf(view).at(-1)?.text, "The AI API timed out. /retry carries the turn on from where it got to.");

  rows.me = 2n;
  assert.equal(linesOf(sceneViewOf(rows)).at(-1)?.text, "The AI API timed out. Tamsin Vell can /retry it.");
});

test("a line said while the last turn settles waits, queued, and shuts the box; a failure behind it still shows", () => {
  const rows = base();
  rows.scene.turnId = 5n;
  rows.turns = [turn(5n, 1, "settling"), turn(6n, 2, "queued")];

  let view = sceneViewOf(rows);
  assert.deepEqual([view.phase, view.turn], ["queued", 2]);
  assert.equal(view.mayType, false);

  rows.turns = [turn(5n, 1, "failed", { error: "the settle commit failed" }), turn(6n, 2, "queued")];
  view = sceneViewOf(rows);
  assert.deepEqual([view.phase, view.turn], ["failed", 1]);
  assert.equal(view.failed, "the settle commit failed");
});

test("the box opens while the scene winds down, and not while it opens, once a reply has closed it, or after it ends", () => {
  const rows = base();
  const mayType = (status: string) => sceneViewOf({ ...rows, scene: { ...rows.scene, status } }).mayType;

  assert.deepEqual(["opening", "live", "closing", "ending", "ended"].map(mayType), [false, true, true, false, false]);
  assert.equal(sceneViewOf({ ...rows, scene: { ...rows.scene, status: "ended" } }).over, true);
});

test("a reply that closed the scene: the scene is ending while the world settles behind it, until it ends; its settle failed is a failed turn", () => {
  const rows = base();
  rows.scene = { ...rows.scene, status: "ending", turnId: 5n };
  rows.turns = [turn(5n, 1, "settling")];

  let view = sceneViewOf(rows);
  assert.deepEqual([view.phase, view.ending, view.over, view.mayType], ["settling", true, false, false]);

  rows.turns = [turn(5n, 1, "failed", { error: "The GM couldn't answer: 400 bad_request" })];
  view = sceneViewOf(rows);
  assert.deepEqual([view.phase, view.ending, view.failed], ["failed", undefined, "The GM couldn't answer: 400 bad_request"]);

  rows.scene = { ...rows.scene, status: "ended", turnId: undefined };
  rows.turns = [turn(5n, 1, "done")];
  view = sceneViewOf(rows);
  assert.deepEqual([view.phase, view.ending, view.over], ["done", undefined, true]);
});

test("markup is who says each line (notes on marks from before M2 aren't read); unreadable markup is no markup", () => {
  const markup = markupOf(JSON.stringify({
    speech: [{ start: 0, end: 5, speaker: "kell" }],
    marks: [{ start: 0, end: 5, kind: "why", note: "She's tired." }],
  }));

  assert.deepEqual(markup, { speech: [{ start: 0, end: 5, speaker: "kell" }] });
  assert.equal(markupOf("not json"), undefined);
  assert.equal(markupOf(undefined), undefined);
  assert.deepEqual(markupOf("{}"), { speech: [] });
});

// -------------------------------------------------------------------------------------------------
// V5: the suggested lines (v5-design §3.9; the noting phase and the cards went with the notes in M2).

const line = (turn: number, ord: number, kind: string, text: string): LineRow => ({ sceneId: 7n, turn, ord, kind, text });

/** Tamsin Vell's scene after turn 1's reply: its set of lines in, in any order, with turn 0's old one still in the table. */
const answered = (): SceneRows => ({
  ...base(),
  scene: { ...base().scene, turns: 1 },
  turns: [turn(4n, 0, "done", { suggest: "landed" }), turn(5n, 1, "done", { suggest: "landed" })],
  suggestions: [line(1, 2, "do", "(I look up at the loft door)"), line(0, 1, "say", "An old line"), line(1, 1, "say", "Who found him?"), line(1, 3, "try", "(I try a ha'penny on the boy)")],
});

test("the yard's rows make the yard: the fixture the screen check draws is what the rows give", () => {
  assert.deepEqual(sceneViewOf(yardRows()), YARD);
});

test("the lines are the latest turn's, in their order, for the one who has the lead with them on", () => {
  const view = sceneViewOf(answered());

  assert.deepEqual(view.suggestions, [{ kind: "say", text: "Who found him?" }, { kind: "do", text: "(I look up at the loft door)" }, { kind: "try", text: "(I try a ha'penny on the boy)" }]);
  assert.deepEqual([view.suggestionsComing, view.suggestionsOn], [false, true]);
});

test("a spectator gets no lines, nor rows kept for them; nor does anyone with them off, or once the scene's over", () => {
  const watching = sceneViewOf({ ...answered(), me: 2n });
  assert.deepEqual([watching.suggestions, watching.suggestionsComing], [[], false]);

  const rows = answered();
  rows.players = rows.players.map(p => (p.id === 1n ? { ...p, suggestions: false } : p));
  const off = sceneViewOf(rows);
  assert.deepEqual([off.suggestions, off.suggestionsComing, off.suggestionsOn], [[], false, false]);

  const over = sceneViewOf({ ...answered(), scene: { ...answered().scene, status: "ended" } });
  assert.deepEqual(over.suggestions, []);
});

test("a line just said: the last set goes at once, and the next is on its way until it lands, or is dropped", () => {
  const rows = answered();
  rows.scene = { ...rows.scene, turns: 2, turnId: 6n };
  rows.turns = [...rows.turns, turn(6n, 2, "replying")];

  let view = sceneViewOf(rows);
  assert.deepEqual([view.suggestions, view.suggestionsComing], [[], true]);

  rows.turns = [...rows.turns.slice(0, 2), turn(6n, 2, "settling", { suggest: "coming" })];
  assert.equal(sceneViewOf(rows).suggestionsComing, true);

  rows.turns = [...rows.turns.slice(0, 2), turn(6n, 2, "done", { suggest: "landed" })];
  rows.suggestions = [line(2, 1, "say", "And then?")];
  view = sceneViewOf(rows);
  assert.deepEqual([view.suggestions.map(s => s.text), view.suggestionsComing], [["And then?"], false]);

  rows.turns = [...rows.turns.slice(0, 2), turn(6n, 2, "done", { suggest: "lost" })];
  rows.suggestions = [];
  assert.deepEqual([sceneViewOf(rows).suggestions, sceneViewOf(rows).suggestionsComing], [[], false]);
});

test("the opening's lines are on their way from its start; a line queued behind a failed turn has none coming until the retry", () => {
  const opening = base();
  opening.scene = { ...opening.scene, status: "opening", turnId: 4n };
  opening.turns = [turn(4n, 0, "replying")];
  assert.equal(sceneViewOf(opening).suggestionsComing, true);

  const stuck = answered();
  stuck.scene = { ...stuck.scene, turns: 2, turnId: 5n };
  stuck.turns = [turn(4n, 0, "done"), turn(5n, 1, "failed", { error: "the settle commit failed" }), turn(6n, 2, "queued")];
  assert.equal(sceneViewOf(stuck).suggestionsComing, false);
});

test("settling: the reply's in, the world settling behind it; the box is open, and a line said waits for it", () => {
  const rows = base();
  rows.scene = { ...rows.scene, turns: 1, turnId: 5n };
  rows.turns = [turn(4n, 0, "done"), turn(5n, 1, "settling")];

  let view = sceneViewOf(rows);
  assert.deepEqual([view.phase, view.mayType], ["settling", true]);

  rows.scene = { ...rows.scene, turns: 2 };
  rows.turns = [turn(4n, 0, "done"), turn(5n, 1, "settling"), turn(6n, 2, "queued")];
  view = sceneViewOf(rows);
  assert.deepEqual([view.phase, view.turn, view.mayType, view.note], ["queued", 2, false, undefined]);

  // The AI service lost while the world settles: the line waiting behind it says so, as the settling turn holds the lease.
  rows.turns[1] = turn(5n, 1, "settling", { note: "The GM has lost the thread for a moment: trying again." });
  assert.equal(sceneViewOf(rows).note, "The GM has lost the thread for a moment: trying again.");
});
