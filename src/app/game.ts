import { join } from "node:path";
import { Game as Core, type Action, type Explorer, type GameState } from "../game/play.ts";
import { TacticalFight, type CombatController, type TacticalFights } from "../game/combat/index.ts";
import { Director } from "../game/look/director.ts";
import { Effects } from "../game/look/effects.ts";
import { lookOf } from "../game/look/appearance.ts";
import { glyphSet, setGlyphSet } from "../game/look/glyphs.ts";
import { mapFights } from "../game/fights.ts";
import { getMap, isDoorway, pathTo, SCREEN_KEYS, steer, steps, tileName, walkPlan, type ExploreState } from "../game/map/index.ts";
import type { AimAt, AimView, MenuItem, MenuView } from "../game/menu.ts";
import { actionMenu, actionsAt, aimAt as aimAtTile, aimFor, exploreState, interactLabel, leadTarget, town, walkId, type LeadTarget, type TileActions } from "../game/town.ts";
import { townWorld } from "../game/town-world.ts";
import type { StoryState, Tile2 } from "../game/types.ts";
import { fightEffects } from "../game/views.ts";
import { EXHIBITS, WELCOME, zoo } from "../game/zoo/explorer.ts";
import { zooFights } from "../game/zoo/fights.ts";
import { newZoo } from "../game/zoo/game.ts";
import { lookFor, playNews, type Look } from "../game/zoo/look.ts";
import { zooOf } from "../game/zoo/model.ts";
import { modelOffline, setCallLog, type Ask } from "../llm/openrouter.ts";
import { applyFix, checkLore, draftBackstory, finishBackstory, tooLong, workIn, type LoreIssue } from "../lore/backstory.ts";
import { fileReport, type Where } from "../report/dump.ts";
import { noteError, noteGame, recentScreens } from "../report/recent.ts";
import { ownBuild, picksOf, srdLists, threeBuilds, type BuildOption, type Offer, type OwnPicks, type SrdLists } from "../rules/builds.ts";
import { sheetData, spellInfo, type Build, type SheetData } from "../rules/dnd.ts";
import { sceneEntries, unnamed } from "../runtime/brief.ts";
import { thingActions, type SceneContext, type SceneTarget, type SpellFacts, type ThingActions } from "../game/scene-menu.ts";
import type { TurnHooks } from "../runtime/engine.ts";
import { speakersOf } from "../runtime/knowledge.ts";
import { speechIn, withSpeakers, type Markup } from "../runtime/markup.ts";
import { sessionDir, type Backstory, type Entry, type EntryKind, type SessionState, type Suggestion } from "../runtime/session.ts";
import { currentSuggestions, suggesting } from "../runtime/suggest.ts";
import type { SceneWorld } from "../world/scene-world.ts";
import { sceneById } from "../../scenes/index.ts";
import { talkOf } from "../../scenes/talk.ts";
import { repairCampaign } from "./rules-repair.ts";
import { deleteSave, latestGame, loadExtras, resumable, saveExtras, zooVisits, type JournalEntry, type Resumable } from "./save.ts";
import { DEFAULT_CONCEPT, DEFAULT_NAME, epilogue, leadWay, LEVEL, notebookLines, TIME_WORDS, type Epilogue } from "./story.ts";
import { C } from "./theme.ts";

/** The story's map and fights (Caerwyn), or a hub's (the zoo: src/game/zoo), by what a game is. */
const explorerFor = (game: Pick<GameState, "hub"> | undefined): Explorer => (game?.hub === "zoo" ? zoo : town);

/**
 * The game as the terminal UI sees it. The story flow is the game core's (src/game/play.ts: explore,
 * scene, combat, the end, and what links them), with Caerwyn on the map (src/game/town.ts) and
 * fights on the scene's own place (src/game/fights.ts): the same game the QA console plays. This
 * holds what the screens need on top: which screen is up, the transcript with the GM's reply
 * streaming in, the cards between scenes, the notebook, overlays, the fight's target, and pacing.
 * It holds no React; screens subscribe and redraw when it changes.
 */

/**
 * The screens. Making a character goes create (a name and a concept), creating (the builds being
 * made), choose (three builds, as cards), custom (one of the player's own making), backstory (theirs
 * to write, draft or work in, then the lore check), creating again (into the story), created (the sheet).
 */
export type Screen = "title" | "create" | "creating" | "choose" | "custom" | "backstory" | "created" | "explore" | "scene" | "between" | "combat" | "end";

/**
 * Character creation, from the concept to the sheet: the three builds offered, the one chosen (or
 * made), and the backstory, its draft or its notes worked in, and what the lore check found.
 */
export interface Creation {
  name: string;
  concept: string;
  /** The three builds offered for the concept, and why they're the class defaults when they are. */
  offer?: Offer;
  /** The build picked out on the choose screen: 0-2 the cards, 3 "Make my own". */
  index: number;
  /** The player's own build, being made: their picks, what they pick from, which list has the keys, and what it comes to. */
  own?: { picks: OwnPicks; lists: SrdLists; column: number; option?: BuildOption; making?: boolean };
  /** The build chosen: what the character is made from. */
  chosen?: BuildOption;
  /** The backstory as the box last had it (the box's own while it's on screen). */
  story: string;
  /** Bumped when the box's text is replaced from outside (a draft taken, a fix accepted): the box starts again with it. */
  version: number;
  /** A draft, or the player's notes worked in, shown and waiting: it's never in the box until they take it. */
  proposal?: { kind: "draft" | "work"; text: string };
  /** What the lore check found, one at a time: what doesn't fit, and a fix that keeps its spirit. */
  issues?: LoreIssue[];
  issue: number;
  /** The issue they chose to rewrite themselves: it stays over the box while they do. */
  rewriting?: LoreIssue;
  /** The fixes taken are being checked once more (the issues on show are that second look's): not a third time. */
  again?: boolean;
  /** What the model's part is doing (the spinner's word). */
  busy?: string;
  /** A word for the player: the GM offline, couldn't be reached, nothing to work in. */
  note?: string;
  /** Why the backstory went into the game without the lore check (the GM offline, or out of reach): the sheet says so over it. */
  unchecked?: string;
  /** The game made from this creation (its session id), until they set off: choosing again puts it away. */
  made?: string;
}

export interface Line {
  /**
   * "info": the rules' word on what changed without a roll (what you carry, what's burning); "roll"
   * keeps the dice. "look": a glance at something in the place (the menu's Look), a quiet note of
   * the screen's own: it isn't a turn, and the GM never hears it.
   */
  kind: EntryKind | "header" | "error" | "info" | "look";
  /** Speaker id (a cast id, "gm", "player", "dice", "system"). */
  speaker: string;
  /** Display name for dialogue and the player. */
  name?: string;
  text: string;
  /** The scene it's in: the next scene's opening can stream in while the last one is still on screen. */
  scene?: string;
  /** A GM reply's markup: who says each line, and its marked phrases (src/runtime/markup.ts). */
  marked?: Markup;
}

export interface Card {
  title: string;
  lines: string[];
  /** Still working: show the spinner, ignore Enter. */
  working?: string;
  /** Where Enter goes from here. */
  next?: "explore" | "combat" | "scene" | "end";
  /** The card told as a conversation, by whoever walks with the player (Kell reads the notebook back). */
  talk?: Line[];
}

/** A scene that's over, still on screen until the player goes on. */
export interface Over {
  /** The story has finished moving on: where Continue goes is known. */
  ready: boolean;
  /** The player asked to go on before it was ready: go as soon as it is. */
  queued?: boolean;
  /** How the scene ended (its exit's title), once known. */
  ending?: string;
  /** Lines to carry over into the next scene (a summons that went wrong on the way). */
  carry?: Line[];
}

/** The scene's commands, typed with a / (or the old #): what each one does, for the help and the hints. */
export const COMMANDS: Array<{ name: string; what: string; testing?: boolean }> = [
  { name: "sheet", what: "your character sheet" },
  { name: "map", what: "the scene's place on the map" },
  { name: "journal", what: "the investigator's notebook" },
  { name: "help", what: "how to play" },
  { name: "report", what: "[what went wrong]: report a problem, saved for Claude" },
  { name: "suggestions", what: "[on|off]: the suggested lines over the box" },
  { name: "save", what: "save the game" },
  { name: "quit", what: "save, and back to the title" },
  { name: "exits", what: "the scene's endings (for testing)", testing: true },
  { name: "end", what: "<exit>: take an ending now (for testing)", testing: true },
];

/** A typed command by name, alias, or the start of one ("/sh" is the sheet; "/s" could be the sheet or a save, so it's neither). */
export function commandNamed(typed: string): string | undefined {
  const t = typed.toLowerCase();
  const alias: Record<string, string> = { c: "sheet", "?": "help", j: "journal", notebook: "journal" };
  if (alias[t]) return alias[t];
  if (COMMANDS.some(c => c.name === t)) return t;
  const starts = t ? COMMANDS.filter(c => c.name.startsWith(t)) : [];
  return starts.length === 1 ? starts[0]!.name : undefined;
}

/**
 * Does a rules line have a roll in it (a check, a save, an attack, damage, a spell's burst)? The
 * rest are the rules' word on what changed: what you carry ("You no longer have your javelin"),
 * what's burning, what you are now. Those get their own mark, so the dice mean dice.
 */
export function isRoll(text: string): boolean {
  return /\d+\s*[+-]\s*\d+\s*=\s*-?\d+|\bvs (?:DC|AC) \d+|\b\d*d\d+\b|\btakes? \d+\b.*\bdamage\b|\bregains? \d+ HP\b|^(?:Cast|Damage|Jump|Fall|Grapple|Shove|Hit Die)\b|: unharmed by\b|\bdarts? at\b/i.test(text);
}

/** The map's menu for a tile (a right-click): what's there, what can be done with it, where it opened. */
export interface TileMenu extends TileActions {
  /** Where on screen it was asked for. */
  x: number;
  y: number;
  /** The highlighted choice. */
  index: number;
}

/**
 * The scene's menu for what's in its place (a right-click on the place, or on a line of the list
 * under it, or Enter on what Tab picked out): what it is, what can be done with it (the map menu's
 * kind of actions, worded for the scene: src/game/scene-menu.ts), where it opened.
 */
export interface SceneMenu extends ThingActions {
  target: SceneTarget;
  /** Where on screen it was asked for. */
  x: number;
  y: number;
  /** The highlighted choice. */
  index: number;
  /** The menu this one was chosen from (what to give, which spell, something else that's there). */
  parent?: SceneMenu;
}

/** The action menu (m on the map, a right-click's "Do something…"): what's on offer, and which entry is picked out. */
export interface DoMenu {
  view: MenuView;
  /** The picked-out entry: an index into entriesOf(view). */
  index: number;
  /** Where its list starts on screen (it scrolls only to keep the picked-out entry on show). */
  top: number;
  /** Where on screen it was asked for (a right-click), when it was. */
  x?: number;
  y?: number;
}

/** Every entry of a menu, in the order its sections list them. */
export const entriesOf = (view: MenuView): MenuItem[] => view.sections.flatMap(s => s.entries);

/** Aiming one of the menu's entries on the map: the pointer or the cursor keys pick a tile, a click or Enter does it. */
export interface Aiming {
  item: MenuItem;
  view: AimView;
  /** The tile aimed at. */
  at: Tile2;
  /** What it would do there (or why not). */
  check?: AimAt;
  /** Which of the targets in reach Tab is on. */
  index: number;
  /** An area that would catch you, asked about once already: the next Enter or click does it. */
  confirm?: boolean;
}

export type Overlay =
  | { kind: "sheet"; sheet?: SheetData; error?: string }
  | { kind: "help" }
  | { kind: "journal" }
  | { kind: "scene-map" }
  | { kind: "menu"; index: number }
  | { kind: "spells"; spells: Array<{ id: string; name: string; level: number }>; index: number }
  | { kind: "actions"; index: number; top: number }
  /** A zoo wing's world from above (v), as a scene's stage draws its place. */
  | { kind: "stage" }
  /** A zoo sign read, in full, with what can be set off by it (by its exhibit's id). */
  | { kind: "sign"; exhibit: string }
  /** What happens, in full: the last few things said on the map (r, or a click on the box). */
  | { kind: "log" }
  /** The window onto the story's first morning (the zoo's hall): Caerwyn as a new game has it. */
  | { kind: "window" }
  /**
   * Reporting a problem: what went wrong (a line or two), then where the report went. `screen` is
   * what was on screen as it was asked for, and `from` what was open over it (the sheet, the help).
   */
  | { kind: "report"; screen?: string; from?: string; sending?: boolean; said?: string; failed?: boolean; problem?: string }
  /**
   * A marked phrase opened (a click, or Enter on what Tab picked out): the note on it, and what
   * the player knows of what it's about. By the line it's in (an index into `lines`) and its place in
   * that line's marks; where on screen it was clicked, when it was.
   */
  | { kind: "mark"; line: number; mark: number; x?: number; y?: number };

/** A fight's answer that holds a line for a second word (TacticalFight.say): the box keeps the line, for Enter to say it again. */
const SAY_AGAIN = /Say it again to do it anyway/;

