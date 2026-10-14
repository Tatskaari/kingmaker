import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { JevDecider, LUNA_DECISIONS_MODEL, type ChoiceQuestion, type Decider } from "../../src/llm/decide.ts";
import { effectiveScene, presentCast } from "../../src/runtime/brief.ts";
import type { SessionState } from "../../src/runtime/session.ts";
import { castSpell } from "../../src/rules/dnd.ts";
import { areaOf, distance, positionOf, type SceneWorld } from "../../src/world/scene-world.ts";
import { sceneById } from "../../scenes/index.ts";
import { applyOpsV2, stageView, type WorldOpV2 } from "./language.ts";

/**
 * Where does the player act from? Today the rules resolve a spell or a blow before the stage
 * manager has run, so a player who moves and casts in the same turn casts from where they were
 * ("I stride thirty feet away and cast Fireball at the elm" catches the caster). The proposal: two
 * more questions in the decider's existing mechanic call (no extra call, no extra latency): where
 * the player acts from, and how far they back off from their target; the world moves the player
 * there before the rules roll.
 *
 *   node --no-warnings evals/world/act-position.ts [--deciders luna-decisions,jev] [--samples 3]
 *
 * Part 1 scores the decider on labelled turns (real ones and variants on the same worlds). Part 2
 * replays two real turns' spells from their snapshots, from the old spot and the decided one, with
 * the same dice.
 */

interface ActCase {
  id: string;
  /** A case file (its world) or a session snapshot (world and rules). */
  world: { case: string } | { snapshot: string };
  playerTurn: string;
  /** What they aim at (for "away"). */
  aim: string;
  /** Where they should be when they act. */
  gold: { here: true } | { area: string } | { near: string; within?: number } | { away: string; min: number; max?: number; area?: string };
  /** Alternatives that are also fine. */
  alt?: ActCase["gold"][];
  real?: boolean;
}

const SESSIONS = process.env.KM_WORLD_SESSIONS ?? "runs/world/sessions";
const snap = (session: string, scene: string, turn: number) => join(SESSIONS, session, "snapshots", `${scene}-turn-${String(turn).padStart(3, "0")}.json`);

const CASES: ActCase[] = [
  { id: "fireball-step", real: true, world: { snapshot: snap("wr-fireball-step", "hanged-clerk", 1) }, aim: "elm", playerTurn: "I stride thirty feet back down the lane, away from the tree, turn on my heel and cast Fireball at the old elm.", gold: { away: "elm", min: 25, area: "lane" } },
  { id: "rat-cone", real: true, world: { snapshot: snap("wr-rat-cone", "drowned-rat", 1) }, aim: "eel-traps", playerTurn: "I get up, cross the room to the fireside corner, and cast Burning Hands at the eel traps hanging over the long table.", gold: { area: "fireside" } },
  { id: "poc3-fireball", real: true, world: { case: "world-poc-3-t3" }, aim: "elm", playerTurn: "\"Those pigeons have had this coming,\" I mutter, and cast Fireball at the old elm.", gold: { here: true } },
  { id: "poc2-gatepost", real: true, world: { case: "world-poc-2-t4" }, aim: "hoist-rope", playerTurn: "\"Third time pays for all, Sergeant.\" I steady my wrist on the gatepost and send one last Fire Bolt at the hoist rope.", gold: { here: true }, alt: [{ near: "gate", within: 8 }] },
  { id: "poc1-board", real: true, world: { case: "world-poc-1-t1" }, aim: "rules-board", playerTurn: "\"Rule four is a fire hazard,\" I say, and I cast Fire Bolt at the rules board to make my point.", gold: { here: true } },
  { id: "poc2-lane", real: true, world: { case: "world-poc-2-t5" }, aim: "elm", playerTurn: "While Kell kneels by the body, I step out of the gate into the lane, well clear of everyone, glare at the old elm full of pigeons that has been dropping things on me since I arrived, and cast Fireball at it.", gold: { area: "lane" } },
  { id: "fire-yard-far-end", real: true, world: { case: "wr-fire-yard-t2" }, aim: "elm", playerTurn: "I hop down into the lane, stroll to the far end of it, turn round and cast Fireball at the old elm.", gold: { away: "elm", min: 25, area: "lane" } },
  { id: "rat-chair-bolt", real: true, world: { case: "wr-rat-chair-t4" }, aim: "eel-traps", playerTurn: "I cast Fire Bolt at the eel traps hanging over the long table, to make a point about fire safety.", gold: { here: true } },
  { id: "wall-bolt", world: { case: "wr-fire-yard-t1" }, aim: "hoist-rope", playerTurn: "I climb up onto the yard wall next to the girl and cast Fire Bolt at the hoist rope from there.", gold: { near: "moll", within: 8 }, alt: [{ near: "yard-wall", within: 8 }] },
  { id: "butt-fireball", world: { case: "wr-fire-yard-t1" }, aim: "hoist-beam", playerTurn: "I walk over to the water butt and, crouched behind it, cast Fireball at the hoist beam.", gold: { near: "water-butt", within: 8 } },
  { id: "door-hands", world: { case: "wr-rat-hobb-t1" }, aim: "arlo", playerTurn: "I back away to the door, then cast Burning Hands at Arlo.", gold: { near: "door", within: 8 } },
  { id: "seated-bolt", world: { case: "wr-rat-hobb-t1" }, aim: "eel-traps", playerTurn: "Without getting up from my stool, I cast Fire Bolt at the eel traps.", gold: { here: true } },
  { id: "back-off-twenty", world: { case: "world-poc-3-t2" }, aim: "elm", playerTurn: "I back off a good twenty feet from the tree and cast Fireball at it.", gold: { away: "elm", min: 15, max: 35 } },
  { id: "middle-yard", world: { case: "wr-fire-yard-t1" }, aim: "loft-door", playerTurn: "I stroll into the middle of the yard, then hurl a Fire Bolt at the loft door.", gold: { area: "yard" }, alt: [{ here: true }] },
  { id: "hop-bar-swing", world: { case: "wr-rat-hobb-t1" }, aim: "hobb", playerTurn: "I hop over the bar, grab Manners off its nails and march over to swing it at Hobb.", gold: { near: "hobb", within: 8 } },
  { id: "loft-fireball", world: { case: "wr-yard-sneak-t4" }, aim: "elm", playerTurn: "From the open loft door I cast Fireball at the old elm.", gold: { near: "loft-door", within: 10 }, alt: [{ area: "loft" }] },
];

