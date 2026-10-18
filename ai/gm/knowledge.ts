// Copied from the prototype's src/runtime/knowledge.ts at 44c6d4a, but its marks' links and cards (the notes', which M2 took out of the game: docs/two-part-design.md, in git history before it): it reads a TurnView (gm/view.ts) for the session; the scenes it names besides this one are the view's story (gm/story.ts) for sceneById; a talk (talkOf) is v2/shared/scene/talk.ts's; the world whose common knowledge the player shares is the campaign's (`setting`: "Caerwyn"); the brief's line about a mark's note goes with the notes.

import { playerDocPath, readDoc } from "../docs/docs.ts";
import { presentCast } from "../../shared/scene/graph.ts";
import { knownCast } from "../../shared/scene/names.ts";
import { talkOf } from "../../shared/scene/talk.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { distinct, speaker, type Speaker } from "./speakers.ts";
import { namedMembers } from "./unheard.ts";
import type { TurnView } from "./view.ts";

/**
 * What the player knows. The GM is given every fact in its prep, secrets and all (a fast model kept
 * from a fact invents one: docs/guide); this says which of them the player has. It's built from
 * what the player has lived, never from the prep:
 *
 * - who they are: their concept, and their doc (Player/<Name>.md: what they've told or shown people
 *   of themselves, and their backstory once character creation writes one into it);
 * - the story so far as they lived it: how each scene ended, and the notebook's lines its ending wrote;
 * - this scene: everything said and shown in it;
 * - what companions have told them of themselves in talks between scenes;
 * - whose names they've heard (knownCast), and who they know only by sight;
 * - the world's common knowledge: the lore marked public.
 *
 * What's behind the screen is everything else: people's secrets, what someone is keeping back, what
 * a scene means the player to find, the GM-only and private notes, a companion's untold stories.
 */

export interface PlayerKnowledge {
  /** Their own doc, where their past is kept, when there is one. */
  self?: string;
  /** Earlier scenes, oldest first: the scene, how it ended, and what the notebook says of it. */
  scenes: Array<{ id: string; title: string; ending: string; notebook: string[] }>;
  /** What companions have told them of their own story, in talks. */
  told: Array<{ who: string; topic: string }>;
}

/** A scene of the story, as play has it, or none. */
const safeScene = (state: TurnView, id: string): Scene | undefined => state.story?.scene(id);

/** What the player knows of the story so far (this scene is the conversation itself). */
export function playerKnowledge(state: TurnView): PlayerKnowledge {
  const self = readDoc(state.id, playerDocPath(state.player.name));
  return {
    ...(self ? { self: self.path } : {}),
    scenes: state.history.filter(h => !talkOf(h.sceneId)).map(h => {
      const played = safeScene(state, h.sceneId);
      return { id: h.sceneId, title: played?.title ?? h.sceneId, ending: played?.exits.find(e => e.id === h.exitId)?.title ?? h.exitId, notebook: h.journal ?? [] };
    }),
    told: Object.entries(state.talks ?? {}).flatMap(([id, record]) => record.told.map(t => ({ who: companionName(state, id), topic: t.topic }))),
  };
}

/** A companion's name as the story has it: on the card of any scene that has them, else their id. */
function companionName(state: TurnView, id: string): string {
  for (const sceneId of [state.sceneId, ...state.history.map(h => h.sceneId)]) {
    const c = safeScene(state, sceneId)?.cast.find(x => x.id === id);
    if (c) return c.name;
  }
  return id;
}

/**
 * The GM's note of what the player knows, in its prep (stable for the scene), and what stays behind
 * the screen. Whose names they've heard changes as the scene goes,
 * so that's in the turn's own note ("Names the player hasn't heard yet"). `setting`: the world's
 * name, whose common knowledge they share (the campaign's title: "Caerwyn").
 */
export function knowledgeBrief(state: TurnView, setting: string): string {
  const k = playerKnowledge(state);
  const lines = [
    `- Who they are: ${state.player.name}, ${state.player.concept.replace(/\.$/, "")}. Their own past, as your notes on the player character have it${k.self ? ` (${k.self})` : ""}, is theirs: they know all of it.`,
    ...(k.scenes.length ? [`- What they did and saw earlier in the story (everything that was narrated to them):\n${k.scenes.map(s => `  - ${s.title}: ${s.ending}.${s.notebook.length ? ` Their notebook: ${s.notebook.map(n => `"${n}"`).join(" ")}` : ""}`).join("\n")}`] : []),
    ...(k.told.length ? [`- What people have told them of themselves, between scenes: ${k.told.map(t => `${t.who}, ${t.topic}`).join("; ")}.`] : []),
    "- This scene: everything said and shown so far, and everything they've done in it.",
    `- The world: what anyone in ${setting} knows (the city and its places, its customs and laws, who's who: your lore notes marked public), and what their trade and their past would have taught them.`,
  ];
  return [
    "## What the player knows",
    "Everything else in your prep stays behind the screen: people's secrets and what they're keeping back, how far anyone has opened up, what the scene still means the player to find, your GM-only notes and other people's private ones, a story someone hasn't told yet, and the names the player hasn't heard. Play from all of it as ever.",
    ...lines,
  ].join("\n");
}

// --- Who speaks: the scene's people by the names that mean them in prose.

/**
 * Everyone who might speak in a reply: the scene's cast (those here first), then the rest of the
 * place's people. The cast who aren't here are away: known by their names only (someone the
 * narration names may call from off, or come in), never by what they're called or look like ("the
 * porter" isn't Hobb when Hobb is in the cells).
 */
export function speakersOf(scene: Scene, state: TurnView): Speaker[] {
  const here = presentCast(scene, state);
  const out: Speaker[] = [
    ...here.map(c => speaker(c.id, c.name, c.called, c.aka, { look: c.look })),
    ...scene.cast.filter(c => !here.includes(c)).map(c => speaker(c.id, c.name, c.called, c.aka, { look: c.look, away: true })),
  ];
  // A group's member who goes by a name inside what they are is also what the narration calls them until it's heard ("the talking bruiser").
  const members = namedMembers(scene);
  for (const e of Object.values(state.world?.entities ?? {})) {
    if ((e.kind !== "person" && e.kind !== "creature") || e.player || e.states.includes("gone") || out.some(p => p.id === e.id || p.id === e.cast)) continue;
    out.push(speaker(e.id, e.name, members.get(e.id)?.called, [], { look: e.description }));
  }
  return distinct(out);
}

/** Someone by the name the player knows them by (what they call them, until they've heard it). */
export function nameAsKnown(scene: Scene, state: TurnView, id: string): string | undefined {
  const c = scene.cast.find(x => x.id === id);
  if (c) return c.called && !knownCast(scene, state).has(c.id) ? c.called : c.name;
  return state.world?.entities[id]?.name;
}
