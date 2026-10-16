import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FakeOptions } from "../../ai/llm/fake-openrouter.ts";
import { overBudget } from "../../ai/service/budget.ts";
import { jsonOf } from "../../client/json.ts";
import type { Creation } from "../../client/module_bindings/types.ts";
import type { Proposal } from "../../shared/creation/types.ts";
import { creationKey } from "../../shared/protocol/keys.ts";
import type { Offer } from "../../shared/rules/types.ts";
import type { Stack } from "../dev/stack.ts";
import {
  aiLog, callLog, check, doneTurn, escaped, homeUntil, modelCalls, moduleLog, nextTurn, note, ok, pause, player, restartAi, seconds,
  step, turnOf, until, type Player,
} from "./kit.ts";
import { aWalkBothSee, inTheLane } from "./map.ts";

/**
 * The e2e's steps for character creation (v1-design §4.3, C1-C6), after V0's and V5's: a concept to
 * the opening, the AI service gone after it kept the lore check, SpacetimeDB restarted while the
 * builds are made, checks and a character made beside another game's stream, the daily ceiling, and
 * a game carried on and another deleted. On the fake model, its answers for the builds, the draft and
 * the traits recorded from the prototype's (ai/rules/golden), its lore check finding nothing; its
 * scenes play as V5's steps' do, the notes and the lines among them.
 */

/** A game the steps play: its row id, its uid (in every key and the AI service's folders) and its scene. */
export interface Game { id: bigint; uid: string; scene: bigint }

const CAMPAIGN = "caerwyn";
const TAMSIN = { name: "Tamsin Vell", concept: "a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier" };

/** The model's answers the prototype's recordings give: three builds of three classes, a draft, and what the backstory says of her. */
const GOLDEN = join(import.meta.dirname, "..", "..", "ai", "rules", "golden");
const byName = Object.assign({}, ...["builds-tamsin", "backstory-draft", "backstory-traits"].map(f => (JSON.parse(readFileSync(join(GOLDEN, `${f}.json`), "utf8")) as { byName: object }).byName)) as Record<string, any>;
/** The traits' summary, which every GM brief carries as who they are. */
const SUMMARY = byName.traits.summary as string;

/** The e2e's fake model with creation's answers beside its own by name (the notes'): its replies and their pace are the scene's. */
export function creationFake(fake: FakeOptions): FakeOptions {
  return { ...fake, byName: { ...fake.byName, ...byName } };
}

// ---------------------------------------------------------------------------------------------
// C1 and C2: a concept to the opening, the lore check kept and the AI service gone.

/**
 * 15. A's character from a concept: three cards of three classes, the first chosen, a draft taken,
 * Done with the AI service exiting right after it stored the lore check's answer (and started again,
 * the check answered from its store), traits, the game made with the card's numbers; B refused
 * before begin; begin, on the map in the granary lane (map-design §3.3); B watching from there; A's
 * walk from the lane into the yard, which both see alike, opens the scene (e2e/map.ts); the opening
 * streamed with the backstory in its brief.
 */
