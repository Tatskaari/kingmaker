// New (the fixes from QA round qa1-1018): the two-part GM's co-GM replayed on a round's own games, with the code as it is now; and since QA round qa2-1018's fixes, its mouthpiece, as the round sent it and as this checkout would.
import { closingDirective, coGm, mouthpieceRules, replySchema, twoPartNow } from "../../ai/gm/two-part.ts";
import type { TurnView } from "../../ai/gm/view.ts";
import { respond, type CallContext, type Message } from "../../ai/llm/openrouter.ts";
import { initialGm, type GmState } from "../../shared/gm/state.ts";
import { BANDS, type Band } from "../../shared/gm/two-part.ts";
import type { CoGmAnswer, TurnCheck } from "../../shared/protocol/ai.ts";
import { reachedOf, takeRoute, type RouteOutcome } from "../../shared/scene/beats.ts";
import { presentCast } from "../../shared/scene/graph.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { buildWorld, joinWorld } from "../../shared/world/scene-world.ts";

/**
 * A probe of the co-GM on a round's own transcripts (calls/<game>.jsonl): for a game's turn, the
 * scene's bookkeeping as the co-GM had it then, rebuilt by taking every earlier co-GM's moves again
 * with takeRoute (the settle's count of exchanges at a stage with them), and the co-GM asked again
 * with its instructions, input and tools as coGm writes them now, its moves answered on a copy. What
 * the call log can't rebuild is the round's own, as the co-GM saw it then: the transcript and the
 * current roles in its input, and the head of its prep (the story so far, the boundary's
 * adjustments, the player) from the mouthpiece's instructions on the same turn, which are logged
 * whole (a tool loop logs the first 400 characters of its own).
 */

/** A line of a round's call log, as far as the probe reads it. */
export interface LoggedCall {
  key?: string;
  operation?: string;
  request?: { instructions?: string; input?: Array<{ role: string; content: string }> };
  calls?: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
}

/** The turn a call's key names (<uid>:s<scene>:t<n>:<step>), and its scene row. */
const turnOf = (c: LoggedCall) => Number(/:t(\d+):/.exec(c.key ?? "")?.[1] ?? NaN);
const sceneRowOf = (c: LoggedCall) => /:s(\d+):/.exec(c.key ?? "")?.[1];

/** A game's co-GM call on a turn (the one that answered), and its mouthpiece's (the reply's, logged whole). */
export function callsOn(calls: LoggedCall[], sceneRow: string, turn: number): { coGm?: LoggedCall; reply?: LoggedCall } {
  const here = calls.filter(c => c.request && sceneRowOf(c) === sceneRow && turnOf(c) === turn);
  return { coGm: here.find(c => c.operation === "two-part.co-gm" && c.calls), reply: here.find(c => c.operation === "two-part.reply") };
}

/**
 * The bookkeeping the co-GM had after the reply to `turn`, before its own moves: the scene opened
 * (its start reached, `absent` as the boundary handed on), then for each turn before, the co-GM's
 * moves that were answered (not an error) taken again in order, and the stage's count of exchanges
 * bumped when the stage stayed, as the settle commit does. A turn whose co-GM didn't answer moved
 * nothing.
 */
export function stateBefore(scene: Scene, calls: LoggedCall[], sceneRow: string, turn: number, absent: string[] = []): GmState {
  let gm: GmState = { ...initialGm(scene), absent: [...absent] };
  for (let t = 1; t < turn; t++) {
    const stage = gm.beat;
    for (const call of callsOn(calls, sceneRow, t).coGm?.calls ?? []) {
      if (call.name !== "move_scene" || String(call.result).startsWith("error")) continue;
      const outcome: RouteOutcome = call.args.outcome === "success" || call.args.outcome === "failure" ? call.args.outcome : "none";
      const taken = takeRoute(scene, gm, String(call.args.route_id), outcome, t);
      if (!("error" in taken)) gm = taken.gm;
    }
    if (gm.beat === stage && !gm.closing) gm.turnsInBeat++;
  }
  return gm;
}

/** The turn's check as the co-GM's input put it ("The GM called Athletics DC 13, and the roll came to 18: a success (minor success)."). */
export function checkOf(input: string): TurnCheck | undefined {
  const m = /# This turn's check\nThe GM called (.+?) DC (\d+), and the roll came to (-?\d+): a (success|failure) \(([a-z]+ [a-z]+)\)\./.exec(input);
  const band = m?.[5]!.replace(" ", "_") as Band | undefined;
  if (!m || !band || !BANDS.includes(band)) return undefined;
  return { skill: m[1]!.toLowerCase().replace(/ /g, "_"), dc: Number(m[2]), total: Number(m[3]), success: m[4] === "success", band };
}

