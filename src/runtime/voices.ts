import { respond, type Message, type RespondResult } from "../llm/openrouter.ts";
import { currentBeat, nowNote, prompt, sceneBrief, sceneEntries, scriptTranscript, speakerName, presentCast } from "./brief.ts";
import type { Scene } from "./scene.ts";
import type { SessionState } from "./session.ts";

export interface Spoken { speaker: string; kind: "narration" | "dialogue"; text: string; result: RespondResult }

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
export async function gmReply(scene: Scene, state: SessionState, directive: string[], onText?: (t: string) => void, operation = "gm.reply"): Promise<Spoken> {
  const input: Message[] = [
    { role: "developer", content: sceneBrief(scene, state) },
    ...gmHistory(scene, state),
    { role: "developer", content: nowNote(scene, state, directive) },
  ];
  // The model behaves best with a user turn to answer; the opening has none yet.
  if (!input.some(m => m.role === "user")) input.push({ role: "user", content: "(The player is ready. Begin.)" });
  const result = await respond({ operation, instructions: prompt("gm"), input, effort: "none", maxOutputTokens: 700, ...(onText ? { onText } : {}) });
  return { speaker: "gm", kind: "narration", text: result.text.trim(), result };
}

/** Approach "actors": the GM narrates only; it does not voice characters. */
export async function narratorReply(scene: Scene, state: SessionState, directive: string[], onText?: (t: string) => void): Promise<Spoken> {
  const input: Message[] = [
    { role: "developer", content: sceneBrief(scene, state) },
    { role: "user", content: `The scene so far:\n\n${scriptTranscript(scene, state) || "(The scene is just starting.)"}` },
    { role: "developer", content: `${nowNote(scene, state, directive, { castNotes: true })}\n\nNarrate now: the world, what happens and what the player notices. The characters speak for themselves, so don't write their dialogue.` },
  ];
  const result = await respond({ operation: "narrator.reply", instructions: prompt("narrator"), input, effort: "none", maxOutputTokens: 500, ...(onText ? { onText } : {}) });
  return { speaker: "gm", kind: "narration", text: result.text.trim(), result };
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
    `Also here: ${others.length ? others.join("; ") : "nobody else"}. The player's character: ${state.player.name}, ${state.player.concept}.`,
    ...(state.history.length ? [`Earlier today: ${state.history.map(h => h.summary).join(" ")}`] : []),
    ...(state.canon.length || state.established.length ? [`Things that have been established (true): ${[...state.established, ...state.canon].join(" ")}`] : []),
    ...(scene.limits?.length ? [`How things stand here (don't contradict it): ${scene.limits.join(" ")}`] : []),
    ...(beat.cast?.[c.id] ? [`What you're doing in this part of the scene: ${beat.cast[c.id]}`] : []),
    ...(direction.length ? [`The GM's direction for this moment: ${direction.join(" ")}`] : []),
  ].join("\n\n");
  const input: Message[] = [
    { role: "developer", content: context },
    { role: "user", content: `The scene so far:\n\n${scriptTranscript(scene, state) || "(The scene is just starting.)"}\n\nNow, as ${c.name}:` },
  ];
  const result = await respond({ operation: `actor.${c.id}`, instructions: system, input, effort: "none", maxOutputTokens: 900, ...(onText ? { onText } : {}) });
  const text = result.text.trim().replace(new RegExp(`^${c.name.split(" ")[0]}[^:]{0,20}:\\s*`), "");
  return { speaker: c.id, kind: "dialogue", text, result };
}
