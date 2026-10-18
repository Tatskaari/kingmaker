import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { FakeOptions } from "../ai/llm/fake-openrouter.ts";
import * as verbs from "../client/headless.ts";
import type { SceneRows } from "../client/scene/rows.ts";
import type { Mark, Markup } from "../shared/markup.ts";
import { idempotencyKey, type Step } from "../shared/protocol/keys.ts";
import { refusalIn } from "../shared/protocol/refusals.ts";
import { reportLines } from "./dev/doctor.ts";
import { devFake, onTop } from "./dev/fake.ts";
import type { Mode } from "./dev/mode.ts";
import { CallError, startStack, type Stack } from "./dev/stack.ts";
import { aConceptToTheOpening, checksBesideAStream, continueAndDelete, creationFake, restartedMidBuilds, theCeiling, type Game } from "./e2e/creation.ts";
import { aConsideredAct, aMemory, theCoGmSteers, walkingOut } from "./e2e/gm.ts";
import { theWholeStory } from "./e2e/story.ts";
import { aBlowLeftHanging, beforeTheGmSpeaks, fireBurnsOn, keptReactions, rowForRow } from "./e2e/world.ts";
import {
  aiLog as aiLogIn, callLog as callLogOf, check, doneTurn, elapsed, escaped, Failed, fixDice, millis, modelCalls as modelCallsOf, moduleLog, nextTurn, ok, pause,
  player, restartAi, seconds, step, turnOf, until, type Player,
} from "./e2e/kit.ts";
import { backToTheMap, inTheLane, mapTimes } from "./e2e/map.ts";
import { theTown } from "./e2e/town.ts";
import { configureTerminal } from "./terminal.ts";

/**
 * The end to end test (v0-design §10.4, v5-design §4.4, v1-design §4.3, full-gm-design §4.4,
 * world-bridge-design §3.4, story-design §5): a line in a scene, a character made from a concept, the
 * full GM, spells and blows in the scene's world, and the whole story, through every part. A real
 * SpacetimeDB with the module, the AI
 * service as a node process on the fake model, and clients on the client's own connection,
 * recording every row event they see. V0's steps: the AI service killed mid-reply and restarted
 * mid-reply (as the dev host's k and r), the AI service gone after it kept an answer, SpacetimeDB
 * restarted mid-think, an ending. V5's: the reply as drawn throughout (who says each line as it
 * streams, the notes the turn waits for, the lines suggested after it); then a line said while the
 * GM makes a note, a suggested line said by its number, lines whose moment has passed, the notes
 * kept by the AI service as it died, and the lines turned off and on. V1's (e2e/creation.ts): a
 * concept to the opening, the AI service gone after it kept the lore check, SpacetimeDB restarted
 * while the builds are made, a character made and checks rolled beside another game's stream, the
 * daily ceiling, continue and delete. The map's (e2e/map.ts, map-design §4): each game starts on
 * the campaign's map, in the granary lane, and is walked or talked into its scene (step 2 talks to
 * Kell; step 17 walks in with a spectator seeing the same walk; C's game walks in), then back to the
 * map after the ending, the yard locked once you're out and the Rat shut in the morning (14a), and
 * the map moves' times (35). The full GM's (e2e/gm.ts): a memory kept and brought back, the co-GM
 * steering, a risky act ruled (and the plain check when the ruling is too slow), and walking out of
 * the place. The world bridge's (e2e/world.ts): a spell resolved before the GM speaks and the people
 * who saw it reacting, a blow left hanging landing first next turn, fire burning on, the AI service
 * gone after it kept the reactions, and the spectator's world row for row the lead's. The whole
 * story's (e2e/story.ts): one game from the yard to The End, each scene's end crossing the boundary,
 * the lead walked to on the map, a scene ended by the owner, the fight's stand-in, a summons, a
 * spectator following. The town's (e2e/town.ts, town-design §4), after the times: the action menu's
 * Fire Bolt refused with no clear line and writing nothing, then catching the watch house door from
 * the street, the guards shouting, a spectator's map drawing it and the town's clock burning it on;
 * an act at Kell opening the yard as its first turn; an invented look; and a talk with Kell between
 * scenes that leaves the waiting Rat as it was. Host mode in CI; namespace mode where 11.0.0.1 isn't
 * this machine's.
 *
 * The dice are never SpacetimeDB's randomness: step 1 fixes them as the owner (set_dice_seed), and a
 * step that checks what its own dice gave (the town's Fire Bolt, the risky act's check) fixes them
 * again just before it makes its game, so each run rolls the same, and asserts what they give.
 *
 *   npm run e2e [-- --port 3310] [--ai-port 8797] [--root runs/e2e] [--mode host|namespace]
 *
 * Exits 0 when every step passed. At the first that doesn't, it says what it saw, stops the stack and
 * exits 1, leaving the logs in the root (logs/, and ai/games/<uid>/calls.jsonl for the model calls).
 */

const USAGE = `npm run e2e [-- options]
  --port <n>            SpacetimeDB's port (3310)
  --ai-port <n>         the AI service's port (8797)
  --root <dir>          the stack's folder (runs/e2e): emptied at the start, but for its keys
  --mode host|namespace detected when absent: host when 11.0.0.1 is on this machine`;

