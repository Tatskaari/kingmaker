import { sceneById } from "../../../scenes/index.ts";
import { modelOffline, respond } from "../../llm/openrouter.ts";
import { approachById } from "../../runtime/approaches.ts";
import { prompt } from "../../runtime/brief.ts";
import type { Character } from "../../runtime/scene.ts";
import type { CombatController } from "./controller.ts";
import { feetBetween } from "./grid.ts";
import { show, type LogLine, type Unit } from "./model.ts";
import { health } from "./rules.ts";
import type { Reading } from "./typed.ts";

/**
 * The GM's line on a typed turn in a fight (prompts/fight.md, in the house voice): the answer of
 * whoever the player spoke to, or the GM dressing what the rules just did. The rules have decided
 * everything already; the line only says it. It's given the whole fight (everyone, where, how
 * they are, who they are), what was typed and what the rules made of it, and it streams.
 */

export interface VoiceInput {
  fight: CombatController;
  reading: Reading;
  /** The fight's log since the line was typed: the typed line, then the rules' lines. */
  rules: LogLine[];
  onSpeaker(who: string): void;
  onText(text: string): void;
}

/** A line: who says it (a unit's id, or "gm"), and what (an answer comes with their name already). */
export type Voice = (input: VoiceInput) => Promise<{ who: string; text: string } | undefined>;

/** The house voice, by the fast model (the scene GM's own: no reasoning, so it's quick). */
export const speak: Voice = async ({ fight, reading, rules, onSpeaker, onText }) => {
  if (modelOffline()) return undefined;
  const who = speakerOf(fight, reading);
  // As the fight calls them ("Master Sallow", "the talking Crake").
  const name = who === "gm" ? "" : fight.state().units[who]?.called ?? who;
  onSpeaker(who);
  const tone = approachById(fight.session.approach).tone;
  const result = await respond({
    operation: "fight.voice",
    instructions: prompt("fight", { tone: tone ? prompt(`tone-${tone}`) : "" }),
    input: [
      { role: "developer", content: factsOf(fight) },
      { role: "user", content: askFor(fight, reading, rules, who) },
    ],
    effort: "none",
    maxOutputTokens: 200,
    onText: text => onText(lineOf(name, plain(text))),
  });
  const text = lineOf(name, plain(result.text));
  return text ? { who, text } : undefined;
};

/** Who answers: whoever was spoken to, if they're in a state to and have words to answer with (a wolf hasn't); otherwise the GM. */
function speakerOf(fight: CombatController, reading: Reading): string {
  const u = spokenTo(fight, reading);
  return u && u.state === "fighting" && u.id !== fight.state().pc && fight.look().understands(u) ? u.id : "gm";
}

/** Whoever the words were said to, if anyone in particular. */
function spokenTo(fight: CombatController, reading: Reading): Unit | undefined {
  const to = reading.speech?.to;
  return to && to !== "room" ? fight.state().units[to] : undefined;
}

/** An answer with its speaker's name, the words in quotes (the GM's own line as it comes). */
function lineOf(name: string, text: string): string {
  const t = text.trim().replace(new RegExp(`^${escape(name)}\\s*:\\s*`, "i"), "");
  if (!name || !t) return t;
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}: ${/["“]/.test(t) ? t : `“${t.replace(/^["']|["']$/g, "")}”`}`;
}

const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** One line of prose: no paragraphs, and no markdown's asterisks or underscores. */
const plain = (t: string) => t.replace(/[*_]+/g, "").replace(/\s*\n+\s*/g, " ").replace(/ {2,}/g, " ").trim();

