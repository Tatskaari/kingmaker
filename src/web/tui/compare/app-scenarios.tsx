import type { ReactNode } from "react";
import { sceneById } from "../../../../scenes/index.ts";
import { Game, talkBetween, type Line } from "../../../app/game.ts";
import type { Resumable } from "../../../app/save.ts";
import { BetweenScreen } from "../../../app/ui/between.tsx";
import { CombatScreen } from "../../../app/ui/combat.tsx";
import { BackstoryScreen, ChooseScreen, CreatedScreen, CreateScreen, CustomScreen } from "../../../app/ui/create.tsx";
import { ownBuild, srdLists, threeBuilds } from "../../../rules/builds.ts";
import { EndScreen } from "../../../app/ui/end.tsx";
import { ExploreScreen } from "../../../app/ui/explore.tsx";
import { Overlay } from "../../../app/ui/overlay.tsx";
import { SceneScreen } from "../../../app/ui/scene.tsx";
import { TitleScreen } from "../../../app/ui/title.tsx";
import { pregenSession, PREGENS, TacticalFight } from "../../../game/combat/index.ts";
import { mapFights } from "../../../game/fights.ts";
import { registerLookCanvas } from "../../../game/look/opentui.ts";
import { Game as Core, type Action, type GameState } from "../../../game/play.ts";
import { actionsAt, leadTarget, town } from "../../../game/town.ts";
import { sheetData } from "../../../rules/dnd.ts";
import { presentCast } from "../../../runtime/brief.ts";
import { forceEnding } from "../../../runtime/engine.ts";
import type { Suggestion } from "../../../runtime/session.ts";
import { buildWorld, joinWorld } from "../../../world/scene-world.ts";
import { placePlayer, WELCOME } from "../../../game/zoo/explorer.ts";
import { newZoo } from "../../../game/zoo/game.ts";
import type { Scenario } from "./scenarios.tsx";

/**
 * The game's own screens for the comparison, set up as src/app/smoke's checks set them up (a
 * ready-made character, no model calls): the title, making a character, the map, a scene mid-talk
 * and once it's over, Kell between scenes, the fight, the End and the overlays, and the zoo (its
 * hall, a sign's card, the view from above, a wizard's sheet, the action menu), at the sizes the
 * game is played at.
 */

registerLookCanvas();
process.env.KM_APP_TALK_MS = "0";

const core = await Core.create({ player: "Tamsin Vell: a disgraced palace auditor", level: 3, seed: 7, build: PREGENS.rogue!.build, explorer: town, fights: mapFights() });

const session = await pregenSession({ pregen: "rogue", name: "Tamsin Vell", level: 3, seed: 3, sceneId: "hanged-clerk" });
const granary = sceneById("hanged-clerk");
Object.assign(session, { beat: granary.start });
const cast = presentCast(granary, session);
session.world = buildWorld(granary.id, granary.world!, cast.map(c => ({ id: c.id, name: c.name })), session.player);
joinWorld(session.world, cast.map(c => ({ id: c.id, name: c.name })), 0);

