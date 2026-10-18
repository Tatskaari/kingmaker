// New (M6): a zoo fight as the headless client prints it: the fight's own text (client/fight/text.ts), with the zoo's actions in its ACTIONS (again, and each other line-up of foes), and the ids act takes for them.
import type { ZooFight } from "./zoo.ts";

/** The zoo's act that fights it again (open_exhibit with the same foes). */
export const AGAIN = "again";
/** The prefix of the zoo's acts that pick other foes: foes_dogs, foes_crakes. */
export const FOES = "foes_";

/** The zoo's actions for a fight from one of its exhibits: again, then each other line-up, by id. */
export function zooActions(zoo: ZooFight): string[] {
  return [
    `- ${AGAIN}: Fight it again (${zoo.foes.title}, everyone whole)`,
    ...zoo.lineUps.filter(l => l.id !== zoo.foes.id).map(l => `- ${FOES}${l.id}: Fight ${lowerFirst(l.title)} instead${l.description ? ` (${l.description.replace(/\.$/, "")})` : ""}`),
  ];
}

/** A fight's text with the zoo's actions in its ACTIONS (under the header, which a fight with none of its own hasn't got). A spectator's has none. */
export function withZoo(text: string, zoo: ZooFight | undefined, watching: boolean): string {
  if (!zoo || watching) return text;
  const lines = zooActions(zoo).join("\n");
  return /\nACTIONS:\n/.test(text) ? `${text}\n${lines}` : `${text}\n\nACTIONS:\n${lines}`;
}

/** An act's id as one of the zoo's: again, or a line-up's id to fight instead; nothing when it isn't one. */
export function zooAct(id: string, zoo: ZooFight | undefined): { again: true } | { foes: string } | undefined {
  if (!zoo) return undefined;
  if (id === AGAIN) return { again: true };
  return id.startsWith(FOES) && zoo.lineUps.some(l => `${FOES}${l.id}` === id) ? { foes: id.slice(FOES.length) } : undefined;
}

const lowerFirst = (t: string) => (/^(The|A|An) /.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
