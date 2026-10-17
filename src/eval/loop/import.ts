/**
 * A game from elsewhere in a round: a playtest's problem report or another session, laid out as
 * the round's own games are (state, snapshots, calls, docs, the co-GM's results), so it can be
 * reviewed, reported on and cut into cases like any other.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gameSource } from "./fixture.ts";
import { gameDir, loadRound, saveRound } from "./round.ts";

export function importGame(roundName: string, from: string, options: { label?: string; persona?: string } = {}): string {
  const round = loadRound(roundName);
  const source = gameSource(from);
  const state = source.state();
  if (state.sceneId !== round.scene) throw new Error(`That game is in ${state.sceneId}; round ${round.name} is ${round.scene}.`);
  const id = `g${String(Object.keys(round.games).length + 1).padStart(2, "0")}`;
  const dir = gameDir(round.name, id);
  mkdirSync(join(dir, "snapshots"), { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ ...state, id }, null, 1));
  for (let turn = 0; turn <= state.turn; turn++) {
    const snap = source.snapshot(turn);
    if (snap) writeFileSync(join(dir, "snapshots", `${state.sceneId}-turn-${String(turn).padStart(3, "0")}.json`), JSON.stringify({ ...snap, id }, null, 1));
  }
  writeFileSync(join(dir, "calls.jsonl"), source.calls().map(c => JSON.stringify(c)).join("\n") + "\n");
  for (const d of source.docs()) {
    const file = join(dir, "docs", d.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, d.text);
  }
  for (const r of source.repairs()) writeFileSync(join(dir, r.name), JSON.stringify(r.result, null, 1));
  const variant = `import:${options.label ?? `${source.kind} ${source.game}${source.build ? ` (${source.build.slice(0, 7)})` : ""}`}`;
  const arm = Object.entries(round.arms).find(([, v]) => v === variant)?.[0] ?? `k${Object.keys(round.arms).length + 1}`;
  round.arms[arm] = variant;
  round.games[id] = { arm, persona: options.persona ?? "playtest" };
  saveRound(round);
  return id;
}
