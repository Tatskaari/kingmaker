/**
 * A headless tour of the map module, using only its public API:
 *   1. Caerwyn in the morning, the player in the lane by the granary gate, Kell waiting inside;
 *   2. dusk, and a walk (pathfound) through the town to the Drowned Rat's door;
 *   3. into the Rat, its scene world reconciled onto the map, and Dilly's card table set alight;
 *      then the Rat again later, as the scene left it;
 *   4. night at the Heron: from the wharf, then with its world (the roof off, the dust in the air);
 *   5. the Heron as a battlefield for combat: a move range, a target, the Crakes placed.
 *
 * node --no-warnings src/game/map/demo.ts [--plain | --color] [--w 80] [--h 24]
 * (colour when it's a terminal; --color forces it, e.g. for `| less -R`)
 */
import { applyOps, buildWorld, damageThing, joinWorld, tick, type SceneWorld } from "../../world/scene-world.ts";
import { drownedRatWorld } from "../../../scenes/worlds/drowned-rat.ts";
import type { MapActor, StoryState } from "../types.ts";
import {
  CAST, actorsHere, battlefield, enterScene, heronWorld, interact, leaveScene, look, move, newExploration, pathTo, reachable, render, renderExplore, setStory, spotsNear, toAnsi, toPlain, travel,
  type ExploreState,
} from "./index.ts";

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : fallback; };
const plain = args.includes("--plain") || (!process.stdout.isTTY && !args.includes("--color"));
const viewport = { w: flag("w", 80), h: flag("h", 24) };

