import type { Backstory } from "../docs/types.ts";
import type { RulingRecord } from "../../shared/gm/consider.ts";
import type { GmState, OpenedNote, OwedRow, PathStep, ScenePatch, TalkRecord, TwoPartState } from "../../shared/gm/state.ts";
import type { Markup } from "../../shared/markup.ts";
import type { Chapter, Entry, OpenRequest, SceneContext, SheetRow, Story as Told } from "../../shared/protocol/ai.ts";
import { isTurnKey, keyParts } from "../../shared/protocol/keys.ts";
import type { SpellRef, WeaponRef } from "../../shared/rules/types.ts";
import { unnamed } from "../../shared/scene/names.ts";
import type { Essential, Scene, Skill } from "../../shared/scene/types.ts";
import { fullKey, keysFor, localKey, rowsToWorld, type Keys, type PlaceRows } from "../../shared/world/rows.ts";
import type { Entity, SceneWorld } from "../../shared/world/scene-world.ts";
import type { Owed } from "./owed.ts";
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
 *
 * After a boundary (story-design §4.4) a view has the story so far, as the prototype's session had
 * it: the scenes played (`history`, the request's chapters), every entry of theirs before this
 * scene's on the transcript (each with its scene's key), and what the boundary handed on to this
 * scene (the adjustments, the rewritten opening, the lead, who's absent, what's owed).
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
  /** The nodes the scene has reached, in order, its start first (shared/scene/beats.ts). */
  reached: string[];
  turnsInBeat: number;
  path: PathStep[];
  established: string[];
  landed: string[];
  hinted: string[];
  memory: { opened: OpenedNote[]; withheld?: string[] };
  pendingExit?: GmState["pendingExit"];
  closing?: GmState["closing"];
  ended?: GmState["ended"];
  oocTurns: number[];
  pressureOffered: string[];
  /** A sentence the last reply repeated word for word (voice.ts gmReply, the aftermath's: set and read within one call). */
  repeated?: string;

  // The co-GM's steering and the GM's rulings (full-gm-design §4.2), as the simulation keeps them.
  canon: string[];
  notes: string | null;
  whispers: GmState["whispers"];
  patches: ScenePatch[];
  rulings: RulingRecord[];

  // What the boundary before the scene handed on, and the story so far (story-design §4.4).
  /** Cast who are away: from earlier scenes that what happened keeps away, and those who fled the player's violence (the world bridge's). */
  absent: string[];
  /** The combat exits already fought: the scene picked up after the fight. */
  fought: string[];
  /** The scenes played before this one, oldest first (the prototype's session's history). */
  history: Chapter[];
  /** Where this scene's prep no longer matches the story: these override it. */
  adjustments?: string[];
  /** The scene's opening, rewritten at the boundary to start where the story is. */
  opening?: string;
  /** What the story still owes the player from scenes already over (gm/owed.ts), its essential and its things from the request's rows. */
  owed?: Owed[];
  /** How the story led into this scene, in second-person fiction. */
  lead?: string;

  // A later vertical's: always empty until then, read by the copied code.
  entered: string[];
  // A talk's (town-design §3.6): what companions have told the player of themselves.
  /** What companions have told the player of themselves in talks between scenes, by their cast ids (the story's talk records). */
  talks?: Record<string, TalkRecord>;
  /** The lines offered last in this scene (only their words are read: none of them again). */
  suggestions?: { scene: string; turn: number; lines: Array<{ kind?: string; text: string }> };
  /** The two-part GM's (docs/two-part-design.md): each person's role, the co-GM's notes by turn, the stage it moved to, a wind-down held once. */
  twoPart: TwoPartState;

  /** The scene's entries as the prototype has them: the player's lines are "player"'s, the markup is `marked`. */
  transcript: ViewEntry[];
  /** The place, rebuilt from its rows, the controller's character as "player". */
  world?: SceneWorld;
}

/** An entry as the copied code reads it (the prototype's Entry): `scene`, an earlier scene's key, on that scene's entries. */
export interface ViewEntry { turn: number; speaker: string; kind: Entry["kind"]; text: string; scene?: string; marked?: Markup }

/** What every request carries that a view is built from: the open's, or a turn's TurnContext. */
export interface ViewSource {
  game: string;
  scene: { key: string; turn: number };
  pc: string;
  gm: GmState;
  /** This scene's entries (an opening has none; an aftermath, the scene's so far). */
  transcript: Entry[];
  world: PlaceRows;
  party: SheetRow[];
  /** The story so far as the request tells it (the scenes played, and their entries), when it does. */
  told?: Told;
}

/**
 * An open's: the opening (turn 0, no entries yet); or the scene picking up after a fight (its
 * aftermath), on a turn of its own (the key's) with the scene's transcript so far.
 */
export const openSource = (req: OpenRequest): ViewSource => ({
  game: req.game.id, scene: { key: req.scene.key, turn: req.aftermath ? turnOfKey(req.key) : 0 }, pc: req.pc, gm: req.gm,
  transcript: req.aftermath ? req.transcript ?? [] : [], world: req.world, party: req.party, told: req.story,
});

/** A turn's think (its TurnContext), or a job beside a turn (the notes, the suggested lines: a SceneContext), or after a scene (the boundary). */
export const turnSource = (req: { game: { id: string }; turn: SceneContext }): ViewSource => ({ game: req.game.id, scene: req.turn.scene, pc: req.turn.pc, gm: req.turn.gm, transcript: req.turn.transcript, world: req.turn.world, party: req.turn.party, told: req.turn.story });

/** The turn a key names (<uid>:s<scene>:t<n>:<step>), or 0. */
function turnOfKey(key: string): number {
  const parts = keyParts(key);
  return parts && isTurnKey(parts) ? parts.turn : 0;
}

