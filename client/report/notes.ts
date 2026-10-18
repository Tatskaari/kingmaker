// Copied from the prototype's src/report/recent.ts at 44c6d4a, as a class a client holds (the AppModel's report) where it was the module's own: noteError, noteScreen and watchConsole whole, the game being played by number; forgetRecent goes (a test makes a new one).
import type { NotedError, NotedScreen } from "../../shared/report/format.ts";

/**
 * What a report needs that the game's host hasn't got: the errors the client caught or logged, with
 * their stacks, and the last few screens, as text. The host notes them as it goes (client/report/
 * attach.ts: the screens a moment after each change, what's thrown and logged); a report takes
 * what's here when it's made.
 */

const KEEP_ERRORS = 50;
const KEEP_SCREENS = 8;
/** A screen noted this soon after the last one, of the same kind, takes its place rather than adding to the list. */
const SAME_MOMENT_MS = 5000;

export class Noted {
  private readonly caught: NotedError[] = [];
  private readonly shown: Array<NotedScreen & { ms: number }> = [];
  /** The game being played from now on (none, on the title): the errors caught are noted as its. */
  game: string | undefined;

  /** An error caught or logged, with where it was caught. */
  error(where: string, error: unknown): void {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : safeJson(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.caught.push({ at: new Date().toISOString(), where, message, ...(stack ? { stack } : {}), ...(this.game ? { game: this.game } : {}) });
    if (this.caught.length > KEEP_ERRORS) this.caught.splice(0, this.caught.length - KEEP_ERRORS);
  }

  errors(): NotedError[] {
    return this.caught.map(e => ({ ...e }));
  }

  /**
   * A screen, as text. Another screen of the same kind within a few seconds takes the last one's place
   * (walking the map changes it at every step), so the list is the last few moments, not the last few frames.
   */
  screen(screen: string, text: string, now = Date.now()): void {
    const last = this.shown[this.shown.length - 1];
    if (last?.text === text) return;
    const entry = { at: new Date(now).toISOString(), screen, text, ms: now };
    if (last && last.screen === screen && now - last.ms < SAME_MOMENT_MS) this.shown[this.shown.length - 1] = { ...entry, ms: last.ms };
    else this.shown.push(entry);
    if (this.shown.length > KEEP_SCREENS) this.shown.splice(0, this.shown.length - KEEP_SCREENS);
  }

  screens(): NotedScreen[] {
    return this.shown.map(({ at, screen, text }) => ({ at, screen, text }));
  }
}

/**
 * console.error and console.warn noted too, as they go: the client logs what it catches and carries
 * on from (a move that threw, a save the browser wouldn't take). Once a console.
 */
export function watchConsole(noted: Noted, on: Pick<Console, "error" | "warn"> = console): void {
  if (watching.has(on)) return;
  watching.add(on);
  for (const level of ["error", "warn"] as const) {
    const original = on[level].bind(on);
    on[level] = (...args: unknown[]) => {
      const error = args.find(a => a instanceof Error);
      const text = args.map(a => (typeof a === "string" ? a : a instanceof Error ? a.message : safeJson(a))).join(" ");
      noted.error(`console.${level}`, error ? Object.assign(new Error(text), { stack: error.stack }) : text);
      original(...args);
    };
  }
}
const watching = new WeakSet<object>();

function safeJson(value: unknown): string {
  try { return JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v)) ?? String(value); } catch { return String(value); }
}
