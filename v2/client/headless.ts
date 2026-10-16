// After the prototype's src/cli/qa.ts at 44c6d4a: the same verbs and the same MODE: and PHASE: output, as a client of the simulation.
import { refusal } from "../shared/protocol/refusals.ts";
import { viewWhen, type Backend, type NewGame, type Rejection } from "./backend.ts";
import { phaseLine, render, viewText } from "./scene/text.ts";
import type { SceneView } from "./scene/view.ts";

/**
 * The game without a screen, for an agent or a QA run to play (v0-design §7): start a game, watch
 * one, observe the scene, say a line and see what came of it, carry a failed turn on, read the
 * whole transcript. Each verb prints from the same view model the screen draws, so what the agent
 * reads is what the player sees, and answers with the process's exit code: 0, or 1 when the move
 * was refused or the turn failed. hosts/play.ts reads the arguments and runs one verb a process.
 */

/** Where a verb's words go: the answer (stdout), and progress while it waits (stderr). */
export interface Out {
  print(text: string): void;
  progress(text: string): void;
}

/** How long a verb waits for the GM: a turn's four steps have a minute each at most, with the retries on top. */
export const TURN_MS = 180_000;
/** How long it waits for the rows a move made (they come with its commit, in milliseconds). */
const ROWS_MS = 10_000;

export interface Waiting { settled?: boolean; stream?: boolean; ms?: number }

/** A new game: the opening played, then the scene as the player sees it. */
export async function newGame(game: Backend, args: NewGame, out: Out, waiting: Waiting = {}): Promise<number> {
  const before = game.view()?.game;
  const refused = await game.newGame(args);
  if (refused) return said(out, refused);

  // The new game's scene (a session already in a game moves to the new one), once its opening is over.
  const stream = streamTo(out, waiting);
  const opened = await viewWhen(game, v => v.game !== before && (v.phase === "failed" || v.mayType || v.over), waiting.ms ?? TURN_MS, stream.see);
  stream.end(opened);
  out.print(viewText(opened));
  out.print(`\nGame ${opened.game}. Another terminal can watch it: npm run play -- join --session <name> --game ${opened.game}`);
  return opened.phase === "failed" ? 1 : 0;
}

/** Watching someone else's game: its scene as they see it. */
export async function joinGame(game: Backend, id: bigint, out: Out): Promise<number> {
  const refused = await game.joinGame(id);
  if (refused) return said(out, refused);

  const view = await viewWhen(game, v => v.game === String(id), ROWS_MS);
  out.print(viewText(view));
  return 0;
}

/** The scene as the player sees it, and whose turn it is. */
export function observe(game: Backend, out: Out): number {
  const view = game.view();
  if (!view) return notInGame(out);
  out.print(viewText(view));
  return 0;
}

/** Everything said in the scene so far, under its title and hook. */
export function transcript(game: Backend, out: Out): number {
  const view = game.view();
  if (!view) return notInGame(out);
  out.print(`MODE: transcript\n\n[${view.title}]\n\n${view.hook ? `${view.hook}\n\n` : ""}${render(view, view.entries)}`);
  return 0;
}

/**
 * A line said: refused (nothing happened), or its turn played until the reply is final (settling:
 * the world settles behind it) or, with `settled`, done; then what answered it and the phase.
 */
export async function say(game: Backend, text: string, out: Out, waiting: Waiting = {}): Promise<number> {
  if (!game.view()) return notInGame(out);
  const refused = await game.say(text);
  if (refused) return said(out, refused);

  return await answered(game, out, waiting);
}

/** A failed turn carried on from where it got to, and played out like a line said. */
export async function retry(game: Backend, out: Out, waiting: Waiting = {}): Promise<number> {
  if (!game.view()) return notInGame(out);
  const refused = await game.retry();
  if (refused) return said(out, refused);

  return await answered(game, out, waiting);
}

/** Waits for the turn in flight to answer, then prints what answered it (not the line itself) and the phase. */
async function answered(game: Backend, out: Out, waiting: Waiting): Promise<number> {
  const turn = game.view()?.turn;
  const stream = streamTo(out, waiting);
  const after = await viewWhen(game, v => finished(v, waiting.settled ?? false), waiting.ms ?? TURN_MS, stream.see);
  stream.end(after);
  const answer = after.entries.filter(e => e.turn === turn && e.kind !== "player");
  if (answer.length) out.print(render(after, answer));
  out.print(`\n${phaseLine(after)}`);
  return after.phase === "failed" ? 1 : 0;
}

/** The turn has answered: the reply is final (or, settled, the world too), it failed, or the scene ended. */
function finished(view: SceneView, settled: boolean): boolean {
  if (view.phase === "failed" || view.over) return true;
  return settled ? view.phase === "done" : view.phase === "settling" || view.phase === "done";
}

/** A move refused: its words, and exit code 1. A failed turn's words name the screen's /retry: this client's way is the retry verb. */
function said(out: Out, why: Rejection): number {
  out.print(why.text);
  if (why.code === "turn_failed") out.print("Carry it on: npm run play -- retry --session <name>.");
  return 1;
}

/** No game for this session: the simulation's words, then the verbs that start or watch one. */
function notInGame(out: Out): number {
  said(out, refusal("not_in_game"));
  out.print('Start one: npm run play -- new --session <name> --as "Name: concept". Watch one: npm run play -- join --session <name> --game <n>.');
  return 1;
}

/**
 * With `stream`, the reply as it's written goes to stderr (`see` each view): the words as they
 * come, and a fresh start when a reply is written again after the AI service lost it. `end` writes
 * what the reply's entry has that no draft showed (the last draft can come with the entry, its
 * words never seen in a draft), and ends the line.
 */
function streamTo(out: Out, waiting: Waiting): { see?: (view: SceneView) => void; end(view: SceneView): void } {
  if (!waiting.stream) return { end: () => {} };
  let shown = "";
  let attempt = 0;
  const show = (text: string) => {
    out.progress(text.startsWith(shown) ? text.slice(shown.length) : `\n${text}`);
    shown = text;
  };
  const see = (view: SceneView) => {
    const draft = view.draft;
    if (!draft) return;
    if (draft.attempt !== attempt) {
      out.progress(`${attempt ? "\n" : ""}[${draft.attempt > 1 ? `attempt ${draft.attempt}: ` : ""}${draft.name ?? "the GM"}] `);
      attempt = draft.attempt;
      shown = "";
    }
    show(draft.text);
  };
  const end = (view: SceneView) => {
    if (!attempt) return;
    const reply = view.entries.findLast(e => e.turn === view.turn && (e.kind === "narration" || e.kind === "dialogue"));
    if (reply) show(reply.text);
    out.progress("\n\n");
  };
  return { see, end };
}
