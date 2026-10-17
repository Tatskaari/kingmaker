// The prototype's src/app/game.ts at 44c6d4a, its scene section as a model fed by rows: :451-464 (subscribe, emit, emitSoon), :1386-1393 (onStep's CONSIDERING, as the turn's considering phase), :1510-1551 (input), :1596-1622 (command), :1454-1462 and :1490-1505 (setSuggestions and peek's /suggestions, the setting a move), :1897-1935 (speechColor and the marks), :2332-2344 (showSheet, as the sheet row read; closeOverlay); and the scene's place (the world bridge): :186-195 (SceneMenu), :1817-1868 (sceneContext, the menu opened and closed), :1937-1962 (lookNote, deed), the world the place's rows' (scene/place.ts).
import type { Backend, Rejection } from "../backend.ts";
import type { SheetData } from "../../shared/rules/types.ts";
import { BusyLines, CONSIDERING } from "../busy.ts";
import { COMMANDS, commandNamed } from "../commands.ts";
import { C } from "../theme.ts";
import { thingActions, type SceneContext, type SceneTarget, type ThingActions } from "./menu.ts";
import { PlaceModel } from "./place.ts";
import { isPlayer, linesOf, liveOf, type Line, type SceneView } from "./view.ts";

/**
 * The scene screen's model: the view the connection keeps up to date from rows, and what's the
 * screen's own (the mark Tab picked out, the popover, the spinner's line, a word of the client's).
 * It holds no React: the screen subscribes and redraws when it emits (the prototype's Game
 * controller, cut to a scene and fed by rows instead of the live core).
 */

/** What the player's input does: the moves it calls, and leaving. */
export interface SceneActions {
  /** The `say` move. A refusal comes back as the view's `refusal`, from the connection. */
  say(text: string): void;
  /** The `retryTurn` move, for a turn that failed. */
  retry(): void;
  /** The `setSuggestions` move: this player's own setting. Answers why not, when it wasn't made (the view's refusal says so too). */
  setSuggestions(on: boolean): Promise<Rejection | undefined>;
  quit(): void;
}

/** What /suggestions says it did (the prototype's words, less the Esc menu, which this client hasn't got). */
export const SUGGESTIONS_ON = "Suggested lines on: a few things to say or do come up over the box after each reply.";
export const SUGGESTIONS_OFF = "Suggested lines off. (/suggestions brings them back.)";

export type Overlay =
  | { kind: "sheet" }
  | { kind: "help" }
  /** A marked phrase opened: by its line (an index into lines()) and its place in that line's marks; where it was clicked, when it was. */
  | { kind: "mark"; line: number; mark: number; x?: number; y?: number };

/** The character sheet over the scene: the seat's sheet row as the engine made it (none until it's in), and who they are. */
export interface SheetShown { data?: SheetData | undefined; who: { name: string; concept: string } }

/** The place's right-click menu, open: what was clicked and its actions, where on screen it was asked for, the highlighted choice, and the menu it was chosen from. */
export interface SceneMenu extends ThingActions {
  target: SceneTarget;
  x: number;
  y: number;
  index: number;
  /** The menu this one was chosen from (what to give, which spell, something else that's there). */
  parent?: SceneMenu;
}

/** What a deed from the menu gets when it can't go: the prototype's words. */
export const DEED_WAITS = "The GM has the floor: that will have to wait until they've finished.";
export const ONLY_LOOKING = "The scene is over: there's only looking now.";

export class SceneModel {
  view: SceneView;
  overlay?: Overlay;
  /** A marked phrase of the last reply that Tab picked out: Enter opens it, Esc lets go. */
  markFocus?: { line: number; mark: number };
  /** A marked phrase the pointer is on: the bottom line says what it is. */
  markPointed?: { line: number; mark: number };
  /** How big the screen draws the conversation's frame (a mark's popover stays inside it). */
  talkArea?: { w: number; h: number };
  /**
   * The screen row the conversation's last row is drawn on, as last laid out (a mark's popover finds
   * its phrase by it): part way down a frame the conversation doesn't fill, at the foot of one it
   * does (where it sticks), below the frame once PgUp has scrolled it up.
   */
  talkEnd?: () => number | undefined;
  /** A word of the client's own (an unknown command), until the next line. The simulation's refusals are the view's. */
  status?: string;
  /** Why the game this screen shows has gone from the server (its seat has: a stack started again with --fresh), until a view comes again. */
  gone?: string;
  /** A way on is being typed at (see wayOnKey): kept for the scene-over vertical. */
  typing = false;
  /** The scene's place: the world its rows rebuild, and the effects that play what changes in it. */
  readonly place: PlaceModel;
  /** The place's right-click menu, while it's open. */
  sceneMenu?: SceneMenu;