function loadWorld(c: ActCase): { world: SceneWorld; state?: SessionState } {
  if ("case" in c.world) {
    const data = JSON.parse(readFileSync(join(import.meta.dirname, "cases", `${c.world.case}.json`), "utf8")) as { world: SceneWorld };
    return { world: data.world };
  }
  if (!existsSync(c.world.snapshot)) throw new Error(`missing snapshot ${c.world.snapshot}`);
  const state = JSON.parse(readFileSync(c.world.snapshot, "utf8")) as SessionState;
  return { world: state.world!, state };
}

const blank = { what: "player", to: "", how: "", feet: 0, name: "", kind: "", text: "", add: [], remove: [] };

/** The two questions, as they'd sit in the mechanic call. */
export function actQuestions(world: SceneWorld): Record<string, ChoiceQuestion> {
  const live = Object.values(world.entities).filter(e => !e.states.includes("gone") && e.kind !== "place" && e.id !== "player");
  return {
    act_from: {
      instructions: "The player is casting a spell or striking in their latest turn. Where are they when they do it? If they move first in the same turn (walk, climb, cross the room, back off), it's where they end up.",
      criteria: {
        here: "Where the world shows them now: they don't move first (turning, standing up or steadying themselves on the spot doesn't count).",
        ...Object.fromEntries(live.filter(e => e.kind === "area").map(a => [`area:${a.id}`, `They move first: somewhere in ${a.name}, not by anything in particular.`])),
        ...Object.fromEntries(live.filter(e => e.kind !== "area" && e.kind !== "item").map(e => [`near:${e.id}`, `They move first: to ${e.name}.`])),
      },
    },
    act_back_off: {
      instructions: "Before acting, does the player back off or walk away from what they're aiming at? If so, about how far from it do they end up?",
      criteria: { no: "No: they don't back away from it.", "15": "About ten to fifteen feet from it.", "30": "About twenty to thirty feet from it.", "50": "Forty feet or more from it." },
    },
  };
}

/** Move the player where the answers say, in the extended world language. */
export function placeForAct(world: SceneWorld, aim: string, answers: Record<string, string>): WorldOpV2[] {
  const from = answers.act_from ?? "here", back = answers.act_back_off ?? "no";
  const ops: WorldOpV2[] = [];
  if (from.startsWith("area:") && areaOf(world, "player")?.id !== from.slice(5)) ops.push({ ...blank, op: "move", to: from.slice(5) });
  if (from.startsWith("near:")) ops.push({ ...blank, op: "move", to: from.slice(5) });
  // A named spot wins over backing off (to the door, behind the butt); backing off from the target itself is a distance.
  const specific = from.startsWith("near:") && from.slice(5) !== aim;
  if (back !== "no" && !specific && world.entities[aim]) ops.push({ ...blank, op: "place", to: aim, how: "away", feet: Number(back) });
  return ops;
}

