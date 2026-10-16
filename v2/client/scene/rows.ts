import type { Markup } from "../../shared/markup.ts";
import { colorOf } from "../theme.ts";
import type { Entry, EntryKind, Phase, SceneView } from "./view.ts";

/**
 * The scene's view from the rows the client holds: the scene, its transcript, the draft the GM's
 * text grows in, the turn in flight, who's on stage and the names and looks the player knows them
 * by. Pure: the connection keeps the rows, and calls this whenever one of them changes. The row
 * shapes are the design's tables (content-server.md §2), as the module would declare them; the
 * generated bindings' own types replace these once the simulation has its schema.
 */

export interface SceneRow { id: bigint; sceneKey: string; title: string; hook: string; status: string; controllerId: bigint; turnId?: bigint | undefined }
export interface TranscriptRow { id: bigint; sceneId: bigint; turn: number; seq: number; speaker: string; kind: string; text: string; markup?: string | undefined }
/** The design's reply_draft has no kind: the GM's ("gm") is narration, an actor's (a cast key) dialogue. */
export interface DraftRow { turnId: bigint; sceneId: bigint; speaker: string; text: string; markup?: string | undefined; seq: number; done: boolean }
export interface TurnRow { id: bigint; sceneId: bigint; n: number; playerId: bigint; phase: string; error?: string | undefined }
export interface OnStageRow { entityId: bigint; sceneId: bigint; role: string }
export interface NameRow { entityId: bigint; key: string; name: string }
export interface LookRow { entityId: bigint; fg: string }
export interface PlayerRow { id: bigint; name: string; characterId: bigint }

export interface SceneRows {
  me: PlayerRow;
  scene: SceneRow;
  time?: string;
  status?: string;
  transcript: TranscriptRow[];
  drafts: DraftRow[];
  turns: TurnRow[];
  onStage: OnStageRow[];
  names: NameRow[];
  looks: LookRow[];
  players: PlayerRow[];
  refusal?: string;
}

const PHASES: readonly Phase[] = ["queued", "deciding", "replying", "settling", "done", "failed"];
const KINDS: readonly EntryKind[] = ["player", "narration", "dialogue", "roll", "system"];

/** A markup column (JSON), or nothing when it's missing or unreadable: the words are drawn plain. */
function markupOf(json: string | undefined): Markup | undefined {
  if (!json) return undefined;
  try { return JSON.parse(json) as Markup; } catch { return undefined; }
}

/** The name a speaker goes by: a player's character, or whoever the player knows by that key. */
function nameOf(rows: SceneRows, speaker: string): string | undefined {
  const player = /^player:(\d+)$/.exec(speaker);
  if (player) return rows.players.find(p => p.id === BigInt(player[1]!))?.name;
  return rows.names.find(n => n.key === speaker)?.name;
}

export function sceneViewOf(rows: SceneRows): SceneView {
  const turn = rows.scene.turnId !== undefined ? rows.turns.find(t => t.id === rows.scene.turnId) : rows.turns.reduce<TurnRow | undefined>((a, t) => (!a || t.n > a.n ? t : a), undefined);
  const phase: Phase = turn && PHASES.includes(turn.phase as Phase) ? turn.phase as Phase : "idle";
  const draft = turn ? rows.drafts.find(d => d.turnId === turn.id) : undefined;
  const entries: Entry[] = [...rows.transcript].sort((a, b) => a.seq - b.seq).map(t => {
    const name = t.kind === "player" || t.kind === "dialogue" ? nameOf(rows, t.speaker) : undefined;
    const markup = markupOf(t.markup);
    return { turn: t.turn, speaker: t.speaker, kind: KINDS.includes(t.kind as EntryKind) ? t.kind as EntryKind : "system", ...(name ? { name } : {}), text: t.text, ...(markup ? { markup } : {}) };
  });
  const present = rows.onStage.filter(s => s.role !== "controller" && s.role !== "watcher").flatMap(s => {
    const known = rows.names.find(n => n.entityId === s.entityId);
    if (!known) return [];
    return [{ key: known.key, name: known.name, color: rows.looks.find(l => l.entityId === s.entityId)?.fg ?? colorOf(known.key) }];
  });
  const controls = rows.scene.controllerId === rows.me.id && rows.scene.status === "live";
  const mayType = controls && (phase === "idle" || phase === "settling" || phase === "done");
  const draftMarkup = draft ? markupOf(draft.markup) : undefined;
  const draftKind = draft && draft.speaker !== "gm" ? "dialogue" as const : "narration" as const;
  const draftName = draft && draftKind === "dialogue" ? nameOf(rows, draft.speaker) : undefined;
  return {
    title: rows.scene.title, ...(rows.time ? { time: rows.time } : {}), hook: rows.scene.hook,
    player: { name: rows.me.name, ...(rows.status ? { status: rows.status } : {}) },
    present, entries,
    ...(draft ? { draft: { speaker: draft.speaker, kind: draftKind, ...(draftName ? { name: draftName } : {}), text: draft.text, ...(draftMarkup ? { markup: draftMarkup } : {}) } } : {}),
    phase, mayType,
    ...(rows.refusal ? { refusal: rows.refusal } : {}),
    ...(phase === "failed" ? { failed: turn?.error ?? "something went wrong" } : {}),
  };
}
