/**
 * Measuring runtime generation: each place generated from its text several times by the fast
 * model, every round's plan and problems kept, every result drawn by day and by night beside the
 * hand-made Rat and Heron, and a summary of success, repairs, time and cost.
 *
 *   node --no-warnings src/game/map/generate/bench.ts [--runs 5] [--only rat,heron,chandler,chapel]
 *        [--out runs/generate] [--parallel 4] [--no-pictures] [--model openai/gpt-6-luna] [--effort low]
 *   node --no-warnings src/game/map/generate/bench.ts --redraw     (pictures again from the saved plans, no model)
 *   node --no-warnings src/game/map/generate/bench.ts --text "a tannery by the river" --runs 1 --out runs/generate-try
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { drownedRat } from "../../../../scenes/drowned-rat.ts";
import { heronWarehouse } from "../../../../scenes/heron-warehouse.ts";
import { setCallLog, type Effort } from "../../../llm/openrouter.ts";
import "../maps/index.ts";
import { drownedRatWorld } from "../../../../scenes/worlds/drowned-rat.ts";
import { buildWorld } from "../../../world/scene-world.ts";
import { drownedRatDressing, renderStage } from "../../look/index.ts";
import { CAST } from "../looks.ts";
import { compilePlan } from "./compile.ts";
import { stagePicture } from "./dressing.ts";
import { generatePlace, type Generated } from "./generate.ts";
import { picture, stageCompiled, stageHandMade, writePicture, type View } from "./pictures.ts";
import { registerPeople, unregisterPeople } from "./people.ts";
import { castMember, modelPlanner, type CastMember, type PlacePlan } from "./plan.ts";
import { sketch } from "./sketch.ts";
import { errorsOf, validate } from "./validate.ts";

export const PROMPTS: Record<string, { text: string; sceneId?: string; handMade?: string; cast?: CastMember[] }> = {
  rat: { text: drownedRat.setting, sceneId: "drowned-rat", handMade: "drowned-rat", cast: drownedRat.cast.map(castMember) },
  heron: { text: heronWarehouse.setting, sceneId: "heron-warehouse", handMade: "heron-warehouse", cast: heronWarehouse.cast.map(castMember) },
  chandler: { text: "a chandler's shop on the wharves, cluttered with rope and lamp oil" },
  chapel: { text: "a small chapel off the market square, its saint's statue missing a hand" },
  // Unseen: never used while the compiler was being written (--only tannery,watch,bathhouse,stables,bakery).
  tannery: { text: "a tannery on the river bank, its pits stinking, hides stretched on frames in the yard" },
  watch: { text: "the watch house by the north gate: a front office with a desk and a bench for complainants, two cells at the back, and a rack of pikes" },
  bathhouse: { text: "a public bathhouse with a changing room, a steaming hot room and a cold plunge pool, run by a retired pirate" },
  stables: { text: "the stable yard behind a coaching inn: stalls along one side, a hayloft ladder, a water trough and a coach with a broken wheel" },
  bakery: { text: "a baker's shop with the ovens at the back, flour everywhere, and a cat asleep on the warm bread shelf" },
};

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1]! : fallback; };
// One place of your own: --text "a tannery by the river, stinking" (runs as the prompt "custom").
if (args.includes("--text")) PROMPTS.custom = { text: opt("text", "") };
const runs = Number(opt("runs", "5"));
const only = opt("only", args.includes("--text") ? "custom" : "rat,heron,chandler,chapel").split(",");
const out = opt("out", "runs/generate");
const parallel = Number(opt("parallel", "4"));
const pictures = !args.includes("--no-pictures");
const model = opt("model", "");
const effort = opt("effort", "low") as Effort;
const VIEWS: Array<[View, "afternoon" | "night"]> = [["scene", "afternoon"], ["scene", "night"], ["outside", "afternoon"]];

interface Record_ {
  key: string; prompt: string; run: number; ok: boolean; repairs: number; ms: number; costUsd: number;
  rounds: Array<{ errors: number; modelMs: number; compileMs: number; costUsd: number; inputTokens: number; outputTokens: number; failed?: string }>;
  errors: string[]; warnings: number; notes: string[]; size?: string; rooms?: number; things?: number;
}

function draw(key: string, place: ReturnType<typeof compilePlan>): void {
  // Its people with their own letters while it's drawn, as installPlace would have them.
  registerPeople(place.id, place.looks);
  try {
    const staged = stageCompiled(place);
    for (const [view, time] of VIEWS) writePicture(picture(staged, view, time), join(out, `${key}-${view}-${time === "afternoon" ? "day" : "night"}.png`));
    // And top-down, as the look layer's stage draws a scene world, from the dressing the compiler made.
    writePicture(stagePicture(place, "night", { w: 4 * place.map.width + 4, h: 2 * place.map.height + 2 }), join(out, `${key}-stage-night.png`));
  } finally {
    unregisterPeople(place.id);
  }
}

async function main(): Promise<void> {
  mkdirSync(out, { recursive: true });
  if (args.includes("--redraw")) return redraw();
  setCallLog(join(out, "calls.jsonl"));
  const planner = modelPlanner({ ...(model ? { model } : {}), effort });
  const jobs = only.flatMap(prompt => Array.from({ length: runs }, (_, i) => ({ prompt, run: i + 1 })));
  const records: Record_[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { prompt, run } = jobs[next++]!;
      const key = `${prompt}-${run}`;
      const p = PROMPTS[prompt]!;
      const dir = join(out, key);
      mkdirSync(dir, { recursive: true });
      let result: Generated;
      try {
        result = await generatePlace(p.text, {
          id: `generated-${key}`, ...(p.sceneId ? { sceneId: p.sceneId } : {}), ...(p.cast ? { cast: p.cast } : {}), planner,
          onRound: (r, i) => {
            writeFileSync(join(dir, `plan-${i}.json`), JSON.stringify(r.plan, null, 1));
            writeFileSync(join(dir, `problems-${i}.txt`), r.problems.map(x => `[${x.severity}] ${x.check} ${x.subject}: ${x.message}`).join("\n") + "\n");
            process.stderr.write(`${key} round ${i}: ${r.failed ? `failed (${r.failed.slice(0, 120)})` : `${r.errors} errors`} in ${(r.modelMs / 1000).toFixed(1)} s, $${r.costUsd.toFixed(4)}\n`);
          },
        });
      } catch (error) {
        process.stderr.write(`${key}: ${error instanceof Error ? error.stack : error}\n`);
        continue;
      }
      const place = result.place;
      if (place) {
        writeFileSync(join(dir, "sketch.txt"), `${sketch(place)}\n`);
        writeFileSync(join(dir, "world.json"), JSON.stringify(place.world, null, 1));
        if (pictures) draw(key, place);
      }
      const rec: Record_ = {
        key, prompt, run, ok: result.ok, repairs: result.repairs, ms: Math.round(result.ms), costUsd: result.costUsd,
        rounds: result.rounds.map(r => ({ errors: r.errors, modelMs: Math.round(r.modelMs), compileMs: Math.round(r.compileMs), costUsd: r.costUsd, inputTokens: r.inputTokens, outputTokens: r.outputTokens, ...(r.failed ? { failed: r.failed } : {}) })),
        errors: errorsOf(result.problems).map(x => `${x.check}: ${x.message}`), warnings: result.problems.length - errorsOf(result.problems).length,
        notes: place?.notes ?? [],
        ...(place ? { size: `${place.site.building.w * 5}x${place.site.building.h * 5} ft, map ${place.map.width}x${place.map.height}`, rooms: place.site.areas.size, things: place.furnished.things.size } : {}),
      };
      records.push(rec);
      process.stderr.write(`${key}: ${rec.ok ? "OK" : "FAILED"} after ${rec.repairs} repairs, ${(rec.ms / 1000).toFixed(1)} s, $${rec.costUsd.toFixed(4)}\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, parallel) }, worker));
  records.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  if (pictures) handMade();
  const previous = existsSync(join(out, "results.json")) ? (JSON.parse(readFileSync(join(out, "results.json"), "utf8")) as { records: Record_[] }).records.filter(r => !records.some(x => x.key === r.key)) : [];
  const all = [...previous, ...records].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  writeFileSync(join(out, "results.json"), JSON.stringify({ at: new Date().toISOString(), model: model || "openai/gpt-6-luna", effort, records: all }, null, 1));
  writeFileSync(join(out, "summary.md"), summary(all));
  process.stdout.write(summary(all));
}

function handMade(): void {
  for (const [key, id] of [["handmade-rat", "drowned-rat"], ["handmade-heron", "heron-warehouse"]] as const) {
    const staged = stageHandMade(id);
    for (const [view, time] of VIEWS) writePicture(picture(staged, view, time), join(out, `${key}-${view}-${time === "afternoon" ? "day" : "night"}.png`));
  }
  // The Rat has a hand-written dressing for the stage (the Heron has none).
  const rat = buildWorld("drowned-rat", drownedRatWorld, ["nan-quill", "arlo", "dilly", "hobb", "cob"].map(id => ({ id, name: CAST[id]!.name })), { name: "you" });
  writePicture(renderStage(rat, drownedRatDressing, { w: 4 * 13 + 4, h: 2 * 13 + 2, t: 1200, time: "night" }).toLines(), join(out, "handmade-rat-stage-night.png"));
}

/** Pictures again from the saved plans (after a change to the compiler), and the checks again. */
function redraw(): void {
  const keys = readdirSync(out).filter(d => /^[a-z]+-\d+$/.test(d) && only.includes(d.replace(/-\d+$/, "")));
  for (const key of keys) {
    const dir = join(out, key);
    const plans = readdirSync(dir).filter(f => /^plan-\d+\.json$/.test(f)).sort();
    let best: { place: ReturnType<typeof compilePlan>; errors: number; problems: ReturnType<typeof validate> } | undefined;
    for (const f of plans) {
      const plan = JSON.parse(readFileSync(join(dir, f), "utf8")) as PlacePlan;
      if (!plan.rooms) continue;
      const prompt = PROMPTS[key.replace(/-\d+$/, "")]!;
      const place = compilePlan(plan, { id: `generated-${key}`, ...(prompt.sceneId ? { sceneId: prompt.sceneId } : {}), ...(prompt.cast ? { cast: prompt.cast } : {}) });
      const problems = validate(place);
      const errors = errorsOf(problems).length;
      if (!best || errors <= best.errors) best = { place, errors, problems };
      if (!errors) break;
    }
    if (!best) continue;
    writeFileSync(join(dir, "sketch.txt"), `${sketch(best.place)}\n`);
    if (pictures) draw(key, best.place);
    process.stdout.write(`${key}: ${best.errors} errors${best.errors ? `\n  ${errorsOf(best.problems).map(p => p.message).join("\n  ")}` : ""}\n`);
  }
  if (pictures) handMade();
}

