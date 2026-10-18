import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { FakeOptions } from "../ai/llm/fake-openrouter.ts";
import * as verbs from "../client/headless.ts";
import type { SceneRows } from "../client/scene/rows.ts";
import type { Markup } from "../shared/markup.ts";
import { idempotencyKey, type Step } from "../shared/protocol/keys.ts";
import { reportLines } from "./dev/doctor.ts";
import { devFake, onTop } from "./dev/fake.ts";
import type { Mode } from "./dev/mode.ts";
import { startStack, type Stack } from "./dev/stack.ts";
import { aConceptToTheOpening, checksBesideAStream, continueAndDelete, creationFake, restartedMidBuilds, theCeiling, type Game } from "./e2e/creation.ts";
import { aMemory, aRiskyCheck, gmOf, theCoGmSteers } from "./e2e/gm.ts";
import { theWholeStory } from "./e2e/story.ts";
import { aSpellInWords, beforeTheGmSpeaks, fireBurnsOn, rowForRow } from "./e2e/world.ts";
import {
  aiLog as aiLogIn, callLog as callLogOf, check, doneTurn, elapsed, escaped, Failed, millis, modelCalls as modelCallsOf, moduleLog, nextTurn, ok, pause,
  player, restartAi, seconds, step, turnOf, until, type Player,
} from "./e2e/kit.ts";
import { backToTheMap, inTheLane, mapTimes } from "./e2e/map.ts";
import { theTown } from "./e2e/town.ts";
import { aFightInTheRing } from "./e2e/fight.ts";
import { aProblemReported } from "./e2e/report.ts";
import { configureTerminal } from "./terminal.ts";

/**
 * The end to end test (v0-design §10.4, v5-design §4.4, v1-design §4.3, full-gm-design §4.4,
 * world-bridge-design §3.4, story-design §5, two-part-design.md): a line in a scene, a character made
 * from a concept, the GM's co-GM and checks, the rules in the scene's world, and the whole story,
 * through every part, the scenes played by the two-part GM. A real SpacetimeDB with the module, the
 * AI service as a node process on the fake model, and clients on the client's own connection,
 * recording every row event they see. V0's steps: the AI service killed mid-reply and restarted
 * mid-reply (as the dev host's k and r), the AI service gone after it kept an answer, SpacetimeDB
 * restarted mid-think (the settle), an ending (the co-GM walking the scene to it). V5's: the reply as
 * drawn throughout (who says each line as it streams, the lines suggested after it); then a line
 * said while the world settles, a suggested line said by its number, lines whose moment has passed,
 * the lines kept by the AI service as it died, and the lines turned off and on. V1's
 * (e2e/creation.ts): a concept to the opening, the AI service gone after it kept the lore check,
 * SpacetimeDB restarted while the builds are made, a character made and checks rolled beside another
 * game's stream, the daily ceiling, continue and delete. The map's (e2e/map.ts, map-design §4): each
 * game starts on the campaign's map, in the granary lane, and is walked or talked into its scene
 * (step 2 talks to Kell; step 17 walks in with a spectator seeing the same walk; C's game walks in),
 * then back to the map after the ending, the yard locked once you're out and the Rat shut in the
 * morning (14a), and the map moves' times (35). The GM's (e2e/gm.ts): a memory kept, the co-GM
 * steering (roles and moves), and a risky act the mouthpiece calls a check on. The world's
 * (e2e/world.ts): a spell from the lane resolved before the GM speaks, the people who saw it
 * reacting; a spell said in words in the scene, read by the act step and resolved the same way; fire
 * burning on; and the spectator's world row for row the lead's. The whole story's (e2e/story.ts): one game from the yard
 * to The End, the co-GM walking each scene to its ending, each scene's end crossing the boundary, the
 * lead walked to on the map, a scene ended by the owner, the fight's stand-in, a summons, a spectator
 * following. The town's (e2e/town.ts, town-design §4), after the times: the action menu's Fire Bolt
 * refused with no clear line and writing nothing, then catching the watch house door from the street,
 * the guards shouting, a spectator's map drawing it and the town's clock burning it on; an act at
 * Kell opening the yard as its first turn; an invented look; and a talk with Kell between scenes,
 * bringing up what she remembers, that leaves the waiting Rat as it was. A fight (e2e/fight.ts, M6:
 * docs/combat-design.md): one of the zoo's rings, the other side's turns played one at a time by
 * fight_step on SpacetimeDB's schedule with their moments, a spectator seeing the same, the player's
 * act and auto to the end, and out back to the map. A problem reported (e2e/report.ts, M5): a game
 * played a few turns and reported from the headless client, its game from report_game (refused to
 * anyone but its owner), read as npm run report reads it, restored into the stack for another session
 * and played on a turn there. Host mode in CI; namespace mode where 11.0.0.1 isn't this machine's.
 *
 * M2 took out what the two-part GM hasn't got: the notes on marked words (B now joins once the
 * opening is in; the line and the fault that waited on the notes wait on the settle and the lines),
 * the old pipeline's decide (SpacetimeDB restarts in the settle; the ending is the co-GM's walk), its
 * ruling and the plain check when the ruling is too slow (24 is the mouthpiece's check), walking out
 * of the place on an ending of the player's own (25), the reactions to a spell (26 became the map's
 * act), a blow left hanging (27: nothing reads one after a reply) and the reactions kept by the AI
 * service as it died (29). Their numbers are kept, so the docs' references to the others still hold.
 * Since "After the migration: spells and blows said in a scene" (docs/migration-log.md) a line that
 * might be an act asks the act step and a violent act draws the reactions again: 26 has the people
 * who saw the map's act react, and 27 is a spell said in words; none starts a fight, so nothing is
 * left hanging, and 29 stays empty.
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
 * ones as the mouthpiece's narration, marked up with who says each line, and twelve lines to suggest;
 * but its co-GM kept still, so a scene stays open through the steps that play many lines in it
 * (step 14's walks it to its ending, and the story's walks every scene). Every call streams over 2 s,
 * so a draft grows in several posts; the lines come 0.8 s later.
 */
