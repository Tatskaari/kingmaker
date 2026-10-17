// The prototype's src/app/game.ts at 44c6d4a, its explore section as a model over rows: :172-179 (TileMenu), :299 (STEP_MS), :354-357 and :389 (walking, the menu, walkNo), :451-464 (subscribe, emit), :904-923 (leadTarget, actionsAt, interactLabel), :956-1046 (say, walk, interact, toLead, walkTo, openMenu, closeMenu, chooseFromMenu), :1176-1280 (doAt, startWalk, endWalk, stepAlong, explore), :2440-2452 (sleep, within). Each act is a move (map-design §3.2: moveOf its id), and what it said is the explore row's (`said`, when `acts` moves on), shown by the prototype's quiet rules; the zoo, the action menu, aiming, fights, the town's effects and the report are cut. STEP_MS is the client's pace (client/pace.ts) where it was KM_APP_STEP_MS.
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

/** What's open over the map: how to play, What happens in full, the menu (Esc), the character sheet. */
export type ExploreOverlay = { kind: "help" } | { kind: "log" } | { kind: "sheet" } | { kind: "menu"; index: number };

/** What the player's keys and clicks do: the moves they make, and leaving. */
export interface ExploreActions {
  /** A map move (walk, interact or travel), as the action id it's made from says (shared/map/moves.ts moveOf). */
  move(m: MapMove): Promise<Rejection | undefined>;
  /** Back to the title, the game kept. */
  quit(): void;
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

  constructor(view: ExploreView, actions: ExploreActions, read: () => ExploreView | undefined = () => undefined, sheet: () => SheetShown | undefined = () => undefined) {
    this.view = view;
    this.actions = actions;
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
   * (explore), by the prototype's quiet rules.
   */
  update(view: ExploreView): void {
    this.view = view;
    if (!this.inFlight && view.acts !== this.seen) {
      if (view.acts > this.seen && view.said) this.say(view.said);
      this.seen = view.acts;
    }
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
    this.menu = { ...this.actionsAt(at), x, y, index: 0 };
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
  private async explore(id: string, options: { quiet?: boolean } = {}): Promise<{ text: string; said: boolean }> {
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
    if (opening) { this.walking = false; this.menu = undefined; }
    this.emit();
    return { text, said };
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
