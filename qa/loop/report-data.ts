import { callsByTurn, capped, costOf, type Call } from "./calls.ts";
import { turnsOf, turnsTaken, type GameRecord } from "./record.ts";
import type { Review } from "./review.ts";
import type { Persona, Round } from "./round.ts";
import { endingTitled, type Ending } from "./scenes.ts";
import { keptOf, PENALTY, triaged, type Triage, type Triaged } from "./triage.ts";

/**
 * What a round's report shows, worked out from its files: each game's (how its scene ended, its
 * findings as triaged and what they cost it per ten replies, its ratings, its calls by turn, what it
 * cost, how long its turns took and what they waited on), and each arm's side by side. Pure: the
 * report reads the files and hands them in.
 */

/** How a game's scene came out: its ending's grade, or that it has none (no ending: out of turns, or stopped), or wasn't played. */
export type Outcome = "good" | "mixed" | "bad" | "ungraded" | "none" | "not played";
export const OUTCOMES: Outcome[] = ["good", "mixed", "bad", "ungraded", "none"];

export interface GameStats {
  id: string; arm: string; persona: string; as: string; scene: string;
  record?: GameRecord; review?: Review; notes?: string;
  /** The review's findings with their triage, and those that count (not discarded). */
  findings: Triaged[]; kept: Triaged[];
  /** The GM's replies (the opening's among them), and the kept findings' penalties over them. */
  replies: number; penalty: number;
  /** Penalty per 10 replies, once reviewed. */
  per10?: number;
  turns: number;
  ending?: { title: string; exit?: string; outcome: Outcome };
  outcome: Outcome;
  /** The scene's calls by turn, and all the game's (its character, the scenes ended on the way). */
  byTurn: Map<number, Call[]>; calls: Call[];
  sceneCostUsd: number; costUsd: number;
  /** The turns' waits (patience.ts) and the calls OpenRouter turned away with a 402. */
  waits: number; capped: number;
  /** A turn's time, the median of the player's turns. */
  medianMs?: number;
}

export interface GameInputs {
  record?: GameRecord | undefined;
  review?: Review | undefined;
  notes?: string | undefined;
  triage: Triage;
  calls: Call[];
  /** The scene's endings, to name and grade how it ended. */
  endings: Ending[];
}

export function gameStats(round: Round, id: string, personas: Persona[], inputs: GameInputs): GameStats {
  const spec = round.games[id]!;
  const { record, review } = inputs;
  const findings = triaged(id, review?.findings ?? [], inputs.triage);
  const kept = keptOf(findings);
  const replies = record ? turnsOf(record.entries).filter(([, es]) => es.some(e => e.kind !== "player")).length : 0;
  const penalty = kept.reduce((sum, f) => sum + (PENALTY[f.severity] ?? 0), 0);
  const ending = record?.ended ? endingOf(record.ended.title, inputs.endings) : undefined;
  const byTurn = record?.sceneRow ? callsByTurn(inputs.calls, record.sceneRow) : new Map<number, Call[]>();
  const sceneCalls = [...byTurn.values()].flat();
  const times = Object.entries(record?.turns ?? {}).filter(([n]) => n !== "0").flatMap(([, t]) => (t.ms !== undefined ? [t.ms] : []));
  const median = medianOf(times);
  return {
    id, arm: spec.arm, persona: spec.persona, as: personas.find(p => p.id === spec.persona)?.as ?? spec.persona, scene: spec.scene,
    ...(record ? { record } : {}), ...(review ? { review } : {}), ...(inputs.notes ? { notes: inputs.notes } : {}),
    findings, kept, replies, penalty, ...(review ? { per10: per10(penalty, replies) } : {}),
    turns: record ? turnsTaken(record) : 0,
    ...(ending ? { ending } : {}), outcome: !record?.sceneRow ? "not played" : ending?.outcome ?? "none",
    byTurn, calls: inputs.calls, sceneCostUsd: costOf(sceneCalls), costUsd: costOf(inputs.calls),
    waits: Object.values(record?.turns ?? {}).reduce((sum, t) => sum + t.waits.length, 0), capped: capped(sceneCalls),
    ...(median !== undefined ? { medianMs: median } : {}),
  };
}

