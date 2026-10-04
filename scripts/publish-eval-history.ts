import { mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { RunRecording, type Criterion, type Trial } from "../packages/evals/src/experiment.js";
import { compareResults } from "../packages/evals/src/report.js";

/** Merge completed trial artifacts into a Pages tree; reruns replace this commit's result. */
export function publishEvalHistory(source: string, destination: string) {
  const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  const write = (path: string, data: unknown) => writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  let published = 0;
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(source, entry.name);
    if (!existsSync(join(directory, "results.json"))) continue;
    const metadata = read(join(directory, "manifest.json")) as {
      revision: string; rubric: Criterion[]; experiments: string[]; repeats: number;
    };
    if (!/^[a-f0-9]{40}$/.test(metadata.revision)) throw new Error("Invalid source revision");
    const trials: Trial[] = [];
    for (const name of readdirSync(directory).filter(name => /^\d+\.json$/.test(name)).sort()) {
      // Read one trial at a time and retain only the fields needed to score it.
      // Full recordings stay in the eval-results Actions artifact.
      const trial = read(join(directory, name)) as Trial;
      trials.push({ experiment: trial.experiment, variant: trial.variant, baseline: trial.baseline,
        repeat: trial.repeat, summary: "", gradingCalls: [],
        recording: new RunRecording([], undefined, undefined, trial.recording.error),
        ...(trial.result === undefined ? {} : { result: trial.result }),
        ...(trial.scoringError === undefined ? {} : { scoringError: trial.scoringError }) });
    }
    for (const experiment of metadata.experiments) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(experiment)) throw new Error("Invalid experiment name");
      const selected = trials.filter(trial => trial.experiment === experiment);
      if (!selected.length) continue;
      const output = join(destination, experiment);
      mkdirSync(output, { recursive: true });
      const filename = `${metadata.revision}.json`;
      write(join(output, filename), { ...metadata, experiments: [experiment],
        publishedAt: new Date().toISOString(),
        comparison: compareResults(selected, metadata.rubric),
        trials: selected.map(({ recording, gradingCalls: _gradingCalls, summary: _summary, ...summary }) =>
          ({ ...summary, ...(recording.error === undefined ? {} : { executionError: recording.error }) })) });
      const indexPath = join(output, "index.json");
      const previous: string[] = existsSync(indexPath) ? read(indexPath) : [];
      write(indexPath, [...new Set([...previous, filename])]);
      published++;
    }
  }
  if (!published) throw new Error("No completed eval trials to publish");
  // The top-level catalog lets the frontend discover newly registered experiments.
  write(join(destination, "index.json"), readdirSync(destination, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(destination, entry.name, "index.json")))
    .map(entry => entry.name).sort());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw new Error("Usage: publish-eval-history.ts <eval-output> <pages-evals-directory>");
  publishEvalHistory(resolve(source), resolve(destination));
}