const FAKE: FakeOptions = onTop(devFake(), { coGm: { still: true } });
const NEW_GAME = { campaign: "caerwyn", name: "Wren Ashdown", concept: "a quick-witted investigator lent to the case by the King", build: "ranger" };
const NOTE = "The GM has lost the thread for a moment: trying again.";
/** The phases of a turn whose reply is in: the box is open again. */
const REPLIED = ["settling", "done"];

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
  await aSpectatorJoins(a, b, game);
  await aTurnBothSee(a, b, game);
  await killedMidReply(stack, a, game);
  await restartedMidReply(stack, a, game);
  await keptAnswer(stack, a, game);
  await spacetimeRestarted(stack, a, game);
  await aLineWhileSettling(stack, a, game);
  await aSuggestedLine(a, b);
  await linesOvertaken(stack, a, game);
  await keptLines(stack, a, game);
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
  await theCoGmSteers(stack, flags.root, a, remembered, FAKE);
  await aRiskyCheck(stack, flags.root, a, b, FAKE);

  const world = await beforeTheGmSpeaks(stack, a, b, FAKE);
  await aSpellInWords(stack, flags.root, a, b, world, FAKE);
  await fireBurnsOn(stack, a, world, FAKE);
  await rowForRow(stack, a, b, world);

  const lead = await player(stack, "C", true);
  await theWholeStory(stack, flags.root, lead, b, FAKE);
  await latencies(stack, a);
  await theTown(stack, flags.root, lead, b, FAKE);
  await aFightInTheRing(stack, lead, b);
  await aProblemReported(stack, flags.root, b, FAKE);

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
// The steps (v0-design §10.4, v5-design §4.4); V1's, 15 to 21, are e2e/creation.ts's, the GM's, 22 to 24, e2e/gm.ts's, the world's, 26 to 28 and 30, e2e/world.ts's, the whole story's, 31 to 34, e2e/story.ts's, the town's, 36 to 39, e2e/town.ts's, the fight's, 40, e2e/fight.ts's, and a report's, 41, e2e/report.ts's.

