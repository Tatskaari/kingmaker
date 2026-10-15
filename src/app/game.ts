import { join } from "node:path";
import { Game as Core, type Action } from "../game/play.ts";
import { TacticalFight, type CombatController } from "../game/combat/index.ts";
import { Director } from "../game/look/director.ts";
import { Effects } from "../game/look/effects.ts";
import { mapFights } from "../game/fights.ts";
import { getMap, isDoorway, pathTo, SCREEN_KEYS, steer, steps, tileName, walkPlan, type ExploreState } from "../game/map/index.ts";
import type { AimAt, AimView, MenuItem, MenuView } from "../game/menu.ts";
import { actionMenu, actionsAt, aimAt as aimAtTile, aimFor, exploreState, leadTarget, town, walkId, type TileActions } from "../game/town.ts";
import { townWorld } from "../game/town-world.ts";
import type { StoryState, Tile2 } from "../game/types.ts";
import { fightEffects } from "../game/views.ts";
import { setCallLog } from "../llm/openrouter.ts";
import { sheetData, type SheetData } from "../rules/dnd.ts";
import { sceneEntries } from "../runtime/brief.ts";
import type { TurnHooks } from "../runtime/engine.ts";
import { sessionDir, type Entry, type EntryKind, type SessionState } from "../runtime/session.ts";
import type { SceneWorld } from "../world/scene-world.ts";
import { sceneById } from "../../scenes/index.ts";
import { talkOf } from "../../scenes/talk.ts";
import { repairCampaign } from "./rules-repair.ts";
import { deleteSave, loadExtras, resumable, saveExtras, type JournalEntry, type Resumable } from "./save.ts";
import { DEFAULT_CONCEPT, DEFAULT_NAME, epilogue, leadWay, LEVEL, notebookLines, TIME_WORDS, type Epilogue } from "./story.ts";

/**
 * The game as the terminal UI sees it. The story flow is the game core's (src/game/play.ts: explore,
 * scene, combat, the end, and what links them), with Caerwyn on the map (src/game/town.ts) and
 * fights on the scene's own place (src/game/fights.ts): the same game the QA console plays. This
 * holds what the screens need on top: which screen is up, the transcript with the GM's reply
 * streaming in, the cards between scenes, the notebook, overlays, the fight's target, and pacing.
 * It holds no React; screens subscribe and redraw when it changes.
 */

export type Screen = "title" | "create" | "creating" | "created" | "explore" | "scene" | "between" | "combat" | "end";

export interface Line {
  /** "info": the rules' word on what changed without a roll (what you carry, what's burning); "roll" keeps the dice. */
  kind: EntryKind | "header" | "error" | "info";
  /** Speaker id (a cast id, "gm", "player", "dice", "system"). */
  speaker: string;
  /** Display name for dialogue and the player. */
  name?: string;
  text: string;
  /** The scene it's in: the next scene's opening can stream in while the last one is still on screen. */
  scene?: string;
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
  | { kind: "actions"; index: number; top: number };

const GM_BUSY = [
  "The GM is thinking…", "The GM consults their notes…", "The GM rolls something behind the screen and won't say what…", "The GM is doing the voices…",
  "The GM looks up the rules, then decides against them…", "The GM pretends this was the plan all along…", "The GM consults a table that may not exist…",
];
const DELAY = () => Number(process.env.KM_APP_COMBAT_DELAY_MS ?? 450);
const STEP_MS = () => Number(process.env.KM_APP_STEP_MS ?? 45);

export class Game {
  screen: Screen = "title";
  saves: Resumable[] = [];
  core?: Core;
  readonly explorer = town;
  readonly fights = mapFights();
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
  overlay?: Overlay;
  /** The sheet the rules engine just made (the created screen). */
  sheet?: SheetData;
  creating?: { name: string; concept: string };
  ending?: Epilogue;
  error?: string;
  /** Set when the app should exit (main.tsx tears the renderer down). */
  quitting = false;
  /** Walking a step at a time (to the lead, or where the player clicked): any key or click stops it. */
  walking = false;
  /** The map's right-click menu, while it's open. */
  menu?: TileMenu;
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

