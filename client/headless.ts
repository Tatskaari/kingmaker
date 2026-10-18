// After the prototype's src/cli/qa.ts at 44c6d4a: the same verbs and the same MODE:, ACTIONS: and PHASE: output (act and suggestions as :180-227 have them), as a client of the simulation; builds and new's creation are its :34-39, :55-78 and :112-176 (offerFor, offerText, the new verb), through the moves; map is its :230-234, the scene's place from its rows; end is its :203-215, through end_scene as the dev stack's owner, and go, journal and act's go_to_lead, fight and carry_on take the story on between scenes (story-design §4.5); on the map between scenes (map-design §3.6), observe is MODE: explore (the town's observe: explore/text.ts) and act takes any of its action ids, each made as its move; and the town unit's (town-design §1.2, §3.9): the action menu's ids too (cast_fire-bolt@25,6, hide, rest_short…: observe lists the menu), talk_kell opening a talk and waiting for its greeting, and a talk's say_<n>, say_goodbye and walk_on.
import { tooLong } from "../shared/creation/story.ts";
import type { Backstory, LoreIssue, OwnBuild } from "../shared/creation/types.ts";
import { refusal } from "../shared/protocol/refusals.ts";
import { cardText, sheetText } from "../shared/rules/index.ts";
import { asciiMap } from "../shared/world/scene-world.ts";
import type { BuildOption, Offer } from "../shared/rules/types.ts";
import { OUT, moveOf, type MapMove } from "../shared/map/moves.ts";
import { FAREWELL } from "../shared/scene/talk.ts";
import { exploreWhen, homeWhen, mapMove, viewWhen, type Backend, type CreationRow, type HomeRows, type NewGame, type Rejection } from "./backend.ts";
import { timeWords } from "./creation/words.ts";
import type { ExploreView } from "./explore/rows.ts";
import { exploreText } from "./explore/text.ts";
import { jsonOf } from "./json.ts";
import { actionLines, phaseLine, render, viewText } from "./scene/text.ts";
import type { SceneView } from "./scene/view.ts";
import { sheetOf } from "./sheet/rows.ts";
import { journalText, storyText } from "./story/text.ts";
import { wayOnOf } from "./story/view.ts";
import { stageView } from "./look/stage-view.ts";
import { describe } from "./title/model.ts";

/**
 * The game without a screen, for an agent or a QA run to play (v0-design §7, v5-design §3.9,
 * v1-design §3.10): make a character (three builds, their own, or the GM's pick; a backstory checked
 * against the lore) or start one ready-made, set off, watch a game, observe it, say a line (or one
 * of the lines suggested) and see what came of it, turn the suggested lines on or off, carry a failed
 * turn on, read the whole transcript, the sheet, the player's games, carry one on or delete it. Each
 * verb prints from the same view model the screen draws, so what the agent reads is what the player
 * sees, and answers with the process's exit code: 0, or 1 when the move was refused, the GM's part
 * failed, or the turn did. hosts/play.ts reads the arguments and runs one verb a process.
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
 * How long it waits, once a reply is in, for the lines suggested after it: they come a few seconds
 * later (2 to 4 in the prototype's runs). After that it prints what's there; observe shows the rest
 * when it comes.
 */
export const AFTER_MS = 15_000;

/** What a verb waits for: the world settled too (`settled`), the reply as it's written (`stream`); `ms` and `afterMs` bound the waits. */
export interface Waiting { settled?: boolean; stream?: boolean; ms?: number; afterMs?: number }

/** A new game: on its map (map-design §3.3: it begins in the lane), or with none its opening played; then the map, or the scene, as the player sees it. */
export async function newGame(game: Backend, args: NewGame, out: Out, waiting: Waiting = {}): Promise<number> {
  const before = game.home().seat?.gameId;
  const refused = await game.newGame(args);
  if (refused) return said(out, refused);

  // The new game (a session already in a game moves to the new one): its map, or its scene once its
  // opening is over, and the lines suggested after it are in.
  return await setOff(game, id => id !== String(before), out, waiting);
}

/** Watching someone else's game: its map, or its scene, as they see it. */
export async function joinGame(game: Backend, id: bigint, out: Out): Promise<number> {
  const refused = await game.joinGame(id);
  if (refused) return said(out, refused);

  const there = await startWhen(game, g => g === String(id), () => true, ROWS_MS);
  out.print(there.map ? exploreText(there.map) : viewText(there.scene!));
  return 0;
}

