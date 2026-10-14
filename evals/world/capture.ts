import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "../../src/llm/openrouter.ts";
import type { Entry, SessionState } from "../../src/runtime/session.ts";
import { damageThing, worldView, type SceneWorld } from "../../src/world/scene-world.ts";
import type { StageTrace } from "./stage-trace.ts";
import type { WorldCase } from "./types.ts";

/**
 * Turn played sessions into unlabelled eval cases (labels are added by hand, reading the reply):
 *
 *   node --no-warnings evals/world/capture.ts <session dir> <turn,turn...> [--out evals/world/cases]
 *
 * With a stage trace (sessions played through evals/world/play.ts), the world is exactly what the
 * stage manager read. Without one (older sessions), it's the previous turn's snapshot plus this
 * turn's rules effects, replayed from the dice lines with the current world code; the result is
 * checked against the world view the stage manager logged, and differences are printed.
 */

interface Call { operation: string; text?: string; request?: { instructions?: string; input?: Message[] } }

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const out = outIndex >= 0 ? args.splice(outIndex, 2)[1]! : "evals/world/cases";
const [dir, turnList] = args;
if (!dir) throw new Error("Usage: capture.ts <session dir> [turns] [--out dir]");
const session = dir.replace(/\/$/, "").split("/").at(-1)!;
const state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as SessionState;
const calls = existsSync(join(dir, "calls.jsonl")) ? readFileSync(join(dir, "calls.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l) as Call) : [];
const traceFile = join(dir, "stage-trace.jsonl");
const traces = existsSync(traceFile) ? readFileSync(traceFile, "utf8").trim().split("\n").map(l => JSON.parse(l) as StageTrace) : [];
const wanted = turnList ? new Set(turnList.split(",").map(Number)) : undefined;

/** The GM's own call for a reply: the last gm.* call that produced exactly this text. */
function gmCall(reply: string): WorldCase["gm"] {
  const call = calls.filter(c => c.operation.startsWith("gm.") && c.text?.trim() === reply.trim()).at(-1);
  return call?.request?.instructions && call.request.input ? { instructions: call.request.instructions, input: call.request.input } : undefined;
}

/** Dice lines of a turn in the scene, before its narration. */
function rulesLines(entries: Entry[], scene: string, turn: number): string[] {
  return entries.filter(e => e.turn === turn && (e.scene ?? scene) === scene && e.kind === "roll").map(e => e.text);
}

/** What the stage manager logged as "the world before this exchange", for checking reconstructions. */
function loggedView(playerTurn: string): string | undefined {
  const call = calls.filter(c => c.operation === "world.stage").find(c => c.request?.input?.[0]?.content.includes(`Player: ${playerTurn}`));
  const text = call?.request?.input?.[0]?.content;
  return text?.split("## The world before this exchange\n")[1]?.split("\n\nThe player character is")[0];
}

/** Replay a turn's damage to things from its dice lines ("The X takes N fire damage..."), and people knocked down. */
function replayRules(world: SceneWorld, lines: string[], turn: number): void {
  for (const line of lines) {
    const thing = /^(.+?) takes (\d+) (\w+) damage/.exec(line);
    const unharmed = /^(.+?): unharmed by the (\w+)/.exec(line);
    const m = thing ?? unharmed;
    if (!m) continue;
    const name = m[1]!.toLowerCase();
    const e = Object.values(world.entities).find(x => x.name.toLowerCase() === name || x.name.toLowerCase() === `the ${name}` || `the ${x.name.toLowerCase()}` === name);
    if (!e) continue;
    if (e.kind === "person" || e.kind === "creature") {
      const down = /\(down\)/.test(line) ? "down" : /\(badly hurt\)/.test(line) ? "badly hurt" : /\(hurt\)/.test(line) ? "hurt" : undefined;
      e.states = [...e.states.filter(s => !["hurt", "badly hurt", "down", "unhurt"].includes(s)), ...(down ? [down] : [])];
      continue;
    }
    if (thing) damageThing(world, e, Number(thing[2]), thing[3]!, turn);
  }
}

const cases: WorldCase[] = [];
if (traces.length) {
  for (const t of traces) {
    if (wanted && !wanted.has(t.turn)) continue;
    const scene = t.worldBefore.scene;
    cases.push({
      id: `${session}-t${t.turn}`, source: `${session} turn ${t.turn}`, scene, turn: t.turn, player: t.player,
      world: t.worldBefore, playerTurn: t.playerTurn, rules: rulesLines(state.transcript, scene, t.turn), reply: t.reply,
      expect: [], ...(gmCall(t.reply) ? { gm: gmCall(t.reply) } : {}),
    });
  }
} else {
  // Older sessions: rebuild the world from the snapshots.
  const snapshots = (turn: number, scene: string) => join(dir, "snapshots", `${scene}-turn-${String(turn).padStart(3, "0")}.json`);
  const scenes = [...new Set(state.transcript.map(e => e.scene ?? state.sceneId))];
  for (const scene of scenes) {
    for (const entry of state.transcript.filter(e => e.kind === "player" && (e.scene ?? scene) === scene)) {
      const turn = entry.turn;
      if (wanted && !wanted.has(turn)) continue;
      const prev = snapshots(turn - 1, scene);
      if (!existsSync(prev)) continue;
      const world = (JSON.parse(readFileSync(prev, "utf8")) as SessionState).world;
      if (!world) continue;
      const rules = rulesLines(state.transcript, scene, turn);
      replayRules(world, rules, turn);
      const reply = state.transcript.filter(e => e.turn === turn && (e.scene ?? scene) === scene && e.kind === "narration").map(e => e.text).join("\n\n");
      const logged = loggedView(entry.text);
      const rebuilt = worldView(world, { full: true });
      if (logged && logged.trim() !== rebuilt.trim()) {
        const a = logged.split("\n"), b = rebuilt.split("\n");
        console.log(`${session} turn ${turn}: rebuilt world differs from what the stage manager read:`);
        for (const line of a) if (!b.includes(line)) console.log(`  logged:  ${line}`);
        for (const line of b) if (!a.includes(line)) console.log(`  rebuilt: ${line}`);
      }
      cases.push({
        id: `${session}-t${turn}`, source: `${session} turn ${turn}`, scene, turn, player: { name: state.player.name },
        world, playerTurn: entry.text, rules, reply, expect: [], ...(gmCall(reply) ? { gm: gmCall(reply) } : {}),
      });
    }
  }
}

for (const c of cases) {
  const file = join(out, `${c.id}.json`);
  // Keep the labels when re-capturing; refresh everything else.
  const old = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as WorldCase : undefined;
  // The exchange and its labels first, for whoever reads or labels the case; the world and the GM's call last.
  const ordered: WorldCase = {
    id: c.id, source: c.source, scene: c.scene, turn: c.turn, player: c.player, playerTurn: c.playerTurn, rules: c.rules, reply: c.reply,
    ...(old?.why ? { why: old.why } : {}), ...(old?.tags ? { tags: old.tags } : {}), ...(old?.moveThenAct ? { moveThenAct: true } : {}),
    expect: old?.expect ?? [], ...(old?.allow ? { allow: old.allow } : {}), ...(old?.forbid ? { forbid: old.forbid } : {}), ...(old?.stale ? { stale: old.stale } : {}),
    world: c.world, ...(c.gm ? { gm: c.gm } : {}),
  };
  writeFileSync(file, JSON.stringify(ordered, null, 1) + "\n");
  console.log(`${file}: ${c.playerTurn.slice(0, 90)}`);
}
