import { dirname, join } from "node:path";
import type { Character, Scene } from "../src/runtime/scene.ts";
import { characterEntry, seedDoc, titleOf, type Doc } from "../src/lore/docs.ts";

/**
 * A word with a companion between scenes: the prep for anyone who walks with the player and has a
 * lore entry (Cast/<Name>/private.md), built from that lore rather than written for each of them.
 * The runtime (src/runtime/talk.ts) puts the scene the story is heading for aside while the talk
 * lasts, gives the companion the one thing they might open up about this time (a staged secret on
 * their card), and puts the story back where it was when the player says goodbye or walks on.
 * Nothing here moves the story: there are no story exits.
 *
 * The id says who and which talk it is ("talk-kell-2"), so every process that meets the session
 * (the game, the background memory reviews) can build the scene from the id alone.
 */

const TALK_ID = /^talk-(.+)-(\d+)$/;

export const talkSceneId = (companion: string, n: number) => `talk-${companion}-${n}`;

/** Who a talk scene is with, and which of their talks it is. */
export function talkOf(sceneId: string): { companion: string; n: number } | undefined {
  const m = TALK_ID.exec(sceneId);
  return m ? { companion: m[1]!, n: Number(m[2]) } : undefined;
}

/** Someone the player can stop for a word with: they have a lore entry to be themselves from. */
export const talkable = (id: string) => !!characterEntry(id);

/** The talk's last dialogue choice: saying it ends the talk (the goodbye route knows it). */
export const FAREWELL = "I'll leave you to it.";

/** The beat a talk moves to once they've told the one thing they were keeping back. */
export const TOLD = "told";

/** A "## " section of a lore doc as one line, by the heading's opening words. */
function section(doc: Doc | undefined, heading: string): string | undefined {
  const lines = doc?.body.split("\n") ?? [];
  const start = lines.findIndex(l => l.startsWith(`## ${heading}`));
  if (start < 0) return undefined;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).map(l => l.replace(/^\s*-\s+/, "").trim()).filter(Boolean).join(" ") || undefined;
}

/** The first paragraph under a doc's title. */
const firstParagraph = (doc: Doc | undefined) => doc?.body.split(/\n\s*\n/).map(p => p.trim()).find(p => p && !p.startsWith("#"));

const built = new Map<string, Scene>();

/**
 * The talk scene for an id, or undefined when it isn't one (or the companion has no lore).
 * `authored` finds the companion's card in an authored scene, for what lore doesn't say: the
 * statblock and weapon the rules would use.
 */
export function talkScene(sceneId: string, authored?: (id: string) => Character | undefined): Scene | undefined {
  const cached = built.get(sceneId);
  if (cached) return cached;
  const talk = talkOf(sceneId);
  const entry = talk ? characterEntry(talk.companion) : undefined;
  if (!talk || !entry) return undefined;
  const lore = seedDoc(entry);
  const face = seedDoc(join(dirname(entry), "public.md"));
  const card = authored?.(talk.companion);
  const name = lore ? titleOf(lore) : card?.name ?? talk.companion;
  const companion: Character = {
    id: talk.companion,
    name,
    look: section(face, "Look") ?? firstParagraph(face) ?? card?.look ?? "As their lore describes them.",
    voice: section(lore, "Voice") ?? card?.voice ?? "As their lore has it.",
    wants: "Their own business, between one thing and the next; a word with the player, if it's wanted, on their own terms.",
    knows: ["What their own lore and memories hold (below): what they've seen, done, been told and believe, and nothing more."],
    attitude: "As things stand between them and the player (their memories say how), and at whatever ease that allows. They answer what they're asked and give their own view when it's wanted; what they keep back of their own story stays theirs until they're ready.",
    ...(card?.statblock ? { statblock: card.statblock } : {}),
    ...(card?.weapon ? { weapon: card.weapon } : {}),
  };
  const scene: Scene = {
    id: sceneId,
    title: `A word with ${name}`,
    summary: `A word with ${name} between scenes: a talk for its own sake, with no story exits.`,
    setting: "Out in the town between one scene of the story and the next, wherever the player stopped for a word (the details established in play say where and when), with the place going about its business around them.",
    premise: `A word with ${name}, who walks with the player between scenes: small talk, their view of things, and, slowly, who they are. It has nothing to settle and moves nothing in the story on (the next place waits on the map); it lasts until the player says goodbye or walks on.`,
    hook: `A word with ${name}, between one thing and the next.`,
    opening: `The player has come over for a word with ${name}, out in the town between scenes (the details established in play say where and when: time has passed since the last scene ended, and the next is still ahead). In a sentence or two, what ${name} is doing as the player comes over (their own business, in their own manner) and their word of greeting, in their own voice. Don't recap the story, don't ask what the player wants or where to go next, and don't bring up their own past. End on them waiting, in their own way, for the player to speak.`,
    cast: [companion],
    start: "talk",
    beats: [{
      id: "talk",
      title: "A word between scenes",
      direction: [
        `The player has stopped for a word with ${name}: a talk for its own sake, not a scene of the story. Nothing turns up here (no clues, no new people, no new places), and the story's next place stays where it is.`,
        `Play ${name} as their lore and memories have them, at whatever ease things between them and the player allow: short, natural exchanges in their own voice; their own view of the town, the story so far and the people the player has met, as far as they've seen and know; something of their own business.`,
        `What anyone could know of them is theirs to say. Their own story (what happened to them, what it cost, who they care about, why something matters to them) comes slowly: in this talk, at most the one thing on their card that they're keeping back, if there is one, a step at a time as far as they've opened up; anything else of their past stays theirs for another day, deflected in their own manner, without lying. What they've told the player before isn't told again (the details established say what): a word back to it at most.`,
        "They don't run the player's business: no next steps, and no leads they'd have no reason to volunteer; asked where next, they say what they know of it, once.",
      ].join(" "),
      // How the one thing they might tell comes out is the talk's own (src/runtime/talk.ts adds it).
      transitions: [],
    }, {
      id: TOLD,
      title: "Told",
      direction: `${name} has told the player the one thing they were keeping back this time. That's as much of their own story as comes out in one talk: they answer a follow-up or two about it, briefly and in their own way, and the rest of their past waits for another day. Otherwise the talk goes on as before: their view of things, their own business, until the player says goodbye or walks on.`,
      transitions: [],
    }],
    anytime: [
      { id: "goodbye", on: "attempt", when: `The player says goodbye or ends the talk ("${FAREWELL}"), or walks on.`, to: "goodbye" },
    ],
    exits: [{
      id: "goodbye", kind: "leave", title: "Goodbye for now",
      outcome: `The player has said goodbye or walked on: the talk is over, and ${name} gets back to their own business, still walking with them.`,
      closing: `Close on ${name}'s last word or gesture as the player moves on: a line or two, nothing new.`,
    }],
    limits: [
      "New leads, clues or people turning up: a word between scenes moves nothing in the story on; the story goes on at its next place.",
      "Going somewhere together now (into a building, on to the next place): walking on ends the talk, and the map takes them there.",
      "Things changing hands (a gift, a loan, money, gear): a word in passing isn't the place for it; offered, it's answered in character and stays with whoever had it.",
    ],
    companion: talk.companion,
    // A talk has nothing to keep on track (no co-GM) and no dice for ordinary talk; what the
    // companion keeps back comes out a step at a time (staged secrets).
    approach: { repair: "off", freeformChecks: false, staging: true },
  };
  built.set(sceneId, scene);
  return scene;
}
