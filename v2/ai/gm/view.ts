import type { Backstory } from "../docs/types.ts";
import type { RulingRecord } from "../../shared/gm/consider.ts";
import type { GmState, OpenedNote, PathStep, ScenePatch, SceneStatus } from "../../shared/gm/state.ts";
import type { MarkLink, Markup } from "../../shared/markup.ts";
import type { Entry, OpenRequest, SceneContext, SheetRow } from "../../shared/protocol/ai.ts";
import type { SpellRef, WeaponRef } from "../../shared/rules/types.ts";
import { unnamed } from "../../shared/scene/names.ts";
import type { Scene, Skill } from "../../shared/scene/types.ts";
import { fullKey, keysFor, localKey, rowsToWorld, type Keys, type PlaceRows } from "../../shared/world/rows.ts";
import type { SceneWorld } from "../../shared/world/scene-world.ts";
import type { Story } from "./story.ts";

/**
 * The request as the GM code copied from the prototype reads it (gm-port §3): a TurnView has the
 * fields of the prototype's SessionState that code reads, under the same names, so the copies keep
 * their bodies and only their inputs change. It's built afresh from each request and thrown away
 * with it; where a copied body writes to it (the repeat guard, disclosure's notes), the endpoint
 * sends back what changed.
 *
 * People are named by the world's local ids in a view, as the copied code names them (the scene's
 * cast by their ids, the place's other people by theirs: "porter"), and by the game's keys in a
 * request and an answer ("granary-yard/porter"): the markup on a request's entries is mapped in
 * (localMarkup), and the markup an endpoint answers is mapped back (gameMarkup).
 */
export interface TurnView {
  /** The game's uid: whose copy of the lore the docs service reads and writes. */
  id: string;
  /** The scene's key ("hanged-clerk"). */
  sceneId: string;
  /** The turn's number in the scene (turn.n): 0 for the opening. */
  turn: number;
  /** The controller's character, from their sheet. */
  player: { name: string; concept: string; modifiers: Partial<Record<Skill, number>>; build?: string; backstory?: Backstory };
  /**
   * Present when the sheet is a ready-made build: then the table rules are D&D's (sceneBrief), the GM
   * hears the character's state, and the decider is asked what the rules resolve, offered the spells
   * ready, the weapons carried and the class features with uses (the sheet row's: world-bridge-design
   * §3.1), which the suggested lines hear of too.
   */
  rules?: { status?: string; aliases?: Record<string, string>; spells?: SpellRef[]; weapons?: WeaponRef[]; features?: Array<{ id: string; name: string; target: "self" | "creature" }> };
  /** The story the scene belongs to: the scenes the copied code reads besides this one (gm/story.ts, in place of the prototype's SCENES and sceneById). */
  story?: Story;

  // The GM's bookkeeping (GmState), as the simulation keeps it.
  beat: string;
  turnsInBeat: number;
  path: PathStep[];
  established: string[];
  landed: string[];
  hinted: string[];
  memory: { opened: OpenedNote[]; withheld?: string[] };
  endingLead?: GmState["endingLead"];
  pendingExit?: GmState["pendingExit"];
  closing?: GmState["closing"];
  ended?: GmState["ended"];
  sceneStatus?: SceneStatus;
  oocTurns: number[];
  pressureOffered: string[];
  repeated?: string;

  // The co-GM's steering and the GM's rulings (full-gm-design §4.2), as the simulation keeps them.
  canon: string[];
  notes: string | null;
  whispers: GmState["whispers"];
  patches: ScenePatch[];
  rulings: RulingRecord[];

  // Later verticals': always empty until then, read by the copied code (but absent: the cast who fled the player's violence, the world bridge's).
  entered: string[];
  absent: string[];
  fought: string[];
  guard?: Record<string, { stage: string; turn: number }>;
  history: Array<{ sceneId: string; exitId: string; summary: string; facts?: string[]; lastMoments?: string[]; journal?: string[] }>;
  adjustments?: string[];
  owed?: Array<{ from: string; id: string; essential: { things?: string[] } }>;
  /** How the story led into this scene (V3's). */
  lead?: string;
  /** What companions have told the player of themselves in talks (V11's). */
  talks?: Record<string, { count: number; told: Array<{ note: string; topic: string; turn: number }> }>;
  /** The lines offered last in this scene (only their words are read: none of them again). */
  suggestions?: { scene: string; turn: number; lines: Array<{ kind?: string; text: string }> };

  /** The scene's entries as the prototype has them: the player's lines are "player"'s, the markup is `marked`. */
  transcript: ViewEntry[];
  /** The place, rebuilt from its rows, the controller's character as "player". */
  world?: SceneWorld;
}

/** An entry as the copied code reads it (the prototype's Entry). */
export interface ViewEntry { turn: number; speaker: string; kind: Entry["kind"]; text: string; scene?: string; marked?: Markup }

/** What every request carries that a view is built from: the open's, or a turn's TurnContext. */
export interface ViewSource {
  game: string;
  scene: { key: string; turn: number };
  pc: string;
  gm: GmState;
  transcript: Entry[];
  world: PlaceRows;
  party: SheetRow[];
}

export const openSource = (req: OpenRequest): ViewSource => ({ game: req.game.id, scene: { key: req.scene.key, turn: 0 }, pc: req.pc, gm: req.gm, transcript: [], world: req.world, party: req.party });

