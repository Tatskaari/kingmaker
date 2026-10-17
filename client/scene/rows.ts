import type { Markup, Speech } from "../../shared/markup.ts";
import type { Game, Look, NameView, OnStage, Player, ReplyDraft, Scene, SceneSuggestion, Sheet, Transcript, Turn } from "../module_bindings/types.ts";
import { colorOf } from "../theme.ts";
import { TIME_WORDS } from "../creation/words.ts";
import { storyViewOf, type StoryRows } from "../story/rows.ts";
import { placeViewOf, type LeadSheet, type PlaceTables } from "./place-rows.ts";
import type { Draft, Entry, EntryKind, Person, Phase, SceneView, Suggestion } from "./view.ts";

/**
 * The scene's view from the rows the client holds (v0-design §7, v5-design §3.9): the scene, its
 * transcript, the draft the GM's text grows in, its turns, who's on stage, the names and looks the
 * player knows them by, and the lines suggested after the last reply. Pure: the connection keeps
 * the rows and calls this whenever one changes, and the screen, the headless client and the tests
 * share it. The rows are the generated bindings' types, narrowed to the columns read here, so a
 * change to the schema shows up in the type check.
 */

export interface SceneRows {
  /** This client's player: my_seat's playerId. */
  me: bigint;
  game: Pick<Game, "id" | "time">;
  scene: Pick<Scene, "id" | "title" | "hook" | "status" | "controllerId" | "turnId" | "turns"> & Partial<Pick<Scene, "time" | "kind">>;
  players: Array<Pick<Player, "id" | "name" | "suggestions">>;
  /** Each player's sheet: its status line; the lead's spells too, and what the rules say of them, for the place's menu. */
  sheets: Array<Pick<Sheet, "playerId" | "statusLine"> & LeadSheet>;
  transcript: Array<Pick<Transcript, "seq" | "turn" | "speaker" | "kind" | "text" | "markup">>;
  drafts: Array<Pick<ReplyDraft, "turnId" | "speaker" | "text" | "markup" | "attempt" | "seq">>;
  turns: Array<Pick<Turn, "id" | "n" | "phase" | "note" | "error" | "suggest">>;
  onStage: Array<Pick<OnStage, "entityId" | "role">>;
  names: Array<Pick<NameView, "entityId" | "key" | "name">>;
  /** The place's looks: a cast member's colour, or a thing's invented look (town-design §3.7: its fg a colour's name, not the cast's). */
  looks: Array<Pick<Look, "entityId" | "fg"> & Partial<Pick<Look, "invention">>>;
  /** The scene's suggested lines (scene_suggestion): one set at a time, each row its turn and its place in the set. */
  suggestions: Array<Pick<SceneSuggestion, "sceneId" | "turn" | "ord" | "kind" | "text">>;
  /** The game's story around the scene (story-design §4.5): the boundary, the lead, the notebook's tables, the costs. None until they've come. */
  story?: StoryRows;
  /** The scene's place and its world's rows (the world bridge's §3.5): what the side panel draws. None until they've come. */
  place?: PlaceTables;
  /** The game is walked on a map (the host has an explore row, map-design §3.1): a scene that's over goes back to it. */
  onMap?: boolean;
  /** The words of the last move the simulation refused, until the next move. */
  refusal?: string;
  /** What's wrong with the connection to the server, while something is (it's reconnecting). */
  trouble?: string;
  /** The connection has stopped trying, for good (the trouble says why, and what to do): nothing more can be said. */
  cutOff?: boolean;
}

type TurnRow = SceneRows["turns"][number];

const PHASES: readonly Phase[] = ["queued", "deciding", "considering", "replying", "settling", "done", "failed"];
const KINDS: readonly EntryKind[] = ["player", "narration", "dialogue", "roll", "system"];
const SUGGESTION_KINDS: ReadonlyArray<Suggestion["kind"]> = ["say", "do", "try", "leave"];
/** The phases the player may speak in: before the first line, and once the reply is final (the world settles behind it). */
const OPEN: readonly Phase[] = ["idle", "settling", "done"];
/** The phases of a turn whose reply hasn't come yet: lines will follow it. */
const BEFORE_REPLY: readonly string[] = ["queued", "deciding", "considering", "replying"];