  /** Each walk's number: a new walk takes over from the one before. */
  private walkNo = 0;
  /** The scene the transcript shows (a summons can open the next scene inside a turn). */
  private shown?: string;
  private listeners = new Set<() => void>();
  private pending?: ReturnType<typeof setTimeout>;
  private busyTurn = 0;
  /** A turn of the player's is being played: a scene ending now is theirs to read before going on (see notice). */
  private watching = false;
  /** The open scene's look: one Effects and one Director for the scene, and its world (see sceneLook). */
  private look?: { scene: string; fx: Effects; director: Director; world: SceneWorld };
  /** The rules' lines landing in a turn, shown together once a burst of them is in. */
  private rolled: string[] = [];
  /** The fight's effects, and how much of its log they've shown (see fightFx). */
  private fightLook?: { fight: CombatController; fx: Effects; seen: number; dust: Tile2[] };
  /** The town's look between scenes: the effects of what the player does on the map, in the town's world (see townFx). */
  private townLook?: { map: string; fx: Effects; director: Director; world: SceneWorld };

  constructor() {
    // The other side's turns: redraw after each, and give the player a beat to see it land.
    this.fights.pace = async () => {
      if (this.screen !== "combat") return;
      this.animateFight();
      this.busy = "The others act…";
      this.emit();
      await sleep(DELAY());
    };
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
    this.emit();
  }

  /** Off the title screen's list for good (the folder goes to runs/deleted/). */
  deleteSave(r: Resumable): void {
    try { deleteSave(r.id); } catch (error) { this.error = `Couldn't delete that game: ${(error as Error).message}`; }
    this.loadSaves();
  }

  newCharacter(): void {
    this.screen = "create";
    this.emit();
  }

  async create(name: string, concept: string): Promise<void> {
    this.creating = { name, concept };
    this.screen = "creating";
    this.error = undefined;
    this.emit();
    try {
      const who = `${(name.trim() || DEFAULT_NAME).replace(/:/g, " ")}: ${concept.trim() || DEFAULT_CONCEPT}`;
      const core = await Core.create({ player: who, level: LEVEL, explorer: this.explorer, fights: this.fights });
      this.core = core;
      setCallLog(join(sessionDir(core.state.id), "calls.jsonl"));
      this.sheet = await sheetData(core.session);
      this.journal = [];
      this.messages = [`${TIME_WORDS[core.state.story.time]}. ${sceneById(core.session.sceneId).hook}`];
      this.screen = "created";
      this.saveExtras();
    } catch (error) {
      this.error = `Character creation failed: ${message(error)}`;
      this.screen = "create";
    }
    this.emit();
  }

  async resume(r: Resumable): Promise<void> {
    const core = Core.load(r.id, this.explorer, this.fights);
    if (repairCampaign(core.session)) core.save();
    this.core = core;
    setCallLog(join(sessionDir(r.id), "calls.jsonl"));
    const extras = loadExtras(r.id);
    this.messages = extras?.messages ?? [];
    this.journal = extras?.journal ?? [];
    this.overlay = undefined;
    this.targetIndex = 0; this.targetId = undefined;
    this.doMenu = undefined; this.aiming = undefined; this.townLook = undefined;
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
        break;
      case "end":
        this.toEnd();
        break;
      default:
        this.screen = "explore";
    }
    this.emit();
  }

  // -------------------------------------------------------------------------------------------
  // Explore

