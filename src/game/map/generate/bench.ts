/**
 * Measuring runtime generation: each place generated from its text several times by the fast
 * model, every round's plan and problems kept, every result drawn by day and by night beside the
 * hand-made Rat and Heron, and a summary of success, repairs, time and cost.
 *
 *   node --no-warnings src/game/map/generate/bench.ts [--runs 5] [--only rat,heron,chandler,chapel]
 *        [--out runs/generate] [--parallel 4] [--no-pictures] [--model openai/gpt-6-luna]
 *        [--effort none] [--format compact|verbose]
 *   node --no-warnings src/game/map/generate/bench.ts --redraw     (pictures again from the saved plans, no model)
 *   node --no-warnings src/game/map/generate/bench.ts --text "a tannery by the river" --runs 1 --out runs/generate-try
 *
 * The look layer's model calls are part of a generation (looks.ts): the bench gives each run
 * directory a cache of its own (KM_LOOK_CACHE, unless set), so the first places pay for the looks
 * the rules don't know and later ones mostly don't, as in a new game.
 */
import { execFileSync } from "node:child_process";
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
  // The spike's unseen places (seen since: their plans were read while the look rules were fixed).
  tannery: { text: "a tannery on the river bank, its pits stinking, hides stretched on frames in the yard" },
  watch: { text: "the watch house by the north gate: a front office with a desk and a bench for complainants, two cells at the back, and a rack of pikes" },
  bathhouse: { text: "a public bathhouse with a changing room, a steaming hot room and a cold plunge pool, run by a retired pirate" },
  stables: { text: "the stable yard behind a coaching inn: stalls along one side, a hayloft ladder, a water trough and a coach with a broken wheel" },
  bakery: { text: "a baker's shop with the ovens at the back, flour everywhere, and a cat asleep on the warm bread shelf" },
  // Unseen: never run while this version was written (--only cooper,harbour,pawnshop,herbalist,kitchen).
  cooper: { text: "a cooper's workshop by the brewery, barrels in every state of being built, and the cooper's dog asleep in the shavings" },
  harbour: { text: "the harbourmaster's office at the end of the pier, a telescope at the window and charts pinned to every wall" },
  pawnshop: { text: "a pawnbroker's shop in a back lane, its counter caged in iron, every shelf crammed with things people swore they'd come back for" },
  herbalist: { text: "a herbalist's cottage at the edge of the marsh, bunches of herbs drying from the beams and a cauldron simmering on the hearth" },
  kitchen: { text: "the guildhall kitchen the night before the Assembly feast: three ovens going, a long table of pies, and a pastry cook having hysterics" },
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
const effort = opt("effort", "none") as Effort;
const format = opt("format", "compact") as "compact" | "verbose";
const VIEWS: Array<[View, "afternoon" | "night"]> = [["scene", "afternoon"], ["scene", "night"], ["outside", "afternoon"]];
process.env.KM_LOOK_CACHE ??= join(out, "look-cache.json");