/** What the logged input said of where the scene was: the ids reached, and the exchanges at its stage. */
export function loggedWhere(input: string): { reached: string[]; turnsInBeat?: number } {
  const line = /Reached so far: (.*)\./.exec(input)?.[1] ?? "";
  const at = /(?:It has been here for|at this stage for) (\d+)/.exec(input)?.[1];
  return { reached: [...line.matchAll(/\[([a-z0-9-]+)\]/g)].map(m => m[1]!), ...(at ? { turnsInBeat: Number(at) } : {}) };
}

/** `text` with its part from `start` up to `end` (the first `end` after it) as `from` has it; as it was when either hasn't it. */
export function swapped(text: string, from: string, start: string, end: string): string {
  const part = (s: string) => {
    const i = s.indexOf(start);
    const j = i < 0 ? -1 : s.indexOf(end, i + start.length);
    return j < 0 ? undefined : s.slice(i, j);
  };
  const mine = part(text), theirs = part(from);
  return mine === undefined || theirs === undefined ? text : text.replace(mine, theirs);
}

/** The co-GM's request with the round's own parts in it: the prep's head from the mouthpiece's instructions, the transcript and the roles from the co-GM's input. */
export function withRound(body: { instructions: string; input: Array<{ role?: string; content?: unknown }> }, logged: { instructions: string; input: string }): typeof body {
  const instructions = swapped(body.instructions, logged.instructions, "# Your prep for this scene:", "\n\n## Where it starts:");
  const input = body.input.map((m, i) => i === 0 && typeof m.content === "string"
    ? { ...m, content: swapped(swapped(m.content, logged.input, "# The scene so far\n\n", "\n\n# Where the scene is:"), logged.input, "# Current character roles\n\n", "\n\n# Who's on stage now") }
    : m);
  return { ...body, instructions, input };
}

/** One try: the moves the co-GM made now, the nodes they reached (taken on a copy), the roles it set, what it cost and took. */
export interface ProbeTry { moves: CoGmAnswer["moves"]; reached: string[]; roles: string[]; costUsd: number; ms: number; error?: string }

/**
 * The co-GM asked again on a game's turn: the bookkeeping rebuilt, a view of it (the round's
 * player; the transcript and roles come in from the log), and each request on its way to the model
 * given the round's own parts (`fetch`, the real one or a stand-in).
 */
export async function probeTurn(scene: Scene, calls: LoggedCall[], sceneRow: string, turn: number, game: { player: { name: string; concept: string }; absent?: string[] }, context: CallContext & { fetch: typeof fetch }): Promise<ProbeTry & { rebuilt: { reached: string[]; turnsInBeat: number }; logged: ReturnType<typeof loggedWhere> }> {
  const { coGm: was, reply } = callsOn(calls, sceneRow, turn);
  const loggedInput = was?.request?.input?.[0]?.content ?? "";
  const loggedInstructions = reply?.request?.instructions ?? "";
  if (!was || !loggedInput) throw new Error(`no co-GM call that answered on turn ${turn}`);
  if (!loggedInstructions) throw new Error(`no mouthpiece call on turn ${turn} to take the prep's head from`);
  const gm = stateBefore(scene, calls, sceneRow, turn, game.absent);
  const view = { ...gm, id: "probe", sceneId: scene.id, turn, player: { ...game.player, modifiers: {} }, memory: { opened: [] }, history: [], transcript: [], owed: [] } as unknown as TurnView;
  const send = context.fetch;
  const fetching = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = withRound(JSON.parse(String(init?.body)), { instructions: loggedInstructions, input: loggedInput });
    return send(url, { ...init, body: JSON.stringify(body) });
  }) as typeof fetch;
  const started = performance.now();
  const base = { rebuilt: { reached: reachedOf(gm), turnsInBeat: gm.turnsInBeat }, logged: loggedWhere(loggedInput) };
  try {
    const answer = await coGm(scene, view, gm, checkOf(loggedInput), { ...context, fetch: fetching });
    let state = gm;
    const reached: string[] = [];
    for (const m of answer.moves) {
      const taken = takeRoute(scene, state, m.route, m.outcome, turn);
      if ("error" in taken) continue;
      state = taken.gm;
      if (taken.reached) reached.push(taken.reached);
    }
    return { ...base, moves: answer.moves, reached, roles: Object.keys(answer.roles), costUsd: answer.costUsd, ms: performance.now() - started };
  } catch (error) {
    return { ...base, moves: [], reached: [], roles: [], costUsd: 0, ms: performance.now() - started, error: (error as Error).message };
  }
}

// ---------------------------------------------------------------------------------------------
// The mouthpiece (the fixes from QA round qa2-1018)