/**
 * The fake model's options: the dev host's (hosts/dev/fake.json), so the replies are the GM's golden
 * ones, marked up with who says each line, with notes written on their words and twelve lines to
 * suggest. Every call streams over 2 s, so a draft grows in several posts; the notes come 1.5 s
 * later, and the lines 0.8 s.
 */
const FAKE: FakeOptions = devFake();
/** The opening's notes held back, so that B, joining once the scene is live, sees them land. */
const OPENING: FakeOptions = { ...FAKE, byNameDelayMs: { notes: 6_000 } };
/**
 * The golden first reply for every turn: Kell's, Cob's and Moll's lines, two with a why, so a turn's
 * notes land whichever turn it is (the other replies' notes need the right turn: a you needs the
 * player's words, and the know on the Purveyor's office its lore's place in the brief).
 */
const NOTED: FakeOptions = { ...FAKE, replies: [FAKE.replies![1]!] };
const NEW_GAME = { campaign: "caerwyn", name: "Wren Ashdown", concept: "a quick-witted investigator lent to the case by the King", build: "ranger" };
/** The run's dice, fixed in step 1 (any seed would do): every game's rolls are the same each run, never SpacetimeDB's randomness. */
const DICE = 1018;
const NOTE = "The GM has lost the thread for a moment: trying again.";
/** The phases of a turn whose reply is in: the box is open again. */
const REPLIED = ["settling", "noting", "done"];

const flags = flagsOf(process.argv.slice(2));
configureTerminal(process.env);

console.log(`The e2e: a line in a scene, its reply as drawn, a character made, the full GM, spells and blows in the world, and the whole story, end to end (ports ${flags.port} and ${flags.aiPort}, ${flags.root})`);
const stack = await startStack({
  root: flags.root, stdbPort: flags.port, aiPort: flags.aiPort, ...(flags.mode ? { mode: flags.mode } : {}),
  // The ceiling pinned at its default, whatever this shell says: step 20 spends past it.
  model: "fake", fake: FAKE, fresh: true, aiEnv: { KM_AI_DAILY_USD: "5" }, log: line => console.log(`  … ${line}`),
}).catch((error: unknown) => {
  console.error(`\n✗ the stack didn't start: ${error instanceof Error ? error.message : String(error)}\nFAIL`);
  process.exit(1);
});

let passed = false;
try {
  await installedAndWell(stack);

  const a = await player(stack, "A"), b = await player(stack, "B");
  const game = await theOpening(stack, a);
  await theOpeningsNotes(stack, a, b, game);
  await aTurnBothSee(a, b, game);
  await killedMidReply(stack, a, game);
  await restartedMidReply(stack, a, game);
  await keptAnswer(stack, a, game);
  await spacetimeRestarted(stack, a, game);
  await aLineWhileNoting(stack, a, game);
  await aSuggestedLine(a, b);
  await linesOvertaken(stack, a, game);
  await keptNotes(stack, a, game);
  await linesOffAndOn(stack, a, game);
  await anEnding(stack, a, b, game);
  await backToTheMap(stack, a, b, game.id);

  const fake = creationFake(FAKE);
  const made = await aConceptToTheOpening(stack, flags.root, a, b, fake);
  await restartedMidBuilds(stack, flags.root, a, fake);
  await checksBesideAStream(stack, a, fake);
  await theCeiling(stack, flags.root, a, fake);
  await continueAndDelete(stack, a, b, game.id, made);

  const remembered = await aMemory(stack, flags.root, a, FAKE);
  await theCoGmSteers(stack, flags.root, a, remembered);
  const ruled = await aConsideredAct(stack, flags.root, a, b, FAKE);
  await walkingOut(stack, a, b, ruled, FAKE);

  const world = await beforeTheGmSpeaks(stack, flags.root, a, b, FAKE);
  await aBlowLeftHanging(stack, a, world, FAKE);
  await fireBurnsOn(stack, a, world, FAKE);
  await keptReactions(stack, flags.root, a, world, FAKE);
  await rowForRow(stack, a, b, world);

  const lead = await player(stack, "C", true);
  await theWholeStory(stack, flags.root, lead, b, FAKE);
  await latencies(stack, a);
  await theTown(stack, lead, b, FAKE);

  a.conn.close();
  b.conn.close();
  lead.conn.close();
  passed = true;
} catch (error) {
  console.error(`\n✗ ${error instanceof Failed ? error.message : error instanceof Error ? error.stack : String(error)}`);
  console.error(`  The logs are in ${flags.root}: logs/spacetime.log, logs/ai.log, logs/dev.log, ai/games/<uid>/calls.jsonl.`);
} finally {
  await stack.down();
}

console.log(passed ? `\nPASS: every step, in ${elapsed()}` : "\nFAIL");
process.exit(passed ? 0 : 1);

// ---------------------------------------------------------------------------------------------
// The steps (v0-design §10.4, v5-design §4.4); V1's, 15 to 21, are e2e/creation.ts's, the full GM's, 22 to 25, e2e/gm.ts's, the world bridge's, 26 to 30, e2e/world.ts's, the whole story's, 31 to 34, e2e/story.ts's, and the town's, 36 to 39, e2e/town.ts's.

