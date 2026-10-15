import { sceneById } from "../../../../scenes/index.ts";
import { sessionSpend } from "../../../llm/openrouter.ts";
import { sheetText, createCharacter } from "../../../rules/dnd.ts";
import type { SessionState } from "../../../runtime/session.ts";
import { setGlyphSet, glyphSet, type GlyphSet } from "../../look/glyphs.ts";
import { T } from "../../map/tiles.ts";
import type { StoryState } from "../../types.ts";
import { exploreState } from "../../town.ts";
import { BUILDS, refit, wear, wearing, ZOO_LEVEL } from "../builds.ts";
import { feet, marks, rect, type Exhibit, type Trigger, type Wing } from "../model.ts";
import { firstMorningText } from "../window.ts";

/**
 * The front hall: where the zoo starts and its doors go off to the wings. The wardrobe, the
 * tailor, the clock and the glyph lever; and signs for what the game is outside its world: the
 * screens, the keys, the saves, the browser, and the workshop's tools.
 */

const GRID = `
#####A#####B#####C#####D############
%..................................#
%..................................#
%..................................E
%.........K...L....................#
%.........q...r.................8..#
%...W..P...........................F
%...c..............................#
%.............1..2..3..4..5..6..7..#
%...dM.............................G
%..................................#
%.....b..e..f..g..h..i..j..k..l....#
%..................................H
%..a..s...m..n..0..p...............#
%.@................................#
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
`;

const DOORS = "ABCDEFGH";
const MARKS = "abcdefghijklmnpqrs012345678WKLPM@";
const at = marks(GRID, `${DOORS}${MARKS}`);
const FLOOR = T("floor", { style: "flags" });

/** The wings' doors, in the order of the zoo's wings (wings/index.ts), with what's through each. */
export const HALL_DOORS: Array<{ door: string; wing: string; name: string; about: string }> = [
  { door: "A", wing: "zoo-fire", name: "the Burning Gallery", about: "spells, fire, explosions and everything they set off" },
  { door: "B", wing: "zoo-works", name: "the Works", about: "the world's physics: fire, water, spills, ice, and things broken open" },
  { door: "C", wing: "zoo-looks", name: "the Hall of Looks", about: "how everything looks: flames, wrecks, ground, light, crowds, glyph sets" },
  { door: "D", wing: "zoo-annexe", name: "the Town Annexe", about: "the map: walking, bumping, doors, looking, menus, things to take and give" },
  { door: "E", wing: "zoo-theatre", name: "the Theatre", about: "short scenes with the GM, and rehearsals of the story's own" },
  { door: "F", wing: "zoo-rules", name: "the Rules Room", about: "checks, spells, blows, grapples, jumps, class features, rests" },
  { door: "G", wing: "zoo-arena", name: "the Arena", about: "fights on the map: melee, arrows, spells, fire, grain dust, nerve" },
  { door: "H", wing: "zoo-kell", name: "Kell's Corner", about: "Sergeant Kell: she walks with you, and talks" },
];

/** Where each wing's door comes out in the hall (the tile just inside it). */
export const hallSide = (wing: string): { x: number; y: number } => {
  const d = HALL_DOORS.find(h => h.wing === wing)!;
  const door = at[d.door]!;
  return door.y === 0 ? { x: door.x, y: 1 } : { x: door.x - 1, y: door.y };
};

/** The way into a wing from the hall, for its map's exits. */
export const toHall = (wing: string) => ({ map: "zoo-hall", at: hallSide(wing) });

const TIMES: StoryState["time"][] = ["morning", "afternoon", "evening", "night", "next-morning"];
const TIME_WORDS: Record<StoryState["time"], string> = {
  morning: "morning: low gold sun", afternoon: "afternoon: plain daylight", evening: "evening: the lamps lit, the light gone amber",
  night: "night: blue dark, lit only by what burns", "next-morning": "the next morning: bright, and a little colder",
};
const SETS: GlyphSet[] = ["ascii", "nerd", "plain", "kingmaker"];
const SET_WORDS: Record<GlyphSet, string> = {
  ascii: "ascii, the default: CP437-flavoured Unicode", nerd: "nerd: Nerd Font icons for things (people keep their letters); it needs a Nerd Font",
  plain: "plain: seven-bit ASCII, for terminals that remember the eighties", kingmaker: "kingmaker: the game's own pixel-art sprites (npm run glyphs installs the font, or you'll see boxes)",
};

const TAILORED = "a retired lighthouse keeper with a lantern, a bad knee and an encyclopaedic knowledge of shipwrecks";