/**
 * A probe of the mouthpiece on a round's own transcripts: a game's reply (or closing) on a turn,
 * asked again as the round sent it ("before") or as this checkout would ("after"). After is the
 * round's request with what this checkout's code makes from the cards, the cast and the bookkeeping
 * put in its place: its rules after the user's prompt (the prompt, the prep and the cards are the
 * round's, as logged); and in the per-turn note, each part but where the scene is, what moves it on,
 * the details established, the world, the player's turn and the directives (the round's, a closing's
 * directive made again), with the round's own list of what's out of the player's sight kept in the
 * hidden part. The view those parts are made from is rebuilt: the bookkeeping from the round's co-GM
 * moves (stateBefore), the transcript from the game's record, the world from the scene's place with
 * whoever is present, the player's state from the round's note.
 */

/** A game's mouthpiece call on a turn (a reply, a closing or the opening), as logged whole. */
export function mouthpieceCall(calls: LoggedCall[], sceneRow: string, turn: number): LoggedCall | undefined {
  return calls.filter(c => c.request && sceneRowOf(c) === sceneRow && turnOf(c) === turn && /^two-part\.(reply|closing|opening)$/.test(c.operation ?? "")).at(-1);
}

/** A note's parts: the co-GM's note first (before any heading), then each "## …" part with what follows it. */
export const partsOf = (note: string): string[] => note.split(/\n\n(?=## )/);
/** A part's heading without what follows a colon or a bracket ("## Where the scene is now: Stones…" is "## Where the scene is now"). */
const headingOf = (part: string) => /^## [^\n:(]*/.exec(part)?.[0].trim();

/** The per-turn note's parts a probe keeps as the round had them. */
export const ROUNDS_PARTS = ["## Where the scene is now", "## What moves the scene on from here", "## Details established in play", "## The world right now", "## The player's turn", "## For this reply"];

const SIGHT = /\nOut of the player's sight:(?:\n- [^\n]*)*/;

/**
 * The round's per-turn note with this checkout's parts in it (`made`: twoPartNow on the rebuilt
 * view), in the order this checkout makes them: the co-GM's note before it, and the parts the round's
 * are kept of, as the round had them (one the round hadn't is left out); the hidden part with the
 * round's own list of what's out of sight; and the directives with `closing` applied to a closing's.
 */
export function splicedNote(recorded: string, made: string, closing: (directive: string) => string = d => d): string {
  const theirs = partsOf(recorded);
  const head = theirs.filter(p => !headingOf(p));
  const byHeading = new Map(theirs.filter(p => headingOf(p)).map(p => [headingOf(p)!, p]));
  const parts = partsOf(made).filter(p => headingOf(p)).flatMap(p => {
    const heading = headingOf(p)!;
    if (heading === "## For this reply") { const d = byHeading.get(heading); return d ? [closing(d)] : []; }
    if (ROUNDS_PARTS.includes(heading)) { const d = byHeading.get(heading); return d ? [d] : []; }
    if (heading === "## Hidden from the player right now") {
      const sight = SIGHT.exec(byHeading.get(heading) ?? "")?.[0] ?? "";
      const without = p.replace(SIGHT, "");
      const at = without.indexOf("\n", without.indexOf("\n") + 1);
      return [at < 0 ? without + sight : without.slice(0, at) + sight + without.slice(at)];
    }
    return [p];
  });
  // The directives come last as the round had them, whether or not this checkout made any.
  if (!parts.some(p => headingOf(p) === "## For this reply") && byHeading.has("## For this reply")) parts.push(closing(byHeading.get("## For this reply")!));
  return [...head, ...parts].join("\n\n");
}

/** What a game's record gives the rebuilt view: the player, the scenes ended on the way, who the boundary left out, and what the player saw. */
export interface PlayedGame {
  player: { name: string; concept: string };
  skipped?: Array<{ scene: string }>;
  handedOn?: { absent?: string[] };
  entries: Array<{ turn: number; kind: string; text: string; speech?: Array<{ start: number; end: number; who: string }> }>;
}

/**
 * The view a probe makes the mouthpiece's parts from on a round's turn: the bookkeeping rebuilt from
 * the round's co-GM moves, the transcript as the player saw it (who said each line by the name the
 * record has), the scenes ended on the way as played (whoever an ending of theirs has walk with the
 * player is the companion), the player's state from the round's note, and the world from the
 * scene's place with whoever is present (a group's members with their leader).
 */
export function mouthpieceView(scene: Scene, story: (id: string) => Scene | undefined, calls: LoggedCall[], sceneRow: string, turn: number, game: PlayedGame, note: string): TurnView {
  const gm = stateBefore(scene, calls, sceneRow, turn, game.handedOn?.absent ?? []);
  const id = (who: string) => (who === game.player.name ? "you" : scene.cast.find(c => c.name === who || c.called === who)?.id);
  const transcript = game.entries.filter(e => e.turn < turn || (e.turn === turn && e.kind === "player")).map(e => ({
    turn: e.turn, speaker: e.kind === "player" ? "player" : "gm", kind: e.kind, text: e.text, scene: scene.id,
    ...(e.speech?.length ? { marked: { speech: e.speech.map(s => ({ start: s.start, end: s.end, ...(id(s.who) ? { speaker: id(s.who) } : {}) })) } } : {}),
  }));
  const status = /## The player character now\n(.*?)\.(?:\s|$)/.exec(note)?.[1];
  const view = {
    ...gm, id: "probe", sceneId: scene.id, turn, player: { ...game.player, modifiers: {} }, ...(status ? { rules: { status } } : {}),
    memory: { opened: [] }, rulings: [], fought: [], owed: [], history: (game.skipped ?? []).map(s => ({ sceneId: s.scene })),
    story: { scene: story }, transcript, twoPart: { roles: {}, notes: [] },
  } as unknown as TurnView;
  if (scene.world) {
    const cast = presentCast(scene, view).map(c => ({ id: c.id, name: c.name, ...(c.members ? { members: c.members } : {}) }));
    view.world = buildWorld(scene.id, scene.world, cast, view.player);
    joinWorld(view.world, cast, 0);
  }
  return view;
}

/** A closing's directive as this checkout writes it, from the round's: its ending (by what's true there), whether it may wait, and the lines its last reply said. */
export function closingAgain(scene: Scene): (directives: string) => string {
  return directives => directives.replace(/(^|\n)((?:This reply closes the scene|The scene is ending): [^\n]*)/, (all, before: string, directive: string) => {
    const exit = scene.exits.find(e => directive.includes(e.outcome));
    if (!exit) return all;
    const said = /Said there already, so not said again(?:, in those words or others)?: (.*)$/.exec(directive)?.[1];
    return before + closingDirective(exit, /set `closes` to true/.test(directive), said ? [said] : []);
  });
}

/** One try of the mouthpiece: what it said, the check it called with its outcomes, whether a closing closed, what it cost and took. */
export interface MouthpieceTry { arm: "before" | "after"; narration: string; check?: { skill: string; dc: number; outcomes: Record<string, string> }; closes?: boolean; costUsd: number; ms: number; firstTextMs: number | null; error?: string }

/** The mouthpiece's request on a round's turn: as the round sent it ("before"), or with this checkout's rules and parts ("after"; see above). */
export function mouthpieceRequest(scene: Scene, story: (id: string) => Scene | undefined, calls: LoggedCall[], sceneRow: string, turn: number, game: PlayedGame, arm: "before" | "after"): { instructions: string; input: Message[]; mayHold: boolean } {
  const logged = mouthpieceCall(calls, sceneRow, turn)?.request;
  if (!logged?.instructions || !logged.input?.length) throw new Error(`no mouthpiece call on turn ${turn}`);
  const input = logged.input.map(m => ({ role: m.role, content: m.content })) as Message[];
  const last = input.map(m => m.role).lastIndexOf("system");
  const note = last >= 0 ? input[last]!.content : "";
  const mayHold = /set `closes` to true/.test(note);
  if (arm === "before") return { instructions: logged.instructions, input, mayHold };
  const view = mouthpieceView(scene, story, calls, sceneRow, turn, game, note);
  const cut = logged.instructions.indexOf("\n\n## How to reply");
  const instructions = `${cut < 0 ? logged.instructions : logged.instructions.slice(0, cut)}\n\n${mouthpieceRules(scene, view)}`;
  if (last >= 0) input[last] = { role: "system", content: splicedNote(note, twoPartNow(scene, view, []), closingAgain(scene)) };
  return { instructions, input, mayHold };
}

/** The mouthpiece asked again on a round's turn, on the model behind `context`. */
export async function probeMouthpiece(scene: Scene, story: (id: string) => Scene | undefined, calls: LoggedCall[], sceneRow: string, turn: number, game: PlayedGame, arm: "before" | "after", context: CallContext): Promise<MouthpieceTry> {
  const started = performance.now();
  try {
    const request = mouthpieceRequest(scene, story, calls, sceneRow, turn, game, arm);
    const result = await respond({ operation: `probe.mouthpiece.${arm}`, instructions: request.instructions, input: request.input, effort: "none", maxOutputTokens: 2500, json: { name: "reply", schema: replySchema(request.mayHold) }, calls: context });
    const out = JSON.parse(result.text) as { narration: string; check: MouthpieceTry["check"] | null; closes?: boolean };
    return { arm, narration: out.narration, ...(out.check ? { check: out.check } : {}), ...(out.closes !== undefined ? { closes: out.closes } : {}), costUsd: result.costUsd, ms: performance.now() - started, firstTextMs: result.firstTextMs };
  } catch (error) {
    return { arm, narration: "", costUsd: 0, ms: performance.now() - started, firstTextMs: null, error: (error as Error).message };
  }
}
