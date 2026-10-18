// After the GM loop's src/eval/loop/play.ts at 5f01806 (origin/claude/gm-loop, draft PR #663): a tester's brief, start and say, the markup's lines left out and the scene's end or the turn limit said. On the game they play through the headless client's verbs (client/headless.ts) against a dev stack, a session and a player each, rather than the prototype's scene harness.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newGameOf, type Backend } from "../../client/backend.ts";
import * as verbs from "../../client/headless.ts";
import type { SceneView } from "../../client/scene/view.ts";
import { endingOf, questLine } from "../../client/story/view.ts";
import { capped, type Call } from "./calls.ts";
import { BACKOFF_MS, capture, carryTurnOn, ceiling, patiently, QUIET, SETTLED, type Patience } from "./patience.ts";
import { BRIEFS, notesPath, recordPath, roundDir, shortPath, type LoopConfig } from "./paths.ts";
import { reachScene } from "./reach.ts";
import { entriesOf, entryText, mergeEntries, newRecord, readRecord, turnsOf, turnsTaken, turnText, writeRecord, type GameRecord, type HandedOn, type TurnLog, type Wait } from "./record.ts";
import { zooOf } from "../../client/zoo/zoo.ts";
import { gameOf, loadRound, type Persona, type Round } from "./round.ts";
import type { Loaded } from "./scenes.ts";

/**
 * Blind play: a tester plays a round's game as its player, through the headless client's verbs, and
 * sees only what a player sees: the narration, who says each line ("Name: ", where the screen has
 * their colour), the dice lines (a check the GM calls: the roll and how far it made or missed the DC,
 * then the outcome that came up) and the game's own lines; not the suggested lines (turned off: the
 * testers write their own). The loop keeps what they saw, turn by turn, in the game's record.
 */

/** What the loop needs of the world: the stack to play on, its owner's rows, its campaign, its call log, the clock. The host makes them. */
export interface PlayDeps {
  /** A connection to the stack in folder `stack`, as the session `name` kept under `runs` (its identity), with the stack's owner for end_scene. */
  connect(stack: string, session: { runs: string; name: string }): Promise<Backend>;
  /** SQL as the stack's owner, for the rows a player doesn't see (the game's uid, what the boundary handed on); none without its stack.json. */
  owner(stack: string): OwnerQuery | undefined;
  /** The campaign version the stack installed, loaded as its AI service loads it (scenes.ts). */
  campaign(stack: string, id: string, version: string): Promise<Loaded>;
  /** The game's model calls, from the stack's AI service's log (its path, for keeping a copy). */
  calls(stack: string, uid: string): Call[];
  callLog(stack: string, uid: string): string;
  sleep(ms: number): Promise<void>;
  now(): Date;
  /** The backoffs between tries (patience.ts): a test's are short. */
  backoff?: number[];
}

export type OwnerQuery = (sql: string) => Promise<Array<Record<string, unknown>>>;

/** What a verb prints, and its exit code. */
export interface Played { code: number; text: string }

// ---------------------------------------------------------------------------------------------
// start

/**
 * A game started: its character made from the persona's sentence (or, if that fails, its ready-made
 * build), the suggested lines turned off, the story taken to the game's scene (reach.ts), and the
 * opening printed as the player sees it, with who they are and what they were told.
 */
export async function start(config: LoopConfig, roundName: string, id: string, deps: PlayDeps): Promise<Played> {
  const round = loadRound(config, roundName);
  const game = gameOf(round, id);
  const file = recordPath(config, roundName, id);
  const exhibit = exhibitOf(game.scene);
  const record = readRecord(file) ?? newRecord({ round: roundName, game: id, scene: game.scene, stack: game.armed.stack });
  if (record.sceneRow) return { code: 0, text: `Game ${id} has already started. Go on with: ${config.command} say ${roundName} ${id} "<what you say or do>"` };

  const began = deps.now();
  const patience = patienceOf(deps, []);
  const conn = await deps.connect(record.stack, { runs: roundDir(config, roundName), name: id });
  try {
    if (exhibit) await visitExhibit(conn, exhibit, game.who, record);
    else await makeCharacter(conn, game.who, record, patience);
    await conn.setSuggestions(false);
    const loaded = await gameFacts(conn, record, deps);
    if (exhibit) record.scene = zooOf(conn.home())?.exhibits.find(e => e.id === exhibit)?.scene ?? exhibit;
    await reachScene(conn, record.scene, loaded, record, patience);
    if (conn.view()?.suggestionsOn) await conn.setSuggestions(false);
    await snapshot(conn, record, deps);

    delete record.stopped;
    record.turns["0"] = { at: began.toISOString(), ms: deps.now().getTime() - began.getTime(), waits: patience.waits };
    return { code: 0, text: openingText(record, conn.view()!, round, config) };
  } catch (error) {
    record.stopped = `start failed: ${messageOf(error)}`;
    return { code: 1, text: `The game didn't start: ${messageOf(error)}\n\nRun start again in a minute: it carries on from where it got to.` };
  } finally {
    conn.close();
    writeRecord(file, record);
  }
}

