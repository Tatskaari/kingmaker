// New (M6's screen, docs/combat-design.md §2): the fight's screen as a model over its rows, as the map's is (client/explore/model.ts): the playback of its moments (FightPlayer) on one clock with a redraw at each change; on the player's turn, their options as the action menu's lines (one a name, its targets aimed on the board with the reach and an area shown before it's done), walking by a click or the arrows, and what each costs; the camera; what's open over it; and each act made as its move (the map's own ids, or fight_turn's), refused in the game's words. It holds no React: the screen subscribes and redraws when it emits.
import { FEET, solid, steps } from "../../shared/fight/grid.ts";
import { isFightAct, type FightAct, type FightAction, type FightOptions } from "../../shared/fight/types.ts";
import { SCREEN_KEYS } from "../../shared/map/explore.ts";
import { moveOf, type MapMove } from "../../shared/map/moves.ts";
import type { Tile2, TileMap } from "../../shared/map/types.ts";
import type { Rejection } from "../backend.ts";
import { screenOf, type Viewport } from "../map/render.ts";
import { pacing } from "../pace.ts";
import type { SheetShown } from "../scene/model.ts";
import type { MenuGroup } from "../ui/actions.tsx";
import { FightPlayer, type PlayFrame } from "./player.ts";
import { myTurn, type FightView } from "./view.ts";

/** What the player's keys and clicks do: the moves they make, and leaving. */
export interface FightActions {
  /** One of the map's moves (walk@x,y, attack@x,y, cast_<spell>@x,y…: shared/map/moves.ts moveOf), a fight move on their turn. */
  move(m: MapMove): Promise<Rejection | undefined>;
  /** One of the fight's own acts (fight_turn): dash, dodge, disengage, end_turn, yield, leave, auto, hurry. */
  turn(act: FightAct): Promise<Rejection | undefined>;
  /** Back to the map, once it's over (walk out). */
  out(): Promise<Rejection | undefined>;
  /** Back to the title, the game kept. */
  quit(): void;
}

/** One of the action menu's lines: a name, what it costs and does, and the options it's made of (its targets, aimed on the board; or the one act, done at once). */
export interface MenuEntry {
  name: string;
  summary: string;
  /** Why it can't be done now (a spent action), when it can't. */
  why?: string;
  /** Aimed on the board first. */
  aims: boolean;
  options: FightAction[];
}

/** The action menu, open: its kinds and lines, the line picked out, where its list starts, where it was asked for and aimed. */
export interface FightMenu { groups: MenuGroup[]; entries: MenuEntry[]; index: number; top: number; x?: number; y?: number; at?: Tile2 }

/** Aiming a line of the menu: which of its targets is aimed at. */
export interface FightAim { entry: MenuEntry; index: number }

/** What's open over the fight: how to play it, its log in full, the menu (Esc), the character sheet. */
export type FightOverlay = { kind: "help" } | { kind: "log" } | { kind: "sheet" } | { kind: "menu"; index: number };

export interface FightModelOptions {
  /** The clock (ms): performance.now()'s, or a check's. */
  now?: () => number;
  /** Play the fight from its first moment (it began while the screen was up); else start where it is. */
  fromStart?: boolean;
  /** The seat's sheet, for c. */
  sheet?: () => SheetShown | undefined;
  /** Redraw on a timer at each change of what's shown (the screen in play); a check calls emit itself. */
  timers?: boolean;
}

export class FightModel {
  view: FightView;
  readonly player: FightPlayer;
  menu?: FightMenu;
  aim?: FightAim;
  /** The tile under the pointer, on the board. */
  hover?: Tile2;
  overlay?: FightOverlay;
  /** A word of the client's own, until the next act: a refusal, why a click did nothing. */
  status?: string;
  /** Reduced motion: each moment's end at once, with its caption (the host's setting, or the menu's). */
  reduced: boolean;
  /** A move sent and not yet answered. */
  sending = false;
  readonly now: () => number;
  readonly sheet: () => SheetShown | undefined;

