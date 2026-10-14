import { statusLine } from "../../rules/dnd.ts";
import type { PlayerStyle } from "./ai.ts";
import { startCombat } from "./controller.ts";
import { heronMap } from "./heron-grid.ts";
import { heronEncounter } from "./heron.ts";
import type { CombatG, LogLine } from "./model.ts";
import { pregenSession } from "./pregen.ts";
import { gridText, KEY, legend } from "./render.ts";

/**
 * The Heron fight, played headless by AI on both sides, with the grid and the log each round.
 *
 *   node --no-warnings src/game/combat/demo.ts                          # a level 3 fighter, seed 1
 *   node --no-warnings src/game/combat/demo.ts --pregen wizard --level 5 --seed 4   # Fireball meets grain dust
 *   node --no-warnings src/game/combat/demo.ts --pregen rogue --kell wharf --seed 9
 *   node --no-warnings src/game/combat/demo.ts --runs 40 --pregens fighter,wizard,rogue,cleric   # outcomes over many seeds
 *   node --no-warnings src/game/combat/demo.ts --hep                    # before midnight: Hep's gang, no Sallow
 */

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1]! : fallback; };
const flag = (name: string) => args.includes(`--${name}`);

interface Run { outcome: string; rounds: number; exploded: boolean; sallow: string; pcDown: boolean; pcHp: number; summary: string }

async function fight(pregen: string, level: number, seed: number, print: boolean): Promise<Run> {
  const session = await pregenSession({ pregen, level, seed, name: pregen === "wizard" ? "Fennick Quill" : pregen === "rogue" ? "Tansy Marsh" : pregen === "cleric" ? "Brother Ambrose" : "Wren Ashdown" });
  const hep = flag("hep");
  if (!hep) { session.beat = "midnight"; session.established.push("Master Sallow has come to the Heron."); }
  const setup = heronEncounter(heronMap(), session, { sallow: !hep, kell: opt("kell", "inside") as "inside" | "wharf" | "absent", seed });
  const combat = await startCombat(setup, session);
  const style: PlayerStyle = pregen === "wizard" ? "wizard" : "fighter";
  // Each round's log once it's done, then the board as the next one starts.
  let shown = 0;
  let boardAt = 0;
  const flush = (G: CombatG, final = false) => {
    if (!print) return;
    const next = final ? -1 : G.log.findIndex((l, i) => i >= shown && l.round >= G.round);
    const end = next < 0 ? G.log.length : next;
    for (const l of G.log.slice(shown, end)) console.log(show(l));
    shown = end;
    console.log(`\n${final ? "At the end" : `Round ${G.round} begins`}:\n${gridText(G, { rulers: true })}\n${legend(G).join("\n")}`);
    boardAt = G.round;
  };
  if (print) {
    console.log(`=== The Heron, seed ${seed}: ${session.player.name}, ${session.player.build}. ${session.rules!.status} ===\n${KEY}\n`);
    // The roll for initiative, then the board as the first round begins.
    const G = combat.state();
    const first = G.log.findIndex(l => l.kind === "turn");
    for (const l of G.log.slice(0, first < 0 ? G.log.length : first)) console.log(show(l));
    shown = first < 0 ? G.log.length : first;
  }
  flush(combat.state());
  for (let guard = 0; guard < 400 && !combat.over(); guard++) {
    if (combat.playerTurn()) combat.autoTurn(style);
    else combat.advance();
    const G = combat.state();
    if (G.round > boardAt && !combat.over()) flush(G);
    if (G.round > 40) break;
  }
  const G = combat.state();
  if (print) flush(G, true);
  if (!combat.over()) return { outcome: "unfinished", rounds: G.round, exploded: !!G.flags["dust_exploded"], sallow: "?", pcDown: false, pcHp: 0, summary: "It went on too long." };
  const result = combat.result();
  if (print) {
    console.log(`=== ${result.outcome.toUpperCase()} after ${result.rounds} rounds ===\n${result.summary}`);
    console.log(`Casualties: ${result.casualties.map(c => `${c.name} (${c.state})`).join(", ")}`);
    console.log(`Flags: ${JSON.stringify(result.flags)}`);
    console.log(`Back in the story: ${session.player.name}: ${await statusLine(session)} (session rules state written back)`);
  }
  const pc = G.units[G.pc]!;
  return { outcome: result.outcome, rounds: result.rounds, exploded: !!G.flags["dust_exploded"], sallow: String(result.flags?.["sallow"] ?? "-"), pcDown: pc.state === "down", pcHp: pc.hp, summary: result.summary };
}

function show(l: LogLine): string {
  switch (l.kind) {
    case "turn": return `\n— ${l.text} —`;
    case "dice": return `🎲 ${l.text}`;
    case "system": return `   (${l.text})`;
    default: return l.text;
  }
}

const runs = Number(opt("runs", "0"));
if (runs > 0) {
  const pregens = opt("pregens", opt("pregen", "fighter,wizard")).split(",");
  const level = Number(opt("level", "3"));
  for (const pregen of pregens) {
    const results: Run[] = [];
    for (let seed = 1; seed <= runs; seed++) results.push(await fight(pregen, level, seed, false));
    const count = (f: (r: Run) => boolean) => results.filter(f).length;
    const tally = (key: (r: Run) => string) => Object.entries(results.reduce<Record<string, number>>((m, r) => ({ ...m, [key(r)]: (m[key(r)] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(", ");
    console.log(`${pregen} ${level} over ${runs} seeds: ${tally(r => r.outcome)} | avg ${(results.reduce((a, r) => a + r.rounds, 0) / runs).toFixed(1)} rounds | dust went up ${count(r => r.exploded)} | Sallow: ${tally(r => r.sallow)} | player knocked out ${count(r => r.pcDown)}`);
  }
} else {
  await fight(opt("pregen", "fighter"), Number(opt("level", "3")), Number(opt("seed", "1")), true);
}