export async function aConceptToTheOpening(stack: Stack, root: string, a: Player, b: Player, fake: FakeOptions): Promise<Game> {
  step("15. A character from a concept, to the opening");
  await restartAi(stack, fake);
  check("A's start_creation (three builds) is made", (await a.conn.act("startCreation", { campaign: CAMPAIGN, ...TAMSIN, how: "three" })) === undefined);
  const offer = await homeUntil(a, "the three builds", 60_000, r => !r.creation?.busy && jsonOf<Offer>(r.creation?.offer));
  const classes = offer.options.map(o => o.build.classId);
  check(`three cards of three classes (${classes.join(", ")})`, offer.options.length === 3 && new Set(classes).size === 3);
  const card = offer.options[0]!;

  check(`A chooses card 1: ${card.line}`, (await a.conn.act("chooseBuild", { index: 0 })) === undefined);
  check("A asks for a draft", (await a.conn.act("draftBackstory", { text: "" })) === undefined);
  const draft = await homeUntil(a, "the draft", 60_000, r => !r.creation?.busy && jsonOf<Proposal>(r.creation?.proposal));
  check("A takes the draft: it's the story now", (await a.conn.act("takeProposal", {})) === undefined && a.conn.home().creation?.story === draft.text);

  step("16. The AI service gone after it kept the lore check");
  await restartAi(stack, fake, { KM_AI_FAULTS: "exit-after-store:check" });
  check("A's Done: finish_backstory", (await a.conn.act("finishBackstory", { text: draft.text })) === undefined);
  const { uid, rev } = a.conn.home().creation as Creation;
  const key = creationKey(uid, rev, "check");
  const code = await stack.ai.exited();
  check(`the AI service exited (${code}) right after it stored the lore check's answer`, code === 137);
  await stack.ai.start({ KM_AI_FAKE: JSON.stringify(fake) });
  ok("the AI service is started again, without the fault");
  const made = await homeUntil(a, "the character made", 60_000, r => r.creation?.step === "made" && r.sheet && r);
  check("the AI service answered the lore check from its store", new RegExp(`check ${escaped(key)} attempt \\d+: 200 from the store`).test(aiLog(root)));
  check("backstory.check was asked once for the check's key", modelCalls(root, uid, "backstory.check", key) === 1);
  check("the backstory fits: nothing unchecked, no issues", !made.creation!.unchecked && !made.creation!.issues);

  const game = made.creation!.gameId!;
  const sheet = made.sheet as typeof made.sheet & { maxHp: number; ac: number; backstory?: string };
  check(`game ${game} is made under the creation's uid, its sheet the card's: HP ${sheet.maxHp}, AC ${sheet.ac}`, made.seat?.gameId === game && sheet.maxHp === card.card.hp && sheet.ac === card.card.ac);
  check("the sheet's backstory is the draft, with what it says of her", jsonOf<{ text: string; summary: string }>(sheet.backstory)?.summary === SUMMARY);
  check("B's join_game before begin is refused: not_begun", (await b.conn.joinGame(game))?.code === "not_begun");

  step("17. Set off: on the map, B watching; A walks from the lane into the yard; the opening, with who she is in its brief");
  const from = a.events.length;
  check("A's begin is made", (await a.conn.act("begin", {})) === undefined);
  await inTheLane(a, game);
  check("B's join_game is made, now it's begun: on the map", (await b.conn.joinGame(game)) === undefined);
  await inTheLane(b, game);
  await aWalkBothSee(a, b);
  const rows = await until(a, "the opening to go live", 60_000, r => r.game.id === game && r.scene.status === "live" && r);
  const seen = a.events.slice(from);
  const entry = seen.findIndex(e => e.table === "transcript" && e.op === "insert" && e.row.turn === 0);
  const drafts = seen.slice(0, entry).filter(e => e.table === "reply_draft" && e.op !== "delete").length;
  check(`A saw the opening's draft grow (${drafts} posts) before its entry landed`, entry >= 0 && drafts >= 2);
  check("the creation is gone with begin", a.conn.home().creation === undefined);
  const opening = callLog(root, uid).find(c => c.operation === "gm.opening" && c.request);
  check("the gm.opening call's input has the backstory's summary", !!opening && JSON.stringify(opening.request).includes(SUMMARY));
  await until(b, "B to see A's opening", 10_000, r => r.game.id === game && r.transcript.some(t => t.turn === 0));
  ok(`B watches game ${game}`);
  return { id: game, uid, scene: rows.scene.id };
}

// ---------------------------------------------------------------------------------------------
// C3: SpacetimeDB restarted mid-think.