/** A turn's think (its TurnContext), or a job beside a turn (the notes, the suggested lines: a SceneContext). */
export const turnSource = (req: { game: { id: string }; turn: SceneContext }): ViewSource => ({ game: req.game.id, scene: req.turn.scene, pc: req.turn.pc, gm: req.turn.gm, transcript: req.turn.transcript, world: req.turn.world, party: req.turn.party });

/** How a request's people are named in the game, and in its world: by its place, its scene and its controller's character. */
export const keysOf = (source: ViewSource): Keys => keysFor(source.world.place.key, source.scene.key, source.pc);

/**
 * The view of a request: its bookkeeping copied (the view may be written to), its world rebuilt, its
 * first sheet the player, with their backstory from character creation when they wrote one (the
 * brief's "who they are" and the player's doc read it), and the scene's story beside it.
 */
export function viewOf(source: ViewSource, scene: Scene, story?: Story): TurnView {
  const sheet = source.party[0]!;
  const gm = structuredClone(source.gm);
  const keys = keysOf(source);
  const view: TurnView = {
    id: source.game, sceneId: source.scene.key, turn: source.scene.turn,
    player: playerOf(sheet),
    beat: gm.beat, turnsInBeat: gm.turnsInBeat, path: gm.path, established: gm.established, landed: gm.landed, hinted: gm.hinted,
    memory: { opened: gm.opened },
    ...(gm.endingLead ? { endingLead: gm.endingLead } : {}), ...(gm.pendingExit ? { pendingExit: gm.pendingExit } : {}),
    ...(gm.closing ? { closing: gm.closing } : {}), ...(gm.ended ? { ended: gm.ended } : {}), ...(gm.sceneStatus ? { sceneStatus: gm.sceneStatus } : {}),
    oocTurns: gm.oocTurns, pressureOffered: gm.pressureOffered, ...(gm.repeated !== undefined ? { repeated: gm.repeated } : {}),
    canon: gm.canon, notes: gm.notes, whispers: gm.whispers, patches: gm.patches, entered: gm.entered, absent: gm.absent,
    // (A request a job stored before the rulings had a column has none.)
    rulings: gm.rulings ?? [], fought: [], history: [],
    transcript: source.transcript.map(e => entryOf(e, keys)),
    world: rowsToWorld(source.world, keys),
    ...(story ? { story } : {}),
  };
  // As the prototype sets them at each turn's start (engine.ts:470): what the player calls those whose
  // names they haven't heard; and what the rules keep ready, the sheet's spells, weapons and features.
  if (sheet.build) {
    view.rules = {
      ...(sheet.status ? { status: sheet.status } : {}), aliases: unnamed(scene, view),
      ...(sheet.spells ? { spells: sheet.spells } : {}), ...(sheet.weapons ? { weapons: sheet.weapons } : {}), ...(sheet.features ? { features: sheet.features } : {}),
    };
  }
  return view;
}

/** The player as the prototype's session has them: a backstory only when there's one written (createSession, engine.ts:111). */
function playerOf(sheet: SheetRow): TurnView["player"] {
  return {
    name: sheet.name, concept: sheet.concept, modifiers: { ...sheet.skills }, ...(sheet.build ? { build: sheet.build } : {}),
    ...(sheet.backstory?.text.trim() ? { backstory: sheet.backstory } : {}),
  };
}

/** A request's entry as the prototype's: the player's lines are "player"'s (V0 has one), the markup is `marked`, by the world's ids. */
function entryOf(e: Entry, keys: Keys): ViewEntry {
  return { turn: e.turn, speaker: e.speaker.startsWith("player:") ? "player" : e.speaker, kind: e.kind, text: e.text, ...(e.markup ? { marked: localMarkup(e.markup, keys) } : {}) };
}

/** Markup by the game's keys as the copied code reads it: speakers and the people marks link to by the world's ids. Cards are dropped: nothing in the copied code reads one. */
export function localMarkup(markup: Markup, keys: Keys): Markup {
  const local = (key: string) => (key === "you" ? key : localKey(key, keys));
  return {
    speech: markup.speech.map(s => (s.speaker ? { ...s, speaker: local(s.speaker) } : s)),
    marks: markup.marks.map(({ card: _, ...m }) => (m.link?.kind === "person" ? { ...m, link: { kind: "person" as const, id: local(m.link.id) } } : m)),
  };
}

/**
 * Markup by the world's ids, as the game keeps it: the scene's cast by their ids, the place's other
 * people under the place ("granary-yard/porter"), the player's own words "you". Someone the world
 * hasn't got (one of the cast away) keeps the id they have.
 */
export function gameMarkup(markup: Markup, scene: Scene, world: SceneWorld | undefined, keys: Keys): Markup {
  const game = (id: string) => (id === "you" || scene.cast.some(c => c.id === id) || !world?.entities[id] ? id : fullKey(id, world.entities[id], keys));
  const link = (l: MarkLink): MarkLink => (l.kind === "person" ? { kind: "person", id: game(l.id) } : l);
  return {
    speech: markup.speech.map(s => (s.speaker ? { ...s, speaker: game(s.speaker) } : s)),
    marks: markup.marks.map(m => (m.link ? { ...m, link: link(m.link) } : m)),
  };
}
