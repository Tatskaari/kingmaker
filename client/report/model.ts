// After the prototype's src/app/game.ts at 44c6d4a, its reporting (:2252-2318: openReport, sendReport) and its overlay's report (src/app/ui/overlay.tsx:263-281: the question, sending, where it went), as a model the client's app holds over whichever screen is up; the line the player types is the model's own (edited), where it was OpenTUI's input.
import type { Filed, Where } from "../../shared/report/format.ts";
import { MAX_LINE } from "../../shared/protocol/refusals.ts";
import type { Backend } from "../backend.ts";
import { fileReport, type Reporting } from "./file.ts";
import { Noted } from "./notes.ts";

/**
 * Reporting a problem (V16, M5: docs/migration-log.md), from wherever it happened: b on the map and
 * in a fight, /report in a scene, an Esc menu's Report a problem…, the title's (about the latest
 * game). "What went wrong?" comes up over the screen, which is kept as it was when it was asked for
 * (from an Esc menu, the last screen noted before the menu); Enter files it (file.ts) and says where
 * it went, to tell Claude. The app holds one (AppModel.report) and the screens open it; the host
 * gives it the screen as drawn and its reporting (where a report goes), and notes the screens and
 * errors as it goes (attach.ts). It holds no React: the overlay (ui/report.tsx) subscribes.
 */

/** What the report reads of the client: where the player is (and what it was asked for from), the game it's about, the way to its host. */
export interface ReportApp {
  where(from?: string): Where;
  game(): bigint | undefined;
  readonly backend: Pick<Backend, "reportGame">;
}

/** The question over the screen: asking (the line typed, its cursor, a word when Enter came with nothing), sending, or where it went. */
export type ReportStep =
  | { step: "asking"; text: string; cursor: number; problem?: string }
  | { step: "sending" }
  | { step: "said"; said: string; failed: boolean };

/** A key as the line's editing reads it (OpenTUI's KeyEvent, and the stand-in's, have these). */
export interface KeyLike { name: string; sequence?: string; ctrl?: boolean; meta?: boolean }

/** What the report says when Enter comes with nothing typed. */
export const SAY_SOMETHING = "Say what went wrong first: a line or two, then Enter.";
/** What a client with nowhere to keep a report says (the demo, a check). */
export const NOWHERE = "(Reports aren't kept here: this client has no host to keep them, the demo or a check's.)";

export class ReportModel {
  /** The question, while it's up over the screen. */
  state?: ReportStep;
  /** The screens and errors noted as the client goes: a report keeps them. */
  readonly noted = new Noted();
  /** The host's: the screen as it's drawn now, as text (none, or nothing readable: the last noted). */
  screen?: () => string | undefined;
  /** The host's: how a report is kept (none: the demo, a check). */
  reporting: Reporting | undefined;
  /** Told where each report went (the map's What happens keeps it too). */
  onFiled?: (said: string) => void;

  private readonly app: ReportApp;
  /** The screen as it was when the report was asked for, and what it was asked for from. */
  private kept: { screen?: string; from?: string } = {};
  private readonly listeners = new Set<() => void>();
  private changes = 0;

