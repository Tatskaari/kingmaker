import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConversationCheckEval, scoreConversationChecks } from "../packages/evals/src/conversation-check-eval.js";
import { classifyConversationTurn } from "../packages/providers/src/conversation-checks.js";
import { JevClient } from "../packages/providers/src/jev.js";

const preview = process.argv.includes("--preview");
const files = process.argv.slice(2).filter(value => value !== "--preview");
if (!files.length) files.push("evals/jev/king-threat.json", "evals/jev/king-greeting.json",
  "evals/jev/rook-claimed-voyage.json", "evals/jev/rook-claimed-favor.json");
const cases = files.map(loadConversationCheckEval);
const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!preview && !apiKey) throw new Error("Set OPENROUTER_API_KEY to run conversation-check evals, or use --preview.");
const repeats = Number(process.env.JEV_EVAL_REPEATS ?? 3);
if (!Number.isInteger(repeats) || repeats < 1) throw new Error("JEV_EVAL_REPEATS must be a positive integer.");
const directory = resolve(process.env.JEV_EVAL_OUTPUT_DIR?.trim() || "eval-output/jev-conversation-checks");
mkdirSync(directory, { recursive: true });
const startedAt = new Date().toISOString();
const path = resolve(directory, `${startedAt.replaceAll(":", "-")}--conversation-checks.json`);
if (preview) {
  writeFileSync(path, JSON.stringify({ startedAt, cases }, null, 2) + "\n");
  console.log(`Scenario-backed inputs for label review: ${path}`);
  process.exit(0);
}
const requests: unknown[] = [];
const client = new JevClient(apiKey!, undefined, request => requests.push(request));
const results = [];
for (const fixture of cases) {
  for (let run = 1; run <= repeats; run++) {
    requests.length = 0;
    try {
      const classification = await classifyConversationTurn(client, fixture.input, AbortSignal.timeout(120_000));
      const score = fixture.expected === undefined ? undefined : scoreConversationChecks(fixture.expected, classification.checks);
      results.push({ name: fixture.name, run, input: fixture.input, expected: fixture.expected, classification, score, requests: [...requests] });
      console.log(`${score === undefined ? "REVIEW" : score.exact ? "PASS" : "FAIL"} ${fixture.name} #${run}: expected ${fixture.expected === undefined ? "unlabeled" : fixture.expected.join(", ") || "none"}; got ${classification.checks.join(", ") || "none"}`);
    } catch (cause) {
      const error = (cause instanceof Error ? cause.message : String(cause)).split(apiKey!).join("[redacted]");
      results.push({ name: fixture.name, run, input: fixture.input, expected: fixture.expected, error, requests: [...requests] });
      console.log(`ERROR ${fixture.name} #${run}: ${error}`);
    }
    // Preserve completed runs even if a later request is interrupted.
    writeFileSync(path, JSON.stringify({ startedAt, repeats, results }, null, 2) + "\n");
  }
}
const scored = results.flatMap(result => result.score ? [result.score] : []);
const sum = (key: "truePositive" | "falsePositive" | "falseNegative") => scored.reduce((total, score) => total + score[key], 0);
const tp = sum("truePositive"), fp = sum("falsePositive"), fn = sum("falseNegative");
const ratio = (numerator: number, denominator: number) => denominator ? `${(numerator / denominator * 100).toFixed(1)}%` : "n/a";
const labeled = results.filter(result => result.expected !== undefined);
console.log(`\nUnlabeled: ${results.length - labeled.length}; errors: ${results.filter(result => result.error).length}`);
console.log(`Exact skills: ${scored.filter(score => score.exact).length}/${labeled.length}; roll/no-roll: ${scored.filter(score => score.rollCorrect).length}/${labeled.length}`);
console.log(`Skill precision: ${ratio(tp, tp + fp)}; recall: ${ratio(tp, tp + fn)} (completed runs only)\nArtifacts: ${path}`);
if (results.some(result => result.error || result.score?.exact === false)) process.exitCode = 1;