interface Record_ {
  key: string; prompt: string; run: number; ok: boolean; repairs: number; ms: number; shellMs?: number; costUsd: number;
  rounds: Array<{ errors: number; modelMs: number; compileMs: number; shellMs?: number; thingsMs?: number; costUsd: number; inputTokens: number; outputTokens: number; failed?: string }>;
  looks?: { calls: number; costUsd: number; ms: number; names: string[] };
  /** The building laid out from the rooms while the things streamed was the one furnished. */
  shellKept?: boolean;
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
  const planner = modelPlanner({ ...(model ? { model } : {}), effort, format });
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
      let shellSize: string | undefined;
      try {
        result = await generatePlace(p.text, {
          id: `generated-${key}`, ...(p.sceneId ? { sceneId: p.sceneId } : {}), ...(p.cast ? { cast: p.cast } : {}), planner,
          onShell: (shell, ms) => { shellSize ??= `${shell.site.building.w}x${shell.site.building.h}`; process.stderr.write(`${key}: the building at ${(ms / 1000).toFixed(1)} s (${shell.site.building.w}x${shell.site.building.h})\n`); },
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
        key, prompt, run, ok: result.ok, repairs: result.repairs, ms: Math.round(result.ms), ...(result.shellMs !== undefined ? { shellMs: Math.round(result.shellMs) } : {}), costUsd: result.costUsd,
        rounds: result.rounds.map(r => ({ errors: r.errors, modelMs: Math.round(r.modelMs), compileMs: Math.round(r.compileMs), ...(r.shellMs !== undefined ? { shellMs: Math.round(r.shellMs) } : {}), ...(r.thingsMs !== undefined ? { thingsMs: Math.round(r.thingsMs) } : {}), costUsd: r.costUsd, inputTokens: r.inputTokens, outputTokens: r.outputTokens, ...(r.failed ? { failed: r.failed } : {}) })),
        ...(result.looks ? { looks: { calls: result.looks.calls, costUsd: result.looks.costUsd, ms: Math.round(result.looks.ms), names: result.looks.names } } : {}),
        ...(shellSize && place ? { shellKept: result.repairs === 0 && shellSize === `${place.site.building.w}x${place.site.building.h}` } : {}),
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
  if (pictures) { handMade(); sheets(records.map(r => r.prompt)); }
  const previous = existsSync(join(out, "results.json")) ? (JSON.parse(readFileSync(join(out, "results.json"), "utf8")) as { records: Record_[] }).records.filter(r => !records.some(x => x.key === r.key)) : [];
  const all = [...previous, ...records].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  writeFileSync(join(out, "results.json"), JSON.stringify({ at: new Date().toISOString(), model: model || "openai/gpt-6-luna", effort, format, records: all }, null, 1));
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

/** Contact sheets: each place's runs by night and by day, beside the hand-made Rat and Heron. */
function sheets(prompts: string[]): void {
  const keys = (prompt: string) => readdirSync(out).filter(f => new RegExp(`^${prompt}-\\d+-scene-night\\.png$`).test(f)).map(f => f.replace(/-scene-night\.png$/, "")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const prompt of [...new Set(prompts)]) {
    for (const time of ["night", "day"]) {
      const items = [...["rat", "heron"].map(h => `${join(out, `handmade-${h}-scene-${time}.png`)}:hand-made ${h}`), ...keys(prompt).map(k => `${join(out, `${k}-scene-${time}.png`)}:${k}`)];
      try { execFileSync("python3", [join(process.cwd(), "tools", "sheet.py"), join(out, `sheet-${prompt}-${time}.png`), "--height", "460", "--cols", "4", ...items], { stdio: "pipe" }); } catch { /* pictures are a nicety */ }
    }
  }
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
  if (pictures) { handMade(); sheets(keys.map(k => k.replace(/-\d+$/, ""))); }
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[Math.floor((s.length - 1) / 2)]! + s[Math.ceil((s.length - 1) / 2)]!) / 2 : 0; };
const p90 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)]! : 0; };
const s1 = (ms: number) => (ms / 1000).toFixed(1);

function summary(records: Record_[]): string {
  const lines = ["| place | run | passed | repairs | time (s) | building at (s) | model calls (s) | looks (calls, s) | cost ($) | tokens out | errors left |", "|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const r of records) {
    lines.push(`| ${r.prompt} | ${r.run} | ${r.ok ? "yes" : "no"} | ${r.repairs} | ${s1(r.ms)} | ${r.shellMs !== undefined ? s1(r.shellMs) : "-"} | ${r.rounds.map(x => s1(x.modelMs)).join(" + ")} | ${r.looks ? `${r.looks.calls}, ${s1(r.looks.ms)}` : "-"} | ${r.costUsd.toFixed(4)} | ${r.rounds.reduce((n, x) => n + x.outputTokens, 0)} | ${r.errors.length} |`);
  }
  lines.push("", "| place | passed | first try | mean repairs | median time (s) | max time (s) | median building at (s) | mean cost ($) | look calls |", "|---|---|---|---|---|---|---|---|---|");
  const row = (label: string, rs: Record_[]) => `| ${label} | ${rs.filter(r => r.ok).length}/${rs.length} | ${rs.filter(r => r.ok && r.repairs === 0).length}/${rs.length} | ${(rs.reduce((n, r) => n + r.repairs, 0) / rs.length).toFixed(1)} | ${s1(median(rs.map(r => r.ms)))} | ${s1(Math.max(...rs.map(r => r.ms)))} | ${rs.some(r => r.shellMs !== undefined) ? s1(median(rs.filter(r => r.shellMs !== undefined).map(r => r.shellMs!))) : "-"} | ${(rs.reduce((n, r) => n + r.costUsd, 0) / rs.length).toFixed(4)} | ${rs.reduce((n, r) => n + (r.looks?.calls ?? 0), 0)} |`;
  for (const prompt of [...new Set(records.map(r => r.prompt))]) lines.push(row(prompt, records.filter(r => r.prompt === prompt)));
  lines.push(row("all", records));
  const outTokens = records.map(r => median(r.rounds.map(x => x.outputTokens)));
  lines.push("", `Times: median ${s1(median(records.map(r => r.ms)))} s, p90 ${s1(p90(records.map(r => r.ms)))} s, max ${s1(Math.max(...records.map(r => r.ms)))} s. Output tokens per call, median: ${median(outTokens)}. The building laid out from the rooms was the one furnished in ${records.filter(r => r.shellKept).length} of ${records.filter(r => r.shellKept !== undefined).length} first-try runs. Total cost $${records.reduce((n, r) => n + r.costUsd, 0).toFixed(4)}.`);
  return `${lines.join("\n")}\n`;
}

await main();