/** The whole fight, for the voice: where, who (with who they are), how everyone stands, and what's been happening. */
function factsOf(fight: CombatController): string {
  const G = fight.state();
  const me = G.units[G.pc]!;
  const cards = castCards(fight);
  const person = (u: Unit) => {
    const where = u.id === me.id ? "" : `, ${feetBetween(me.at, u.at)} ft from the player`;
    const how = u.state === "fighting" ? health(u) : u.state === "down" ? "down, out cold (no words, no deeds)" : u.state;
    const conditions = u.conditions.filter(c => !/active$/.test(c));
    const card = cards[u.castId ?? u.id];
    const mute = u.id !== me.id && !fight.look().understands(u) ? " (an animal: no words of its own)" : "";
    return `- ${u.name}${u.id === me.id ? " (the player's character)" : ""}${mute}: ${u.side === "enemy" ? "on the other side" : u.side === "ally" ? "on the player's side" : u.id === me.id ? "" : "not in it"}; ${how}${conditions.length ? `, ${conditions.join(", ")}` : ""}${where}${card ? `. ${card}` : ""}`;
  };
  const things = Object.values(G.props).filter(p => !p.carriedBy).map(p => `- the ${p.name}: ${p.state}${p.lit && p.state === "standing" ? ", lit" : ""}`);
  return [
    `The fight: ${G.place ?? "the Heron"}, round ${G.round}.`,
    `The player's character: ${fight.session.player.name}, ${fight.session.player.concept}.`,
    "", "Everyone in it:", ...Object.values(G.units).filter(u => u.state !== "fled").map(person),
    ...(Object.values(G.units).some(u => u.state === "fled") ? [`Gone: ${Object.values(G.units).filter(u => u.state === "fled").map(u => u.name).join(", ")}.`] : []),
    ...(things.length ? ["", "Things:", ...things] : []),
    ...(G.dust.length ? ["", "Grain dust hangs over part of the floor: fire in it goes up all at once."] : G.flags["dust_exploded"] ? ["", "The grain dust has gone up already."] : []),
    ...(G.fire.length ? ["The sacks are burning."] : []),
    "", "The fight so far (its last lines):", ...fight.view().log.slice(-14).map(show),
  ].join("\n");
}

/** Who the people are, from the scene's cast cards and the world's descriptions (a ring's goblins have only the latter). */
function castCards(fight: CombatController): Record<string, string> {
  const out: Record<string, string> = {};
  const session = fight.session;
  let cast: Character[] = [];
  try { cast = sceneById(session.sceneId).cast; } catch { /* a zoo ring's world isn't a scene */ }
  for (const c of cast) out[c.id] = `${c.look} How they talk: ${c.voice} What they want: ${c.wants}`;
  for (const [id, e] of Object.entries(session.world?.entities ?? {})) if (!out[id] && e.description && (e.kind === "person" || e.kind === "creature")) out[id] = e.description;
  return out;
}

/** What the voice is asked for this time: the line typed, what the rules did, and whose line it is. */
function askFor(fight: CombatController, reading: Reading, rules: LogLine[], who: string): string {
  const G = fight.state();
  const typed = rules.find(l => l.kind === "said" && l.who === G.pc)?.text ?? reading.speech?.words ?? "";
  const done = rules.filter(l => !(l.kind === "said" && l.who === G.pc)).map(show);
  const u = who === "gm" ? undefined : G.units[who];
  const beast = !u ? spokenTo(fight, reading) : undefined;
  const job = u
    ? `${u.name} answers the player: one line, in their own voice, as the fight stands for them now.`
    : beast && beast.state === "fighting" && !fight.look().understands(beast)
      ? `The words were for ${beast.name}, an animal with no words of its own: say, in a line, how it takes them, by what it does or how it looks (it doesn't give way, run or stop unless a rules line says so).`
      : reading.steps.length
        ? "Say what the rules' lines show happening, in a line or two: nothing they don't say."
        : "The words carry across the fight: say, in a line, how they land with the people in earshot (no one gives in, runs or stops unless a rules line says so).";
  return [
    `The player typed: "${typed}"`,
    "",
    done.length ? `What the rules did with it:\n${done.join("\n")}` : "The rules did nothing with it: it was only words.",
    "",
    job,
  ].join("\n");
}
