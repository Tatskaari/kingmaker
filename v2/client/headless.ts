// After the prototype's src/cli/qa.ts at 44c6d4a: the same verbs and the same MODE:, ACTIONS: and PHASE: output (act and suggestions as :180-227 have them), as a client of the simulation.
import { refusal } from "../shared/protocol/refusals.ts";
import { viewWhen, type Backend, type NewGame, type Rejection } from "./backend.ts";
import { actionLines, phaseLine, render, viewText } from "./scene/text.ts";
import type { SceneView } from "./scene/view.ts";

/**
 * The game without a screen, for an agent or a QA run to play (v0-design §7, v5-design §3.9):
 * start a game, watch one, observe the scene, say a line (or one of the lines suggested) and see
 * what came of it, turn the suggested lines on or off, carry a failed turn on, read the whole
 * transcript. Each verb prints from the same view model the screen draws, so what the agent reads
 * is what the player sees, and answers with the process's exit code: 0, or 1 when the move was
 * refused or the turn failed. hosts/play.ts reads the arguments and runs one verb a process.
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
/**
 * How long it waits, once a reply is in, for the notes on its marks and the lines suggested after
 * it: they come a few seconds later (2 to 4 in the prototype's runs). After that it prints what's
 * there; observe shows the rest when it comes.
 */
export const AFTER_MS = 15_000;

/** What a verb waits for: the world settled too (`settled`), the reply as it's written (`stream`); `ms` and `afterMs` bound the waits. */
export interface Waiting { settled?: boolean; stream?: boolean; ms?: number; afterMs?: number }

/** A new game: the opening played, then the scene as the player sees it. */
export async function newGame(game: Backend, args: NewGame, out: Out, waiting: Waiting = {}): Promise<number> {
  const before = game.view()?.game;
  const refused = await game.newGame(args);
  if (refused) return said(out, refused);

  // The new game's scene (a session already in a game moves to the new one), once its opening is
  // over, and its notes and the lines suggested after it are in.
  const stream = streamTo(out, waiting);
  const opening = await viewWhen(game, v => v.game !== before && (v.phase === "failed" || v.mayType || v.over), waiting.ms ?? TURN_MS, stream.see);
  stream.end();
  const opened = await afterwards(game, opening, waiting);
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
  if (!view) return said(out, refusal("not_in_game"));
  out.print(viewText(view));
  return 0;
}

/** Everything said in the scene so far. */
export function transcript(game: Backend, out: Out): number {
  const view = game.view();
  if (!view) return said(out, refusal("not_in_game"));
  out.print(`MODE: transcript\n\n[${view.title}]\n\n${render(view, view.entries)}`);
  return 0;
}

/**
 * A line said: refused (nothing happened), or its turn played until the reply is final (settling:
 * the world settles behind it) or, with `settled`, done; then what answered it and the phase.
 */
export async function say(game: Backend, text: string, out: Out, waiting: Waiting = {}): Promise<number> {
  if (!game.view()) return said(out, refusal("not_in_game"));
  const refused = await game.say(text);
  if (refused) return said(out, refused);

  return await answered(game, out, waiting);
}

/**
 * One of the lines suggested for this moment said, as if typed (`say_2` is the second, as ACTIONS:
 * lists them): refused when there's no such line. What's said comes first, since the agent didn't
 * type it; then what answered it, as for a line said.
 */
export async function act(game: Backend, id: string, out: Out, waiting: Waiting = {}): Promise<number> {
  const view = game.view();
  if (!view) return said(out, refusal("not_in_game"));
  if (view.watching) return said(out, refusal("not_controller", { name: view.watching }));
  const line = /^say_[1-9]\d*$/.test(id) ? view.suggestions[Number(id.slice(4)) - 1] : undefined;
  if (!line) { out.print(noSuchLine(id, view)); return 1; }
  const refused = await game.say(line.text);
  if (refused) return said(out, refused);

  out.print(`> ${line.text}\n`);
  return await answered(game, out, waiting);
}

/** Why there's no such line to say, and what there is. */
function noSuchLine(id: string, view: SceneView): string {
  const n = view.suggestions.length;
  const there = n > 1 ? `the choices are say_1 to say_${n}`
    : n ? "the only choice is say_1"
    : view.suggestionsOn ? "no lines are suggested just now, so say something instead"
    : "the suggested lines are off (suggestions on brings them back)";
  return `(There's no ${id} here: ${there}.)`;
}

