/** Each eval has equal weight; repeat counts do not give one eval extra influence. */
export function aggregateRuns(entries, expectedEvals) {
  const commits = new Map();
  for (const entry of entries) {
    const group = commits.get(entry.revision) ?? [];
    group.push(entry); commits.set(entry.revision, group);
  }
  return [...commits].map(([revision, sources]) => {
    const rubric = [...new Set(sources.flatMap(run => run.rubric.map(item => item.name)))]
      .sort().map(name => ({ name }));
    const variants = [...new Set(sources.flatMap(run => run.comparison.map(row => row.variant)))].sort();
    const comparison = variants.map(variant => {
      const included = sources.flatMap(run => {
        const row = run.comparison.find(row => row.variant === variant);
        return row ? [{ run, row }] : [];
      });
      const mean = values => values.some(value => value == null) ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
      const criteria = Object.fromEntries(rubric.map(({ name }) => {
        const applicable = included.filter(({ run }) => run.rubric.some(item => item.name === name));
        return [name, applicable.length ? mean(applicable.map(({ row }) => row.criteria[name])) : null];
      }));
      return { variant, baseline: included.every(({ row }) => row.baseline),
        runs: included.reduce((sum, { row }) => sum + row.runs, 0),
        evals: included.length, expectedEvals,
        executionErrors: included.reduce((sum, { row }) => sum + row.executionErrors, 0),
        scoringErrors: included.reduce((sum, { row }) => sum + row.scoringErrors, 0),
        criteria, total: mean(included.map(({ row }) => row.total)),
        // Compare deltas only over the evals that actually include this variant.
        delta: mean(included.map(({ row }) => row.delta)),
        population: JSON.stringify(included.map(({ run }) => [run.evalName, run.rubric]).sort((a, b) => a[0].localeCompare(b[0]))) };
    });
    return { revision, rubric, comparison, sources, aggregate: true,
      publishedAt: sources.map(run => run.publishedAt).sort().at(-1) };
  }).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.revision.localeCompare(b.revision));
}