const lines: Line[] = [
  { kind: "header", speaker: "system", name: granary.title, text: granary.hook },
  { kind: "narration", speaker: "gm", text: "The yard behind the King's Granary smells of wet grain and pigeons. Wendell Prout turns slowly on the sack hoist above the shut loft door, and a scrawny boy in enormous boots is lobbing gutter stones at him with a running commentary." },
  { kind: "dialogue", speaker: "kell", name: "Sergeant Agnes Kell", text: "“Sergeant Kell, of the watch. The Captain says suicide.” She does not say what she says. “Investigator.”" },
  { kind: "player", speaker: "player", name: "Tamsin Vell", text: "\"Morning, Sergeant. What have we got?\" I look up at the body, then at the boy with the stones, and I take out my notebook so that everybody can see that I have one too." },
  { kind: "roll", speaker: "dice", text: "Medicine check to examine Prout for signs he was killed before he was hanged: 11 + 1 = 12 vs DC 12: success" },
  { kind: "narration", speaker: "gm", text: "Up close, from the loft ladder, Prout's neck tells a different story from the Captain's: the rope mark rides high and clean, and under it, lower down, there is a second, darker bruise where a thumb pressed hard.\n\nSomebody held him first. The rope came after." },
  { kind: "player", speaker: "player", name: "Tamsin Vell", text: "*throws my javelin at the rope to bring him down*" },
  { kind: "info", speaker: "dice", text: "You no longer have your javelin" },
  { kind: "dialogue", speaker: "kell", name: "Sergeant Agnes Kell", text: "“That's a javelin in the King's granary wall, investigator.” She writes it down. “Noted.”" },
];
const choices: Action[] = [
  { id: "say_1", label: "“Who cut him down last time, Sergeant?”", kind: "say" },
  { id: "say_2", label: "*looks at the girl's fist*", kind: "say" },
  { id: "say_goodbye", label: "I'll leave you to it.", kind: "say" },
  { id: "walk_on", label: "Walk on without a word (back to the map)", kind: "move" },
];
const ended: Line = { kind: "system", speaker: "system", text: "Scene ends: The case is made" };
const talk = talkBetween({ id: "kell", name: "Sergeant Kell" }, {
  notebook: ["Wendell Prout didn't hang himself. The trail leads to Master Sallow of the Royal Purveyor's office."],
  lead: "Kell stays beside you as the yard empties; by dusk the watch-house has a name for the big man with the bandaged hand, and a place: the Drowned Rat, halfway down the river stairs.",
  next: { id: "drowned-rat", title: "The Drowned Rat" }, way: "the Drowned Rat ↓ 22 paces", time: "evening",
});

function sceneGame(mode: "scene" | "explore"): Game {
  const game = new Game();
  game.core = { session, state: { version: 1, id: "check", mode, story: { time: mode === "scene" ? "morning" : "evening", played: [], flags: {} }, explore: {}, recent: [] }, observe: () => ({ mode, text: "", actions: [] }) } as unknown as Game["core"];
  return game;
}

/** A scene's suggested lines (src/runtime/suggest.ts), one of each kind and a second to say. */
const SUGGESTED: Suggestion[] = [
  { kind: "say", text: "Sergeant, who found him, and when?" },
  { kind: "say", text: "Nice boots. Yours?" },
  { kind: "do", text: "(I look up at the body)" },
  { kind: "try", text: "(I try to coax the boy down from his stones with a pie)" },
  { kind: "leave", text: "(I leave the yard to the pigeons)" },
];

/** The scene, with its suggested lines for this moment in the session (a copy of it, so the other scenes' have none). */
function suggestedGame(): Game {
  const own = { ...session, suggestions: { scene: granary.id, turn: session.turn, lines: SUGGESTED } };
  const game = new Game();
  game.core = { session: own, state: { version: 1, id: "check", mode: "scene", story: { time: "morning", played: [], flags: {} }, explore: {}, recent: [] }, observe: () => ({ mode: "scene", text: "", actions: [] }), suggestionsOn: true } as unknown as Game["core"];
  game.screen = "scene";
  game.lines = lines;
  return game;
}

function exploreGame(): Game {
  const game = new Game();
  game.core = core;
  game.screen = "explore";
  game.messages = ["Morning, on the eve of the Assembly. The clerk of the King's Granary has been found hanged in the granary yard."];
  return game;
}

// The fight at the Heron, as screens-check sets it up.
const heronSession = await pregenSession({ pregen: "fighter", level: 3, seed: 2 });
Object.assign(heronSession, { sceneId: "heron-warehouse", beat: "midnight", entered: ["sallow"] });
heronSession.established.push("Master Sallow has come to the Heron.");
const heron = sceneById("heron-warehouse");
const heronCast = presentCast(heron, heronSession);
heronSession.world = buildWorld(heron.id, heron.world!, heronCast.map(c => ({ id: c.id, name: c.name })), heronSession.player);
joinWorld(heronSession.world, heronCast.map(c => ({ id: c.id, name: c.name, ...(c.members ? { members: c.members } : {}) })), 0);
forceEnding(heronSession, "fight");
const fightState: GameState = { version: 1, id: "check", mode: "combat", story: { time: "night", played: [], flags: {} }, explore: {}, recent: [] };
const fight = (await mapFights().start(fightState, heronSession)) as TacticalFight;
const fightCore = { state: fightState, session: heronSession, currentFight: fight, observe: () => ({ mode: "combat", text: "", actions: [] }) } as unknown as Core;