  begin(): void {
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
    const lead = leadTarget(core.state);
    if (!lead) { this.say(this.story.lead ? "The story will come to you from here." : "The story isn't heading anywhere just now."); this.emit(); return; }
    const no = this.startWalk();
    // A walk can go through a door to another map: then the way on is worked out again from there.
    for (let leg = 0; leg < 4 && no === this.walkNo && this.walking && core.state.mode === "explore"; leg++) {
      const target = leadTarget(core.state);
      const path = target ? pathTo(exploreState(core.state), target.at) : undefined;
      if (!target || !path?.length) { if (!path) this.say(`You can't see a way to ${lead.label} from here.`); break; }
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
    const tile = actionsAt(core.state, core.session, at);
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
    const mode = core.state.mode as Core["state"]["mode"];
    if (mode === "explore") this.animateTown(done.text);
    else if (mode === "combat") { this.targetIndex = 0; this.targetId = undefined; this.screen = "combat"; this.animateFight(); }
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
      action = actionsAt(core.state, core.session, at).actions.find(a => a.label === action.label && a.kind === action.kind) ?? action;
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
    // the lead's place does it at once; a menu act (a leap into the yard) only once the rules have rolled.
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
      // A talk's greeting that never came isn't saved (the game is still on the map): walking on goes back to it.
      if (opening) this.lines.push({ kind: "error", speaker: "system", text: core.session.talk ? `The GM couldn't open the talk: ${message(error)}. (Walk on to go back to the map.)` : `The GM couldn't open the scene: ${message(error)}. (/end <exit> skips ahead for testing.)` });
      else this.say(message(error));
    }
    this.busy = undefined;
    this.live = undefined;
    if (opening) { this.observeScene(); this.refreshChoices(); }
    if (!options.quiet) this.saveExtras();
    this.emit();
    return { text, said };
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
    return { kind, speaker: e.speaker, ...(e.kind === "dialogue" || e.kind === "player" ? { name: this.nameOf(e.speaker) } : {}), text: e.text, ...(e.scene ? { scene: e.scene } : {}) };
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
    this.status = undefined;
    this.busy = busy;
    this.over = undefined;
    this.choices = [];
  }

