import type { RollResult } from "../dice.ts";
import type { CombatState } from "./combat.ts";
import type { Brawl, Threat } from "../rules/types.ts";
import type { Path } from "../scene/document.ts";
import type { Beat, Essential, Scene, Transition } from "../scene/types.ts";

/**
 * The GM's bookkeeping for a scene: where it stands in its beats, what's been settled, the endings
 * coming, what the story handed on to it at the boundary before it (story-design §4.1), a talk's own
 * state (town-design §3.6), and the two-part GM's (its co-GM's roles and notes). The simulation
 * keeps it in the private `gm_state` table, a column a field, and sends it whole in every request
 * to the AI service. The field names are the prototype's (src/runtime/session.ts), so the code copied from it
 * reads this unchanged.
 */
export interface GmState {
  /** Where the scene is: its stage (shared/scene/beats.ts stageOf), the latest it reached of its start and its events. */
  beat: string;
  /** The nodes the scene has reached, in order: its start first, then each beat and ending a route took it to (beats.ts takeRoute). */
  reached: string[];
  turnsInBeat: number;
  path: PathStep[];
  /** The facts settled so far, as their sentences (content-world A7). */
  established: string[];
  /** The essentials the player has come across (judged after each reply). */
  landed: string[];
  /** The essentials a reply has already pointed towards: a nudge is given once, not repeated. */
  hinted: string[];
  /** The story reached an ending; the next player turn is the wind-down, then the scene closes. */
  closing?: { exitId: string; turn: number };
  /** The ending this turn's reply closes the scene on. */
  ended?: { exitId: string; turn: number };
  /** Beats whose pressure has already been offered to the GM (it fires once). */
  pressureOffered: string[];
  /** The scene's prep as play has changed it: what the boundary brought on to it, a talk's card and its discovery filled or dropped. */
  patches: ScenePatch[];
  // What the boundary before the scene handed on (story-design §4.1; the prototype's session.ts:
  // 278-331), written as the scene waits: each is the scene's own from then on.
  /** Where the scene's prep no longer matches the story: what's true instead (the boundary's verdict). */
  adjustments: string[];
  /** The scene's opening, rewritten for where the story is (none: the author's stands). */
  opening?: string;
  /** How the story led the player here, in second-person fiction (none: the hook says it). */
  lead?: string;
  /** What the story still owes the player from scenes already over: missed essentials, and where their things are now. */
  owed: OwedRow[];
  /** The combat exits already fought: the scene picked up after the fight (the stand-in's, until fights land). */
  fought: string[];
  // The rules in a scene (world-bridge-design §3.3): what the player's violence and the last reply
  // left hanging, under the prototype's names (src/runtime/session.ts:300-311).
  /** A blow or a danger the last reply left hanging over the player: it lands as their next turn starts, which takes it off. */
  threat?: Threat;
  /** The turn a hold caught the player: it stands with no more saving throws until they break free or the story lets them go. */
  held?: number;
  /** A fight the player's violence started: who goes for the player, who's with them, who fled. */
  brawl?: Brawl;
  /** Cast who are away: those from earlier scenes that what happened keeps away (the boundary's presence), and those who fled the player's violence or ran for help (the world bridge's). */
  absent: string[];
  /** Cast who came on by a route (V0's copied code reads it): no column yet, so always empty. */
  entered: string[];
  // A talk with a companion between scenes (town-design §3.6; the prototype's session.ts:268, 333),
  // under the prototype's names: absent in a scene that has none.
  /** A talk's own: with whom (their cast id), where and when, and the one thing they might open up about this time. */
  talk?: TalkState;
  // The two-part GM's (docs/two-part-design.md): what its co-GM keeps between turns.
  /** Each person's role as the co-GM last set it, the co-GM's notes for the turns after it, the stage it last moved the scene to (the next reply shows it), and a wind-down held once. */
  twoPart: TwoPartState;
  /** A fight in the conversation, while it's on (docs/combat-gm.md): who's in it in initiative order, the round, whose turn. */
  combat?: CombatState;
}

/** A person's conversation role as the two-part GM's co-GM keeps it (its update_character_role's fields). */
export interface TwoPartRole { status: string; mental_state: string; conversation_role: string }

/**
 * The two-part GM's own (docs/two-part-design.md "Where the scene is"): each person's role by cast id,
 * the co-GM's note for each turn (`turn`: the one it's for), the stage the scene moved to since the
 * last reply (shown "seen arriving" in the next), and whether the wind-down has waited once.
 */
