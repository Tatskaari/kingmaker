// Copied from the prototype's src/app/game.ts:2396-2432 at 44c6d4a (PASSING, KELL_ON, talkBetween), whole: the time is the game row's (a string), a Line is the scene view's; TIME_WORDS (src/app/story.ts:19-25) is creation/words.ts's copy. And src/game/fight-standin.ts's words (its observe, act and result's summary), whole.
import { TIME_WORDS } from "../creation/words.ts";
import type { Line } from "../scene/view.ts";

/**
 * The words between scenes (story-design §4.5): how the time between scenes went, what Kell says
 * of where the story goes next, and the talk itself, as the prototype's app has them; and the
 * fight's stand-in, until the fight is played on the map (V12).
 */

export { TIME_WORDS };

/** How the time between scenes went, when the story's hand-off didn't say (its lead is its own words for it). */
export const PASSING: Record<string, string> = {
  morning: "The morning gets on with itself, as mornings in Caerwyn do: loudly, and mostly downhill towards the river.",
  afternoon: "The rest of the morning goes in statements, signatures and a bun of uncertain age at the watch-house.",
  evening: "The afternoon goes in paperwork. By the time it’s done, the lamplighters are out along the quay.",
  night: "Evening turns into night the way it does in Caerwyn: without asking anyone.",
  "next-morning": "The night passes. Some of it is even spent asleep.",
};

/** What Kell adds once she's shown you the way: her view of the place the story goes next (not how to get there: that's the map's). */
export const KELL_ON: Record<string, string> = {
  "drowned-rat": "I’ll walk with you: somebody has to write it down.",
  "heron-warehouse": "If that barge sails on the ebb, so does the evidence. I’d rather it didn’t.",
};

/**
 * Between scenes, whoever walks with the player says what the card would: the notebook's new
 * entry, read back in the words of the record; how the time went (the story's own lead, when the
 * hand-off wrote one); and where the story goes next. Where next is the core's lead and nothing
 * else: the next scene, and `way`, the way there as the map says it (leadWay: "Up the river stairs,
 * then on to the Heron ← 3 paces"), drawn in the notebook's margin. Kell has her own way of putting
 * things; anyone else just says them.
 */
export function talkBetween(friend: { id: string; name: string }, what: { notebook: string[]; lead?: string | undefined; next: { id: string; title: string }; way?: string | undefined; time: string }): Line[] {
  const says = (text: string): Line => ({ kind: "dialogue", speaker: friend.id, name: friend.name, text });
  const kell = friend.id === "kell";
  const out: Line[] = [];
  const entry = what.notebook.join(" ");
  if (entry) out.push(says(kell
    ? `“For the record.” She reads the entry back to you, in the words of the record: “${entry}” She looks at it a moment longer. “Noted.”`
    : `“So,” says ${friend.name}. “${entry}”`));
  out.push({ kind: "narration", speaker: "gm", text: what.lead ?? PASSING[what.time]! });
  const way = what.way?.trim();
  if (!kell) out.push(says(`“${what.next.title} next.”${way ? ` ${friend.name} shows you the way: ${way}.` : ""}`));
  else out.push(says(`“${what.next.title}, then.” ${way ? `She draws you the way in her notebook’s margin: ${way}.` : "She writes it down."} “${KELL_ON[what.next.id] ?? "After you, investigator. I’ll be writing."}”`));
  return out;
}

/**
 * The fight's stand-in (the prototype's src/game/fight-standin.ts), until tactical combat is wired
 * in (V12): it resolves the fight in one go, as won. What it says while the fight is to be had
 * (observe), what it says as it's fought (act), and how it went (result's summary: the simulation
 * writes "The fight: <summary>" into the scene, which picks up from it).
 */
export const STANDIN = {
  observe: "(Tactical combat on the map isn't wired in yet: this stand-in resolves the fight in one go.)",
  act: "Steel, dust and lantern light: after a short, ugly fight the Crakes are down and Sallow drops his sword-cane and asks, very politely, to surrender.",
  summary: "After a short, ugly fight the Crakes went down and Sallow surrendered, very politely.",
  /** The one thing it offers: its action's id and label. */
  action: { id: "fight", label: "Fight it out" },
} as const;
