import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { runExperiment, type Experiment, type Trial } from "./experiment.js";
import { compareResults, formatComparison } from "./report.js";

const help = `Eval options:
  --experiments name,name  Select experiments (default: all)
  --variants name,name     Select variants (baseline always included)
  --repeats N              Runs per configuration (default: 3)
  --timeout-ms N           Timeout per execution and grading phase (default: 180000)
  --output PATH            Artifact parent directory (default: eval-output)
  --list                   List experiments and configurations without calling models
  --help                   Show this help
`;

export async function runEvalCli<L, R>(experiments: readonly Experiment<L, R>[], options: {
  args?: string[]; secrets?: readonly string[]; print?: (text: string) => void;
} = {}): Promise<{ trials: Trial[]; exitCode: number; directory?: string }> {
  const print = options.print ?? console.log;
  const { values } = parseArgs({ args: options.args ?? process.argv.slice(2), options: {
    experiments: { type: "string" }, variants: { type: "string" }, repeats: { type: "string", default: "3" },
    "timeout-ms": { type: "string", default: "180000" }, output: { type: "string", default: "eval-output" },
    help: { type: "boolean" }, list: { type: "boolean" },
  } });
  if (values.help) { print(help); return { trials: [], exitCode: 0 }; }
  if (values.list) {
    for (const experiment of experiments) print(`${experiment.name}: ${experiment.getBaseline().name} (baseline), ${experiment.getVariants().map(config => config.name).join(", ")}`);
    return { trials: [], exitCode: 0 };
  }
  const names = values.experiments?.split(",");
  for (const name of names ?? []) if (!experiments.some(experiment => experiment.name === name)) throw new Error(`Unknown experiment: ${name}`);
  const selected = experiments.filter(experiment => !names || names.includes(experiment.name));
  if (!selected.length) throw new Error("No experiments selected.");
  const rubric = selected[0]!.rubric;
  if (selected.some(experiment => JSON.stringify(experiment.rubric) !== JSON.stringify(rubric))) throw new Error("Combined experiments must use the same rubric.");
  const directory = resolve(values.output, `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`);
  mkdirSync(directory, { recursive: true });
  let revision = "unknown";
  try { revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* Also works outside a checkout. */ }
  const metadata = { revision, rubric, experiments: selected.map(experiment => experiment.name), repeats: Number(values.repeats),
    variants: values.variants?.split(","), timeoutMs: Number(values["timeout-ms"]) };
  writeFileSync(`${directory}/manifest.json`, JSON.stringify(metadata, null, 2) + "\n");
  const trials: Trial[] = [];
  const controller = new AbortController(), interrupt = () => controller.abort(new Error("Interrupted"));
  process.once("SIGINT", interrupt);
  try {
    for (const experiment of selected) {
      print(`\nExperiment: ${experiment.name}`);
      await runExperiment(experiment, { repeats: metadata.repeats, timeoutMs: metadata.timeoutMs,
        ...(metadata.variants ? { variants: metadata.variants } : {}), ...(options.secrets ? { secrets: options.secrets } : {}), signal: controller.signal,
        onTrial(trial) {
          trials.push(trial);
          writeFileSync(`${directory}/${String(trials.length).padStart(4, "0")}.json`, JSON.stringify(trial, null, 2) + "\n");
          print(`Run ${trial.repeat} [${trial.variant}${trial.baseline ? ", baseline" : ""}]: ${trial.summary}${trial.recording.error !== undefined ? " [execution error]" : ""}${trial.scoringError !== undefined ? " [judge error]" : ""}`);
        },
      });
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
    const comparison = compareResults(trials, rubric);
    writeFileSync(`${directory}/results.json`, JSON.stringify({ ...metadata, comparison }, null, 2) + "\n");
    print(`\n${formatComparison(comparison, rubric)}\n\nArtifacts: ${directory}`);
  }
  return { trials, directory, exitCode: trials.some(trial => trial.recording.error !== undefined || trial.scoringError !== undefined) ? 1 : 0 };
}