  private readonly actions: SceneActions;
  /** The seat's sheet, read when /sheet shows it: the rows have it, not the scene's view. */
  readonly sheet: () => SheetShown | undefined;
  private listeners = new Set<() => void>();
  private changes = 0;
  private pending?: ReturnType<typeof setTimeout>;
  private busyLines = new BusyLines();
  private busyLine?: string;
  /** Where the scene stood (momentOf) when the view's refusal came: it's shown until the scene moves on. */
  private refusedAt?: string;
  /** Glances at the place (the menu's Look): the screen's own quiet notes, each after the entries there were when it was taken. */
  private glances: Array<{ at: number; text: string }> = [];

  constructor(view: SceneView, actions: SceneActions, sheet: () => SheetShown | undefined = () => undefined, place = new PlaceModel()) {
    this.view = view;
    this.actions = actions;
    this.sheet = sheet;
    this.place = place;
    this.noteRefusal(view);
    place.update(view);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * How many changes the screen has been told of. The screen draws by it (useStore), and looks at it
   * again once it has subscribed, so a change told of before then (with no one listening) still shows.
   */
  get version(): number { return this.changes; }

  emit(): void {
    if (this.pending) { clearTimeout(this.pending); this.pending = undefined; }
    this.changes++;
    for (const l of this.listeners) l();
  }

  /** The draft grows several times a second: redraw at most ~30 times a second. */
  emitSoon(): void {
    this.pending ??= setTimeout(() => this.emit(), 33);
  }

  /**
   * A new view from the rows. A line that starts the GM thinking (queued, or deciding) gets a fresh
   * line for the spinner; new entries forget the marks picked out of the old ones only when the
   * scene changes (the indexes stay good as entries are added at the end).
   */
  update(view: SceneView): void {
    const was = this.view;
    if (thinking(view) && !thinking(was)) this.busyLine = this.busyLines.next(this.busyLine);
    if (view.title !== was.title) this.forgetMarks();
    this.view = view;
    this.gone = undefined;
    this.noteRefusal(view);
    this.place.update(view);
    if (onlyGrew(was, view)) this.emitSoon();
    else this.emit();
  }

  /**
   * Kept to the game's rows: told of every change from now on, and first brought to the rows as they
   * are now. The view the model was made from can be old by then (the screen reads its first view,
   * then comes up), and a change in between (an opening that failed at once, a turn's note) would
   * otherwise not show until another row changed. `gone` is what the status line says when the game
   * has gone from the server. Returns the unsubscribe.
   */
  follow(game: Pick<Backend, "view" | "onChange">, gone: string): () => void {
    const now = () => { const view = game.view(); if (view) this.update(view); else this.lose(gone); };
    const stop = game.onChange(now);
    now();
    return stop;
  }

  /** No view: the game this screen showed has gone from the server. Its last view stays, its box shut, and `words` say why. */
  lose(words: string): void {
    if (this.gone === words) return;
    this.gone = words;
    this.emit();
  }

  /**
   * The simulation's last refusal, while the scene is where it was when the refusal came. A turn
   * moving on, a note, or the scene's end puts it away: a spectator's every line is refused, and
   * the refusal would otherwise hide the spinner and the turn's note for good.
   */
  refusal(): string | undefined {
    const { refusal } = this.view;
    return refusal !== undefined && this.refusedAt === momentOf(this.view) ? refusal : undefined;
  }

  /**
   * Whether a plain line goes to the simulation now: when the box is open, and when the simulation
   * refuses it in words worth seeing (a spectator's line, a line once a reply has closed the scene
   * or after its end, or while a turn is failed: its /retry). While the GM has the floor it waits in
   * the box; with the game gone from the server, or the connection cut off, there's nothing to send it to.
   */
  sends(): boolean {
    const v = this.view;
    return !this.gone && !v.cutOff && (v.mayType || !!v.watching || v.over || !!v.ending || v.phase === "failed");
  }

  /** The transcript's lines, with the glances at the place where they were taken (a glance while the GM is mid-reply sits under the turn, which goes on growing above it). */
  lines(): Line[] {
    const lines = linesOf(this.view);
    if (!this.glances.length) return lines;
    const n = this.view.entries.length;
    const glance = (text: string): Line => ({ kind: "look", speaker: "player", text });
    const entries = lines.slice(1, 1 + n);
    const out: Line[] = [lines[0]!];
    entries.forEach((line, i) => { out.push(...this.glances.filter(g => g.at === i).map(g => glance(g.text)), line); });
    out.push(...this.glances.filter(g => g.at >= n).map(g => glance(g.text)), ...lines.slice(1 + n));
    return out;
  }
  live(): Line | undefined { return liveOf(this.view); }

  /**
   * The spinner's line while the GM has the floor, by the turn's phase; nothing when it hasn't. A
   * considered turn (the GM ruling on a risky act before the reply) says so for the whole step, as
   * the prototype's status line opens on it.
   */
  busy(): string | undefined {
    const { phase, draft } = this.view;
    if (phase === "queued" || phase === "deciding") return this.busyLine ?? "The GM is thinking…";
    if (phase === "considering") return CONSIDERING;
    if (phase === "replying") return draft?.kind === "dialogue" ? `${draft.name ?? draft.speaker} is speaking…` : "The GM is speaking…";
    // The world settling behind the reply, and the notes on its marks being written: the GM's bookkeeping, either way.
    if (phase === "settling" || phase === "noting") return "The GM makes a note…";
    return undefined;
  }

  /**
   * The player's line: a /command (the old #command too), or what they say and do, when it goes to
   * the simulation (sends): a line it refuses is answered in the game's words.
   */
  input(raw: string): void {
    const text = raw.trim();
    if (!text) return;
    this.status = undefined;
    if (text.startsWith("/") || text.startsWith("#")) { this.command(text.slice(1)); return; }
    if (!this.sends()) return;
    this.markFocus = undefined;
    this.refusedAt = undefined;
    this.actions.say(text);
    this.emit();
  }

  private command(command: string): void {
    const [typed = "", word] = command.trim().split(/\s+/);
    switch (commandNamed(typed)) {
      case "sheet": this.overlay = { kind: "sheet" }; break;
      case "help": this.overlay = { kind: "help" }; break;
      case "retry":
        if (this.view.phase === "failed") this.actions.retry();
        else this.status = "Nothing to retry: the last turn didn't fail.";
        break;
      case "suggestions": void this.turnSuggestions(word); break;
      case "quit": this.actions.quit(); return;
      default:
        this.status = typed
          ? `There's no /${typed}. There's ${COMMANDS.filter(c => !c.testing).map(c => `/${c.name}`).join(", ").replace(/, ([^,]+)$/, " and $1")}.`
          : "A slash on its own says very little. Try /help.";
    }
    this.emit();
  }

  /**
   * /suggestions on or off, and with no word turned over: the player's own setting, which the
   * simulation keeps (turned on, it asks for this moment's lines at once). It goes any time, with the
   * GM mid-sentence or the scene over. Its words once it's made; a refusal's are the view's.
   */
  private async turnSuggestions(word: string | undefined): Promise<void> {
    const on = word === undefined ? !this.view.suggestionsOn : /^(on|yes)$/i.test(word) ? true : /^(off|no)$/i.test(word) ? false : undefined;
    if (on === undefined) { this.status = `/suggestions takes on or off (or nothing, to turn them over), not "${word}".`; this.emit(); return; }
    if (await this.actions.setSuggestions(on)) return;
    this.status = on ? SUGGESTIONS_ON : SUGGESTIONS_OFF;
    this.emit();
  }

  /** A spoken line's colour: the player's own blue for their words; the speaker's look for someone on stage; gold for anyone else. */
  speechColor(id: string | undefined): string {
    if (isPlayer(id)) return C.player;
    return this.view.present.find(p => p.key === id)?.color ?? C.speech;
  }

  /** The last reply's marks, in order: what Tab goes through. None when the last reply has none. */
  lastMarks(): Array<{ line: number; mark: number }> {
    const lines = this.lines();
    const i = lines.findLastIndex(l => l.kind === "narration" || l.kind === "dialogue");
    const marks = i >= 0 ? lines[i]!.marked?.marks ?? [] : [];
    return marks.map((_, mark) => ({ line: i, mark }));
  }

  /** A refusal new on the view (or the same words again, after a line) is shown from where the scene stands now. */
  private noteRefusal(view: SceneView): void {
    this.refusedAt = view.refusal === undefined ? undefined : this.refusedAt ?? momentOf(view);
  }

  /** The transcript's lines are new (another scene): what was picked out of them goes, and so do the glances and the place's menu. */
  private forgetMarks(): void {
    this.markFocus = undefined;
    this.markPointed = undefined;
    if (this.overlay?.kind === "mark") this.overlay = undefined;
    this.glances = [];
    this.sceneMenu = undefined;
  }

  /** Open a marked phrase: the note on it (where it was clicked, if it was). */
  openMark(line: number, mark: number, x?: number, y?: number): void {
    if (!this.lines()[line]?.marked?.marks[mark]) return;
    this.sceneMenu = undefined;
    this.overlay = { kind: "mark", line, mark, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) };
    this.emit();
  }