const out = (s = "") => process.stdout.write(`${s}\n`);
const rule = (title: string) => out(`\n${plain ? `== ${title} ` : `\x1b[1;33m== ${title} \x1b[0m`}${"=".repeat(Math.max(0, viewport.w - title.length - 4))}`);
const frame = (ex: ExploreState, world?: SceneWorld, options: Parameters<typeof renderExplore>[2] = {}) => {
  const lines = renderExplore(ex, viewport, { ...(world ? { world } : {}), ...options });
  out(plain ? toPlain(lines) : toAnsi(lines));
};
/** Who's who on screen, for the sidebar the app will have. */
const legend = (ex: ExploreState, world?: SceneWorld) => {
  const seen = new Set<string>();
  const people = actorsHere(ex, world).filter(a => (a.kind === "person" || a.kind === "creature") && Math.max(Math.abs(a.at.x - ex.at.x), Math.abs(a.at.y - ex.at.y)) <= 12)
    .filter(a => { const k = a.name; if (seen.has(k)) return false; seen.add(k); return true; });
  out(`Who's about: ${people.map(a => `${plain ? a.glyph : `\x1b[1;38;2;${rgb(a.color ?? "#cccccc")}m${a.glyph}\x1b[0m`} ${a.name}`).join(", ")}`);
};
const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`; };

// 1. Morning at the granary gate.
let story: StoryState = { time: "morning", played: [], lead: "hanged-clerk", flags: {} };
const ex = newExploration(story);
rule("1. Caerwyn, the morning before the Assembly: the lane by the granary gate");
frame(ex);
out(look(ex));
legend(ex);
let r = move(ex, 0, 1);
out(`\n> step south: ${r.message ?? (r.moved ? "you step into the gateway." : "")}`);
const talk = interact(ex);
out(`> interact: ${talk?.interaction.label}${talk?.interaction.kind === "scene" ? `  [opens the scene: ${talk.interaction.sceneId}]` : ""}`);

// The granary scene is played (by the GM, not here); then the story moves on to dusk.
enterScene(ex, "hanged-clerk");
leaveScene(ex);
story = { time: "evening", played: ["hanged-clerk"], lead: "drowned-rat", flags: {} };
setStory(ex, story);

// 2. Dusk: walk to the Drowned Rat's door.
rule("2. Dusk: from the granary to the river stairs, Kell in tow");
const door = { x: 25, y: 35 };
const path = pathTo(ex, door) ?? [];
out(`A walk of ${path.length} steps:`);
const log: string[] = [];
path.forEach(([dx, dy], i) => {
  const step = move(ex, dx, dy);
  if (step.message) log.push(`  step ${i + 1}: ${step.message}`);
  if (i === Math.floor(path.length * 0.55)) { log.forEach(l => out(l)); log.length = 0; out("  (passing through the market:)"); frame(ex); }
});
log.forEach(l => out(l));
out("\nAt the Drowned Rat's door:");
frame(ex);
out(look(ex));
legend(ex);

// 3. Into the Rat: the scene opens, and its world is on the map.
rule("3. The Drowned Rat: the scene's world on the map, and a card table on fire");
r = move(ex, 1, 0);
out(`> step east: ${r.message}`);
r = move(ex, 0, 1);
r = move(ex, 0, 1);
out(`> step down into the room: ${r.trigger ? `${r.trigger.label}  [opens the scene: ${r.trigger.sceneId}]` : r.message}`);
enterScene(ex, "drowned-rat");
const cast = ["kell", "nan-quill", "arlo", "dilly", "hobb", "cob"].map(id => ({ id, name: CAST[id]!.name }));
const rat = buildWorld("drowned-rat", drownedRatWorld, cast, { name: "the investigator" });
// Someone knocks a candle into Dilly's cards: the rules set what burns alight, and the world shows it.
const burnt = damageThing(rat, rat.entities["card-table"]!, 3, "fire", 1);
out(`Rules: ${burnt.join("; ")}.`);
frame(ex, rat);
legend(ex, rat);

// The scene ends; the Rat stays as it was left. Later, back past it at night, the fire's out.
leaveScene(ex, rat);
story = { time: "night", played: ["hanged-clerk", "drowned-rat"], lead: "heron-warehouse", flags: {} };
setStory(ex, story);
tick(rat, 2, 7);
rule("3b. The Rat later that night, as the scene left it");
travel(ex, { map: "drowned-rat", at: { x: 5, y: 7 } }, "Back into the Rat");
frame(ex);
out(look(ex));

// 4. Night at the Heron.
rule("4. Night: the downriver end of the wharves, and the Heron");
travel(ex, { map: "caerwyn", at: { x: 24, y: 37 } }, "Down to the wharves");
const toHeron = pathTo(ex, { x: 45, y: 38 }) ?? [];
for (const [dx, dy] of toHeron) {
  r = move(ex, dx, dy);
  if (r.trigger) { out(`> ${r.trigger.label}  [opens the scene: ${r.trigger.sceneId}]`); break; }
}
frame(ex);
out(look(ex));
enterScene(ex, "heron-warehouse");
const heron = buildWorld("heron-warehouse", heronWorld, ["kell", "saul", "hep", "scrope", "hobb"].map(id => ({ id, name: CAST[id]!.name })), { name: "the investigator" });
rule("4b. The Heron, its world on the map (the scene view lifts the roof): the floor is dusty");
frame(ex, heron);
legend(ex, heron);
out(`The re-sacking floor: ${heron.entities.floor!.states.join(", ")}. The brazier under the NO NAKED LIGHTS sign is lit. Nobody here has thought this through.`);

// 5. For the fight: the Master comes, the scene ends in "Roll for initiative!", and combat takes the map.
rule("5. Roll for initiative: the Heron as a battlefield (move range, a target, the Crakes placed)");
joinWorld(heron, [{ id: "sallow", name: CAST.sallow!.name }], 9);
applyOps(heron, [
  { op: "move", what: "player", to: "trestles", how: "near", name: "", kind: "", text: "", add: [], remove: [] },
  { op: "move", what: "kell", to: "player", how: "near", name: "", kind: "", text: "", add: [], remove: [] },
  { op: "move", what: "sallow", to: "floor-brazier", how: "near", name: "", kind: "", text: "", add: [], remove: [] },
], 9);
const field = battlefield("heron-warehouse", heron)!;
const crakes = spotsNear(field.map, field.people.sallow!, 2, Object.values(field.people)).map((at, i): MapActor => ({ id: `crake-${i + 1}`, name: "a Crake", kind: "person", glyph: CAST.crake!.glyph, color: CAST.crake!.color, map: field.map.id, at, blocks: true }));
const everyone = [...actorsHere(ex, heron), ...crakes];
const occupied = new Set(everyone.filter(a => a.kind !== "player" && a.blocks).map(a => `${a.at.x},${a.at.y}`));
const range = reachable(field.map, field.people.player!, 6, p => occupied.has(`${p.x},${p.y}`));
const fight = render(field.map, everyone, field.people.player!, viewport, {
  time: "night", roofs: false, focus: field.people.player!, reveal: Object.values(field.people), tick: 5,
  marks: range.map(r => ({ at: r.at, color: "#3a78c8" })), cursor: field.people.sallow!,
});
out(plain ? toPlain(fight) : toAnsi(fight));
out(`Combatants: ${Object.entries(field.people).filter(([id]) => CAST[id]).map(([id, at]) => `${CAST[id]!.name} (${at.x}, ${at.y})`).join(", ")}, and the Crakes at ${crakes.map(c => `(${c.at.x}, ${c.at.y})`).join(" and ")}.`);
out(`In the way (and cover): ${[...new Set(field.obstacles.map(o => o.name))].join(", ")}. Blue: where you can get to in 30 feet.`);