export interface TwoPartState {
  roles: Record<string, TwoPartRole>;
  notes: Array<{ turn: number; text: string }>;
  moved?: string;
  held?: boolean;
}

/** How far someone had opened up about what they kept back (the old pipeline's staged secrets, in order: director.ts:1220), as a talk record from before has it. */
export type GuardStage = "surface" | "tell" | "stirred" | "torn" | "settled";
export const GUARD_STAGES: readonly GuardStage[] = ["surface", "tell", "stirred", "torn", "settled"];

/** The one thing a companion might open up about in a talk (talk.ts's confide): the note of their lore it's in, what it is in a few words, and what they'd tell. */
export interface Confide { note: string; topic: string; what: string }

/**
 * A talk in progress, as its gm_state keeps it (the prototype's TalkState less what v2 keeps
 * elsewhere: the waiting scene is its own row, never set aside; the choices are scene_suggestion rows).
 */
export interface TalkState { with: string; where: string; confide?: Confide }

/**
 * A companion's talks with the player between scenes, kept for the whole story (session.ts's
 * TalkRecord; the talk_record table): how many there have been, what they've told of themselves (each
 * note of their lore once, in the order told), and how far they'd come with what's not yet told (the
 * old pipeline's staged secrets wrote it: a talk on the two-part GM stages through the companion's
 * role and writes none, and a record from before still makes them readier: ai/gm/talk.ts).
 */
export interface TalkRecord { count: number; told: Array<{ note: string; topic: string; turn: number }>; stages?: Record<string, GuardStage> }

/**
 * Something the story still owes the player (the prototype's Owed, session.ts:154-171), as the rows
 * keep it: the scene it was placed in and its id there ("hanged-clerk", "page"); whether a reply
 * already pointed towards it; the things it's in, by their entity keys, the outermost first
 * ("granary-yard/boots", "granary-yard/ledger-page"), and who holds them (cast ids, or "player");
 * and where it is now, in a few words. Its essential is the campaign's: the AI service looks it up.
 */
export interface OwedRow { from: string; id: string; hinted: boolean; things: string[]; holders: string[]; where?: string }

/**
 * A move the scene made (a route taken, a roll, the same push again, an ending reached). Turn
 * numbers are the scene's (turn.n). `known`: how many facts had been established when it was made
 * (before its own): a record (the old co-GM's leftBehind read it, so a move of its couldn't undo
 * what was settled). `source` "repair" was the old co-GM's.
 */
export interface PathStep { turn: number; from: string; to: string; via: string; roll?: RollResult; source: "pre" | "post" | "repair"; known?: number }


/** Changes made to the scene's prep during play (a talk's, the boundary's; the old co-GM's until it went): src/runtime/session.ts:104-121. */
export interface ScenePatch {
  turn: number;
  beat?: Beat;
  transition?: { beat: string; transition: Transition };
  cast?: { id: string; secrets: string[] };
  close?: { beat: string; id: string };
  essential?: Essential;
  /**
   * A discovery as this play of the scene has it (a talk's, town-design §3.6: the template's `told`
   * filled from the talk's prep with the one thing the companion might confide): its revelation, and
   * its paths, the ways it can come out. The latest word on it wins.
   */
  fill?: { id: string; revelation: string; paths: Path[] };
  /** A node this play of the scene hasn't got, with every route into and out of it (a talk with nothing to confide this time: its `told`). */
  drop?: string;
  why: string;
}

/** A scene's bookkeeping as it opens: its start reached and its stage, nothing else yet. */
export function initialGm(scene: Pick<Scene, "start">): GmState {
  return {
    beat: scene.start, reached: [scene.start], turnsInBeat: 0, path: [], established: [], landed: [], hinted: [],
    pressureOffered: [], patches: [],
    adjustments: [], owed: [], fought: [], absent: [], entered: [],
    twoPart: { roles: {}, notes: [] },
  };
}

// ---------------------------------------------------------------------------------------------
// The gm_state row: a column a field (simulation/src/schema.ts), but `entered`. An option column is
// undefined when empty; a roll's `critical` null is an empty option; the patches are JSON, a piece
// of the scene graph in the campaign format's own shape; a threat is one object with the fields of
// both its kinds, those of the other kind empty.

