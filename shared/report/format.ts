// After the prototype's src/report/dump.ts at 44c6d4a, its Dump: one file with what the player said, the build, the settings, where they were and the screens, the game, and the errors; the game is its host's rows and the AI service's own of it (GameReport), where it was the game's folder of saves, snapshots and calls.
import type { GameCalls, GameDocs } from "../protocol/ai.ts";
import type { RowsByTable } from "./rows.ts";

/**
 * A report of a problem (V16, M5: docs/migration-log.md), as the file has it: gzipped JSON with
 * what the player said, when, the build and the settings, where they were and what was on screen
 * (with the last few screens before it), the game as its host had it (every table's rows of the
 * game, and the AI service's calls, memory reviews and docs for it), and the errors the client
 * caught. Never a key: every one the client and its host know of is taken out before it's written
 * (redact.ts). The client makes it (client/report), a host keeps it (the terminal's runs/reports,
 * the page's download), and `npm run report` reads and restores it (qa/report).
 */

export const REPORT_KIND = "kingmaker-report";
/** The prototype's were format 1 (a game's folder of saves); the game's are 2 (its rows). */
export const REPORT_FORMAT = 2;

export interface Report {
  kind: typeof REPORT_KIND;
  format: typeof REPORT_FORMAT;
  /** What the player said went wrong. */
  words: string;
  /** When they said it (ISO). */
  at: string;
  build: Build;
  settings: Settings;
  where: Where;
  /** What was on screen as they asked to report it, and the last few screens before it, as text. */
  screens: { now?: string; recent: NotedScreen[] };
  /** The game reported on, as its host gave it; none before there's a game (the title with none, creation), or why it couldn't be had. */
  game?: GameReport | { error: string };
  /** Errors the client caught or logged (the newest last), with their stacks. */
  errors: NotedError[];
  /** How many keys (or key-shaped strings) were taken out of it. */
  redacted: number;
}

export interface Build {
  /** Which client made it: the terminal's, the headless one (npm run play), or the page's. */
  host: "terminal" | "headless" | "page";
  /** The git commit it ran from (a terminal's, asked of git; a page's is its build's). */
  commit?: string;
  /** It had changes beyond the commit. */
  dirty?: boolean;
  /** The page's build stamp (<html data-build>). */
  stamp?: string;
  /** Node's version and the platform (a terminal's); a browser's user agent (a page's). */
  node?: string;
  platform?: string;
  userAgent?: string;
}

export interface Settings {
  /** The glyph set the client draws with. */
  glyphs?: string;
  /** The terminal's size in cells (a page's terminal's, in a page). */
  terminal?: { cols: number; rows: number };
  /** A page's GM: the fake one, or OpenRouter with the player's key. */
  model?: string;
  /** Moves shown at their ends (reduced motion). */
  reducedMotion?: boolean;
  /** The game's own settings (KM_*) and the terminal's (TERM, COLORTERM, LANG), never anything named like a secret: a terminal's. */
  env: Record<string, string>;
}

/** Where the player was, as the client had it when they asked to report. */
export interface Where {
  /** The client's screen: title, create, choose, custom, backstory, created, creating, scene, explore, fight; a scene's page beyond it: between, standin (the story's fight's stand-in), end. */
  screen: string;
  /** What was open over it (the sheet, the help, the notebook, the menu, the log…), or where the report was asked for from (menu). */
  overlay?: string;
  /** A turn under way: what the screen said ("The GM is thinking…"). */
  busy?: string;
  /** The status line's words. */
  status?: string;
  /** The game, by its number, and whether the player was watching someone else's. */
  game?: string;
  watching?: string;
  /** The scene on screen: its row's id, key, title, the turn shown and its phase, and whether it was over. */
  scene?: { id: string; key: string; title: string; turn: number; phase?: string; over?: boolean; talk?: boolean };
  /** On a map: which, and the tile. */
  map?: { key: string; at: { x: number; y: number }; place?: string };
  /** The story's time of day. */
  time?: string;
  /** A fight on screen: its round, whose turn and how it stands. */
  fight?: { round: number; turn?: string; status: string };
  /** From the title: the report is about the latest game played. */
  latest?: boolean;
}

export interface NotedScreen {
  at: string;
  /** The client's screen it was, and what was over it. */
  screen: string;
  text: string;
}

export interface NotedError {
  at: string;
  /** Where it was caught: "unhandled rejection", "console.error", "trouble"… */
  where: string;
  message: string;
  stack?: string;
  /** The game being played when it was caught (an earlier game this sitting, maybe). */
  game?: string;
}

/**
 * What a game's host gives a report: report_game (the module's procedure, which only the game's
 * owner may call) or the page host's. Every table's rows of the game, by the table's accessor (game,
 * player, scene, transcript…), as rows.ts writes them; and what the AI service keeps of it: its
 * calls and memory reviews, and its docs (or why they couldn't be had). The page host adds its own
 * latest log lines.
 */
export interface GameReport {
  kind: "kingmaker-game";
  /** The game's number (its row's id) and uid (its id in every AI request, key and folder). */
  id: string;
  uid: string;
  /** Its campaign and version: caerwyn@0.1.0. */
  campaign: string;
  rows: RowsByTable;
  ai: { calls: GameCalls; docs: GameDocs } | { error: string };
  log?: string[];
}

/** A host's answer for a report's game: the game, or the refusal (not the caller's game, no such game) as the module words it. */
export type GameAnswer = GameReport | { refusal: { code: string; text: string } };

/** A time as a report's file name has it: 20261018-150233 (UTC). */
export const stampOf = (iso: string) => iso.replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-").replace(/Z$/, "");