  private readonly actions: FightActions;
  private readonly listeners = new Set<() => void>();
  private changes = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly timers: boolean;
  private camera?: { at: Tile2; want: Tile2; size: string; moved: number };

  constructor(view: FightView, actions: FightActions, options: FightModelOptions = {}) {
    this.view = view;
    this.actions = actions;
    this.now = options.now ?? (() => performance.now());
    this.sheet = options.sheet ?? (() => undefined);
    this.timers = options.timers ?? true;
    this.reduced = pacing().reducedMotion;
    this.player = new FightPlayer(view, this.now(), { fromStart: options.fromStart ?? false, reduced: () => this.reduced });
    this.schedule();
  }

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

  /** The rows moved on: their new moments played in turn, and anything open that no longer fits put away. */
  update(view: FightView): void {
    this.view = view;
    this.player.see(view, this.now());
    if (!this.canAct()) { this.menu = undefined; this.aim = undefined; }
    else if (this.aim) this.reaim();
    this.schedule();
    this.emit();
  }

  /** Stop the redraws (the screen's gone). */
  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** What's on screen now. */
  frame(): PlayFrame {
    return this.player.frame(this.now());
  }

  /** The player's own options, on their turn. */
  get options(): FightOptions | undefined {
    return this.view.options;
  }

  /**
   * Whether the player can act now: it's their turn by the rows, and the playback has reached it
   * (the other side's moves before it have played). Their own moments still playing don't hold them:
   * acting finishes them first.
   */
  canAct(): boolean {
    if (!myTurn(this.view) || this.player.skippingOn) return false;
    const f = this.player.frame(this.now());
    return f.turn === this.view.board.pc;
  }

  /** Whether the moments playing are the other side's (the keys finish and skip them). */
  othersPlaying(): boolean {
    return !this.player.caughtUp && !this.canAct();
  }

  // -------------------------------------------------------------------------------------------
  // The playback's keys.

  /** The moment playing ends now (a key). */
  finish(): void {
    this.player.finish(this.now());
    this.schedule();
    this.emit();
  }

  /** Everything still to play, played now; and the other side's turns before the player's, played at once (hurry). */
  skip(): void {
    this.player.skip(this.now());
    if (this.view.status === "on" && !myTurn(this.view) && !this.view.watching) void this.actions.turn("hurry");
    this.schedule();
    this.emit();
  }

  // -------------------------------------------------------------------------------------------
  // The action menu (m, Enter, a click on someone): the options by what they spend.

  /** Open the menu: every option, or (`at`) those aimed at that tile already. */
  openMenu(at?: Tile2, x?: number, y?: number): void {
    const o = this.options;
    if (!o || !this.canAct()) { this.say(this.notYet()); return; }
    const entries = menuEntries(o, at);
    if (!entries.some(e => !e.why)) { this.say(at ? "Nothing to do there from here." : "Nothing left to do this turn but end it."); return; }
    this.aim = undefined;
    const { groups, ordered } = menuGroups(entries, o);
    this.menu = { groups, entries: ordered, index: Math.max(0, ordered.findIndex(e => !e.why)), top: 0, ...(x !== undefined && y !== undefined ? { x, y } : {}), ...(at ? { at } : {}) };
    this.emit();
  }

  closeMenu(): void {
    if (!this.menu) return;
    this.menu = undefined;
    this.emit();
  }

  /** A line of the menu: aimed on the board, or done at once; one that can't be done now is only picked out. */
  chooseFromMenu(index: number): void {
    const menu = this.menu;
    const entry = menu?.entries[index];
    if (!menu || !entry) return;
    if (entry.why) { menu.index = index; this.emit(); return; }
    this.menu = undefined;
    if (entry.aims) this.startAim(entry, menu.at);
    else void this.act(entry.options[0]!.id);
  }