  // -------------------------------------------------------------------------------------------
  // The scene's place: pointing, looking, and the right-click menu (scene/menu.ts).

  /**
   * What the place's menu needs to word things as the lead knows them (what to call the cast whose
   * names they haven't heard, their spells), and what it offers: deeds wait while the GM has the
   * floor; there's only looking once the scene's over or ending, for a spectator (the lead's deeds
   * are the lead's), and with nothing to send them to.
   */
  sceneContext(): SceneContext {
    const v = this.view, p = this.place.shown;
    const looking = v.over || !!v.ending || !!v.watching || !!v.cutOff || !!this.gone;
    return { ...(p ? { unnamed: p.unnamed, spells: p.spells } : {}), ...(looking ? { over: true } : !v.mayType ? { busy: true } : {}) };
  }

  /** Right-click on the place, or a line of the list under it (or Enter on what Tab picked out): what can be done with it. */
  openSceneMenu(target: SceneTarget, x: number, y: number): void {
    const world = this.place.world;
    if (!world) return;
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

  /**
   * A glance at something in the place (the menu's Look, worded by lookText: what anyone could
   * see, never the world's descriptions, which are the GM's): at once, as a quiet note in the
   * transcript. It isn't a turn, and the GM never hears it. The same look twice running is noted once.
   */
  lookNote(text: string): void {
    if (!text) return;
    const n = this.view.entries.length, last = this.glances[this.glances.length - 1];
    if (!(last && last.at === n && last.text === text)) this.glances.push({ at: n, text });
    this.emit();
  }

  /**
   * A deed from the place's menu ("(I pick up Prout's satchel)"): the lead's turn, as if typed, for
   * the rules and the GM to take as they take typed deeds. It isn't typed, so it can't wait in the
   * box while the GM has the floor: it's refused in the prototype's words then, and once the scene's
   * over. Anything else goes as a typed line does (a spectator's, a failed turn's, refused in the
   * game's words).
   */
  deed(line: string): void {
    const v = this.view;
    if (v.mayType) { this.input(line); return; }
    if (v.over || v.ending) this.status = ONLY_LOOKING;
    else if (!v.watching && (v.phase === "queued" || v.phase === "deciding" || v.phase === "replying")) this.status = DEED_WAITS;
    else { this.input(line); return; }
    this.emit();
  }

  /** Tab with a mark open: the next of the same reply's (or the one before), opened where the last one was. */
  stepMark(by: number): void {
    const o = this.overlay;
    if (o?.kind !== "mark") return;
    const n = this.lines()[o.line]?.marked?.marks.length ?? 0;
    if (n < 2) return;
    this.overlay = { ...o, mark: (o.mark + by + n) % n };
    this.markFocus = { line: o.line, mark: this.overlay.mark };
    this.emit();
  }

  closeOverlay(): void {
    this.overlay = undefined;
    this.emit();
  }
}

/** The GM has a line to think about: said and waiting, or being decided. */
const thinking = (view: SceneView) => view.phase === "queued" || view.phase === "deciding";

/** Where the scene stands, for a refusal to lapse by: the turn shown and its phase, what it waits on, how much has been said, whether it's over. A draft growing doesn't move it on. */
const momentOf = (view: SceneView) => JSON.stringify([view.turn, view.phase, view.note, view.entries.length, view.over]);

/**
 * Only the draft grew (the same try at the reply, further on): it's redrawn at most ~30 times a
 * second. A new attempt starts the text again, so it's drawn at once, as is anything else.
 */
function onlyGrew(was: SceneView, view: SceneView): boolean {
  return !!was.draft && !!view.draft && was.draft.attempt === view.draft.attempt
    && was.entries.length === view.entries.length && was.phase === view.phase && was.note === view.note && was.refusal === view.refusal;
}