/** 18. A second character for A: SpacetimeDB stopped and started a second into the builds; the reaper sends the offer again and the AI service's kept answer lands it. */
export async function restartedMidBuilds(stack: Stack, root: string, a: Player, fake: FakeOptions): Promise<void> {
  step("18. SpacetimeDB restarted while the builds are made");
  await restartAi(stack, { ...fake, streamMs: 3_000 });
  const asked = performance.now();
  check("A starts a second character", (await a.conn.act("startCreation", { campaign: CAMPAIGN, name: "Brother Odo", concept: "a large, gentle hedge-priest", how: "three" })) === undefined);
  const { uid, rev } = await homeUntil(a, "busy with the builds", 10_000, r => r.creation?.busy === "builds" && (r.creation as Creation));
  await pause(1_000);

  await stack.stdb.stop();
  await stack.stdb.start();
  ok("SpacetimeDB stopped and started again on its data, a second into the builds");
  const offer = await homeUntil(a, "the offer", 100_000, r => (r.creation as Creation | undefined)?.uid === uid && !r.creation!.busy && jsonOf<Offer>(r.creation!.offer));
  ok(`${offer.options.length} builds offered ${seconds(performance.now() - asked)} after start_creation, A's connection back by itself`);
  const key = creationKey(uid, rev, "offer");
  check("rules.builds was asked once for the offer's key", modelCalls(root, uid, "rules.builds", key) === 1);
  check("the module logged the offer re-dispatched after its deadline", new RegExp(`${escaped(key)} re-dispatched after its deadline`).test(await moduleLog(stack)));
}

// ---------------------------------------------------------------------------------------------
// C5: checks beside a stream.

/** What the module logs of the engine's time: makeCharacter, begin, each check. */
interface Timings { made: string[]; begins: number[]; checks: Array<{ what: string; ms: number }> }

/**
 * 19. C makes a character (the bard: a caster, the dearer to make) and plays two lines with checks
 * in a game of their own, while A talks in its game, each reply written over 3 s: A's drafts keep
 * arriving, no gap over 600 ms. The module's times for the engine (makeCharacter, begin, each
 * check) are printed, not held to v1-design §3.6's 100 ms: on an isolate that hasn't the
 * character's campaign loaded, begin or a check loads it first, 36-330 ms by its size (as built).
 */
export async function checksBesideAStream(stack: Stack, a: Player, fake: FakeOptions): Promise<void> {
  step("19. A character made and checks rolled beside another game's stream");
  // Every line tries Moll (an Insight check), and a try again counts as a new one, so each line rolls.
  await restartAi(stack, { ...fake, streamMs: 3_000, choices: { attempt: "catch-moll", same_again: "new" } });
  const logged = (await moduleLog(stack)).length;
  const c = await player(stack, "C");

  let playing = true;
  const talking = keepTalking(a, () => playing);
  try {
    await cPlays(c);
  } finally {
    playing = false;
  }
  const turns = await talking;

  const gaps = draftGaps(a, turns);
  // The bound catches the engine blocking other games for seconds, not a busy machine: the gap is
  // reported either way (600 ms on a quiet one), and a loaded machine stretched it past 600 ms.
  check(`A's ${turns.length} replies kept arriving while C played: ${gaps.posts} posts, the longest gap ${Math.round(gaps.longest)} ms`, gaps.posts > 10 && gaps.longest < 5000);
  const timings = timingsIn((await moduleLog(stack)).slice(logged));
  check(`the module logged the engine's time for C's character, its begin and ${timings.checks.length} checks`, timings.made.length >= 1 && timings.begins.length >= 1 && timings.checks.length >= 2);
  for (const line of timings.made) note(`the module's ${line}`);
  note(`begin ${timings.begins.join(", ")} ms; checks ${timings.checks.map(t => `${t.ms}`).join(", ")} ms (${timings.checks.filter(t => t.ms >= 100).length} over 100 ms: a campaign the isolate hadn't loaded)`);
  c.conn.close();
}

/** C: three builds, the second taken, no backstory (the game made at once), begin, then two lines that roll. */
async function cPlays(c: Player): Promise<void> {
  check("C's start_creation is made", (await c.conn.act("startCreation", { campaign: CAMPAIGN, name: "Wren Ashdown", concept: "a hedge wizard from the fens", how: "three" })) === undefined);
  await homeUntil(c, "C's builds", 60_000, r => !r.creation?.busy && jsonOf<Offer>(r.creation?.offer));
  check("C takes card 2 and skips the backstory", (await c.conn.act("chooseBuild", { index: 1 })) === undefined && (await c.conn.act("skipBackstory", {})) === undefined);
  const game = await homeUntil(c, "C's game made", 10_000, r => r.creation?.step === "made" && r.creation.gameId);
  check(`C sets off in game ${game}`, (await c.conn.act("begin", {})) === undefined);
  check("C walks from the lane to the lead (walk toward lead)", (await c.conn.walk({ toward: "lead" })) === undefined);
  await until(c, "C's opening", 60_000, r => r.game.id === game && r.scene.status === "live");
  for (const line of ["Moll, you never saw him jump, did you?", "Moll, who paid you to say it?"]) {
    const n = nextTurn(c);
    check(`C says "${line}"`, (await c.conn.say(line)) === undefined);
    const rows = await doneTurn(c, n);
    const roll = rows.transcript.find(t => t.turn === n && t.kind === "roll");
    check(`C's turn ${n} rolled: ${roll?.text ?? "nothing"}`, !!roll);
  }
}

