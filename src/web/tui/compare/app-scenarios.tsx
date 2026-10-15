import type { ReactNode } from "react";
import { sceneById } from "../../../../scenes/index.ts";
import { Game, talkBetween, type Line } from "../../../app/game.ts";
import type { Resumable } from "../../../app/save.ts";
import { BetweenScreen } from "../../../app/ui/between.tsx";
import { CombatScreen } from "../../../app/ui/combat.tsx";
import { CreatedScreen, CreateScreen } from "../../../app/ui/create.tsx";
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