const sheet = await sheetData(core.session);

// Character creation, as screens-check sets it up: three builds offered offline (the class defaults
// the concept's words suggest), the first chosen, a backstory with a draft waiting and a lore issue.
const CONCEPT = "a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier";
const offer = await threeBuilds("Tamsin Vell", CONCEPT, 3, {});
const STORY = "I kept the accounts of a Saltmere grain factor for nine years, until the night I found the error that wasn't one.\n\nI owe Fat Jory three crowns, and my sister Ada a letter.";
const DRAFT = "I was born above a chandler's shop on Tallow Lane, where the candles were cheap and the arguments cheaper.\n\nMy mother taught me to count; my father taught me to lie about it. I kept a factor's books for nine years, until the night I found an error that wasn't one, and said so, loudly, in front of the wrong man.";
const LONG_ISSUE = {
  quote: "I kept the accounts of a Saltmere grain factor for nine years, until the night I found the error that wasn't one.",
  problem: "Saltmere's grain factors keep their own books in Saltmere, under seal, and a Caerwyn clerk couldn't have kept one's accounts for nine years without the Purveyor's office knowing her name, which the story's people don't.",
  fix: "I kept the accounts of a Caerwyn corn-chandler for nine years, until the night I found an error that wasn't one, and learned that some sums are better left unchecked.",
};
const LONG_STORY = Array.from({ length: 16 }, (_, i) => `In my ${i + 1}${["st", "nd", "rd"][i] ?? "th"} year at the counting-house I learned that the Purveyor's office kept two sets of books, and that I would only ever see one.`).join("\n");
function creationGame(screen: "choose" | "custom" | "backstory"): Game {
  const game = new Game();
  game.screen = screen;
  game.creation = { name: "Tamsin Vell", concept: CONCEPT, offer, index: 1, story: STORY, version: 1, issue: 0, chosen: offer.options[0]! };
  return game;
}
const storied = await pregenSession({ pregen: "rogue", name: "Tamsin Vell", level: 3, seed: 3, sceneId: "hanged-clerk" });
storied.player.backstory = { text: STORY, summary: "Tamsin Vell kept a grain factor's books until she found an error that wasn't one; she owes Fat Jory three crowns.", personality: ["Sharp-tongued", "Counts everything twice"], ideals: ["The books should balance"], bonds: ["Her sister Ada, owed a letter"], flaws: ["Owes Fat Jory three crowns"] };
const storySheet = await sheetData(storied);
const ownLists = await srdLists(3);
const ownOption = await ownBuild({ speciesId: "orc", classId: "wizard", subclassId: "evoker", backgroundId: "soldier" }, 3, "Tamsin Vell");

// The zoo (src/game/zoo), as screens-check sets it up: its hall on the map, by the wardrobe.
const zooCore = await newZoo({ seed: 4 });
placePlayer(zooCore.state, "zoo-hall", { x: 4, y: 8 });
const zooSheet = await sheetData(zooCore.session);

function zooGame(): Game {
  const game = new Game();
  game.core = zooCore;
  game.screen = "explore";
  game.messages = [WELCOME];
  return game;
}

const sizes = (name: string, list: Array<[number, number]>, make: () => { node: ReactNode; then?: () => void }): Scenario[] =>
  list.map(([width, height]) => {
    let then: (() => void) | undefined;
    return { name: `${name} ${width}x${height}`, width, height, node: () => { const made = make(); then = made.then; return made.node; }, steps: [{ run: () => then?.() }] };
  });

