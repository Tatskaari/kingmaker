import { respond, type Message, type RespondResult } from "../llm/openrouter.ts";
import { currentBeat, nowNote, prompt, sceneBrief, sceneEntries, scriptTranscript, speakerName, presentCast } from "./brief.ts";
import type { Scene } from "./scene.ts";
import type { SessionState } from "./session.ts";
import { memoryBrief } from "../lore/disclosure.ts";
import { approachById } from "./approaches.ts";

export interface Spoken { speaker: string; kind: "narration" | "dialogue"; text: string; result: RespondResult }

const voiceEffort = (state: SessionState) => approachById(state.approach).effort ?? "none";

const normalise = (text: string) => text.toLowerCase().replace(/[*_"“”‘’'.,!?;:()\-—–]/g, " ").replace(/\s+/g, " ").trim();

/** A sentence of eight or more words repeated verbatim from recent replies (or within this one). */
export function repeatedSentence(text: string, recent: string[]): string | undefined {
  const seen = new Set<string>();
  for (const earlier of recent) for (const sentence of earlier.split(/(?<=[.!?])\s+|\n+/)) {
    const n = normalise(sentence);
    if (n.split(" ").length >= 8) seen.add(n);
  }
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const n = normalise(sentence);
    if (n.split(" ").length < 8) continue;
    if (seen.has(n)) return sentence.trim();
    seen.add(n);
  }
  return undefined;
}

function recentTexts(state: SessionState, count = 6): string[] {
  return sceneEntries(state).filter(e => e.kind === "narration" || e.kind === "dialogue").slice(-count).map(e => e.text);
}

/** Models imitate their last few replies; when a draft repeats one verbatim, ask once for a fresh take. */
async function withoutRepeats(state: SessionState, draft: Spoken, regenerate: (note: string) => Promise<Spoken>): Promise<Spoken> {
  const repeat = repeatedSentence(draft.text, recentTexts(state));
  if (!repeat) return draft;
  const second = await regenerate(`Your first draft repeated something already said, word for word ("${repeat}"). Don't repeat it: move the moment on with something new.`);
  return { ...second, result: { ...second.result, costUsd: second.result.costUsd + draft.result.costUsd } };
}

/** Multi-turn chat history for the single-GM voice: player turns as user, GM replies as assistant. */
function gmHistory(scene: Scene, state: SessionState): Message[] {
  const messages: Message[] = [];
  for (const e of sceneEntries(state)) {
    if (e.kind === "player") messages.push({ role: "user", content: e.text });
    else if (e.kind === "roll" || e.kind === "system") messages.push({ role: "developer", content: `[${e.text}]` });
    else {
      const text = e.kind === "dialogue" ? `${speakerName(scene, state, e.speaker)}: ${e.text}` : e.text;
      const last = messages.at(-1);
      if (last?.role === "assistant") last.content += `\n\n${text}`;
      else messages.push({ role: "assistant", content: text });
    }
  }
  return messages;
}

/** Approach "gm": one call, the GM narrates and voices everyone (Friends & Fables style). */
export async function gmReply(scene: Scene, state: SessionState, directive: string[], onText?: (t: string) => void, operation = "gm.reply", signal?: AbortSignal, maxTokens?: number): Promise<Spoken> {
  const docs = Boolean(approachById(state.approach).memory);
  const lore = docs ? memoryBrief(scene, state, "stable") : undefined;
  const memory = docs ? memoryBrief(scene, state, "live") : undefined;
  const input: Message[] = [
    { role: "developer", content: sceneBrief(scene, state, { hideEssentials: approachById(state.approach).hideEssentials === true, lastHandoffOnly: docs }) },
    ...(lore ? [{ role: "developer" as const, content: lore }] : []),
    ...gmHistory(scene, state),
    // Volatile memory goes after the conversation so the cached prefix survives a newly opened note.
    { role: "developer", content: [memory, nowNote(scene, state, directive)].filter(Boolean).join("\n\n") },
  ];
  // The model behaves best with a user turn to answer; the opening has none yet.
  if (!input.some(m => m.role === "user")) input.push({ role: "user", content: "(The player is ready. Begin.)" });
  const tone = approachById(state.approach).tone;
  const result = await respond({ operation, instructions: prompt("gm", { tone: tone ? prompt(`tone-${tone}`) : "" }), input, effort: voiceEffort(state), maxOutputTokens: maxTokens ?? (voiceEffort(state) === "none" ? 700 : 6000), ...(onText ? { onText } : {}), ...(signal ? { signal } : {}) });
  const draft: Spoken = { speaker: "gm", kind: "narration", text: prose(result.text), result };
  if (directive.some(d => d.startsWith("Your first draft repeated"))) return draft;
  return withoutRepeats(state, draft, note => gmReply(scene, state, [...directive, note], onText, `${operation}.fresh`));
}

/** The reply as prose: stray model tokens ("RGCTX:VEVENT") don't reach the transcript. */
export const prose = (text: string) => text.replace(/[ \t]*\b[A-Z]{3,}(?:_[A-Z0-9]+)*:[A-Z][A-Z0-9_]{2,}\b/g, "").trim();

/** Approach "actors": the GM narrates only; it does not voice characters. */
export async function narratorReply(scene: Scene, state: SessionState, directive: string[], onText?: (t: string) => void): Promise<Spoken> {
  const input: Message[] = [
    { role: "developer", content: sceneBrief(scene, state, { hideEssentials: approachById(state.approach).hideEssentials === true }) },
    { role: "user", content: `The scene so far:\n\n${scriptTranscript(scene, state) || "(The scene is just starting.)"}` },
    { role: "developer", content: `${nowNote(scene, state, directive, { castNotes: true })}\n\nNarrate now: the world, what happens and what the player notices. The characters speak for themselves, so don't write their dialogue.` },
  ];
  const result = await respond({ operation: "narrator.reply", instructions: prompt("narrator"), input, effort: voiceEffort(state), maxOutputTokens: voiceEffort(state) === "none" ? 500 : 6000, ...(onText ? { onText } : {}) });
  const draft: Spoken = { speaker: "gm", kind: "narration", text: prose(result.text), result };
  if (directive.some(d => d.startsWith("Your first draft repeated"))) return draft;
  return withoutRepeats(state, draft, note => narratorReply(scene, state, [...directive, note], onText));
}

/** Approach "actors": one character speaks from their own knowledge only. */
export async function actorReply(scene: Scene, state: SessionState, characterId: string, direction: string[], onText?: (t: string) => void): Promise<Spoken> {
  const c = scene.cast.find(x => x.id === characterId);
  if (!c) throw new Error(`Unknown character ${characterId}`);
  const beat = currentBeat(scene, state);
  const others = presentCast(scene, state).filter(x => x.id !== c.id).map(x => `${x.name}: ${x.look}`);
  const system = prompt("actor", {
    name: c.group ? `${c.name} (speaking for ${c.group})` : c.name,
    short: c.name.split(" ")[0]!,
    look: c.look, voice: c.voice, wants: c.wants, fears: c.fears ?? "nothing much",
    attitude: c.attitude,
    knows: c.knows.map(k => `- ${k}`).join("\n"),
    secrets: c.secrets?.length ? c.secrets.map(s => `- ${s}`).join("\n") : "- nothing in particular",
  });
  const context = [
    `Where you are: ${scene.setting}`,
    `Also here: ${others.length ? others.join("; ") : "nobody else"}. The player's character: ${state.player.concept} (their name is ${state.player.name}, but you only know that if they've told you).`,
    ...(state.history.length ? [`What happened just before this (it's what actually happened, so it wins over anything else you were told):\n${state.history.map(h => h.summary).join("\n\n")}`] : []),
    ...(state.canon.length || state.established.length ? [`Things that have been established (true): ${[...state.established, ...state.canon].join(" ")}`] : []),
    ...(scene.limits?.length ? [`How things stand here (don't contradict it): ${scene.limits.join(" ")}`] : []),
    ...(beat.cast?.[c.id] ? [`What you're after in this part of the scene (pursue it naturally, react to what just happened first, and don't repeat yourself): ${beat.cast[c.id]}`] : []),
    ...(direction.length ? [`The GM's direction for this moment: ${direction.join(" ")}`] : []),
  ].join("\n\n");
  const input: Message[] = [
    { role: "developer", content: context },
    { role: "user", content: `The scene so far:\n\n${scriptTranscript(scene, state) || "(The scene is just starting.)"}\n\nNow, as ${c.name}:` },
  ];
  const result = await respond({ operation: `actor.${c.id}`, instructions: system, input, effort: voiceEffort(state), maxOutputTokens: voiceEffort(state) === "none" ? 900 : 6000, ...(onText ? { onText } : {}) });
  const text = result.text.trim().replace(new RegExp(`^${c.name.split(" ")[0]}[^:]{0,20}:\\s*`), "");
  const draft: Spoken = { speaker: c.id, kind: "dialogue", text, result };
  if (direction.some(d => d.startsWith("Your first draft repeated"))) return draft;
  return withoutRepeats(state, draft, note => actorReply(scene, state, characterId, [...direction, note], onText));
}
