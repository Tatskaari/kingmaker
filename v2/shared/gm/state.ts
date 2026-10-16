import type { RollResult } from "../dice.ts";
import type { Beat, Essential, Scene, Transition } from "../scene/types.ts";

/**
 * The GM's bookkeeping for a scene: where it stands in its beats, what's been settled, the notes
 * open, the endings coming. The simulation keeps it in the private `gm_state` table, a column a
 * field, and sends it whole in every request to the AI service. The field names are the
 * prototype's (src/runtime/session.ts), so the code copied from it reads this unchanged.
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
  // Later verticals' (the co-GM, presence): always empty in V0, but read by the copied code. They
  // have no columns yet; the vertical that writes one adds its column.
  canon: string[];
  patches: ScenePatch[];
  entered: string[];
  absent: string[];
  notes: string | null;
  whispers: Array<{ to: string; note: string; turn: number }>;
}

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
    canon: [], patches: [], entered: [], absent: [], notes: null, whispers: [],
  };
}

// ---------------------------------------------------------------------------------------------
// The gm_state row: a column a field V0 uses (simulation/src/schema.ts). An option column is
// undefined when empty; a roll's `critical` null is an empty option.

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
}

export interface PathRow { turn: number; from: string; to: string; via: string; roll: RollRow | undefined; source: string; known: number | undefined }
export interface RollRow { skill: string; dc: number; die: number; modifier: number; total: number; success: boolean; critical: string | undefined; advantage: string | undefined }

/** The row for a scene's bookkeeping. Throws on a later vertical's field that isn't empty: it has no column to go in yet. */
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
  };
}

/** A scene's bookkeeping from its row, the later verticals' fields empty. */
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
  };
}

function refuseLaterFields(gm: GmState): void {
  const full = Object.entries({ canon: gm.canon, patches: gm.patches, entered: gm.entered, absent: gm.absent, whispers: gm.whispers }).filter(([, v]) => v.length).map(([k]) => k);
  if (gm.notes !== null) full.push("notes");
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
