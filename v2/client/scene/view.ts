// New, with the prototype's src/app/game.ts:98-114 (Line, less look and scene), :163-170 (isRoll) and :1330-1339 (lineOf and header, as linesOf and liveOf) at 44c6d4a.
import type { Markup } from "../../shared/markup.ts";

/**
 * The scene screen's view model: everything it draws, made from the rows the client subscribes to
 * (the scene's `transcript` entries, the `reply_draft` the GM's text grows in, the `turn` row's
 * phase) and the names and looks of who's there. The screen holds nothing else about the game.
 */

/** A turn's phase, as the `turn` row has it; "idle" before the scene's first line. */
export type Phase = "idle" | "queued" | "deciding" | "replying" | "settling" | "done" | "failed";

/** What kind of entry a transcript row is (the simulation's `transcript.kind`). */
export type EntryKind = "player" | "narration" | "dialogue" | "roll" | "system";

/** A transcript row, as the screen needs it. */
export interface Entry {
  turn: number;
  /** "player:<id>", "gm", "dice", "system", or a cast key when an actor speaks. */
  speaker: string;
  kind: EntryKind;
  /** The name the player knows the speaker by (my_names, or the player's character), for their lines and dialogue. */
  name?: string;
  text: string;
  /** A GM reply's markup: who says each line, and the notes on its phrases (offsets into `text`). */
  markup?: Markup;
}

/** The GM's reply as it's being written: the `reply_draft` row for the turn. */
export interface Draft {
  speaker: string;
  kind: "narration" | "dialogue";
  name?: string;
  /** All of it so far. */
  text: string;
  markup?: Markup;
}

/** Someone in the scene, as the player knows them: by the name they've heard (or what they're called), in their look's colour. */
export interface Person { key: string; name: string; color?: string }

/** One of a scene's suggested lines: to say, to do, a risky try, a way out (they're coloured by kind). */
export interface Suggestion { kind: "say" | "do" | "try" | "leave"; text: string }

export interface SceneView {
  /** The scene's title, the time of day in a word, and the line under the title (the hook, or the lead that brought them). */
  title: string;
  time?: string;
  hook?: string;
  /** The player's character: their name, and their sheet's status line (HP, slots). */
  player: { name: string; status?: string };
  /** Who's on stage, by their key (the speaker in markup and dialogue). */
  present: Person[];
  entries: Entry[];
  draft?: Draft;
  phase: Phase;
  /** The player may say a line now: they control the scene, it's live, and no turn is deciding or replying. */
  mayType: boolean;
  /** The words of the last move the simulation refused (a SenderError's Refusal text), until the next line. */
  refusal?: string;
  /** Why the turn failed (`turn.error`), when it has: a retry is offered. */
  failed?: string;
  suggestions?: Suggestion[];
}

// -------------------------------------------------------------------------------------------------
// The lines the transcript draws (the prototype's src/app/game.ts Line, isRoll, lineOf, header).

export interface Line {
  /**
   * "info": the rules' word on what changed without a roll (what you carry, what's burning); "roll"
   * keeps the dice. "error": a turn that failed, the client's own line. "header": the scene's title
   * and hook, at the top.
   */
  kind: EntryKind | "header" | "error" | "info";
  /** Speaker id (a cast key, "gm", "player:<id>", "dice", "system"). */
  speaker: string;
  /** Display name for dialogue and the player. */
  name?: string;
  text: string;
  /** A GM reply's markup: who says each line, and its marked phrases. */
  marked?: Markup;
}

/**
 * Does a rules line have a roll in it (a check, a save, an attack, damage, a spell's burst)? The
 * rest are the rules' word on what changed: what you carry ("You no longer have your javelin"),
 * what's burning, what you are now. Those get their own mark, so the dice mean dice.
 */
export function isRoll(text: string): boolean {
  return /\d+\s*[+-]\s*\d+\s*=\s*-?\d+|\bvs (?:DC|AC) \d+|\b\d*d\d+\b|\btakes? \d+\b.*\bdamage\b|\bregains? \d+ HP\b|^(?:Cast|Damage|Jump|Fall|Grapple|Shove|Hit Die)\b|: unharmed by\b|\bdarts? at\b/i.test(text);
}

/** A transcript entry as a line: the rules' lines with no roll in them are news, not dice. */
export function lineOf(e: Entry): Line {
  const kind = e.kind === "roll" && !isRoll(e.text) ? "info" : e.kind;
  return { kind, speaker: e.speaker, ...(e.name !== undefined ? { name: e.name } : {}), text: e.text, ...(e.markup ? { marked: e.markup } : {}) };
}

/** The transcript's lines: the scene's heading, every entry, and a failed turn's word. */
export function linesOf(view: SceneView): Line[] {
  return [
    { kind: "header", speaker: "system", name: view.title, text: view.hook ?? "" },
    ...view.entries.map(lineOf),
    ...(view.failed ? [{ kind: "error" as const, speaker: "system", text: `The GM lost the thread (${view.failed}). /retry carries the turn on from where it got to.` }] : []),
  ];
}

/** The reply being written, as the line the transcript draws with a cursor after it. */
export function liveOf(view: SceneView): Line | undefined {
  const d = view.draft;
  return d ? { kind: d.kind, speaker: d.speaker, ...(d.name !== undefined ? { name: d.name } : {}), text: d.text, ...(d.markup ? { marked: d.markup } : {}) } : undefined;
}

/** Is this speaker the player (the prototype's "player", the simulation's "player:<id>", the markup's "you")? */
export const isPlayer = (speaker: string | undefined) => speaker === "you" || speaker === "player" || !!speaker?.startsWith("player:");
