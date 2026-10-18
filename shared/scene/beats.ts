// New (M2): where a scene of the scene format is (docs/scene-format.md "What it means in play", docs/two-part-design.md "Where the scene is").
import type { GmState } from "../gm/state.ts";
import type { Beat, Character, Exit, Scene, SceneRoute } from "./types.ts";

/**
 * Where the scene is, as pure functions of the scene (load.ts sceneOf) and the GM's bookkeeping:
 * the nodes it has reached (its start, then each a route took it to), its stage, the discoveries
 * still to make, the routes open now, and a route taken. The simulation's commits and the AI
 * service's answers to the co-GM's moves run the same code, so the two always agree; each takes the
 * state it's handed and returns a new one, never changing what it was given.
 */

/** How a move came out: a dice route's success or failure; none for a route with no dice. */
export type RouteOutcome = "success" | "failure" | "none";

/** What the bookkeeping these read: the nodes reached, the stage (which stands for them in a state from before them), and the fights already fought. */
type Where = Pick<GmState, "reached" | "beat"> & Partial<Pick<GmState, "fought">>;

/** The nodes the scene has reached, in order, its start first. A state with none (from before M2) has its stage alone. */
export function reachedOf(gm: Where): string[] {
  return gm.reached?.length ? gm.reached : [gm.beat];
}

/** A discovery: a beat with a revelation, something the player can come to understand. */
export const isDiscovery = (beat: Beat) => beat.revelation !== undefined;

/** An event: a beat that's neither the start nor a discovery, a turn the scene takes. */
export const isEvent = (scene: Pick<Scene, "start">, beat: Beat) => beat.id !== scene.start && !isDiscovery(beat);

/** The stage: the latest reached of the start and the event beats. Its cast notes are the suggested roles, its pressure what the world does when the scene stalls. */
export function stageOf(scene: Scene, gm: Where): Beat {
  const reached = reachedOf(gm);
  for (let i = reached.length - 1; i >= 0; i--) {
    const beat = scene.beats.find(b => b.id === reached[i]);
    if (beat && !isDiscovery(beat)) return beat;
  }
  const start = scene.beats.find(b => b.id === scene.start);
  if (!start) throw new Error(`Scene ${scene.id}: its start ${scene.start} isn't one of its beats`);
  return start;
}

/** The targets: the discoveries not yet reached, each with its paths, which the GM steers towards through the people's roles. */
export function targetsOf(scene: Scene, gm: Where): Beat[] {
  const reached = new Set(reachedOf(gm));
  return scene.beats.filter(b => isDiscovery(b) && !reached.has(b.id));
}

/** The ending the scene has reached, if it has: it closes on the next reply (which may wait once). */
export function endingOf(scene: Scene, gm: Where): Exit | undefined {
  const reached = new Set(reachedOf(gm));
  return scene.exits.find(e => reached.has(e.id));
}

/**
 * The open routes: those whose source is reached, whose target isn't, and every beat of whose
 * `requires` is. The start is always reached, so its routes are open all scene long. Once an ending
 * is reached, nothing is: the scene is closing. A fight already fought (the scene picked up after
 * it: story/fight.ts) isn't offered again.
 */
export function openRoutes(scene: Scene, gm: Where): SceneRoute[] {
  if (endingOf(scene, gm)) return [];
  const reached = new Set(reachedOf(gm));
  return scene.routes.filter(r => reached.has(r.source) && !reached.has(r.target) && !gm.fought?.includes(r.target) && (r.requires ?? []).every(b => reached.has(b)));
}

/**
 * The turn each node the scene has reached was reached on: the turn whose reply the move into it
 * followed (takeRoute's path steps), and the start the opening's, 0. A node reached in a state from
 * before the path kept its moves has none.
 */
export function reachedTurns(gm: Where & Pick<GmState, "path">): Map<string, number> {
  const reached = reachedOf(gm);
  const turns = new Map<string, number>([[reached[0]!, 0]]);
  for (const step of gm.path) if (step.to !== step.from && reached.includes(step.to) && !turns.has(step.to)) turns.set(step.to, step.turn);
  return turns;
}

/**
 * One count of a cue's outer limit as it stands: its exchanges and the beat it counts after; `next`,
 * which exchange of it the next reply is (none while its beat isn't reached), and the turn that beat
 * was reached on; `stopped`, the beat of its `until` that stopped it.
 */
export interface LimitCount { exchanges: number; after?: string; reachedOn?: number; next?: number; stopped?: string }

