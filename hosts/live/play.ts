import { newGameOf } from "../../client/backend.ts";
import type { Connection } from "../../client/net/connection.ts";
import type { Game, Transcript, Turn } from "../../client/module_bindings/types.ts";
import { picked, stepName, type Script, type Step } from "./scripts.ts";

/**
 * Playing a live run's script as a player would: a new game (on the campaign's map, its scene opened
 * by talking to Kell, map-design §4), then each line said once the turn before it is done and its
 * lines are in (at most 15 s more, v5-design §4.6), or a suggested line picked as the
 * headless `act` picks one. A line that waits for the background (full-gm-design §1.2) is said once
 * the memory review and the co-GM are done too, and a script that records the GM's side waits for
 * them after its last line. It stops before a line the budget can't cover, when the scene ends, or
 * when a turn fails, and says why.
 */

/** A suggested line, as its row has it. */
export interface Offered { turn: number; ord: number; kind: string; text: string }

export interface PlayOptions {
  who: string;
  build: string;
  /** How many of the script's steps to play. */
  lines: number;
  budget: number;
  /** The game's spend so far, and its dearest turn, in dollars (the call log's). */
  spent(uid: string): { total: number; dearest: number };
  /** The scene's suggested lines now (one set a scene). */
  offered(sceneId: bigint): Promise<Offered[]>;
  /** The scene's background jobs in flight (the memory reviews, the co-GM), as "remember t1"; none when there are none. */
  background?(sceneId: bigint): Promise<string[]>;
  /** Each turn as it's done. */
  log(line: string): void;
}

/** What a step came to: the turn it played and the line said, or why it said nothing; how long it waited for the background jobs first. */
export interface Played { step: string; n?: number; said?: string; skipped?: string; waitedMs?: number }

/** When each turn's parts reached this client (Date.now()): its reply's entry, its lines' commit. */
export interface Seen { final?: number; lines?: number }

/** How a game begun on the map came into its scene: where the walker stood, the move, what it said, and how long it took to the seat in the scene. */
export interface WalkedIn { from: string; move: string; said: string; ms: number }

/** The run as played: its game, the steps, each turn's moments, every set of lines as it landed (by turn), and why it stopped early. */
export interface Run {
  /** Once the opening's rows are in: the game's id and uid, and its scene's id. */
  game?: { id: bigint; uid: string; sceneId: bigint };
  /** The way into the scene, when the game began on the map. */
  walkedIn?: WalkedIn;
  played: Played[];
  /** How long the run waited after its last line for the background jobs (a script that records the GM's side). */
  settledMs?: number;
  seen: Map<number, Seen>;
  sets: Map<number, Offered[]>;
  /** The place as this client's rows had it once each turn was done (a script that records the world's side): each thing and person, and its states. */
  worlds: Map<number, WorldThing[]>;
  stopped?: string;
}

/** A thing or person in the place, as the client's world rebuilt from the rows has it. */
export interface WorldThing { id: string; name: string; states: string[] }

/** How long a turn may take to be done, and then its lines to come. */
const TURN_MS = 180_000, EXTRAS_MS = 15_000;
/** How long a line waits for the background jobs: their endpoints' 170 s, and a little. */
const BACKGROUND_MS = 180_000;

/** A set of lines no longer on its way: the job's commit, or its giving up. */
const LINES_IN = ["landed", "dropped", "lost"];

export async function playScript(conn: Connection, script: Script, options: PlayOptions): Promise<Run> {
  const run: Run = { played: [], seen: new Map(), sets: new Map(), worlds: new Map() };
  const unwatch = watch(conn, run.seen);
  try {
    await opening(conn, run, options);
    for (const step of script.steps.slice(0, options.lines)) {
      const why = stopBefore(conn, run, options);
      if (why) { run.stopped = why; break; }
      run.played.push(await playStep(conn, step, run, options));
    }
    if (script.gmSide) run.settledMs = await backgroundDone(run, options, "after the last line");
  } catch (e) {
    run.stopped = (e as Error).message;
  } finally {
    unwatch();
  }
  return run;
}