  /** Aim a line on the board: at what was clicked, if it can be aimed there, else its nearest target. */
  startAim(entry: MenuEntry, at?: Tile2): void {
    const pc = this.view.board.units[this.view.board.pc]!.at;
    const byDistance = [...entry.options.keys()].sort((a, b) => steps(pc, entry.options[a]!.at ?? pc) - steps(pc, entry.options[b]!.at ?? pc));
    const clicked = at ? entry.options.findIndex(o => o.at && o.at.x === at.x && o.at.y === at.y) : -1;
    this.aim = { entry, index: clicked >= 0 ? clicked : byDistance[0] ?? 0 };
    this.emit();
  }

  /** The option aimed at now. */
  aimed(): FightAction | undefined {
    return this.aim ? this.aim.entry.options[this.aim.index] : undefined;
  }

  /** The next (or the last) target, nearest first round the player (Tab, the arrows). */
  aimNext(back = false): void {
    const aim = this.aim;
    if (!aim) return;
    const n = aim.entry.options.length;
    aim.index = (aim.index + (back ? n - 1 : 1)) % n;
    this.emit();
  }

  /** Aim at whatever's at a tile (the pointer over the board), if it's one of the targets. */
  aimAt(at: Tile2): boolean {
    const aim = this.aim;
    if (!aim) return false;
    const i = aim.entry.options.findIndex(o => o.at && o.at.x === at.x && o.at.y === at.y);
    if (i < 0) return false;
    if (i !== aim.index) { aim.index = i; this.emit(); }
    return true;
  }

  /** Do what's aimed. */
  fire(): void {
    const o = this.aimed();
    if (!o) return;
    this.aim = undefined;
    void this.act(o.id);
  }

  cancelAim(): void {
    if (!this.aim) return;
    this.aim = undefined;
    this.emit();
  }

  // -------------------------------------------------------------------------------------------
  // Walking, and the turn.

  /** Walk to a tile (a click on the board): one they can reach this turn. */
  walkTo(at: Tile2): void {
    const o = this.options;
    if (!o || !this.canAct()) { this.say(this.notYet()); return; }
    if (!o.moves.some(m => m.x === at.x && m.y === at.y)) { this.say(o.movementLeft >= FEET ? `You can't get there this turn: ${o.movementLeft} ft of movement left (the blue tiles).` : "No movement left this turn."); return; }
    void this.act(`walk@${at.x},${at.y}`);
  }

  /** A step by an arrow key: up goes up the screen, as on the map. */
  step(key: string): void {
    const d = SCREEN_KEYS[key];
    const me = this.view.board.units[this.view.board.pc];
    if (!d || !me) return;
    this.walkTo({ x: me.at.x + d[0], y: me.at.y + d[1] });
  }

  endTurn(): void {
    if (!this.canAct()) { this.say(this.notYet()); return; }
    void this.act("end_turn");
  }

  /** Back to the map, once it's over and played. */
  async out(): Promise<void> {
    if (this.view.status === "on" || this.view.watching) return;
    const refused = await this.actions.out();
    if (refused) this.say(refused.text);
  }

  quit(): void {
    this.close();
    this.actions.quit();
  }

  closeOverlay(): void {
    this.overlay = undefined;
    this.emit();
  }

  /**
   * One of the player's options, made as its move: the map's own (walk@, attack@, cast_…, shove@,
   * grapple@) or the fight's (dash, end_turn…). Their own moments still playing finish first, so what
   * it's done on is what's shown; a refusal is said on the status line, in the game's words.
   */
  async act(id: string): Promise<void> {
    if (this.sending) return;
    this.player.skip(this.now());
    const m = isFightAct(id) ? undefined : moveOf(id);
    if (!isFightAct(id) && !m) { this.say(`(There's no ${id} in the fight.)`); return; }
    this.status = undefined;
    this.sending = true;
    this.emit();
    let refused: Rejection | undefined;
    try {
      refused = m ? await this.actions.move(m) : await this.actions.turn(id as FightAct);
    } finally {
      this.sending = false;
    }
    if (refused) this.status = refused.text;
    this.emit();
  }