/** The End of a visit so far, in words, as the End screen lays it out: the last closing words, the booths played, the bar tab. */
function theEnd(session: SessionState): string {
  const closing = [...session.transcript].reverse().find(e => e.kind === "narration")?.text ?? "And that, as they say in Caerwyn, was that.";
  const chapters = session.history.map((h, i) => {
    const scene = sceneById(h.sceneId);
    return `${i + 1}. ${scene.title}: ${scene.exits.find(e => e.id === h.exitId)?.title ?? h.exitId}.`;
  });
  return `THE END. ${closing} How it went: ${chapters.length ? chapters.join(" ") : "nothing yet (the Theatre's booths are the chapters)."} The GM's bar tab this sitting: $${sessionSpend().toFixed(2)}. The King has graciously declined to pay it.`;
}

const sign = (id: string, mark: string, title: string, shows: string[], text: string, triggers: Trigger[] = [], needsModel = false, extra: Partial<Exhibit> = {}): Exhibit =>
  ({ id, title, shows, sign: at[mark]!, text, triggers, ...(needsModel ? { needsModel } : {}), ...extra });

const wardrobe: Trigger[] = Object.values(BUILDS).map(b => ({
  id: `wear-${b.id}`, label: `Put on ${b.robes} (become ${b.name})`, at: at.W!, station: { name: "the wardrobe", glyph: "▥", color: "#a07a52" },
  when: z => wearing(z.session) !== b.id,
  run: async z => {
    const line = await wear(z.session, b.id, z.world);
    return { text: `You put on ${b.robes}. The rules engine makes you over: ${line}`, cues: [{ kind: "effect", effect: "poof", at: { id: "player" }, radius: 2 }] };
  },
}));