/**
 * A cue's outer limit after the reply to `turn`, for the co-GM: how far each count has run, and
 * whether the cue is overdue, a count still running having reached its exchanges with the next
 * reply (so the move made now shows in time). A count runs from the opening, which is reply 0, or
 * from the reply after its beat was reached (an event shows in the next reply); the eleventh bell's
 * "fifteen into the scene" is overdue after reply 14, and rings in reply 15. None for a route that
 * isn't a cue or has no limit.
 */
export function limitOf(route: SceneRoute, gm: Where & Pick<GmState, "path">, turn: number): { counts: LimitCount[]; overdue: boolean } | undefined {
  if (route.phase !== "cue" || !route.limit?.length) return undefined;
  const turns = reachedTurns(gm);
  const counts = route.limit.map((l): LimitCount => {
    const stopped = l.until?.find(u => turns.has(u));
    const reachedOn = l.after ? turns.get(l.after) : undefined;
    const from = l.after ? (reachedOn === undefined ? undefined : reachedOn + 1) : 0;
    return { exchanges: l.exchanges, ...(l.after ? { after: l.after } : {}), ...(reachedOn !== undefined ? { reachedOn } : {}), ...(from !== undefined ? { next: turn + 1 - from } : {}), ...(stopped ? { stopped } : {}) };
  });
  return { counts, overdue: counts.some(c => c.next !== undefined && !c.stopped && c.next >= c.exchanges) };
}

/** Who arrives when the scene reaches a node: the cast whose `enters` it is (an event beat's people). */
export function enteringAt(scene: Pick<Scene, "cast">, node: string): Character[] {
  return scene.cast.filter(c => c.enters === node);
}

/**
 * Whether a way into one of the scene's endings requires a discovery (the clerk's murder and Hobb).
 * One whose revelation names someone of the story's other scenes is a lead to them (the clerk's Hobb,
 * whom the story goes on to find), reached only once that name has been said (ai/gm/two-part.ts).
 */
export const endingNeeds = (scene: Pick<Scene, "routes" | "exits">, beat: Beat) => scene.routes.some(r => r.requires?.includes(beat.id) && scene.exits.some(e => e.id === r.target));

/** A path step's `via` for a lead whose name is owed: "owed:hobb". */
const OWED = "owed:";

/**
 * A lead's name owed (QA round qa3-1018, H6 and H7: the co-GM took the clerk's Hobb lead on a
 * description, or waited on a sergeant who never named him, and the name came first in the closing,
 * or never): a step on the path that moves nothing, from the stage to itself (as the rules' and the
 * reactions' are), on the turn the co-GM's move into it was refused for a name nobody had said. Once:
 * a lead already owed, or reached, is as it was. Both sides take it, as they take a route.
 */
export function oweName(scene: Scene, gm: GmState, beat: string, turn: number): GmState {
  if (reachedOf(gm).includes(beat) || owedLeads(gm).includes(beat)) return gm;
  const stage = stageOf(scene, gm).id;
  return { ...gm, path: [...gm.path, { turn, from: stage, to: stage, via: `${OWED}${beat}`, source: "post" }] };
}

/** The leads whose names are owed, in the order they came to be (oweName's steps), reached or not. */
export const owedLeads = (gm: Pick<GmState, "path">): string[] => gm.path.filter(p => p.via.startsWith(OWED)).map(p => p.via.slice(OWED.length));

/** A move made (`reached`: the node it took the scene to, none when a check failed with nowhere to go), or why it can't be made. */
export type Taken = { gm: GmState; reached?: string } | { error: string };

/**
 * A route taken, as the co-GM's move_scene asks it (`turn`: the turn whose reply it follows). It must
 * be open. A route with dice is taken on its check's outcome: success to its target, failure to its
 * `onFailure`, or nowhere (the scene stays where it is); it refuses `none`. One without dice is taken
 * with `none` (or `success`), and refuses `failure`: then it hasn't happened. Taking it:
 * - adds the node it goes to to the nodes reached;
 * - settles the route's facts (on a success) and the node's, as their sentences, and marks a beat
 *   the rest of the story needs (`carry`) as come across (`landed`: it's owed no more);
 * - moves the stage to an event beat (its arrivals are enteringAt's);
 * - sets `closing` for an ending.
 * Each move is a step on the path, from the stage. The error names the open routes.
 */