/** The scene's ending by its title ("Scene ends: …"), with its grade (its result); ungraded when the scene's file hasn't got it (the game's own improvised ending). */
function endingOf(title: string, endings: Ending[]): NonNullable<GameStats["ending"]> {
  const found = endingTitled(endings, title);
  return { title, ...(found ? { exit: found.id } : {}), outcome: found?.grade ?? "ungraded" };
}

export const per10 = (penalty: number, replies: number) => (penalty / Math.max(1, replies)) * 10;

// ---------------------------------------------------------------------------------------------
// The arms

export interface ArmStats {
  arm: string; name: string; stack: string;
  games: number; played: number; reviewed: number;
  meanTurns?: number;
  /** How the played games' scenes came out, by outcome. */
  outcomes: Record<Outcome, number>;
  per10?: number;
  /** Kept findings by severity, 5 down to 1. */
  bySeverity: number[];
  overall?: number; pacing?: number;
  costPerGame?: number;
  waits: number; capped: number;
}

export function armStats(round: Round, games: GameStats[]): ArmStats[] {
  return Object.entries(round.arms).sort(([a], [b]) => a.localeCompare(b)).map(([arm, { name, stack }]) => {
    const mine = games.filter(g => g.arm === arm);
    const played = mine.filter(g => g.outcome !== "not played");
    const reviewed = played.filter(g => g.review);
    const replies = reviewed.reduce((sum, g) => sum + g.replies, 0);
    return {
      arm, name, stack, games: mine.length, played: played.length, reviewed: reviewed.length,
      ...optional("meanTurns", mean(played.map(g => g.turns))),
      outcomes: Object.fromEntries(([...OUTCOMES, "not played"] as Outcome[]).map(o => [o, mine.filter(g => g.outcome === o).length])) as Record<Outcome, number>,
      ...(replies ? { per10: per10(reviewed.reduce((sum, g) => sum + g.penalty, 0), replies) } : {}),
      bySeverity: [5, 4, 3, 2, 1].map(s => reviewed.reduce((sum, g) => sum + g.kept.filter(f => f.severity === s).length, 0)),
      ...optional("overall", mean(ratings(reviewed, "overall"))), ...optional("pacing", mean(ratings(reviewed, "pacing"))),
      ...optional("costPerGame", mean(played.map(g => g.costUsd))),
      waits: played.reduce((sum, g) => sum + g.waits, 0), capped: played.reduce((sum, g) => sum + g.capped, 0),
    };
  });
}

/** Kept findings by check: each check's count and penalty on each arm, the costliest check first. */
export function byCheck(games: GameStats[]): Array<{ check: string; arms: Record<string, { count: number; penalty: number }>; penalty: number }> {
  const kept = games.flatMap(g => g.kept.map(f => ({ ...f, arm: g.arm })));
  const checks = [...new Set(kept.map(f => f.check))];
  return checks.map(check => {
    const mine = kept.filter(f => f.check === check);
    const arms: Record<string, { count: number; penalty: number }> = {};
    for (const f of mine) {
      const at = (arms[f.arm] ??= { count: 0, penalty: 0 });
      at.count++;
      at.penalty += PENALTY[f.severity] ?? 0;
    }
    return { check, arms, penalty: mine.reduce((sum, f) => sum + (PENALTY[f.severity] ?? 0), 0) };
  }).sort((a, b) => b.penalty - a.penalty || a.check.localeCompare(b.check));
}

// ---------------------------------------------------------------------------------------------

const ratings = (games: GameStats[], which: string) => games.map(g => g.review?.ratings?.[which]).filter((x): x is number => typeof x === "number");
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
function medianOf(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
const optional = <K extends string>(key: K, value: number | undefined) => (value === undefined ? {} : { [key]: value } as Record<K, number>);
