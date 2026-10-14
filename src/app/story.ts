import { join } from "node:path";
import type { CombatantSetup, CombatSetup, StoryState } from "../game/types.ts";
import { sessionSpend, setCallLog } from "../llm/openrouter.ts";
import { presentCast } from "../runtime/brief.ts";
import { chainScene, createSession, forceEnding, openScene, playerTurn, type TurnHooks, type TurnResult } from "../runtime/engine.ts";
import type { Exit, Scene } from "../runtime/scene.ts";
import { saveSession, sessionDir, type Entry, type SessionState } from "../runtime/session.ts";
import { sceneById } from "../../scenes/index.ts";
import type { CombatField } from "./adapters.ts";
import { afterTurn } from "./background.ts";

/**
 * The story flow of the playable game (docs/design/playable.md), with no UI in it: make the
 * character, open the lead scene, take turns, and at a scene's end chain on to the next scene that
 * still holds, skipping interludes (walking the map replaces them), into a fight or to The End.
 */

export const FIRST_SCENE = "hanged-clerk";
export const APPROACH = process.env.KM_APPROACH ?? "v2";
export const LEVEL = 3;
export const DEFAULT_NAME = "Wren Ashdown";
export const DEFAULT_CONCEPT = "a quick-witted half-elf ranger with a longbow, a dry sense of humour and a soft spot for underdogs";

const TIME: Record<string, StoryState["time"]> = {
  "hanged-clerk": "morning", "caerwyn-afternoon": "afternoon", "drowned-rat": "evening", "wharf-night": "night", "heron-warehouse": "night", "kings-morning": "next-morning",
};
export const timeOf = (sceneId: string): StoryState["time"] => TIME[sceneId] ?? "morning";

export const TIME_WORDS: Record<StoryState["time"], string> = {
  morning: "Morning, on the eve of the Assembly",
  afternoon: "Afternoon, on the eve of the Assembly",
  evening: "Evening, on the eve of the Assembly",
  night: "Night, before the midnight bells",
  "next-morning": "The morning of the Assembly",
};

/** Downtime scenes that stand in for the map between the real ones: the map replaces them. */
export function isInterlude(scene: Scene): boolean {
  return scene.beats.length === 1 && scene.beats[0]!.id === "downtime" && scene.exits.some(e => e.id === "onward");
}

/** Where the story is, as the map needs it. The lead is the scene that opens next (or is open now). */
export function storyOf(session: SessionState, over = false): StoryState {
  const played = session.history.map(h => h.sceneId);
  if (over && !played.includes(session.sceneId)) played.push(session.sceneId);
  return { time: timeOf(session.sceneId), played, ...(over ? {} : { lead: session.sceneId }), flags: {} };
}

/** Character creation: the rules engine builds a level 3 sheet from the concept. */
export async function newGame(name: string, concept: string): Promise<SessionState> {
  const who = `${(name.trim() || DEFAULT_NAME).replace(/:/g, " ")}: ${concept.trim() || DEFAULT_CONCEPT}`;
  const session = await createSession({ sceneId: FIRST_SCENE, approach: APPROACH, player: who, level: LEVEL });
  setCallLog(join(sessionDir(session.id), "calls.jsonl"));
  saveSession(session);
  return session;
}

/** Open the lead scene: people and things are placed in its world, time passes, the GM sets the scene. */
export async function beginScene(session: SessionState, hooks: TurnHooks): Promise<Entry[]> {
  setCallLog(join(sessionDir(session.id), "calls.jsonl"));
  return openScene(session, hooks);
}

export async function takeTurn(session: SessionState, input: string, hooks: TurnHooks): Promise<TurnResult> {
  setCallLog(join(sessionDir(session.id), "calls.jsonl"));
  const result = await playerTurn(session, input, hooks);
  afterTurn(session);
  return result;
}

export type Onward =
  | { kind: "combat"; exit: Exit }
  | { kind: "scene"; exit: Exit; sceneId: string; skipped: string[] }
  | { kind: "end"; exit: Exit };

/** The exit the current scene ended through. */
export function endedExit(session: SessionState): Exit | undefined {
  return session.ended ? sceneById(session.sceneId).exits.find(e => e.id === session.ended!.exitId) : undefined;
}

/**
 * A scene has ended: a fight goes to the map first; otherwise chain on to the next scene that still
 * holds. Interludes are ended at once and chained past. No next scene means The End.
 */