  /** A word on the status line, until the next act. */
  say(text: string): void {
    this.status = text;
    this.emit();
  }

  /** Why the player can't act yet. */
  notYet(): string {
    if (this.view.watching) return `It's ${this.view.watching}'s fight: you're watching.`;
    if (this.view.status !== "on") return "The fight's over.";
    return "Not yet: it isn't your turn (space finishes this move, s skips to your turn).";
  }

  // -------------------------------------------------------------------------------------------
  // The camera.

  /**
   * Where the board's camera looks at `t`, for a viewport: the whole ring when it fits; else between
   * whoever the play is about (the one acting, the target aimed at) and the player, so both are in
   * sight, moved only once that nears the edge, and eased there a tile at a time (the camera eases to
   * them, docs/combat-design.md §3), so the board doesn't jump under every step.
   */
  cameraFor(size: Viewport, focus: Tile2, t: number): Tile2 {
    const map = this.view.map;
    if (fits(map, size)) return { x: Math.floor((map.width - 1) / 2), y: Math.floor((map.height - 1) / 2) };
    const me = this.view.board.units[this.view.board.pc]?.at ?? focus;
    const between = { x: Math.round((focus.x + me.x) / 2), y: Math.round((focus.y + me.y) / 2) };
    const key = `${size.w}x${size.h}`;
    const was = this.camera;
    if (!was || was.size !== key) { this.camera = { at: { ...between }, want: { ...between }, size: key, moved: t }; return between; }
    const s = screenOf(focus, was.at, size), p = screenOf(me, was.at, size);
    const inside = (q: { x: number; y: number }) => q.x >= size.w * 0.18 && q.x <= size.w * 0.82 && q.y >= size.h * 0.2 && q.y <= size.h * 0.85;
    if (!inside(s) || !inside(p)) was.want = { ...between };
    // A tile a step towards where it wants to be, at most every 40 ms.
    if ((was.at.x !== was.want.x || was.at.y !== was.want.y) && t - was.moved >= 40) {
      was.at = { x: was.at.x + Math.sign(was.want.x - was.at.x), y: was.at.y + Math.sign(was.want.y - was.at.y) };
      was.moved = t;
    }
    return was.at;
  }

  /** The tiles a reach covers round the player: its edge, a ring (on the map, not in a wall). */
  ringOf(range: number): Tile2[] {
    const me = this.view.board.units[this.view.board.pc];
    if (!me || range <= 0) return [];
    const r = Math.max(1, Math.floor(range / FEET));
    const out: Tile2[] = [];
    for (let y = me.at.y - r; y <= me.at.y + r; y++) for (let x = me.at.x - r; x <= me.at.x + r; x++) {
      if (steps(me.at, { x, y }) !== r || x < 0 || y < 0 || x >= this.view.map.width || y >= this.view.map.height || solid(this.view.map, { x, y })) continue;
      out.push({ x, y });
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------

  /** The rows moved on while aiming: the line aimed is looked for again in the new options (gone, the aim goes). */
  private reaim(): void {
    const aim = this.aim, o = this.options;
    if (!aim || !o) { this.aim = undefined; return; }
    const entry = menuEntries(o).find(e => e.name === aim.entry.name && e.aims);
    if (!entry) { this.aim = undefined; return; }
    const was = aim.entry.options[aim.index]?.id;
    this.aim = { entry, index: Math.max(0, entry.options.findIndex(x => x.id === was)) };
  }

  /** A redraw when what's shown next changes (a moment's start, a blow landing, an end), while anything's left to play. */
  private schedule(): void {
    if (!this.timers) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const now = this.now();
    const next = this.player.nextChange(now);
    if (next === undefined) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.schedule(); this.emit(); }, Math.max(15, next - now + 5));
  }
}