/** 1. The stack is up (--fresh); the campaign goes into both; the dice are fixed for the run, as only the owner may; the doctor finds all well. */
async function installedAndWell(stack: Stack): Promise<void> {
  step(`1. Up in ${stack.mode} mode, the campaign installed, the dice fixed, the doctor`);
  const installed = await stack.install(join(import.meta.dirname, "..", "campaigns", "caerwyn"));
  ok(`${installed.id} installed in both`);
  await fixDice(stack, DICE);
  ok(`the dice fixed as the owner (set_dice_seed ${DICE}): each game's seed from it, so every run rolls the same`);
  const refused = await stack.call("set_dice_seed", { seed: { none: [] } }, "ai").then(() => undefined, (e: unknown) => (e instanceof CallError ? refusalIn(e.body) : undefined));
  check(`and only the owner may: the AI service's set_dice_seed is refused (${refused?.code}: "${refused?.text}")`, refused?.code === "not_admin");
  const report = await stack.doctor({ campaign: installed.id });
  if (!report.ok) console.log(reportLines(report).join("\n"));
  check(`the doctor finds all well: ${report.summary}`, report.ok);
}

/**
 * 2. A's new game begins on the map, in the granary lane (a line there is refused); a word with Kell
 * opens the hanged clerk (map-design §4): the opening streams into its draft, naming who says each
 * line as it grows, before its entry lands; the scene goes live.
 */
async function theOpening(stack: Stack, a: Player): Promise<Game> {
  step("2. A new game in the granary lane; talking to Kell opens the hanged clerk, its opening streamed with who says each line");
  await restartAi(stack, OPENING);
  check("A's new_game is made", (await a.conn.newGame(NEW_GAME)) === undefined);
  await inTheLane(a);
  check("a line said on the map is refused: not_in_scene", (await a.conn.say("Sergeant?"))?.code === "not_in_scene");
  check("A talks to Kell (interact talk kell)", (await a.conn.interact({ verb: "talk", target: "kell" })) === undefined);
  const rows = await until(a, "the scene to go live", 60_000, r => r.scene.status === "live" && r);
  const walked = a.conn.explore();
  check(`A went over to Kell in the yard, and the hanged clerk opened: "${walked?.said}"`, walked?.ex.scene === "hanged-clerk" && /Kell/.test(walked.said) && rows.scene.title === "The Hanged Clerk");
  const entry = a.events.findIndex(e => e.table === "transcript" && e.op === "insert" && e.row.turn === 0);
  const drafts = a.events.slice(0, entry).filter(e => e.table === "reply_draft" && e.op !== "delete");
  check(`A saw the opening's draft grow (${drafts.length} posts) before its entry landed`, entry >= 0 && drafts.length >= 2);
  const streamed = speakersIn(...drafts.map(e => e.row.markup));
  check(`its posts named who says each line as it grew: ${streamed.join(", ")}`, ["cob", "kell"].every(k => streamed.includes(k)));
  const kept = speakersIn(rows.transcript.find(t => t.turn === 0)?.markup);
  check(`the opening's entry keeps them: ${kept.join(", ")}`, kept.join() === streamed.join());
  ok(`game ${rows.game.id}, its scene live`);
  return gameOf(stack, rows);
}

/**
 * 3. B joins while the opening's notes are being written (OPENING holds them back): both see them
 * land on the opening's row, each with its note and, when it's linked, its card; turn 0 goes noting,
 * then done.
 */
async function theOpeningsNotes(stack: Stack, a: Player, b: Player, game: Game): Promise<void> {
  step("3. A spectator joins; the opening's notes land for both");
  check("turn 0 is noting: the scene is live, its notes still being written", turnOf(a.conn.rows()!, 0)?.phase === "noting");
  check("B's join_game is made", (await b.conn.joinGame(game.id)) === undefined);
  await until(b, "B to see the scene", 10_000, r => r.scene.status === "live" && r.transcript.length > 0);

  const [seenA, seenB] = await Promise.all([a, b].map(p => until(p, `${p.name} to see the opening's notes`, 30_000, r => marksOn(r, 0).length && marksOn(r, 0))));
  const updated = [a, b].every(p => p.events.some(e => e.table === "transcript" && e.op === "update" && e.row.turn === 0 && marksIn(e.row.markup).length));
  check(`A and B both saw the opening's row updated with its ${seenA!.length} notes: ${seenA!.map(describeMark).join("; ")}`, updated && JSON.stringify(seenA) === JSON.stringify(seenB));
  check("each has its note, and each linked one its card", seenA!.every(m => m.note && (!m.link || m.card?.title)));
  await doneTurn(a, 0);
  check("turn 0 went noting, then done", phasesSeen(a, 0).slice(-2).join() === "noting,done");
  await restartAi(stack, FAKE);
}

