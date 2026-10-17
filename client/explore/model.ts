// The prototype's src/app/game.ts at 44c6d4a, its explore section as a model over rows: :172-179 (TileMenu), :299 (STEP_MS), :354-357 and :389 (walking, the menu, walkNo), :451-464 (subscribe, emit), :904-923 (leadTarget, actionsAt, interactLabel), :956-1046 (say, walk, interact, toLead, walkTo, openMenu, closeMenu, chooseFromMenu), :1176-1280 (doAt, startWalk, endWalk, stepAlong, explore), :2440-2452 (sleep, within). Each act is a move (map-design §3.2: moveOf its id), and what it said is the explore row's (`said`, when `acts` moves on), shown by the prototype's quiet rules; the zoo, the battlefield and the report are cut. The town unit's (town-design §2, §3.9): :197-224 (DoMenu, entriesOf, Aiming), :1026 and :1043 (Do something…), :1047-1170 (the action menu, aiming and act) and :2199-2230 (townFx, animateTown), the menu from the rows (explore/town.ts), each act a move, a fight on the map its stand-in's card, and a spectator's map playing the host's acts too. STEP_MS is the client's pace (client/pace.ts) where it was KM_APP_STEP_MS.
import { SCREEN_KEYS, steer, tileName, walkPlan, pathTo, type ExploreState } from "../../shared/map/explore.ts";
import { getMap } from "../../shared/map/maps.ts";
import { LEAD, moveOf, type MapMove } from "../../shared/map/moves.ts";
import { isDoorway, steps } from "../../shared/map/tiles.ts";
import { actionsAt, interactLabel, leadTarget, walkId, type Action, type LeadTarget, type TileActions } from "../../shared/map/town.ts";
import type { Tile2 } from "../../shared/map/types.ts";
import type { Rejection } from "../backend.ts";
import { pacing } from "../pace.ts";
import type { SheetShown } from "../scene/model.ts";
import type { ExploreView } from "./rows.ts";
import { TIME_WORDS } from "./words.ts";
import type { AimAt, AimView, MenuCtx, MenuItem, MenuView } from "../../shared/map/menu.ts";
import type { SceneWorld } from "../../shared/world/scene-world.ts";
import { Director } from "../look/director.ts";
import { Effects } from "../look/effects.ts";
import { isRoll } from "../scene/view.ts";
import { menuCtx, SHARED_TOWN, type TownMenu } from "./town.ts";

/**
 * The map between scenes (the prototype's Game, its explore section, fed by rows): the walker's
 * ExploreState as the rows make it, what's happened ("What happens"), the walk under way, the
 * right-click menu and what's open over the map. It holds no React: the screen subscribes and
 * redraws when it emits. A walk is a step at a time, one move each, the pace's stepMs apart, so any
 * key stops it, as the prototype's stepAlong does; the rows bring each step back.
 */

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

/** The town's look between scenes: the effects of what's done on the map, in the town's world, for the map they're on. */
export interface TownLook { map: string; fx: Effects; director: Director; world: SceneWorld }

/** What's open over the map: how to play, What happens in full, the menu (Esc), the character sheet. */
export type ExploreOverlay = { kind: "help" } | { kind: "log" } | { kind: "sheet" } | { kind: "menu"; index: number };

/** What the player's keys and clicks do: the moves they make, and leaving. */
export interface ExploreActions {
  /** A map move (walk, interact or travel), as the action id it's made from says (shared/map/moves.ts moveOf). */
  move(m: MapMove): Promise<Rejection | undefined>;
  /** Back to the title, the game kept. */
  quit(): void;
  /** The fight on the map's stand-in (town-design §3.3): fought out, as won (fight_it_out). Why not, when it wasn't. */
  fightItOut?(): Promise<Rejection | undefined>;
}

/** How long a walk waits between steps, so the player sees the way (the prototype's KM_APP_STEP_MS: the host's setting now). */
export const STEP_MS = () => pacing().stepMs;

/** A move's words, when the move was a quiet step of a walk, are shown only when they say something worth stopping for: a place come into, someone talking. */
const SAID_WALKING = /^You come into|:/;

