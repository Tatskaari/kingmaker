// Copied from the prototype's src/runtime/knowledge.ts:29-109 at 44c6d4a (what the player knows, who speaks, names as known), reading a TurnView: the story so far and the talks are always empty in V0's one scene, and "Caerwyn" is the campaign's own name.

import { playerDocPath, readDoc } from "../docs/docs.ts";
import { presentCast } from "../../shared/scene/graph.ts";
import { knownCast } from "../../shared/scene/names.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { distinct, speaker, type Speaker } from "./speakers.ts";
import type { TurnView } from "./view.ts";

/**
 * What the player knows: what a mark's note may explain, and what a mark's popover may show. The
 * GM is given every fact in its prep, secrets and all (a fast model kept from a fact invents one:
 * docs/guide); this says which of them the player has, so a note can explain without telling a
 * secret. It's built from what the player has lived, never from the prep:
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

/** What the player knows of the story so far (this scene is the conversation itself). V0 plays one scene, with no talks: there are no earlier scenes to list. */
export function playerKnowledge(state: TurnView): PlayerKnowledge {
  const self = readDoc(state.id, playerDocPath(state.player.name));
  return { ...(self ? { self: self.path } : {}), scenes: [], told: [] };
}

/**
 * The GM's note of what the player knows, in its prep (stable for the scene): what a mark may
 * explain, and what stays behind the screen. Whose names they've heard changes as the scene goes,
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
    "A note on a mark (your instructions say how to mark things) explains from this and nothing else. Everything else in your prep stays behind the screen however much it would explain: people's secrets and what they're keeping back, how far anyone has opened up, what the scene still means the player to find, your GM-only notes and other people's private ones, a story someone hasn't told yet, and the names the player hasn't heard. Play from all of it as ever: just don't explain it in a note.",
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
  for (const e of Object.values(state.world?.entities ?? {})) {
    if ((e.kind !== "person" && e.kind !== "creature") || e.player || e.states.includes("gone") || out.some(p => p.id === e.id || p.id === e.cast)) continue;
    out.push(speaker(e.id, e.name, undefined, [], { look: e.description }));
  }
  return distinct(out);
}

/** Someone by the name the player knows them by (what they call them, until they've heard it). */
export function nameAsKnown(scene: Scene, state: TurnView, id: string): string | undefined {
  const c = scene.cast.find(x => x.id === id);
  if (c) return c.called && !knownCast(scene, state).has(c.id) ? c.called : c.name;
  return state.world?.entities[id]?.name;
}