/** 4. A's line, A's second at once refused, B's refused; both clients see the turn's rows alike: who says each line as the draft grows, the notes, the lines suggested after it (A's alone). */
async function aTurnBothSee(a: Player, b: Player, game: Game): Promise<void> {
  step("4. A turn both clients see alike");
  const from = { a: a.events.length, b: b.events.length };

  const n = nextTurn(a);
  check("A says a line", (await a.conn.say("Sergeant, who found him?")) === undefined);
  check("A's second line at once is refused: turn_in_flight", (await a.conn.say("And when?"))?.code === "turn_in_flight");
  check("B's line is refused: not_controller", (await b.conn.say("Who are you, then?"))?.code === "not_controller");
  await doneTurn(a, n);
  for (const p of [a, b]) await until(p, `${p.name} to see turn ${n} done, its lines come`, 30_000, r => turnOf(r, n)?.phase === "done" && turnOf(r, n)!.suggest !== "coming");
  await pause(500);

  const seenA = turnEvents(a.events.slice(from.a), n), seenB = turnEvents(b.events.slice(from.b), n);
  check(`A and B saw the same ${seenA.length} row events for the turn (its phases, the draft's posts with who says what, the entries with their notes)`, seenA.length > 5 && JSON.stringify(seenA) === JSON.stringify(seenB));
  const streamed = speakersIn(...a.events.slice(from.a).filter(e => e.table === "reply_draft" && e.op !== "delete").map(e => e.row.markup));
  check(`the reply's draft named Kell, Cob and Moll as it grew: ${streamed.join(", ")}`, ["cob", "kell", "moll"].every(k => streamed.includes(k)));
  const rows = a.conn.rows()!;
  check(`its notes landed on its row: ${marksOn(rows, n).map(describeMark).join("; ")}`, marksOn(rows, n).length > 0);

  const lines = linesOf(rows);
  check(`A has the lines suggested after it: ${lines.map(l => `${l.ord} ${l.kind}`).join(", ")}`, lines.length >= 3 && lines.every(l => l.turn === n));
  check("A's view shows them, in order", JSON.stringify(a.conn.view()!.suggestions.map(s => s.text)) === JSON.stringify(lines.map(l => l.text)));
  check("B's view shows none: they're the lead's", b.conn.view()!.suggestions.length === 0 && !b.conn.view()!.suggestionsComing);
  void game;
}

/** 5. The AI service killed mid-reply, then started again: the reply streams again as a later attempt, at the cost of a second model call. */
async function killedMidReply(stack: Stack, a: Player, game: Game): Promise<void> {
  step("5. The AI service killed mid-reply");
  const slow = { ...FAKE, streamMs: 3_000 };
  await restartAi(stack, slow);
  const n = nextTurn(a);
  check("A says a line", (await a.conn.say("*I look up at the loft door.* Who barred that?")) === undefined);
  const turn = await until(a, "the reply's first draft", 30_000, r => { const t = turnOf(r, n); return t && r.drafts.some(d => d.turnId === t.id) && t.id; });

  await stack.ai.stop("SIGKILL");
  ok("the AI service is killed (SIGKILL) at the reply's first draft");
  const note = await until(a, "the turn's note", 30_000, r => turnOf(r, n)?.note);
  check(`the turn's note says "${note}"`, note === NOTE);
  await stack.ai.start({ KM_AI_FAKE: JSON.stringify(slow) });
  ok("the AI service is started again");

  const rows = await doneTurn(a, n);
  const attempts = [...new Set(a.events.filter(e => e.table === "reply_draft" && e.op !== "delete" && e.row.turnId === turn).map(e => e.row.attempt as number))];
  check(`the draft started again as a later attempt (attempts ${attempts.join(", ")})`, Math.max(...attempts) >= 2);
  check("the turn has one GM entry", rows.transcript.filter(t => t.turn === n && t.speaker === "gm").length === 1);
  const replies = modelCalls(game, "gm.reply", keyOf(game, n, "reply"));
  check(`gm.reply was asked ${replies} times for the reply's key: the killed one, and the one that finished`, replies === 2);
}

/**
 * 6. The AI service restarted mid-reply (SIGTERM, as the dev host's r): it finishes the reply and
 * sends it before it exits, so the reply lands from its first attempt, with no note and one model call.
 */
async function restartedMidReply(stack: Stack, a: Player, game: Game): Promise<void> {
  step("6. The AI service restarted mid-reply");
  const slow = { ...FAKE, streamMs: 3_000 };
  await restartAi(stack, slow);
  const n = nextTurn(a);
  const from = a.events.length;
  check("A says a line", (await a.conn.say("Cob, let me see that boot.")) === undefined);
  const turn = await until(a, "the reply's first draft", 30_000, r => { const t = turnOf(r, n); return t && r.drafts.some(d => d.turnId === t.id) && t.id; });

  await stack.ai.stop("SIGTERM");
  ok("the AI service is sent SIGTERM at the reply's first draft, and has exited");
  await stack.ai.start({ KM_AI_FAKE: JSON.stringify(FAKE) });
  ok("the AI service is started again");

  await doneTurn(a, n);
  const seen = a.events.slice(from).filter(e => e.table === "turn" && e.row.id === turn);
  const attempts = [...new Set(a.events.slice(from).filter(e => e.table === "reply_draft" && e.op !== "delete" && e.row.turnId === turn).map(e => e.row.attempt as number))];
  check(`the reply came from its first attempt (draft attempts ${attempts.join(", ")})`, attempts.length === 1 && attempts[0] === 1);
  check("the turn had no note while the reply was written", !seen.some(e => e.row.phase === "replying" && e.row.note));
  const key = keyOf(game, n, "reply");
  check("the AI service sent the reply it finished: attempt 1 answered 200, and no other", new RegExp(`reply ${escaped(key)} attempt 1: 200 in`).test(aiLog()) && !new RegExp(`reply ${escaped(key)} attempt [2-9]`).test(aiLog()));
  check("gm.reply was asked once for the reply's key", modelCalls(game, "gm.reply", key) === 1);
}

