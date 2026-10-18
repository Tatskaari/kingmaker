// Copied from the prototype's src/runtime/brief.ts:22-106, 344-389 and director.ts:54-58 at 44c6d4a; they read GmState's fields (not the session's), and effectiveScene's .at(-1) and findLast are ES2021 (leftBehind, the old co-GM's, went with it). candidatesOf is engine.ts:1061-1069 (chainScene's candidates), pure over a lookup.

import type { GmState, ScenePatch } from "../gm/state.ts";
import type { Beat, Character, Scene, Transition } from "./types.ts";

/**
 * The scene graph as play has it: which beat the scene is in, who's on stage, which routes are
 * open, what an ending is. Read-only helpers over the scene and the GM's bookkeeping, which the
 * simulation's commits and the AI service's prompts both use, so the two agree.
 */

/**
 * Every scene can also end in a way its prep didn't foresee, established in play (leaving with
 * someone, settling things another way). The world scribe makes it true afterwards. Without it, a
 * good improvised resolution has nowhere to go and the GM ends up retracting it.
 */
export const IMPROVISED_EXIT_ID = "own-ending";
export function withImprovisedEnding(scene: Scene): Scene {
  if (scene.exits.some(e => e.id === IMPROVISED_EXIT_ID)) return scene;
  // When every authored exit that continues goes to the same scene, an ending of their own does too.
  const nexts = [...new Set(scene.exits.map(e => e.next).filter((n): n is string => !!n))];
  return {
    ...scene,
    exits: [...scene.exits, {
      id: IMPROVISED_EXIT_ID, kind: "other", title: "An ending of their own",
      outcome: "The scene ends in a way the prep didn't foresee, as established in play.",
      closing: "Close on the moment the player chose, at the threshold, without narrating what comes next.",
      ...(nexts.length === 1 ? { next: nexts[0]! } : {}),
    }],
    anytime: [...(scene.anytime ?? []), {
      id: "improvised-ending", on: "outcome",
      when: "The scene's central matter has been settled, or left behind, in a way none of the other endings describe (the player resolved it their own way, or set off elsewhere with it), and nothing more needs to happen here.",
      to: IMPROVISED_EXIT_ID,
    }],
  };
}

/**
 * The authored scene as play has it: what the co-GM has added during play, and what the boundary
 * brought over from earlier scenes. An essential the scene preps for if the player missed it
 * earlier (`missed`) is the scene's only once the boundary has brought it over, and a route that
 * brings an essential the scene hasn't got (or is a way towards one) isn't there. A talk's prep
 * fills its discovery for this talk (`fill`: the one thing the companion might confide, and the ways
 * it can come out), or, with nothing to confide, the discovery isn't this talk's (`drop`: the node
 * goes, with every route into and out of it).
 */
export function effectiveScene(authored: Scene, patches: ScenePatch[]): Scene {
  const scene = withImprovisedEnding(authored);
  const brought = patches.flatMap(p => (p.essential ? [p.essential] : []));
  if (!patches.length && !scene.essentials?.some(e => e.missed)) return scene;
  // The scene's own essentials, and what the boundary brought (in place of the scene's prep for it).
  const dropped = new Set(patches.flatMap(p => (p.drop ? [p.drop] : [])));
  const essentials = [...(scene.essentials ?? []).filter(e => !e.missed && !brought.some(b => b.id === e.id) && !dropped.has(e.id)), ...brought];
  const has = new Set(essentials.map(e => e.id));
  const kept = (t: Transition) => ![t.to, t.check?.onSuccess].some(to => !!to && dropped.has(to));
  const live = (t: Transition) => [t.essential, t.towards].every(e => !e || has.has(e)) && kept(t);
  const beats = scene.beats.filter(b => !dropped.has(b.id)).map(b => {
    const fill = findLast(patches, p => p.fill?.id === b.id)?.fill;
    return { ...b, transitions: b.transitions.filter(live), ...(fill ? { revelation: fill.revelation, paths: fill.paths.map(p => ({ ...p, ...(p.check ? { check: { ...p.check } } : {}) })) } : {}) };
  });
  const routes = dropped.size ? (scene.routes ?? []).filter(r => !dropped.has(r.source) && !dropped.has(r.target)) : scene.routes;
  for (const patch of patches) {
    if (patch.beat && !beats.some(b => b.id === patch.beat!.id)) beats.push({ ...patch.beat, transitions: [...patch.beat.transitions] });
  }
  const anytime = (scene.anytime ?? []).filter(live);
  for (const patch of patches) {
    if (!patch.transition) continue;
    // "*" = scene-wide, so a later tracker move can't strand a route the player is pursuing.
    if (patch.transition.beat === "*") { if (!anytime.some(t => t.id === patch.transition!.transition.id)) anytime.push(patch.transition.transition); continue; }
    const beat = beats.find(b => b.id === patch.transition!.beat);
    if (beat && !beat.transitions.some(t => t.id === patch.transition!.transition.id)) beat.transitions.push(patch.transition.transition);
  }
  // What someone is keeping back now (the latest word on it wins).
  const cast = !patches.some(p => p.cast) ? scene.cast : scene.cast.map(c => {
    const amended = findLast(patches, p => p.cast?.id === c.id)?.cast;
    return amended ? { ...c, secrets: [...amended.secrets] } : c;
  });
  // Routes a ruling ruled out: gone from their beat (or from anywhere), wherever they came from.
  const closed = patches.filter(p => p.close).map(p => p.close!);
  for (const b of beats) if (closed.length) b.transitions = b.transitions.filter(t => !closed.some(c => c.beat === b.id && c.id === t.id));
  const open = closed.length ? anytime.filter(t => !closed.some(c => c.beat === "*" && c.id === t.id)) : anytime;
  return { ...scene, beats, anytime: open, cast, routes, ...(scene.essentials || brought.length ? { essentials } : {}) };
}

