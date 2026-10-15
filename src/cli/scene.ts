import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { setCallLog, sessionSpend } from "../llm/openrouter.ts";
import { APPROACHES, approachById } from "../runtime/approaches.ts";
import { chainScene, createSession, openScene, playerTurn, transcriptMarkdown, type TurnHooks } from "../runtime/engine.ts";
import { applyRepair, shouldRepair } from "../runtime/repair.ts";
import { rememberJob, rememberLock, repairJob, repairLock } from "../runtime/jobs.ts";
import { loadSession, saveSession, sessionDir, type Entry, type SessionState } from "../runtime/session.ts";
import { SCENES, sceneById } from "../../scenes/index.ts";
import { describeOperations, scribe } from "../world/scribe.ts";
import { listDocs, readDoc } from "../lore/docs.ts";
import { sheetText } from "../rules/dnd.ts";
import { asciiMap } from "../world/scene-world.ts";

const USAGE = `Kingmaker V2 scene harness

  scene list                                   scenes and approaches
  scene start <scene> [--approach v2] [--as "Name: concept"] [--level 3] [--seed N] [--session ID]
                                               start a scene; prints the session id and the opening
  scene say <session> <what you say or do>     take a turn (talk as your character; actions in *asterisks* or (parentheses))
  scene sheet <session>                        your D&D character sheet (also /sheet while playing)
  scene map <session>                          a top-down sketch of the scene's world (also #map)
  scene transcript <session>                   the scene so far
  scene status <session>                       debug view: beat, path, co-GM notes, latency (not for blind QA)
  scene world <session> [--mode reconcile]     Phase 2: write world-update scripts for every finished scene
  scene play <scene> [--approach v2]           interactive play on a terminal
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
}

function nameOf(state: SessionState, speaker: string): string {
  if (speaker === "player") return state.player.name;
  return sceneById(state.sceneId).cast.find(c => c.id === speaker)?.name ?? speaker;
}

function render(state: SessionState, e: Entry): string {
  switch (e.kind) {
    case "player": return `> ${e.text}`;
    case "roll": return `🎲 ${e.text}`;
    case "system": return `— ${e.text} —`;
    case "dialogue": return `${nameOf(state, e.speaker)}: ${e.text}`;
    default: return e.text;
  }
}

/** Print finished entries; stream text on a real terminal. */
function printer(state: SessionState): TurnHooks {
  if (!process.stdout.isTTY) return { onEntry: e => { if (e.kind !== "player") console.log(`${render(state, e)}\n`); } };
  let shown = 0;
  return {
    onSpeaker: (speaker, kind) => { shown = 0; if (kind === "dialogue") process.stdout.write(`${nameOf(state, speaker)}: `); },
    onText: text => { process.stdout.write(text.slice(shown)); shown = text.length; },
    onEntry: e => {
      if (e.kind === "player") return;
      if (e.kind === "roll" || e.kind === "system") console.log(`${render(state, e)}\n`);
      else process.stdout.write("\n\n");
    },
  };
}

function spawnRepair(state: SessionState): void {
  const approach = approachById(state.approach);
  if (!["background", "stall", "quick-block"].includes(approach.repair) || state.ended || !shouldRepair(state)) return;
  writeFileSync(repairLock(state.id), String(state.turn));
  const child = spawn(process.execPath, [import.meta.filename, "repair", state.id, "--turn", String(state.turn)], { detached: true, stdio: "ignore", env: process.env });
  child.unref();
}

/** Docs-service memory: the attention filter and memory review run in the background after each turn. */
function spawnRemember(state: SessionState): void {
  if (!approachById(state.approach).memory) return;
  writeFileSync(rememberLock(state.id, state.turn), String(state.turn));
  const child = spawn(process.execPath, [import.meta.filename, "remember", state.id, "--turn", String(state.turn), "--scene", state.sceneId], { detached: true, stdio: "ignore", env: process.env });
  child.unref();
}

async function waitForRepair(id: string): Promise<void> {
  // The co-GM is background work: by default never hold the player's turn for it.
  const limit = Date.now() + Number(process.env.KM_REPAIR_WAIT_MS ?? 0);
  while (existsSync(repairLock(id)) && Date.now() < limit) await new Promise(r => setTimeout(r, 250));
}

async function afterTurn(state: SessionState, hooks: TurnHooks): Promise<void> {
  // Memory is background work: never hold the story for it. Late memories are picked up by disclosure.
  spawnRemember(state);
  if (!state.ended) { spawnRepair(state); return; }
  const scene = sceneById(state.sceneId);
  const exit = scene.exits.find(e => e.id === state.ended!.exitId)!;
  if (exit.kind === "combat") console.log("(The fight plays out on the map. For this PoC, the party wins.)\n");
  const chained = await chainScene(state);
  if (chained) {
    console.log(`— Next scene: ${sceneById(chained.sceneId).title} —\n`);
    await openScene(chained, hooks);
  } else {
    console.log("— The End. (The session is over.) —");
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (!command || command === "help" || command === "--help") { console.log(USAGE); return; }

  if (command === "list") {
    console.log("Scenes:");
    for (const s of SCENES) console.log(`  ${s.id.padEnd(24)} ${s.summary}`);
    console.log("\nApproaches:");
    for (const a of Object.values(APPROACHES)) console.log(`  ${a.id.padEnd(24)} ${a.description}`);
    return;
  }

  if (command === "start" || command === "play") {
    const approach = flag(args, "approach") ?? "v2";
    const player = flag(args, "as");
    const seed = flag(args, "seed");
    const id = flag(args, "session");
    const level = flag(args, "level");
    const sceneId = args.shift();
    if (!sceneId) throw new Error("Which scene? See `scene list`.");
    let who = player;
    if (command === "play" && !who && process.stdin.isTTY) {
      const ask = createInterface({ input: process.stdin, output: process.stdout });
      console.log("Who are you? Give a name and a few words about yourself, e.g. \"Wren Ashdown: a quick-witted half-elf ranger with a dry sense of humour\".");
      const answer = (await ask.question("(Enter for Wren Ashdown) > ")).trim();
      ask.close();
      if (answer) who = answer.includes(":") ? answer : `${answer}: an investigator lent to the case by the King`;
    }
    const state = await createSession({ sceneId, approach, ...(who ? { player: who } : {}), ...(seed ? { seed: Number(seed) } : {}), ...(id ? { id } : {}), ...(level ? { level: Math.max(1, Math.min(20, Number(level))) } : {}) });
    setCallLog(join(sessionDir(state.id), "calls.jsonl"));
    saveSession(state);
    console.log(`Session: ${state.id}\nYou are ${state.player.name}: ${state.player.concept}${state.player.build ? `\nIn game terms: ${state.player.build} (/sheet shows your character sheet)` : ""}\n`);
    console.log(`${sceneById(sceneId).hook}\n`);
    const hooks = printer(state);
    await openScene(state, hooks);
    if (command === "start") return;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    for (;;) {
      const line = (await rl.question("> ")).trim();
      if (!line) continue;
      if (line === "/quit") break;
      if (/^[#/]sheet$/i.test(line)) { console.log(`${await sheetText(loadSession(state.id))}\n`); continue; }
      if (/^[#/]map$/i.test(line)) { const s = loadSession(state.id); console.log(`${s.world ? asciiMap(s.world) : "(This scene has no map yet.)"}\n`); continue; }
      await waitForRepair(state.id);
      const current = loadSession(state.id);
      await playerTurn(current, line, printer(current));
      await afterTurn(current, printer(current));
      if (current.ended) break; // the last scene ended with nowhere to go next
    }
    rl.close();
    return;
  }

  if (command === "say") {
    const id = args.shift();
    const text = args.join(" ").trim();
    if (!id || !text) throw new Error("Usage: scene say <session> <what you say or do>");
    await waitForRepair(id);
    const state = loadSession(id);
    setCallLog(join(sessionDir(id), "calls.jsonl"));
    if (/^[#/]sheet$/i.test(text)) { console.log(await sheetText(state)); return; }
    if (/^[#/]map$/i.test(text)) { console.log(state.world ? asciiMap(state.world) : "(This scene has no map yet.)"); return; }
    if (state.ended) { console.log("— The story is over: this session has ended. —"); return; }
    const hooks = printer(state);
    await playerTurn(state, text, hooks);
    await afterTurn(state, hooks);
    return;
  }

  if (command === "remember") {
    const id = args.shift()!;
    const turn = Number(flag(args, "turn"));
    await rememberJob(id, turn, flag(args, "scene"));
    return;
  }

  if (command === "memories") {
    const id = args.shift();
    if (!id) throw new Error("Usage: scene memories <session>");
    for (const path of listDocs(id).sort()) {
      const doc = readDoc(id, path)!;
      console.log(`## ${path}  [${doc.meta.visibility}${doc.meta.readers ? ` ${doc.meta.readers.join(",")}` : ""}]\n${doc.meta.context ? `(${doc.meta.context})\n` : ""}${doc.body}\n`);
    }
    return;
  }

  if (command === "repair") {
    const id = args.shift()!;
    const turn = Number(flag(args, "turn"));
    await repairJob(id, turn);
    return;
  }

  if (command === "world") {
    const id = args.shift()!;
    const mode = (flag(args, "mode") ?? "reconcile") as "append" | "reconcile";
    setCallLog(join(sessionDir(id), "calls.jsonl"));
    const dir = join(sessionDir(id), "snapshots");
    const endings = (existsSync(dir) ? readdirSync(dir) : []).sort()
      .map(f => JSON.parse(readFileSync(join(dir, f), "utf8")) as SessionState).filter(s => s.ended);
    if (!endings.length) { console.log("No finished scenes in this session yet."); return; }
    for (const ended of endings) {
      const scene = sceneById(ended.sceneId);
      const exit = scene.exits.find(e => e.id === ended.ended!.exitId);
      console.log(`## ${scene.title}: ended "${exit?.title ?? ended.ended!.exitId}"\n`);
      const result = await scribe(scene, ended, ended.ended!.operations, { mode });
      console.log("What changes, and why:");
      for (const c of result.changes) console.log(`- ${c.what} (${c.why})`);
      console.log(`\nWorld operations (${mode === "append" ? "after the authored script" : "reconciled with the authored defaults"}):`);
      console.log(describeOperations(result.check.operations));
      const problems = [...result.check.typeErrors, ...(result.check.runtimeError ? [result.check.runtimeError] : []), ...result.check.warnings];
      console.log(`\nScript: ${result.check.ok ? "typechecks and runs" : "has problems"} (${result.attempts} attempt${result.attempts === 1 ? "" : "s"})${problems.length ? `\n${problems.join("\n")}` : ""}\n`);
      writeFileSync(join(sessionDir(id), `world-${ended.sceneId}.ts`), `// World update for "${scene.title}" (${exit?.title}), written by the scribe\nfunction update(world: WorldApi): void {\n${result.check.body.replace(/^function update\([^)]*\)[^{]*\{\n?/, "").replace(/\}\s*$/, "")}\n}\n`);
    }
    return;
  }

  if (command === "map") {
    const state = loadSession(args.shift()!);
    console.log(state.world ? asciiMap(state.world) : "(This scene has no map yet.)");
    return;
  }

  if (command === "sheet") {
    console.log(await sheetText(loadSession(args.shift()!)));
    return;
  }

  if (command === "transcript") {
    const state = loadSession(args.shift()!);
    console.log(transcriptMarkdown(state, { allScenes: true }));
    return;
  }

  if (command === "status") {
    const state = loadSession(args.shift()!);
    const turns = state.metrics;
    const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
    console.log(JSON.stringify({
      scene: state.sceneId, approach: state.approach, turn: state.turn, beat: state.beat, turnsInBeat: state.turnsInBeat,
      path: state.path.map(p => `${p.turn}: ${p.from} -> ${p.to} via ${p.via} (${p.source})${p.roll ? ` [${p.roll.skill} ${p.roll.total}/${p.roll.dc}]` : ""}`),
      ended: state.ended?.exitId, notes: state.notes, canon: state.canon, established: state.established,
      patches: state.patches.map(p => p.beat ? `beat ${p.beat.id}` : p.transition ? `${p.transition.beat} + ${p.transition.transition.when}` : p.close ? `${p.close.beat} - ${p.close.id}` : `${p.cast?.id} keeps back: ${p.cast?.secrets.join(" ")}`),
      rulings: (state.rulings ?? []).map(r => `${r.turn}: ${r.act} -> ${r.kind === "roll" ? `${r.skill} DC ${r.dc}${r.roll ? ` (${r.roll.total})` : ""}` : `${r.kind}, no roll`} [${r.why}]: ${r.went}: ${r.changed}`),
      repairs: state.repairs.map(r => `${r.turn}: ${r.status} — ${r.assessment}`),
      latency: { avgFirstTextMs: avg(turns.map(t => t.firstTextMs ?? t.replyMs)), avgPreDecisionMs: avg(turns.map(t => t.preDecisionMs)), avgReplyMs: avg(turns.map(t => t.replyMs)), consideredTurns: turns.filter(t => t.considerMs !== undefined).length, avgConsiderMs: avg(turns.flatMap(t => t.considerMs !== undefined ? [t.considerMs] : [])) },
      costUsd: turns.reduce((a, t) => a + t.costUsd, 0).toFixed(5),
      operations: state.ended?.operations,
      history: state.history,
    }, null, 1));
    return;
  }

  console.log(USAGE);
  process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(() => { void sessionSpend; void readFileSync; void applyRepair; });