/** 7. The AI service exits right after it stores the settle's answer: started again, it answers from the store. */
async function keptAnswer(stack: Stack, a: Player, game: Game): Promise<void> {
  step("7. The AI service gone after it kept an answer");
  await restartAi(stack, FAKE, { KM_AI_FAULTS: "exit-after-store:settle" });
  const n = nextTurn(a);
  check("A says a line", (await a.conn.say("Moll, come down off that wall and tell it again.")) === undefined);
  const code = await stack.ai.exited();
  check(`the AI service exited (${code}) right after it stored the settle's answer`, code === 137);
  await stack.ai.start();
  ok("the AI service is started again, without the fault");

  await doneTurn(a, n);
  const key = keyOf(game, n, "settle");
  check("the AI service answered the settle from its store", new RegExp(`settle ${escaped(key)} attempt \\d+: 200 from the store`).test(aiLog()));
  const staged = modelCalls(game, "world.stage", key);
  check(`world.stage was asked ${staged} time for the settle's key`, staged === 1);
}

/** 8. SpacetimeDB stopped and started a second into a slow decide: the reaper re-dispatches it, and the AI service's kept answer carries the turn on. */
async function spacetimeRestarted(stack: Stack, a: Player, game: Game): Promise<void> {
  step("8. SpacetimeDB restarted mid-think");
  await restartAi(stack, { ...FAKE, decisionDelayMs: 3_000 });
  const n = nextTurn(a);
  const said = performance.now();
  check("A says a line", (await a.conn.say("Cob, what did you hear last night?")) === undefined);
  await until(a, `turn ${n} deciding`, 10_000, r => turnOf(r, n)?.phase === "deciding");
  await pause(1_000);

  await stack.stdb.stop();
  await stack.stdb.start();
  ok("SpacetimeDB stopped and started again on its data, a second into the decide");
  await doneTurn(a, n, 60_000 - (performance.now() - said));
  ok(`${seconds(performance.now() - said)} from the line to the turn's end, A's connection back by itself`);

  const asked = modelCalls(game, "director.before", keyOf(game, n, "decide"));
  check(`director.before was asked ${asked} time for the decide's key`, asked === 1);
  check("the module logged the decide re-dispatched after its deadline", /re-dispatched after its deadline/.test(await moduleLog(stack)));
}

/**
 * 9. The notes held back 3 s: A says a line the moment its turn is noting. It's queued, and decided
 * only once the last turn's notes are written; its reply's history (the call log) has them as the
 * GM writes its marks back.
 */
async function aLineWhileNoting(stack: Stack, a: Player, game: Game): Promise<void> {
  step("9. A line said while the GM makes a note waits for the notes");
  await restartAi(stack, { ...NOTED, byNameDelayMs: { notes: 3_000 } });
  const n = nextTurn(a);
  check("A says a line", (await a.conn.say("Moll, did you really see him jump from up on that wall?")) === undefined);
  await until(a, `turn ${n} noting`, 30_000, r => turnOf(r, n)?.phase === "noting");
  check(`A says another the moment turn ${n} is noting: it's taken`, (await a.conn.say("And where were you, Cob?")) === undefined);
  await until(a, `turn ${n + 1} queued`, 5_000, r => turnOf(r, n + 1)?.phase === "queued");
  ok(`turn ${n + 1} is queued behind turn ${n}'s notes`);

  const rows = await doneTurn(a, n + 1);
  const written = lastCallAt(game, "notes", keyOf(game, n, "notes")), decided = firstCallAt(game, "director.before", keyOf(game, n + 1, "decide"));
  check(`turn ${n + 1} was decided only once turn ${n}'s notes were written (${decided - written} ms after)`, written > 0 && decided > written);
  const marks = marksOn(rows, n), history = modelInput(game, "gm.reply", keyOf(game, n + 1, "reply"));
  const back = marks.map(m => `)[${m.kind}: ${m.note}]`);
  check(`turn ${n + 1}'s gm.reply history has turn ${n}'s notes as the GM writes them back: ${back.join(" ")}`, marks.length > 0 && back.every(b => history.includes(b)));
}

/** 10. The lines after the last reply, the lead's alone: act --id say_2 says the second, word for word. */
async function aSuggestedLine(a: Player, b: Player): Promise<void> {
  step("10. A suggested line said by its number");
  const n = nextTurn(a) - 1;
  const rows = await until(a, `turn ${n}'s lines`, 30_000, r => turnOf(r, n)?.suggest === "landed" && r);
  const lines = linesOf(rows);
  check(`A has turn ${n}'s lines: ${lines.map(l => `say_${l.ord} ${l.kind}`).join(", ")}`, lines.length >= 2 && lines.every(l => l.turn === n));
  check("B's view shows none", b.conn.view()!.suggestions.length === 0);

  const printed: string[] = [];
  const code = await verbs.act(a.conn, "say_2", { print: text => printed.push(text), progress: () => {} });
  const said = a.conn.rows()!.transcript.find(t => t.turn === n + 1 && t.kind === "player");
  check(`act --id say_2 said the second line, word for word: "${lines[1]!.text}"`, code === 0 && said?.text === lines[1]!.text);
  check("and printed it, the reply, and the lines after that", printed[0] === `> ${lines[1]!.text}\n` && printed.some(p => p.trimStart().startsWith("ACTIONS:\n- say_1: ")));
}