/**
 * What the player sees: the title (their games) without a seat; the sheet before their game begins;
 * the map between scenes; the moment between scenes, the fight or The End once the scene is over
 * (story-design §4.5); else the scene, and whose turn it is.
 */
export function observe(game: Backend, out: Out): number {
  const rows = game.home();
  if (!rows.seat) return games(game, out);
  if (rows.seat.sceneId === undefined) {
    const map = game.explore();
    if (!map) return created(rows, out);
    out.print(exploreText(map));
    return 0;
  }
  const view = game.view();
  if (!view) return notInGame(out);
  out.print(storyText(view) ?? viewText(view));
  return 0;
}

/**
 * A game set off: on its map, printed as the QA console printed it; or, with no map, its first
 * scene once its opening is over (a failed opening's too), with the lines suggested after it.
 */
async function setOff(game: Backend, isIt: (game: string) => boolean, out: Out, waiting: Waiting): Promise<number> {
  const stream = streamTo(out, waiting);
  const first = await startWhen(game, isIt, v => v.phase === "failed" || v.mayType || v.over, waiting.ms ?? TURN_MS, stream.see);
  if (first.map) {
    out.print(exploreText(first.map));
    out.print(watchIt(first.map.game));
    return 0;
  }
  stream.end(first.scene!);
  const opened = await afterwards(game, first.scene!, waiting);
  out.print(viewText(opened));
  out.print(watchIt(opened.game));
  return opened.phase === "failed" ? 1 : 0;
}

const watchIt = (game: string) => `\nGame ${game}. Another terminal can watch it: npm run play -- join --session <name> --game ${game}`;

/**
 * A game's start as the rows bring it: its map, once someone walks it and no scene's open (`map`);
 * or its scene, once `ready` says so (`scene`). An error when `ms` pass first.
 */
function startWhen(game: Backend, isIt: (game: string) => boolean, ready: (view: SceneView) => boolean, ms: number, see?: (view: SceneView) => void): Promise<{ map?: ExploreView; scene?: SceneView }> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const scene = game.view();
      if (scene) see?.(scene);
      const map = scene ? undefined : game.explore();
      const found = scene && isIt(scene.game) && ready(scene) ? { scene } : map && isIt(map.game) && !map.ex.scene ? { map } : undefined;
      if (!found) return;
      clearTimeout(timer);
      stop();
      resolve(found);
    };
    const timer = setTimeout(() => { stop(); reject(new Error(`No answer in ${ms / 1000} s: observe again in a moment.`)); }, ms);
    const stop = game.onChange(check);
    check();
  });
}

/**
 * The scene's place, its world as the rows have it: as the player sees it (the stage from above, in
 * seven-bit characters, still), then the world from above with what's what (shared/world asciiMap,
 * the prototype's QA map). Refused when there's no scene; says so when its place's rows haven't come.
 */