/** What the GM is up to while they have the floor: the spinner's lines, dry and varied (each fits 80 columns). */
export const GM_BUSY = [
  "The GM is thinking…", "The GM consults their notes…", "The GM rolls something behind the screen and won't say what…", "The GM is doing the voices…",
  "The GM looks up the rules, then decides against them…", "The GM pretends this was the plan all along…", "The GM consults a table that may not exist…",
  "The GM weighs what it would cost them to say yes…", "The GM imagines several ways this goes wrong…", "The GM imagines one way this goes right…",
  "The GM drafts the consequences in pencil…", "The GM sharpens a DC…", "The GM asks what everyone here actually wants…",
  "The GM counts the exits, and who's nearest them…", "The GM has a quiet word with the dice…", "The GM rereads your character sheet, suspiciously…",
  "The GM hums, which is rarely good news…", "The GM stacks the dice into a small, thoughtful tower…", "The GM decides how much trouble you're in…",
  "The GM works out who'd be first to run…", "The GM leafs through the prep for a page that isn't there…", "The GM consults the book of consequences…",
  "The GM asks the world what it would do about that…", "The GM writes something down and underlines it twice…", "The GM looks at you over the screen for a long moment…",
];
/** A considered turn (the GM ruling on what the player attempted, before the reply) opens on this; GM_BUSY's lines follow, a step at a time. */
export const CONSIDERING = "The GM is considering the ramifications of your actions…";

/**
 * The spinner's lines, dealt like cards: each line once, in a shuffled order, then a fresh deal;
 * never the same line twice running (a deal doesn't start with the line on screen).
 */
export class BusyLines {
  private deck: string[] = [];
  private readonly lines: readonly string[];
  private readonly random: () => number;
  constructor(lines: readonly string[] = GM_BUSY, random: () => number = Math.random) {
    this.lines = lines;
    this.random = random;
  }
  /** The next line, other than `showing` (the line on screen now). */
  next(showing?: string): string {
    for (let deal = 0; deal < 2; deal++) {
      if (!this.deck.length) {
        this.deck = [...this.lines];
        for (let i = this.deck.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [this.deck[i], this.deck[j]] = [this.deck[j]!, this.deck[i]!]; }
      }
      const at = this.deck.findIndex(l => l !== showing);
      if (at >= 0) return this.deck.splice(at, 1)[0]!;
      // Only the line on screen is left in this deal: deal afresh.
      this.deck = [];
    }
    return showing ?? this.lines[0] ?? "…";
  }
}
const DELAY = () => Number(process.env.KM_APP_COMBAT_DELAY_MS ?? 450);
const STEP_MS = () => Number(process.env.KM_APP_STEP_MS ?? 45);

export class Game {
  screen: Screen = "title";
  saves: Resumable[] = [];
  /** The latest zoo visit, if there is one: the title's zoo carries it on. */
  zooVisit?: Resumable;
  core?: Core;
  /** Fights for the story (on its scenes' places), and for the zoo (its arena too): one of each, both paced. */
  private readonly storyFights = mapFights();
  private readonly zooFights = zooFights();
  /** The explorer for the game on screen: Caerwyn, or the zoo. */
  get explorer(): Explorer { return explorerFor(this.core?.state); }
  get fights(): TacticalFights { return this.fightsFor(this.core?.state); }
  private fightsFor(game: Pick<GameState, "hub"> | undefined): TacticalFights { return game?.hub === "zoo" ? this.zooFights : this.storyFights; }
  /** A zoo visit is on screen. */
  get isZoo(): boolean { return this.core?.state.hub === "zoo"; }
  messages: string[] = [];
  journal: JournalEntry[] = [];
  lines: Line[] = [];
  live?: Line;
  busy?: string;
  status?: string;
  card?: Card;
  /** The player's chosen target in a fight (an index into fightTargets()). */
  targetIndex = 0;
  /** Who's aimed at: held by id, so someone else moving doesn't change it (the list is sorted by distance). */
  targetId: string | undefined;
  /**
   * The fight's box has the keys (Enter, or a click on it): the letters type. Esc, or a click
   * anywhere else, gives them back to the fight's own keys.
   */
  fightBox = false;
  /** The GM's line on a typed turn, streaming in (who says it: a unit's id, or "gm"). */
  fightLive?: { who: string; text: string };
  /** The fight's answer to a typed line that came to nothing (why not: nothing was spent), under the log until the next. */
  fightReply?: string;
  /** A line sent before the box could take it (the others' turns, the GM still speaking): why it's waiting, under the log while it waits. */
  fightWait?: string;
  /** Cuts the GM's line on a typed turn short (Esc, or a fight key, while it streams): the rules' lines stand. */
  private fightSkip?: AbortController;
  overlay?: Overlay;
  /** The sheet the rules engine just made (the created screen). */
  sheet?: SheetData;
  creating?: { name: string; concept: string };
  /** Character creation in progress: the builds offered, the one chosen, the backstory. */
  creation?: Creation;
  /** The model, for character creation's asking (three builds, a draft, the lore check): a stand-in for it in the checks. */
  ask?: Ask;
  /** No model to ask in character creation: the GM is offline (and nothing stands in for it). */
  get aiOffline(): boolean { return !this.ask && modelOffline(); }
  ending?: Epilogue;
  error?: string;
  /** Set when the app should exit (main.tsx tears the renderer down). */
  quitting = false;
  /** Walking a step at a time (to the lead, or where the player clicked): any key or click stops it. */
  walking = false;
  /** The map's right-click menu, while it's open. */
  menu?: TileMenu;
  /** The scene's right-click menu (on its place, or the list under it), while it's open. */
  sceneMenu?: SceneMenu;
  /** A marked phrase of the last reply that Tab picked out (by its line in `lines` and its place in that line's marks): Enter opens it, Esc lets go. */
  markFocus?: { line: number; mark: number };
  /** A marked phrase the pointer is on: the bottom line says what it is. */
  markPointed?: { line: number; mark: number };
  /** How big the scene screen draws the conversation's frame (the popover of a mark stays inside it). */
  talkArea?: { w: number; h: number };
  /** The action menu, while it's open (m on the map). */
  doMenu?: DoMenu;
  /** Aiming something from the action menu on the map. */
  aiming?: Aiming;
  /** The scene on screen is over: its last reply stays up until the player goes on. */
  over?: Over;
  /**
   * What the core offers in a scene (a talk's dialogue choices): lines to say (kind "say": the label
   * is the line, said as if typed), and walking on without a word. Click one, or press its number.
   */
  choices: Action[] = [];
  /**
   * A way on (a scene that's over, the moment between scenes) is being typed at: characters since it
   * came up (or the line that was in the box as the scene ended). The Enter that ends them ends the
   * line, not the scene: it takes an Enter of its own (or a click) to go on. See wayOnKey (ui/common.tsx).
   */
  typing = false;
  /** What's on screen now, as text (main.tsx and the static build set it: src/app/report.ts), for a report. */
  screenText?: () => string | undefined;
  /** The terminal's size, in cells, for a report. */
  terminalSize?: () => { cols: number; rows: number };

  /** Each walk's number: a new walk takes over from the one before. */
  private walkNo = 0;
  /** The scene the transcript shows (a summons can open the next scene inside a turn). */
  private shown?: string;
  private listeners = new Set<() => void>();
  private pending?: ReturnType<typeof setTimeout>;
  /** The spinner's lines while the GM has the floor (a new one each turn, and at each step of a considered turn). */
  private busyLines = new BusyLines();
  /** A turn of the player's is being played: a scene ending now is theirs to read before going on (see notice). */
  private watching = false;
  /** The open scene's look: one Effects and one Director for the scene, and its world (see sceneLook). */
  private look?: { scene: string; fx: Effects; director: Director; world: SceneWorld };
  /** The rules' lines landing in a turn, shown together once a burst of them is in. */
  private rolled: string[] = [];
  /** The fight's effects, and how much of its log they've shown (see fightFx). */
  private fightLook?: { fight: CombatController; fx: Effects; seen: number; dust: Tile2[] };
  /** What the rules say of the player's spells' reach (range, effects, area), by id, for the scene's menu to offer what fits. */
  private spellFacts = new Map<string, SpellFacts>();
  private spellsLoading?: Promise<void>;
  /** The town's look between scenes: the effects of what the player does on the map, in the town's world (see townFx). */
  private townLook?: { map: string; fx: Effects; director: Director; world: SceneWorld };
  /** A zoo wing's look on the map: what its exhibits set off, played once each (the zoo's news, by number). */
  private wingLook?: { world: SceneWorld; look: Look; seq: number };
  /** The zoo's last thing shown beyond the map (a sign's card, The End), by number: each is shown once. */
  private shownSeq = 0;

  constructor() {
    // The other side's turns: redraw after each, and give the player a beat to see it land.
    const pace = async () => {
      if (this.screen !== "combat") return;
      this.animateFight();
      this.busy = "The others act…";
      this.emit();
      await sleep(DELAY());
    };
    this.storyFights.pace = pace;
    this.zooFights.pace = pace;
  }