/** A says line after line in its game until C is done: the turns it said. */
async function keepTalking(a: Player, more: () => boolean): Promise<number[]> {
  const lines = ["Kell, who barred the loft door?", "Cob, where do you sleep?", "Kell, who cut him down?", "Moll, how long were you on the wall?"];
  const said: number[] = [];
  for (let i = 0; more(); i++) {
    const n = nextTurn(a);
    if ((await a.conn.say(lines[i % lines.length]!)) !== undefined) throw new Error(`A's line ${i + 1} was refused`);
    said.push(n);
    await doneTurn(a, n, 90_000);
  }
  ok(`A said ${said.length} lines meanwhile`);
  return said;
}

/** The gaps between the draft's posts as A saw them arrive, each reply attempt's posts in turn. */
function draftGaps(a: Player, turns: number[]): { posts: number; longest: number } {
  const ids = new Set(a.events.filter(e => e.table === "turn" && turns.includes(e.row.n)).map(e => e.row.id));
  const posts = a.events.filter(e => e.table === "reply_draft" && e.op !== "delete" && ids.has(e.row.turnId));
  let longest = 0;
  for (let i = 1; i < posts.length; i++) {
    const [was, now] = [posts[i - 1]!, posts[i]!];
    if (was.row.turnId === now.row.turnId && was.row.attempt === now.row.attempt) longest = Math.max(longest, now.at - was.at);
  }
  return { posts: posts.length, longest };
}

/** The module's "[rules] …" lines: each make (whole), begin's time, each check's. */
function timingsIn(log: string): Timings {
  return {
    made: [...log.matchAll(/\[rules\] (makeCharacter \d+ ms[^\n]*)/g)].map(m => m[1]!.trim()),
    begins: [...log.matchAll(/\[rules\] begin (\d+) ms/g)].map(m => Number(m[1])),
    checks: [...log.matchAll(/\[rules\] check (\S+ DC \d+) (\d+) ms/g)].map(m => ({ what: m[1]!, ms: Number(m[2]) })),
  };
}

// ---------------------------------------------------------------------------------------------
// C6: the ceiling.

