import type { RollResult } from "../dice.ts";
import type { Brawl, Threat } from "../rules/types.ts";
import type { Beat, Essential, Scene, Skill, Transition } from "../scene/types.ts";
import type { RulingRecord } from "./consider.ts";

/**
 * The GM's bookkeeping for a scene: where it stands in its beats, what's been settled, the notes
 * open, the endings coming, the co-GM's steering, the GM's rulings, and what the story handed on to
 * it at the boundary before it (story-design §4.1). The simulation keeps it in
 * the private `gm_state` table, a column a field, and sends it whole in every request to the AI
 * service. The field names are the prototype's (src/runtime/session.ts), so the code copied from it
 * reads this unchanged.
 */
export interface GmState {
  beat: string;
  turnsInBeat: number;
  path: PathStep[];
  /** The facts settled so far, as their sentences (content-world A7). */
  established: string[];
  /** The essentials the player has come across (judged after each reply). */
  landed: string[];
  /** The essentials a reply has already pointed towards: a nudge is given once, not repeated. */
  hinted: string[];
  /** The notes disclosure has open for the scene, the newest 24. */
  opened: OpenedNote[];
  /** The ending the story has been leaning towards, and for how many replies in a row. */
  endingLead?: { exitId: string; count: number; probability: number };
  /** An ending the player didn't choose is coming; they get one last chance to respond. */
  pendingExit?: { exitId: string; turn: number; via: string; extended: boolean; waits?: string };
  /** The story reached an ending; the next player turn is the wind-down, then the scene closes. */
  closing?: { exitId: string; turn: number };
  /** The ending this turn's reply closes the scene on. */
  ended?: { exitId: string; turn: number };
  sceneStatus?: SceneStatus;
  /** The turns the player spoke out of character: not time passing in the scene. */
  oocTurns: number[];
  /** Beats whose pressure has already been offered to the GM (it fires once). */
  pressureOffered: string[];
  /** A sentence the last reply repeated word for word: the next reply is told not to. */
  repeated?: string;
  // The co-GM's (full-gm-design §4.2): merged from its reviews at a turn's start.
  /** New details improvised in play that must stay true. */
  canon: string[];
  /** The scene's prep as play has changed it: the co-GM's routes and bridging beats, the ways of trying a ruling shut. */
  patches: ScenePatch[];
  /** The co-GM's notes to the GM: for the two replies after the turn it reviewed (notesTurn), then they lapse. */
  notes: string | null;
  notesTurn: number | null;
  /** What one of the cast wants or should try next (turn: the one reviewed): for the reply after it, then it lapses. */
  whispers: Array<{ to: string; note: string; turn: number }>;
  /** The turn the co-GM last reviewed (its result merged): the backstop runs every third turn from it. */
  lastRepairTurn?: number;
  /** The last turn the player went off the graph with nothing ruled on it: the co-GM reviews it. */
  offGraphTurn?: number;
  /** The GM's rulings on considered acts, in the order made. */
  rulings: RulingRecord[];
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
}

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
 * (before its own), so a beat left before something was settled is known (leftBehind).
 */
export interface PathStep { turn: number; from: string; to: string; via: string; roll?: RollResult; source: "pre" | "post" | "repair"; known?: number }

/** A note disclosure has opened for a scope (`p`: how sure it was, on the turn it opened; not kept). */
export interface OpenedNote { path: string; title: string; scope: string; turn: number; p?: number }

export type SceneStatus = "on_track" | "drifting" | "stuck" | "uncovered";

/** Changes made to the scene's prep during play (the co-GM's, a talk's, the boundary's): src/runtime/session.ts:104-121. */
export interface ScenePatch {
  turn: number;
  beat?: Beat;
  transition?: { beat: string; transition: Transition };
  cast?: { id: string; secrets: string[] };
  close?: { beat: string; id: string };
  essential?: Essential;
  why: string;
}

