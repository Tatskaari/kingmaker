import type { Criterion, Trial } from "./experiment.js";

export interface Comparison {
  variant: string;
  baseline: boolean;
  runs: number;
  executionErrors: number;
  scoringErrors: number;
  criteria: Record<string, number | null>;
  total: number | null;
  delta: number | null;
}

/** Execution failures score zero; incomplete judging is unranked, never silently omitted. */
export function compareResults(trials: readonly Trial[], rubric: readonly Criterion[]): Comparison[] {
  const rows = [...new Set(trials.map(trial => trial.variant))].map(variant => {
    const runs = trials.filter(trial => trial.variant === variant);
    const executionErrors = runs.filter(trial => trial.recording.error !== undefined).length;
    const scoringErrors = runs.filter(trial => !trial.result).length;
    const criteria = Object.fromEntries(rubric.map(({ name }) => [name, scoringErrors ? null :
      runs.reduce((sum, trial) => sum + (trial.recording.error !== undefined ? 0 : trial.result!.criteria[name]!.score), 0) / runs.length]));
    const total = scoringErrors ? null : rubric.reduce((sum, item) => sum + criteria[item.name]! * (item.weight ?? 1), 0)
      / rubric.reduce((sum, item) => sum + (item.weight ?? 1), 0);
    return { variant, baseline: runs.some(trial => trial.baseline), runs: runs.length, executionErrors, scoringErrors, criteria, total, delta: null } as Comparison;
  });
  const baseline = rows.find(row => row.baseline)?.total;
  for (const row of rows) row.delta = row.total !== null && baseline != null ? row.total - baseline : null;
  return rows.sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.variant.localeCompare(b.variant));
}

export function formatComparison(rows: readonly Comparison[], rubric: readonly Criterion[]): string {
  const percentage = (value: number | null) => value === null ? "unscored" : `${(value * 100).toFixed(1)}%`;
  const cells = [["Variant", "Runs", "Run errors", "Judge errors", ...rubric.map(item => item.name), "Δ baseline", "Total"],
    ...rows.map(row => [row.variant + (row.baseline ? " (baseline)" : ""), String(row.runs), String(row.executionErrors), String(row.scoringErrors),
      ...rubric.map(item => percentage(row.criteria[item.name]!)), row.delta === null ? "—" : `${row.delta >= 0 ? "+" : ""}${(row.delta * 100).toFixed(1)}pp`, percentage(row.total)])];
  const widths = cells[0]!.map((_, index) => Math.max(...cells.map(row => row[index]!.length)));
  return cells.map(row => row.map((cell, index) => cell.padEnd(widths[index]!)).join("  ")).join("\n");
}