/** The whole map fits a viewport, drawn isometrically (its walls standing up to three rows over it). */
function fits(map: TileMap, size: Viewport): boolean {
  return 2 * (map.width + map.height - 2) + 4 <= size.w && map.width + map.height + 3 <= size.h;
}

// ---------------------------------------------------------------------------------------------
// The menu's lines, from the options.

/** What a cost is called on the menu's kinds. */
const KINDS: Array<{ cost: NonNullable<FightAction["cost"]>; title: string }> = [
  { cost: "action", title: "Action" }, { cost: "bonus", title: "Bonus action" }, { cost: "move", title: "Movement" }, { cost: "free", title: "Your turn" },
];

/**
 * The menu's lines from the player's options (docs/combat-design.md §2): one a name, its targets
 * aimed on the board (an attack, a spell, a shove, a grab, a lantern brought down), or one act done
 * at once (a named move, dash, dodge, disengage, leaving, letting the dice decide, yielding, ending
 * the turn). `at`: only what can be done to that tile (a click on someone). A spent action shows as
 * a line of its own, dimmed, saying so.
 */
export function menuEntries(o: FightOptions, at?: Tile2): MenuEntry[] {
  const out: MenuEntry[] = [];
  const there = (a: FightAction) => !at || (!!a.at && a.at.x === at.x && a.at.y === at.y && a.kind !== "move");
  for (const a of o.actions.filter(there)) {
    const name = a.name ?? a.label.split(" (")[0] ?? a.id;
    const aims = (a.kind === "attack" || a.kind === "cast") && !a.id.endsWith("_self");
    const same = out.find(e => e.name === name && e.aims === aims && aims);
    if (same) { same.options.push(a); continue; }
    out.push({ name, summary: "", aims, options: [a] });
  }
  for (const e of out) e.summary = summaryOf(e);
  if (o.actionUsed && !at) out.push({ name: "Your action", summary: "", why: "spent this turn", aims: false, options: [] });
  return out;
}

/** A line's words beside its name: a single target's terms ("a grey wolf: Longsword +5; 5 ft"), how many are in reach, what an act does or a move takes. */
function summaryOf(e: MenuEntry): string {
  const first = e.options[0]!;
  const said = [...first.label.matchAll(/\(([^()]*)\)/g)].map(m => m[1]).join("; ");
  if (e.aims && e.options.length > 1) return `${e.options.length} in reach: Tab between them as you aim`;
  if (e.aims) { const who = first.label.replace(/^(Attack|Cast .+? (?:at|on)|Shove|Grab hold of|Kick over|Bring down)\s+/, "").split(" (")[0] ?? ""; return said ? `${who}: ${said}` : who; }
  return said || (first.feet ? `${first.feet} ft` : "");
}

/** The menu's kinds: by what each line spends (the action, the bonus action, movement, nothing), each with how much of it is left; and the lines in that order. */
export function menuGroups(entries: MenuEntry[], o: FightOptions): { groups: MenuGroup[]; ordered: MenuEntry[] } {
  const groups: MenuGroup[] = [];
  const ordered: MenuEntry[] = [];
  for (const k of KINDS) {
    const lines = entries.filter(e => (e.options[0]?.cost ?? (e.why ? "action" : "free")) === k.cost);
    if (!lines.length) continue;
    const note = k.cost === "action" ? (o.actionUsed ? "spent" : "ready") : k.cost === "bonus" ? (o.bonusActionUsed ? "spent" : "ready") : k.cost === "move" ? `${o.movementLeft} ft left` : undefined;
    groups.push({ title: k.title, ...(note ? { note } : {}), lines: lines.map(e => ({ name: e.name, summary: e.summary, ...(e.why ? { why: e.why } : {}), ...(e.aims ? { aims: true } : {}) })) });
    ordered.push(...lines);
  }
  return { groups, ordered };
}
