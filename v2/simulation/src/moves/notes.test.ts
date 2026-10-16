import { test } from "node:test";
import assert from "node:assert/strict";
import type { Mark } from "../../../shared/markup.ts";
import type { DecideRequest, DecideResponse, NotesRequest, NotesResponse, OpenResponse, ReplyRequest, ReplyResponse, SettleRequest, SuggestRequest, Usage } from "../../../shared/protocol/ai.ts";
import { keyParts } from "../../../shared/protocol/keys.ts";
import { all, down, held, hostWithCampaign, http, identity, openedGame, sceneNow, tick } from "../host/testing.ts";

/**
 * The notes on a reply's marks (v5-design §3.4, §3.5), on the memory host: asked for by the commit
 * that writes a reply with something to note, put on its transcript row when they come, and waited
 * for by the turn's end (noting), whichever of the notes and the settle lands last.
 */

const usage = (calls: number, costUsd = 0): Usage => ({ calls, costUsd, byOperation: {} });
const TEXT = "Kell looks up from her notebook. “Cob found him, at first light.” The boy scowls.";
const QUOTE = "“Cob found him, at first light.”";
const AT = TEXT.indexOf(QUOTE);

/** The GM's reply: Kell's line, and any marks the GM made as it wrote. */
const kellSays = (extra: Partial<ReplyResponse["entries"][number]> = {}): ReplyResponse => ({
  entries: [{ speaker: "gm", kind: "narration", text: TEXT, markup: { speech: [{ start: AT, end: AT + QUOTE.length, speaker: "kell", tag: "Kell" }], marks: [] }, ...extra }],
  gm: { repeated: null }, firstTextMs: 3, usage: usage(1, 0.001),
});
const why: Mark = { start: AT, end: AT + QUOTE.length, kind: "why", note: "She wants you to know the boy was there first.", link: { kind: "person", id: "kell" }, card: { title: "Sergeant Agnes Kell", lines: ["You met them in this scene."] } };
const noted = (marks: Mark[] = [why]): NotesResponse => ({ marks, usage: usage(1, 0.0002) });
const settled = { ops: [], after: { landed: [], hinted: [], unanswered: false, theirs: false }, usage: usage(2, 0.0007) };

test("a reply with a spoken line: its notes asked for from its row and the scene up to it, and put on the row as its marks", async () => {
  const { host, script, wren, scene } = await openedGame();
  script.then("reply", kellSays());
  script.then("notes", noted());
  const before = all(host.db.transcript).length;

  host.as(wren).say({ text: "Who found him?" });
  await host.drain();

  const now = sceneNow(host, scene.id);
  const reply = now.lines.find(l => l.turn === 1 && l.speaker === "gm")!;
  const [sent] = script.to("notes");
  const request = sent!.body as NotesRequest;
  const game = all(host.db.game)[0]!;
  assert.deepEqual(keyParts(request.key), { game: game.uid, scene: String(scene.id), turn: 1, step: "notes" });
  assert.deepEqual(request.reply, { seq: reply.seq, text: TEXT, speech: [{ start: AT, end: AT + QUOTE.length, speaker: "kell", tag: "Kell" }], drafted: [] });
  assert.equal(request.turn.scene.turn, 1);
  assert.deepEqual(request.turn.transcript.map(e => [e.turn, e.kind]), [[0, "narration"], [1, "player"], [1, "narration"]], "the scene up to and including the reply");
  assert.equal("line" in request.turn, false, "a job beside a turn has no line of its own");

  assert.equal(all(host.db.transcript).length, before + 2, "the notes went on the reply's row: no row of their own");
  assert.deepEqual(JSON.parse(reply.markup!), { speech: request.reply.speech, marks: [why] });
  assert.deepEqual([now.turns[1]!.phase, now.turns[1]!.notes], ["done", "written"]);
  assert.equal(now.turns[1]!.calls, 1 + 1 + 2 + 1 + 2, "the decide's, reply's and settle's calls, and the notes' and the lines'");
});

test("nothing to note asks for no notes: a reply with neither a spoken line nor a mark of the GM's", async () => {
  const { host, script, wren, scene } = await openedGame();
  host.as(wren).say({ text: "Who found him?" });
  await host.drain();

  assert.equal(script.to("notes").length, 0);
  assert.equal(sceneNow(host, scene.id).turns[1]!.notes, "none");
});