export function map(game: Backend, out: Out, size: { w: number; h: number } = { w: 100, h: 30 }): number {
  const view = game.view();
  if (!view) return notInGame(out);
  const place = view.place;
  if (!place) { out.print("MODE: map\n\n(The scene's place hasn't come: its rows aren't in yet. Observe again in a moment.)"); return 1; }
  const stage = stageView(place.world, size, { t: 0, time: place.time, glyphs: "plain" });
  out.print(`MODE: map\n\n${stage?.toPlain() ?? ""}\n\n${asciiMap(place.world)}`);
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

/**
 * One of the lines suggested for this moment said, as if typed (`say_2` is the second, as ACTIONS:
 * lists them): refused when there's no such line. What's said comes first, since the agent didn't
 * type it; then what answered it, as for a line said. In a talk (town-design §3.9), say_goodbye says
 * its goodbye and walk_on walks on without a word, back to the map. Any other id is the map's
 * (mapAct): the action menu's too (cast_fire-bolt@25,6, hide, rest_short…).
 */
export async function act(game: Backend, id: string, out: Out, waiting: Waiting = {}): Promise<number> {
  const talk = game.view();
  if (talk?.talk && !talk.over && (id === "walk_on" || id === "say_goodbye")) {
    if (talk.watching) return said(out, refusal("not_controller", { name: talk.watching }));
    return id === "walk_on" ? await walkOn(game, out) : await sayChosen(game, FAREWELL, out, waiting);
  }
  const move = mapMoveOf(id);
  if (move) return await mapAct(game, move, out, waiting);
  const view = game.view();
  if (!view) return notInGame(out);
  // The way on between scenes: on to the lead, the fight's stand-in, a story that got stuck tried again.
  if (id === "go_to_lead" || id === "carry_on") return await go(game, out, waiting);
  if (id === "fight") return await fight(game, out, waiting);
  if (view.watching) return said(out, refusal("not_controller", { name: view.watching }));
  const line = /^say_[1-9]\d*$/.test(id) ? view.suggestions[Number(id.slice(4)) - 1] : undefined;
  if (!line) { out.print(noSuchLine(id, view)); return 1; }
  return await sayChosen(game, line.text, out, waiting);
}

/** A line chosen (a suggested line, a talk's goodbye): said as if typed, then, since the agent didn't type it, what was said, and what answered it. */
async function sayChosen(game: Backend, text: string, out: Out, waiting: Waiting): Promise<number> {
  const refused = await game.say(text);
  if (refused) return said(out, refused);

  out.print(`> ${text}\n`);
  return await answered(game, out, waiting);
}

/**
 * Walking on from a talk without a word (walk out of a live talk, town-design §3.2): refused in the
 * game's words (a turn in flight); else where it left the player, the map as observe prints it (with
 * what walking on said), or the talk over on screen.
 */
async function walkOn(game: Backend, out: Out): Promise<number> {
  const refused = await game.walk({ toward: OUT });
  if (refused) return said(out, refused);

  const there = await startWhen(game, () => true, v => v.over, ROWS_MS).catch(() => ({ map: game.explore(), scene: game.view() }));
  if (there.scene) { out.print(storyText(there.scene) ?? viewText(there.scene)); return 0; }
  if (there.map?.said) out.print(`${there.map.said}\n`);
  if (there.map) out.print(exploreText(there.map));
  return 0;
}

/** A map action's move: any of the QA console's ids (moveOf), and `out`, back to the map from a scene that's over (walk out has no id of its own). */
function mapMoveOf(id: string): MapMove | undefined {
  return id === "out" ? { move: "walk", args: { toward: OUT } } : moveOf(id);
}

/**
 * One of the map's actions, made as its move (map-design §3.2): refused (nothing happened), or what
 * it said, then where it left the player: the scene it opened, its opening played (as new's is), or
 * the map again, as observe prints it.
 */
async function mapAct(game: Backend, move: MapMove, out: Out, waiting: Waiting): Promise<number> {
  if (!game.home().seat) return notInGame(out);
  const before = game.explore()?.acts;
  const refused = await mapMove(game, move);
  if (refused) return said(out, refused);

  // The move's row (its words), then the seats where it left them: in the scene (or the talk) it opened, or on the map.
  const moved = before === undefined ? game.explore() : await exploreWhen(game, v => v.acts !== before, ROWS_MS).catch(() => game.explore());
  if (moved && moved.acts !== before && moved.said) out.print(`${moved.said}\n`);
  if (moved?.ex.scene || game.home().seat?.sceneId !== undefined) {
    const stream = streamTo(out, waiting);
    const opening = await viewWhen(game, v => v.phase === "failed" || v.mayType || v.over, waiting.ms ?? TURN_MS, stream.see);
    stream.end(opening);
    const opened = await afterwards(game, opening, waiting);
    out.print(viewText(opened));
    return opened.phase === "failed" ? 1 : 0;
  }
  const map = await startWhen(game, () => true, () => false, ROWS_MS).catch(() => ({ map: game.explore() }));
  if (map.map) out.print(exploreText(map.map));
  return 0;
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
  if (!game.view()) return notInGame(out);
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
  if (!game.view()) return notInGame(out);
  const refused = await game.retry();
  if (refused) return said(out, refused);

  return await answered(game, out, waiting);
}

// ---------------------------------------------------------------------------------------------
// Between scenes (story-design §4.5): the testing end, the way on, the fight's stand-in, the notebook.

/**
 * For testing (the QA console's end): the scene ends through `exit` now, as the dev stack's owner
 * (end_scene), and the story moves on; then where it stands, as observe says it (MODE: between, the
 * fight, The End, or a summons's next scene once its opening is in). With no exit, the endings.
 * `thorough` (the GM loop's): every discovery the scene can still reach is reached first, so it ends
 * as a thorough player's game would, owing none of them on.
 */
export async function end(game: Backend, exit: string | undefined, out: Out, waiting: Waiting = {}, how: { thorough?: boolean } = {}): Promise<number> {
  const view = game.view();
  if (!view) return notInGame(out);
  const refused = await game.act("endScene", { game: BigInt(view.game), exit: exit ?? "", ...(how.thorough ? { thorough: true } : {}) });
  // With no exit, the refusal is the list of the endings: the QA console's answer to end alone.
  if (refused) { out.print(refused.text); return exit ? 1 : 0; }

  const stream = streamTo(out, waiting);
  const moved = await viewWhen(game, v => movedOn(view.sceneId, v), waiting.ms ?? TURN_MS, stream.see);
  stream.end(moved);
  out.print(storyText(moved) ?? viewText(await afterwards(game, moved, waiting)));
  return moved.story?.onward === "failed" ? 1 : 0;
}

/**
 * The scene that was played has moved on: over (or its fight next) with the story done moving on
 * (the way on ready, or stuck); or the seat has gone on to the next scene (a summons), its opening in.
 */
function movedOn(before: string | undefined, view: SceneView): boolean {
  if (view.sceneId !== before) return view.phase === "failed" || view.phase === "done" || view.mayType || view.over;
  if (!view.over && !view.fighting) return false;
  return view.story?.onward !== "moving" && view.story?.onward !== "waiting";
}

/**
 * On from the scene that's over (the QA console's act --id go_to_lead): walk to the lead, whose
 * scene opens, its opening played (its lines in), then the scene; a story that got stuck
 * is tried again (carry_on), and waited for; the fight's way on is the fight's.
 */
export async function go(game: Backend, out: Out, waiting: Waiting = {}): Promise<number> {
  const view = game.view();
  if (!view) return notInGame(out);
  const way = wayOnOf(view, view.story);
  if (way?.to === "fight") return await fight(game, out, waiting);
  if (way?.to === "end") { out.print(storyText(view)!); return 0; }
  if (way?.to === "carry_on") {
    const refused = await game.act("carryOn", {});
    if (refused) return said(out, refused);
    const moved = await viewWhen(game, v => movedOn(view.sceneId, v) && v.story?.onward !== "failed", waiting.ms ?? TURN_MS);
    out.print(storyText(moved) ?? viewText(moved));
    return 0;
  }
  if (game.explore()) {
    // On a map (map-design §3.2), as the prototype's flow walks to the lead (flow.ts walkToLead):
    // go_to_lead again until the lead's scene opens, through a door or across town, six moves at most.
    const from = game.explore()!.ex.scene;
    for (let i = 0; i < 6; i++) {
      const before = game.explore()?.acts;
      const refused = await game.walk({ toward: "lead" });
      if (refused) return said(out, refused);
      const moved = await exploreWhen(game, v => v.acts !== before, ROWS_MS).catch(() => game.explore());
      if (moved?.said) out.print(`${moved.said}\n`);
      if (moved?.ex.scene && moved.ex.scene !== from) break;
    }
  } else {
    const refused = await game.act("walk", { to: undefined, toward: "lead" });
    if (refused) return said(out, refused);
  }

  // The lead's scene, its opening over, and the lines suggested after it in, as for a new game.
  const stream = streamTo(out, waiting);
  const opening = await viewWhen(game, v => v.sceneId !== view.sceneId && (v.phase === "failed" || v.mayType || v.over), waiting.ms ?? TURN_MS, stream.see);
  stream.end(opening);
  const opened = await afterwards(game, opening, waiting);
  out.print(viewText(opened));
  return opened.phase === "failed" ? 1 : 0;
}

/**
 * The fight's stand-in (act --id fight): fought out, as won (fight_it_out); then the scene picking
 * up from it (the stand-in's line and how it went, as the simulation writes them in the scene, then
 * the GM's aftermath, its lines in), as for a line said.
 */
export async function fight(game: Backend, out: Out, waiting: Waiting = {}): Promise<number> {
  const view = game.view();
  if (!view) return notInGame(out);
  if (!view.fighting) return said(out, refusal("no_fight"));
  const seen = view.entries.length;
  const refused = await game.act("fightItOut", {});
  if (refused) return said(out, refused);

  const stream = streamTo(out, waiting);
  const picked = await viewWhen(game, v => !v.fighting && v.entries.length > seen && finished(v, waiting.settled ?? false), waiting.ms ?? TURN_MS, stream.see);
  stream.end(picked);
  const after = await afterwards(game, picked, waiting);
  const answer = after.entries.slice(seen).filter(e => e.kind !== "player");
  if (answer.length) out.print(render(after, answer));
  const actions = actionLines(after);
  if (actions.length) out.print(`\n${actions.join("\n")}`);
  out.print(`\n${phaseLine(after)}`);
  return after.phase === "failed" ? 1 : 0;
}

/** The investigator's notebook, the quests, the flags and the attitudes (the journal verb). */
export function journal(game: Backend, out: Out): number {
  const view = game.view();
  if (!view) return notInGame(out);
  if (!view.story) { out.print("MODE: journal\n\nNothing yet. The notebook is new, and smells of it."); return 0; }
  out.print(journalText(view.story));
  return 0;
}

/**
 * Waits for the turn in flight to answer, and for the lines suggested after its reply; then prints what answered it (not the line itself), the lines, and the phase. A line
 * that ended the scene in a summons (the next scene came for the player as this one ended, the seat
 * with it) prints what answered it as the scene last stood, then the next scene once it's opened.
 */
async function answered(game: Backend, out: Out, waiting: Waiting): Promise<number> {
  const said = game.view();
  const turn = said?.turn, scene = said?.sceneId;
  // The scene the line was said in, as last seen: its rows go once the seat has moved on.
  let last = said;
  const stop = game.onChange(() => { const v = game.view(); if (v && v.sceneId === scene) last = v; });
  try {
    const stream = streamTo(out, waiting);
    const replied = await viewWhen(game, v => v.sceneId !== scene || finished(v, waiting.settled ?? false), waiting.ms ?? TURN_MS, stream.see);
    stream.end(replied);
    const after = await afterwards(game, replied, waiting);
    const own = after.sceneId === scene ? after : last ?? after;
    const answer = own.entries.filter(e => e.turn === turn && e.kind !== "player");
    if (answer.length) out.print(render(own, answer));
    if (after.sceneId !== scene) return await summoned(game, out, waiting);
    // A line that brought the fight on (or the story to its end): what comes next, as observe says it, as the QA console's say does.
    const next = storyText(after);
    if (next) { out.print(`\n${next}`); return 0; }
    const actions = actionLines(after);
    if (actions.length) out.print(`\n${actions.join("\n")}`);
    out.print(`\n${phaseLine(after)}`);
    return after.phase === "failed" ? 1 : 0;
  } finally {
    stop();
  }
}

/** The next scene, come for the player as the last ended (a summons): its opening over, its lines in, then the scene. */
async function summoned(game: Backend, out: Out, waiting: Waiting): Promise<number> {
  const opening = await viewWhen(game, v => v.phase === "failed" || v.mayType || v.over || (!!v.watching && v.phase === "done"), waiting.ms ?? TURN_MS);
  const opened = await afterwards(game, opening, waiting);
  out.print(`\n${viewText(opened)}`);
  return opened.phase === "failed" ? 1 : 0;
}

/**
 * The turn has answered: the reply is final (or, settled, the world too), it failed, or the scene
 * ended (a reply that closed it, once the scene has ended).
 */
function finished(view: SceneView, settled: boolean): boolean {
  if (view.phase === "failed" || view.over) return true;
  if (view.ending) return false;
  return settled ? view.phase === "done" : view.phase === "settling" || view.phase === "done";
}

/**
 * Once a reply is in: the lines suggested after it, waited for (at most `AFTER_MS`: then the view as
 * it is). Nothing is waited for when the turn failed; no lines come after a reply that ended the scene.
 */
async function afterwards(game: Backend, view: SceneView, waiting: Waiting): Promise<SceneView> {
  if (view.phase === "failed") return view;
  return await within(game, v => !v.suggestionsComing, waiting, view);
}

/** The setting just turned on: the lines for this moment, waited for (at most `AFTER_MS`). */
const linesIn = (game: Backend, waiting: Waiting) => within(game, v => v.suggestionsOn && !v.suggestionsComing, waiting, game.view()!);

/** The view once it says so, or as it is when `AFTER_MS` (`waiting.afterMs`) has passed. */
async function within(game: Backend, done: (view: SceneView) => boolean, waiting: Waiting, now: SceneView): Promise<SceneView> {
  return await viewWhen(game, done, waiting.afterMs ?? AFTER_MS).catch(() => game.view() ?? now);
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

// ---------------------------------------------------------------------------------------------
// Making a character (v1-design §3.10): the QA console's builds and new, through the moves.

/** Who to make, and how: new's arguments. `build`: a ready-made id, 1-3 (one of the three), own:<species>,<class>,<subclass>,<background>, or none (the GM picks). */
export interface NewCharacter {
  campaign: string;
  name: string;
  concept: string;
  build?: string | undefined;
  backstory?: string | undefined;
  acceptFixes?: boolean;
  /** The session, for the commands the verbs suggest. */
  session?: string | undefined;
}

/** The three builds that fit a concept, as the game offers them (play new --build takes one: the same three, if the concept is the same). */
export async function builds(game: Backend, who: NewCharacter, out: Out, waiting: Waiting = {}): Promise<number> {
  const refused = await game.act("startCreation", { campaign: who.campaign, name: who.name, concept: who.concept, how: "three" });
  if (refused) return said(out, refused);

  const offer = await offered(game, waiting);
  if (!offer.ok) return failedWith(out, offer.why);
  out.print(offerText(offer.value));
  out.print(`\n(play new --session ${who.session ?? "<name>"} --as "${who.name}: ${who.concept}" --build 1, 2 or 3 takes one; --build own:<species>,<class>,<subclass>,<background> makes your own.)`);
  return 0;
}

/**
 * A new character: a ready-made one goes straight in (V0's new_game); else made from the concept
 * (one of three builds, their own, or the GM's pick), its backstory checked against the lore (each
 * fix taken with --accept-fixes, as the screens take them; left, it stops here with the creation
 * kept), made, and set off: the opening played, then the scene as the player sees it.
 */
export async function newCharacter(game: Backend, ask: NewCharacter, out: Out, waiting: Waiting = {}): Promise<number> {
  const ready = ask.build !== undefined && !/^([123]|own:.*)$/.test(ask.build);
  if (ready && ask.backstory !== undefined) return failedWith(out, "(A ready-made character goes straight in: --backstory is for one made from a sentence, with --build 1, 2, 3 or own:…, or none.)");
  if (ready) return await newGame(game, { campaign: ask.campaign, name: ask.name, concept: ask.concept, build: ask.build! }, out, waiting);
  const long = ask.backstory ? tooLong(ask.backstory) : undefined;
  if (long) return failedWith(out, `--backstory: ${long}`);

  const how = !ask.build ? "model" : ask.build.startsWith("own:") ? ask.build : "three";
  const refused = await game.act("startCreation", { campaign: ask.campaign, name: ask.name, concept: ask.concept, how });
  if (refused) return said(out, refused);

  const chosen = await choose(game, ask.build, out, waiting);
  if (chosen) return chosen;
  const written = ask.backstory?.trim() ? await checkStory(game, ask.backstory.trim(), !!ask.acceptFixes, out, waiting) : await skipStory(game, out, waiting);
  if (written) return written;

  const made = game.home();
  out.print(`Game ${made.seat?.gameId ?? "?"}: you are ${ask.name}${made.sheet?.build ? `, ${made.sheet.build}` : ""}.\n`);
  return await begin(game, out, waiting);
}

/** Set off: on the game's map (map-design §3.3), or with none its first scene opens and its opening is played; then the map, or the scene, as the player sees it. */
export async function begin(game: Backend, out: Out, waiting: Waiting = {}): Promise<number> {
  const seat = game.home().seat;
  const refused = await game.act("begin", {});
  if (refused) return said(out, refused);

  // Its map; or its opening over, and the lines suggested after it in, as for a new game.
  return await setOff(game, id => id === String(seat?.gameId), out, waiting);
}

/** The character sheet, as text: what the engine made, with the purse and pockets. */
export function sheet(game: Backend, out: Out): number {
  const rows = game.home();
  if (!rows.seat) return said(out, refusal("not_in_game"));
  const data = sheetOf(rows.sheet);
  if (!data) return failedWith(out, "(There's no character sheet in this seat: a watcher has none of their own.)");
  out.print(sheetText(data));
  return 0;
}

/** The player's games, as the title lists them: the one played last first; and a character half made, if there is one. */
export function games(game: Backend, out: Out): number {
  const rows = game.home();
  const list = [...rows.games].sort((a, b) => Number(b.lastPlayedAt.microsSinceUnixEpoch - a.lastPlayedAt.microsSinceUnixEpoch));
  const making = rows.creation && rows.creation.step !== "made" ? rows.creation : undefined;
  out.print([
    "MODE: title",
    "",
    ...(list.length ? ["Your games, the one played last first:", ...list.map(g => `  Game ${g.gameId}. ${describe(g)}`)] : ["You have no games yet."]),
    ...(making ? ["", `Half made: ${making.name}, ${making.concept}. play new --as "${making.name}: ${making.concept}" carries it on (its builds and backstory kept).`] : []),
    "",
    `Use: ${list.length ? "play continue --game <id> carries one on; play delete --game <id> deletes one; " : ""}play new --as "Name: concept" makes a character.`,
  ].join("\n"));
  return 0;
}

/** One of the player's games carried on: its sheet if it hasn't begun, else its scene. */
export async function continueGame(game: Backend, id: bigint, out: Out): Promise<number> {
  const refused = await game.act("continueGame", { game: id });
  if (refused) return said(out, refused);

  // Its sheet before it has begun; its map once it has, between scenes; else its scene.
  const begun = (rows: HomeRows) => !!rows.games.find(g => g.gameId === id)?.begun;
  await homeWhen(game, rows => rows.seat?.gameId === id && (rows.seat.sceneId === undefined ? !!rows.sheet && (!begun(rows) || !!game.explore()) : !!game.view()), ROWS_MS);
  return observe(game, out);
}

/** One of the player's games deleted, for good; then the games left. */
export async function deleteGame(game: Backend, id: bigint, out: Out): Promise<number> {
  const refused = await game.act("deleteGame", { game: id });
  if (refused) return said(out, refused);

  await homeWhen(game, rows => !rows.games.some(g => g.gameId === id), ROWS_MS);
  out.print(`Game ${id} is deleted.\n`);
  return games(game, out);
}

// ---------------------------------------------------------------------------------------------

/** What asking the GM (or the engine) came to: the value, or why there's none (the row's note). */
type Came<T> = { ok: true; value: T } | { ok: false; why: string };

/** The three builds, once the GM's offer is in (or why it isn't). */
async function offered(game: Backend, waiting: Waiting): Promise<Came<Offer>> {
  const c = await creationWhen(game, c => c.busy !== "builds", waiting);
  const offer = jsonOf<Offer>(c?.offer);
  return offer ? { ok: true, value: offer } : { ok: false, why: c?.note ?? "(The builds didn't come.)" };
}

/** The build: one of the three (the same three, if builds offered them), their own as the engine made it, or the GM's pick. Undefined when it's chosen; else the exit code. */
async function choose(game: Backend, build: string | undefined, out: Out, waiting: Waiting): Promise<number | undefined> {
  if (!build) {
    const c = await creationWhen(game, c => c.busy !== "pick", waiting);
    return jsonOf<BuildOption>(c?.chosen) ? undefined : failedWith(out, c?.note ?? "(The GM didn't pick a build.)");
  }
  if (build.startsWith("own:")) {
    const c = await creationWhen(game, c => c.busy !== "own", waiting);
    const option = jsonOf<OwnBuild>(c?.own)?.option;
    if (!option) return failedWith(out, c?.note ?? "(The rules engine didn't make it.)");
    out.print(`Your own: ${option.line}\n${cardText(option)}\n`);
    const refused = await game.act("takeOwn", {});
    return refused ? said(out, refused) : undefined;
  }
  const offer = await offered(game, waiting);
  if (!offer.ok) return failedWith(out, offer.why);
  const n = Number(build);
  const picked = offer.value.options[n - 1];
  if (!picked) return failedWith(out, refusal("not_offered").text);
  out.print(`Build ${n} of three: ${picked.line}\n${cardText(picked)}\n`);
  const refused = await game.act("chooseBuild", { index: n - 1 });
  return refused ? said(out, refused) : undefined;
}

/**
 * The backstory checked against the lore, as the screens check it: what doesn't fit, a fix that
 * keeps its spirit for each; with --accept-fixes each fix taken, and the story with the fixes in
 * checked once more (its fixes taken too, with no third look). An issue left, or a fix whose words
 * have gone, stops it (exit 1), the creation kept. Then what the backstory says of them, and the
 * character made. Undefined when it's made; else the exit code.
 */
async function checkStory(game: Backend, story: string, accept: boolean, out: Out, waiting: Waiting): Promise<number | undefined> {
  const refused = await game.act("finishBackstory", { text: story });
  if (refused) return said(out, refused);

  // Two looks at most: the story as written, then with the fixes in; a second look's fixes go in unchecked, so a third finds none.
  for (let look = 0; ; look++) {
    const issues = await lookedAt(game, look, out, waiting);
    if (!issues.length) return await madeFrom(game, out, waiting);
    const stopped = await takeFixes(game, issues, look, accept, out);
    if (stopped !== undefined) return stopped;
  }
}

/** What a look of the lore check found: its issues, or none (and then whether it fit, or why nobody checked it). */
async function lookedAt(game: Backend, look: number, out: Out, waiting: Waiting): Promise<LoreIssue[]> {
  const c = await creationWhen(game, c => c.busy !== "check", waiting);
  const issues = jsonOf<LoreIssue[]>(c?.issues) ?? [];
  const checked = !issues.length && (c?.busy === "traits" || c?.step === "made");
  if (c?.unchecked) out.print(c.unchecked);
  else if (checked && look < 2) out.print(look ? "Backstory: with the fixes in, it fits." : "Backstory: it fits the world's lore.");
  return issues;
}

/** Each issue said, and its fix taken with --accept-fixes; the exit code when it stops here (an issue left, or a fix whose words have gone), else undefined. */
async function takeFixes(game: Backend, issues: LoreIssue[], look: number, accept: boolean, out: Out): Promise<number | undefined> {
  for (const issue of issues) {
    out.print(`Backstory${look ? " (checked again)" : ""}: "${issue.quote ?? "(the GM couldn't point at the words)"}" doesn't fit: ${issue.problem}\n  A fix that keeps its spirit: "${issue.fix}"`);
    if (!accept) { out.print("  (not changed: --accept-fixes takes the fixes)"); continue; }
    const refused = await game.act("acceptFix", {});
    if (refused) return said(out, refused);
    if (game.home().creation?.rewriting) { out.print("  (its words aren't in the backstory: rewrite it yourself)"); return failedWith(out, "\n(The creation is kept: play new again with the backstory rewritten.)"); }
    out.print("  (fixed: --accept-fixes)");
  }
  return accept ? undefined : failedWith(out, "\n(The lore check found what doesn't fit: --accept-fixes takes its fixes, or rewrite the backstory. The creation is kept.)");
}

/** No backstory: straight to the character made. */
async function skipStory(game: Backend, out: Out, waiting: Waiting): Promise<number | undefined> {
  const refused = await game.act("skipBackstory", {});
  if (refused) return said(out, refused);
  return await madeFrom(game, out, waiting);
}

/** The character made (its traits drawn from the backstory first, when there is one): who they are; undefined when it's made, else the exit code. */
async function madeFrom(game: Backend, out: Out, waiting: Waiting): Promise<number | undefined> {
  const c = await creationWhen(game, c => c.step === "made" || !c.busy, waiting);
  if (c?.step !== "made") return failedWith(out, c?.note ?? "(The character wasn't made.)");
  const backstory = jsonOf<Backstory>(c.backstory);
  if (backstory) out.print(`Who you are: ${backstory.summary}\n`);
  await homeWhen(game, rows => rows.seat?.gameId === c.gameId && !!rows.sheet?.data, ROWS_MS);
  return undefined;
}

/** The creation row once `done` says so (or once it's gone). */
async function creationWhen(game: Backend, done: (c: CreationRow) => boolean, waiting: Waiting): Promise<CreationRow | undefined> {
  const rows = await homeWhen(game, rows => !rows.creation || done(rows.creation), waiting.ms ?? TURN_MS);
  return rows.creation;
}

/** The three builds as text: why they're the class defaults when they are, then each card. */
function offerText(offer: Offer): string {
  return [...(offer.note ? [offer.note, ""] : []), ...offer.options.map((o, i) => `${i + 1}. ${cardText(o).replace(/\n/g, "\n   ")}`)].join("\n");
}

/** The sheet before the game begins: where the story starts, the sheet, and what to do. */
function created(rows: HomeRows, out: Out): number {
  const game = rows.games.find(g => g.gameId === rows.seat?.gameId);
  const data = sheetOf(rows.sheet);
  const unchecked = rows.creation?.gameId === rows.seat?.gameId ? rows.creation?.unchecked : undefined;
  out.print([
    "MODE: created",
    "",
    ...(game ? [`${timeWords(game.time)}. ${game.hook}`, ""] : []),
    ...(unchecked ? [unchecked, ""] : []),
    data ? sheetText(data) : "(The rules engine is still making the character.)",
    "",
    `Use: play begin${rows.creation?.gameId === rows.seat?.gameId ? " (or play new again: the creation is kept)" : ""}`,
  ].join("\n"));
  return 0;
}

/** Why the GM's part (or the verb) came to nothing: its words, and exit code 1. */
function failedWith(out: Out, words: string): number {
  out.print(words);
  return 1;
}