export const appScenarios: Scenario[] = [
  ...sizes("title", [[130, 42], [80, 24]], () => {
    const game = new Game();
    game.loadSaves = () => { game.saves = []; game.emit(); };
    return { node: <TitleScreen game={game} /> };
  }),
  ...sizes("title with saves", [[130, 42]], () => {
    const game = new Game();
    game.loadSaves = () => { game.saves = [{ id: "s1", game: core.state, session: core.session, mtime: Date.now() } as Resumable]; game.emit(); };
    return { node: <TitleScreen game={game} /> };
  }),
  ...sizes("create", [[130, 42], [80, 24]], () => {
    const game = new Game();
    game.screen = "create";
    return { node: <CreateScreen game={game} /> };
  }),
  ...sizes("created", [[130, 42], [100, 30]], () => {
    const game = exploreGame();
    game.screen = "created";
    game.sheet = sheet;
    return { node: <CreatedScreen game={game} /> };
  }),
  ...sizes("choose", [[130, 42], [80, 24]], () => ({ node: <ChooseScreen game={creationGame("choose")} /> })),
  ...sizes("custom", [[130, 42], [80, 24]], () => {
    const game = creationGame("custom");
    game.creation!.own = { picks: { speciesId: "orc", classId: "wizard", subclassId: "evoker", backgroundId: "soldier" }, lists: ownLists, column: 1, option: ownOption };
    return { node: <CustomScreen game={game} /> };
  }),
  ...sizes("backstory", [[130, 42], [80, 24]], () => ({ node: <BackstoryScreen game={creationGame("backstory")} /> })),
  // Written in: typed at the end of what's there, a new paragraph, and a click back into the first line to add a word.
  ...[[130, 42], [80, 24]].map(([width, height]): Scenario => ({
    name: `backstory typed ${width}x${height}`, width: width!, height: height!,
    node: () => <BackstoryScreen game={creationGame("backstory")} />,
    // The click is on the first line's "kept" (the box's first row of text: row 8 of 130x42, row 3 of 80x24).
    steps: [{ wait: 20 }, { type: " The river took my father the same spring." }, { keys: ["RETURN", "RETURN"] }, { type: "Why this case? The King asked, and I owe him for the job." }, { click: width === 130 ? [14, 8] : [5, 3] }, { type: "honest " }],
  })),
  ...sizes("backstory draft", [[130, 42], [80, 24]], () => {
    const game = creationGame("backstory");
    game.creation!.proposal = { kind: "draft", text: DRAFT };
    return { node: <BackstoryScreen game={game} /> };
  }),
  ...sizes("backstory lore issue", [[130, 42], [80, 24]], () => {
    const game = creationGame("backstory");
    game.creation!.issues = [{ quote: "a Saltmere grain factor", problem: "Saltmere's factors keep their own books in Saltmere, under seal.", fix: "a Caerwyn corn-chandler" }];
    return { node: <BackstoryScreen game={game} /> };
  }),
  // A long issue (the fix kept whole, the story above giving way), and rewriting it (what was said and suggested over the box).
  ...sizes("backstory long issue", [[100, 30], [80, 24]], () => {
    const game = creationGame("backstory");
    game.creation!.issues = [LONG_ISSUE];
    return { node: <BackstoryScreen game={game} /> };
  }),
  ...sizes("backstory rewriting", [[130, 42], [80, 24]], () => {
    const game = creationGame("backstory");
    game.creation!.rewriting = LONG_ISSUE;
    return { node: <BackstoryScreen game={game} /> };
  }),
  // A long backstory in the box: its bar, and the wheel moving the view and the cursor with it, then a word typed where the cursor went.
  ...[[130, 42], [80, 24]].map(([width, height]): Scenario => ({
    name: `backstory wheel ${width}x${height}`, width: width!, height: height!,
    node: () => { const game = creationGame("backstory"); game.creation!.story = LONG_STORY; return <BackstoryScreen game={game} />; },
    steps: [{ wait: 20 }, { scroll: [20, 10, "up"] }, { scroll: [20, 10, "up"] }, { type: "Q" }, { scroll: [20, 10, "down"] }],
  })),
  ...sizes("created unchecked", [[130, 42], [80, 24]], () => {
    const game = exploreGame();
    game.screen = "created";
    game.sheet = sheet;
    game.creation = { name: "Tamsin Vell", concept: CONCEPT, index: 0, story: STORY, version: 1, issue: 0, unchecked: "Your backstory went in as you wrote it, without the lore check: the GM couldn't be reached (OpenRouter backstory.check HTTP 401: No auth credentials found)." };
    return { node: <CreatedScreen game={game} /> };
  }),
  ...sizes("story sheet", [[130, 42], [80, 24]], () => {
    const game = exploreGame();
    game.overlay = { kind: "sheet", sheet: storySheet };
    return { node: <><ExploreScreen game={game} /><Overlay game={game} /></> };
  }),
  ...sizes("explore", [[130, 42], [80, 24], [160, 45]], () => ({ node: <ExploreScreen game={exploreGame()} /> })),
  ...sizes("explore walking", [[100, 30]], () => { const game = exploreGame(); game.walking = true; return { node: <ExploreScreen game={game} /> }; }),
  ...sizes("explore menu", [[130, 42]], () => {
    const game = exploreGame();
    const lead = leadTarget(core.state)!;
    game.menu = { ...actionsAt(core.state, core.session, lead.at), x: 40, y: 12, index: 0 };
    return { node: <ExploreScreen game={game} /> };
  }),
  ...sizes("scene", [[130, 42], [80, 24], [100, 40]], () => {
    const game = sceneGame("scene");
    game.screen = "scene"; game.lines = lines; game.choices = choices;
    return { node: <SceneScreen game={game} /> };
  }),
  // A scene's suggested lines: numbered over the box, a risky try in the dice's yellow; and the rows kept for them while they come.
  ...sizes("scene suggestions", [[130, 42], [80, 24]], () => {
    const game = suggestedGame();
    game.choices = SUGGESTED.map((s, i): Action => ({ id: `say_${i + 1}`, label: s.text, kind: "say" }));
    return { node: <SceneScreen game={game} /> };
  }),
  ...sizes("scene suggestions coming", [[80, 24]], () => {
    const game = suggestedGame();
    game.busy = "The GM makes a note…";
    game.suggestionsExpected = () => true;
    game.suggestionsComing = () => true;
    return { node: <SceneScreen game={game} /> };
  }),
  ...sizes("scene growing", [[100, 40]], () => {
    const game = sceneGame("scene");
    game.screen = "scene"; game.lines = lines.slice(0, 3);
    return { node: <SceneScreen game={game} />, then: () => { game.lines = lines; game.emit(); } };
  }),
  ...sizes("scene over", [[130, 42], [80, 24]], () => {
    const game = sceneGame("explore");
    game.screen = "scene"; game.lines = [...lines, ended]; game.over = { ready: true, ending: "The case is made" };
    game.card = { title: "Evening, on the eve of the Assembly", lines: [], next: "explore", talk };
    return { node: <SceneScreen game={game} /> };
  }),
  ...sizes("between", [[130, 42], [80, 24]], () => {
    const game = sceneGame("explore");
    game.screen = "between"; game.card = { title: "Evening, on the eve of the Assembly", lines: [], next: "explore", talk };
    return { node: <BetweenScreen game={game} /> };
  }),
  ...sizes("combat", [[130, 42], [80, 24]], () => {
    const game = new Game();
    game.core = fightCore;
    game.screen = "combat";
    return { node: <CombatScreen game={game} /> };
  }),
  // The fight's box with the keys: a line typed in it, and why the last one came to nothing, under the log.
  ...([[130, 42], [80, 24]] as const).map(([width, height]): Scenario => ({
    name: `combat typing ${width}x${height}`, width, height,
    node: () => {
      const game = new Game();
      game.core = fightCore;
      game.screen = "combat";
      game.fightBox = true;
      game.fightReply = "Fireball isn't one of your spells: the sheet (s) shows what you have.";
      return <CombatScreen game={game} />;
    },
    steps: [{ type: "Give it up, Crake! Nobody's paying you for this." }],
  })),
  // The box given the keys by Enter after it's drawn (its focus switched on, then off by Esc): the letters go in it, not to the fight's keys.
  ...([[80, 24]] as const).map(([width, height]): Scenario => ({
    name: `combat typing by key ${width}x${height}`, width, height,
    node: () => {
      const game = new Game();
      game.core = fightCore;
      game.screen = "combat";
      // Nothing's sent from here (the fake core has no say): only the keys and the box are compared.
      game.combatAct = async () => {};
      game.combatSay = async () => false;
      return <CombatScreen game={game} />;
    },
    // A b among them is a letter in the box, not the fight's b (report a problem).
    steps: [{ keys: ["RETURN"] }, { type: "bash the crake and cast a spell" }, { keys: ["ESCAPE"], wait: 100 }],
  })),
  // The GM's answer streaming into the fight's log.
  ...sizes("combat answer", [[130, 42]], () => {
    const game = new Game();
    game.core = fightCore;
    game.screen = "combat";
    game.busy = "The talking Crake is speaking…";
    game.fightLive = { who: "crake-1", text: "The talking Crake: “Two shillings, and you're not worth either of" };
    return { node: <CombatScreen game={game} /> };
  }),
  ...sizes("end", [[130, 42], [80, 24]], () => {
    const game = exploreGame();
    game.screen = "end";
    game.ending = { closing: "And that, as they say in Caerwyn, was that. The King's morning comes up grey and gold over the river, and the bells ring for the Assembly.", chapters: [{ sceneId: "hanged-clerk", title: "The Hanged Clerk", ending: "The case is made" }], spentUsd: 0.42 };
    return { node: <EndScreen game={game} /> };
  }),
  ...sizes("help", [[130, 42]], () => {
    const game = exploreGame();
    game.overlay = { kind: "help" };
    return { node: <><ExploreScreen game={game} /><Overlay game={game} /></> };
  }),
  ...sizes("menu", [[130, 42], [80, 24]], () => {
    const game = exploreGame();
    game.overlay = { kind: "menu", index: 1 };
    return { node: <><ExploreScreen game={game} /><Overlay game={game} /></> };
  }),
  ...sizes("journal", [[130, 42]], () => {
    const game = exploreGame();
    game.journal = [{ sceneId: "hanged-clerk", title: "The Hanged Clerk", ending: "The case is made", lines: ["Wendell Prout didn't hang himself.", "The trail leads to Master Sallow of the Royal Purveyor's office."] }];
    game.overlay = { kind: "journal" };
    return { node: <><ExploreScreen game={game} /><Overlay game={game} /></> };
  }),
  ...sizes("sheet", [[130, 42], [80, 24]], () => {
    const game = exploreGame();
    game.overlay = { kind: "sheet", sheet };
    return { node: <><ExploreScreen game={game} /><Overlay game={game} /></> };
  }),
  ...sizes("scene map", [[130, 42]], () => {
    const game = sceneGame("scene");
    game.screen = "scene"; game.lines = lines;
    game.overlay = { kind: "scene-map" };
    return { node: <><SceneScreen game={game} /><Overlay game={game} /></> };
  }),
  // The zoo: its map and side panel, a sign's card, the view from above, a spell's page on the sheet, the action menu.
  ...sizes("zoo", [[130, 42], [80, 24]], () => ({ node: <ExploreScreen game={zooGame()} /> })),
  ...sizes("zoo sign", [[130, 42], [80, 24]], () => {
    const game = zooGame();
    game.overlay = { kind: "sign", exhibit: "wardrobe" };
    return { node: <><ExploreScreen game={game} /><Overlay game={game} /></> };
  }),
  ...sizes("zoo from above", [[130, 42]], () => {
    const game = zooGame();
    game.overlay = { kind: "stage" };
    return { node: <><ExploreScreen game={game} /><Overlay game={game} /></> };
  }),
  ...sizes("zoo sheet", [[130, 42]], () => {
    const game = zooGame();
    game.overlay = { kind: "sheet", sheet: zooSheet };
    return { node: <><ExploreScreen game={game} /><Overlay game={game} /></> };
  }),
  ...sizes("zoo action menu", [[130, 42], [80, 24]], () => {
    const game = zooGame();
    game.openActions();
    return { node: <ExploreScreen game={game} /> };
  }),
];