/** A scene's bookkeeping as it opens: its first beat, nothing else yet. */
export function initialGm(scene: Pick<Scene, "start">): GmState {
  return {
    beat: scene.start, turnsInBeat: 0, path: [], established: [], landed: [], hinted: [], opened: [],
    oocTurns: [], pressureOffered: [],
    canon: [], patches: [], notes: null, notesTurn: null, whispers: [], rulings: [],
    adjustments: [], owed: [], fought: [], absent: [], entered: [],
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
  opened: Array<{ path: string; title: string; scope: string; turn: number }>;
  endingLead: { exitId: string; count: number; probability: number } | undefined;
  pendingExit: { exitId: string; turn: number; via: string; extended: boolean; waits: string | undefined } | undefined;
  closing: { exitId: string; turn: number } | undefined;
  ended: { exitId: string; turn: number } | undefined;
  sceneStatus: string | undefined;
  oocTurns: number[];
  pressureOffered: string[];
  repeated: string | undefined;
  canon: string[];
  /** JSON: ScenePatch[]. */
  patches: string;
  notes: string | undefined;
  notesTurn: number | undefined;
  whispers: Array<{ to: string; note: string; turn: number }>;
  lastRepairTurn: number | undefined;
  offGraphTurn: number | undefined;
  rulings: RulingRow[];
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
}

/** kind: attack (by), hazard (hazard and severity: glancing, serious). */
export interface ThreatRow { kind: string; by: string | undefined; hazard: string | undefined; severity: string | undefined; turn: number }

export interface PathRow { turn: number; from: string; to: string; via: string; roll: RollRow | undefined; source: string; known: number | undefined }
export interface RollRow { skill: string; dc: number; die: number; modifier: number; total: number; success: boolean; critical: string | undefined; advantage: string | undefined }
export interface RulingRow {
  turn: number; act: string; target: string; skill: string; kind: string; dc: number | undefined; why: string; roll: RollRow | undefined;
  went: string; changed: string; costUsd: number; latencyMs: number;
}

/** The row for a scene's bookkeeping. Throws on a later vertical's field that isn't empty (V3's entered): it has no column to go in yet. */
export function gmToRow(sceneId: bigint, gm: GmState): GmRow {
  refuseLaterFields(gm);
  return {
    sceneId, beat: gm.beat, turnsInBeat: gm.turnsInBeat,
    path: gm.path.map(pathRowOf),
    established: [...gm.established], landed: [...gm.landed], hinted: [...gm.hinted],
    opened: gm.opened.map(({ path, title, scope, turn }) => ({ path, title, scope, turn })),
    endingLead: gm.endingLead ? { ...gm.endingLead } : undefined,
    pendingExit: gm.pendingExit ? { ...gm.pendingExit, waits: gm.pendingExit.waits } : undefined,
    closing: gm.closing ? { ...gm.closing } : undefined,
    ended: gm.ended ? { ...gm.ended } : undefined,
    sceneStatus: gm.sceneStatus,
    oocTurns: [...gm.oocTurns], pressureOffered: [...gm.pressureOffered],
    repeated: gm.repeated,
    canon: [...gm.canon],
    patches: JSON.stringify(gm.patches),
    notes: gm.notes ?? undefined,
    notesTurn: gm.notesTurn ?? undefined,
    whispers: gm.whispers.map(({ to, note, turn }) => ({ to, note, turn })),
    lastRepairTurn: gm.lastRepairTurn,
    offGraphTurn: gm.offGraphTurn,
    rulings: gm.rulings.map(rulingRowOf),
    adjustments: [...gm.adjustments],
    opening: gm.opening,
    lead: gm.lead,
    owed: gm.owed.map(o => ({ from: o.from, id: o.id, hinted: o.hinted, things: [...o.things], holders: [...o.holders], where: o.where })),
    fought: [...gm.fought],
    threat: gm.threat ? threatRowOf(gm.threat) : undefined,
    held: gm.held,
    brawl: gm.brawl ? brawlOf(gm.brawl) : undefined,
    absent: [...gm.absent],
  };
}

/** A scene's bookkeeping from its row, `entered` empty. */
export function gmFromRow(row: GmRow): GmState {
  return {
    ...initialGm({ start: row.beat }),
    beat: row.beat, turnsInBeat: row.turnsInBeat,
    path: row.path.map(pathStepOf),
    established: [...row.established], landed: [...row.landed], hinted: [...row.hinted],
    opened: row.opened.map(n => ({ ...n })),
    ...(row.endingLead ? { endingLead: { ...row.endingLead } } : {}),
    ...(row.pendingExit ? { pendingExit: pendingOf(row.pendingExit) } : {}),
    ...(row.closing ? { closing: { ...row.closing } } : {}),
    ...(row.ended ? { ended: { ...row.ended } } : {}),
    ...(row.sceneStatus ? { sceneStatus: row.sceneStatus as SceneStatus } : {}),
    oocTurns: [...row.oocTurns], pressureOffered: [...row.pressureOffered],
    ...(row.repeated !== undefined ? { repeated: row.repeated } : {}),
    canon: [...row.canon],
    patches: row.patches ? JSON.parse(row.patches) as ScenePatch[] : [],
    notes: row.notes ?? null,
    notesTurn: row.notesTurn ?? null,
    whispers: row.whispers.map(w => ({ ...w })),
    ...(row.lastRepairTurn !== undefined ? { lastRepairTurn: row.lastRepairTurn } : {}),
    ...(row.offGraphTurn !== undefined ? { offGraphTurn: row.offGraphTurn } : {}),
    rulings: row.rulings.map(rulingOf),
    adjustments: [...row.adjustments],
    ...(row.opening !== undefined ? { opening: row.opening } : {}),
    ...(row.lead !== undefined ? { lead: row.lead } : {}),
    owed: row.owed.map(o => ({ from: o.from, id: o.id, hinted: o.hinted, things: [...o.things], holders: [...o.holders], ...(o.where !== undefined ? { where: o.where } : {}) })),
    fought: [...row.fought],
    ...(row.threat ? { threat: threatOf(row.threat) } : {}),
    ...(row.held !== undefined ? { held: row.held } : {}),
    ...(row.brawl ? { brawl: brawlOf(row.brawl) } : {}),
    absent: [...row.absent],
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

function pendingOf(p: NonNullable<GmRow["pendingExit"]>): NonNullable<GmState["pendingExit"]> {
  return { exitId: p.exitId, turn: p.turn, via: p.via, extended: p.extended, ...(p.waits !== undefined ? { waits: p.waits } : {}) };
}

function rulingRowOf(r: RulingRecord): RulingRow {
  return {
    turn: r.turn, act: r.act, target: r.target, skill: r.skill, kind: r.kind, dc: r.dc, why: r.why, roll: r.roll ? rollRowOf(r.roll) : undefined,
    went: r.went, changed: r.changed, costUsd: r.costUsd, latencyMs: r.latencyMs,
  };
}

/** A ruling as settleRuling records it (its fields in that order). */
function rulingOf(r: RulingRow): RulingRecord {
  return {
    turn: r.turn, act: r.act, target: r.target, skill: r.skill as Skill, kind: r.kind as RulingRecord["kind"],
    ...(r.dc !== undefined ? { dc: r.dc } : {}), why: r.why,
    ...(r.roll ? { roll: rollOf(r.roll) } : {}),
    went: r.went as RulingRecord["went"], changed: r.changed, costUsd: r.costUsd, latencyMs: r.latencyMs,
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
