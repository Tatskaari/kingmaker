/**
 * Memory smoke runner: play scripted turns through chained scenes with the docs service, waiting
 * for each turn's memory review (as the CLI's background child would), then print what each
 * person remembers and what was opened when.
 *
 * node --no-warnings src/eval/memory-run.ts <script.json> [--approach v2-memory] [--session id]
 * script.json: { "scene": "crossroads-ambush", "turns": ["...", "..."] }  (a turn "#end" stops early)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sceneById } from "../../scenes/index.ts";
import { listDocs, readDoc } from "../lore/docs.ts";
import { rememberTurn } from "../lore/remember.ts";
import { reviewTurn } from "../lore/reviews.ts";
import { approachById } from "../runtime/approaches.ts";
import { setCallLog } from "../llm/openrouter.ts";
import { effectiveScene } from "../runtime/brief.ts";
import { chainScene, createSession, forceEnding, openScene, playerTurn } from "../runtime/engine.ts";
import { sessionDir } from "../runtime/session.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const script = JSON.parse(readFileSync(args[0]!, "utf8")) as { scene: string; turns: string[] };
const approach = flag("approach") ?? "v2-memory";
const state = await createSession({ sceneId: script.scene, approach, ...(flag("session") ? { id: flag("session")! } : {}) });
setCallLog(join(sessionDir(state.id), "calls.jsonl"));
const show = (text: string) => console.log(text.split("\n").map(l => `   ${l}`).join("\n"));
console.log(`# ${state.id} (${approach})\n## ${sceneById(state.sceneId).title}`);
for (const e of await openScene(state)) show(e.text);
for (const say of script.turns) {
  if (say === "#end") break;
  if (say.startsWith("#end ")) {
    if (!state.ended) forceEnding(state, say.slice(5).trim());
    const next = await chainScene(state);
    if (!next) { console.log("\n— end —"); break; }
    console.log(`\n## ${sceneById(next.sceneId).title}`);
    for (const e of await openScene(next)) show(e.text);
    continue;
  }
  console.log(`\n> ${say}`);
  const result = await playerTurn(state, say);
  for (const e of result.entries.filter(x => x.kind !== "player")) show(e.text);
  const opened = (state.memory?.opened ?? []).filter(n => n.turn === state.turn).map(n => n.title);
  if (opened.length) console.log(`   [opened: ${opened.join("; ")}]`);
  const memory = approachById(approach).memory;
  const scene = effectiveScene(sceneById(state.sceneId), state.patches);
  if (memory === "lite") {
    const r = await rememberTurn(scene, state, state.turn).catch(e => ({ flagged: [`error: ${e}`], saved: [], costUsd: 0 }));
    console.log(`   [attention: ${r.flagged.join(", ") || "-"}; saved ${r.saved.length}]`);
  } else if (memory === "docs") {
    const r = await reviewTurn(scene, state, state.turn).catch(e => ({ flags: [`error: ${e}`], reviews: [] }));
    console.log(`   [attention: ${r.flags.join(", ") || "-"}]`);
    for (const rv of r.reviews) console.log(`   [${rv.kind} review ${Math.round(rv.latencyMs / 1000)}s: ${rv.error ? `ERROR ${rv.error}` : rv.changes.join("; ") || "no change"}]`);
  }
  if (state.ended) {
    const next = await chainScene(state);
    if (!next) { console.log("\n— end —"); break; }
    console.log(`\n## ${sceneById(next.sceneId).title}`);
    for (const e of await openScene(next)) show(e.text);
    const opened = (next.memory?.opened ?? []).map(n => n.title);
    if (opened.length) console.log(`   [opened at opening: ${opened.join("; ")}]`);
  }
}
console.log("\n# Memories");
for (const path of listDocs(state.id).sort()) {
  const doc = readDoc(state.id, path)!;
  if (path.endsWith("index.md")) continue;
  console.log(`- ${path}: ${doc.meta.title} | ${doc.body.replace(/\s+/g, " ").slice(0, 220)}`);
}