/**
 * 11. The lines held back 5 s: A says a line straight after a reply, so the reply's lines come once
 * their moment has passed. They're dropped, the rows left as they were, at one call.
 */
async function linesOvertaken(stack: Stack, a: Player, game: Game): Promise<void> {
  step("11. Lines whose moment has passed");
  await restartAi(stack, { ...FAKE, suggestDelayMs: 5_000 });
  const n = nextTurn(a);
  const before = [...new Set(linesOf(a.conn.rows()!).map(l => l.turn))];
  check("A says a line", (await a.conn.say("Kell, what was in the satchel?")) === undefined);
  await until(a, `turn ${n}'s reply`, 30_000, r => REPLIED.includes(turnOf(r, n)?.phase ?? ""));
  check("A says another straight after it", (await a.conn.say("Never mind. Cob, show me where you were standing.")) === undefined);

  const rows = await until(a, `turn ${n}'s lines to come`, 30_000, r => ["dropped", "landed", "lost"].includes(turnOf(r, n)?.suggest ?? "") && r);
  check(`they were dropped (${turnOf(rows, n)!.suggest}), turn ${before.join()}'s lines still the rows`, turnOf(rows, n)!.suggest === "dropped" && JSON.stringify([...new Set(linesOf(rows).map(l => l.turn))]) === JSON.stringify(before));
  check("scene.suggest was asked once for their key", modelCalls(game, "scene.suggest", keyOf(game, n, "suggest")) === 1);
  const next = await until(a, `turn ${n + 1}'s lines`, 60_000, r => turnOf(r, n + 1)?.suggest === "landed" && r);
  check(`turn ${n + 1}'s lines took their place`, linesOf(next).every(l => l.turn === n + 1));
}

/** 12. The AI service exits right after it stores a turn's notes: started again, it answers them from the store, and they land. */
async function keptNotes(stack: Stack, a: Player, game: Game): Promise<void> {
  step("12. The AI service gone after it kept the notes");
  await restartAi(stack, NOTED, { KM_AI_FAULTS: "exit-after-store:notes" });
  const n = nextTurn(a);
  check("A says a line", (await a.conn.say("Sergeant, who found him?")) === undefined);
  const code = await stack.ai.exited();
  const key = keyOf(game, n, "notes");
  check(`the AI service exited (${code}) right after it stored the notes`, code === 137 && aiLog().includes(`exit-after-store: ${key} is stored`));
  await stack.ai.start({ KM_AI_FAKE: JSON.stringify(NOTED) });
  ok("the AI service is started again, without the fault");

  const rows = await doneTurn(a, n);
  check(`the notes landed on the reply's row: ${marksOn(rows, n).map(describeMark).join("; ")}`, marksOn(rows, n).length > 0);
  check("the AI service answered them from its store", new RegExp(`notes ${escaped(key)} attempt \\d+: 200 from the store`).test(aiLog()));
  check("notes was asked once for the key", modelCalls(game, "notes", key) === 1);
}

/**
 * 13. The setting: off, the next reply asks for no lines; on, this moment's are asked for at once.
 * Then turned off while a turn's lines are on their way (they're dropped when they come) and on
 * again: asked at once, as the turn's second ask.
 */
async function linesOffAndOn(stack: Stack, a: Player, game: Game): Promise<void> {
  step("13. The suggested lines turned off, and on");
  check("A turns them off", (await a.conn.setSuggestions(false)) === undefined);
  await until(a, "A's view to show them off", 5_000, r => r.players.some(p => p.id === r.me && !p.suggestions));
  check("A's view shows no lines", a.conn.view()!.suggestions.length === 0 && !a.conn.view()!.suggestionsOn);
  const n = nextTurn(a);
  check("A says a line", (await a.conn.say("Kell, has anyone been up in the loft?")) === undefined);
  const off = await doneTurn(a, n);
  check(`its reply asked for no lines: turn ${n}'s lines ${turnOf(off, n)!.suggest}, no scene.suggest call`, turnOf(off, n)!.suggest === "none" && modelCalls(game, "scene.suggest", keyOf(game, n, "suggest")) === 0);
  check("A turns them on", (await a.conn.setSuggestions(true)) === undefined);
  const on = await until(a, `turn ${n}'s lines, asked for at once`, 30_000, r => turnOf(r, n)?.suggest === "landed" && r);
  check(`asked once, the turn's first ask (…:t${n}:suggest), and landed: ${linesOf(on).length} lines`, modelCalls(game, "scene.suggest", keyOf(game, n, "suggest")) === 1 && linesOf(on).every(l => l.turn === n));

  await restartAi(stack, { ...FAKE, suggestDelayMs: 4_000 });
  const m = nextTurn(a);
  check("A says a line", (await a.conn.say("What's in the loft, then?")) === undefined);
  await until(a, `turn ${m}'s reply, its lines on their way`, 30_000, r => REPLIED.includes(turnOf(r, m)?.phase ?? "") && turnOf(r, m)!.suggest === "coming");
  check("A turns them off while they're coming", (await a.conn.setSuggestions(false)) === undefined);
  await until(a, `turn ${m}'s lines to come and be dropped`, 30_000, r => turnOf(r, m)?.suggest === "dropped");
  ok(`turn ${m}'s lines dropped when they came`);
  check("A turns them on", (await a.conn.setSuggestions(true)) === undefined);
  const again = await until(a, `turn ${m}'s lines, asked again`, 30_000, r => turnOf(r, m)?.suggest === "landed" && r);
  const second = idempotencyKey(game.uid, game.scene, m, "suggest", 2);
  check(`asked again at once, as the turn's second ask (…:t${m}:suggest-2), and landed`, modelCalls(game, "scene.suggest", second) === 1 && linesOf(again).every(l => l.turn === m));
  await restartAi(stack, FAKE);
}

