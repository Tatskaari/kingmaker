import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { WorldGameRuntime } from "../apps/web/src/world-runtime.js";
import { loadPlayableWorld } from "./lib/playable-world.js";

const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) throw new Error("Set OPENROUTER_API_KEY");
const directory = resolve(process.argv[2] ?? `eval-output/holt-hooks-${Date.now()}`);
await mkdir(directory, { recursive: true });
const warnings: string[] = [], turns: unknown[] = [];
const game = new WorldGameRuntime(loadPlayableWorld(), key, undefined, undefined, text => warnings.push(text));
const state = () => ({
  tree: game.services.quests.read("conversation-holt-cart"),
  quest: game.services.quests.read("assembly_programme"),
  cart: game.world().simulation!.map!.fixtures.filter(fixture => fixture.id.startsWith("furn_cart_")).map(({ id, actions }) => ({ id, actions })),
  status: game.debugCharacter("holt").conversationTree,
});
const messages = [
  "Marshal Holt, the King asked me to find out what has delayed the cushions. What has gone wrong?",
  "I can see the whole timetable is falling apart. Let me help with the obstruction instead of adding another demand. Are the pillows stuck behind this cart too?",
  "Then let us clear the entrance. I could smash the cart apart and move the pieces out of the way, if you authorise it.",
  "I understand Nine Furrows will be angry. But leaving the entrance blocked holds up every guest and the King's festivities. You can explain that clearing the royal entrance was your order. Please give me explicit permission to smash it if gentler remedies cannot clear it in time.",
  "We can offer compensation and preserve the cargo. The urgency is yours to judge, Marshal. Will you authorise me to smash the cart to clear the entrance?",
  "I am asking for your permission, not claiming the cart is already gone. Will you give me your blessing to break it apart and clear the way?",
];
try {
  for (const message of messages) {
    const reply = await game.checkedTalkToCharacter("holt", message, undefined, {}, AbortSignal.timeout(180_000));
    const current = state(); turns.push({ message, reply, ...current });
    console.log(JSON.stringify({ message, reply, stage: current.tree.currentStageId, hook: current.status?.scriptOutput }));
    await writeFile(`${directory}/result.json`, JSON.stringify({ turns, warnings }, null, 2));
    if (current.tree.currentStageId === "authorised") break;
  }
  const final = state();
  const passed = final.tree.currentStageId === "authorised" && final.cart.length === 2
    && final.cart.every(fixture => fixture.actions.some(action => action.handler === "smash-cart" && !action.illegal));
  await writeFile(`${directory}/result.json`, JSON.stringify({ passed, turns, warnings, final }, null, 2));
  await writeFile(`${directory}/model-runs.json`, JSON.stringify(game.transcriptRuns(), null, 2));
  console.log(JSON.stringify({ passed, directory }));
  if (!passed) process.exitCode = 1;
} finally { game.movement.dispose(); }
