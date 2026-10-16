// The prototype's src/app/game.ts at 44c6d4a, its scene section as a model fed by rows: :451-464 (subscribe, emit, emitSoon), :1386-1393 (onStep's CONSIDERING, as the turn's considering phase), :1510-1551 (input), :1596-1622 (command), :1454-1462 and :1490-1505 (setSuggestions and peek's /suggestions, the setting a move), :1897-1935 (speechColor and the marks), :2332-2344 (showSheet, as the sheet row read; closeOverlay); and the way on between scenes, :1696-1720 (continueScene, as goOn) and :1808-1815 (continueFromCard, as toLead), with the scene that's over kept on screen until the player goes on (story-design §4.5).
import type { Backend, Rejection } from "../backend.ts";
import type { SheetData } from "../../shared/rules/types.ts";
import { BusyLines, CONSIDERING } from "../busy.ts";
import { COMMANDS, commandNamed } from "../commands.ts";
import { betweenOf, epilogueOf, fightOf, wayOnOf, type BetweenView, type EndView, type FightView, type StoryView, type WayOn } from "../story/view.ts";
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
  /** The story's moves (story-design §4.3): `walk` toward the lead (its scene opens, the seat with it); `carry_on`, a boundary that got stuck; `fight_it_out`, the fight's stand-in. Each answers why not. */
  walk?(): Promise<Rejection | undefined>;
  carryOn?(): Promise<Rejection | undefined>;
  fightItOut?(): Promise<Rejection | undefined>;
  /** end_scene as the dev stack's owner (testing): the scene ends through `exit` now; "" lists the endings. */
  end?(exit: string): Promise<Rejection | undefined>;
}

/**
 * Which of the game's screens is up: the scene; the moment between scenes (Kell's talk, or the
 * card); the fight's stand-in; The End. The way on goes from one to the next (goOn).
 */
export type Page = "scene" | "between" | "fight" | "end";

/** What /suggestions says it did (the prototype's words, less the Esc menu, which this client hasn't got). */
export const SUGGESTIONS_ON = "Suggested lines on: a few things to say or do come up over the box after each reply.";
export const SUGGESTIONS_OFF = "Suggested lines off. (/suggestions brings them back.)";

export type Overlay =
  | { kind: "sheet" }
  | { kind: "help" }
  /** The investigator's notebook, and the quests (story-design §4.5). */
  | { kind: "journal" }
  | { kind: "quests" }
  /** A marked phrase opened: by its line (an index into lines()) and its place in that line's marks; where it was clicked, when it was. */
  | { kind: "mark"; line: number; mark: number; x?: number; y?: number };

