// After the prototype's src/app/report.ts at 44c6d4a: attachReporting and screenOf whole but for their seams (the AppModel's report where it was the Game's fields); watchScreens notes the screen once a second while nothing's over it, where it noted one a moment after each of the Game's changes (the client's screens each have a model of their own).
import type { AppModel } from "../app/model.ts";
import { whereOf } from "./where.ts";
import { watchConsole } from "./notes.ts";

/**
 * Reporting a problem, as a host sets it up (V16, M5): what a report needs from the renderer that
 * draws the game, which the game itself doesn't hold. The terminal's client (hosts/client.tsx) and
 * the page's (hosts/web/client-worker.tsx) attach it.
 *
 * - What's on screen now, as text: the frame last drawn (a report asked for over the game keeps the
 *   screen as it was before the question came up over it).
 * - The last few screens: noted once a second while nothing's over the screen but what was open on
 *   it (never an Esc menu or a report's question), each of a kind a few seconds apart taking the
 *   last one's place (notes.ts).
 * - What's logged (console.error and console.warn); the host notes what's thrown unhandled.
 */

/** A renderer the screen can be read from: OpenTUI's, or the page's stand-in (web/tui). */
export interface Screened {
  width: number;
  height: number;
  currentRenderBuffer: { getRealCharBytes(addLineBreaks?: boolean): Uint8Array };
}

/** How often the screen is noted while it's up. */
const NOTE_MS = 1000;

/** Reporting attached to the app over its renderer; returns what stops it. */
export function attachReporting(app: AppModel, renderer: Screened): () => void {
  app.report.screen = () => screenOf(renderer, app);
  watchConsole(app.report.noted);
  const timer = setInterval(() => noteScreen(app, renderer), NOTE_MS);
  (timer as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
}

/**
 * The frame last drawn, as text: a row a line, the ends of the rows trimmed. OpenTUI can't lend out
 * its buffer while it's sending a frame to the terminal ("OutputBusy"): that's tried again a few
 * times, then left (undefined), and isn't an error worth reporting.
 */
export function screenOf(renderer: Screened, app?: AppModel): string | undefined {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = new TextDecoder().decode(renderer.currentRenderBuffer.getRealCharBytes(true));
      return text.split("\n").map(row => row.trimEnd()).join("\n").replace(/\n+$/, "");
    } catch (error) {
      if (/OutputBusy/.test(String((error as Error)?.message))) continue;
      app?.report.noted.error("read the screen", error);
      return undefined;
    }
  }
  return undefined;
}

/** The screen noted, as the screen it is and what's open on it, unless an Esc menu or a report's question is over it: neither is what's being reported. */
function noteScreen(app: AppModel, renderer: Screened): void {
  const where = whereOf(app);
  if (app.report.open || where.overlay === "menu") return;
  const text = screenOf(renderer, app);
  if (text) app.report.noted.screen(`${where.screen}${where.overlay ? ` (${where.overlay})` : ""}`, text);
}