  private showSceneSoFar(): void {
    this.shown = this.session!.sceneId;
    this.lines = [this.header(), ...sceneEntries(this.session!).map(e => this.lineOf(e))];
    // A summons's opening may still be streaming in: it carries on, now on screen.
    if (this.live?.scene !== this.shown) this.live = undefined;
    this.over = undefined;
    this.refreshChoices();
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
      onText: text => {
        if (!this.live) return;
        this.live.text = text;
        if (this.live.scene === this.shown) this.emitSoon();
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
    };
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
   * A command that only opens something to look at (/sheet, /map, /journal, /help): it works any
   * time, with the GM mid-sentence or the scene over. True when the text was one.
   */
  peek(raw: string): boolean {
    const text = raw.trim();
    if (!/^[/#]/.test(text) || !this.core) return false;
    const name = commandNamed(text.slice(1).split(/\s+/)[0] ?? "");
    if (name === "sheet") void this.showSheet();
    else if (name === "map" || name === "journal" || name === "help") { this.overlay = name === "map" ? { kind: "scene-map" } : { kind: name }; this.emit(); }
    else return false;
    return true;
  }

  /** The player's turn in a scene: a /command (the old #command too), or what they say and do. */
  async input(raw: string): Promise<void> {
    const text = raw.trim();
    const core = this.core;
    if (!text || !core || this.peek(text) || this.busy || this.over) return;
    if (text.startsWith("/") || text.startsWith("#")) { await this.command(text.slice(1)); return; }
    this.busy = GM_BUSY[this.busyTurn++ % GM_BUSY.length]!;
    this.status = undefined;
    this.choices = [];
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
      // A turn that fails part-way leaves things half-changed: go back to the last save.
      this.core = Core.load(core.state.id, this.explorer, this.fights);
      // The scene's look saw the half-changed world: it starts again from the saved one, so going back isn't news.
      this.look = undefined;
      this.rolled = [];
      if (this.core.state.mode === "scene") {
        this.showSceneSoFar();
        this.lines.push({ kind: "error", speaker: "system", text: `The GM lost the thread (${message(error)}). Your last turn didn't happen; try it again.` });
      } else {
        // The last save is from before the scene (a talk whose greeting never came): back where it was.
        this.toMap(`The GM lost the thread (${message(error)}), and the talk with it.`);
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
      this.status = message(error);
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
      const line: Line = { kind: "error", speaker: "system", text: `The story couldn't move on cleanly: ${message(error)}` };
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
    // The story couldn't move on (the hand-off failed): Continue tries it again.
    if (core.state.mode === "scene" && core.session.sceneId === this.shown && core.session.ended) { void this.moveOn(() => core.carryOn(this.hooks())); return; }
    switch (core.state.mode) {
      case "end": this.toEnd(); break;
      case "combat": this.targetIndex = 0; this.targetId = undefined; this.screen = "combat"; break;
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
    } catch {
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
  // Combat

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
    this.emit();
    try {
      const said = await core.act(id, this.hooks());
      // A refusal comes back in brackets ("The talking Crake is out of reach").
      const refusal = /^\((.+)\)$/.exec(said.trim());
      if (refusal) this.status = refusal[1];
    } catch (error) {
      this.status = `That didn't work: ${message(error)}`;
    }
    this.animateFight();
    this.busy = undefined;
    this.emit();
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
    const session = core.session;
    // A fight that broke out on the map goes back to the map: how it went is the news.
    if (core.state.fightOnMap) {
      this.busy = "The dust settles…";
      this.emit();
      try {
        const text = await core.act("continue", this.hooks());
        this.say(text.replace(/^The fight: /, ""));
      } catch (error) {
        this.say(`The fight's end didn't settle cleanly: ${message(error)}`);
      }
      this.busy = undefined;
      this.screen = "explore";
      this.townLook = undefined;
      this.saveExtras();
      this.emit();
      return;
    }
    const said = { victory: "We won the fight.", surrender: "We won: they gave up.", defeat: "We lost the fight, and I woke up on the floor.", fled: "We got out of there." }[result.outcome];
    const fell = result.casualties.filter(c => c.state !== "standing" && c.id !== "kell").map(c => `${c.name} ${c.state === "down" ? "went down" : c.state}`);
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
      this.lines.push({ kind: "error", speaker: "system", text: `The GM couldn't tell the aftermath: ${message(error)}. (Say what you do next; /end <exit> skips ahead for testing.)` });
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
   * before an act, so only what the act does is news). Undefined in a scene.
   */
  townFx(fresh = false): { fx: Effects; director: Director; world: SceneWorld } | undefined {
    const core = this.core;
    if (!core || core.state.mode !== "explore") return this.townLook;
    const ex = exploreState(core.state);
    if (ex.scene) return undefined;
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
    fightEffects(fx, fight, G.log.slice(look.seen), performance.now(), look.dust, !!this.core?.state.fightOnMap);
    look.seen = G.log.length;
    look.dust = G.dust.map(tileOf);
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
    catch (error) { this.overlay = { kind: "sheet", error: `The sheet couldn't be read: ${message(error)}` }; }
    this.emit();
  }

  closeOverlay(): void {
    this.overlay = undefined;
    this.emit();
  }

  saveExtras(): void {
    if (!this.core) return;
    try { saveExtras({ sessionId: this.core.state.id, messages: this.messages.slice(-12), journal: this.journal }); } catch { /* best effort */ }
  }

  toTitle(): void {
    this.screen = "title";
    this.overlay = undefined;
    this.card = undefined;
    this.core = undefined;
    this.lines = [];
    this.walking = false;
    this.menu = undefined;
    this.doMenu = undefined;
    this.aiming = undefined;
    this.over = undefined;
    this.choices = [];
    this.typing = false;
    this.shown = undefined;
    // Another game's scene is news to nobody.
    this.look = undefined;
    this.fightLook = undefined;
    this.townLook = undefined;
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
    try { this.core.save(); } catch { /* the runtime saved the session after the last turn */ }
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
