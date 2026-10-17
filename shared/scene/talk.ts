// Copied from the prototype's scenes/talk.ts at 44c6d4a, lines 18-38 (TALK_ID, talkSceneId, talkOf, FAREWELL, TOLD) and talk.ts:144 (CONFIDED); talkable is gone (the client has no lore: a talk is with anyone who walks with the player), and the scene itself is campaign data (scenes/talk/ in the campaign, `{name}` and `{companion}` in it), which talkSceneFile fills for a companion (new: docs/town-design.md §3.6), its filling talkWords, which the AI service gives the template's Markdown too. talkScene's words from lore are the AI service's (v2/ai/gm/talk.ts).
import type { SceneFile } from "./files.ts";

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

/** The beat a talk moves to once they've told the one thing they were keeping back. */
export const TOLD = "told";

/** The route by which the one thing they were keeping back comes out (to the talk's TOLD beat): talk.ts:144. */
export const CONFIDED = "confided";

/** What walking on says, for a talk's choices (play.ts:359). */
export const WALK_ON = "Walk on without a word (back to the map)";

/** Who a talk is with, as the simulation knows them: their cast id and name, and the statblock and weapon the rules would use (their card in the scene they came from). */
export interface TalkCompanion { id: string; name: string; statblock?: string; weapon?: string }

/** A talk template's words filled for a companion, as talkSceneFile fills its scene.json's strings: `{name}` their name, `{companion}` their cast id, `{farewell}` FAREWELL. */
export const talkWords = (text: string, who: Pick<TalkCompanion, "id" | "name">): string =>
  text.split("{name}").join(who.name).split("{companion}").join(who.id).split("{farewell}").join(FAREWELL);

/**
 * The talk scene for a companion's n-th talk, from the campaign's talk template: its id the talk's
 * (talkSceneId), its kind `talk`, `companion` their cast id; in every string of it, `{name}` their
 * name, `{companion}` their cast id and `{farewell}` FAREWELL; the template's first cast entry
 * theirs, with their statblock and weapon. The template's Markdown is read with the same filling on
 * the AI service's side.
 */
export function talkSceneFile(template: SceneFile, who: TalkCompanion, n: number): SceneFile {
  const filled = JSON.parse(JSON.stringify(template), (_key, value: unknown) => (typeof value === "string" ? talkWords(value, who) : value)) as SceneFile;
  const cast = filled.cast.map((c, i) => (i === 0 ? { ...c, id: who.id, name: who.name, ...(who.statblock ? { statblock: who.statblock } : {}), ...(who.weapon ? { weapon: who.weapon } : {}) } : c));
  return { ...filled, id: talkSceneId(who.id, n), kind: "talk", companion: who.id, cast };
}