export const hall: Wing = {
  id: "zoo-hall",
  name: "the Front Hall",
  about: "The zoo's front hall: the wardrobe, the clock, the glyph lever, the screens explained, and the doors to the wings.",
  entry: at["@"]!,
  map: {
    grid: GRID,
    legend: {
      "#": T("wall", { style: "civic", height: 4 }), "%": T("wall", { style: "stone", height: 1 }), ".": FLOOR,
      ...Object.fromEntries([...DOORS].map(d => [d, T("door", { style: "civic", height: 4 })])),
      ...Object.fromEntries([...MARKS].map(m => [m, FLOOR])),
    },
    regions: [
      { id: "zoo-hall-wardrobe", name: "the wardrobe corner", rect: { x: 1, y: 5, w: 8, h: 5 }, description: "A wardrobe of ready-made selves, a tailor, and a mirror that tells the truth in numbers." },
      { id: "zoo-hall-workshop", name: "the workshop corner", rect: { x: 13, y: 7, w: 21, h: 3 }, description: "Signs for the tools the game is made and checked with. Nothing here bites." },
    ],
    exits: HALL_DOORS.map(d => ({ at: at[d.door]!, to: { map: d.wing, at: { x: 2, y: 2 } }, label: `Into ${d.name}` })),
  },
  notices: HALL_DOORS.map(d => {
    const door = at[d.door]!;
    return { at: door.y === 0 ? { x: door.x + 1, y: 1 } : { x: door.x - 1, y: door.y + 1 }, name: `the sign for ${d.name}`, text: `THROUGH HERE: ${d.name.toUpperCase()}. ${d.about.charAt(0).toUpperCase()}${d.about.slice(1)}.` };
  }),
  world: {
    name: "The Front Hall", description: "The zoo's front hall: pale civic stone, a great many signs, and doors off to the wings.",
    size: { w: 36 * 5, h: 16 * 5 },
    areas: [{ id: "hall", name: "the front hall", rect: rect(0, 0, 36, 16) }],
    things: [
      { id: "tailor", name: "the tailor", kind: "person", in: "hall", at: feet(at.P!), description: "A thin man with a tape measure round his neck and pins in his mouth, who makes people out of a sentence. He is very good at sleeves." },
    ],
    people: { player: { in: "hall", at: feet(at["@"]!) } },
  },
  dressing: { ground: { hall: "flags" } },
  exhibits: [
    sign("welcome", "a", "Welcome to the Zoo", ["Walking by key", "Click to walk", "Pointer hover", "The explore screen"],
      "Everything the game does, standing still long enough to be looked at. Walk with the arrows or WASD (up is up the screen), or click where you want to be. Right-click anything for what you can do with it, or face it and press e. g walks you to the next exhibit you haven't seen; v looks down on a wing from above. Nothing done in the zoo happens in Caerwyn, which Caerwyn would like on record."),
    sign("story-start", "s", "The story's first morning", ["A new game's start"],
      "The zoo starts you in its hall, a level-five wizard with no case. A new game of the story starts on the Caerwyn map, in the lane by the granary gate, on the morning of the eve of the Assembly, with the hook in What happens and the lead on the granary yard, where Kell is waiting inside the gate. Look out of the window beside this sign and there it is, as a new game has it, not yet played: you can look, not go. New game on the title screen, when you're ready to be a level-three investigator.",
      [{ id: "first-morning", label: "Look out of the window at the story's first morning", at: { x: 7, y: 13 }, station: { name: "a window onto Caerwyn", glyph: "▯", color: "#c8e0f0" },
        run: () => ({ text: firstMorningText(), show: "window" }) }]),
    sign("title-screen", "b", "The title screen", ["The title screen"],
      "KINGMAKER in block letters, a tagline, and the games you can carry on with (x on one, twice, sends it to runs/deleted/). The zoo has its own line there, and its visits are kept apart from the story's saves: a zoo visit is never offered as a game to Continue, and the story never sees the zoo."),
    sign("wardrobe", "c", "The wardrobe", ["Character creation", "Making a character"],
      "Who you are is a build: class, species, background, the standard array, skills, an origin feat, spells and kit, made legal by the rules engine and levelled to five. In the story one model call picks the build from a sentence about you; offline the class defaults stand in, which is why so many investigators turn out to be human rogues. Here the robes are ready-made: put some on and you are that build, with its spells and nobody else's. The tailor makes you from a sentence, when the model is about.",
      [...wardrobe, {
        id: "tailor", label: "Have the tailor make you from a sentence", at: "tailor",
        run: async z => {
          z.session.player.concept = TAILORED;
          const line = await createCharacter(z.session, ZOO_LEVEL);
          refit(z.session, z.world);
          return { text: `"A retired lighthouse keeper," says the tailor, through the pins, "with a lantern and a bad knee." The rules make the rest: ${line}`, cues: [{ kind: "effect", effect: "poof", at: { id: "player" } }] };
        },
      }], true, { tour: ["tailor", "wear-fighter", "wear-rogue", "wear-cleric", "wear-barbarian", "wear-bard", "wear-sorcerer", "wear-wizard"] }),
    sign("sheet", "d", "Your character sheet", ["The character sheet"],
      "c on the map (s in a fight, /sheet in a scene) shows everything the engine knows about you, laid out: hit points, abilities, skills, attacks, spells with their slots, features, what you carry and the purse, with a portrait for each class. On a small screen it's in pages. The mirror beside this sign reads you the short version.",
      [{
        id: "mirror", label: "Look in the mirror", at: at.M!, station: { name: "a tall mirror", glyph: "▯", color: "#c8e0f0" },
        run: async z => ({ text: `The mirror, which has no tact, reads you out: ${(await sheetText(z.session)).split("\n").slice(0, 3).join(" ")}` }),
      }]),
    sign("explore-screen", "e", "The explore screen", ["The explore screen", "Pointer hover", "The right-click menu"],
      "The live map on the left, twelve frames a second; the sidebar on the right (where you are, the hour, you, the lead or the next exhibit and the way, who's nearby, what e would do); and \"What happens\" along the bottom. The tile under the pointer lights up and the bottom line says what it is and what a right-click offers. The key hints at the bottom are buttons."),
    sign("scene-screen", "f", "The scene screen", ["The scene screen"],
      "A scene is a conversation in turns, each in its own box, with the place drawn from above beside it (on a terminal 100 columns wide or more): point at anyone or anything there to see what it is, and right-click for what you can do (a glance, a word, give, take, break, a spell), done as your turn. Plain words are said; *asterisks* or (brackets) are done. Dice lines have 🎲, news lines ⓘ. The GM's reply streams in. The Theatre has scenes to try."),
    sign("slash-commands", "g", "Slash commands", ["Slash commands"],
      "In a scene: /sheet, /map, /journal, /help and /report (a problem: what went wrong, saved for Claude) work any time, even with the GM mid-sentence; /save and /quit (to the title). For testing, /exits lists the scene's endings and /end <id> takes one now: the way to see any ending offline. Any unique start works (/sh), and a bare slash gets a word of advice."),
    sign("way-on", "h", "A scene that's over, and the way on", ["A scene that's over, and the way on"],
      "When a scene ends its last reply stays up, and the box becomes the way on: to the fight, on with Kell, back to the map. Only an Enter of its own goes on; a line being typed as the scene ended goes unsaid, rather than walking you off into the next screen."),
    sign("overlays", "i", "Overlays", ["Overlays: the scene map, the notebook, help, the menu"],
      "? shows how to play the screen you're on; j the notebook; Esc the menu (save, back to the title, quit, report a problem); /map, in a scene, the scene's place on the map with its roof off. A click outside any of them closes it."),
    sign("notebook", "j", "The notebook", ["The notebook"],
      "Each scene's ending writes the investigator's notebook (its exit script's journal lines), and a fight adds how it went. j opens it here too: play a scene in the Theatre, or win a fight in the Arena, and come back to see what went in."),
    sign("combat-keys", "k", "The combat screen's keys", ["The combat screen's keys"],
      "In a fight: a or Enter attack, z close in, c cast, u knock over, d dash, g dodge, x disengage, l leave, f let the dice decide, m every option, e or Space end the turn; Tab, Shift-Tab or 1-9 pick a target; s the sheet. What can't be done is said in the status line. The Arena has fights to try them in."),
    sign("the-end", "l", "The End", ["The End"],
      "THE END in block letters, the last scene's closing words, how each scene ended, and the GM's bar tab for the sitting (the King has graciously declined to pay it). In the story it comes after the King's morning. The zoo has no end, so pull the curtain cord beside this sign for The End of your visit so far (the booths you've played are its chapters); Enter brings you back to the hall.",
      [{ id: "ring-down", label: "Pull the curtain cord (The End, for your visit so far)", at: { x: 31, y: 11 }, station: { name: "the curtain cord", glyph: "¡", color: "#c84040" },
        run: z => ({ text: theEnd(z.session), show: "end" }) }]),
    sign("saving", "m", "Saving, resuming and recovering", ["Saving, resuming and recovering"],
      "The game saves as it goes (runs/sessions/<id>/: game.json, state.json, app.json), Ctrl+C saves and quits, and Continue picks up wherever you were, mid-fight included. A turn that fails part-way goes back to the last save. The zoo saves the same way, under its own visits. Something wrong? b reports it (/report in a scene, Report a problem… in the menu): what you say, the screen and the game's files and calls, saved under runs/reports for Claude to look into (in a browser, it's downloaded)."),
    sign("mouse", "n", "The mouse", ["The mouse"],
      "Nearly everything is a button: key hints, choices, the way on, menus, the title, the sheet's tabs, the initiative list. Buttons light up under the pointer and fire on release. Click to walk, right-click to act; in a fight, click a blue tile to move and someone to aim at."),
    sign("browser", "0", "The game in a browser", ["The game in a browser"],
      "npm run web serves the same terminal game in xterm.js, one game per browser tab, over a WebSocket. It asks for an OpenRouter key (checked, never logged) or offers to look round offline. ?font=17 and ?size=130x42 set the font and the size. npm run build:web makes the whole game a static site, as the PR previews publish it: the game runs in the page itself, in a Web Worker, its saves in the browser and the key kept there, one tab at a time. On a page, Esc on the title doesn't close the game (q does). The zoo is on its title screen in both."),
    sign("settings", "p", "Settings", ["Settings"],
      "Environment variables: COLORTERM=truecolor (in 256 colours the lamplight goes grey), KM_GLYPHS, KM_RUNS_DIR, KM_APP_STEP_MS (walking), KM_APP_COMBAT_DELAY_MS (the other side's turns), KM_APP_TALK_MS (Kell's lines), KM_LOOK_MODEL=off, KM_LOOK_CACHE, and OPENROUTER_API_KEY=offline (no GM: the zoo still works, but its scenes are silent)."),
    sign("clock", "q", "The clock", ["Coloured light and the time of day"],
      "The time of day is the light everywhere: morning gold, plain afternoon, an evening with the lamps lit, a blue night lit only by what burns, the next morning. In the story the hour moves on as scenes end; here the clock does it. Wind it on and look round any wing.",
      [{
        id: "clock-on", label: "Wind the clock on", at: at.K!, station: { name: "the clock", glyph: "◷", color: "#e8d8a0" },
        run: z => {
          const next = TIMES[(TIMES.indexOf(z.game.story.time) + 1) % TIMES.length]!;
          z.game.story.time = next;
          exploreState(z.game);
          return { text: `The clock strikes. It's ${TIME_WORDS[next]}, everywhere in the zoo.`, cues: [{ kind: "effect", effect: "sparks", at: { id: "player" }, color: "#e8d8a0", amount: 0.4 }] };
        },
      }, {
        id: "clock-back", label: "Set the clock back to morning", at: at.K!,
        when: z => z.game.story.time !== "morning",
        run: z => { z.game.story.time = "morning"; exploreState(z.game); return { text: `The clock goes back to ${TIME_WORDS.morning}. Time in the zoo is a matter of opinion.` }; },
      }]),
    sign("glyphs", "r", "Glyph sets", ["Glyph sets and the Kingmaker Glyphs font"],
      "KM_GLYPHS picks how everything is drawn: ascii (the default), nerd (Nerd Font icons for things, people keep their letters), plain (seven-bit), or kingmaker (the game's own pixel-art sprites, from its own font: npm run glyphs installs it). Pull the lever to change the whole game's set until you pull it again. Plain text, as the QA console reads it, is always quiet.",
      [{
        id: "glyph-lever", label: "Pull the lever (the next glyph set)", at: at.L!, station: { name: "the glyph lever", glyph: "╤", color: "#c8b28a" },
        run: () => {
          const next = SETS[(SETS.indexOf(glyphSet()) + 1) % SETS.length]!;
          setGlyphSet(next);
          return { text: `Clunk. Everything is drawn in ${SET_WORDS[next]}.` };
        },
      }], false, { tour: ["glyph-lever", "glyph-lever", "glyph-lever", "glyph-lever"] }),
    sign("look-gallery", "1", "The look gallery", ["The look gallery"],
      "Eight animated vignettes on the story's own worlds with the real physics: the Rat at night, the yard after rain, grain dust, douse and burn, new things, glyph sets, time and weather, the sprites. node --experimental-ffi --no-warnings --import tsx src/game/look/gallery.tsx. The zoo is its interactive cousin."),
    sign("frames", "2", "Headless frames and demos", ["Headless frames and demos"],
      "Pictures without a terminal: src/game/look/dump.ts writes the gallery's frames, frames.ts the game's own views, map/demo.ts a tour of the map, xray-demo.ts and xray-audit.ts the x-ray. The zoo has a tour of its own (src/game/zoo/tour.ts) that sets off every exhibit and saves what each showed."),
    sign("qa-console", "3", "The QA console", ["The QA console"],
      "npm run qa: the same game without the screen, by action id. new, observe, act --id, say, end --exit, sheet, map, transcript, dump. qa new --zoo starts a zoo visit there: every exhibit's trigger is an action (use_...), and the signs are examine_sign_..."),
    sign("scene-harness", "4", "The scene harness", ["The scene harness", "Approaches (scene harness and evals)"],
      "npm run scene and npm run play: any scene with any approach (gm, actors, stall, staged secrets, pressure rolls...), say, status, world (the scribe), play interactively. The game always plays v2; the Theatre's rehearsals play the story's scenes with it."),
    sign("places-from-a-plan", "5", "Places from a description", ["Places from a description (map generation)"],
      "The fast model writes a terse plan of a place; a compiler lays it out deterministically and the game's renderer checks it. Mother Tallow's chandlery, through the Town Annexe's east door, was compiled from a plan written by hand, with no model: the same compiler, the same checks. node --no-warnings src/game/map/generate/bench.ts --text \"a tannery by the river\" makes one with the model."),
    sign("smoke-tests", "6", "Smoke tests and checks", ["Smoke tests and checks"],
      "python3 src/app/smoke/smoke.py plays the whole story offline under a pty, mouse and all; scene-check and screens-check test every screen at 80 to 160 columns; flow.ts and caster.ts play headless; web:check and web:static-check drive a browser (the server's game, and the static build, this zoo included), and web:tui-check holds the browser's own OpenTUI to the real one, cell for cell. node --no-warnings src/game/zoo/tour.ts sets off every exhibit here."),
    sign("evals", "7", "Evals", ["Evals"],
      "npm run eval runs decision, pacing, pressure, memory and repair cases on fixture states of the scenes, judged by a model; compare and rejudge go with it. QA failures become cases from per-turn snapshots."),
    sign("stand-ins", "8", "Unused stand-ins", ["Unused stand-ins"],
      "Before the map and the tactical fights there were stand-ins: a text explorer of places and paths (src/game/places.ts), and a fight settled in one action (src/game/fight-standin.ts). Neither is wired in now; the fight stand-in only carries on a fight it saved itself. They stay as museum pieces, which makes this sign a museum piece about museum pieces."),
  ],
};