function summary(records: Record_[]): string {
  const lines = ["| place | run | passed | repairs | time (s) | model calls (s) | cost ($) | tokens out | errors left |", "|---|---|---|---|---|---|---|---|---|"];
  for (const r of records) {
    lines.push(`| ${r.prompt} | ${r.run} | ${r.ok ? "yes" : "no"} | ${r.repairs} | ${(r.ms / 1000).toFixed(1)} | ${r.rounds.map(x => (x.modelMs / 1000).toFixed(1)).join(" + ")} | ${r.costUsd.toFixed(4)} | ${r.rounds.reduce((n, x) => n + x.outputTokens, 0)} | ${r.errors.length} |`);
  }
  lines.push("", "| place | passed | first try | mean repairs | median time (s) | max time (s) | mean cost ($) |", "|---|---|---|---|---|---|---|");
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[Math.floor((s.length - 1) / 2)]! + s[Math.ceil((s.length - 1) / 2)]!) / 2 : 0; };
  for (const prompt of [...new Set(records.map(r => r.prompt))]) {
    const rs = records.filter(r => r.prompt === prompt);
    lines.push(`| ${prompt} | ${rs.filter(r => r.ok).length}/${rs.length} | ${rs.filter(r => r.ok && r.repairs === 0).length}/${rs.length} | ${(rs.reduce((n, r) => n + r.repairs, 0) / rs.length).toFixed(1)} | ${(median(rs.map(r => r.ms)) / 1000).toFixed(1)} | ${(Math.max(...rs.map(r => r.ms)) / 1000).toFixed(1)} | ${(rs.reduce((n, r) => n + r.costUsd, 0) / rs.length).toFixed(4)} |`);
  }
  return `${lines.join("\n")}\n`;
}

await main();
