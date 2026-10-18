// New (the fixes from QA round qa1-1018): the two-part GM's co-GM replayed on a round's own games, with the code as it is now.
import { coGm } from "../../ai/gm/two-part.ts";
import type { TurnView } from "../../ai/gm/view.ts";
import type { CallContext } from "../../ai/llm/openrouter.ts";
import { initialGm, type GmState } from "../../shared/gm/state.ts";
import { BANDS, type Band } from "../../shared/gm/two-part.ts";
import type { CoGmAnswer, TurnCheck } from "../../shared/protocol/ai.ts";
import { reachedOf, takeRoute, type RouteOutcome } from "../../shared/scene/beats.ts";
import type { Scene } from "../../shared/scene/types.ts";

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