export function sceneViewOf(rows: SceneRows): SceneView {
  const { lease, newest } = turnsOf(rows);
  const shown = shownTurn(lease, newest);
  const phase = shown && PHASES.includes(shown.phase as Phase) ? shown.phase as Phase : "idle";
  const draft = draftOf(rows, lease);

  const lead = rows.players.find(p => p.id === rows.scene.controllerId);
  const watching = rows.scene.controllerId === rows.me ? undefined : lead?.name ?? "Someone else";
  const status = lead ? rows.sheets.find(s => s.playerId === lead.id)?.statusLine : undefined;

  const playing = rows.scene.status === "live" || rows.scene.status === "closing";
  const mayType = !watching && playing && OPEN.includes(phase) && !rows.cutOff;
  // A reply closed the scene: it ends once its settle is done (or, if that fails, once /retry has done it).
  const ending = rows.scene.status === "ending" && phase !== "failed";

  // The scene's own time of day (the game's moves on with the story once it's over), in a word: "Evening".
  const time = rows.scene.time ?? rows.game.time;
  const name = (key: string) => rows.names.find(n => n.key === key)?.name;
  return {
    sceneId: String(rows.scene.id),
    title: rows.scene.title, ...(time ? { time: timeWord(time) } : {}), ...(rows.scene.hook ? { hook: rows.scene.hook } : {}),
    game: String(rows.game.id),
    player: { name: lead?.name ?? "", ...(status ? { status } : {}) },
    ...(watching ? { watching } : {}),
    present: presentOf(rows),
    entries: entriesOf(rows),
    ...(draft ? { draft } : {}),
    phase, ...(shown ? { turn: shown.n } : {}), mayType,
    over: rows.scene.status === "ended",
    ...(rows.scene.status === "fighting" ? { fighting: true } : {}),
    ...(ending ? { ending } : {}),
    ...(rows.cutOff ? { cutOff: true } : {}),
    ...(rows.refusal ? { refusal: rows.refusal } : {}),
    ...noteOf(rows, lease, phase),
    ...(phase === "failed" ? { failed: lease?.error ?? "" } : {}),
    ...suggestionsOf(rows, lease),
    ...(rows.story ? { story: storyViewOf(rows.story, rows.scene.controllerId, name) } : {}),
    ...placeOf(rows),
    ...(rows.onMap ? { onMap: true } : {}),
    ...(rows.scene.kind === "talk" ? { talk: true } : {}),
  };
}

/** The scene's place, its world rebuilt from its rows (scene/place-rows.ts), when they've come and make one. */
function placeOf(rows: SceneRows): Pick<SceneView, "place"> {
  if (!rows.place) return {};
  const lead = rows.scene.controllerId;
  // The scene's own time (story-design §4.1: an ended scene held on screen keeps its light as the story moves on), else the game's.
  const place = placeViewOf({ tables: rows.place, time: rows.scene.time ?? rows.game.time, lead, names: rows.names, sheet: rows.sheets.find(s => s.playerId === lead) });
  return place ? { place } : {};
}

/**
 * The lines suggested for this moment (v5-design §3.9), and whether they're on their way: only for
 * the one who has the lead, with the setting on, while the scene is played. The moment is the
 * latest turn (its n is scene.turns): a line just said leaves the last set behind at once, and its
 * rows go, while the set for it comes. Lines are on their way while the latest turn's reply is (it
 * has lines after it), or once they've been asked for: the opening's too, so the screen keeps their
 * rows from the start, as the prototype's does. A line queued behind a turn that failed waits for
 * the retry, and nothing is on its way meanwhile.
 */
function suggestionsOf(rows: SceneRows, lease: TurnRow | undefined): Pick<SceneView, "suggestions" | "suggestionsComing" | "suggestionsOn"> {
  const suggestionsOn = rows.players.find(p => p.id === rows.me)?.suggestions ?? true;
  const staged = rows.scene.status === "opening" || rows.scene.status === "live" || rows.scene.status === "closing";
  if (rows.scene.controllerId !== rows.me || !suggestionsOn || !staged) return { suggestions: [], suggestionsComing: false, suggestionsOn };

  const latest = rows.turns.find(t => t.n === rows.scene.turns);
  const suggestions = rows.suggestions.filter(s => s.sceneId === rows.scene.id && s.turn === rows.scene.turns)
    .sort((a, b) => a.ord - b.ord)
    .map(s => ({ kind: SUGGESTION_KINDS.includes(s.kind as Suggestion["kind"]) ? s.kind as Suggestion["kind"] : "say", text: s.text }));
  const replyComing = !!latest && BEFORE_REPLY.includes(latest.phase) && !(latest.phase === "queued" && lease?.phase === "failed");
  return { suggestions, suggestionsComing: replyComing || latest?.suggest === "coming", suggestionsOn };
}

/**
 * The turn that holds the scene's lease (scene.turnId: in flight, or failed and waiting for a
 * retry), and the newest by n: a line said while the last turn settles waits behind it, queued.
 */
