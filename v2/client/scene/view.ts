// New, with the prototype's src/app/game.ts:98-114 (Line, less look and scene), :163-170 (isRoll) and :1330-1339 (lineOf and header, as linesOf and liveOf) at 44c6d4a.
import type { Markup } from "../../shared/markup.ts";
import type { Suggestion } from "../../shared/protocol/ai.ts";

export type { Suggestion };

/**
 * The scene screen's view model: everything it draws, made from the rows the client subscribes to
 * (the scene's `transcript` entries, the `reply_draft` the GM's text grows in, the `turn` row's
 * phase and note, the lines suggested after a reply) and the names and looks of who's there. The
 * screen and the headless client hold nothing else about the game.
 */

/**
 * A turn's phase, as the `turn` row has it; "idle" before the scene's first line. "noting": all in
 * but the notes on the reply's marks, which the GM is still writing. The turn ends when they're in,
 * so a line said meanwhile waits for them; the player may type, as while the world settles.
 */
export type Phase = "idle" | "queued" | "deciding" | "replying" | "settling" | "noting" | "done" | "failed";

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
  /**
   * Which try at the reply this is, and how far it's got: the draft's identity. A reply the AI
   * service lost is written again from the start as the next attempt, so its text may shrink.
   */
  attempt: number;
  seq: number;
}

/** Someone in the scene, as the player knows them: by the name they've heard (or what they're called), in their look's colour. */
export interface Person { key: string; name: string; color?: string }

export interface SceneView {
  /** The scene's title, the time of day in a word, and the line under the title (the hook, or the lead that brought them). */
  title: string;
  time?: string;
  hook?: string;
  /** The game's number: what a second terminal gives --join to watch it. */
  game: string;
  /** The character whose scene it is: the one who has the lead, with their sheet's status line (HP, slots). */
  player: { name: string; status?: string };
  /** Who has the lead, when this client is a spectator's: its box never opens. */
  watching?: string;
  /** Who's on stage, by their key (the speaker in markup and dialogue). */
  present: Person[];
  entries: Entry[];
  draft?: Draft;
  phase: Phase;
  /** The turn the phase is of (its n: 0 is the opening); none before the first. */
  turn?: number;
  /** The player may say a line now: they have the lead, the scene is live (or winding down), and no turn is queued, deciding or replying. */
  mayType: boolean;
  /** The scene has ended: there's nothing more to say in it. */
  over: boolean;
  /** A reply has closed the scene, which ends once the world has settled behind it: nothing more is said in it meanwhile. */
  ending?: boolean;
  /** The connection to the server has stopped trying, for good (the note says why, and what to do): the box stays shut. */
  cutOff?: boolean;
  /** The words of the last move the simulation refused (a SenderError's Refusal text), until the next move. */
  refusal?: string;
  /** What the game is waiting on: the AI service, which hasn't answered and is being asked again (`turn.note`), or the server itself, while the connection's down. */
  note?: string;
  /** Why the turn failed (`turn.error`), when it has: a retry is offered. */
  failed?: string;
  /**
   * The lines suggested for this moment (to say, to do, a risky try, a way out), in order: only for
   * the one who has the lead, with them on, and only the latest turn's. None otherwise.
   */
  suggestions: Suggestion[];
  /** Lines for this moment are on their way (asked for, or the reply they follow is): the screen keeps their rows meanwhile. */
  suggestionsComing: boolean;
  /** This player's own setting: the suggested lines on (the default) or off. */
  suggestionsOn: boolean;
  /** The GM is still writing the notes on the shown turn's reply: its marks come with them. */
  notesComing: boolean;
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
    ...(view.failed !== undefined ? [{ kind: "error" as const, speaker: "system", text: failedLine(view.failed, view.watching) }] : []),
  ];
}

/** Why a turn failed, as the simulation put it, and what can be done: the one who has the lead can carry it on. */
function failedLine(why: string, watching: string | undefined): string {
  const retry = watching ? `${watching} can /retry it.` : "/retry carries the turn on from where it got to.";
  return `${sentence(why)} ${retry}`;
}

/** Words as a sentence: a capital first, a stop last. */
function sentence(words: string): string {
  const said = words.trim() || "The GM lost the thread";
  return `${said[0]!.toUpperCase()}${said.slice(1)}${/[.!?…)]$/.test(said) ? "" : "."}`;
}

/** The reply being written, as the line the transcript draws with a cursor after it (its attempt and seq aren't drawn). */
export function liveOf(view: SceneView): Line | undefined {
  const d = view.draft;
  return d ? { kind: d.kind, speaker: d.speaker, ...(d.name !== undefined ? { name: d.name } : {}), text: d.text, ...(d.markup ? { marked: d.markup } : {}) } : undefined;
}

/** Is this speaker the player (the prototype's "player", the simulation's "player:<id>", the markup's "you")? */
export const isPlayer = (speaker: string | undefined) => speaker === "you" || speaker === "player" || !!speaker?.startsWith("player:");