/**
 * The suggested lines: on (the default) or off, this player's own setting, or with neither, which
 * it is. Turned on, this moment's lines are asked for at once: they're waited for, and listed.
 */
export async function suggestions(game: Backend, on: boolean | undefined, out: Out, waiting: Waiting = {}): Promise<number> {
  if (!game.view()) return said(out, refusal("not_in_game"));
  if (on !== undefined) {
    const refused = await game.setSuggestions(on);
    if (refused) return said(out, refused);
  }

  const view = on ? await linesIn(game, waiting) : game.view()!;
  out.print(`Suggested lines: ${view.suggestionsOn ? "on" : "off"}.`);
  const actions = actionLines(view);
  if (actions.length) out.print(`\n${actions.join("\n")}`);
  return 0;
}

/** A failed turn carried on from where it got to, and played out like a line said. */
export async function retry(game: Backend, out: Out, waiting: Waiting = {}): Promise<number> {
  if (!game.view()) return said(out, refusal("not_in_game"));
  const refused = await game.retry();
  if (refused) return said(out, refused);

  return await answered(game, out, waiting);
}

/**
 * Waits for the turn in flight to answer, and for the notes on its reply and the lines suggested
 * after it; then prints what answered it (not the line itself), the lines, and the phase.
 */
async function answered(game: Backend, out: Out, waiting: Waiting): Promise<number> {
  const turn = game.view()?.turn;
  const stream = streamTo(out, waiting);
  const replied = await viewWhen(game, v => finished(v, waiting.settled ?? false), waiting.ms ?? TURN_MS, stream.see);
  stream.end();
  const after = await afterwards(game, replied, waiting);
  const answer = after.entries.filter(e => e.turn === turn && e.kind !== "player");
  if (answer.length) out.print(render(after, answer));
  const actions = actionLines(after);
  if (actions.length) out.print(`\n${actions.join("\n")}`);
  out.print(`\n${phaseLine(after)}`);
  return after.phase === "failed" ? 1 : 0;
}

/** The turn has answered: the reply is final (or, settled, the world too and the notes), it failed, or the scene ended. */
function finished(view: SceneView, settled: boolean): boolean {
  if (view.phase === "failed" || view.over) return true;
  return settled ? view.phase === "done" : view.phase === "settling" || view.phase === "noting" || view.phase === "done";
}

/**
 * Once a reply is in: the notes on its marks and the lines suggested after it, waited for (at most
 * `AFTER_MS`: then the view as it is). Nothing is waited for when the turn failed or the scene ended.
 */
async function afterwards(game: Backend, view: SceneView, waiting: Waiting): Promise<SceneView> {
  if (view.phase === "failed" || view.over) return view;
  return await within(game, v => !v.notesComing && !v.suggestionsComing, waiting, view);
}

/** The setting just turned on: the lines for this moment, waited for (at most `AFTER_MS`). */
const linesIn = (game: Backend, waiting: Waiting) => within(game, v => v.suggestionsOn && !v.suggestionsComing, waiting, game.view()!);

/** The view once it says so, or as it is when `AFTER_MS` (`waiting.afterMs`) has passed. */
async function within(game: Backend, done: (view: SceneView) => boolean, waiting: Waiting, now: SceneView): Promise<SceneView> {
  return await viewWhen(game, done, waiting.afterMs ?? AFTER_MS).catch(() => game.view() ?? now);
}

/** A move refused: its words, and exit code 1. */
function said(out: Out, why: Rejection): number {
  out.print(why.text);
  return 1;
}

/**
 * With `stream`, the reply as it's written goes to stderr (`see` each view): the words as they
 * come, and a fresh start when a reply is written again after the AI service lost it; `end` ends
 * the line.
 */
function streamTo(out: Out, waiting: Waiting): { see?: (view: SceneView) => void; end(): void } {
  if (!waiting.stream) return { end: () => {} };
  let shown = "";
  let attempt = 0;
  const see = (view: SceneView) => {
    const draft = view.draft;
    if (!draft) return;
    if (draft.attempt !== attempt) {
      out.progress(`${attempt ? "\n" : ""}[${draft.attempt > 1 ? `attempt ${draft.attempt}: ` : ""}${draft.name ?? "the GM"}] `);
      attempt = draft.attempt;
      shown = "";
    }
    out.progress(draft.text.startsWith(shown) ? draft.text.slice(shown.length) : `\n${draft.text}`);
    shown = draft.text;
  };
  return { see, end: () => { if (attempt) out.progress("\n\n"); } };
}
