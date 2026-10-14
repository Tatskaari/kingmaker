import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CombatantSetup, CombatSetup, StoryState } from "../game/types.ts";
import { sessionSpend } from "../llm/openrouter.ts";
import { presentCast } from "../runtime/brief.ts";
import { sessionDir, type SessionState } from "../runtime/session.ts";
import { sceneById } from "../../scenes/index.ts";
import type { CombatField } from "./adapters.ts";

/**
 * What the app adds to the game core's story flow (src/game/play.ts owns the flow itself): the
 * fight's line-up, the notebook lines a scene's ending writes, the epilogue, and words for the time.
 */

export const LEVEL = 3;
export const DEFAULT_NAME = "Wren Ashdown";
export const DEFAULT_CONCEPT = "a quick-witted half-elf ranger with a longbow, a dry sense of humour and a soft spot for underdogs";

export const TIME_WORDS: Record<StoryState["time"], string> = {
  morning: "Morning, on the eve of the Assembly",
  afternoon: "Afternoon, on the eve of the Assembly",
  evening: "Evening, on the eve of the Assembly",
  night: "Night, before the midnight bells",
  "next-morning": "The morning of the Assembly",
};

export const timeOf = (sceneId: string): StoryState["time"] => {
  try { return sceneById(sceneId).time ?? "morning"; } catch { return "morning"; }
};

/** Who fights alongside the player. */
const ALLIES = new Set(["kell"]);
/** Groups the scene data doesn't break into members yet (Sallow's comes from his cast card). */
const GROUPS: Record<string, Array<{ id: string; name: string; statblock: string; weapon: string }>> = {
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
 * the leader's group as its members (Sallow and the two Crakes; the lantern-boy keeps out of it),
 * Kell as an ally if she's there, and everyone else standing by.
 */
export function combatSetup(session: SessionState, field: CombatField): CombatSetup {
  const scene = sceneById(session.sceneId);
  const present = presentCast(scene, session);
  const leader = LEADERS.map(id => present.find(c => c.id === id)).find(Boolean)
    ?? present.find(c => !ALLIES.has(c.id) && c.statblock && c.statblock !== "commoner");
  const spot = (list: typeof field.spots.allies, i: number) => list[i % list.length] ?? field.spots.player;
  const stats = (c: { statblock?: string; weapon?: string }) => ({ ...(c.statblock ? { statblock: c.statblock } : {}), ...(c.weapon ? { weapon: c.weapon } : {}) });
  const combatants: CombatantSetup[] = [{ id: "player", name: session.player.name, side: "player", at: field.spots.player }];
  present.filter(c => ALLIES.has(c.id)).forEach((c, i) => combatants.push({ id: c.id, name: c.name, side: "ally", at: spot(field.spots.allies, i), castId: c.id, ...stats(c) }));
  // A group's fighters stand with its leader; its children and hangers-on keep out of the way.
  const members = leader ? (leader.members ?? GROUPS[leader.id] ?? []) : [];
  const fighters = members.filter(m => m.statblock && m.statblock !== "commoner" || !leader?.members);
  const bystanders = members.filter(m => !fighters.includes(m));
  const enemies: CombatantSetup[] = leader ? [
    { id: leader.id, name: leader.name, side: "enemy", at: field.spots.player, castId: leader.id, ...stats(leader) },
    ...fighters.map(m => ({ id: m.id, name: m.name, side: "enemy" as const, at: field.spots.player, ...stats(m) })),
  ] : [];
  enemies.forEach((e, i) => combatants.push({ ...e, at: spot(field.spots.enemies, i) }));
  const neutrals = [
    ...present.filter(c => !ALLIES.has(c.id) && c.id !== leader?.id).map(c => ({ id: c.id, name: c.name, castId: c.id, ...stats(c) })),
    ...bystanders.map(m => ({ id: m.id, name: m.name, ...stats(m) })),
  ];
  neutrals.forEach((c, i) => combatants.push({ ...c, side: "neutral", at: spot(field.spots.neutrals, i) }));
  return { map: field.map, combatants, sceneId: session.sceneId, seed: session.seed + 4242 + session.turn };
}

/**
 * What the investigator's notebook says about how a scene ended: the exit's world script writes it
 * ("Big Hobb talked..."). The session forgets the script's operations once the story moves on, so
 * read them from the scene's last snapshot, the one taken as it ended.
 */
export function notebookLines(session: SessionState, sceneId: string): string[] {
  const dir = join(sessionDir(session.id), "snapshots");
  if (!existsSync(dir)) return [];
  const last = readdirSync(dir).filter(f => f.startsWith(`${sceneId}-turn-`)).sort().at(-1);
  if (!last) return [];
  try {
    const snapshot = JSON.parse(readFileSync(join(dir, last), "utf8")) as SessionState;
    return (snapshot.ended?.operations ?? []).filter(o => o.op === "journal").map(o => String(o.args["entry"] ?? "")).filter(Boolean);
  } catch { return []; }
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
  const chapters = session.history.filter(h => !sceneById(h.sceneId).interlude).map(h => chapter(h.sceneId, h.exitId));
  if (session.ended) chapters.push(chapter(session.sceneId, session.ended.exitId));
  return { closing: last?.text ?? "And that, as they say in Caerwyn, was that.", chapters, spentUsd: sessionSpend() };
}