/** 14. A line that makes the case: the ending is the player's own, the next line winds down, the scene ends (asking for no lines after its last reply), and a further line is refused. */
async function anEnding(stack: Stack, a: Player, b: Player, game: Game): Promise<void> {
  step("14. An ending");
  await restartAi(stack, onTop(FAKE, { choices: { outcome: "make-case", own_exit: "theirs" } }));
  check("A says the line that makes the case", (await a.conn.say("The cord mark, the barred door and Cob's page: Prout was murdered for what he found. That's the case made. We take it to the King.")) === undefined);
  await until(a, "the scene to close", 60_000, r => r.scene.status === "closing");
  ok("the scene is closing: the ending is the player's own, with one wind-down turn to go");

  const n = nextTurn(a);
  check("A says the wind-down line", (await a.conn.say("*to Kell, at the gate* Coming, Sergeant?")) === undefined);
  await until(a, "the scene to end", 60_000, r => r.scene.status === "ended" && r);
  const rows = await doneTurn(a, n);
  const last = [...rows.transcript].sort((x, y) => x.seq - y.seq).at(-1)!;
  check(`"${last.text}" closes the transcript`, last.kind === "system" && last.text === "Scene ends: The case is made");
  check("the GM closed it with gm.closing", modelCalls(game, "gm.closing", keyOf(game, n, "reply")) === 1);
  check("its last reply asked for no lines", turnOf(rows, n)!.suggest === "none" && modelCalls(game, "scene.suggest", keyOf(game, n, "suggest")) === 0);
  check("a further line is refused: scene_over", (await a.conn.say("Wait!"))?.code === "scene_over");
  await until(b, "B to see the scene end", 10_000, r => r.scene.status === "ended");
  ok("B saw it end too");
}

/** 35. Each turn's first words and its end, from the turn rows, game by game; its notes and lines after the reply, as A saw them come (A's games); the map moves' times. */
async function latencies(stack: Stack, a: Player): Promise<void> {
  step("35. Each turn's times: first words and its end (the turn rows), its notes and lines after the reply (as A saw them); the map moves' times");
  const turns = (await stack.sql("SELECT * FROM turn")).sort((x, y) => Number(x.game_id) - Number(y.game_id) || Number(x.n) - Number(y.n));
  for (const t of turns) {
    const from = Number(t.started_at);
    const first = t.first_text_at === null ? "no text" : `first words ${millis(Number(t.first_text_at) - from)}`;
    const done = t.ended_at === null ? "" : `, done ${millis(Number(t.ended_at) - from)}`;
    console.log(`  game ${t.game_id} turn ${t.n}: ${first}${done} (${t.phase}, ${t.calls} model calls)${afterTheReply(a, String(t.id), String(t.scene_id), Number(t.n))}; notes ${t.notes}, lines ${t.suggest}`);
  }
  await mapTimes(stack);
}

// ---------------------------------------------------------------------------------------------
// What the steps read.

/** A turn's row events as both clients should see them, in order: its phases and states, the draft's posts with who says what, its entries with their notes. */
function turnEvents(events: Player["events"], n: number): string[] {
  const turnId = events.find(e => e.table === "turn" && e.row.n === n)?.row.id;
  return events.flatMap(({ table, op, row }) => {
    if (table === "turn" && row.id === turnId) return [`turn ${op} ${row.phase} (notes ${row.notes}, lines ${row.suggest})`];
    if (table === "reply_draft" && row.turnId === turnId) return [`draft ${op} ${row.attempt}/${row.seq} ${speakersIn(row.markup).join("+")}`];
    if (table === "transcript" && row.turn === n) return [`entry ${op} ${row.seq} ${row.kind} ${speakersIn(row.markup).join("+")} ${marksIn(row.markup).length} notes`];
    return [];
  });
}

/** The phases a player saw turn n go through, in order. */
function phasesSeen(p: Player, n: number): string[] {
  const phases = p.events.filter(e => e.table === "turn" && e.row.n === n).map(e => String(e.row.phase));
  return phases.filter((phase, i) => phase !== phases[i - 1]);
}