function satisfied(world: SceneWorld, start: SceneWorld, gold: ActCase["gold"]): boolean {
  const p = positionOf(world, "player")!, p0 = positionOf(start, "player")!;
  if ("here" in gold) return distance(p, p0) <= 6;
  if ("area" in gold) return areaOf(world, "player")?.id === gold.area;
  if ("near" in gold) return distance(p, positionOf(world, gold.near)!) <= (gold.within ?? 8);
  const d = distance(p, positionOf(world, gold.away)!);
  return d >= gold.min && d <= (gold.max ?? Infinity) && (!gold.area || areaOf(world, "player")?.id === gold.area);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const deciders: Decider[] = (flag("deciders") ?? "luna-decisions,jev").split(",").map(n => n === "jev" ? new JevDecider() : new JevDecider(LUNA_DECISIONS_MODEL, "luna-decisions"));
  const samples = Number(flag("samples") ?? 3);
  console.log("## Part 1: where does the player act from? (decider, two questions in the mechanic call)\n");
  for (const decider of deciders) {
    let right = 0, total = 0, rightOld = 0;
    const latencies: number[] = [];
    for (const c of CASES) {
      const { world } = loadWorld(c);
      for (let s = 0; s < samples; s++) {
        const decision = await decider.decide({ world: stageView(world), latest_player_turn: c.playerTurn }, actQuestions(world), "eval.world.act-from");
        latencies.push(decision.latencyMs);
        // --floor: an unsure answer (top probability below it) leaves the player where they are.
        const floor = Number(flag("floor") ?? 0);
        const answers = Object.fromEntries(Object.entries(decision.answers).map(([k, v]) => [k, (v.probabilities?.[v.choice] ?? 1) < floor ? (k === "act_from" ? "here" : "no") : v.choice]));
        const moved = structuredClone(world);
        const problems = applyOpsV2(moved, placeForAct(moved, c.aim, answers), 1).problems;
        const ok = [c.gold, ...(c.alt ?? [])].some(g => satisfied(moved, world, g));
        const okOld = [c.gold, ...(c.alt ?? [])].some(g => satisfied(world, world, g));
        total++; if (ok) right++; if (okOld) rightOld++;
        if (!ok || s === 0) console.log(`${decider.name} ${c.id}#${s}: ${ok ? "ok " : "BAD"} from=${answers.act_from} back=${answers.act_back_off}${problems.length ? ` problems=${problems.join(";")}` : ""} -> ${areaOf(moved, "player")?.id} (${Math.round(distance(positionOf(moved, "player")!, positionOf(moved, c.aim)!))} ft from ${c.aim}); gold ${JSON.stringify(c.gold)}`);
      }
    }
    latencies.sort((a, b) => a - b);
    console.log(`\n${decider.name}: player in the right place when acting ${right}/${total} (today, using the old spot: ${rightOld}/${total}); latency p50 ${(latencies[Math.floor(latencies.length / 2)]! / 1000).toFixed(2)} s\n`);
  }

  const replayDecider = deciders.find(d => d.name === (flag("replay") ?? "jev")) ?? deciders[0]!;
  console.log(`## Part 2: the same spell, from the old spot and from where ${replayDecider.name} says the player went\n`);
  for (const c of CASES.filter(x => "snapshot" in x.world)) {
    const { state } = loadWorld(c);
    if (!state?.rules) continue;
    const scene = effectiveScene(sceneById(state.sceneId), state.patches);
    const present = presentCast(scene, state);
    const spell = c.id === "rat-cone" ? "burning-hands" : "fireball";
    const run = async (move: boolean) => {
      const s = structuredClone(state);
      s.turn += 1;
      if (move) {
        const decision = await replayDecider.decide({ world: stageView(s.world!), latest_player_turn: c.playerTurn }, actQuestions(s.world!), "eval.world.act-from");
        applyOpsV2(s.world!, placeForAct(s.world!, c.aim, Object.fromEntries(Object.entries(decision.answers).map(([k, v]) => [k, v.choice]))), s.turn);
      }
      const at = positionOf(s.world!, "player")!;
      const outcome = await castSpell(s, present, spell, [c.aim]);
      return { at, line: outcome.lines[0], status: outcome.status };
    };
    const before = await run(false), after = await run(true);
    console.log(`${c.id}: "${c.playerTurn}"\n  today (from ${JSON.stringify(before.at)}): ${before.line}; ${before.status}\n  moved first (to ${JSON.stringify(after.at)}): ${after.line}; ${after.status}\n`);
  }
}

if (import.meta.filename === process.argv[1]) await main();