export function currentBeat(scene: Scene, state: Pick<GmState, "beat">): Beat {
  const beat = scene.beats.find(b => b.id === state.beat);
  if (!beat) throw new Error(`Scene ${scene.id}: current beat ${state.beat} not in it`);
  return beat;
}

export function targetTitle(scene: Scene, id: string): string {
  const beat = scene.beats.find(b => b.id === id);
  if (beat) return beat.title;
  const exit = scene.exits.find(e => e.id === id);
  return exit ? `the scene ends: ${exit.title}` : id;
}

/** The beats the scene has been at: its stage, every step of its path, and (M2) the nodes it has reached. */
export function visitedBeats(state: Pick<GmState, "beat" | "path"> & Partial<Pick<GmState, "reached">>): Set<string> {
  return new Set([state.beat, ...state.path.map(p => p.from), ...state.path.map(p => p.to), ...(state.reached ?? [])]);
}

export function presentCast(scene: Scene, state: Pick<GmState, "beat" | "path" | "entered" | "absent"> & Partial<Pick<GmState, "reached">>): Character[] {
  const visited = visitedBeats(state);
  return scene.cast.filter(c => state.entered?.includes(c.id) || (!state.absent?.includes(c.id) && (!c.enters || visited.has(c.enters))));
}

/**
 * A group's member as someone who can fight (docs/combat-gm.md): their own statblock and weapon
 * (their leader's group's), their look; they speak through their leader, so they have no card.
 */
export function memberAsCharacter(leader: Character, m: NonNullable<Character["members"]>[number]): Character {
  return { id: m.id, name: m.name, look: m.look ?? "", voice: "", wants: "", knows: [], attitude: `One of ${leader.name}'s: ${leader.group ?? "with them"}.`, ...(m.statblock ? { statblock: m.statblock } : {}), ...(m.weapon ? { weapon: m.weapon } : {}) };
}

/** Everyone here who could be in a fight: the present cast, and the members of a group whose leader is here (none gone). */
export function presentFighters(scene: Scene, state: Pick<GmState, "beat" | "path" | "entered" | "absent"> & Partial<Pick<GmState, "reached">>): Character[] {
  const cast = presentCast(scene, state);
  return [...cast, ...cast.flatMap(c => (c.members ?? []).filter(m => !state.absent?.includes(m.id)).map(m => memberAsCharacter(c, m)))];
}

/** Someone the scene knows who could fight: a card, or a group's member. */
export function fighterOf(scene: Scene, id: string): Character | undefined {
  const card = scene.cast.find(c => c.id === id);
  if (card) return card;
  for (const c of scene.cast) { const m = c.members?.find(x => x.id === id); if (m) return memberAsCharacter(c, m); }
  return undefined;
}

/**
 * Routes already achieved in this visit to the current beat: they looped back here having done
 * their work (a check won, a thing done). Offering them again invites a second roll for something
 * already settled, and a failure that takes back what was said. Failed checks stay open.
 */
export function spentHere(state: Pick<GmState, "beat" | "path">): Set<string> {
  const spent = new Set<string>();
  for (let i = state.path.length - 1; i >= 0; i--) {
    const p = state.path[i]!;
    if (p.to !== state.beat) break;
    if (p.from !== state.beat) break;
    if (p.roll?.success !== false) spent.add(p.via);
  }
  return spent;
}

/**
 * The routes to offer now: not one already achieved here, nor one that brings (or is a way towards)
 * what the player has already come across. (Nor, until the old co-GM went, one of its routes that
 * would take the scene back past what's settled: leftBehind.)
 */
export function openRoutes(transitions: Transition[], state: Pick<GmState, "beat" | "path" | "landed">): Transition[] {
  const spent = spentHere(state);
  const found = (e?: string) => !!e && !!state.landed?.includes(e);
  return transitions.filter(t => !spent.has(t.id) && !found(t.essential) && !found(t.towards));
}

/** What candidatesOf reads of a scene: its id, its exits' ways on, and whether it's an interlude or may be overtaken. */
export type Onward = Pick<Scene, "id" | "exits" | "interlude" | "assumes" | "overtaken">;

/**
 * The scenes the story could go to after a scene ends through an exit, in order (the prototype's
 * chainScene with skipInterludes, engine.ts:1061-1069): the exit's next, an interlude replaced by
 * where its way on goes (with a map to walk, downtime between scenes is the map), then wherever a
 * candidate goes if it's overtaken, while it takes something for granted. Six at most, none twice;
 * none when the exit goes nowhere (the story's end). `sceneOf` finds a scene by its key (the
 * campaign's scenes: the simulation's structure is enough); one it can't find ends the list there.
 */
export function candidatesOf(scene: Pick<Scene, "exits">, exitId: string, sceneOf: (key: string) => Onward | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let id = scene.exits.find(e => e.id === exitId)?.next; id && out.length < 6 && !seen.has(id); ) {
    seen.add(id);
    const candidate = sceneOf(id);
    if (!candidate) break;
    if (candidate.interlude) { id = candidate.exits.find(e => e.next)?.next; continue; }
    out.push(candidate.id);
    id = candidate.assumes?.length ? candidate.overtaken : undefined;
  }
  return out;
}

/** The last item that matches (Array.prototype.findLast is ES2023; the module's lib is ES2021). */
function findLast<T>(list: readonly T[], match: (item: T) => boolean): T | undefined {
  for (let i = list.length - 1; i >= 0; i--) if (match(list[i]!)) return list[i];
  return undefined;
}
