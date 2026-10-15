import { CAST } from "../../map/looks.ts";
import { T } from "../../map/tiles.ts";
import type { MapActor, StoryState } from "../../types.ts";
import { exploreState } from "../../town.ts";
import { marks, rect, type Exhibit, type Wing } from "../model.ts";
import { COBBLES, floorFor } from "./common.ts";
import { toHall } from "./hall.ts";

/**
 * Kell's Corner: Sergeant Kell, the story's companion. Ask her and she walks with you through the
 * zoo, a step behind, through doors and into scenes; talk to her then and it's a talk (a word
 * between scenes, with lines to choose and her own story a piece at a time). Her desk is a short
 * scene of its own: give her a statement, and if she's walking with you she reads the notebook's
 * entry back to you after it, as she does between the story's scenes.
 */

const GRID = `
########################
%WWWWWWWWWW............#
%WkkkkkkkkW............#
%WkkkkkkkkW....K.......#
%WkkkkkkkkW..1.........#
%WkkkkkkkkW............#
%WkkkkkkkkW......B.....#
%WkkkkkkkkW............#
%WWWW+WWWWW............#
%..............2.......#
%.....3................#
%..................4...#
X......................#
%.@.a..................#
%......................#
%%%%%%%%%%%%%%%%%%%%%%%#
`;

const MARKS = "@a1K234B";
const at = marks(GRID, MARKS);
const ID = "zoo-kell";

/** The dictation booth: its scene, its floor, its world's corner, its door. */
export const KELL_ROOMS = [{ sceneId: "zoo-dictation", map: ID, name: "Kell's desk", rooms: [{ x: 2, y: 2, w: 8, h: 6 }], region: "zoo-kell-desk", door: { x: 5, y: 8 } }];
export const KELL_PLACES = [{ sceneId: "zoo-dictation", region: "zoo-kell-desk", door: { x: 5, y: 8 }, outside: { x: 5, y: 9 } }];

/** Kell in her corner, when she isn't walking with you: a word from her, and the offer. */
export function kellWaiting(story: StoryState, mapId: string): MapActor[] {
  if (mapId !== ID || story.flags.kell === true) return [];
  const kell = CAST.kell!;
  return [{
    id: `${ID}:kell`, name: kell.name, kind: "person", glyph: kell.glyph, color: kell.color, map: ID, at: { ...at.K! }, ref: "kell", blocks: true,
    interaction: { kind: "examine", text: "Kell looks up from her notebook. 'Investigator.' She waits, pencil ready. 'I'll walk with you, if you're going round. Ask.'", label: "Talk to Sergeant Kell" },
  }];
}