  constructor(app: ReportApp, reporting?: Reporting) {
    this.app = app;
    this.reporting = reporting;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  get version(): number { return this.changes; }

  emit(): void {
    this.changes++;
    for (const l of this.listeners) l();
  }

  /** It's up, over the screen: the screens give it the keys. */
  get open(): boolean { return !!this.state; }

  /**
   * What went wrong? asked over the screen, which is kept as it is now: as drawn, or (from an Esc
   * menu, whose frame has the menu over it) the last screen noted before the menu came up. `from`
   * says where it was asked for (b, /report, the menu, the title).
   */
  ask(from?: string): void {
    if (this.state) return;
    const last = this.noted.screens().pop()?.text;
    const screen = from === "menu" ? last : (this.screen?.() ?? last);
    this.kept = { ...(screen !== undefined ? { screen } : {}), ...(from ? { from } : {}) };
    this.state = { step: "asking", text: "", cursor: 0 };
    this.emit();
  }

  /** The player's words (what's typed, or what came with /report), and the report goes: filed, then where it went is said. */
  async send(words?: string): Promise<void> {
    const asking = this.state;
    if (asking?.step !== "asking") return;
    const text = (words ?? asking.text).trim();
    if (!text) { this.state = { ...asking, problem: SAY_SOMETHING }; this.emit(); return; }

    this.state = { step: "sending" };
    this.emit();
    const said = await this.filed(text);
    this.state = said;
    if (!said.failed) this.onFiled?.(said.said);
    this.emit();
  }

  /** Put away (Esc, or Enter once it's said); never while it's being saved: where it went is still to say. */
  close(): void {
    if (!this.state || this.state.step === "sending") return;
    this.state = undefined;
    this.kept = {};
    this.emit();
  }

  /** A key while it's up: the line's editing, Enter sends it, Esc never minds; once it's said, Enter, Space or Esc puts it away. */
  key(key: KeyLike): void {
    const s = this.state;
    if (!s || s.step === "sending") return;
    if (s.step === "said") { if (isEnter(key) || key.name === "escape" || key.name === "space") this.close(); return; }
    if (key.name === "escape") { this.close(); return; }
    if (isEnter(key)) { void this.send(); return; }
    const next = edited(s, key);
    if (next) { this.state = { step: "asking", ...next }; this.emit(); }
  }

  /** Text pasted into the line, where the cursor is (a line of it: its breaks are spaces). */
  paste(text: string): void {
    const s = this.state;
    if (s?.step !== "asking") return;
    this.state = { step: "asking", ...inserted(s, text.replace(/\s+/g, " ")) };
    this.emit();
  }

  /** The report made and kept by the host: where it went, or why it couldn't be. */
  private async filed(words: string): Promise<ReportStep & { step: "said" }> {
    if (!this.reporting) return { step: "said", said: NOWHERE, failed: true };
    try {
      const ask = { words, where: this.app.where(this.kept.from), screens: { ...(this.kept.screen !== undefined ? { now: this.kept.screen } : {}), recent: this.noted.screens() }, errors: this.noted.errors() };
      const game = this.app.game();
      const filed: Filed = await fileReport(this.app.backend, { ...ask, ...(game !== undefined ? { game } : {}) }, this.reporting);
      return { step: "said", said: filed.said, failed: false };
    } catch (error) {
      this.noted.error("report", error);
      return { step: "said", said: `The report couldn't be saved: ${error instanceof Error ? error.message : String(error)}`, failed: true };
    }
  }
}

/** The Enter key, however the terminal sends it. */
const isEnter = (key: KeyLike) => key.name === "return" || key.name === "enter" || key.name === "kpenter";

/**
 * A line edited by a key: a character typed where the cursor is, Backspace and Delete, the arrows,
 * Home and End (Ctrl+A, Ctrl+E), Ctrl+U (everything before the cursor) and Ctrl+W (the word before
 * it); undefined for a key that doesn't edit.
 */
export function edited(line: { text: string; cursor: number }, key: KeyLike): { text: string; cursor: number } | undefined {
  const { text, cursor } = line;
  if (key.ctrl && key.name === "u") return { text: text.slice(cursor), cursor: 0 };
  if (key.ctrl && key.name === "w") {
    const start = text.slice(0, cursor).replace(/\S+\s*$/, "").length;
    return { text: text.slice(0, start) + text.slice(cursor), cursor: start };
  }
  if (key.name === "home" || (key.ctrl && key.name === "a")) return { text, cursor: 0 };
  if (key.name === "end" || (key.ctrl && key.name === "e")) return { text, cursor: text.length };
  if (key.name === "left") return { text, cursor: Math.max(0, cursor - 1) };
  if (key.name === "right") return { text, cursor: Math.min(text.length, cursor + 1) };
  if (key.name === "backspace") return cursor ? { text: text.slice(0, cursor - 1) + text.slice(cursor), cursor: cursor - 1 } : line;
  if (key.name === "delete") return { text: text.slice(0, cursor) + text.slice(cursor + 1), cursor };
  const typed = !key.ctrl && !key.meta ? key.sequence : undefined;
  return typed && !/[\x00-\x1f\x7f]/.test(typed) ? inserted(line, typed) : undefined;
}

/** Text put in where the cursor is, the line kept to MAX_LINE characters. */
function inserted({ text, cursor }: { text: string; cursor: number }, more: string): { text: string; cursor: number } {
  const room = Math.max(0, MAX_LINE - text.length);
  const put = more.slice(0, room);
  return { text: text.slice(0, cursor) + put + text.slice(cursor), cursor: cursor + put.length };
}
