// Copied from the prototype's scenes/talk.ts at 44c6d4a, lines 18-38 (TALK_ID, talkSceneId, talkOf, FAREWELL, TOLD) and talk.ts:144 (CONFIDED); talkable is gone (the client has no lore: a talk is with anyone who walks with the player), and the scene itself is campaign data (the campaign's talk template, scenes/talk.kmscene since M2, `{name}` and `{companion}` in it), which talkSceneDocument fills for a companion (new: docs/town-design.md §3.6), its filling talkWords. talkScene's words from lore are the AI service's (ai/gm/talk.ts). Since a talk plays on the two-part GM (docs/migration-log.md, the old pipeline's salvage): GOODBYE, and isFarewell, the goodbye said in so many words, which closes the talk with its reply.
import type { SceneDocument } from "./document.ts";

/**
 * A word with a companion between scenes: the prep for anyone who walks with the player, built from
 * the campaign's talk template rather than written for each of them. Nothing in it moves the story:
 * there are no story exits. The id says who and which talk it is ("talk-kell-2"), so every part that
 * meets the game (the simulation, the AI service, the background memory reviews) can find the scene
 * from the id alone.
 */

const TALK_ID = /^talk-(.+)-(\d+)$/;

export const talkSceneId = (companion: string, n: number) => `talk-${companion}-${n}`;

/** Who a talk scene is with, and which of their talks it is. */
export function talkOf(sceneId: string): { companion: string; n: number } | undefined {
  const m = TALK_ID.exec(sceneId);
  return m ? { companion: m[1]!, n: Number(m[2]) } : undefined;
}

/** The talk's last dialogue choice: saying it ends the talk (the goodbye route knows it). */
export const FAREWELL = "I'll leave you to it.";

/**
 * The goodbye said in so many words: the talk's last dialogue choice (say_goodbye), or the same words
 * typed, give or take their case, quote marks and stops. Saying it closes the talk with the reply to
 * it (the simulation takes the way into GOODBYE before the reply: simulation/src/moves/two-part.ts).
 */
export function isFarewell(line: string): boolean {
  const plain = (text: string) => text.toLowerCase().replace(/[’‘]/g, "'").replace(/["“”.!]+/g, "").replace(/\s+/g, " ").trim();
  return plain(line) === plain(FAREWELL);
}

/** The talk's discovery: the one thing the companion might confide this time (filled for each talk by its prep), reached once it has come out. */
export const TOLD = "told";

/** The route by which the one thing they were keeping back comes out (to the talk's TOLD discovery): talk.ts:144. */
export const CONFIDED = "confided";

/** The talk's one ending, and the route into it: saying goodbye, or walking on. */
export const GOODBYE = "goodbye";

/** What walking on says, for a talk's choices (play.ts:359). */
export const WALK_ON = "Walk on without a word (back to the map)";

/** Who a talk is with, as the simulation knows them: their cast id and name, and the statblock and weapon the rules would use (their card in the scene they came from). */
export interface TalkCompanion { id: string; name: string; statblock?: string; weapon?: string }

/** A talk template's words filled for a companion, as talkSceneDocument fills every string of it: `{name}` their name, `{companion}` their cast id, `{farewell}` FAREWELL. */
export const talkWords = (text: string, who: Pick<TalkCompanion, "id" | "name">): string =>
  text.split("{name}").join(who.name).split("{companion}").join(who.id).split("{farewell}").join(FAREWELL);

/**
 * The talk scene for a companion's n-th talk, from the campaign's talk template: its id the talk's
 * (talkSceneId), `companion` their cast id; in every string of it, and every key (the start's role
 * for `{companion}` is theirs), `{name}` their name, `{companion}` their cast id and `{farewell}`
 * FAREWELL; the template's first cast entry theirs, with their statblock and weapon. The template
 * itself is left as it was.
 */
export function talkSceneDocument(template: SceneDocument, who: TalkCompanion, n: number): SceneDocument {
  const fill = (_key: string, value: unknown): unknown => typeof value === "string" ? talkWords(value, who)
    : value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [talkWords(k, who), v]))
    : value;
  const filled = JSON.parse(JSON.stringify(template), fill) as SceneDocument;
  const cast = filled.cast.map((c, i) => (i === 0 ? { ...c, id: who.id, name: who.name, ...(who.statblock ? { statblock: who.statblock } : {}), ...(who.weapon ? { weapon: who.weapon } : {}) } : c));
  return { ...filled, id: talkSceneId(who.id, n), companion: who.id, cast };
}