/** A round's scene that's one of the zoo's scene exhibits (`zoo/<exhibit>`: docs/combat-gm.md): the exhibit's id; undefined for a scene of the story. */
export const exhibitOf = (scene: string): string | undefined => (scene.startsWith("zoo/") ? scene.slice("zoo/".length) : undefined);

/**
 * A visit to the zoo, opening a scene exhibit, unless a start before this one made it: the persona as
 * the zoo's ready-made build nearest theirs (the zoo has the fighter, the wizard and the rogue), by
 * the persona's name; the exhibit's scene opens as the visit's first, its opening played.
 */
async function visitExhibit(conn: Backend, exhibit: string, who: Persona, record: GameRecord): Promise<void> {
  if (record.player && record.gameId === seatOf(conn)) return;
  const zoo = zooOf(conn.home());
  if (!zoo) throw new Error("the stack hasn't the zoo installed");
  const build = zoo.builds.some(b => b.id === who.build) ? who.build : zoo.builds[0]?.id ?? "fighter";
  const { name } = newGameOf(who.as, "", "zoo");
  const out = capture();
  if (await verbs.visitZoo(conn, { exhibit, build, name }, out, SETTLED) !== 0) throw new Error(`the zoo's ${exhibit} didn't open: ${out.printed.trim()}`);
  record.player = { name, concept: zoo.builds.find(b => b.id === build)?.concept ?? build, ...buildOf(conn), made: `the zoo's ready-made ${build}${build === who.build ? "" : ` (the zoo hasn't the ${who.build})`}` };
  record.gameId = seatOf(conn);
}

/** The character, unless a start before this one made it (the session is seated in its game), then set off on the map. */
async function makeCharacter(conn: Backend, who: Persona, record: GameRecord, patience: Patience): Promise<void> {
  if (!record.player || record.gameId !== seatOf(conn)) {
    record.player = await newCharacter(conn, who, patience);
    record.gameId = seatOf(conn);
  }
  if (!begun(conn)) await patiently(conn, () => verbs.begin(conn, QUIET, SETTLED), carryTurnOn, patience);
}

/**
 * A character made as a player makes one: from the persona's sentence (the GM offers builds and picks
 * one; no backstory), tried again after a backoff when it fails; if it never takes, the persona's
 * ready-made build (the nearest of the campaign's), which goes straight in.
 */
async function newCharacter(conn: Backend, who: Persona, patience: Patience): Promise<NonNullable<GameRecord["player"]>> {
  const campaign = conn.home().campaigns[0]?.key;
  if (!campaign) throw new Error("the stack has no campaign installed: is its dev host up?");
  const { name, concept } = newGameOf(who.as, "", campaign);

  const why = await fromTheSentence(conn, { campaign, name, concept }, patience);
  if (!why) return { name, concept, ...buildOf(conn), made: "from the persona's sentence (the GM picked the build)" };

  const out = capture();
  if (await verbs.newCharacter(conn, { campaign, name, concept, build: who.build }, out, SETTLED) !== 0) {
    throw new Error(`neither the persona's sentence (${why}) nor the ready-made ${who.build} made a character: ${out.printed.trim()}`);
  }
  return { name, concept, ...buildOf(conn), made: `the ready-made ${who.build} build: the sentence didn't make one (${why})` };
}

/** The persona's sentence through character creation, a try and a backoff at a time: undefined once it's made, else why not. The day's ceiling stops it. */
async function fromTheSentence(conn: Backend, asked: verbs.NewCharacter, patience: Patience): Promise<string | undefined> {
  const before = seatOf(conn);
  let why = "";
  for (const ms of [0, ...(patience.backoff ?? BACKOFF_MS)]) {
    if (ms) await waitLogged(patience, `making the character: ${why}`, ms);
    const out = capture();
    const code = await verbs.newCharacter(conn, asked, out, SETTLED).catch((error: unknown) => { out.print(messageOf(error)); return 1; });
    if (code === 0 || (seatOf(conn) !== before && !!conn.home().sheet?.data)) return undefined;
    why = out.printed.trim().split("\n").at(-1) ?? "";
    if (ceiling(out.printed)) throw new Error(why);
  }
  return why;
}

/** The game's number, its uid and campaign (as the stack's owner reads them; else the campaign the stack has installed), and that campaign loaded. */
async function gameFacts(conn: Backend, record: GameRecord, deps: PlayDeps): Promise<Loaded> {
  if (record.gameId === undefined) throw new Error("the session isn't seated in a game");

  const [row] = (await deps.owner(record.stack)?.(`SELECT * FROM game WHERE id = ${record.gameId}`)) ?? [];
  const installed = conn.home().campaigns[0];
  if (row) record.uid = String(row.uid);
  record.campaign = row ? { id: String(row.campaign), version: String(row.campaign_version) } : { id: installed?.key ?? "", version: installed?.version ?? "" };
  return await deps.campaign(record.stack, record.campaign.id, record.campaign.version);
}

/** The scene as it opened: its row, what the player was told, their notebook, the opening's entries, and what the boundary handed on (the GM's side). */
async function snapshot(conn: Backend, record: GameRecord, deps: PlayDeps): Promise<void> {
  const view = conn.view()!;
  record.sceneRow = view.sceneId;
  if (view.hook) record.hook = view.hook;
  const notebook = notebookOf(view);
  if (notebook.length) record.notebook = notebook;
  record.entries = entriesOf(view);

  const handed = await handedOnOf(record, deps);
  if (handed) record.handedOn = handed;
}

/** The boundary's work on the scene, from its gm_state row: where the prep no longer matched, the opening rewritten, how the story led here, what's owed, who's away. */
async function handedOnOf(record: GameRecord, deps: PlayDeps): Promise<HandedOn | undefined> {
  const [gm] = (await deps.owner(record.stack)?.(`SELECT * FROM gm_state WHERE scene_id = ${record.sceneRow}`)) ?? [];
  if (!gm) return undefined;
  const texts = (v: unknown) => (Array.isArray(v) ? v.map(x => (typeof x === "string" ? x : JSON.stringify(x))) : []);
  const owed = (Array.isArray(gm.owed) ? gm.owed as Array<Record<string, unknown>> : []).map(o => `${String(o.from)}/${String(o.id)}${Array.isArray(o.holders) && o.holders.length ? ` (with ${o.holders.join(", ")})` : ""}`);
  const handed: HandedOn = {
    adjustments: texts(gm.adjustments), owed, absent: texts(gm.absent),
    ...(typeof gm.opening === "string" ? { opening: gm.opening } : {}), ...(typeof gm.lead === "string" ? { lead: gm.lead } : {}),
  };
  return handed.adjustments.length || handed.owed.length || handed.absent.length || handed.opening || handed.lead ? handed : undefined;
}

// ---------------------------------------------------------------------------------------------
// say

/**
 * A line played: said, its turn waited out (patiently: the GM busy, the in-flight cap, a turn that
 * failed), a fight it brings on fought out on the board by the dice, then what answered it, as the
 * player saw it, and where the game stands: the turn, or the scene's end, or the turn limit.
 */
export async function say(config: LoopConfig, roundName: string, id: string, words: string, deps: PlayDeps): Promise<Played> {
  const round = loadRound(config, roundName);
  const file = recordPath(config, roundName, id);
  const record = readRecord(file);
  const stop = cantSay(record, round, config, id);
  if (stop) return stop;
  if (!record) throw new Error(`Game ${id} has no record.`);

  const conn = await deps.connect(record.stack, { runs: roundDir(config, roundName), name: id });
  const seen = lastSeen(conn, record.sceneRow!);
  const before = { entries: record.entries.length, here: hereOf(seen.view()), status: seen.view()?.player.status };
  try {
    const played = await playLine(conn, seen, words, record, deps);
    upToDate(record, seen.view());
    noteTheEnd(record, seen.view());
    if (played.refused) return refusedText(record, before.entries, played.refused);

    noteCapped(record, played.turn, deps);
    const failed = failedText(record, seen.view());
    return { code: failed ? 1 : 0, text: [answerText(record, before, seen.view(), words, round), failed].filter(Boolean).join("\n\n") };
  } finally {
    seen.stop();
    conn.close();
    writeRecord(file, record);
  }
}

/** A turn the game couldn't answer, after the loop's waits: its words, and for the day's ceiling, that the game stops there. */
function failedText(record: GameRecord, view: SceneView | undefined): string | undefined {
  if (view?.phase !== "failed" || view.failed === undefined) return undefined;
  if (!ceiling(view.failed)) return `(The game couldn't answer: ${view.failed} In a minute, say the same line again: the game carries the turn on from where it got to, and doesn't say it twice.)`;
  record.stopped = `the day's budget: ${view.failed}`;
  return `(The game couldn't answer: ${view.failed} That's the day's budget for the models: stop here, and say so in your notes.)`;
}

/** A line the game didn't take: the game's words; or, when the scene ended meanwhile (its closing reply still settling), what came since the tester last looked and that it's over. */
function refusedText(record: GameRecord, from: number, refusal: string): Played {
  if (!record.ended) return { code: 1, text: refusal };
  const fresh = record.entries.slice(from).map(entryText).join("\n\n");
  return { code: 0, text: `${fresh ? `${fresh}\n\n` : ""}— The scene is over (${record.ended.title}). — Write your notes now.` };
}

/**
 * Why there's no saying a line now: the game hasn't started (exit 1); or the scene's over, or the
 * turns are used up, which is the game's answer, not a failure a tester would try again (exit 0).
 */
function cantSay(record: GameRecord | undefined, round: Round, config: LoopConfig, id: string): Played | undefined {
  if (!record?.sceneRow) return { code: 1, text: `Game ${id} hasn't started: ${config.command} start ${round.name} ${id}` };
  if (record.ended) return { code: 0, text: `— The scene is over (${record.ended.title}). — Write your notes now.` };
  if (turnsTaken(record) >= round.maxTurns) return { code: 0, text: `That was your last turn (the round's limit is ${round.maxTurns}). Write your notes now.` };
  return undefined;
}

/**
 * The line said and its turn seen out. A turn the last command didn't see out (cut off, or failed)
 * is carried on first. Refused (the game's words) when the line wasn't taken; else its log.
 */
async function playLine(conn: Backend, seen: Seen, words: string, record: GameRecord, deps: PlayDeps): Promise<{ refused?: string; turn: number }> {
  const at = deps.now();
  const patience = patienceOf(deps, []);
  const again = failedWith(seen.view(), words);
  if (unfinished(seen.view())) await patiently(conn, () => carryTurnOn(conn), carryTurnOn, patience);
  // The line run again after its turn failed: that turn, carried on, is its answer (it isn't said twice).
  if (again !== undefined) {
    record.turns[String(again)] = turnLog(words, at, deps.now(), patience.waits, seen.view());
    return { turn: again };
  }

  const out = capture();
  const lines = playerLines(seen.view());
  const code = await patiently(conn, () => verbs.say(conn, words, out, SETTLED), carryTurnOn, patience);
  const turn = newTurn(seen.view(), lines);
  if (turn === undefined) return { refused: out.printed.trim() || `(The line wasn't said: the game answered ${code}.)`, turn: -1 };

  // A fight it brings on is set out on the board and seen through by the dice, then the scene picks up after it (docs/combat-gm.md).
  if (conn.view()?.fighting && !conn.fight?.()) await patiently(conn, () => verbs.fight(conn, QUIET, SETTLED), carryTurnOn, patience);
  if (conn.fight?.()) await patiently(conn, () => verbs.foughtOut(conn, QUIET, SETTLED), carryTurnOn, patience);
  record.turns[String(turn)] = turnLog(words, at, deps.now(), patience.waits, seen.view());
  return { turn };
}

function turnLog(words: string, at: Date, now: Date, waits: Wait[], view: SceneView | undefined): TurnLog {
  return { said: words, at: at.toISOString(), ms: now.getTime() - at.getTime(), waits, ...(view?.phase === "failed" && view.failed ? { failed: view.failed } : {}) };
}

/** The turn of the scene's latest line, when that turn failed and the line is `words`: the tester running it again. */
function failedWith(view: SceneView | undefined, words: string): number | undefined {
  const last = view?.entries.filter(e => e.kind === "player").at(-1);
  return view?.phase === "failed" && last?.text.trim() === words.trim() ? last.turn : undefined;
}

/** The scene's latest turn is still being answered, or failed: the next line would be refused. */
const unfinished = (view: SceneView | undefined) => !!view && !view.over && (view.phase === "failed" || !view.mayType);

const playerLines = (view: SceneView | undefined) => view?.entries.filter(e => e.kind === "player").length ?? 0;

/** The turn of the line just said: the player's newest line, if there are more of them than before. */
function newTurn(view: SceneView | undefined, before: number): number | undefined {
  const lines = view?.entries.filter(e => e.kind === "player") ?? [];
  return lines.length > before ? lines.at(-1)!.turn : undefined;
}

/** How the scene ended, once it has: the "Scene ends" line's title (the report finds the ending and its grade). */
function noteTheEnd(record: GameRecord, view: SceneView | undefined): void {
  if (!view?.over) return;
  const last = record.entries.at(-1)?.turn ?? 0;
  record.ended = { turn: last, title: endingOf(view) ?? "The scene is over" };
}

/** The calls OpenRouter turned away with a 402 (the in-flight cap) while the turn was answered, from the stack's call log. */
function noteCapped(record: GameRecord, turn: number, deps: PlayDeps): void {
  const log = record.turns[String(turn)];
  if (!log || !record.uid || !record.sceneRow) return;
  const key = `${record.uid}:s${record.sceneRow}:t${turn}:`;
  const n = capped(deps.calls(record.stack, record.uid).filter(c => c.key?.startsWith(key)));
  if (n) log.capped = n;
}

// ---------------------------------------------------------------------------------------------
// The other verbs: the transcript, the sheet, the notebook, the place; the brief

/** The scene so far, as the player saw it, from the game's rows (the record when the stack's out of reach). */
export async function transcript(config: LoopConfig, roundName: string, id: string, deps: PlayDeps): Promise<Played> {
  const file = recordPath(config, roundName, id);
  const record = readRecord(file);
  if (!record?.sceneRow) return { code: 1, text: `Game ${id} hasn't started.` };
  await syncFromStack(config, record, deps).catch(() => undefined);
  writeRecord(file, record);
  const turns = turnsOf(record.entries).map(([n, entries]) => `## Turn ${n}${n === 0 ? " (the opening)" : ""}\n\n${turnText(entries)}`);
  return { code: 0, text: `${turns.join("\n\n")}${record.ended ? `\n\n— The scene is over (${record.ended.title}). —` : ""}` };
}

/** What a player can look at without taking a turn: their sheet, their notebook and quests, the place drawn. */
export async function look(config: LoopConfig, roundName: string, id: string, what: "sheet" | "journal" | "map", deps: PlayDeps): Promise<Played> {
  const record = readRecord(recordPath(config, roundName, id));
  if (!record?.sceneRow) return { code: 1, text: `Game ${id} hasn't started.` };
  const conn = await deps.connect(record.stack, { runs: roundDir(config, roundName), name: id });
  try {
    const out = capture();
    const code = what === "sheet" ? verbs.sheet(conn, out) : what === "map" ? verbs.map(conn, out) : journal(conn, out);
    return { code, text: out.printed.replace(/^MODE: \w+\n\n/, "").trim() };
  } finally {
    conn.close();
  }
}

/** The notebook and the quests, as the player's /journal and /quests show them. */
function journal(conn: Backend, out: verbs.Out): number {
  const story = conn.view()?.story;
  const notebook = notebookOf(conn.view());
  out.print(`Your notebook:\n\n${notebook.length ? notebook.join("\n") : "Nothing yet. The notebook is new, and smells of it."}`);
  out.print(`\nQuests:\n${story?.quests.length ? story.quests.map(q => `- ${questLine(q)}`).join("\n") : "(none yet)"}`);
  return 0;
}

/** What a tester is told: their character, how to play them, the commands, and nothing about the build. */
export function brief(config: LoopConfig, roundName: string, id: string): string {
  const round = loadRound(config, roundName);
  const game = gameOf(round, id);
  const fill: Record<string, string> = {
    round: roundName, game: id, as: game.who.as, style: game.who.style, maxTurns: String(round.maxTurns),
    goal: game.goal ? `\n## Your goal\n\n${game.goal}\n` : "",
    notes: shortPath(notesPath(config, roundName, id)), loop: config.command,
  };
  return readFileSync(join(BRIEFS, "tester.md"), "utf8").replace(/\{\{(\w+)\}\}/g, (_, k: string) => fill[k] ?? "");
}

// ---------------------------------------------------------------------------------------------
// What the player sees, as text

function openingText(record: GameRecord, view: SceneView, round: Round, config: LoopConfig): string {
  const player = record.player!;
  return [
    `You are ${player.name}: ${player.concept}.${player.build ? `\nIn game terms: ${player.build}. (sheet shows your character sheet.)` : ""}`,
    record.notebook ? `What has happened in the story so far, from your notebook:\n\n${record.notebook.join("\n")}` : undefined,
    `[${view.title}${view.time ? `, ${view.time}` : ""}] ${hereLine(hereOf(view))}`,
    view.hook,
    turnText(record.entries.filter(e => e.turn === 0)),
    `(Turn 0 of ${round.maxTurns}: the opening. Your turn: ${config.command} say ${round.name} ${record.game} "<what you say or do>")`,
  ].filter(Boolean).join("\n\n");
}

/** What came since the tester last looked (not the line they just typed), who's here now and their state if either changed, and where the game stands. */
function answerText(record: GameRecord, before: { entries: number; here: string[]; status: string | undefined }, view: SceneView | undefined, words: string, round: Round): string {
  const fresh = record.entries.slice(before.entries).filter(e => !(e.kind === "player" && e.text === words));
  const here = hereOf(view);
  const taken = turnsTaken(record);
  const footer = record.ended ? `— The scene is over (${record.ended.title}). — Write your notes now.`
    : taken >= round.maxTurns ? `(That was your last turn: the round's limit is ${round.maxTurns}. Write your notes now.)`
    : `(Turn ${taken} of ${round.maxTurns}.)`;
  return [
    fresh.map(entryText).join("\n\n") || "(Nothing came back.)",
    here.join() !== before.here.join() ? `(${hereLine(here)})` : undefined,
    view?.player.status && view.player.status !== before.status ? `(You: ${view.player.status})` : undefined,
    footer,
  ].filter(Boolean).join("\n\n");
}

const hereOf = (view: SceneView | undefined) => view?.present.map(p => p.name) ?? [];
const hereLine = (names: string[]) => (names.length ? `Here: ${names.join(", ")}.` : "Nobody else is here.");

/** The notebook's chapters (each scene played before this one) as lines: how each ended, its lines, how things stood after it. */
function notebookOf(view: SceneView | undefined): string[] {
  return (view?.story?.notebook ?? []).filter(n => n.chapter).map(n => [`${n.title}: ${n.ending}`, ...n.lines.map(l => `· ${l}`), ...(n.stood ? [`How things stood: ${n.stood}`] : [])].join("\n"));
}

// ---------------------------------------------------------------------------------------------
// Keeping the record up to date

/** The scene's view as last seen: a summons moves the seat on to the next scene as this one ends, and the record wants this one's last rows. */
interface Seen { view(): SceneView | undefined; stop(): void }

function lastSeen(conn: Backend, sceneRow: string): Seen {
  let last = conn.view()?.sceneId === sceneRow ? conn.view() : undefined;
  const stop = conn.onChange(() => {
    const view = conn.view();
    if (view?.sceneId === sceneRow) last = view;
  });
  return { view: () => last, stop };
}

/** The record's entries brought up to date from the scene's view. */
function upToDate(record: GameRecord, view: SceneView | undefined): void {
  if (view) record.entries = mergeEntries(record.entries, entriesOf(view));
}

/** For transcript: the record brought up to date from the stack, the scene's end noted. */
async function syncFromStack(config: LoopConfig, record: GameRecord, deps: PlayDeps): Promise<void> {
  const conn = await deps.connect(record.stack, { runs: roundDir(config, record.round), name: record.game });
  try {
    const view = conn.view()?.sceneId === record.sceneRow ? conn.view() : undefined;
    upToDate(record, view);
    noteTheEnd(record, view);
  } finally {
    conn.close();
  }
}

// ---------------------------------------------------------------------------------------------

/** The game the session is seated in, by its number. */
const seatOf = (conn: Backend) => (conn.home().seat ? String(conn.home().seat!.gameId) : undefined);
const begun = (conn: Backend) => conn.explore() !== undefined || conn.view() !== undefined || conn.home().seat?.sceneId !== undefined;
const buildOf = (conn: Backend) => (conn.home().sheet?.build ? { build: conn.home().sheet!.build } : {});
const patienceOf = (deps: PlayDeps, waits: Wait[]): Patience => ({ sleep: deps.sleep, now: deps.now, waits, ...(deps.backoff ? { backoff: deps.backoff } : {}) });
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function waitLogged(patience: Patience, why: string, ms: number): Promise<void> {
  patience.waits.push({ at: patience.now().toISOString(), why, ms });
  await patience.sleep(ms);
}