export interface GmRow {
  sceneId: bigint;
  beat: string;
  turnsInBeat: number;
  path: PathRow[];
  established: string[];
  landed: string[];
  hinted: string[];
  closing: { exitId: string; turn: number } | undefined;
  ended: { exitId: string; turn: number } | undefined;
  pressureOffered: string[];
  /** JSON: ScenePatch[]. */
  patches: string;
  adjustments: string[];
  opening: string | undefined;
  lead: string | undefined;
  /** OwedRow's, where it is an empty option when it isn't known. */
  owed: Array<{ from: string; id: string; hinted: boolean; things: string[]; holders: string[]; where: string | undefined }>;
  fought: string[];
  threat: ThreatRow | undefined;
  held: number | undefined;
  brawl: Brawl | undefined;
  absent: string[];
  /** TalkState, `with` as `companion`; confide an empty option when there's none. */
  talk: { companion: string; where: string; confide: Confide | undefined } | undefined;
  /** The nodes reached, in order: empty in a row from before them, read as the stage alone. */
  reached: string[];
  /** TwoPartState: the roles a row a person, moved an empty option; none in a row from before M2. */
  twoPart: TwoPartRow | undefined;
  /** JSON: CombatState; "" (or none, in a row from before it) when there's no fight on. */
  combat: string;
}

export interface TwoPartRow {
  roles: Array<{ cast: string; status: string; mentalState: string; conversationRole: string }>;
  notes: Array<{ turn: number; text: string }>;
  moved: string | undefined;
  held: boolean;
}

/** kind: attack (by), hazard (hazard and severity: glancing, serious). */
export interface ThreatRow { kind: string; by: string | undefined; hazard: string | undefined; severity: string | undefined; turn: number }

export interface PathRow { turn: number; from: string; to: string; via: string; roll: RollRow | undefined; source: string; known: number | undefined }
export interface RollRow { skill: string; dc: number; die: number; modifier: number; total: number; success: boolean; critical: string | undefined; advantage: string | undefined }

/** The row for a scene's bookkeeping. Throws on a later vertical's field that isn't empty (V3's entered): it has no column to go in yet. */
export function gmToRow(sceneId: bigint, gm: GmState): GmRow {
  refuseLaterFields(gm);
  return {
    sceneId, beat: gm.beat, turnsInBeat: gm.turnsInBeat,
    path: gm.path.map(pathRowOf),
    established: [...gm.established], landed: [...gm.landed], hinted: [...gm.hinted],
    closing: gm.closing ? { ...gm.closing } : undefined,
    ended: gm.ended ? { ...gm.ended } : undefined,
    pressureOffered: [...gm.pressureOffered],
    patches: JSON.stringify(gm.patches),
    adjustments: [...gm.adjustments],
    opening: gm.opening,
    lead: gm.lead,
    owed: gm.owed.map(o => ({ from: o.from, id: o.id, hinted: o.hinted, things: [...o.things], holders: [...o.holders], where: o.where })),
    fought: [...gm.fought],
    threat: gm.threat ? threatRowOf(gm.threat) : undefined,
    held: gm.held,
    brawl: gm.brawl ? brawlOf(gm.brawl) : undefined,
    absent: [...gm.absent],
    talk: gm.talk ? { companion: gm.talk.with, where: gm.talk.where, confide: gm.talk.confide ? { ...gm.talk.confide } : undefined } : undefined,
    reached: [...gm.reached],
    twoPart: {
      roles: Object.entries(gm.twoPart.roles).map(([cast, r]) => ({ cast, status: r.status, mentalState: r.mental_state, conversationRole: r.conversation_role })),
      notes: gm.twoPart.notes.map(({ turn, text }) => ({ turn, text })),
      moved: gm.twoPart.moved,
      held: !!gm.twoPart.held,
    },
    combat: gm.combat ? JSON.stringify(gm.combat) : "",
  };
}