/** 1. The stack is up (--fresh); the campaign goes into both, and the zoo (M6) into the module beside it, as the dev stack installs them; the doctor finds all well. */
async function installedAndWell(stack: Stack): Promise<void> {
  step(`1. Up in ${stack.mode} mode, the campaign installed (and the zoo), the doctor`);
  const installed = await stack.install(join(import.meta.dirname, "..", "campaigns", "caerwyn"));
  ok(`${installed.id} installed in both`);
  const zoo = await stack.install(join(import.meta.dirname, "..", "campaigns", "zoo"));
  check(`${zoo.id} installed in the module alone (no GM plays it: the AI service is never given it)`, zoo.structure.ok && zoo.words.ok && "skipped" in zoo.words);
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
  await restartAi(stack, FAKE);
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
 * 3. B joins once the scene is live, and sees the opening as A does: its words, and who says each
 * line; turn 0 done for both. (Until M2, B joined while the opening's notes were being written and
 * both saw them land on its row: the notes went in M2.)
 */
async function aSpectatorJoins(a: Player, b: Player, game: Game): Promise<void> {
  step("3. A spectator joins: the opening as A has it");
  check("B's join_game is made", (await b.conn.joinGame(game.id)) === undefined);
  const [seenA, seenB] = await Promise.all([a, b].map(p => until(p, `${p.name} to see the opening, turn 0 done`, 30_000, r => r.scene.status === "live" && turnOf(r, 0)?.phase === "done" && r.transcript.find(t => t.turn === 0 && t.speaker === "gm"))));
  check(`A and B have the same opening, who says each line with it (${speakersIn(seenA!.markup).join(", ")})`, seenA!.text === seenB!.text && seenA!.markup === seenB!.markup && speakersIn(seenA!.markup).length > 0);
}

/** 4. A's line, A's second at once refused, B's refused; both clients see the turn's rows alike: who says each line as the draft grows, the lines suggested after it (A's alone). */
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

  check(`A saw turn ${n} go ${phasesSeen(a, n).join(", ")}: the two-part GM's reply and settle`, phasesSeen(a, n).join() === "replying,settling,done");
  const seenA = turnEvents(a.events.slice(from.a), n), seenB = turnEvents(b.events.slice(from.b), n);
  check(`A and B saw the same ${seenA.length} row events for the turn (its phases, the draft's posts with who says what, the entries)`, seenA.length > 5 && JSON.stringify(seenA) === JSON.stringify(seenB));
  const streamed = speakersIn(...a.events.slice(from.a).filter(e => e.table === "reply_draft" && e.op !== "delete").map(e => e.row.markup));
  check(`the reply's draft named Kell, Cob and Moll as it grew: ${streamed.join(", ")}`, ["cob", "kell", "moll"].every(k => streamed.includes(k)));
  const rows = a.conn.rows()!;
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
  const replies = modelCalls(game, "two-part.reply", keyOf(game, n, "reply"));
  check(`two-part.reply was asked ${replies} times for the reply's key: the killed one, and the one that finished`, replies === 2);
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
  check("two-part.reply was asked once for the reply's key", modelCalls(game, "two-part.reply", key) === 1);
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
  const staged = modelCalls(game, "world.stage", key), coGm = modelCalls(game, "two-part.co-gm", key);
  check(`world.stage and two-part.co-gm were asked ${staged} and ${coGm} time for the settle's key`, staged === 1 && coGm === 1);
}

/**
 * 8. SpacetimeDB stopped and started a second into a slow settle (the stage manager held back 3 s):
 * the reaper re-dispatches it after its deadline (70 s: the settle's minute and the grace), and the
 * AI service's kept answer carries the turn on. (Until M2 it was the decide's, 30 s: the two-part GM
 * has no decide, and the reply streams, so the think a restart lands in is the settle.)
 */