/** When A saw a turn's notes and lines land (the turn by its id, in its scene), after its reply's entry: "; notes +3.5 s, lines +2.8 s". */
function afterTheReply(a: Player, turnId: string, sceneId: string, n: number): string {
  const reply = a.events.find(e => e.table === "transcript" && e.op === "insert" && String(e.row.sceneId) === sceneId && e.row.turn === n && e.row.speaker === "gm")?.at;
  if (reply === undefined) return "";
  const when = (state: string, column: "notes" | "suggest") => a.events.find(e => e.table === "turn" && String(e.row.id) === turnId && e.row[column] === state)?.at;
  const notes = when("written", "notes"), lines = when("landed", "suggest");
  return `${notes === undefined ? "" : `; notes +${seconds(notes - reply)}`}${lines === undefined ? "" : `; lines +${seconds(lines - reply)}`}`;
}

// ---------------------------------------------------------------------------------------------
// The reply as drawn, read off the rows.

/** Who says what in some markup (transcript.markup, reply_draft.markup: JSON), by game key, in order. */
function speakersIn(...markups: Array<string | undefined>): string[] {
  return [...new Set(markups.flatMap(m => markupOf(m)?.speech.flatMap(s => (s.speaker ? [s.speaker] : [])) ?? []))].sort();
}

function marksIn(markup: string | undefined): Mark[] {
  return markupOf(markup)?.marks ?? [];
}

/** The notes on turn n's reply. */
function marksOn(rows: SceneRows, n: number): Mark[] {
  return marksIn(rows.transcript.find(t => t.turn === n && t.speaker === "gm")?.markup);
}

function markupOf(markup: string | undefined): Markup | undefined {
  return markup ? JSON.parse(markup) as Markup : undefined;
}

/** A note as a line: its kind, what it's linked to, and its card's title. */
function describeMark(m: Mark): string {
  const link = m.link ? ` → ${m.link.kind === "person" ? m.link.id : m.link.kind === "lore" ? m.link.path : `${m.link.kind}`}` : "";
  return `${m.kind}${link}${m.card ? ` (card: ${m.card.title})` : ""}`;
}

/** The scene's suggested lines, in order. */
function linesOf(rows: SceneRows): SceneRows["suggestions"] {
  return [...rows.suggestions].sort((x, y) => x.ord - y.ord);
}

// ---------------------------------------------------------------------------------------------
// The game's keys, its call log and the AI service's log (e2e/kit.ts's, for this stack).

/** The game's uid and scene, which every idempotency key names. */
async function gameOf(stack: Stack, rows: SceneRows): Promise<Game> {
  const [game] = await stack.sql(`SELECT uid FROM game WHERE id = ${rows.game.id}`);
  return { id: rows.game.id, uid: String(game!.uid), scene: rows.scene.id };
}

function keyOf(game: Game, n: number, step: Step): string {
  return idempotencyKey(game.uid, game.scene, n, step);
}

/** A model call as the call log has it: a line as each call goes out (`started`), and one when it's done (with its request). */
interface Call { at: string; key?: string; operation?: string; started?: string; request?: { input?: Array<{ content: string }> } }

/** The game's call log. */
function callLog(game: Game): Call[] {
  return callLogOf(flags.root, game.uid) as Call[];
}

/** How many times the AI service asked the model for `operation` under a key: the call log's lines as each call went out. */
function modelCalls(game: Game, operation: string, key: string): number {
  return modelCallsOf(flags.root, game.uid, operation, key);
}

/** When the first call for `operation` under a key went out (ms since the epoch; 0 when none did). */
function firstCallAt(game: Game, operation: string, key: string): number {
  const call = callLog(game).find(c => c.started && c.operation === operation && c.key === key);
  return call ? Date.parse(call.at) : 0;
}

/** When the last call for `operation` under a key was done. */
function lastCallAt(game: Game, operation: string, key: string): number {
  const call = callLog(game).filter(c => !c.started && c.operation === operation && c.key === key).at(-1);
  return call ? Date.parse(call.at) : 0;
}

/** What the model was given for the last call for `operation` under a key: its input's messages, as one text. */
function modelInput(game: Game, operation: string, key: string): string {
  const call = callLog(game).filter(c => !c.started && c.operation === operation && c.key === key).at(-1);
  return call?.request?.input?.map(m => m.content).join("\n") ?? "";
}

function aiLog(): string {
  return aiLogIn(flags.root);
}

// ---------------------------------------------------------------------------------------------
// Flags.

function flagsOf(argv: string[]): { port: number; aiPort: number; root: string; mode?: Mode } {
  const { values } = parseArgs({ args: argv, options: { port: { type: "string" }, "ai-port": { type: "string" }, root: { type: "string" }, mode: { type: "string" }, help: { type: "boolean" } } });
  if (values.help) { console.log(USAGE); process.exit(0); }
  const mode = values.mode;
  if (mode !== undefined && mode !== "host" && mode !== "namespace") { console.error(`--mode ${mode}: host or namespace\n${USAGE}`); process.exit(2); }
  return {
    port: Number(values.port ?? 3310), aiPort: Number(values["ai-port"] ?? 8797), root: resolve(values.root ?? join("runs", "e2e")),
    ...(mode ? { mode } : {}),
  };
}
