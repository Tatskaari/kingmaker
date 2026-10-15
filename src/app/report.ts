import { noteError, noteScreen, watchConsole } from "../report/recent.ts";
import type { Game } from "./game.ts";

/**
 * Reporting a problem, as the app sees it (src/report): what a report needs from the renderer that
 * draws the game, which the game itself doesn't hold. main.tsx sets it up for the terminal app (and
 * the server's games), and the static build's game.tsx for the browser's.
 *
 * - What's on screen now, as text: the frame last drawn (a report asked for over the game keeps the
 *   screen as it was before the question came up over it).
 * - The last few screens: noted a moment after each change the game makes (not every animation
 *   frame), and as the Esc menu opens (the frame before it), but never with the menu or a report's
 *   question over them.
 * - The terminal's size, and what's logged (console.error and console.warn) and thrown unhandled.
 */

/** A renderer the screen can be read from: OpenTUI's, or the browser build's stand-in (src/web/tui). */
export interface Screened {
  width: number;
  height: number;
  currentRenderBuffer: { getRealCharBytes(addLineBreaks?: boolean): Uint8Array };
}

/** How long after a change the screen is noted: once it's been drawn. */
const SETTLE_MS = 400;

export function attachReporting(game: Game, renderer: Screened): void {
  game.screenText = () => screenOf(renderer);
  game.terminalSize = () => ({ cols: renderer.width, rows: renderer.height });
  watchConsole();
  watchScreens(game);
}

/**
 * The frame last drawn, as text: a row a line, the ends of the rows trimmed. OpenTUI can't lend out
 * its buffer while it's sending a frame to the terminal ("OutputBusy"): that's tried again a few
 * times, then left (undefined), and isn't an error worth reporting.
 */
export function screenOf(renderer: Screened): string | undefined {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = new TextDecoder().decode(renderer.currentRenderBuffer.getRealCharBytes(true));
      return text.split("\n").map(row => row.trimEnd()).join("\n").replace(/\n+$/, "");
    } catch (error) {
      if (/OutputBusy/.test(String((error as Error)?.message))) continue;
      noteError("read the screen", error);
      return undefined;
    }
  }
  return undefined;
}

/** An error nobody caught: noted for a report, as well as shown (main.tsx and game.tsx show it). */
export const unhandled = (error: unknown) => noteError("unhandled", error);

function watchScreens(game: Game): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let covered = false;
  /** Noted if it can be read; `tries` more, a moment apart, if the renderer is busy sending it. */
  const note = (name: string, tries = 0) => {
    const text = game.screenText?.();
    if (text) noteScreen(name, text);
    else if (tries > 0) setTimeout(() => { if (!isCovered(game)) note(name, tries - 1); }, 40);
  };
  game.subscribe(() => {
    const now = isCovered(game);
    // Coming up now: the frame still on screen is the one before it (and whatever was over it then).
    if (now && !covered) note(game.screen);
    covered = now;
    if (now || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      const over = game.overlay?.kind;
      if (!isCovered(game)) note(`${game.screen}${over ? ` (${over})` : ""}`, 5);
    }, SETTLE_MS);
  });
}

/** The Esc menu or a report's question is over the game: neither is what's being reported. */
const isCovered = (game: Game) => game.overlay?.kind === "menu" || game.overlay?.kind === "report";
