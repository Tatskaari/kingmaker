// New (M2), in place of the loader of a scene folder (scene.json and its Markdown) copied from the scratchpad's tools/convert-hanged-clerk.mts at 44c6d4a: a .kmscene file (document.ts) as the prototype's Scene, which types.ts extends with the scene format's fields.
import { isBeat, isEnding, isStart, parseScene, type BeatData, type CastMember, type EndingData, type Route, type SceneDocument, type SceneNode, type StartData } from "./document.ts";
import { TOLD } from "./talk.ts";
import type { Beat, Character, Essential, Exit, Scene, SceneRoute, Transition } from "./types.ts";

/**
 * A scene file as the runtime's Scene, with all its words: the prototype's shape the copied GM code
 * reads, and what the scene format adds beside it (docs/scene-format.md). The start and the beats
 * are its beats, in the file's order, each with the routes that leave it as its transitions (the
 * copied code's: a route's condition is its `when`, a fact its sentence; a dice route an attempt
 * with its check; into a discovery with no condition, its revelation landing); the endings its exits;
 * the start's description its opening; every route, flat, its routes; and each beat with `carry` an
 * essential (its id the beat's, what it is its revelation, where it's placed its paths' `via`), so
 * the story's boundary and what it owes keep working. A talk (the template, with `companion`) has
 * its ways into its ending as anytime attempts, as the template's goodbye was: the player's farewell
 * is judged before the reply, whichever beat the talk is at. Its way into told (TOLD) is the talk's
 * own to give, worded for each talk from what it may bring out (ai/gm/talk.ts prepareTalk's route,
 * CONFIDED): the template's stands for it in the file, and isn't one of the beat's transitions.
 */
export function sceneOf(doc: SceneDocument): Scene {
  const start = doc.nodes.find(isStart)!;
  const facts = doc.facts ?? {};
  const nodes = new Map(doc.nodes.map(n => [n.id, n]));
  const castIds = new Set(doc.cast.map(c => c.id));
  const routes = doc.edges.map(routeOf);
  const talk = doc.companion !== undefined;
  const intoEnding = (r: SceneRoute) => nodes.get(r.target)?.data.kind === "exit";
  const toTransition = (r: SceneRoute) => transitionOfRoute(r, nodes, facts, talk && intoEnding(r));
  const leaves = (n: SceneNode, r: SceneRoute) => r.source === n.id && !(talk && (intoEnding(r) || r.target === TOLD));
  const beats = doc.nodes.filter((n): n is SceneNode<StartData | BeatData> => !isEnding(n))
    .map(n => beatOfNode(n, routes.filter(r => leaves(n, r)).map(toTransition)));
  const anytime = talk ? routes.filter(intoEnding).map(toTransition) : [];
  const essentials = doc.nodes.filter(isBeat).flatMap(n => (n.data.carry ? [essentialOf(n, castIds)] : []));

  return {
    id: doc.id, title: doc.title, ...(doc.time ? { time: doc.time } : {}), summary: doc.description,
    setting: doc.setting, premise: doc.premise, hook: doc.hook, opening: start.data.description,
    cast: doc.cast.map(characterOfMember),
    start: start.id,
    beats,
    ...(anytime.length ? { anytime } : {}),
    exits: doc.nodes.filter(isEnding).map(exitOfNode),
    ...(essentials.length ? { essentials } : {}),
    limits: [...(doc.limits ?? [])],
    lore: [...doc.lore], ...(doc.fronts ? { fronts: doc.fronts } : {}),
    ...(doc.known?.length ? { known: [...doc.known] } : {}),
    // (Every op of afterwards names what it acts on: the parse holds it to that.)
    ...(doc.afterwards?.length ? { afterwards: doc.afterwards as NonNullable<Scene["afterwards"]> } : {}),
    ...(doc.interlude ? { interlude: true } : {}),
    ...(doc.assumes?.length ? { assumes: [...doc.assumes] } : {}), ...(doc.overtaken ? { overtaken: doc.overtaken } : {}),
    ...(doc.rest ? { rest: doc.rest } : {}), ...(doc.milestone ? { milestone: true } : {}),
    ...(doc.background?.length ? { background: [...doc.background] } : {}),
    ...(doc.onEnd?.length ? { onEnd: doc.onEnd } : {}),
    ...(doc.companion ? { companion: doc.companion } : {}),
    truth: doc.truth,
    ...(doc.clock ? { clock: doc.clock } : {}),
    facts: { ...facts },
    routes,
  };
}

/** A .kmscene file's text as the runtime's Scene: parsed (a SceneFormatError naming `where` when it isn't a scene), then made one. */
export const loadScene = (text: string, where?: string): Scene => sceneOf(parseScene(text, where));

function routeOf(e: Route): SceneRoute {
  const d = e.data;
  return {
    id: e.id, source: e.source, target: e.target, label: e.label, condition: d.condition, phase: d.phase,
    ...(d.requires?.length ? { requires: [...d.requires] } : {}),
    ...(d.skill ? { skill: d.skill, dc: d.dc } : {}),
    ...(d.onFailure ? { onFailure: d.onFailure } : {}),
    ...(d.establishes?.length ? { establishes: [...d.establishes] } : {}),
    ...(d.phase === "cue" && d.limit?.length ? { limit: d.limit.map(l => ({ exchanges: l.exchanges, ...(l.after ? { after: l.after } : {}), ...(l.until?.length ? { until: [...l.until] } : {}) })) } : {}),
  };
}