async function spacetimeRestarted(stack: Stack, a: Player, game: Game): Promise<void> {
  step("8. SpacetimeDB restarted mid-think");
  await restartAi(stack, { ...FAKE, byNameDelayMs: { world_ops: 3_000 } });
  const n = nextTurn(a);
  const said = performance.now();
  check("A says a line", (await a.conn.say("Cob, what did you hear last night?")) === undefined);
  await until(a, `turn ${n} settling`, 30_000, r => turnOf(r, n)?.phase === "settling");
  await pause(1_000);

  await stack.stdb.stop();
  await stack.stdb.start();
  ok("SpacetimeDB stopped and started again on its data, a second into the settle");
  await doneTurn(a, n, 120_000 - (performance.now() - said));
  ok(`${seconds(performance.now() - said)} from the line to the turn's end, A's connection back by itself`);

  const key = keyOf(game, n, "settle");
  const asked = modelCalls(game, "world.stage", key);
  check(`world.stage was asked ${asked} time for the settle's key`, asked === 1);
  check("the module logged the settle re-dispatched after its deadline", new RegExp(`${escaped(key)} re-dispatched after its deadline`).test(await moduleLog(stack)));
}

/**
 * 9. The stage manager held back 3 s: A says a line the moment its turn is settling. It's queued, and
 * its reply asked for only once the last turn's settle is in, so it has the co-GM's note written in
 * that settle. (Until M2 the line waited on the notes, which went in M2.)
 */
