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
 * A scene at its fight (docs/combat-gm.md): what the card under the reply says while it's to be had
 * (observe), and its one action, on to the fight, which sets it out on the board (fight_it_out). The
 * scene picks up from how it went once the player is out of it ("The fight: …" in its transcript).
 */
export const STANDIN = {
  observe: "(The fight is set out on the board, the place's own map, everyone where they stand: fought a turn at a time, the GM telling each one.)",
  /** The one thing it offers: its action's id and label. */
  action: { id: "fight", label: "To the fight" },
} as const;