test("a mark the GM made is enough to ask for notes; what it wrote on its marks never reaches the row", async () => {
  const { host, script, wren, scene } = await openedGame();
  const drafted = [{ start: 0, end: 4, kind: "know" as const }];
  const gmNote: Mark = { start: 0, end: 4, kind: "know", note: "the GM's own: Kell suspects Moll" };
  script.then("reply", { ...kellSays(), entries: [{ speaker: "gm", kind: "narration", text: TEXT, drafted }] });
  script.then("reply", kellSays({ markup: { speech: kellSays().entries[0]!.markup!.speech, marks: [gmNote] } }));
  script.then("notes", noted([]), noted([]));

  host.as(wren).say({ text: "Who found him?" });
  await host.drain();
  host.as(wren).say({ text: "And Moll?" });
  await host.drain();

  const [first, second] = script.to("notes").map(s => s.body as NotesRequest);
  assert.deepEqual([first!.reply.speech, first!.reply.drafted], [[], drafted]);
  const replies = sceneNow(host, scene.id).lines.filter(l => l.speaker === "gm" && l.turn > 0);
  assert.equal(replies[0]!.markup, undefined, "no markup came with it, and no notes were written");
  assert.deepEqual(JSON.parse(replies[1]!.markup!).marks, [], "the GM's own note is dropped as the entry is written");
  assert.equal(second!.reply.speech.length, 1);
});

test("notes before the settle: the turn ends at the settle; a line said meanwhile starts then", async () => {
  const { host, script, wren, scene } = await openedGame();
  const atSettle: string[] = [];
  script.then("reply", kellSays());
  script.then("settle", () => {
    const turn = sceneNow(host, scene.id).turns[1]!;
    atSettle.push(`${turn.phase} ${turn.notes}`);
    assert.equal(host.as(wren).say({ text: "And when?" }), undefined);
    return settled;
  });

  host.as(wren).say({ text: "Who found him?" });
  await host.drain();

  const now = sceneNow(host, scene.id);
  assert.deepEqual(atSettle, ["settling written"], "the notes were in before the settle");
  assert.deepEqual(now.turns.map(t => [t.n, t.phase]), [[0, "done"], [1, "done"], [2, "done"]]);
  assert.deepEqual(script.to("decide").map(d => (d.body as DecideRequest).turn.line.text), ["Who found him?", "And when?"]);
});

test("the settle before the notes: the turn waits for them, noting, the lease kept; a line said meanwhile waits, and starts once they land", async () => {
  const { host, script, wren, scene } = await openedGame();
  const notes = held<NotesResponse>();
  script.then("reply", kellSays());
  script.then("notes", () => notes.promise);

  host.as(wren).say({ text: "Who found him?" });
  const first = host.drain();
  await tick();
  await host.drain();

  const noting = sceneNow(host, scene.id);
  assert.deepEqual([noting.turns[1]!.phase, noting.turns[1]!.notes, noting.turns[1]!.endedAt], ["noting", "writing", undefined]);
  assert.equal(noting.scene.turnId, noting.turns[1]!.id, "the lease kept");
  assert.equal(host.as(wren).say({ text: "And when?" }), undefined, "the box is open: the line waits");
  assert.equal(host.as(wren).say({ text: "And why?" })?.code, "turn_in_flight", "one line waits, as while it settles");
  assert.deepEqual(sceneNow(host, scene.id).turns.map(t => t.phase), ["done", "noting", "queued"]);

  notes.settle(noted());
  await first;

  const now = sceneNow(host, scene.id);
  assert.deepEqual(now.turns.map(t => [t.n, t.phase]), [[0, "done"], [1, "done"], [2, "done"]]);
  assert.equal(now.scene.turnId, undefined);
  assert.equal(script.to("decide").length, 2, "the queued line started once");
  const history = (script.to("reply")[1]!.body as ReplyRequest).turn.transcript.find(e => e.turn === 1 && e.kind === "narration")!;
  assert.deepEqual(history.markup?.marks, [why], "the next reply's history has the last reply's notes");
});

