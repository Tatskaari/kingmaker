import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Beat, Character, Exit, Scene, Transition } from "./scene.ts";
import type { Entry, ScenePatch, SessionState } from "./session.ts";
import { titleCase } from "./dice.ts";

const PROMPTS_DIR = join(import.meta.dirname, "..", "..", "prompts");
const cache = new Map<string, string>();
export function prompt(name: string, vars: Record<string, string> = {}): string {
  let text = cache.get(name);
  if (text === undefined) {
    text = readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf8").trim();
    cache.set(name, text);
  }
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

/** The authored scene plus whatever the repair agent has added during play. */
export function effectiveScene(scene: Scene, patches: ScenePatch[]): Scene {
  if (!patches.length) return scene;
  const beats = scene.beats.map(b => ({ ...b, transitions: [...b.transitions] }));
  for (const patch of patches) {
    if (patch.beat && !beats.some(b => b.id === patch.beat!.id)) beats.push({ ...patch.beat, transitions: [...patch.beat.transitions] });
  }
  for (const patch of patches) {
    if (!patch.transition) continue;
    const beat = beats.find(b => b.id === patch.transition!.beat);
    if (beat && !beat.transitions.some(t => t.id === patch.transition!.transition.id)) beat.transitions.push(patch.transition.transition);
  }
  return { ...scene, beats };
}

export function currentBeat(scene: Scene, state: SessionState): Beat {
  const beat = scene.beats.find(b => b.id === state.beat);
  if (!beat) throw new Error(`Session ${state.id}: current beat ${state.beat} not in scene ${scene.id}`);
  return beat;
}

export function targetTitle(scene: Scene, id: string): string {
  const beat = scene.beats.find(b => b.id === id);
  if (beat) return beat.title;
  const exit = scene.exits.find(e => e.id === id);
  return exit ? `the scene ends: ${exit.title}` : id;
}

export function visitedBeats(state: SessionState): Set<string> {
  return new Set([state.beat, ...state.path.map(p => p.from), ...state.path.map(p => p.to)]);
}

export function presentCast(scene: Scene, state: SessionState): Character[] {
  const visited = visitedBeats(state);
  return scene.cast.filter(c => !c.enters || visited.has(c.enters));
}

const bullets = (items: readonly string[] | undefined, none = "- (nothing in particular)") => items?.length ? items.map(i => `- ${i}`).join("\n") : none;

function castBlock(scene: Scene, c: Character, present: boolean): string {
  const lines = [
    `### ${c.name}${c.group ? ` (${c.group})` : ""}`,
    `- Look: ${c.look}`,
    `- Voice: ${c.voice}`,
    `- Wants: ${c.wants}`,
    ...(c.fears ? [`- Fears: ${c.fears}`] : []),
    `- Knows:\n${c.knows.map(k => `  - ${k}`).join("\n")}`,
    ...(c.secrets?.length ? [`- Secrets (they come out only when earned):\n${c.secrets.map(s => `  - ${s}`).join("\n")}`] : []),
    `- Attitude to the party at the start: ${c.attitude}`,
  ];
  if (!present && c.enters) lines.push(`- Not on stage yet: arrives when the scene reaches "${targetTitle(scene, c.enters)}".`);
  return lines.join("\n");
}

function exitBlock(exit: Exit): string {
  return `- ${exit.title}: ${exit.outcome}`;
}

/** Stable prep for the GM: everything that doesn't change turn to turn (cache-friendly prefix). */
export function sceneBrief(scene: Scene, state: SessionState, options: { secrets: boolean } = { secrets: true }): string {
  const present = new Set(presentCast(scene, state).map(c => c.id));
  const cast = scene.cast.map(c => castBlock(scene, options.secrets ? c : { ...c, secrets: [] }, present.has(c.id))).join("\n\n");
  const background = [...(scene.background ?? []), ...state.history.map(h => h.summary)];
  return [
    `# Your prep for this scene: ${scene.title}`,
    `## The place\n${scene.setting}`,
    `## What this scene is about\n${scene.premise}`,
    ...(background.length ? [`## Already established before this scene\n${bullets(background)}`] : []),
    `## The people here\n${cast}`,
    `## Ways this scene can end\nThese are the only ways it can close. The player's choices decide which; don't force one.\n${scene.exits.map(exitBlock).join("\n")}`,
    `## The player character\n${state.player.name}: ${state.player.concept}`,
  ].join("\n\n");
}

function transitionLine(scene: Scene, t: Transition): string {
  if (t.check) {
    const fail = t.check.onFailure ? targetTitle(scene, t.check.onFailure) : "the scene carries on from here";
    return `- ${t.when} The dice decide (${titleCase(t.check.skill)}): success leads to ${targetTitle(scene, t.check.onSuccess)}; failure means ${fail}.`;
  }
  return `- ${t.when} Leads to ${targetTitle(scene, t.to!)}.`;
}

/** The per-turn note: where we are, what moves things on, co-GM notes and this reply's direction. */
export function nowNote(scene: Scene, state: SessionState, directive: string[], options: { castNotes?: boolean } = {}): string {
  const beat = currentBeat(scene, state);
  const present = new Set(presentCast(scene, state).map(c => c.id));
  const castNotes = Object.entries(beat.cast ?? {}).filter(([id]) => present.has(id))
    .map(([id, note]) => `- ${scene.cast.find(c => c.id === id)?.name ?? id}: ${note}`);
  const transitions = [...beat.transitions, ...(scene.anytime ?? [])];
  const parts = [
    `## Where the scene is now: ${beat.title}\n${beat.direction}`,
    ...(options.castNotes !== false && castNotes.length ? [`What people are doing:\n${castNotes.join("\n")}`] : []),
    ...(beat.pressure ? [`If the scene stalls or drifts, the world can push: ${beat.pressure}`] : []),
    `(The scene has been at this point for ${state.turnsInBeat} exchange${state.turnsInBeat === 1 ? "" : "s"}.)`,
    `## What moves the scene on from here\n${transitions.map(t => transitionLine(scene, t)).join("\n")}`,
    ...(state.notes ? [`## Notes from your co-GM\n${state.notes}`] : []),
    ...(state.canon.length || state.established.length ? [`## Details established in play (keep them true)\n${bullets([...state.established, ...state.canon])}`] : []),
    ...(directive.length ? [`## For this reply\n${directive.join("\n\n")}`] : []),
  ];
  return parts.join("\n\n");
}

export function sceneEntries(state: SessionState): Entry[] {
  return state.transcript.filter(e => (e.scene ?? state.sceneId) === state.sceneId);
}

export function speakerName(scene: Scene, state: SessionState, speaker: string): string {
  if (speaker === "player") return state.player.name;
  if (speaker === "gm") return "GM";
  return scene.cast.find(c => c.id === speaker)?.name ?? speaker;
}

/** Script-style transcript, used for actors, deciders and the repair agent. */
export function scriptTranscript(scene: Scene, state: SessionState, entries = sceneEntries(state)): string {
  return entries.map(e => {
    if (e.kind === "roll" || e.kind === "system") return `[${e.text}]`;
    const name = speakerName(scene, state, e.speaker);
    return e.speaker === "player" ? `${name} (player): ${e.text}` : `${name}: ${e.text}`;
  }).join("\n\n");
}