/** The character sheet over the scene: the seat's sheet row as the engine made it (none until it's in), and who they are. */
export interface SheetShown { data?: SheetData | undefined; who: { name: string; concept: string } }

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
  /** A way on is being typed at (a scene that's over, the moment between scenes: see wayOnKey): the Enter that ends what's typed only ends it. */
  typing = false;
  /** The story around the scene, the latest the rows have, whichever scene is on screen (story/view.ts). */
  story?: StoryView;
  /** A scene the seat has moved on to while this one, over, is still on screen (a summons; a spectator following the lead): the way on shows it. */
  next?: SceneView;
  /** Which of the game's screens is up. */
  page: Page = "scene";
  /** Enter was pressed before the story had moved on (the prototype's queued): it goes on as soon as it has. */
  queued = false;
  /** The fight's stand-in has been fought (fight_it_out made): its card says how it went, and goes back to the scene. */
  fought = false;

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

  constructor(view: SceneView, actions: SceneActions, sheet: () => SheetShown | undefined = () => undefined) {
    this.view = view;
    this.actions = actions;
    this.sheet = sheet;
    this.noteRefusal(view);
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
    if (view.story) this.story = view.story;
    this.gone = undefined;
    // Another scene, while this one is over and on screen: kept until the player goes on (story-design §4.5).
    if (this.holds(view)) {
      this.next = view;
      if (!this.goneOnOnceReady()) this.emit();
      return;
    }
    this.show(view);
    this.goneOnOnceReady();
  }

  /** A view drawn: the scene's own, or the next one's, now on screen (the moment between scenes over, if it was up). */
  private show(view: SceneView): void {
    const was = this.view;
    const another = view.sceneId !== was.sceneId || view.title !== was.title;
    if (thinking(view) && !thinking(was)) this.busyLine = this.busyLines.next(this.busyLine);
    if (another) {
      this.forgetMarks();
      this.next = undefined;
      this.queued = false;
      this.fought = false;
      if (this.page === "between") this.page = "scene";
    }
    this.view = view;
    this.noteRefusal(view);
    if (onlyGrew(was, view)) this.emitSoon();
    else this.emit();
  }

  /**
   * Is this another scene, come while the one on screen is over (or its fight is next) and the
   * player hasn't gone on? A summons opens the next scene in the boundary's commit, and a spectator's
   * seat follows the lead in: the scene that's over stays up, last reply and all, until Enter.
   */
  private holds(view: SceneView): boolean {
    const shown = this.view;
    return this.page !== "between" && view.sceneId !== undefined && shown.sceneId !== undefined && view.sceneId !== shown.sceneId && (shown.over || !!shown.fighting);
  }

  /** Enter was pressed before the story was ready (queued), and now it is: on, as the prototype goes. True when it went. */
  private goneOnOnceReady(): boolean {
    if (!this.queued || this.page !== "scene") return false;
    const way = this.wayOn();
    if (!way?.ready || way.to === "carry_on") return false;
    this.goOn();
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // The way on (story-design §4.5): the scene that's over, the moment between scenes, the fight's
  // stand-in, The End.

  /** Where Enter goes from the scene on screen, once it's over or its fight is next; none while it's played, or with no story yet. */
  wayOn(): WayOn | undefined {
    return wayOnOf(this.view, this.story, { next: this.next, queued: this.queued });
  }

  /**
   * The player goes on from the scene that's over (an Enter of its own, or a click): to the moment
   * between scenes, the next scene that's come for them, the fight, or The End; a story that got
   * stuck is tried again. Before the story has moved on, they go as soon as it has (queued).
   */
  goOn(): void {
    const way = this.wayOn();
    if (!way) return;
    this.typing = false;
    this.status = undefined;
    this.queued = false;
    switch (way.to) {
      case "wait": this.queued = true; break;
      case "carry_on": void this.answer(this.actions.carryOn?.()); return;
      case "between": this.page = "between"; break;
      case "next": if (this.next) { this.show(this.next); return; } break;
      case "fight": this.page = "fight"; this.fought = false; break;
      case "end": this.page = "end"; this.overlay = undefined; break;
    }
    this.emit();
  }

  /** The moment between scenes: Kell's talk, or the card. None until the story has a lead. */
  between(): BetweenView | undefined {
    return this.story ? betweenOf(this.story, this.view.sceneId) : undefined;
  }

  /** On from the moment between scenes (an Enter of its own, or a click): walk toward the lead, whose scene opens, and the seat with it. */
  toLead(): void {
    this.typing = false;
    this.status = undefined;
    void this.answer(this.actions.walk?.());
    this.emit();
  }

  /** The fight's card: the stand-in's word on itself, or once fought, how it went. */
  fight(): FightView {
    return fightOf(this.fought);
  }

  /** Enter on the fight's card: fight it out (the stand-in resolves it, as won, and the scene picks up from it); fought, back to the scene. */
  fightOn(): void {
    this.typing = false;
    this.status = undefined;
    if (this.fought) { this.page = "scene"; this.fought = false; this.emit(); return; }
    void this.answer(this.actions.fightItOut?.(), () => { this.fought = true; });
    this.emit();
  }

  /** From The End back to the title, where the game is over: the scene's screen is the scene again, should the game be carried on. */
  toTitle(): void {
    this.page = "scene";
    this.actions.quit();
  }

  /** The End: the closing, how each scene ended, the GM's bar tab. None before there's a story. */
  epilogue(): EndView | undefined {
    return this.story ? epilogueOf(this.view, this.story) : undefined;
  }

  /** A story move answered: why not, on the status line; else `made`. */
  private async answer(move: Promise<Rejection | undefined> | undefined, made?: () => void): Promise<void> {
    if (!move) { this.status = "(That can't be done from here.)"; this.emit(); return; }
    const refused = await move;
    if (refused) this.status = refused.text;
    else made?.();
    this.emit();
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

  lines(): Line[] { return linesOf(this.view); }
  live(): Line | undefined { return liveOf(this.view); }

  /**
   * The spinner's line while the GM has the floor, by the turn's phase; nothing when it hasn't. A
   * considered turn (the GM ruling on a risky act before the reply) says so for the whole step, as
   * the prototype's status line opens on it.
   */
  busy(): string | undefined {
    // The scene's over and the story is moving on (the boundary in flight): the prototype's word for it.
    if (this.wayOn()?.to === "wait" && this.story?.onward === "moving" && !this.view.watching) return "The story moves on…";
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
      case "journal": this.overlay = { kind: "journal" }; break;
      case "quests": this.overlay = { kind: "quests" }; break;
      // For testing: the scene ends through an exit now, as the dev stack's owner; with none, the endings.
      case "exits": void this.endScene(""); return;
      case "end": void this.endScene(word ?? ""); return;
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

  /** /end <exit>: the scene ends through it now (the owner's end_scene); /end alone, or /exits, says what the endings are. Their words on the status line. */
  private async endScene(exit: string): Promise<void> {
    const refused = await (this.actions.end?.(exit) ?? Promise.resolve({ code: "error" as const, text: "(/end is for testing, as the dev stack's owner: there's none here.)" }));
    if (refused) this.status = refused.text;
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
