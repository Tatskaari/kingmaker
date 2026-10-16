// The prototype's src/app/game.ts at 44c6d4a, its scene section as a model fed by rows: :451-464 (subscribe, emit, emitSoon), :1510-1551 (input), :1596-1622 (command), :1454-1462 and :1490-1505 (setSuggestions and peek's /suggestions, the setting a move), :1897-1935 (speechColor and the marks), :2341-2344 (closeOverlay).
import type { Rejection } from "../backend.ts";
import { BusyLines } from "../busy.ts";
import { COMMANDS, commandNamed } from "../commands.ts";
import { C } from "../theme.ts";
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
  | { kind: "help" }
  /** A marked phrase opened: by its line (an index into lines()) and its place in that line's marks; where it was clicked, when it was. */
  | { kind: "mark"; line: number; mark: number; x?: number; y?: number };

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

  private readonly actions: SceneActions;
  private listeners = new Set<() => void>();
  private pending?: ReturnType<typeof setTimeout>;
  private busyLines = new BusyLines();
  private busyLine?: string;
  /** Where the scene stood (momentOf) when the view's refusal came: it's shown until the scene moves on. */
  private refusedAt?: string;

  constructor(view: SceneView, actions: SceneActions) {
    this.view = view;
    this.actions = actions;
    this.noteRefusal(view);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  emit(): void {
    if (this.pending) { clearTimeout(this.pending); this.pending = undefined; }
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
    if (onlyGrew(was, view)) this.emitSoon();
    else this.emit();
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
   * refuses it in words worth seeing (a spectator's line, a line after the scene's end, or while a
   * turn is failed: its /retry). While the GM has the floor it waits in the box; with the game gone
   * from the server there's nothing to send it to.
   */
  sends(): boolean {
    const v = this.view;
    return !this.gone && (v.mayType || !!v.watching || v.over || v.phase === "failed");
  }

  lines(): Line[] { return linesOf(this.view); }
  live(): Line | undefined { return liveOf(this.view); }

  /** The spinner's line while the GM has the floor, by the turn's phase; nothing when it hasn't. */
  busy(): string | undefined {
    const { phase, draft } = this.view;
    if (phase === "queued" || phase === "deciding") return this.busyLine ?? "The GM is thinking…";
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

  /** The transcript's lines are new (another scene): what was picked out of them goes. */
  private forgetMarks(): void {
    this.markFocus = undefined;
    this.markPointed = undefined;
    if (this.overlay?.kind === "mark") this.overlay = undefined;
  }

  /** Open a marked phrase: the note on it (where it was clicked, if it was). */
  openMark(line: number, mark: number, x?: number, y?: number): void {
    if (!this.lines()[line]?.marked?.marks[mark]) return;
    this.overlay = { kind: "mark", line, mark, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) };
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