export class ExploreModel {
  view: ExploreView;
  /** What happens: the newest last (the prototype's messages). */
  messages: string[] = [];
  /** Walking a step at a time (to the lead, or where the player clicked): any key or click stops it. */
  walking = false;
  /** The map's right-click menu, while it's open. */
  menu?: TileMenu;
  overlay?: ExploreOverlay;
  /** The action menu, while it's open (m on the map). */
  doMenu?: DoMenu;
  /** Aiming something from the action menu on the map. */
  aiming?: Aiming;
  /** The town's look between scenes: what the player does on the map plays in the town's world (see townFx). */
  townLook?: TownLook;
  /** The seat's sheet, for c. */
  readonly sheet: () => SheetShown | undefined;

  private readonly actions: ExploreActions;
  /** The view as the rows have it now: a move's words are read from it once the move is made. */
  private readonly read: () => ExploreView | undefined;
  /** Each walk's number: a new walk takes over from the one before. */
  private walkNo = 0;
  /** Moves made and not yet answered: their words are shown as each comes back. */
  private inFlight = 0;
  /** The explore row's acts whose words have been shown, or passed over. */
  private seen: number;
  private readonly listeners = new Set<() => void>();
  private changes = 0;

  /** The action menu's checks (explore/town.ts): the shared menu, or a test's fixture. */
  private readonly town: TownMenu;

  constructor(view: ExploreView, actions: ExploreActions, read: () => ExploreView | undefined = () => undefined, sheet: () => SheetShown | undefined = () => undefined, town: TownMenu = SHARED_TOWN) {
    this.view = view;
    this.actions = actions;
    this.town = town;
    this.read = read;
    this.sheet = sheet;
    this.seen = view.acts;
    // What happened lately is the row's (the last five things said); a game just begun says where the story is, as the prototype's first message does.
    this.messages = view.log.length ? [...view.log] : view.lead ? [`${TIME_WORDS[view.ex.story.time]}. ${view.lead.hook}`] : [];
  }