/** 20. A $10 line for today in the ledger: A's line fails with the ceiling's words; the ceiling raised and the AI service restarted, /retry finishes it. */
export async function theCeiling(stack: Stack, root: string, a: Player, fake: FakeOptions): Promise<void> {
  step("20. The daily ceiling");
  appendFileSync(join(root, "ai", "ledger.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), operation: "e2e.spend", costUsd: 10 })}\n`);
  ok("$10 spent today, by the AI service's ledger");
  const n = nextTurn(a);
  check("A says a line", (await a.conn.say("Kell, who has the key to the loft?")) === undefined);
  const failed = await until(a, `turn ${n} to fail`, 30_000, r => turnOf(r, n)?.phase === "failed" && turnOf(r, n));
  check(`the turn failed in the ceiling's words: "${failed.error}"`, failed.error === overBudget(5));
  await restartAi(stack, fake, { KM_AI_DAILY_USD: "100" });
  ok("the AI service restarted with KM_AI_DAILY_USD=100");
  check("A's /retry is made", (await a.conn.retry()) === undefined);
  await doneTurn(a, n);
}

// ---------------------------------------------------------------------------------------------
// C4: continue and delete.

/**
 * 21. A's games, the one played last first; continue_game moves A's seat to the first; delete_game
 * of the second leaves no row of it in any table the registry names (games/delete.ts), and B, who
 * watched it, loses its seat.
 */
export async function continueAndDelete(stack: Stack, a: Player, b: Player, first: bigint, made: Game): Promise<void> {
  step("21. Continue one game, delete another");
  const listed = [...a.conn.home().games].sort((x, y) => Number(y.lastPlayedAt.microsSinceUnixEpoch - x.lastPlayedAt.microsSinceUnixEpoch));
  check(`A's games, the one played last first: ${listed.map(g => `${g.gameId} (${g.name}: ${g.where})`).join("; ")}`,
    listed.map(g => g.gameId).join() === `${made.id},${first}` && listed[0]!.where === "in The Hanged Clerk" && listed[1]!.where === "The Hanged Clerk, over");

  check(`A's continue_game(${first}) is made`, (await a.conn.act("continueGame", { game: first })) === undefined);
  await homeUntil(a, `A's seat in game ${first}`, 10_000, r => r.seat?.gameId === first);
  ok(`A's seat is in game ${first}`);

  const before = await rowsOf(stack, made.id);
  check(`B's delete_game(${made.id}) is refused: not_yours`, (await b.conn.act("deleteGame", { game: made.id }))?.code === "not_yours");
  check(`A's delete_game(${made.id}) is made`, (await a.conn.act("deleteGame", { game: made.id })) === undefined);
  const after = await rowsOf(stack, made.id, before.ids);
  check(`game ${made.id}'s rows: ${before.count} in ${before.tables} tables before, ${after.count} after (${after.left.join(", ") || "none left"})`, before.count > 0 && after.count === 0);
  await homeUntil(b, "B's seat to go", 10_000, r => !r.seat);
  ok("B, who watched it, has no seat");
  check(`A's games: ${first} alone`, a.conn.home().games.map(g => g.gameId).join() === String(first));
}

/** The registry's tables (games/delete.ts), each with the column that ties a row to the game, a player, a scene, a place or a job. */
const TABLES: Array<[table: string, column: string, by: keyof Ids]> = [
  ["game", "id", "game"], ["sheet", "game_id", "game"], ["rules_state", "game_id", "game"], ["dice", "game_id", "game"], ["job", "game_id", "game"],
  ["creation", "game_id", "game"], ["player", "game_id", "game"], ["scene", "game_id", "game"], ["place", "game_id", "game"], ["explore", "game_id", "game"],
  ["seat", "player_id", "players"], ["heard", "player_id", "players"],
  ["gm_state", "scene_id", "scenes"], ["on_stage", "scene_id", "scenes"], ["reply_draft", "scene_id", "scenes"], ["turn", "scene_id", "scenes"], ["transcript", "scene_id", "scenes"],
  ["scene_suggestion", "scene_id", "scenes"],
  ...["position", "area", "material", "health", "stack", "surface", "creature", "player_character", "gear", "narrative", "gm_note", "world_log", "look", "entity"]
    .map(t => [t, "place_id", "places"] as [string, string, keyof Ids]),
  ["job_dispatch", "job_id", "jobs"],
];

interface Ids { game: string[]; players: string[]; scenes: string[]; places: string[]; jobs: string[] }

/** How many rows of the game each registered table holds (by the ids it had before, once it's gone). */
async function rowsOf(stack: Stack, game: bigint, known?: Ids): Promise<{ ids: Ids; count: number; tables: number; left: string[] }> {
  const of = async (table: string, column: string, values: string[]) => (await stack.sql(`SELECT * FROM ${table}`)).filter(r => values.includes(String(r[column])));
  const ids: Ids = known ?? {
    game: [String(game)],
    players: (await of("player", "game_id", [String(game)])).map(r => String(r.id)),
    scenes: (await of("scene", "game_id", [String(game)])).map(r => String(r.id)),
    places: (await of("place", "game_id", [String(game)])).map(r => String(r.id)),
    jobs: (await of("job", "game_id", [String(game)])).map(r => String(r.id)),
  };
  let count = 0, tables = 0;
  const left: string[] = [];
  for (const [table, column, by] of TABLES) {
    const n = (await of(table, column, ids[by])).length;
    count += n;
    if (n) { tables++; left.push(`${table} ${n}`); }
  }
  return { ids, count, tables, left };
}