/**
 * A route as the copied code's transition. Its condition is its `when` (into a discovery with none,
 * the revelation landing); a cue is a cue; dice make it an attempt with a check, success to its
 * target and failure to `onFailure` (its facts settled on success); anything else is an outcome,
 * judged after the reply, unless `attempt` (a talk's farewell).
 */
function transitionOfRoute(r: SceneRoute, nodes: Map<string, SceneNode>, facts: Record<string, string>, attempt: boolean): Transition {
  const target = nodes.get(r.target)!;
  const title = (id: string) => nodes.get(id)?.data.title ?? id;
  const revelation = target.data.kind === "beat" ? target.data.revelation : undefined;
  const when = r.condition.trim() || (revelation !== undefined ? `The player has come to understand this: ${revelation}` : r.label);
  const sentences = (r.establishes ?? []).map(id => facts[id] ?? id);
  const common = { id: r.id, when, ...(r.requires ? { requires: [...r.requires] } : {}) };
  if (r.skill) {
    return {
      ...common, on: "attempt",
      check: {
        skill: r.skill, dc: r.dc ?? 10,
        success: `It comes off: ${title(r.target)}.`,
        failure: r.onFailure ? `It goes wrong: ${title(r.onFailure)}.` : "It doesn't come off, and the scene stays where it is.",
        onSuccess: r.target, ...(r.onFailure ? { onFailure: r.onFailure } : {}),
        ...(sentences.length ? { establishes: { success: sentences } } : {}),
      },
    };
  }
  return { ...common, on: r.phase === "cue" ? "cue" : attempt ? "attempt" : "outcome", to: r.target, ...(sentences.length ? { establishes: sentences } : {}) };
}

function beatOfNode(n: SceneNode<StartData | BeatData>, transitions: Transition[]): Beat {
  const d = n.data;
  const beat = d.kind === "beat" ? d : undefined;
  return {
    id: n.id, title: d.title, direction: d.description,
    ...(d.cast && Object.keys(d.cast).length ? { cast: { ...d.cast } } : {}),
    ...(beat?.pressure ? { pressure: beat.pressure } : {}),
    transitions,
    ...(beat?.revelation !== undefined ? { revelation: beat.revelation } : {}),
    ...(beat?.paths ? { paths: beat.paths.map(p => ({ ...p, ...(p.check ? { check: { ...p.check } } : {}) })) } : {}),
    ...(beat?.required ? { required: true } : {}),
    ...(beat?.establishes?.length ? { establishes: [...beat.establishes] } : {}),
    ...(beat?.carry ? { carry: { ...beat.carry, ...(beat.carry.things ? { things: [...beat.carry.things] } : {}) } } : {}),
    ...(d.lore.length ? { lore: [...d.lore] } : {}),
  };
}

function exitOfNode(n: SceneNode<EndingData>): Exit {
  const d = n.data;
  return {
    id: n.id, kind: d.exitKind, title: d.title, outcome: d.description, closing: d.closing,
    ...(d.next ? { next: d.next } : {}), effects: [...(d.effects ?? [])], result: d.result,
    ...(d.lore.length ? { lore: [...d.lore] } : {}),
  };
}

function characterOfMember(c: CastMember): Character {
  return {
    id: c.id, name: c.name, look: c.look,
    ...(c.called ? { called: c.called } : {}), ...(c.aka?.length ? { aka: [...c.aka] } : {}),
    voice: c.voice, wants: c.wants, ...(c.fears ? { fears: c.fears } : {}),
    knows: [...c.knows], ...(c.secrets?.length ? { secrets: [...c.secrets] } : {}),
    attitude: c.attitude,
    ...(c.enters ? { enters: c.enters } : {}), ...(c.group ? { group: c.group } : {}),
    ...(c.statblock ? { statblock: c.statblock } : {}), ...(c.weapon ? { weapon: c.weapon } : {}),
    ...(c.members ? { members: c.members.map(m => ({ ...m })) } : {}),
    whyHere: c.whyHere, ...(c.limits ? { limits: c.limits } : {}), ...(c.roles ? { roles: { ...c.roles } } : {}), ...(c.lore ? { lore: c.lore } : {}),
  };
}

/** A beat the rest of the story needs (`carry`) as the essential the boundary owes on when it's missed. */
function essentialOf(n: SceneNode<BeatData>, castIds: Set<string>): Essential {
  const d = n.data, carry = d.carry!;
  const vias = [...new Set((d.paths ?? []).map(p => p.via))];
  return {
    id: n.id, what: d.revelation ?? d.description, placedWith: vias, carriers: vias.filter(v => castIds.has(v)), unlocks: carry.unlocks,
    ...(carry.later ? { later: carry.later } : {}), ...(carry.things?.length ? { things: [...carry.things] } : {}),
  };
}