  get ex(): ExploreState { return this.view.ex; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** How many changes the screen has been told of: it draws by it (useStore), and looks again once subscribed. */
  get version(): number { return this.changes; }

  emit(): void {
    this.changes++;
    for (const l of this.listeners) l();
  }

  /**
   * A new view from the rows. A move made elsewhere (the host's, watched from another seat) says its
   * words here when it said something; this client's own moves' words are shown as each comes back
   * (explore), by the prototype's quiet rules. The town's news with no move made (tick_place's: the
   * fire caught, spread or burned down, town-design §3.5) is said as it comes into the log.
   */
  update(view: ExploreView): void {
    const was = this.view;
    this.view = view;
    if (!this.inFlight && view.acts !== this.seen) {
      if (view.acts > this.seen && view.said) { this.say(view.said); this.playTown(was.ex, view.said); }
      this.seen = view.acts;
    } else if (view.acts === was.acts && view.log.length && view.log.at(-1) !== was.log.at(-1)) this.say(view.log.at(-1)!);
    this.reaim();
    this.emit();
  }

  /** Where g walks: the story's lead. */
  leadTarget(): LeadTarget | undefined {
    return leadTarget(this.ex);
  }

  /** What a tile offers (the right-click menu, the pointer's hint). */
  actionsAt(at: Tile2): TileActions {
    return actionsAt(this.ex, this.view.unheard, at);
  }

  /** What e would do now, in words. */
  interactLabel(): { label: string; scene: boolean } | undefined {
    return interactLabel(this.ex);
  }

  say(text: string): void {
    if (text) this.messages = [...this.messages, text].slice(-20);
  }

  /** A word of the client's own (a spectator's key, the client's trouble): said once, however often it comes. */
  note(text: string): void {
    if (this.messages[this.messages.length - 1] !== text) this.say(text);
    this.emit();
  }

  /**
   * A step by an arrow key: up goes up the screen (SCREEN_KEYS), steered along the streets. A key
   * held down repeats faster than a move comes back: the steps it asks for meanwhile are let go.
   */
  walk(key: string): void {
    this.walking = false;
    const d = SCREEN_KEYS[key];
    if (!d || this.inFlight || this.idle()) return;
    // Steered: a key that would catch on a corner follows the street instead.
    const [dx, dy] = steer(this.ex, d[0], d[1]);
    void this.explore(walkId(dx, dy));
  }

  interact(): void {
    this.walking = false;
    if (this.inFlight || this.idle()) return;
    void this.explore("interact");
  }

  /** Walk to where the story is heading, a step at a time so you see the way (any key stops it). With nowhere to walk to, the move says so. */
  async toLead(): Promise<void> {
    if (this.idle() || this.walking) return;
    const lead = this.leadTarget();
    if (!lead) { await this.explore("go_to_lead"); return; }
    const no = this.startWalk();
    // A walk can go through a door to another map: then the way on is worked out again from there.
    for (let leg = 0; leg < 4 && no === this.walkNo && this.walking && !this.away(); leg++) {
      const target = this.leadTarget();
      const path = target ? pathTo(this.ex, target.at) : undefined;
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
    if (this.idle()) return;
    this.menu = undefined;
    const ex = this.ex;
    const plan = walkPlan(ex, at);
    if (!plan) { this.walkNo++; this.walking = false; this.say(`You can't see a way any nearer ${tileName(ex, at)} from here.`); this.emit(); return; }
    const map = ex.map;
    const no = this.startWalk();
    const done = await this.stepAlong(plan.path, no, { loud: true });
    if (no !== this.walkNo) return;
    const now = this.ex;
    if (done && !plan.reaches && now.map === map && steps(now.at, at) === 1 && !this.away() && isDoorway(getMap(map), at)) await this.explore(walkId(at.x - now.at.x, at.y - now.at.y));
    this.endWalk(no);
  }

  /** Right-click on the map, or on someone in the sidebar: what's at a tile and what you can do with it. */
  openMenu(at: Tile2, x: number, y: number): void {
    if (this.idle()) return;
    this.walking = false;
    this.doMenu = undefined;
    this.aiming = undefined;
    const tile = this.actionsAt(at);
    // Anything the action menu can do to what's there (a spell at them, a shove), aimed at it already.
    const more: Action[] = this.view.catalogue ? [{ id: `do@${at.x},${at.y}`, label: "Do something…", kind: "use" }] : [];
    this.menu = { ...tile, actions: [...tile.actions, ...more], x, y, index: 0 };
    this.emit();
  }

  closeMenu(): void {
    if (!this.menu) return;
    this.menu = undefined;
    this.emit();
  }

  /** Take one of the menu's choices. */
  async chooseFromMenu(index: number): Promise<void> {
    const menu = this.menu;
    this.menu = undefined;
    const choice = menu?.actions[index];
    if (!menu || !choice) { this.emit(); return; }
    if (choice.id.startsWith("do@")) { this.openActions(menu.at, menu.x, menu.y); return; }
    await this.doAt(menu.at, choice);
  }

  /**
   * Something to do with a tile (its menu's choices): looking is done from where you stand, walking
   * is a walk, and the rest walk over first, a step at a time, then do it.
   */
  async doAt(at: Tile2, action: Action): Promise<void> {
    if (this.idle()) return;
    if (/^(walk|door)@/.test(action.id)) { await this.walkTo(at); return; }
    if (!/^look/.test(action.id)) {
      const plan = walkPlan(this.ex, at);
      const path = plan ? within(plan.path, this.ex.at, at) : [];
      if (path.length) {
        const no = this.startWalk();
        const done = await this.stepAlong(path, no);
        if (no !== this.walkNo) return;
        this.walking = false;
        if (!done || this.away()) { this.emit(); return; }
      }
      // Things in sight go by ids that follow who's nearest (the nearer guard is talk_palace_guard): ask again from here.
      action = this.actionsAt(at).actions.find(a => a.label === action.label && a.kind === action.kind) ?? action;
    }
    this.walking = false;
    await this.explore(action.id);
  }

  /** Stop a walk under way (any key, or a click that does nothing else). */
  stop(): void {
    if (!this.walking) return;
    this.walking = false;
    this.emit();
  }

  /** Back to the title, the game kept. */
  quit(): void {
    this.walking = false;
    this.actions.quit();
  }

  closeOverlay(): void {
    this.overlay = undefined;
    this.emit();
  }

  // -------------------------------------------------------------------------------------------
  // The action menu (m): spells, class features, a leap, hiding, a rest; aimed on the map (the
  // prototype's game.ts:1047-1170, each act a move; the menu from the rows: explore/town.ts).

  /** What the menu reads (town-design §3.3): the state, the walker's catalogue, the explore row's keep. */
  menuCtx(): MenuCtx {
    return menuCtx(this.view);
  }

  /** Open the action menu: what the player can do here, by kind; `at`: aimed at that tile already (a right-click's "Do something…"). */
  openActions(at?: Tile2, x?: number, y?: number): void {
    if (this.idle() || this.inFlight) return;
    this.walking = false;
    this.menu = undefined;
    this.aiming = undefined;
    const view = this.ask(town => town.menu(this.menuCtx(), at));
    if (!view) { if (view === undefined) this.say("There's no rules character here to do anything with."); this.emit(); return; }
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
    const c = this.menuCtx();
    const view = this.ask(town => town.aim(c, item.key));
    if (!view) { this.emit(); return; }
    const start = at ?? view.start ?? { ...this.ex.at };
    this.aiming = { item, view, at: { ...start }, index: Math.max(0, view.targets.findIndex(t => t.at.x === start.x && t.at.y === start.y)) };
    const check = this.ask(town => town.check(c, item.key, start));
    if (check) this.aiming.check = check;
    this.emit();
  }

  /** Aim at a tile (the pointer over the map, or the cursor keys). */
  aimTo(at: Tile2): void {
    const aiming = this.aiming;
    if (!aiming || (aiming.at.x === at.x && aiming.at.y === at.y)) return;
    aiming.at = { ...at };
    const check = this.ask(town => town.check(this.menuCtx(), aiming.item.key, at));
    if (check) aiming.check = check;
    else delete aiming.check;
    delete aiming.confirm;
    this.emit();
  }

  /** The next (or the last) of what's in reach (Tab, Shift+Tab); yourself among them, when it can be. */
  aimNext(back = false): void {
    const aiming = this.aiming;
    if (!aiming) return;
    const tiles = [...aiming.view.targets.map(t => t.at), ...(aiming.view.self ? [{ ...this.ex.at }] : [])];
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
    if (!this.aiming?.view.self) return;
    this.aimTo(this.ex.at);
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
   * One of the menu's acts, made as its move (the action id the QA console would use: moveOf): what
   * it did shows on the map as it lands (the look layer's effects: the bolt, the splinters, the
   * numbers) and in What happens; a refusal says why there, in the game's words. It may open
   * someone's scene, or a talk; a fight it starts is the explore row's (its card comes up).
   */
  async act(id: string): Promise<void> {
    if (this.idle()) return;
    // The town as it is now: what the act changes is what's shown.
    this.townFx(true);
    const done = await this.explore(id);
    if (!done.refused && !this.away()) this.animateTown(done.text);
    this.emit();
  }

  /** A fight that broke out on the map, recorded for V12 (the explore row's): its stand-in's card is up until it's fought out. */
  get fight(): ExploreView["fight"] {
    return this.view.fight;
  }

  /** Fight it out (fight_it_out: the stand-in tells it as won); what it said comes back as the explore row's words. Why not, in What happens. */
  async fightItOut(): Promise<void> {
    if (!this.view.fight || this.idle()) return;
    const refused = await (this.actions.fightItOut?.() ?? Promise.resolve({ code: "error" as const, text: "(There's no fighting it out from here.)" }));
    if (refused) this.say(refused.text);
    this.emit();
  }

  /**
   * The town's look between scenes: one Effects and one Director for the map the player is on, and
   * the town's world they play in (shared/map/town-world.ts). `fresh`: take the world as it is now
   * (just before an act, so only what the act does is news). None in a scene, or with no town's world
   * to play in.
   */
  townFx(fresh = false): TownLook | undefined {
    const ex = this.ex;
    if (ex.scene) return undefined;
    if (!this.townLook || this.townLook.map !== ex.map) {
      const world = this.ask(town => town.world(ex), false);
      if (!world) return undefined;
      const fx = new Effects();
      const director = new Director(fx);
      director.prime(world);
      this.townLook = { map: ex.map, fx, director, world };
    } else if (fresh) {
      const world = this.ask(town => town.world(ex), false);
      if (world) { this.townLook.world = world; this.townLook.director.prime(world); }
    }
    return this.townLook;
  }

  /** What's playing on the map the player is on now, if anything has been done there (the painter's: it never builds the town's world). */
  townEffects(): TownLook | undefined {
    const look = this.townLook;
    return look && look.map === this.ex.map && !this.ex.scene ? look : undefined;
  }

  /** What an act on the map did, in the town's world: the spell from the player to its aim, the numbers, what broke or caught fire, who ran. */
  private animateTown(text: string): void {
    const look = this.townLook;
    const ex = this.ex;
    if (!look || look.map !== ex.map || !text) return;
    const world = this.ask(town => town.world(ex), false);
    if (!world) return;
    const lines = text.split("\n").filter(Boolean);
    const now = performance.now();
    look.director.spellsFrom(world, lines, now);
    look.director.rulesLines(world, lines, now);
    look.director.observe(world, now);
    look.world = world;
  }

  /** Someone else's act on the map (the host's, watched from another seat): the town as it was before it, then what it did, played as the host's own is. */
  private playTown(before: ExploreState, text: string): void {
    if (before.map !== this.ex.map || this.ex.scene || !text.split("\n").some(isRoll)) return;
    const world = this.ask(town => town.world(before), false);
    if (!world) return;
    if (!this.townLook || this.townLook.map !== before.map) {
      const fx = new Effects();
      this.townLook = { map: before.map, fx, director: new Director(fx), world };
    }
    this.townLook.world = world;
    this.townLook.director.prime(world);
    this.animateTown(text);
  }

  /** The rows moved on while aiming (the town's clock, someone's move): what's in reach, and what the aim would do, asked again. */
  private reaim(): void {
    const aiming = this.aiming;
    if (!aiming || this.away()) { this.aiming = undefined; return; }
    const c = this.menuCtx();
    const view = this.ask(town => town.aim(c, aiming.item.key), false);
    if (view) aiming.view = view;
    const check = this.ask(town => town.check(c, aiming.item.key, aiming.at), false);
    if (check) aiming.check = check;
  }

  /**
   * Ask the action menu something: what it answers, or null when it went wrong (said in What happens,
   * when `loud`, so the player sees why m did nothing). The town's effects ask quietly: they're only looks.
   */
  private ask<T>(question: (town: TownMenu) => T, loud = true): T | null {
    try {
      return question(this.town);
    } catch (error) {
      if (loud) this.say(`(The action menu went wrong: ${error instanceof Error ? error.message : String(error)}.)`);
      return null;
    }
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
    this.emit();
  }

  /**
   * Take a walk's steps one at a time, so the player sees the way, until something's in the way, a
   * door takes them to another map, a scene opens, or the walk is stopped (a key, a click, another
   * walk). `loud`: say what stopped it. True if every step was taken.
   */
  private async stepAlong(path: Array<[number, number]>, no: number, options: { loud?: boolean } = {}): Promise<boolean> {
    const map = this.ex.map;
    for (const [dx, dy] of path) {
      if (no !== this.walkNo || !this.walking || this.away()) return false;
      const before = { ...this.ex.at };
      const step = await this.explore(walkId(dx, dy), { quiet: true });
      const after = this.ex;
      if (after.map !== map) return false;
      if (after.at.x === before.x && after.at.y === before.y) {
        if (options.loud && step.text && !step.said && !this.away()) { this.say(step.text); this.emit(); }
        return false;
      }
      await sleep(STEP_MS());
    }
    return true;
  }

  /**
   * An explore action, made as its move (moveOf), and what it said: the explore row's words once the
   * move is made (a refusal's, when it wasn't), shown unless it's a quiet step of a walk with nothing
   * worth stopping for, or the move opened a scene (the scene screen comes up with it).
   */
  private async explore(id: string, options: { quiet?: boolean } = {}): Promise<{ text: string; said: boolean; refused?: boolean }> {
    const m = id === "go_to_lead" ? { move: "walk" as const, args: { toward: LEAD } } : moveOf(id);
    if (!m) return { text: "", said: false };
    const before = this.view.acts;
    this.inFlight++;
    let refused: Rejection | undefined;
    try {
      refused = await this.actions.move(m);
    } finally {
      this.inFlight--;
    }
    const now = this.read() ?? this.view;
    this.view = now;
    this.seen = now.acts;
    const text = refused ? refused.text : now.acts !== before ? now.said : "";
    const opening = this.away();
    const said = !opening && !!text && (!options.quiet || !!refused || SAID_WALKING.test(text));
    if (said) this.say(text);
    if (opening) { this.walking = false; this.menu = undefined; this.doMenu = undefined; this.aiming = undefined; }
    this.emit();
    return { text, said, ...(refused ? { refused: true } : {}) };
  }

  /** Nothing to do from here: a spectator's map is the host's to walk, and a scene opening has taken over. */
  private idle(): boolean {
    if (this.view.watching) { this.note(`${this.view.watching} has the lead: you're watching.`); return true; }
    return this.away();
  }

  /** A scene has opened from here: the map waits until it's over. */
  private away(): boolean {
    return !!this.ex.scene;
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