// ---------------------------------------------------------------------------------------------
// The steps.

async function opening(conn: Connection, run: Run, options: PlayOptions): Promise<void> {
  const refused = await conn.newGame(newGameOf(options.who, options.build, "caerwyn"));
  if (refused) throw new Error(`new_game was refused: ${refused.text}`);
  await until(conn, () => !!conn.rows() || !!conn.explore(), TURN_MS, "the new game's rows didn't come");
  if (!conn.rows()) {
    run.walkedIn = await talkToKell(conn);
    options.log(`on the map: ${run.walkedIn.move} from ${run.walkedIn.from}: "${run.walkedIn.said}" (${run.walkedIn.ms} ms to the scene)`);
  }
  await until(conn, () => !!conn.rows(), TURN_MS, "the scene's rows didn't come");
  const rows = conn.rows()!;
  run.game = { id: rows.game.id, uid: (rows.game as Game).uid, sceneId: rows.scene.id };
  await afterTurn(conn, 0, run, options);
  options.log(`the opening: game ${rows.game.id}${extrasNote(conn, 0)}`);
}

/** A game begun on the map, in the granary lane: Kell talked to (interact talk kell), which opens the hanged clerk, as the plan's live run opens it. */
async function talkToKell(conn: Connection): Promise<WalkedIn> {
  const lane = conn.explore()!;
  const from = `${lane.ex.map} (${lane.ex.at.x},${lane.ex.at.y})`;
  const started = Date.now();
  const refused = await conn.interact({ verb: "talk", target: "kell" });
  if (refused) throw new Error(`talking to Kell was refused: ${refused.text}`);
  await until(conn, () => conn.home().seat?.sceneId !== undefined && conn.explore()?.ex.scene !== undefined, 10_000, "talking to Kell opened no scene");
  return { from, move: "talk_kell", said: conn.explore()!.said, ms: Date.now() - started };
}

/** A step: its line said (or the suggested line it picks), then its turn waited for. */
async function playStep(conn: Connection, step: Step, run: Run, options: PlayOptions): Promise<Played> {
  const name = stepName(step);
  const text = "say" in step ? step.say : picked(step.act, await latestSet(conn, options))?.text;
  if (text === undefined) {
    options.log(`${name}: skipped, no suggested line to pick`);
    return { step: name, skipped: `no suggested line to pick after turn ${latest(conn)?.n ?? 0}` };
  }
  const waitedMs = "say" in step && step.wait === "background" ? await backgroundDone(run, options, `before "${text}"`) : undefined;
  const n = (latest(conn)?.n ?? 0) + 1;
  const refused = await conn.say(text);
  if (refused) throw new Error(`"${text}" was refused: ${refused.text}`);
  await afterTurn(conn, n, run, options);
  options.log(`turn ${n}: done${extrasNote(conn, n)} ($${options.spent(run.game!.uid).total.toFixed(4)} so far)`);
  return { step: name, n, said: text, ...(waitedMs !== undefined ? { waitedMs } : {}) };
}

/**
 * The scene's background jobs done (the memory reviews, the co-GM), as a tester reading the reply
 * waits for them: how long it took. After BACKGROUND_MS it goes on without them, and says so.
 */