const exhibits: Exhibit[] = [
  {
    id: "kell-corner", title: "Kell's Corner", sign: at.a!, shows: [],
    text: "Sergeant Agnes Kell of the watch, lent to the investigator in the story and to you here. She walks with you if asked, talks if you stop for a word, and keeps the notebook. In the story she walks with you from the end of the first scene on, and reads the notebook back between scenes.",
    triggers: [],
  },
  {
    id: "kell-walks", title: "Kell walks with you", sign: at["1"]!, shows: ["Kell walks with you"], tour: ["kell-follow"],
    text: "Ask, and Kell follows a step behind you, taking your place as you move (or swapping with you, if she was in front). She comes through doors and ways out beside you, waits by the door while you play a booth (the booths' scenes are written without her; the story's have her in every one), fights beside you in the Arena's rings and the tavern booth's brawl, and is there when you come out. She'll walk the whole zoo. Ask her to wait and she comes back here.",
    triggers: [
      { id: "kell-follow", label: "Ask Kell to walk with you", at: at.K!, when: z => z.game.story.flags.kell !== true,
        run: z => { z.game.story.flags.kell = true; exploreState(z.game); return { text: "Kell puts her pencil behind her ear. 'After you, investigator.' She falls in a step behind you." }; } },
      { id: "kell-wait", label: "Ask Kell to wait in her corner", at: at.K!, when: z => z.game.story.flags.kell === true,
        run: z => { z.game.story.flags.kell = false; exploreState(z.game); return { text: "'I'll be here,' says Kell, and goes back to her corner, writing as she goes." }; } },
    ],
  },
  {
    id: "kell-talk", title: "A word with Kell", sign: at["2"]!, shows: ["A word with Kell", "Dialogue choices", "Her story, a piece at a time", "A talk moves nothing on"],
    text: "Once she walks with you, talking to her (e beside her, a right-click on her, or her name in the Nearby list) stops for a word: a talk of its own, with her greeting in her manner and two to four things you might say listed to click, a goodbye, and walking on without a word. Each talk, she might open up about one thing of her own story, a step at a time, never telling it twice; the deepest she keeps for a third talk. Nothing in a talk moves the story: no clues, no gifts. It needs the model; offline the talk opens with an error line in place of her greeting, and walking on comes back here.",
    triggers: [], needsModel: true, talk: { with: "kell", say: ["How long have you been with the watch, Sergeant?"] },
  },
  {
    id: "kell-record", title: "For the Record (Kell between scenes)", sign: at["3"]!, shows: ["Kell between scenes", "The notebook"],
    text: "Kell's desk is a scene: step in and give her a statement (anything will do: it simply happens). Its ending writes the notebook (j). If she's walking with you when it ends, she reads the entry back to you, in the words of the record, before the map comes back: as she does between the story's scenes, a line at a time. With nobody walking with you, it's a plain card. Offline: /end noted.",
    triggers: [], needsModel: true, scene: { id: "zoo-dictation", exit: "noted", say: ["I'd like to make a statement. About a pie."] },
  },
  {
    id: "kell-story", title: "Kell in the story's scenes", sign: at["4"]!, shows: ["Kell in the story's scenes"],
    text: "In the story Kell is the partner in every scene of the arc: her notebook ('Noted.', entries read back word for word), 'On what evidence?', the truncheon nobody has seen her draw, the door Nan put her through twenty years ago (four shillings and sixpence still owed), and the secret she tells once. The Theatre's repertory board rehearses the arc's scenes with her in them.",
    triggers: [],
  },
];

export const kell: Wing = {
  id: ID,
  name: "Kell's Corner",
  about: "Sergeant Kell: she walks with you if asked, talks if you stop for a word, and takes statements at her desk.",
  entry: at["@"]!,
  map: {
    grid: GRID,
    legend: {
      "#": T("wall", { style: "brick", height: 3 }), "%": T("wall", { style: "brick", height: 1 }), ".": COBBLES,
      W: T("wall", { style: "plaster", height: 2 }), "+": T("door", { style: "plaster", height: 2 }), X: T("door", { style: "brick", height: 1 }),
      k: T("boards", { roof: "plaster", roofHeight: 2 }),
      ...floorFor(MARKS, COBBLES),
      B: T("cobbles", {}, { name: "a bench", glyph: "═", color: "#8a6038", text: "A bench where people wait to give statements. It has been sat on by the guilty and the innocent alike, and can't tell them apart." }),
    },
    regions: [{ id: "zoo-kell-desk", name: "Kell's desk", rect: { x: 2, y: 2, w: 8, h: 6 }, sceneId: "zoo-dictation", worldOrigin: { x: 1, y: 1 }, trigger: "enter", label: "Go in to Kell's desk", description: "A watch-house desk in the zoo, for statements." }],
    exits: [{ at: { x: 0, y: 12 }, to: toHall(ID), label: "Back to the hall" }],
  },
  world: {
    name: "Kell's Corner", description: "A small brick yard with a bench, Kell's desk, and Kell.",
    size: { w: 24 * 5, h: 16 * 5 },
    areas: [{ id: "corner", name: "Kell's corner", rect: rect(0, 0, 24, 16) }],
    things: [],
    people: { player: { in: "corner", at: [12.5, 67.5] } },
  },
  dressing: { ground: { corner: "cobbles" } },
  exhibits,
};