async function aLineWhileSettling(stack: Stack, a: Player, game: Game): Promise<void> {
  step("9. A line said while the world settles waits for the settle");
  await restartAi(stack, { ...FAKE, byNameDelayMs: { world_ops: 3_000 } });
  const n = nextTurn(a);
  check("A says a line", (await a.conn.say("Moll, did you really see him jump from up on that wall?")) === undefined);
  await until(a, `turn ${n} settling`, 30_000, r => turnOf(r, n)?.phase === "settling");
  check(`A says another the moment turn ${n} is settling: it's taken`, (await a.conn.say("And where were you, Cob?")) === undefined);
  await until(a, `turn ${n + 1} queued`, 5_000, r => turnOf(r, n + 1)?.phase === "queued");
  ok(`turn ${n + 1} is queued behind turn ${n}'s settle`);

  await doneTurn(a, n + 1);
  const settled = lastCallAt(game, "world.stage", keyOf(game, n, "settle")), replied = firstCallAt(game, "two-part.reply", keyOf(game, n + 1, "reply"));
  check(`turn ${n + 1}'s reply was asked for only once turn ${n}'s settle was in (${replied - settled} ms after)`, settled > 0 && replied > settled);
  const told = modelInput(game, "two-part.reply", keyOf(game, n + 1, "reply"));
  check(`turn ${n + 1}'s reply has the co-GM's note that settle wrote for it ("Co-GM note, before turn ${n + 1}")`, told.includes(`Co-GM note, before turn ${n + 1}`));
  await restartAi(stack, FAKE);
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

/**
 * 12. The AI service exits right after it stores a turn's lines (a job beside the turn, as the notes
 * were until M2): started again, it answers them from the store, and they land.
 */
async function keptLines(stack: Stack, a: Player, game: Game): Promise<void> {
  step("12. The AI service gone after it kept the lines");
  await restartAi(stack, FAKE, { KM_AI_FAULTS: "exit-after-store:suggest" });
  const n = nextTurn(a);
  check("A says a line", (await a.conn.say("Sergeant, who found him?")) === undefined);
  const code = await stack.ai.exited();
  const key = keyOf(game, n, "suggest");
  check(`the AI service exited (${code}) right after it stored the lines`, code === 137 && aiLog().includes(`exit-after-store: ${key} is stored`));
  await stack.ai.start({ KM_AI_FAKE: JSON.stringify(FAKE) });
  ok("the AI service is started again, without the fault");

  await doneTurn(a, n);
  const rows = await until(a, `turn ${n}'s lines`, 30_000, r => turnOf(r, n)?.suggest === "landed" && r);
  check(`the lines landed: ${linesOf(rows).map(l => `${l.ord} ${l.kind}`).join(", ")}`, linesOf(rows).length >= 3 && linesOf(rows).every(l => l.turn === n));
  check("the AI service answered them from its store", new RegExp(`suggest ${escaped(key)} attempt \\d+: 200 from the store`).test(aiLog()));
  check("scene.suggest was asked once for the key", modelCalls(game, "scene.suggest", key) === 1);
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

/**
 * 14. An ending: the co-GM walks the scene to murder by persons unknown (fake.json's walk: the
 * discovery it needs first, a route a line), each move taken again on the rows; the Hobb lead first
 * refused while nobody has said his name, so the name is owed (its step on the path), and the reply
 * after it told that Kell names him, which the fake's Kell does, so the lead is taken on the next;
 * at the ending the scene is closing, the next line's reply (the mouthpiece's closing) winds it down
 * with no settle and asks for no lines, the scene ends, and a further line is refused. (Until M2 the
 * decider took the old clerk's make-case on one line.)
 */
async function anEnding(stack: Stack, a: Player, b: Player, game: Game): Promise<void> {
  step("14. An ending");
  await restartAi(stack, onTop(FAKE, { coGm: { endings: ["murder-unknown"] } }));
  const lines = ["Cob, who was the big man in the yard last night?", "Sergeant, do you know a man that size?", "Sergeant, that's a cord mark, not a rope.", "Is that the dead-cart I hear in the lane?", "Write it down as murder, Sergeant: persons unknown."];
  const walked: string[] = [];
  let owedOn: number | undefined;
  for (const line of lines) {
    const n = nextTurn(a);
    check(`A says "${line}"`, (await a.conn.say(line)) === undefined);
    const rows = await doneTurn(a, n);
    const moves = (await gmOf(stack, game)).path.filter(p => p.turn === n).map(p => p.via);
    walked.push(...moves);
    if (moves.includes("owed:hobb")) owedOn = n;
    check(`the co-GM's move after turn ${n} is on the rows: ${moves.join(", ") || "none"}`, moves.length === 1);
    if (rows.scene.status === "closing") break;
  }
  const gm = await gmOf(stack, game);
  check(`the scene is closing on ${gm.closing?.exitId}, walked ${walked.join(", ")}`, a.conn.rows()!.scene.status === "closing" && gm.closing?.exitId === "murder-unknown" && walked.join() === "owed:hobb,find-hobb,find-murder,cart-comes,signed-murder");
  const named = owedOn === undefined ? "" : modelInput(game, "two-part.reply", keyOf(game, owedOn + 1, "reply"));
  check("the reply after the name was owed was told that Kell names him, and the fake's Kell did", named.includes("Sergeant Agnes Kell names him now: Big Hobb Mallory.") && a.conn.rows()!.transcript.some(e => e.text.includes("“Big Hobb Mallory.”")));

  const n = nextTurn(a);
  check("A says the wind-down line", (await a.conn.say("*to Kell, at the gate* Coming, Sergeant?")) === undefined);
  await until(a, "the scene to end", 60_000, r => r.scene.status === "ended" && r);
  const rows = await doneTurn(a, n);
  const last = [...rows.transcript].sort((x, y) => x.seq - y.seq).at(-1)!;
  check(`"${last.text}" closes the transcript`, last.kind === "system" && last.text === "Scene ends: Murder by persons unknown");
  check("the GM closed it with two-part.closing, and nothing settled after it", modelCalls(game, "two-part.closing", keyOf(game, n, "reply")) === 1 && modelCalls(game, "world.stage", keyOf(game, n, "settle")) === 0 && modelCalls(game, "two-part.co-gm", keyOf(game, n, "settle")) === 0);
  check("its last reply asked for no lines", turnOf(rows, n)!.suggest === "none" && modelCalls(game, "scene.suggest", keyOf(game, n, "suggest")) === 0);
  check("a further line is refused: scene_over", (await a.conn.say("Wait!"))?.code === "scene_over");
  await until(b, "B to see the scene end", 10_000, r => r.scene.status === "ended");
  ok("B saw it end too");
  await restartAi(stack, FAKE);
}

/** 35. Each turn's first words and its end, from the turn rows, game by game; its lines after the reply, as A saw them come (A's games); the map moves' times. */
async function latencies(stack: Stack, a: Player): Promise<void> {
  step("35. Each turn's times: first words and its end (the turn rows), its lines after the reply (as A saw them); the map moves' times");
  const turns = (await stack.sql("SELECT * FROM turn")).sort((x, y) => Number(x.game_id) - Number(y.game_id) || Number(x.n) - Number(y.n));
  for (const t of turns) {
    const from = Number(t.started_at);
    const first = t.first_text_at === null ? "no text" : `first words ${millis(Number(t.first_text_at) - from)}`;
    const done = t.ended_at === null ? "" : `, done ${millis(Number(t.ended_at) - from)}`;
    console.log(`  game ${t.game_id} turn ${t.n}: ${first}${done} (${t.phase}, ${t.calls} model calls)${afterTheReply(a, String(t.id), String(t.scene_id), Number(t.n))}; lines ${t.suggest}`);
  }
  await mapTimes(stack);
}

// ---------------------------------------------------------------------------------------------
// What the steps read.

/** A turn's row events as both clients should see them, in order: its phases and states, the draft's posts with who says what, its entries with who says what. */
function turnEvents(events: Player["events"], n: number): string[] {
  const turnId = events.find(e => e.table === "turn" && e.row.n === n)?.row.id;
  return events.flatMap(({ table, op, row }) => {
    if (table === "turn" && row.id === turnId) return [`turn ${op} ${row.phase} (lines ${row.suggest})`];
    if (table === "reply_draft" && row.turnId === turnId) return [`draft ${op} ${row.attempt}/${row.seq} ${speakersIn(row.markup).join("+")}`];
    if (table === "transcript" && row.turn === n) return [`entry ${op} ${row.seq} ${row.kind} ${speakersIn(row.markup).join("+")}`];
    return [];
  });
}

/** The phases a player saw turn n go through, in order. */
function phasesSeen(p: Player, n: number): string[] {
  const phases = p.events.filter(e => e.table === "turn" && e.row.n === n).map(e => String(e.row.phase));
  return phases.filter((phase, i) => phase !== phases[i - 1]);
}

/** When A saw a turn's lines land (the turn by its id, in its scene), after its reply's entry: "; lines +2.8 s". */
function afterTheReply(a: Player, turnId: string, sceneId: string, n: number): string {
  const reply = a.events.find(e => e.table === "transcript" && e.op === "insert" && String(e.row.sceneId) === sceneId && e.row.turn === n && e.row.speaker === "gm")?.at;
  if (reply === undefined) return "";
  const lines = a.events.find(e => e.table === "turn" && String(e.row.id) === turnId && e.row.suggest === "landed")?.at;
  return lines === undefined ? "" : `; lines +${seconds(lines - reply)}`;
}

// ---------------------------------------------------------------------------------------------
// The reply as drawn, read off the rows.

/** Who says what in some markup (transcript.markup, reply_draft.markup: JSON), by game key, in order. */
function speakersIn(...markups: Array<string | undefined>): string[] {
  return [...new Set(markups.flatMap(m => markupOf(m)?.speech.flatMap(s => (s.speaker ? [s.speaker] : [])) ?? []))].sort();
}

function markupOf(markup: string | undefined): Markup | undefined {
  return markup ? JSON.parse(markup) as Markup : undefined;
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