/** Where an essential of the story's is (the scene it was placed in, and its id there): the campaign's, for what's owed. */
export type EssentialOf = (from: string, id: string) => Essential | undefined;

/** How a request's people are named in the game, and in its world: by its place, its scene and its controller's character. */
export const keysOf = (source: ViewSource): Keys => keysFor(source.world.place.key, source.scene.key, source.pc);

/**
 * The view of a request: its bookkeeping copied (the view may be written to), its world rebuilt, its
 * first sheet the player, with their backstory from character creation when they wrote one (the
 * brief's "who they are" and the player's doc read it), and the scene's story beside it. After a
 * boundary, the story so far: the chapters as its history, the earlier scenes' entries before this
 * scene's, and what was handed on, what's owed with its essential (`essentialOf`: none without it).
 */
export function viewOf(source: ViewSource, scene: Scene, story?: Story, essentialOf?: EssentialOf): TurnView {
  const sheet = source.party[0]!;
  const gm = structuredClone(source.gm);
  const keys = keysOf(source);
  const world = rowsToWorld(source.world, keys);
  const view: TurnView = {
    id: source.game, sceneId: source.scene.key, turn: source.scene.turn,
    player: playerOf(sheet),
    // (A request a job stored before M2 has no nodes reached nor a two-part GM: its beat stands for them.)
    beat: gm.beat, reached: gm.reached?.length ? gm.reached : [gm.beat], twoPart: gm.twoPart ?? { roles: {}, notes: [] },
    turnsInBeat: gm.turnsInBeat, path: gm.path, established: gm.established, landed: gm.landed, hinted: gm.hinted,
    memory: { opened: gm.opened, ...(gm.withheld?.length ? { withheld: gm.withheld } : {}) },
    ...(gm.pendingExit ? { pendingExit: gm.pendingExit } : {}),
    ...(gm.closing ? { closing: gm.closing } : {}), ...(gm.ended ? { ended: gm.ended } : {}),
    oocTurns: gm.oocTurns, pressureOffered: gm.pressureOffered,
    canon: gm.canon, notes: gm.notes, whispers: gm.whispers, patches: gm.patches, entered: gm.entered,
    // (A request a job stored before the rulings had a column has none, and one stored before the story unit none of what a boundary hands on.)
    rulings: gm.rulings ?? [], absent: gm.absent ?? [], fought: gm.fought ?? [],
    history: structuredClone(source.told?.history ?? []), adjustments: gm.adjustments ?? [],
    ...(gm.opening !== undefined ? { opening: gm.opening } : {}), ...(gm.lead !== undefined ? { lead: gm.lead } : {}),
    owed: owedOf(gm.owed ?? [], world, keys, essentialOf),
    // The story's talk records.
    ...(source.told?.talks && Object.keys(source.told.talks).length ? { talks: structuredClone(source.told.talks) } : {}),
    transcript: [...(source.told?.earlier ?? []), ...source.transcript].map(e => entryOf(e, keys)),
    // A talk has no world (the prototype's has none): the rows it's sent are the town's own place's.
    ...(scene.companion ? {} : { world }),
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

/** A request's entry as the prototype's: the player's lines are "player"'s (V0 has one), the markup is `marked`, by the world's ids; an earlier scene's has its key. */
function entryOf(e: Entry, keys: Keys): ViewEntry {
  return { turn: e.turn, speaker: e.speaker.startsWith("player:") ? "player" : e.speaker, kind: e.kind, text: e.text, ...(e.scene ? { scene: e.scene } : {}), ...(e.markup ? { marked: localMarkup(e.markup, keys) } : {}) };
}

/**
 * What the story still owes, as the copied code has it (the prototype's Owed): its essential, as the
 * scene it was placed in wrote it, and its things, those of this place that its rows name (by their
 * entity keys). One whose essential the campaign hasn't got is left out.
 */
function owedOf(rows: OwedRow[], world: SceneWorld, keys: Keys, essentialOf: EssentialOf | undefined): Owed[] {
  return rows.flatMap(row => {
    const essential = essentialOf?.(row.from, row.id);
    if (!essential) return [];
    const things = row.things.map(key => world.entities[localKey(key, keys)]).filter((e): e is Entity => !!e).map(e => structuredClone(e));
    return [{
      from: row.from, id: row.id, essential, ...(row.hinted ? { hinted: true } : {}), ...(things.length ? { things } : {}),
      ...(row.holders.length ? { holders: [...row.holders] } : {}), ...(row.where !== undefined ? { where: row.where } : {}),
    }];
  });
}

/** Markup by the game's keys as the copied code reads it: the speakers by the world's ids. */
export function localMarkup(markup: Markup, keys: Keys): Markup {
  const local = (key: string) => (key === "you" ? key : localKey(key, keys));
  return { speech: markup.speech.map(s => (s.speaker ? { ...s, speaker: local(s.speaker) } : s)) };
}

/**
 * Markup by the world's ids, as the game keeps it: the scene's cast by their ids, the place's other
 * people under the place ("granary-yard/porter"), the player's own words "you". Someone the world
 * hasn't got (one of the cast away) keeps the id they have.
 */
export function gameMarkup(markup: Markup, scene: Scene, world: SceneWorld | undefined, keys: Keys): Markup {
  const game = (id: string) => (id === "you" || scene.cast.some(c => c.id === id) || !world?.entities[id] ? id : fullKey(id, world.entities[id], keys));
  return { speech: markup.speech.map(s => (s.speaker ? { ...s, speaker: game(s.speaker) } : s)) };
}