async function backgroundDone(run: Run, options: PlayOptions, when: string): Promise<number> {
  const started = Date.now();
  if (!options.background) return 0;
  for (let busy = await options.background(run.game!.sceneId); busy.length; busy = await options.background(run.game!.sceneId)) {
    if (Date.now() - started > BACKGROUND_MS) {
      options.log(`${when}: the background jobs weren't done in ${BACKGROUND_MS / 1000} s (${busy.join(", ")}): going on without them`);
      return Date.now() - started;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const waited = Date.now() - started;
  options.log(`${when}: the background jobs are done (${(waited / 1000).toFixed(1)} s)`);
  return waited;
}

/**
 * A turn done, then its lines in (or given up waiting for), and its set of lines kept as it
 * landed: the scene holds one set, which the next reply's replaces.
 */
async function afterTurn(conn: Connection, n: number, run: Run, options: PlayOptions): Promise<void> {
  await until(conn, () => turnDone(conn, n), TURN_MS, `turn ${n} wasn't done in three minutes`);
  await until(conn, () => extrasIn(turn(conn, n)), EXTRAS_MS).catch(() => undefined);
  if (turn(conn, n)?.suggest === "landed") run.sets.set(n, await setOf(conn, n, options));
  const world = conn.view()?.place?.world;
  if (world) run.worlds.set(n, Object.values(world.entities).filter(e => e.kind !== "area" && e.kind !== "place").map(e => ({ id: e.id, name: e.name, states: [...e.states] })));
}

/** The lines offered after turn n, in order (say_1 first). */
async function setOf(conn: Connection, n: number, options: PlayOptions): Promise<Offered[]> {
  return (await options.offered(conn.rows()!.scene.id)).filter(l => l.turn === n).sort((a, b) => a.ord - b.ord);
}

/** The lines offered after the latest turn: what `act` picks from. */
const latestSet = (conn: Connection, options: PlayOptions) => setOf(conn, latest(conn)?.n ?? 0, options);

/** Why not to say another line: the scene is over, or the dearest turn so far would take the spend past the budget. */
function stopBefore(conn: Connection, run: Run, options: PlayOptions): string | undefined {
  if (conn.rows()?.scene.status === "ended") return `the scene ended after turn ${latest(conn)?.n ?? 0}`;
  const { total, dearest } = options.spent(run.game!.uid);
  if (dearest <= options.budget - total) return undefined;
  return `the dearest turn so far ($${dearest.toFixed(4)}) is more than the $${(options.budget - total).toFixed(4)} left of the budget`;
}

// ---------------------------------------------------------------------------------------------
// The rows.

/** The turn rows as the client holds them: every column, though the view's type picks only some. */
function turns(conn: Connection): Turn[] {
  return (conn.rows()?.turns ?? []) as unknown as Turn[];
}

const turn = (conn: Connection, n: number) => turns(conn).find(t => t.n === n);
const latest = (conn: Connection) => turns(conn).reduce<Turn | undefined>((a, t) => (!a || t.n > a.n ? t : a), undefined);

/** Done, or failed (which throws, with the player's words for it). */
function turnDone(conn: Connection, n: number): boolean {
  const t = turn(conn, n);
  if (t?.phase === "failed") throw new Error(`turn ${n} failed: ${t.error ?? "(no reason given)"}`);
  return t?.phase === "done";
}

/** Its lines aren't on their way. */
const extrasIn = (t: Turn | undefined) => !!t && t.suggest !== "coming";

/** ", lines landed": how the turn's lines stand. */
function extrasNote(conn: Connection, n: number): string {
  const t = turn(conn, n);
  return t ? `, lines ${t.suggest}` : "";
}

/** Resolves once `ready` holds, re-checked at every change of the rows; rejects after ms, or when `ready` throws. */
function until(conn: Connection, ready: () => boolean, ms: number, late = "timed out"): Promise<void> {
  return new Promise((resolve, reject) => {
    const look = () => {
      try {
        if (!ready()) return;
      } catch (e) {
        finish();
        return reject(e);
      }
      finish();
      resolve();
    };
    const timer = setTimeout(() => { finish(); reject(new Error(late)); }, ms);
    const stop = conn.onChange(look);
    const finish = () => { clearTimeout(timer); stop(); };
    look();
  });
}

/** Timestamps each turn's parts as their rows reach this client: the reply's entry, the lines' commit. */
function watch(conn: Connection, seen: Map<number, Seen>): () => void {
  const at = (n: number) => seen.get(n) ?? seen.set(n, {}).get(n)!;
  return conn.onEvent((table, op, row) => {
    const now = Date.now();
    if (table === "transcript" && op === "insert" && (row as Transcript).speaker === "gm") at((row as Transcript).turn).final ??= now;
    if (table !== "turn" || op === "delete") return;
    const t = row as Turn;
    if (LINES_IN.includes(t.suggest)) at(t.n).lines ??= now;
  });
}
