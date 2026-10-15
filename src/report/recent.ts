/**
 * What a report needs that isn't in the game's files: the errors caught or logged since the game
 * started, with their stacks, and the last few screens, as text. The app notes them as it goes
 * (src/app/report.ts); a report takes what's here when it's made.
 */

export interface NotedError {
  at: string;
  /** Where it was caught: "turn", "unhandled rejection", "console.error"... */
  where: string;
  message: string;
  stack?: string;
  /** The game being played when it was caught (an earlier game this sitting, maybe). */
  game?: string;
}

export interface NotedScreen {
  at: string;
  /** The app's screen it was (title, explore, scene, between, combat, end), and what was over it. */
  screen: string;
  text: string;
}

const KEEP_ERRORS = 50;
const KEEP_SCREENS = 8;
/** A screen noted this soon after the last one, of the same kind, takes its place rather than adding to the list. */
const SAME_MOMENT_MS = 5000;

const errors: NotedError[] = [];
const screens: Array<NotedScreen & { ms: number }> = [];
let playing: string | undefined;

/** The game being played from now on (none, on the title): the errors caught are noted as its. */
export function noteGame(id: string | undefined): void {
  playing = id;
}

/** An error caught or logged, with where it was caught. */
export function noteError(where: string, error: unknown): void {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : safeJson(error);
  const stack = error instanceof Error ? error.stack : undefined;
  errors.push({ at: new Date().toISOString(), where, message, ...(stack ? { stack } : {}), ...(playing ? { game: playing } : {}) });
  if (errors.length > KEEP_ERRORS) errors.splice(0, errors.length - KEEP_ERRORS);
}

export const recentErrors = (): NotedError[] => errors.map(e => ({ ...e }));

/**
 * A screen, as text. Another screen of the same kind within a few seconds takes the last one's place
 * (walking the map changes it at every step), so the list is the last few moments, not the last few frames.
 */
export function noteScreen(screen: string, text: string, now = Date.now()): void {
  const last = screens.at(-1);
  if (last?.text === text) return;
  const entry = { at: new Date(now).toISOString(), screen, text, ms: now };
  if (last && last.screen === screen && now - last.ms < SAME_MOMENT_MS) screens[screens.length - 1] = { ...entry, ms: last.ms };
  else screens.push(entry);
  if (screens.length > KEEP_SCREENS) screens.splice(0, screens.length - KEEP_SCREENS);
}

export const recentScreens = (): NotedScreen[] => screens.map(({ at, screen, text }) => ({ at, screen, text }));

/**
 * console.error and console.warn are noted too, as they go: the game logs what it catches and
 * carries on from (a background job that failed, a save the browser wouldn't take). Once only.
 */
export function watchConsole(): void {
  if (watching) return;
  watching = true;
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const error = args.find(a => a instanceof Error);
      const text = args.map(a => (typeof a === "string" ? a : a instanceof Error ? a.message : safeJson(a))).join(" ");
      noteError(`console.${level}`, error ? Object.assign(new Error(text), { stack: error.stack }) : text);
      original(...args);
    };
  }
}
let watching = false;

/** For tests: forget everything noted. */
export function forgetRecent(): void {
  errors.length = 0;
  screens.length = 0;
  playing = undefined;
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}
