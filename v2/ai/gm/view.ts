import type { Backstory } from "../docs/types.ts";
import type { RollResult } from "../../shared/dice.ts";
import type { GmState, OpenedNote, PathStep, ScenePatch, SceneStatus } from "../../shared/gm/state.ts";
import type { Markup } from "../../shared/markup.ts";
import type { DecideRequest, Entry, OpenRequest, ReplyRequest, SettleRequest, SheetRow } from "../../shared/protocol/ai.ts";
import { unnamed } from "../../shared/scene/names.ts";
import type { Scene, Skill } from "../../shared/scene/types.ts";
import { keysFor, rowsToWorld, type PlaceRows } from "../../shared/world/rows.ts";
import type { SceneWorld } from "../../shared/world/scene-world.ts";

/**
 * The request as the GM code copied from the prototype reads it (gm-port §3): a TurnView has the
 * fields of the prototype's SessionState that code reads, under the same names, so the copies keep
 * their bodies and only their inputs change. It's built afresh from each request and thrown away
 * with it; where a copied body writes to it (the repeat guard, disclosure's notes), the endpoint
 * sends back what changed.
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
  /** Present when the sheet is a ready-made build: then the table rules are D&D's (sceneBrief), and the GM hears the character's state. */
  rules?: { status?: string; aliases?: Record<string, string> };

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

  // Later verticals': always empty in V0, read by the copied code.
  canon: string[];
  notes: string | null;
  whispers: GmState["whispers"];
  patches: ScenePatch[];
  entered: string[];
  absent: string[];
  rulings: Array<{ turn: number; act: string; went: "success" | "failure"; roll?: RollResult; changed: string }>;
  fought: string[];
  guard?: Record<string, { stage: string; turn: number }>;
  history: Array<{ sceneId: string; exitId: string; summary: string; facts?: string[]; lastMoments?: string[]; journal?: string[] }>;
  adjustments?: string[];
  owed?: Array<{ from: string; id: string; essential: { things?: string[] } }>;

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

export const turnSource = (req: DecideRequest | ReplyRequest | SettleRequest): ViewSource => ({ game: req.game.id, scene: req.turn.scene, pc: req.turn.pc, gm: req.turn.gm, transcript: req.turn.transcript, world: req.turn.world, party: req.turn.party });

/**
 * The view of a request: its bookkeeping copied (the view may be written to), its world rebuilt, its
 * first sheet the player, with their backstory from character creation when they wrote one (the
 * brief's "who they are" and the player's doc read it).
 */
export function viewOf(source: ViewSource, scene: Scene): TurnView {
  const sheet = source.party[0]!;
  const gm = structuredClone(source.gm);
  const view: TurnView = {
    id: source.game, sceneId: source.scene.key, turn: source.scene.turn,
    player: playerOf(sheet),
    beat: gm.beat, turnsInBeat: gm.turnsInBeat, path: gm.path, established: gm.established, landed: gm.landed, hinted: gm.hinted,
    memory: { opened: gm.opened },
    ...(gm.endingLead ? { endingLead: gm.endingLead } : {}), ...(gm.pendingExit ? { pendingExit: gm.pendingExit } : {}),
    ...(gm.closing ? { closing: gm.closing } : {}), ...(gm.ended ? { ended: gm.ended } : {}), ...(gm.sceneStatus ? { sceneStatus: gm.sceneStatus } : {}),
    oocTurns: gm.oocTurns, pressureOffered: gm.pressureOffered, ...(gm.repeated !== undefined ? { repeated: gm.repeated } : {}),
    canon: gm.canon, notes: gm.notes, whispers: gm.whispers, patches: gm.patches, entered: gm.entered, absent: gm.absent,
    rulings: [], fought: [], history: [],
    transcript: source.transcript.map(entryOf),
    world: rowsToWorld(source.world, keysFor(source.world.place.key, source.scene.key, source.pc)),
  };
  // As the prototype sets them at each turn's start (engine.ts:470): what the player calls those whose names they haven't heard.
  if (sheet.build) view.rules = { ...(sheet.status ? { status: sheet.status } : {}), aliases: unnamed(scene, view) };
  return view;
}

/** The player as the prototype's session has them: a backstory only when there's one written (createSession, engine.ts:111). */
function playerOf(sheet: SheetRow): TurnView["player"] {
  return {
    name: sheet.name, concept: sheet.concept, modifiers: { ...sheet.skills }, ...(sheet.build ? { build: sheet.build } : {}),
    ...(sheet.backstory?.text.trim() ? { backstory: sheet.backstory } : {}),
  };
}

/** A request's entry as the prototype's: the player's lines are "player"'s (V0 has one), the markup is `marked`. */
function entryOf(e: Entry): ViewEntry {
  return { turn: e.turn, speaker: e.speaker.startsWith("player:") ? "player" : e.speaker, kind: e.kind, text: e.text, ...(e.markup ? { marked: e.markup } : {}) };
}