export async function moveOn(session: SessionState, combatSummary?: string): Promise<Onward> {
  const exit = endedExit(session);
  if (!exit) throw new Error(`Scene ${session.sceneId} hasn't ended.`);
  if (exit.kind === "combat" && combatSummary === undefined) return { kind: "combat", exit };
  const skipped: string[] = [];
  if (!await chainScene(session, combatSummary ?? "the party won")) return { kind: "end", exit };
  skipped.push(...(session.history.at(-1)?.skipped ?? []).map(s => s.sceneId));
  for (let guard = 0; guard < 4 && isInterlude(sceneById(session.sceneId)); guard++) {
    skipped.push(session.sceneId);
    forceEnding(session, "onward");
    if (!await chainScene(session)) return { kind: "end", exit };
    skipped.push(...(session.history.at(-1)?.skipped ?? []).map(s => s.sceneId));
  }
  saveSession(session);
  return { kind: "scene", exit, sceneId: session.sceneId, skipped };
}

/** Who fights alongside the player, and how a cast member's group expands on the map. */
const ALLIES = new Set(["kell"]);
const GROUPS: Record<string, Array<Omit<CombatantSetup, "at" | "side">>> = {
  sallow: [
    { id: "crake-1", name: "Crake (the one who talks)", statblock: "bandit", weapon: "club" },
    { id: "crake-2", name: "Crake (the one who doesn't)", statblock: "bandit", weapon: "club" },
  ],
  hep: [
    { id: "porter-1", name: "a porter with a sack-needle", statblock: "commoner", weapon: "dagger" },
    { id: "porter-2", name: "a porter with a knife", statblock: "commoner", weapon: "dagger" },
    { id: "porter-3", name: "a porter with a grudge", statblock: "commoner", weapon: "club" },
  ],
};
/** Who leads the other side, in order of preference: whoever is present first. */
const LEADERS = ["sallow", "hep"];

/**
 * The fight when a scene ends in "Roll for initiative!": the scene's present cast with statblocks,
 * the leader's group expanded (Sallow and the two Crakes), Kell as an ally if she's there.
 */
export function combatSetup(session: SessionState, field: CombatField): CombatSetup {
  const scene = sceneById(session.sceneId);
  const present = presentCast(scene, session);
  const leader = LEADERS.map(id => present.find(c => c.id === id)).find(Boolean)
    ?? present.find(c => !ALLIES.has(c.id) && c.statblock && c.statblock !== "commoner");
  const spot = (list: typeof field.spots.allies, i: number) => list[i % list.length] ?? field.spots.player;
  const combatants: CombatantSetup[] = [{ id: "player", name: session.player.name, side: "player", at: field.spots.player }];
  present.filter(c => ALLIES.has(c.id)).forEach((c, i) => combatants.push({ id: c.id, name: c.name, side: "ally", at: spot(field.spots.allies, i), castId: c.id, ...(c.statblock ? { statblock: c.statblock } : {}), ...(c.weapon ? { weapon: c.weapon } : {}) }));
  const enemies: CombatantSetup[] = leader ? [
    { id: leader.id, name: leader.name, side: "enemy", at: field.spots.player, castId: leader.id, ...(leader.statblock ? { statblock: leader.statblock } : {}), ...(leader.weapon ? { weapon: leader.weapon } : {}) },
    ...(GROUPS[leader.id] ?? []).map(g => ({ ...g, side: "enemy" as const, at: field.spots.player })),
  ] : [];
  enemies.forEach((e, i) => combatants.push({ ...e, at: spot(field.spots.enemies, i) }));
  present.filter(c => !ALLIES.has(c.id) && c.id !== leader?.id).forEach((c, i) => combatants.push({ id: c.id, name: c.name, side: "neutral", at: spot(field.spots.neutrals, i), castId: c.id, ...(c.statblock ? { statblock: c.statblock } : {}) }));
  return { map: field.map, combatants, sceneId: session.sceneId, seed: session.seed + 4242 + session.turn };
}

export interface Epilogue {
  closing: string;
  chapters: Array<{ sceneId: string; title: string; ending: string }>;
  spentUsd: number;
}

/** The End: the last scene's closing narration and how each scene ended. */
export function epilogue(session: SessionState): Epilogue {
  const last = [...session.transcript].reverse().find(e => e.kind === "narration" && e.scene === session.sceneId);
  const chapter = (sceneId: string, exitId: string) => {
    const scene = sceneById(sceneId);
    return { sceneId, title: scene.title, ending: scene.exits.find(e => e.id === exitId)?.title ?? exitId };
  };
  const chapters = session.history.filter(h => !isInterlude(sceneById(h.sceneId))).map(h => chapter(h.sceneId, h.exitId));
  if (session.ended) chapters.push(chapter(session.sceneId, session.ended.exitId));
  return { closing: last?.text ?? "And that, as they say in Caerwyn, was that.", chapters, spentUsd: sessionSpend() };
}