export function takeRoute(scene: Scene, gm: GmState, routeId: string, outcome: RouteOutcome, turn: number): Taken {
  const ending = endingOf(scene, gm);
  if (ending) return { error: `The scene has reached its ending, ${ending.title} [${ending.id}]: it closes on the next reply, and no route is open.` };
  const open = openRoutes(scene, gm);
  const route = scene.routes.find(r => r.id === routeId);
  if (!route) return { error: `There's no route [${routeId}] in this scene. ${openList(scene, open)}` };
  if (!open.includes(route)) return { error: `[${route.id}] isn't open: ${whyShut(scene, gm, route)}. ${openList(scene, open)}` };
  if (route.skill && outcome === "none") return { error: `[${route.id}] is decided by dice (${route.skill} DC ${route.dc}): move it on the check's outcome, success or failure.` };
  if (!route.skill && outcome === "failure") return { error: `[${route.id}] has no dice: take it (outcome none) once it has happened, or leave it.` };

  const next: GmState = { ...gm, reached: [...reachedOf(gm)], established: [...gm.established], landed: [...gm.landed], path: [...gm.path] };
  const from = stageOf(scene, gm).id;
  const known = gm.established.length;
  const failed = outcome === "failure";
  const to = failed ? route.onFailure : route.target;
  if (!to || next.reached.includes(to)) {
    next.path.push({ turn, from, to: from, via: route.id, source: "post", known });
    return { gm: next };
  }
  if (!failed) settle(scene, next, route.establishes);
  next.reached.push(to);
  const beat = scene.beats.find(b => b.id === to);
  if (beat) {
    settle(scene, next, beat.establishes);
    if (beat.carry && !next.landed.includes(beat.id)) next.landed.push(beat.id);
    if (isEvent(scene, beat)) { next.beat = beat.id; next.turnsInBeat = 0; }
  } else if (scene.exits.some(e => e.id === to)) {
    next.closing = { exitId: to, turn };
  }
  next.path.push({ turn, from, to, via: route.id, source: "post", known });
  return { gm: next, reached: to };
}

/**
 * Every discovery the scene can still reach from where it is, reached, as a thorough player's game
 * would have them by its end (the owner's end_scene for QA, `thorough`): an open route into a
 * discovery not yet reached taken with takeRoute, in the scene's order (a dice route on its
 * success), again until none is left, so each is added, its facts settled and a carried one landed.
 * No event or ending is taken, so the stage stays and a discovery whose routes all leave from an
 * event not reached isn't reached. The new state, and the discoveries reached, in order.
 */
export function reachDiscoveries(scene: Scene, gm: GmState, turn: number): { gm: GmState; reached: string[] } {
  const reached: string[] = [];
  const intoDiscovery = (r: SceneRoute) => scene.beats.some(b => b.id === r.target && isDiscovery(b));
  let route = openRoutes(scene, gm).find(intoDiscovery);
  while (route) {
    const taken = takeRoute(scene, gm, route.id, route.skill ? "success" : "none", turn);
    if ("error" in taken || !taken.reached) break;
    gm = taken.gm;
    reached.push(taken.reached);
    route = openRoutes(scene, gm).find(intoDiscovery);
  }
  return { gm, reached };
}

/** Facts settled, as the sentences the GM is told (the scene's `facts`), each once. */
function settle(scene: Scene, gm: GmState, facts: string[] | undefined): void {
  for (const id of facts ?? []) {
    const sentence = scene.facts?.[id] ?? id;
    if (!gm.established.includes(sentence)) gm.established.push(sentence);
  }
}

/** A node's title, by its id. */
function titleOf(scene: Scene, id: string): string {
  return scene.beats.find(b => b.id === id)?.title ?? scene.exits.find(e => e.id === id)?.title ?? id;
}

/** Why a route isn't open: its source not reached, its target reached already, or what it requires not reached yet. */
function whyShut(scene: Scene, gm: Where, route: SceneRoute): string {
  const reached = new Set(reachedOf(gm));
  if (!reached.has(route.source)) return `it leaves from ${titleOf(scene, route.source)} [${route.source}], which the scene hasn't reached`;
  if (reached.has(route.target)) return `it goes to ${titleOf(scene, route.target)} [${route.target}], which the scene has reached already`;
  if (gm.fought?.includes(route.target)) return `it goes to ${titleOf(scene, route.target)} [${route.target}], a fight already fought`;
  const missing = (route.requires ?? []).filter(b => !reached.has(b));
  return `it requires ${missing.map(b => `${titleOf(scene, b)} [${b}]`).join(" and ")}, not reached yet`;
}

/** The open routes in a line: each with its name, where it goes, and its dice or that it's a cue. */
function openList(scene: Scene, open: SceneRoute[]): string {
  if (!open.length) return "No route is open.";
  return `The open routes: ${open.map(r => `[${r.id}] ${r.label} (to ${titleOf(scene, r.target)}${r.skill ? `; ${r.skill} DC ${r.dc}` : ""}${r.phase === "cue" ? "; a cue" : ""})`).join("; ")}.`;
}