test("notes that can't be written are given up after 60 s: the turn ends with no marks, and says nothing meanwhile", async () => {
  const { host, script, wren, scene } = await openedGame();
  script.then("reply", kellSays());
  for (let i = 0; i < 20; i++) script.then("notes", down());

  host.as(wren).say({ text: "Who found him?" });
  await host.drain();
  const waiting = sceneNow(host, scene.id);
  assert.deepEqual([waiting.turns[1]!.phase, waiting.turns[1]!.note], ["noting", undefined]);

  for (let ms = 0; ms < 58_000; ms += 1000) {
    host.advance(1000);
    await host.drain();
  }
  assert.equal(sceneNow(host, scene.id).turns[1]!.phase, "noting", "still trying at 58 s");
  host.advance(2000);
  await host.drain();

  const now = sceneNow(host, scene.id);
  const reply = now.lines.find(l => l.turn === 1 && l.speaker === "gm")!;
  assert.deepEqual([now.turns[1]!.phase, now.turns[1]!.notes, now.turns[1]!.note, now.turns[1]!.error], ["done", "lost", undefined, undefined]);
  assert.deepEqual(JSON.parse(reply.markup!).marks, []);
  assert.equal(now.scene.turnId, undefined);
  assert.deepEqual(all(host.db.job), []);
  assert.match(host.logs.join("\n"), /\[reaper\] job \d+ .+:t1:notes gave up: no answer for 60 s \(last: HttpError/);
});

test("notes the AI service won't write (a 400), or an answer the commit can't use, are given up at once: the turn ends all the same", async () => {
  const { host, script, wren, scene } = await openedGame();
  script.then("reply", kellSays(), kellSays());
  script.then("notes", http(400), { usage: usage(1) });

  host.as(wren).say({ text: "Who found him?" });
  await host.drain();
  host.as(wren).say({ text: "And when?" });
  await host.drain();

  const now = sceneNow(host, scene.id);
  assert.deepEqual(now.turns.map(t => [t.n, t.phase, t.notes]), [[0, "done", "none"], [1, "done", "lost"], [2, "done", "lost"]]);
  assert.equal(all(host.db.job).length, 0, "nothing failed: no job is left for retry_turn");
  assert.match(host.logs.join("\n"), /:t1:notes attempt 1\] gave up: 400 bad_request: scripted/);
  assert.match(host.logs.join("\n"), /:t2:notes attempt 1\] gave up: the commit failed: Error: the answer has no marks/);
});

test("a turn that fails while its notes are written stays failed; retry_turn carries on, and its end finds the notes in", async () => {
  const { host, script, wren, scene } = await openedGame();
  script.then("reply", kellSays());
  script.then("settle", http(400));

  host.as(wren).say({ text: "Who found him?" });
  await host.drain();
  const failed = sceneNow(host, scene.id).turns[1]!;
  assert.deepEqual([failed.phase, failed.notes], ["failed", "written"]);

  assert.equal(host.as(wren).retryTurn({ turn: failed.id }), undefined);
  await host.drain();
  assert.deepEqual(sceneNow(host, scene.id).turns.map(t => [t.phase, t.notes]), [["done", "none"], ["done", "written"]]);
});

test("the opening's notes: turn 0 waits for them while the scene is live, and a line said meanwhile waits too", async () => {
  const { host, script } = hostWithCampaign();
  const wren = identity(1);
  const notes = held<NotesResponse>();
  const opening: OpenResponse = { present: ["kell", "cob", "moll"], entries: kellSays().entries, opened: [], usage: usage(3, 0.002) };
  script.then("open", opening);
  script.then("notes", () => notes.promise);
  host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "", build: "rogue" });

  const first = host.drain();
  await tick();
  await host.drain();
  const scene = all(host.db.scene)[0]!;
  const noting = sceneNow(host, scene.id);
  assert.deepEqual([noting.scene.status, noting.turns[0]!.phase, noting.scene.turnId], ["live", "noting", noting.turns[0]!.id]);
  assert.equal(keyParts((script.to("notes")[0]!.body as NotesRequest).key)?.turn, 0);
  assert.equal(host.as(wren).say({ text: "Sergeant?" }), undefined);

  notes.settle(noted());
  await first;
  const now = sceneNow(host, scene.id);
  assert.deepEqual(now.turns.map(t => [t.n, t.phase]), [[0, "done"], [1, "done"]]);
  assert.deepEqual(JSON.parse(now.lines[0]!.markup!).marks, [why]);
});

test("the notes and the lines are asked for on the world as the reply left it: before whoever a cue brought on joins it", async () => {
  const { host, script, wren } = await openedGame();
  const cue: DecideResponse = { decision: { route: { id: "cart-comes", phase: "cue" }, earned: false, daft: false, outOfCharacter: false }, opened: [], usage: usage(1) };
  script.then("decide", cue);
  script.then("reply", kellSays());

  host.as(wren).say({ text: "*I wait by the gate.*" });
  await host.drain();

  const keys = (world: NotesRequest["turn"]["world"]) => world.entity.map(e => e.key);
  const notes = script.to("notes")[0]!.body as NotesRequest;
  const lines = script.to("suggest")[1]!.body as SuggestRequest;
  const settle = script.to("settle")[0]!.body as SettleRequest;
  assert.ok(notes.turn.present.some(p => p.key === "tull"), "the corporal is on his way in");
  assert.ok(!keys(notes.turn.world).includes("tull") && !keys(lines.turn.world).includes("tull"), "and not yet in the world");
  assert.ok(keys(settle.turn.world).includes("tull"), "the settle sees him joined");
});