function turnsOf(rows: SceneRows): { lease?: TurnRow; newest?: TurnRow } {
  const lease = rows.scene.turnId === undefined ? undefined : rows.turns.find(t => t.id === rows.scene.turnId);
  const newest = rows.turns.reduce<TurnRow | undefined>((a, t) => (!a || t.n > a.n ? t : a), undefined);
  return { ...(lease ? { lease } : {}), ...(newest ? { newest } : {}) };
}

/**
 * The turn whose phase the screen shows: a failed one, until it's retried; a queued line, so the
 * box stays shut behind it as the simulation would refuse a second (turn_in_flight); else the turn
 * in flight, or the last one. None before the scene's first turn: "idle".
 */
function shownTurn(lease: TurnRow | undefined, newest: TurnRow | undefined): TurnRow | undefined {
  if (lease?.phase === "failed") return lease;
  if (newest?.phase === "queued") return newest;
  return lease ?? newest;
}

/** What the game is waiting on: the server, while the connection's down, else the AI service (the turn's note, until it fails). */
function noteOf(rows: SceneRows, lease: TurnRow | undefined, phase: Phase): { note?: string } {
  const note = rows.trouble ?? (phase === "failed" ? undefined : lease?.note);
  return note ? { note } : {};
}

/** The reply being written for the turn in flight: narration when it's the GM's, else dialogue. A draft of any other turn is stale. */
function draftOf(rows: SceneRows, lease: TurnRow | undefined): Draft | undefined {
  const d = lease ? rows.drafts.find(r => r.turnId === lease.id) : undefined;
  if (!d) return undefined;
  const kind = d.speaker === "gm" ? "narration" as const : "dialogue" as const;
  const name = kind === "dialogue" ? nameOf(rows, d.speaker) : undefined;
  const markup = markupOf(d.markup);
  return { speaker: d.speaker, kind, ...(name ? { name } : {}), text: d.text, ...(markup ? { markup } : {}), attempt: d.attempt, seq: d.seq };
}

/** The transcript in order, a player's line and a line of dialogue named as the player knows the speaker. */
function entriesOf(rows: SceneRows): Entry[] {
  return [...rows.transcript].sort((a, b) => a.seq - b.seq).map(t => {
    const kind = KINDS.includes(t.kind as EntryKind) ? t.kind as EntryKind : "system";
    const name = kind === "player" || kind === "dialogue" ? nameOf(rows, t.speaker) : undefined;
    const markup = markupOf(t.markup);
    return { turn: t.turn, speaker: t.speaker, kind, ...(name ? { name } : {}), text: t.text, ...(markup ? { markup } : {}) };
  });
}

/** Who's on stage besides the one who has the lead, by the names the player knows (my_names), in their look's colour or a hue of their own. */
function presentOf(rows: SceneRows): Person[] {
  return rows.onStage.filter(s => s.role !== "controller").flatMap(s => {
    const known = rows.names.find(n => n.entityId === s.entityId);
    if (!known) return [];
    return [{ key: known.key, name: known.name, color: rows.looks.find(l => l.entityId === s.entityId && !l.invention)?.fg ?? colorOf(known.key) }];
  });
}

/** The name a speaker goes by: a player's character, or whoever the player knows by that key. */
function nameOf(rows: SceneRows, speaker: string): string | undefined {
  const player = /^player:(\d+)$/.exec(speaker);
  if (player) return rows.players.find(p => p.id === BigInt(player[1]!))?.name;
  return rows.names.find(n => n.key === speaker)?.name;
}

/** A markup column (JSON): who says each line; nothing when it's missing or unreadable, and the words are drawn plain. (A row from before M2 may have notes on marks too: they're not the game's now, and not read.) */
export function markupOf(json: string | undefined): Markup | undefined {
  const parsed = jsonObject(json);
  if (!parsed) return undefined;
  const speech = Array.isArray(parsed.speech) ? parsed.speech.filter(isSpan) as Speech[] : [];
  return { speech };
}

function jsonObject(json: string | undefined): Partial<Record<keyof Markup, unknown>> | undefined {
  if (!json) return undefined;
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === "object" ? value as Partial<Record<keyof Markup, unknown>> : undefined;
  } catch {
    return undefined;
  }
}

/** A span of the text with numbers for its edges. */
const isSpan = (s: unknown): boolean => !!s && typeof (s as Speech).start === "number" && typeof (s as Speech).end === "number";

/** A time of day as the frame's title has it (the prototype's TIME_WORDS, to its first comma): "Morning"; "The morning of the Assembly". */
const timeWord = (time: string) => (TIME_WORDS[time] ?? `${time[0]!.toUpperCase()}${time.slice(1)}`).split(",")[0]!;