  get session(): SessionState | undefined { return this.core?.session; }
  get story(): StoryState { return this.core?.state.story ?? { time: "morning", played: [], flags: {} }; }
  /** The scene on the scene screen: the one being played, or the one that has just ended (until the player goes on). */
  get shownScene(): string | undefined { return this.shown ?? this.session?.sceneId; }
  /** Its world: the live one, or, once the story has moved on, the world as the scene left it. */
  get shownWorld(): SceneWorld | undefined {
    const world = this.session?.world;
    if (world && world.scene === this.shownScene) return world;
    return this.look?.world.scene === this.shownScene ? this.look?.world : undefined;
  }
  /** Where the player is on the map (the map module's explore state, kept in the game). */
  get ex(): ExploreState | undefined { return this.core ? exploreState(this.core.state) : undefined; }
  /** The fight in progress, to draw (view(), options(), area()); act through combatAct. */
  get fight(): CombatController | undefined {
    const f = this.core?.state.mode === "combat" ? this.core.currentFight : undefined;
    return f instanceof TacticalFight ? f.controller : undefined;
  }
  /** What the player can do in the fight now, by action id (the QA console's list). */
  get fightActions(): Action[] {
    const f = this.core?.state.mode === "combat" ? this.core.currentFight : undefined;
    if (!f) return [];
    return f.result() ? [{ id: "continue", label: "See what comes of it", kind: "fight" }] : f.actions();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  emit(): void {
    if (this.pending) { clearTimeout(this.pending); this.pending = undefined; }
    for (const l of this.listeners) l();
  }

  /** Streaming text arrives a token at a time: redraw at most ~30 times a second. */
  private emitSoon(): void {
    this.pending ??= setTimeout(() => this.emit(), 33);
  }

  // -------------------------------------------------------------------------------------------
  // Title and character creation

  loadSaves(): void {
    this.saves = resumable();
    this.zooVisit = zooVisits(1)[0];
    this.emit();
  }

  /** Off the title screen's list for good (the folder goes to runs/deleted/). */
  deleteSave(r: Resumable): void {
    try { deleteSave(r.id); } catch (error) { this.error = `Couldn't delete that game: ${this.failed("delete a game", error)}`; }
    this.loadSaves();
  }

  /** Every zoo visit goes the same way (runs/deleted/): the title's zoo starts a new one. */
  deleteZooVisits(): void {
    try { for (const v of zooVisits(1000)) deleteSave(v.id); } catch (error) { this.error = `Couldn't put the zoo back: ${this.failed("put the zoo back", error)}`; }
    this.loadSaves();
  }

  /** New game: a name and a concept to start with (afresh from the title; as they were, coming back from the builds). */
  newCharacter(): void {
    this.creation = undefined;
    this.error = undefined;
    this.screen = "create";
    this.emit();
  }

  /**
   * The name and concept are in: three builds that fit, as cards (one model call, each made legal by
   * the engine; offline, the class defaults that best match the concept's words). The same name and
   * concept again (back from the cards, nothing changed) offer the same three.
   */
  async offerBuilds(name: string, concept: string): Promise<void> {
    name = (name.trim() || DEFAULT_NAME).replace(/:/g, " ");
    concept = concept.trim() || DEFAULT_CONCEPT;
    const was = this.creation;
    const same = !!was?.offer && was.name === name && was.concept === concept;
    // A new concept is a new offer (and a new build to make of one's own); the backstory written so far stays.
    const c: Creation = same && was ? was : { name, concept, index: 0, story: was?.story ?? "", version: (was?.version ?? 0) + 1, issue: 0 };
    this.creation = c;
    this.creating = { name, concept };
    this.error = undefined;
    if (!same) {
      this.screen = "creating";
      c.busy = "builds";
      this.emit();
      try { c.offer = await threeBuilds(name, concept, LEVEL, this.ask ? { ask: this.ask } : {}); }
      catch (error) { this.error = `Character creation failed: ${this.failed("character creation: the builds", error)}`; this.screen = "create"; delete c.busy; this.emit(); return; }
      delete c.busy;
    }
    if (this.creation !== c) return;
    this.screen = "choose";
    this.emit();
  }

  /** Back to the name and concept (from the cards): as they were typed. */
  backToConcept(): void {
    this.screen = "create";
    this.emit();
  }

  /** Pick out a card (the keys, or the pointer moving over it): 0-2 the builds, 3 "Make my own". */
  pickCard(index: number): void {
    const c = this.creation;
    if (!c || c.index === index) return;
    c.index = Math.max(0, Math.min(3, index));
    this.emit();
  }

  /** One of the three builds: on to the backstory. */
  chooseBuild(index: number): void {
    const c = this.creation, option = c?.offer?.options[index];
    if (!c || !option) return;
    c.index = index;
    c.chosen = option;
    this.toBackstory();
  }

  /** Back to the three builds (from making one's own, or from the backstory). */
  backToBuilds(): void {
    const c = this.creation;
    if (!c?.offer) { this.backToConcept(); return; }
    delete c.proposal; delete c.issues; delete c.note;
    this.screen = "choose";
    this.emit();
  }

  /** "Make my own": the SRD's lists to pick from, starting from the build picked out (or the first). */
  async makeOwn(): Promise<void> {
    const c = this.creation;
    const card = c?.offer?.options[c.index < 3 ? c.index : 0] ?? c?.offer?.options[0];
    if (!c || !card) return;
    c.index = 3;
    const from = c.own?.picks ?? picksOf(card.build);
    const lists = c.own?.lists ?? await srdLists(LEVEL);
    c.own = { ...c.own, picks: from, lists, column: c.own?.column ?? 0 };
    this.screen = "custom";
    this.emit();
    await this.pickOwn(from);
  }

  /** A pick of the player's own (species, class, subclass, background): the card it comes to, through the engine (the latest pick wins). */
  async pickOwn(picks: OwnPicks): Promise<void> {
    const c = this.creation, own = c?.own;
    if (!c || !own) return;
    // A class with a subclass of its own: the one it had, if it's the class's, else its first (where the level has one).
    const subs = own.lists.subclasses[picks.classId] ?? [];
    const subclassId = LEVEL >= (own.lists.subclassLevel[picks.classId] ?? 3) ? (subs.some(s => s.id === picks.subclassId) ? picks.subclassId : subs[0]?.id) : undefined;
    own.picks = { speciesId: picks.speciesId, classId: picks.classId, backgroundId: picks.backgroundId, ...(subclassId ? { subclassId } : {}) };
    own.making = true;
    this.emit();
    const asked = own.picks;
    try {
      const option = await ownBuild(asked, LEVEL, c.name);
      if (own.picks === asked) own.option = option;
    } catch (error) {
      if (own.picks === asked) { delete own.option; c.note = `The rules engine couldn't make that one: ${message(error)}`; }
    }
    if (own.picks === asked) own.making = false;
    this.emit();
  }

  /** Which of the four lists has the keys (making one's own): species, class, subclass, background. */
  ownColumn(column: number): void {
    const own = this.creation?.own;
    if (!own) return;
    own.column = (column + 4) % 4;
    this.emit();
  }

  /** Take the build of the player's own making: on to the backstory. */
  takeOwn(): void {
    const c = this.creation, option = c?.own?.option;
    if (!c || !option || c.own?.making) return;
    c.chosen = option;
    this.toBackstory();
  }

  private toBackstory(): void {
    const c = this.creation!;
    delete c.proposal; delete c.issues; delete c.note; delete c.rewriting;
    this.screen = "backstory";
    this.emit();
  }

  /** Who the backstory is for, as the model's told. */
  private who(): { name: string; concept: string; build?: string } {
    const c = this.creation!;
    return { name: c.name, concept: c.concept, ...(c.chosen ? { build: c.chosen.line } : {}) };
  }

  /** The box's text, as it changes (the box is the backstory screen's own). */
  storyTyped(text: string): void {
    if (this.creation) this.creation.story = text;
  }

  /** "Draft one": a backstory from the concept and the build, shown to take or leave. Offline, it says the GM is. */
  async draftStory(): Promise<void> {
    const c = this.creation;
    if (!c || c.busy) return;
    this.error = undefined;
    if (this.aiOffline) { c.note = "The GM is offline, so there's nobody to draft one: write it yourself, or skip it."; this.emit(); return; }
    c.busy = "draft";
    delete c.note;
    this.emit();
    const asked = await draftBackstory(this.who(), this.ask ? { ask: this.ask } : {});
    delete c.busy;
    if (asked.ok) c.proposal = { kind: "draft", text: asked.value };
    else c.note = asked.why;
    this.emit();
  }

  /** "Work it in": what's in the box as a story in the player's voice, keeping everything they wrote; shown to take or leave. */
  async workInStory(text = this.creation?.story ?? ""): Promise<void> {
    const c = this.creation;
    if (!c || c.busy) return;
    this.error = undefined;
    c.story = text;
    if (this.aiOffline) { c.note = "The GM is offline, so there's nobody to work it in: it stays as you wrote it."; this.emit(); return; }
    if (!text.trim()) { c.note = "There's nothing in the box to work in yet: write a few notes first, or Draft one."; this.emit(); return; }
    const long = tooLong(text);
    if (long) { c.note = long; this.emit(); return; }
    c.busy = "work";
    delete c.note;
    this.emit();
    const asked = await workIn(text, this.who(), this.ask ? { ask: this.ask } : {});
    delete c.busy;
    if (asked.ok) c.proposal = { kind: "work", text: asked.value };
    else c.note = asked.why;
    this.emit();
  }

  /** The draft (or the notes worked in) taken: it's what the box has now. */
  takeProposal(): void {
    const c = this.creation;
    if (!c?.proposal) return;
    c.story = c.proposal.text;
    c.version++;
    delete c.proposal;
    c.note = "It's yours now: change anything you like.";
    this.emit();
  }

  /** The draft left: the box as it was. */
  leaveProposal(): void {
    const c = this.creation;
    if (!c?.proposal) return;
    delete c.proposal;
    this.emit();
  }

  /**
   * Done with the backstory: it's checked against the world's lore. What contradicts canon comes up
   * a fix at a time, to accept or rewrite; if it fits (or there's no GM to check it), into the game.
   * Nothing written is the same as skipping.
   */
  async finishStory(text = this.creation?.story ?? ""): Promise<void> {
    const c = this.creation;
    if (!c || c.busy) return;
    this.error = undefined;
    c.story = text;
    // Longer than the GM can be given every turn: it stays in the box, with how long it is.
    const long = tooLong(text);
    if (long) { c.note = long; this.emit(); return; }
    delete c.rewriting;
    delete c.again;
    if (!text.trim()) { await this.makeCharacter(); return; }
    await this.checkStory();
  }

  /** The backstory as it stands, checked against the world: what doesn't fit, one at a time, or into the game. */
  private async checkStory(): Promise<void> {
    const c = this.creation;
    if (!c) return;
    c.busy = "check";
    delete c.note;
    this.emit();
    const checked = await checkLore(c.story, this.who(), this.ask ? { ask: this.ask } : {});
    delete c.busy;
    if (checked.ok && checked.value.length) {
      c.issues = checked.value;
      c.issue = 0;
      this.emit();
      return;
    }
    // Not checked (the GM offline, or out of reach): it goes in, and the sheet says so over it.
    if (checked.ok) delete c.unchecked;
    else {
      const reason = checked.reason ?? checked.why;
      c.unchecked = c.again
        ? `Your backstory went in with the fixes you took, but nobody checked them again: ${reason}.`
        : `Your backstory went in as you wrote it, without the lore check: ${reason}.`;
    }
    await this.makeCharacter();
  }

  /**
   * The issue on show, fixed as the check suggests (the player saw the words it changes): the next
   * one; after the last, the story with the fixes in is checked once more (a fix can miss too, and
   * what it finds is shown the same way), then into the game.
   */
  async acceptFix(): Promise<void> {
    const c = this.creation, issue = c?.issues?.[c.issue];
    if (!c || !issue || c.busy) return;
    const fixed = applyFix(c.story, issue);
    if (fixed === undefined) { this.rewriteIssue(); return; }
    c.story = fixed;
    c.version++;
    if (c.issue + 1 < (c.issues?.length ?? 0)) { c.issue++; this.emit(); return; }
    delete c.issues;
    if (!c.again) { c.again = true; await this.checkStory(); return; }
    await this.makeCharacter();
  }

  /** The issue on show, to rewrite themselves: back to the box with it shown over it (Done checks it again). */
  rewriteIssue(): void {
    const c = this.creation, issue = c?.issues?.[c.issue];
    if (!c || !issue) return;
    c.rewriting = issue;
    delete c.issues;
    this.emit();
  }

  /** No backstory: straight into the game. */
  async skipStory(): Promise<void> {
    const c = this.creation;
    if (!c || c.busy) return;
    this.error = undefined;
    c.story = "";
    c.version++;
    delete c.unchecked;
    await this.makeCharacter();
  }

  /**
   * Into the game: what the backstory says of them (from the model; offline, from their own words),
   * then the game made with the chosen build and the backstory, and the sheet the engine made.
   */
  private async makeCharacter(): Promise<void> {
    const c = this.creation;
    if (!c) return;
    c.busy = "making";
    this.screen = "creating";
    this.emit();
    const text = c.story.trim();
    if (!text) delete c.unchecked;
    const backstory = text ? await finishBackstory(text, this.who(), this.ask ? { ask: this.ask } : {}) : undefined;
    delete c.busy;
    await this.create(c.name, c.concept, c.chosen?.build, backstory);
  }

  /**
   * Make the game: the player, their build (chosen, or for the model to choose from the concept when
   * none is given) and their backstory, then the sheet the rules engine made.
   */
  async create(name: string, concept: string, build?: Build, backstory?: Backstory): Promise<void> {
    this.creating = { name, concept };
    this.screen = "creating";
    this.error = undefined;
    this.emit();
    try {
      const who = `${(name.trim() || DEFAULT_NAME).replace(/:/g, " ")}: ${concept.trim() || DEFAULT_CONCEPT}`;
      const core = await Core.create({ player: who, level: LEVEL, explorer: town, fights: this.storyFights, ...(build ? { build } : {}), ...(backstory ? { backstory } : {}) });
      this.core = core;
      playing(core.state.id);
      this.sheet = await sheetData(core.session);
      this.journal = [];
      this.messages = [`${TIME_WORDS[core.state.story.time]}. ${sceneById(core.session.sceneId).hook}`];
      this.screen = "created";
      if (this.creation) this.creation.made = core.state.id;
      this.saveExtras();
    } catch (error) {
      this.error = `Character creation failed: ${this.failed("character creation", error)}`;
      this.screen = this.creation?.chosen ? "backstory" : "create";
    }
    this.emit();
  }

  /**
   * Not who they meant, from the sheet: back to the three builds (the backstory comes too), or, from
   * before character creation offered them, made again. The game made from the one turned down goes
   * to runs/deleted/, so the title doesn't offer it to carry on.
   */
  chooseAgain(): void {
    const made = this.creation?.made ?? this.core?.state.id;
    if (made && this.screen === "created") {
      try { deleteSave(made); } catch { /* it stays on the title's list, then */ }
      // Its calls were logged in its folder, which has gone: the next game's are logged in its own.
      setCallLog(undefined);
      if (this.creation) delete this.creation.made;
      this.core = undefined;
      this.sheet = undefined;
    }
    if (this.creation?.offer) this.backToBuilds();
    else if (this.creating) void this.create(this.creating.name, this.creating.concept);
  }

  async resume(r: Resumable): Promise<void> {
    let core: Core;
    try {
      // The story's game, or a hub's (a zoo visit): each with its own explorer and fights.
      core = Core.load(r.id, explorerFor(r.game), this.fightsFor(r.game));
      // What its screen reads first, read now: a save this version of the game can't make sense of
      // (one from another build of it, say) is said on the title, rather than breaking the screen.
      if (core.state.mode === "scene" || core.state.mode === "combat") sceneById(core.session.sceneId);
      if (core.state.mode !== "end") exploreState(core.state);
    } catch (error) {
      this.error = `That game couldn't be loaded: ${this.failed("load a game", error)}`;
      this.loadSaves();
      return;
    }
    this.error = undefined;
    if (repairCampaign(core.session)) core.save();
    this.core = core;
    playing(r.id);
    const extras = loadExtras(r.id);
    this.messages = extras?.messages ?? [];
    this.journal = extras?.journal ?? [];
    this.overlay = undefined;
    // What the zoo showed before the save was shown then (a sign's card isn't opened again on loading).
    this.shownSeq = core.state.hub ? zooOf(core.state).show?.seq ?? 0 : 0;
    this.freshFight();
    this.doMenu = undefined; this.aiming = undefined; this.townLook = undefined; this.wingLook = undefined;
    switch (core.state.mode) {
      case "combat":
        this.screen = "combat";
        this.say("You pick yourself up where you left off: mid-brawl.");
        break;
      case "scene":
        this.screen = "scene";
        this.showSceneSoFar();
        this.emit();
        // The scene ended but the story hadn't moved on (quit in between): carry on from there.
        if (core.session.ended) await this.moveOn(() => core.carryOn(this.hooks()));
        // Saved before the suggested lines came (or with them off then): they're asked for now.
        else core.suggestNow(this.hooks());
        break;
      case "end":
        this.toEnd();
        break;
      default:
        this.screen = "explore";
    }
    this.emit();
  }

  /**
   * The zoo (src/game/zoo): carry on the latest visit, or start one. No character to make: the
   * visitor comes in wearing the wizard's robes (the wardrobe has the others). Kept apart from the
   * story: a visit isn't a game to Continue, and nothing done in it reaches Caerwyn.
   */
  async zoo(): Promise<void> {
    this.error = undefined;
    const visit = zooVisits()[0];
    if (visit) { await this.resume(visit); return; }
    try {
      const core = await newZoo({ fights: this.zooFights });
      this.core = core;
      playing(core.state.id);
      this.journal = [];
      this.messages = [WELCOME];
      this.overlay = undefined;
      this.doMenu = undefined; this.aiming = undefined; this.townLook = undefined;
      this.wingLook = undefined;
      this.shownSeq = 0;
      this.screen = "explore";
      this.saveExtras();
    } catch (error) {
      this.error = `The zoo couldn't open: ${this.failed("open the zoo", error)}`;
    }
    this.emit();
  }

  // -------------------------------------------------------------------------------------------
  // Explore

  /** Where g walks: the story's lead, or the zoo's next exhibit. */
  leadTarget(): LeadTarget | undefined {
    const core = this.core;
    if (!core) return undefined;
    return this.explorer.lead ? this.explorer.lead(core.state) : leadTarget(core.state);
  }

  /** What a tile offers (the right-click menu, the pointer's hint): the town's answers, or the zoo's (its levers too). */
  actionsAt(at: Tile2): TileActions | undefined {
    const core = this.core;
    if (!core) return undefined;
    return (this.explorer.actionsAt ?? actionsAt)(core.state, core.session, at);
  }

  /** What e would do now, in words. */
  interactLabel(): { label: string; scene: boolean } | undefined {
    const core = this.core;
    if (!core) return undefined;
    return (this.explorer.interactLabel ?? interactLabel)(core.state, core.session);
  }

  /** The zoo's effects on the map (and from above): what its exhibits set off. Undefined outside the zoo. */
  mapFx(): Look | undefined {
    const core = this.core;
    if (!core?.state.hub || core.state.mode !== "explore") return undefined;
    const ex = exploreState(core.state);
    const world = ex.roam?.[ex.map];
    if (!world) return undefined;
    if (this.wingLook?.world !== world) this.wingLook = { world, look: lookFor(world), seq: zooOf(core.state).news?.seq ?? 0 };
    return this.wingLook.look;
  }

  /** The zoo's latest news (what a lever, a bell, a spell did), played on the map once. */
  private playZooNews(): void {
    const core = this.core;
    if (!core?.state.hub) return;
    const look = this.mapFx();
    const z = zooOf(core.state);
    const w = this.wingLook;
    if (!look || !w || !z.news || z.news.seq <= w.seq) return;
    w.seq = z.news.seq;
    if (z.news.map === exploreState(core.state).map) playNews(look, z.news, performance.now());
    else look.director.observe(look.world, performance.now());
  }

  begin(): void {
    // Set off: the game is theirs (choosing again no longer applies).
    if (this.creation) delete this.creation.made;
    this.screen = "explore";
    this.emit();
  }

  say(text: string): void {
    if (text) this.messages = [...this.messages, text].slice(-20);
  }

  /** A step by an arrow key: up goes up the screen (the map module's SCREEN_KEYS). */
  walk(key: string): void {
    this.walking = false;
    const d = SCREEN_KEYS[key];
    if (!this.core || this.busy || !d) return;
    // Steered: a key that would catch on a corner follows the street instead.
    const [dx, dy] = steer(exploreState(this.core.state), d[0], d[1]);
    void this.explore(walkId(dx, dy));
  }

  interact(): void {
    this.walking = false;
    if (!this.core || this.busy) return;
    void this.explore("interact");
  }

  /** Walk to where the story is heading, a step at a time so you see the way (any key stops it). */
  async toLead(): Promise<void> {
    const core = this.core;
    if (!core || this.busy || this.walking) return;
    const lead = this.leadTarget();
    if (!lead) { this.say(this.isZoo ? "You've seen every exhibit. They don't mind being seen again." : this.story.lead ? "The story will come to you from here." : "The story isn't heading anywhere just now."); this.emit(); return; }
    const no = this.startWalk();
    // A walk can go through a door to another map: then the way on is worked out again from there.
    for (let leg = 0; leg < 4 && no === this.walkNo && this.walking && core.state.mode === "explore"; leg++) {
      const target = this.leadTarget();
      const full = target ? pathTo(exploreState(core.state), target.at) : undefined;
      // The zoo's exhibits are read from beside their signs, not stood on.
      const path = full && target && this.isZoo && !target.onto ? full.slice(0, -1) : full;
      if (!target || !path?.length) { if (!full) this.say(`You can't see a way to ${lead.label} from here.`); break; }
      await this.stepAlong(path, no);
    }
    this.endWalk(no);
  }

  /**
   * Walk to a tile (a click on the map), a step at a time: round what's in the way, through it if
   * it's a door, or as near as you can get; up to a door or a way out that doesn't open as you
   * come, you try it. Any key or click stops it; another click walks somewhere else instead.
   */
  async walkTo(at: Tile2): Promise<void> {
    const core = this.core;
    if (!core || this.busy || core.state.mode !== "explore" || this.screen !== "explore") return;
    this.menu = undefined;
    const ex = exploreState(core.state);
    const plan = walkPlan(ex, at);
    if (!plan) { this.walkNo++; this.walking = false; this.say(`You can't see a way any nearer ${tileName(ex, at)} from here.`); this.emit(); return; }
    const map = ex.map;
    const no = this.startWalk();
    const done = await this.stepAlong(plan.path, no, { loud: true });
    if (no !== this.walkNo) return;
    const now = exploreState(core.state);
    if (done && !plan.reaches && now.map === map && steps(now.at, at) === 1 && core.state.mode === "explore" && isDoorway(getMap(map), at)) await this.explore(walkId(at.x - now.at.x, at.y - now.at.y));
    this.endWalk(no);
  }

  /** Right-click on the map, or on someone in the sidebar: what's at a tile and what you can do with it. */
  openMenu(at: Tile2, x: number, y: number): void {
    const core = this.core;
    if (!core || this.busy || core.state.mode !== "explore") return;
    this.walking = false;
    this.doMenu = undefined;
    this.aiming = undefined;
    // The explorer's answers (the town's, or the zoo's with its levers first).
    const tile = this.actionsAt(at)!;
    // Anything the action menu can do to what's there (a spell at them, a shove), aimed at it already.
    const more: Action[] = core.session.rules ? [{ id: `do@${at.x},${at.y}`, label: "Do something…", kind: "use" }] : [];
    this.menu = { ...tile, actions: [...tile.actions, ...more], x, y, index: 0 };
    this.emit();
  }

  closeMenu(): void {
    if (!this.menu) return;
    this.menu = undefined;
    this.emit();
  }

  /** Take one of the menu's choices (choose() is the scene's: a suggestion said). */
  async chooseFromMenu(index: number): Promise<void> {
    const menu = this.menu;
    this.menu = undefined;
    const choice = menu?.actions[index];
    if (!menu || !choice) { this.emit(); return; }
    if (choice.id.startsWith("do@")) { this.openActions(menu.at, menu.x, menu.y); return; }
    await this.doAt(menu.at, choice);
  }

  // -------------------------------------------------------------------------------------------
  // The action menu (m): spells, class features, a leap, hiding, a rest; aimed on the map.

  /** Open the action menu: what the player can do here, by kind; `at`: aimed at that tile already (a right-click's "Do something…"). */
  openActions(at?: Tile2, x?: number, y?: number): void {
    const core = this.core;
    if (!core || this.busy || core.state.mode !== "explore" || this.screen !== "explore") return;
    this.walking = false;
    this.menu = undefined;
    this.aiming = undefined;
    const view = actionMenu(core.state, core.session, at);
    if (!view) { this.say("There's no rules character here to do anything with."); this.emit(); return; }
    const entries = entriesOf(view);
    // The first thing that can be done, picked out.
    this.doMenu = { view, index: Math.max(0, entries.findIndex(e => !e.why)), top: 0, ...(x !== undefined && y !== undefined ? { x, y } : {}) };
    this.emit();
  }

  closeActions(): void {
    if (!this.doMenu) return;
    this.doMenu = undefined;
    this.emit();
  }

  /**
   * One of the menu's entries: done at once (nothing to aim, or aimed already), or aimed on the map
   * first; one that can't be done now is only picked out (the menu says why).
   */
  chooseAction(index: number): void {
    const menu = this.doMenu;
    const item = menu ? entriesOf(menu.view)[index] : undefined;
    if (!menu || !item) return;
    if (item.why) { menu.index = index; this.emit(); return; }
    this.doMenu = undefined;
    if (item.id) void this.act(item.id);
    else if (item.aiming) this.startAiming(item, menu.view.at);
    else this.emit();
  }

  /**
   * Aim an entry on the map: at `at` (what was right-clicked), else at the nearest thing in reach (for
   * an area, the nearest whose area leaves you out), else where you stand.
   */
  startAiming(item: MenuItem, at?: Tile2): void {
    const core = this.core;
    if (!core) return;
    const view = aimFor(core.state, core.session, item.key);
    if (!view) { this.emit(); return; }
    const ex = exploreState(core.state);
    const start = at ?? view.start ?? { ...ex.at };
    this.aiming = { item, view, at: { ...start }, index: Math.max(0, view.targets.findIndex(t => t.at.x === start.x && t.at.y === start.y)) };
    this.aiming.check = aimAtTile(core.state, core.session, item.key, start);
    this.emit();
  }

  /** Aim at a tile (the pointer over the map, or the cursor keys). */
  aimTo(at: Tile2): void {
    const core = this.core, aiming = this.aiming;
    if (!core || !aiming || (aiming.at.x === at.x && aiming.at.y === at.y)) return;
    aiming.at = { ...at };
    aiming.check = aimAtTile(core.state, core.session, aiming.item.key, at);
    delete aiming.confirm;
    this.emit();
  }

  /** The next (or the last) of what's in reach (Tab, Shift+Tab); yourself among them, when it can be. */
  aimNext(back = false): void {
    const aiming = this.aiming, core = this.core;
    if (!aiming || !core) return;
    const ex = exploreState(core.state);
    const tiles = [...aiming.view.targets.map(t => t.at), ...(aiming.view.self ? [{ ...ex.at }] : [])];
    if (!tiles.length) return;
    const now = tiles.findIndex(t => t.x === aiming.at.x && t.y === aiming.at.y);
    const next = now < 0 ? 0 : (now + (back ? tiles.length - 1 : 1)) % tiles.length;
    aiming.index = next;
    this.aimTo(tiles[next]!);
  }

  /** Move the aim a tile (the arrow keys: with the screen, as walking does). */
  aimStep(key: string): void {
    const d = SCREEN_KEYS[key];
    if (!d || !this.aiming) return;
    this.aimTo({ x: this.aiming.at.x + d[0], y: this.aiming.at.y + d[1] });
  }

  /** Aim at yourself, when it can be. */
  aimSelf(): void {
    const core = this.core;
    if (!core || !this.aiming?.view.self) return;
    this.aimTo(exploreState(core.state).at);
  }

  /** Do it, where it's aimed: if it can be done there. An area that would catch you asks first (the bottom line says so, in red). */
  fire(): void {
    const aiming = this.aiming, check = aiming?.check;
    if (!aiming || !check?.ok || !check.id) { this.emit(); return; }
    if (check.caught?.includes("you") && !aiming.confirm) { aiming.confirm = true; this.emit(); return; }
    this.aiming = undefined;
    void this.act(check.id);
  }

  cancelAim(): void {
    if (!this.aiming) return;
    this.aiming = undefined;
    this.emit();
  }

  /**
   * One of the menu's acts, through the core (the action id the QA console would use): what it did
   * shows on the map as it lands (the look layer's effects: the fireball, the splinters, the numbers)
   * and in the news. It may open someone's scene, or a talk, or start a fight on the map.
   */
  async act(id: string): Promise<void> {
    const core = this.core;
    if (!core || this.busy || core.state.mode !== "explore") return;
    // The town as it is now: what the act changes is what's shown.
    this.townFx(true);
    this.busy = "…";
    this.emit();
    const done = await this.explore(id);
    // A fight it started is on screen already (explore goes to the battlefield); on the map, what it did plays out.
    if ((core.state.mode as Core["state"]["mode"]) === "explore") this.animateTown(done.text);
    this.emit();
  }

  /**
   * Something to do with a tile (its menu's choices): looking is done from where you stand, walking
   * is a walk, and the rest walk over first, a step at a time, then do it.
   */
  async doAt(at: Tile2, action: Action): Promise<void> {
    const core = this.core;
    if (!core || this.busy || core.state.mode !== "explore") return;
    if (/^(walk|door)@/.test(action.id)) { await this.walkTo(at); return; }
    if (!/^look/.test(action.id)) {
      const plan = walkPlan(exploreState(core.state), at);
      const path = plan ? within(plan.path, exploreState(core.state).at, at) : [];
      if (path.length) {
        const no = this.startWalk();
        const done = await this.stepAlong(path, no);
        if (no !== this.walkNo) return;
        this.walking = false;
        if (!done || core.state.mode !== "explore") { this.emit(); return; }
      }
      // Things in sight go by ids that follow who's nearest (the nearer guard is talk_palace_guard): ask again from here.
      action = this.actionsAt(at)!.actions.find(a => a.label === action.label && a.kind === action.kind) ?? action;
    }
    this.walking = false;
    await this.explore(action.id);
  }

  /** A walk begins: it takes over from any walk under way. */
  private startWalk(): number {
    this.walking = true;
    this.emit();
    return ++this.walkNo;
  }

  /** A walk is over (unless another has taken over from it). */
  private endWalk(no: number): void {
    if (no !== this.walkNo) return;
    this.walking = false;
    this.saveExtras();
    this.emit();
  }

  /**
   * Take a walk's steps one at a time, so the player sees the way, until something's in the way, a
   * door takes them to another map, a scene opens, or the walk is stopped (a key, a click, another
   * walk). `loud`: say what stopped it. True if every step was taken.
   */
  private async stepAlong(path: Array<[number, number]>, no: number, options: { loud?: boolean } = {}): Promise<boolean> {
    const core = this.core!;
    const map = exploreState(core.state).map;
    for (const [dx, dy] of path) {
      if (no !== this.walkNo || !this.walking || core.state.mode !== "explore" || this.screen !== "explore") return false;
      const before = { ...exploreState(core.state).at };
      const step = await this.explore(walkId(dx, dy), { quiet: true });
      const after = exploreState(core.state);
      if (after.map !== map) return false;
      if (after.at.x === before.x && after.at.y === before.y) {
        if (options.loud && step.text && !step.said && core.state.mode === "explore") { this.say(step.text); this.emit(); }
        return false;
      }
      await sleep(STEP_MS());
    }
    return true;
  }

  /** An explore action through the core; stepping into the lead's place opens its scene. What it said, and whether it's shown. */
  private async explore(id: string, options: { quiet?: boolean } = {}): Promise<{ text: string; said: boolean }> {
    const core = this.core!;
    // The core switches to the scene before the opening streams in: show it as it comes. A walk into
    // the lead's place does it at once; a menu act (a leap into the yard) or a hub's action (a zoo
    // booth: the rules engine has its say first) a moment later, and the core says when (onScene).
    let opening = false;
    const open = () => {
      if (opening) return;
      opening = true;
      this.walking = false; this.menu = undefined; this.doMenu = undefined; this.aiming = undefined;
      this.sceneView("The GM sets the scene…");
      this.emit();
    };
    const run = core.act(id, { ...this.hooks(), onScene: open });
    if (core.state.mode === "scene") open();
    if (!options.quiet && !opening) this.emit();
    let text = "", said = false;
    try {
      text = await run;
      said = !opening && !!text && (!options.quiet || /^You come into|:/.test(text));
      // The player's own status line is the sidebar's to say.
      if (said) this.say(text.split("\n").filter(l => !l.startsWith(`${core.session.player.name}: HP `)).join("\n"));
    } catch (error) {
      const said = this.failed(opening ? "open a scene" : `the map: ${id}`, error);
      // A talk's greeting that never came isn't saved (the game is still on the map): walking on goes back to it.
      if (opening) this.lines.push({ kind: "error", speaker: "system", text: core.session.talk ? `The GM couldn't open the talk: ${said}. (Walk on to go back to the map.)` : `The GM couldn't open the scene: ${said}. (/end <exit> skips ahead for testing.)` });
      else this.say(said);
    }
    this.busy = undefined;
    this.live = undefined;
    if (opening) { this.observeScene(); this.refreshChoices(); }
    // A fight from the map (the people about came at the player, or a zoo ring's bell): straight onto the battlefield.
    if (core.state.mode === "combat" && this.screen === "explore") {
      this.walking = false; this.menu = undefined; this.doMenu = undefined; this.aiming = undefined;
      this.freshFight();
      this.screen = "combat";
      this.animateFight();
    }
    // What a zoo exhibit set off plays on the map, and what it asks the screen to show (a sign's card) comes up.
    this.playZooNews();
    this.showZoo();
    if (!options.quiet) this.saveExtras();
    this.emit();
    return { text, said };
  }

  /** What the zoo asks the screen to show beyond the map, once: a sign's card, The End, the window. */
  private showZoo(): void {
    const core = this.core;
    if (!core?.state.hub || core.state.mode !== "explore" || this.screen !== "explore") return;
    const s = zooOf(core.state).show;
    if (!s || s.seq <= this.shownSeq) return;
    this.shownSeq = s.seq;
    this.walking = false;
    this.menu = undefined;
    if (s.kind === "sign" && s.id) this.overlay = { kind: "sign", exhibit: s.id };
    else if (s.kind === "window") this.overlay = { kind: "window" };
    // The End, as the story ends it, for the visit so far: Enter comes back to the zoo (backFromEnd).
    else if (s.kind === "end") { this.ending = epilogue(core.session); this.overlay = undefined; this.screen = "end"; }
  }

  /** The zoo's End was a look at one: back to the hall, the visit carrying on. */
  backFromEnd(): void {
    this.ending = undefined;
    this.screen = "explore";
    this.emit();
  }

  /** What a zoo exhibit offers to set off from where the player stands now (its sign's card lists them). */
  zooTriggers(exhibit: string): Action[] {
    const core = this.core;
    const found = EXHIBITS.find(e => e.id === exhibit);
    if (!core || !found || core.state.mode !== "explore") return [];
    const ids = new Set(found.triggers.map(t => `use_${t.id}`));
    return zoo.actions(core.state, core.session).filter(a => ids.has(a.id));
  }

  /** Set off one of an exhibit's triggers from its card: the card closes, and it's done as from its menu. */
  async useFromCard(id: string): Promise<void> {
    this.overlay = undefined;
    this.emit();
    if (!this.core || this.busy || this.core.state.mode !== "explore") return;
    await this.explore(id);
  }

  // -------------------------------------------------------------------------------------------
  // Scene

  private nameOf(speaker: string): string {
    if (speaker === "player") return this.session?.player.name ?? "You";
    if (!this.session) return speaker;
    return sceneById(this.session.sceneId).cast.find(c => c.id === speaker)?.name ?? speaker;
  }

  private lineOf(e: Entry): Line {
    // The rules' lines with no roll in them are news, not dice: what you carry, what's burning.
    const kind = e.kind === "roll" && !isRoll(e.text) ? "info" : e.kind;
    return { kind, speaker: e.speaker, ...(e.kind === "dialogue" || e.kind === "player" ? { name: this.nameOf(e.speaker) } : {}), text: e.text, ...(e.scene ? { scene: e.scene } : {}), ...(e.marked ? { marked: e.marked } : {}) };
  }

  private header(): Line {
    const scene = sceneById(this.session!.sceneId);
    return { kind: "header", speaker: "system", name: scene.title, text: this.session!.lead ?? scene.hook, scene: scene.id };
  }

  private sceneView(busy?: string): void {
    this.screen = "scene";
    this.shown = this.session!.sceneId;
    this.lines = [this.header()];
    this.live = undefined;
    this.forgetMarks();
    this.status = undefined;
    this.busy = busy;
    this.over = undefined;
    this.choices = [];
    this.sceneMenu = undefined;
    void this.loadSpellFacts();
  }

  private showSceneSoFar(): void {
    this.shown = this.session!.sceneId;
    this.lines = [this.header(), ...sceneEntries(this.session!).map(e => this.lineOf(e))];
    this.forgetMarks();
    // A summons's opening may still be streaming in: it carries on, now on screen.
    if (this.live?.scene !== this.shown) this.live = undefined;
    this.over = undefined;
    this.sceneMenu = undefined;
    this.refreshChoices();
    void this.loadSpellFacts();
  }

  private hooks(): TurnHooks {
    return {
      // The turn stays busy until the core has finished with it (and saved it): the reply streams
      // first, then the after-reply decision, the stage manager, and maybe the next scene. The next
      // scene waits while the last one is still on screen: its lines are in the session's
      // transcript, and showSceneSoFar shows them when the player goes on.
      onSpeaker: (speaker, kind) => {
        const scene = this.session?.sceneId;
        this.live = { kind, speaker, ...(kind === "dialogue" ? { name: this.nameOf(speaker) } : {}), text: "", ...(scene ? { scene } : {}) };
        if (scene === this.shown) this.busy = kind === "dialogue" ? `${this.nameOf(speaker)} is speaking…` : "The GM is speaking…";
        this.notice();
        this.emit();
      },
      onText: (text, markup) => {
        if (!this.live) return;
        this.live.text = text;
        if (markup) this.live.marked = markup;
        if (this.live.scene === this.shown) this.emitSoon();
      },
      // A considered turn: the GM is ruling on what the player attempted, which takes a while. The
      // status line says so, then moves on at each step of the ruling (the review, each part of its
      // answer, the roll), like a spinner that's getting somewhere.
      onStep: step => {
        if (!this.busy || this.live || this.over) return;
        this.busy = step === "consider" && this.busy !== CONSIDERING ? CONSIDERING : this.busyLines.next(this.busy);
        this.emit();
      },
      onEntry: entry => {
        if (entry.kind === "narration" || entry.kind === "dialogue") {
          this.live = undefined;
          if (this.busy && !this.over) this.busy = "The GM makes a note…";
        }
        if ((entry.scene ?? this.session?.sceneId) === this.shown) {
          this.lines.push(this.lineOf(entry));
          this.animate(entry);
        }
        this.notice();
        this.emit();
      },
      onSuggestions: () => this.suggestionsCame(),
      // The notes on a reply's marks, a moment after it: they're on its line already (the same
      // markup), so it's drawn again with them, to point at and click.
      onMarks: entry => {
        if ((entry.scene ?? this.session?.sceneId) === this.shown) this.emit();
      },
    };
  }

  /**
   * The suggested lines have come, a moment after the reply (TurnHooks.onSuggestions): shown as they
   * come (the GM may still be making a note), and saved with the game if the turn that asked for them
   * is over already.
   */
  suggestionsCame(): void {
    const core = this.core;
    if (this.screen !== "scene" || this.over || core?.state.mode !== "scene" || this.session?.sceneId !== this.shownScene) return;
    this.refreshChoices();
    if (!this.busy) { try { core.save(); } catch (error) { noteError("saving the suggested lines", error); } }
    this.emit();
  }

  /**
   * The suggested lines over the box, for a scene of the story (a talk's lines are its own): on in
   * the game's settings, with the GM to be had, and a scene on screen that isn't over.
   */
  suggestionsExpected(): boolean {
    const core = this.core;
    return !!core && core.state.mode === "scene" && !core.session.talk && !core.session.ended && core.suggestionsOn && !this.over
      && this.session?.sceneId === this.shownScene && !modelOffline();
  }

  /** A scene's suggested lines for this moment are on their way. */
  suggestionsComing(): boolean {
    return !!this.session && suggesting(this.session);
  }

  /** What kind each suggested line is (to say, to do, a risky try, a way out), as the screen colours them; the talks' lines are all to say. */
  suggestionKinds(): Array<Suggestion["kind"]> {
    const session = this.session;
    return session && !session.talk ? currentSuggestions(session).map(s => s.kind) : [];
  }

  /**
   * Turn the suggested lines on or off (or over, with nothing said), from the Esc menu or
   * /suggestions: the game's setting, saved with it (now, unless the GM has the floor: then with the
   * turn). Turned on in a scene, the lines for this moment are asked for at once.
   */
  setSuggestions(on?: boolean): void {
    const core = this.core;
    if (!core) return;
    const next = on ?? !core.suggestionsOn;
    core.setSuggestions(next, this.hooks());
    if (!this.busy) { try { core.save(); } catch (error) { noteError("saving the settings", error); } }
    if (this.screen === "scene" && !this.busy && !this.over) this.refreshChoices();
    this.status = next ? "Suggested lines on: a few things to say or do come up over the box after each reply." : "Suggested lines off. (/suggestions, or the Esc menu, brings them back.)";
    this.emit();
  }

  /**
   * Has the scene on screen ended (the story moving on, a fight breaking out, the next scene come
   * for the player)? Then it's over: it stays up, last reply and all, until the player goes on.
   * Only while a turn of the player's is being played (or `now`): a fight's aftermath reopens its
   * scene through the same states, and isn't an ending.
   */
  private notice(now = false): boolean {
    const core = this.core;
    if ((!now && !this.watching) || !core || this.over || this.screen !== "scene" || !this.shown) return false;
    if (core.state.mode === "scene" && core.session.sceneId === this.shown && !core.session.ended) return false;
    this.over = { ready: false };
    this.busy = talkOf(this.shown) ? "The talk winds up…" : "The story moves on…";
    this.choices = [];
    // Whether the player was typing as it ended is the scene screen's to say (what's in its box).
    this.typing = false;
    return true;
  }

  /** While the core has the turn: notice the scene ending as soon as it does (the hand-off takes a while). Returns the stop. */
  private watch(): () => void {
    this.watching = true;
    const timer = setInterval(() => { if (this.notice()) this.emit(); }, 250);
    return () => { clearInterval(timer); this.watching = false; };
  }

  /**
   * A command that only opens something (/sheet, /map, /journal, /help, /report), or turns the
   * suggested lines on or off (/suggestions): it works any time, with the GM mid-sentence or the
   * scene over. True when the text was one.
   */
  peek(raw: string): boolean {
    const text = raw.trim();
    if (!/^[/#]/.test(text) || !this.core) return false;
    const [typed = "", ...rest] = text.slice(1).split(/\s+/);
    const name = commandNamed(typed);
    if (name === "sheet") void this.showSheet();
    else if (name === "map" || name === "journal" || name === "help") { this.overlay = name === "map" ? { kind: "scene-map" } : { kind: name }; this.emit(); }
    // What went wrong can come with it (/report Kell asked twice): then it goes at once.
    else if (name === "report") { this.openReport(); if (rest.length) void this.sendReport(rest.join(" ")); }
    // The suggested lines, any time: on, off, or over (with nothing said).
    else if (name === "suggestions") this.setSuggestions(/^(on|yes)$/i.test(rest[0] ?? "") ? true : /^(off|no)$/i.test(rest[0] ?? "") ? false : undefined);
    else return false;
    return true;
  }

  /** The player's turn in a scene: a /command (the old #command too), or what they say and do. */
  async input(raw: string): Promise<void> {
    const text = raw.trim();
    const core = this.core;
    if (!text || !core || this.peek(text) || this.busy || this.over) return;
    if (text.startsWith("/") || text.startsWith("#")) { await this.command(text.slice(1)); return; }
    this.busy = this.busyLines.next(this.busy);
    this.status = undefined;
    this.choices = [];
    this.markFocus = undefined;
    this.emit();
    const before = core.session.sceneId;
    const stop = this.watch();
    try {
      await core.say(text, this.hooks());
      // What the stage manager did after the reply: who walked where, what changed.
      this.observeScene();
      // A spell attack can leave the rules campaign unloadable (see rules-repair.ts).
      if (repairCampaign(core.session)) core.save();
    } catch (error) {
      const said = this.failed(`a turn in ${core.session.sceneId}: "${text}"`, error);
      // A turn that fails part-way leaves things half-changed: go back to the last save.
      this.core = Core.load(core.state.id, this.explorer, this.fights);
      // The scene's look saw the half-changed world: it starts again from the saved one, so going back isn't news.
      this.look = undefined;
      this.rolled = [];
      if (this.core.state.mode === "scene") {
        this.showSceneSoFar();
        this.lines.push({ kind: "error", speaker: "system", text: `The GM lost the thread (${said}). Your last turn didn't happen; try it again.` });
      } else {
        // The last save is from before it: a talk whose greeting never came, or a scene whose opening didn't
        // (neither is saved until it's begun). Back on the map where that left the player.
        this.toMap(core.session.talk ? `The GM lost the thread (${said}), and the talk with it.`
          : `The GM lost the thread (${said}). The scene never got going (its opening didn't come): you're back where you were before it, and going in again tries it afresh.`);
      }
    } finally {
      stop();
    }
    this.busy = undefined;
    this.live = undefined;
    await this.settle(before);
  }

  /**
   * One of the core's choices: a line to say (a talk's suggestions and its goodbye), said as if
   * typed; or walking on without a word, straight back to the map.
   */
  choose(action: Action): void {
    if (action.kind === "say") void this.input(action.label);
    else void this.walkOn(action);
  }

  /** Walking on from a talk without a word (the core's walk_on): back on the map at once, as its label says. Nothing to read, so no way on to press. */
  private async walkOn(action: Action): Promise<void> {
    const core = this.core;
    if (!core || this.busy || this.over || core.state.mode !== "scene") return;
    let text: string;
    try {
      text = await core.act(action.id, this.hooks());
    } catch (error) {
      this.status = this.failed(`a talk: ${action.id}`, error);
      this.emit();
      return;
    }
    this.saveExtras();
    // The act changed the mode (the narrowing above can't know that).
    if ((core.state.mode as Core["state"]["mode"]) === "explore") this.toMap(text.replace(/^\((.*)\)$/, "$1"));
    else { this.refreshChoices(); this.emit(); }
  }

  /** Off the scene screen and onto the map, with a word in "What happens" (a talk that's over, or never was). */
  private toMap(said: string): void {
    this.over = undefined;
    this.sceneMenu = undefined;
    this.card = undefined;
    this.busy = undefined;
    this.live = undefined;
    this.status = undefined;
    this.choices = [];
    this.typing = false;
    this.screen = "explore";
    this.say(said);
    this.saveExtras();
    this.emit();
  }

  private async command(command: string): Promise<void> {
    const [typed = "", ...rest] = command.trim().split(/\s+/);
    const core = this.core!;
    const session = core.session;
    // The sheet, the map, the notebook and the help are peek's.
    switch (commandNamed(typed)) {
      case "save": core.save(); this.saveExtras(); this.status = "Saved. The clerk will keep."; break;
      case "quit": this.quitToTitle(); return;
      case "exits": {
        const scene = sceneById(session.sceneId);
        this.lines.push({ kind: "system", speaker: "system", text: `Exits (for testing, /end <id>): ${scene.exits.filter(e => !session.fought?.includes(e.id)).map(e => `${e.id} (${e.title})`).join(", ")}`, scene: scene.id });
        break;
      }
      case "end": {
        // For testing: end the scene through an exit now, as if play had reached it.
        const exit = sceneById(session.sceneId).exits.find(e => e.id === rest[0]);
        if (!exit) { await this.command("exits"); this.status = rest[0] ? `No exit "${rest[0]}" here.` : "Which ending? /end <id>"; this.emit(); return; }
        await this.moveOn(() => core.endScene(exit.id, this.hooks()));
        return;
      }
      default:
        this.status = typed
          ? `There's no /${typed}. There's ${COMMANDS.filter(c => !c.testing).map(c => `/${c.name}`).join(", ").replace(/, ([^,]+)$/, " and $1")}.`
          : "A slash on its own says very little. Try /help.";
    }
    this.emit();
  }

  /** The scene has ended outside a turn (/end, or a resume in between): the core takes the story on. */
  private async moveOn(run: () => Promise<string>): Promise<void> {
    const before = this.session!.sceneId;
    this.busy = "The story moves on…";
    this.choices = [];
    this.emit();
    const stop = this.watch();
    try {
      const running = run();
      // An /end has ended it by now (and a resume came back after the end): it's over.
      if (this.notice()) this.emit();
      await running;
    } catch (error) {
      const line: Line = { kind: "error", speaker: "system", text: `The story couldn't move on cleanly: ${this.failed("move the story on", error)}` };
      this.lines.push(line);
      // It went wrong in the next scene (a summons): say so there too.
      if (this.over && this.session?.sceneId !== this.shown) this.over.carry = [...(this.over.carry ?? []), line];
    } finally {
      stop();
    }
    this.busy = undefined;
    this.live = undefined;
    await this.settle(before);
  }

  /**
   * After the core has moved: the notebook catches up. A scene that's over stays on screen, its
   * last reply with it, until the player goes on (continueScene); what comes next is got ready now.
   */
  private async settle(before: string): Promise<void> {
    const core = this.core;
    // Gone back to the title while the story was moving on: nothing to settle.
    if (!core) return;
    const session = core.session;
    for (const h of session.history) {
      const scene = sceneById(h.sceneId);
      if (scene.interlude || this.journal.some(j => j.sceneId === h.sceneId && j.ending !== "A fight")) continue;
      this.note({ sceneId: h.sceneId, title: scene.title, ending: scene.exits.find(e => e.id === h.exitId)?.title ?? h.exitId, lines: notebookLines(session, h.sceneId) });
    }
    this.notice(true);
    const over = this.over;
    if (over) {
      const shown = this.shown ?? before;
      over.ready = true;
      this.busy = undefined;
      const ending = this.endingOf(shown);
      if (ending) {
        over.ending = ending;
        // How it ended is its last line, as a resumed transcript has it.
        if (!this.lines.some(l => l.kind === "system" && l.text === `Scene ends: ${ending}`)) this.lines.push({ kind: "system", speaker: "system", text: `Scene ends: ${ending}`, scene: shown });
      }
      // A talk moves nothing on (the lead is still the lead): its way on goes straight back to the map.
      // After a scene of the story, the moment between scenes: Kell with the news, or the card.
      if (core.state.mode === "explore" && talkOf(shown)) this.card = undefined;
      else if (core.state.mode === "explore" && core.state.hub) this.card = this.hubCard(shown);
      else if (core.state.mode === "explore") {
        this.card = this.leadCard(shown);
        this.messages = [...this.messages, `${TIME_WORDS[core.state.story.time]}. The lead: ${sceneById(session.sceneId).title}.`].slice(-20);
      }
      if (over.queued) this.continueScene({ queued: true });
    } else if (core.state.mode === "scene") this.refreshChoices();
    this.saveExtras();
    this.emit();
  }

  /**
   * The player goes on from a scene that's over (an Enter of its own, or a click): to the fight, to
   * whoever walks with them (then the map), into the next scene, or to The End; from a talk, back to
   * the map. Before the story has finished moving on, they go as soon as it has (`queued`: it has
   * now, and anything typed while they waited is still being typed); a summons's next scene they can
   * watch come in straight away.
   */
  continueScene(options: { queued?: boolean } = {}): void {
    const core = this.core, over = this.over;
    if (!core || !over || this.screen !== "scene") return;
    if (!options.queued) this.typing = false;
    this.status = undefined;
    if (core.state.mode === "scene" && core.session.sceneId !== this.shown) {
      this.showSceneSoFar();
      this.lines.push(...(over.carry ?? []));
      if (!over.ready) this.busy = this.live ? "The GM is speaking…" : "The GM sets the scene…";
      this.emit();
      return;
    }
    if (!over.ready) { over.queued = true; this.emit(); return; }
    this.over = undefined;
    this.sceneMenu = undefined;
    // The story couldn't move on (the hand-off failed): Continue tries it again.
    if (core.state.mode === "scene" && core.session.sceneId === this.shown && core.session.ended) { void this.moveOn(() => core.carryOn(this.hooks())); return; }
    switch (core.state.mode) {
      case "end": this.toEnd(); break;
      case "combat": this.freshFight(); this.screen = "combat"; break;
      case "explore": this.screen = this.card ? "between" : "explore"; break;
      default: this.showSceneSoFar();
    }
    this.saveExtras();
    this.emit();
  }

  /**
   * How a scene ended: its exit's title (while it's the session's scene, or from the story's history
   * once it has moved on). A talk that's over has gone from both (the story's scene is back): it
   * ended the one way a talk ends.
   */
  private endingOf(sceneId: string): string | undefined {
    const session = this.session!;
    if (talkOf(sceneId) && session.sceneId !== sceneId) return sceneById(sceneId).exits[0]?.title;
    const exitId = session.sceneId === sceneId ? session.ended?.exitId : session.history.findLast(h => h.sceneId === sceneId)?.exitId;
    return exitId ? sceneById(sceneId).exits.find(e => e.id === exitId)?.title ?? exitId : undefined;
  }

  /** What the core offers in a scene now (a talk's lines to say, its goodbye, walking on), if anything. */
  private refreshChoices(): void {
    const core = this.core;
    try {
      this.choices = core?.state.mode === "scene" && !this.over ? core.observe().actions : [];
    } catch (error) {
      noteError("the scene's choices", error);
      this.choices = [];
    }
  }

  /**
   * Between a scene and the map: the notebook, how the time went, where the story goes next. Whoever
   * walks with the player tells it, Kell reading the entry back in the words of the record; with
   * nobody there, it's a card. Where next is the core's lead, in the map's own words (leadWay): what
   * the sidebar will say, arrow and all, when the map comes up.
   */
  private leadCard(sceneId: string): Card {
    const core = this.core!;
    const session = core.session;
    const next = sceneById(session.sceneId);
    const ex = exploreState(core.state);
    const where = leadTarget(core.state);
    const way = where ? leadWay(ex.at, where) : undefined;
    const notebook = this.journal.find(j => j.sceneId === sceneId)?.lines ?? [];
    const card: Card = {
      title: TIME_WORDS[core.state.story.time],
      lines: [
        ...(notebook.length ? ["Your notebook:", ...notebook, ""] : []),
        ...(session.lead ? [session.lead, ""] : []),
        `The lead: ${next.title}.${way ? ` The way: ${way}.` : ""}`,
        "",
        "Press Enter to walk there (g on the map walks you to the lead).",
      ],
      next: "explore",
    };
    const friend = ex.followers.find(f => f.map === ex.map) ?? ex.followers[0];
    if (friend) card.talk = talkBetween(friend, { notebook, lead: session.lead, next, way, time: core.state.story.time });
    return card;
  }

  /**
   * After one of a hub's scenes (the zoo's): its notebook entry, read back by whoever walks with the
   * player (Kell, in the words of the record), then back to the map. Nothing moves on.
   */
  private hubCard(sceneId: string): Card {
    const core = this.core!;
    const ex = exploreState(core.state);
    const notebook = this.journal.find(j => j.sceneId === sceneId)?.lines ?? [];
    // What became of the place offstage (the scene's afterwards: Prout taken off the hoist), as its ending applied it.
    const scene = sceneById(sceneId);
    const nameOf = (id: string) => scene.world?.things.find(t => t.id === id)?.name ?? scene.cast.find(c => c.id === id)?.name ?? id;
    const after = (scene.afterwards ?? []).map(o => o.op === "remove" ? `${capital(nameOf(o.what))} is ${o.text ?? "gone"}.` : `${capital(nameOf(o.what))}: ${o.op}${o.text ? ` (${o.text})` : ""}.`);
    const card: Card = {
      title: `${scene.title}: over`,
      lines: [
        ...(notebook.length ? ["Your notebook:", ...notebook, ""] : []), ...(after.length ? ["Afterwards, offstage:", ...after, ""] : []),
        "Nothing in the zoo moves the story on. The next exhibit is where g walks you.", "", "Press Enter to go back to the map.",
      ],
      next: "explore",
    };
    const friend = ex.followers.find(f => f.map === ex.map) ?? ex.followers[0];
    if (friend && notebook.length) card.talk = [{ kind: "dialogue", speaker: friend.id, name: friend.name, text: `“For the record.” She reads the entry back to you, in the words of the record: “${notebook.join(" ")}” She looks at it a moment longer. “Noted.”` }];
    return card;
  }

  private note(entry: JournalEntry): void {
    const i = this.journal.findIndex(j => j.sceneId === entry.sceneId);
    if (i >= 0) this.journal[i] = { ...entry, lines: [...new Set([...this.journal[i]!.lines, ...entry.lines])] };
    else this.journal.push(entry);
  }

  /** On from the moment between scenes (an Enter of its own, or a click): to the map. */
  continueFromCard(): void {
    const card = this.card;
    if (!card || card.working) return;
    this.card = undefined;
    this.typing = false;
    this.screen = card.next === "combat" ? "combat" : card.next === "end" ? "end" : card.next === "scene" ? "scene" : "explore";
    this.emit();
  }

  // -------------------------------------------------------------------------------------------
  // The scene's place: pointing, looking, and the right-click menu (src/game/scene-menu.ts)

  /**
   * What the scene's menu needs to word things as the player knows them: what to call the cast
   * whose names they haven't heard, the names people go by, their spells (with what the rules say
   * of each one's reach, once read), and whether the GM has the floor or the scene is over.
   */
  sceneContext(): SceneContext {
    const session = this.session, shown = this.shownScene;
    const scene = shown ? sceneById(shown) : undefined;
    const ready = session?.rules?.spells ?? [];
    if (ready.some(s => !this.spellFacts.has(s.id))) void this.loadSpellFacts();
    return {
      ...(scene && session ? { unnamed: unnamed(scene, session) } : {}),
      ...(scene ? { aka: Object.fromEntries(scene.cast.filter(c => c.aka?.length).map(c => [c.id, c.aka!])) } : {}),
      spells: ready.map(s => this.spellFacts.get(s.id) ?? s),
      ...(this.busy ? { busy: true } : {}), ...(this.over ? { over: true } : {}),
    };
  }

  /** Read what the rules say of the player's spells (range, effects, area): the menu offers each where it fits. */
  loadSpellFacts(): Promise<void> {
    const ready = this.session?.rules?.spells ?? [];
    const missing = ready.filter(s => !this.spellFacts.has(s.id));
    if (!missing.length) return Promise.resolve();
    this.spellsLoading ??= (async () => {
      for (const s of missing) {
        const def = await spellInfo(s.id).catch(() => undefined);
        const targeting = def ? (def as unknown as { targeting?: { shape?: string } }).targeting : undefined;
        this.spellFacts.set(s.id, def ? { ...s, range: def.range, effects: (def.mechanicalEffects ?? []).map(m => String(m.kind)), ...(targeting?.shape ? { area: true } : {}) } : s);
      }
    })().finally(() => { this.spellsLoading = undefined; });
    return this.spellsLoading;
  }

  /** Right-click on the scene's place, or a line of the list under it (or Enter on what Tab picked out): what can be done with it. */
  openSceneMenu(target: SceneTarget, x: number, y: number): void {
    const world = this.shownWorld;
    if (!world || this.screen !== "scene") return;
    const menu = thingActions(world, target, this.sceneContext());
    if (!menu.actions.length) { this.closeSceneMenu(); return; }
    this.sceneMenu = { ...menu, target, x, y, index: 0 };
    this.emit();
  }

  closeSceneMenu(): void {
    if (!this.sceneMenu) return;
    this.sceneMenu = undefined;
    this.emit();
  }

  // -------------------------------------------------------------------------------------------
  // The GM's marked phrases (src/runtime/markup.ts): each person's colour, Tab, and the popover

  /** Markup found from the prose, for narration that came without any (an older save, the GM offline): by its text. */
  private derived = new Map<string, Markup>();

  /**
   * A line's markup: its own, or, for narration without any, its quoted lines as spoken, with the
   * speaker found from the prose as the look's barks find them. Nothing for other lines.
   */
  markupOf(line: Line): Markup | undefined {
    if (line.marked) return line.marked;
    if (line.kind !== "narration" || !/[“"]/.test(line.text)) return undefined;
    let found = this.derived.get(line.text);
    if (!found) {
      const session = this.session, shown = this.shownScene;
      const people = session && shown ? speakersOf(sceneById(shown), { ...session, ...(this.shownWorld ? { world: this.shownWorld } : {}) }) : [];
      found = { speech: withSpeakers({ text: line.text, speech: speechIn(line.text), marks: [] }, people).speech, marks: [] };
      if (this.derived.size > 200) this.derived.clear();
      this.derived.set(line.text, found);
    }
    return found;
  }

  /**
   * A spoken line's colour: the speaker's, as the place draws them (their glyph's colour); the
   * player's own blue for words of theirs; gold for anyone not in the place, or nobody anyone can tell.
   */
  speechColor(id: string | undefined): string {
    if (id === "you" || id === "player") return C.player;
    const e = id ? this.shownWorld?.entities[id] : undefined;
    if (!e || e.player || e.states.includes("gone") || (e.kind !== "person" && e.kind !== "creature")) return C.speech;
    return lookOf({ ...e, states: [] }, { glyphs: glyphSet() }).fg;
  }

  /** The last reply's marks, in order: what Tab goes through first. None when the last reply has none. */
  lastMarks(): Array<{ line: number; mark: number }> {
    const i = this.lines.findLastIndex(l => l.kind === "narration" || l.kind === "dialogue");
    const marks = i >= 0 ? this.lines[i]!.marked?.marks ?? [] : [];
    return marks.map((_, mark) => ({ line: i, mark }));
  }

  /** The transcript's lines are new (another scene, or the scene again from its save): what was picked out of them goes. */
  private forgetMarks(): void {
    this.markFocus = undefined;
    this.markPointed = undefined;
    if (this.overlay?.kind === "mark") this.overlay = undefined;
  }

  /** Open a marked phrase: the note on it, and what the player knows of what it's about (where it was clicked, if it was). */
  openMark(line: number, mark: number, x?: number, y?: number): void {
    if (!this.lines[line]?.marked?.marks[mark] || this.screen !== "scene") return;
    this.sceneMenu = undefined;
    this.overlay = { kind: "mark", line, mark, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) };
    this.emit();
  }

  /** Tab with a mark open: the next of the same reply's (or the one before), opened where the last one was. */
  stepMark(by: number): void {
    const o = this.overlay;
    if (o?.kind !== "mark") return;
    const n = this.lines[o.line]?.marked?.marks.length ?? 0;
    if (n < 2) return;
    this.overlay = { ...o, mark: (o.mark + by + n) % n };
    this.markFocus = { line: o.line, mark: this.overlay.mark };
    this.emit();
  }

  /**
   * A glance at something in the place (the menu's Look, worded by lookText: what anyone could
   * see, never the world's descriptions, which are the GM's): at once, as a quiet note in the
   * transcript. It isn't a turn. The same look twice running is noted once.
   */
  lookNote(text: string): void {
    if (!text) return;
    const last = this.lines.at(-1);
    if (last?.kind !== "look" || last.text !== text) this.lines.push({ kind: "look", speaker: "player", text, ...(this.shownScene ? { scene: this.shownScene } : {}) });
    this.emit();
  }

  /**
   * A deed from the scene's menu ("(I pick up Prout's satchel)"): the player's turn, as if typed,
   * for the director, the rules and the GM to take as they take typed deeds. Not while the GM has
   * the floor (it waits for nobody), nor once the scene's over.
   */
  async deed(line: string): Promise<void> {
    if (this.busy || this.over) {
      this.status = this.over ? "The scene is over: there's only looking now." : "The GM has the floor: that will have to wait until they've finished.";
      this.emit();
      return;
    }
    await this.input(line);
  }

  // -------------------------------------------------------------------------------------------
  // Combat

  /** A fight comes on screen (or goes): no target held, the keys the fight's own, nothing typed answered. */
  private freshFight(): void {
    this.targetIndex = 0; this.targetId = undefined;
    this.fightBox = false; this.fightLive = undefined; this.fightReply = undefined; this.fightWait = undefined;
  }

  /** Who the player can aim at: everyone on the other side still in it, nearest first. */
  fightTargets(): Array<{ id: string; name: string; at: { x: number; y: number } }> {
    const c = this.fight;
    if (!c) return [];
    const G = c.state();
    const me = G.units[G.pc]!;
    return Object.values(G.units).filter(u => u.side === "enemy" && u.state === "fighting" && u.role !== "coward")
      .sort((a, b) => Math.max(Math.abs(a.at.x - me.at.x), Math.abs(a.at.y - me.at.y)) - Math.max(Math.abs(b.at.x - me.at.x), Math.abs(b.at.y - me.at.y)) || a.id.localeCompare(b.id))
      .map(u => ({ id: u.id, name: u.name, at: u.at }));
  }

  target(): { id: string; name: string; at: { x: number; y: number } } | undefined {
    const all = this.fightTargets();
    if (!all.length) return undefined;
    const held = this.targetId ? all.find(t => t.id === this.targetId) : undefined;
    if (held) { this.targetIndex = all.indexOf(held); return held; }
    const t = all[Math.min(this.targetIndex, all.length - 1)]!;
    this.targetId = t.id;
    return t;
  }

  /** A fight action by id, as the QA console would take it; the other side's turns play out after it, paced. */
  async combatAct(id: string): Promise<void> {
    const core = this.core;
    if (!core || this.busy || core.state.mode !== "combat") return;
    if (id === "continue") { await this.afterCombat(); return; }
    this.busy = "…";
    this.status = undefined;
    this.fightReply = undefined;
    this.fightWait = undefined;
    this.emit();
    try {
      const said = await core.act(id, this.hooks());
      // A refusal comes back in brackets ("The talking Crake is out of reach").
      const refusal = /^\((.+)\)$/.exec(said.trim());
      if (refusal) this.status = refusal[1];
    } catch (error) {
      this.status = `That didn't work: ${this.failed(`a fight: ${id}`, error)}`;
    }
    this.animateFight();
    this.busy = undefined;
    this.emit();
  }

  /**
   * A line typed in the fight's box, as in a scene's: the core reads it onto the turn (plain
   * commands with no model, the decider for the rest) and does it as a click would. What the rules
   * did shows at once, then the GM's line streams into the log (Esc or a fight key waves it on),
   * then the others' turns, paced. A line that comes to nothing says why under the log, and
   * nothing's spent. True when the line is worth saying again as it was (the rules want a second
   * word first: a Fireball that catches a friend), for the box to keep it.
   */
  async combatSay(text: string): Promise<boolean> {
    const core = this.core;
    if (!core || this.busy || core.state.mode !== "combat" || !text.trim()) return false;
    this.busy = "…";
    this.status = undefined;
    this.fightReply = undefined;
    this.fightWait = undefined;
    const skip = new AbortController();
    this.fightSkip = skip;
    this.emit();
    const name = (who: string) => this.fight?.state().units[who]?.called ?? who;
    let again = false;
    try {
      const said = await core.say(text, {
        skip: skip.signal,
        onReading: () => { this.busy = modelOffline() ? "…" : "The GM considers it…"; this.emit(); },
        // The rules first: what they did is on the board and in the log before the GM says a word.
        onRules: () => { this.animateFight(); this.busy = "…"; this.emit(); },
        onSpeaker: who => { this.fightLive = { who, text: "" }; this.busy = who === "gm" ? "The GM is speaking…" : `${capital(name(who))} is speaking…`; this.emit(); },
        onText: t => { if (this.fightLive) { this.fightLive.text = t; this.emitSoon(); } },
      });
      // A line that came to nothing comes back in brackets: why, under the log.
      const refusal = /^\(([^\n]+)\)$/.exec(said.trim());
      if (refusal) this.fightReply = refusal[1];
      again = !!refusal && SAY_AGAIN.test(refusal[1]!);
    } catch (error) {
      this.fightReply = `That didn't work: ${this.failed(`a fight: "${text}"`, error)}`;
    }
    this.fightSkip = undefined;
    this.fightLive = undefined;
    this.animateFight();
    this.busy = undefined;
    this.emit();
    return again;
  }

  /** Waves the GM's line on a typed turn on, where it's got to (the rules' lines stand). */
  skipFightLine(): void {
    this.fightSkip?.abort();
  }

  /**
   * Cast a spell: at the target (on them, or an area on their tile), or on yourself; if the target
   * isn't one the spell can reach, at the first one it can.
   */
  async cast(spell: string, onSelf = false): Promise<void> {
    const c = this.fight;
    if (!c) return;
    const ids = this.fightActions.map(a => a.id).filter(id => id === `cast_${spell}` || id.startsWith(`cast_${spell}_`));
    const t = this.target()?.id;
    const pick = onSelf
      ? ids.find(id => id === `cast_${spell}_${c.state().pc}` || id === `cast_${spell}`)
      : ids.find(id => id === `cast_${spell}_${t}` || id === `cast_${spell}_at_${t}`) ?? ids.find(id => id === `cast_${spell}`) ?? ids[0];
    if (!pick) { this.status = onSelf ? "That spell isn't one you can cast on yourself." : "Nobody that spell can reach from here."; this.emit(); return; }
    await this.combatAct(pick);
  }

  /** The fight is over (Enter): the scene picks up from how it went, as the core has it. */
  async afterCombat(): Promise<void> {
    const core = this.core;
    const result = core?.currentFight?.result();
    if (!core || !result || this.busy) return;
    this.freshFight();
    const session = core.session;
    const said = { victory: "We won the fight.", surrender: "We won: they gave up.", defeat: "We lost the fight, and I woke up on the floor.", fled: "We got out of there." }[result.outcome];
    const fell = result.casualties.filter(c => c.state !== "standing" && c.id !== "kell").map(c => `${c.name} ${c.state === "down" ? "went down" : c.state}`);
    // A fight from the map (the town's people came at the player, or a zoo ring's bell) goes back to
    // the map: how it went is the news. A ring's goes in the notebook too, as a zoo scene's ending does.
    if (core.state.fightOnMap) {
      const ring = core.state.hub ? zooOf(core.state).fight?.arena : undefined;
      if (ring) this.note({ sceneId: `arena:${ring}`, title: "The Arena", ending: "A fight", lines: [`${said}${fell.length ? ` ${capital(fell.join("; "))}.` : ""}`] });
      this.busy = "The dust settles…";
      this.emit();
      try {
        // One paragraph: What happens is a few rows.
        const text = await core.act("continue", this.hooks());
        this.say(text.replace(/^The fight: /, "").replace(/\s*\n+\s*/g, " "));
      } catch (error) {
        this.say(`The fight's end didn't settle cleanly: ${this.failed("a fight's end, back to the map", error)}`);
      }
      this.busy = undefined;
      this.fightLook = undefined;
      this.townLook = undefined;
      this.screen = core.state.mode === "explore" ? "explore" : this.screen;
      this.saveExtras();
      this.emit();
      return;
    }
    this.note({ sceneId: session.sceneId, title: sceneById(session.sceneId).title, ending: "A fight", lines: [`${said}${fell.length ? ` ${capital(fell.join("; "))}.` : ""}`] });
    const before = session.sceneId;
    // Back to the scene: the GM tells the aftermath as it streams in.
    this.screen = "scene";
    this.showSceneSoFar();
    this.busy = "The dust settles…";
    this.emit();
    try {
      await core.act("continue", this.hooks());
      // Where the fight left everyone, and what it set alight.
      this.observeScene();
    } catch (error) {
      this.showSceneSoFar();
      this.lines.push({ kind: "error", speaker: "system", text: `The GM couldn't tell the aftermath: ${this.failed("a fight's aftermath", error)}. (Say what you do next; /end <exit> skips ahead for testing.)` });
    }
    this.busy = undefined;
    this.live = undefined;
    await this.settle(before);
  }

  // -------------------------------------------------------------------------------------------
  // The look: what happens, shown in the world as it happens (src/game/look)

  /**
   * The open scene's effects and the director that turns what changes in its world into motion:
   * one of each per scene, primed on its world when first asked for (what's already there isn't
   * news). The scene's views draw them; undefined when the scene has no world. It keeps the world
   * it last saw, so a scene that's over still shows its place until the player goes on.
   */
  sceneLook(): { fx: Effects; director: Director } | undefined {
    const world = this.shownWorld;
    if (!world) return undefined;
    if (this.look?.scene !== world.scene) {
      const fx = new Effects();
      const director = new Director(fx);
      director.prime(world);
      this.look = { scene: world.scene, fx, director, world };
    } else this.look.world = world;
    return this.look;
  }

  /** A finished entry, in the world: the rules' lines (a spell, a fire, damage numbers), short lines over their speakers. */
  private animate(entry: Entry): void {
    const look = this.screen === "scene" ? this.sceneLook() : undefined;
    const world = this.session?.world;
    if (!look || !world) return;
    if (entry.kind === "roll") {
      // A spell and what it did land as a burst of lines: show them together.
      if (!this.rolled.length) setTimeout(() => this.animateRolls(), 0);
      this.rolled.push(entry.text);
    } else if (entry.kind === "narration" && entry.marked?.speech.some(s => s.speaker)) {
      // Who says what is known (the GM's tags): each short line over whoever said it.
      look.director.barksFromSpeech(world, entry.marked.speech.map(s => ({ speaker: s.speaker, text: entry.text.slice(s.start, s.end) })), performance.now());
    } else if (entry.kind === "narration") look.director.barksFrom(world, entry.text, performance.now(), this.called());
    else if (entry.kind === "dialogue") look.director.barkLine(world, entry.speaker, entry.text, performance.now());
  }

  /** What the scene's cast are called before the player knows their names ("the landlady"), by id. */
  private called(): Record<string, string> {
    const scene = this.session ? sceneById(this.session.sceneId) : undefined;
    return Object.fromEntries((scene?.cast ?? []).filter(c => c.called).map(c => [c.id, c.called!]));
  }

  private animateRolls(): void {
    const lines = this.rolled;
    this.rolled = [];
    const look = this.sceneLook(), world = this.session?.world;
    if (!look || !world) return;
    const now = performance.now(), aliases = this.session?.rules?.aliases ?? {};
    look.director.spellsFrom(world, lines, now, aliases);
    // The numbers from the lines first: observe then floats only what they didn't say.
    look.director.rulesLines(world, lines, now, aliases);
    look.director.observe(world, now);
  }

  /** After a turn: who walked where, what caught fire, what broke. */
  private observeScene(): void {
    const look = this.sceneLook(), world = this.session?.world;
    if (look && world) look.director.observe(world, performance.now());
  }

  /**
   * The town's look between scenes: one Effects and one Director for the map the player is on, and
   * the town's world they play in (src/game/town-world.ts). `fresh`: take the world as it is now (just
   * before an act, so only what the act does is news). Undefined in a scene, and on a map with a world
   * of its own (a zoo's wing), which has its own look (mapFx) and plays what's done there as the zoo's news.
   */
  townFx(fresh = false): { fx: Effects; director: Director; world: SceneWorld } | undefined {
    const core = this.core;
    if (!core || core.state.mode !== "explore") return this.townLook;
    const ex = exploreState(core.state);
    if (ex.scene || ex.roam?.[ex.map]) return undefined;
    if (!this.townLook || this.townLook.map !== ex.map) {
      const fx = new Effects();
      const director = new Director(fx);
      const world = townWorld(ex).world;
      director.prime(world);
      this.townLook = { map: ex.map, fx, director, world };
    } else if (fresh) {
      this.townLook.world = townWorld(ex).world;
      this.townLook.director.prime(this.townLook.world);
    }
    return this.townLook;
  }

  /** What an act on the map did, in the town's world: the spell from the player to its aim, the numbers, what broke or caught fire, who ran. */
  private animateTown(text: string): void {
    const core = this.core, look = this.townLook;
    if (!core || !look) return;
    const ex = exploreState(core.state);
    if (look.map !== ex.map) return;
    const world = townWorld(ex).world;
    const lines = text.split("\n").filter(Boolean);
    const now = performance.now();
    look.director.spellsFrom(world, lines, now);
    look.director.rulesLines(world, lines, now);
    look.director.observe(world, now);
    look.world = world;
  }

  /** The fight's effects (bolts, sparks, damage numbers, the dust going up): one set for each fight. */
  fightFx(): Effects | undefined {
    const fight = this.fight;
    if (!fight) return undefined;
    if (this.fightLook?.fight !== fight) this.fightLook = { fight, fx: new Effects(), seen: fight.state().log.length, dust: [...fight.state().dust].map(k => tileOf(k)) };
    return this.fightLook.fx;
  }

  /** Show what the fight's log has said since last time. */
  private animateFight(): void {
    const fx = this.fightFx(), look = this.fightLook, fight = this.fight;
    if (!fx || !look || !fight) return;
    const G = fight.state();
    // A fight on the town's map plays in the town's feet; one with a world of its own (a scene's, a zoo ring's) in the world's.
    fightEffects(fx, fight, G.log.slice(look.seen), performance.now(), look.dust, !!this.core?.state.fightOnMap && !this.session?.world);
    look.seen = G.log.length;
    look.dust = G.dust.map(tileOf);
  }

  // -------------------------------------------------------------------------------------------
  // Reporting a problem (src/report): b on the map and in a fight, /report in a scene, the Esc
  // menu's Report a problem…, the title's (about the latest game)

  /**
   * Ask what went wrong, over whatever's on screen, which is kept as it was: the frame drawn before
   * the question came up (from the Esc menu, the one before the menu opened; or, when the renderer
   * can't be read just then, the last one noted).
   */
  openReport(): void {
    this.walking = false;
    const from = this.overlay?.kind;
    const screen = (from === "menu" ? undefined : this.screenText?.()) ?? recentScreens().at(-1)?.text;
    this.overlay = { kind: "report", ...(screen ? { screen } : {}), ...(from && from !== "menu" && from !== "report" ? { from } : {}) };
    this.emit();
  }

  /**
   * The player's words, and the report goes: the game saved first (as /save does, unless a turn is
   * under way, when what's in memory goes in beside the last save), then everything Claude needs to
   * look into it (src/report/dump.ts). Then it says where the report went, to tell Claude.
   */
  async sendReport(words: string): Promise<void> {
    const report = this.overlay;
    if (report?.kind !== "report" || report.sending || report.said) return;
    if (!words.trim()) { report.problem = "Say what went wrong first: a line or two, then Enter."; this.emit(); return; }
    report.sending = true;
    delete report.problem;
    this.emit();
    const core = this.core;
    const midTurn = !!core && !!this.busy;
    try {
      // A save that fails is one more thing for the report to say, not a reason to go without it.
      if (core && !midTurn) { try { core.save(); } catch (error) { noteError("save before a report", error); } }
      this.saveExtras();
      const session = core?.state.id ?? latestGame()?.id;
      const terminal = this.terminalSize?.();
      const filed = await fileReport({
        words, where: this.whereNow(report.from), ...(session ? { session } : {}), ...(report.screen ? { screen: report.screen } : {}),
        ...(midTurn && core ? { live: { game: core.state, session: core.session } } : {}), ...(terminal ? { terminal } : {}), glyphs: glyphSet(),
      });
      if (this.overlay === report) this.overlay = { kind: "report", said: filed.said };
      // On the map, What happens keeps it too.
      if (this.screen === "explore") this.say(filed.said);
    } catch (error) {
      if (this.overlay === report) this.overlay = { kind: "report", failed: true, said: `The report couldn't be saved: ${this.failed("report", error)}` };
    }
    this.emit();
  }

  /** Where the app is, for a report: its screen, what was open over it, the turn under way, the fight. */
  private whereNow(from?: string): Where {
    const view = this.fight?.view();
    return {
      screen: this.screen,
      ...(from ? { overlay: from } : {}),
      ...(this.busy ? { busy: this.busy } : {}),
      ...(this.status ? { status: this.status } : {}),
      ...(this.over ? { over: this.over.ending ?? "the scene is over" } : {}),
      ...(view ? { fight: { round: view.round, ...(view.turn ? { turn: view.turn.name } : {}) } } : {}),
      ...(this.core ? {} : { latest: true }),
    };
  }

  /** An error caught and shown: noted for a report (with its stack), and its message for the screen. */
  private failed(where: string, error: unknown): string {
    noteError(where, error);
    return message(error);
  }

  // -------------------------------------------------------------------------------------------
  // The End, overlays, saving

  private toEnd(): void {
    const session = this.session!;
    this.ending = epilogue(session);
    this.card = undefined;
    this.screen = "end";
    this.saveExtras();
  }

  async showSheet(): Promise<void> {
    if (!this.session) return;
    // In a fight, the player as the fight has left them so far (its campaign is written back when it ends).
    const campaign = this.fight?.state().campaign;
    try { this.overlay = { kind: "sheet", sheet: await sheetData(this.session, campaign ? { campaign } : {}) }; }
    catch (error) { this.overlay = { kind: "sheet", error: `The sheet couldn't be read: ${this.failed("the sheet", error)}` }; }
    this.emit();
  }

  closeOverlay(): void {
    this.overlay = undefined;
    this.emit();
  }

  saveExtras(): void {
    if (!this.core) return;
    try { saveExtras({ sessionId: this.core.state.id, messages: this.messages.slice(-12), journal: this.journal }); } catch (error) { noteError("save the notebook", error); }
  }

  toTitle(): void {
    // The zoo's glyph lever was the zoo's: the story draws with KM_GLYPHS's set again.
    if (this.core?.state.hub) setGlyphSet(undefined);
    noteGame(undefined);
    this.screen = "title";
    this.overlay = undefined;
    this.card = undefined;
    this.core = undefined;
    this.lines = [];
    this.walking = false;
    this.menu = undefined;
    this.sceneMenu = undefined;
    this.doMenu = undefined;
    this.aiming = undefined;
    this.over = undefined;
    this.choices = [];
    this.typing = false;
    this.freshFight();
    this.shown = undefined;
    // Another game's scene is news to nobody.
    this.look = undefined;
    this.fightLook = undefined;
    this.townLook = undefined;
    this.wingLook = undefined;
    this.loadSaves();
  }

  quitToTitle(): void {
    this.saveAll();
    this.toTitle();
  }

  quit(): void {
    this.saveAll();
    this.quitting = true;
    this.emit();
  }

  private saveAll(): void {
    if (!this.core || this.screen === "title") return;
    try { this.core.save(); } catch (error) { noteError("save on the way out", error); /* the runtime saved the session after the last turn */ }
    this.saveExtras();
  }
}

/** How the time between scenes went, when the story's hand-off didn't say (its lead is its own words for it). */
const PASSING: Record<StoryState["time"], string> = {
  morning: "The morning gets on with itself, as mornings in Caerwyn do: loudly, and mostly downhill towards the river.",
  afternoon: "The rest of the morning goes in statements, signatures and a bun of uncertain age at the watch-house.",
  evening: "The afternoon goes in paperwork. By the time it’s done, the lamplighters are out along the quay.",
  night: "Evening turns into night the way it does in Caerwyn: without asking anyone.",
  "next-morning": "The night passes. Some of it is even spent asleep.",
};

/** What Kell adds once she's shown you the way: her view of the place the story goes next (not how to get there: that's the map's). */
const KELL_ON: Record<string, string> = {
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
export function talkBetween(friend: { id: string; name: string }, what: { notebook: string[]; lead?: string | undefined; next: { id: string; title: string }; way?: string | undefined; time: StoryState["time"] }): Line[] {
  const says = (text: string): Line => ({ kind: "dialogue", speaker: friend.id, name: friend.name, text });
  const kell = friend.id === "kell";
  const out: Line[] = [];
  const entry = what.notebook.join(" ");
  if (entry) out.push(says(kell
    ? `“For the record.” She reads the entry back to you, in the words of the record: “${entry}” She looks at it a moment longer. “Noted.”`
    : `“So,” says ${friend.name}. “${entry}”`));
  out.push({ kind: "narration", speaker: "gm", text: what.lead ?? PASSING[what.time] });
  const way = what.way?.trim();
  if (!kell) out.push(says(`“${what.next.title} next.”${way ? ` ${friend.name} shows you the way: ${way}.` : ""}`));
  else out.push(says(`“${what.next.title}, then.” ${way ? `She draws you the way in her notebook’s margin: ${way}.` : "She writes it down."} “${KELL_ON[what.next.id] ?? "After you, investigator. I’ll be writing."}”`));
  return out;
}

/** A game is on: its model calls go in its folder's log, and what goes wrong is noted as its (for a report). */
function playing(id: string): void {
  setCallLog(join(sessionDir(id), "calls.jsonl"));
  noteGame(id);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const tileOf = (k: string): Tile2 => { const [x, y] = k.split(",").map(Number); return { x: x!, y: y! }; };
/** A path cut short where it first comes within a step of a tile (the walk over before doing something there). */
function within(path: Array<[number, number]>, from: Tile2, at: Tile2): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let p = { ...from };
  for (const [dx, dy] of path) {
    if (steps(p, at) <= 1) break;
    out.push([dx, dy]);
    p = { x: p.x + dx, y: p.y + dy };
  }
  return out;
}
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