/** A scene's bookkeeping from its row, `entered` empty. */
export function gmFromRow(row: GmRow): GmState {
  return {
    ...initialGm({ start: row.beat }),
    beat: row.beat, turnsInBeat: row.turnsInBeat,
    path: row.path.map(pathStepOf),
    established: [...row.established], landed: [...row.landed], hinted: [...row.hinted],
    ...(row.closing ? { closing: { ...row.closing } } : {}),
    ...(row.ended ? { ended: { ...row.ended } } : {}),
    pressureOffered: [...row.pressureOffered],
    patches: row.patches ? JSON.parse(row.patches) as ScenePatch[] : [],
    adjustments: [...row.adjustments],
    ...(row.opening !== undefined ? { opening: row.opening } : {}),
    ...(row.lead !== undefined ? { lead: row.lead } : {}),
    owed: row.owed.map(o => ({ from: o.from, id: o.id, hinted: o.hinted, things: [...o.things], holders: [...o.holders], ...(o.where !== undefined ? { where: o.where } : {}) })),
    fought: [...row.fought],
    ...(row.threat ? { threat: threatOf(row.threat) } : {}),
    ...(row.held !== undefined ? { held: row.held } : {}),
    ...(row.brawl ? { brawl: brawlOf(row.brawl) } : {}),
    absent: [...row.absent],
    // A row read from an older module (the dev tools' SQL) may lack the town's column: none yet.
    ...(row.talk ? { talk: { with: row.talk.companion, where: row.talk.where, ...(row.talk.confide ? { confide: { ...row.talk.confide } } : {}) } } : {}),
    // A row from before M2 has no nodes reached: its stage stands for them.
    reached: row.reached?.length ? [...row.reached] : [row.beat],
    twoPart: twoPartOf(row.twoPart),
    ...(row.combat ? { combat: JSON.parse(row.combat) as CombatState } : {}),
  };
}

/** The two-part GM's state from its column (none in a row from before it: nothing yet). */
function twoPartOf(row: TwoPartRow | undefined): TwoPartState {
  if (!row) return { roles: {}, notes: [] };
  return {
    roles: Object.fromEntries(row.roles.map(r => [r.cast, { status: r.status, mental_state: r.mentalState, conversation_role: r.conversationRole }])),
    notes: row.notes.map(({ turn, text }) => ({ turn, text })),
    ...(row.moved !== undefined ? { moved: row.moved } : {}),
    ...(row.held ? { held: true } : {}),
  };
}

function refuseLaterFields(gm: GmState): void {
  const full = Object.entries({ entered: gm.entered }).filter(([, v]) => v.length).map(([k]) => k);
  if (full.length) throw new Error(`gm_state has no column for ${full.join(", ")} yet: the vertical that writes it adds one`);
}

function pathRowOf(p: PathStep): PathRow {
  return { turn: p.turn, from: p.from, to: p.to, via: p.via, roll: p.roll ? rollRowOf(p.roll) : undefined, source: p.source, known: p.known };
}

function rollRowOf(r: RollResult): RollRow {
  return { skill: r.skill, dc: r.dc, die: r.die, modifier: r.modifier, total: r.total, success: r.success, critical: r.critical ?? undefined, advantage: r.advantage };
}

function pathStepOf(p: PathRow): PathStep {
  return {
    turn: p.turn, from: p.from, to: p.to, via: p.via,
    ...(p.roll ? { roll: rollOf(p.roll) } : {}),
    source: p.source as PathStep["source"],
    ...(p.known !== undefined ? { known: p.known } : {}),
  };
}

/** A roll as rollCheck makes it (its fields in that order: the AI service shows rolls as they are). */
function rollOf(r: RollRow): RollResult {
  return {
    skill: r.skill, dc: r.dc, die: r.die, modifier: r.modifier, total: r.total, success: r.success,
    critical: (r.critical ?? null) as RollResult["critical"],
    ...(r.advantage ? { advantage: r.advantage as NonNullable<RollResult["advantage"]> } : {}),
  };
}

function threatRowOf(t: Threat): ThreatRow {
  return t.kind === "attack"
    ? { kind: t.kind, by: t.by, hazard: undefined, severity: undefined, turn: t.turn }
    : { kind: t.kind, by: undefined, hazard: t.hazard, severity: t.severity, turn: t.turn };
}

/** A threat as the prototype's session has it (its fields in that order). */
function threatOf(r: ThreatRow): Threat {
  return r.kind === "attack"
    ? { kind: "attack", by: r.by ?? "", turn: r.turn }
    : { kind: "hazard", hazard: r.hazard ?? "", severity: r.severity === "serious" ? "serious" : "glancing", turn: r.turn };
}

const brawlOf = (b: Brawl): Brawl => ({ turn: b.turn, cause: b.cause, against: [...b.against], allies: [...b.allies], fled: [...b.fled] });
