import { respond, type Message } from "../../src/llm/openrouter.ts";
import { worldView } from "../../src/world/scene-world.ts";
import { loadCases } from "./cases.ts";
import { stageView } from "./language.ts";
import type { WorldCase } from "./types.ts";

/**
 * Does the GM read the world? Regenerate real GM replies from their recorded calls, with the world
 * section of the GM's note swapped for another view, and count what the replies do.
 *
 *   node --no-warnings evals/world/gm-reads.ts [--samples 6]
 *
 * 1. Rules side effects: the Fireball burned the beam Prout hung from, and today's world code
 *    drops him (the recorded prompt, from older code, still had him hanging). Does the GM narrate
 *    the fall when the view says "fallen"?
 * 2. A continuity slip: the player pocketed the smashed lantern last turn, yet Kell "finds" one in
 *    the loft. Does it recur, and does the proposed view (the player listed like everyone else,
 *    carrying it) help?
 */
const args = process.argv.slice(2);
const samples = Number(args[args.indexOf("--samples") + 1] || 6);

/** The GM's call with the world section of its last note replaced. */
function withView(c: WorldCase, view: string): Message[] {
  const input = structuredClone(c.gm!.input);
  const last = input.findLastIndex(m => m.role === "developer" && m.content.includes("## The world right now"));
  const note = input[last]!.content;
  const start = note.indexOf("## The world right now");
  const body = note.indexOf("\n", note.indexOf("Details it doesn't list are yours to invent", start)) + 1;
  const end = note.indexOf("\n\n## ", body);
  input[last] = { role: "developer", content: note.slice(0, body) + view + (end >= 0 ? note.slice(end) : "") };
  return input;
}

async function probe(c: WorldCase, label: string, input: Message[], test: (reply: string) => boolean): Promise<void> {
  const replies = await Promise.all(Array.from({ length: samples }, () => respond({ operation: "eval.world.gm-reads", effort: "none", instructions: c.gm!.instructions, input, maxOutputTokens: 700 }).then(r => r.text).catch(e => `ERROR ${e}`)));
  const hits = replies.filter(test);
  console.log(`${c.id} · ${label}: ${hits.length}/${replies.length}`);
  for (const r of hits.slice(0, 2)) console.log(`   e.g. ${r.replace(/\s+/g, " ").slice(0, 260)}`);
}

const cases = loadCases(["world-poc-3-t3", "wr-yard-sneak-t5"]);
const fireball = cases.find(c => c.id === "world-poc-3-t3")!;
const lantern = cases.find(c => c.id === "wr-yard-sneak-t5")!;
const fall = (r: string) => /(prout|body|clerk|corpse|hanged man)[^.!?]{0,80}(fall|fell|drop|crash|tumbl|slump|thud|land)|(fall|fell|drop|crash|tumbl|slump|thud|land)[^.!?]{0,80}(prout|body|clerk|corpse)/i.test(r);
console.log("## 1. Rules side effects reach the GM through the view?");
await probe(fireball, "recorded prompt (Prout still hanging in it)", fireball.gm!.input, fall);
await probe(fireball, "today's world (Prout fallen)", withView(fireball, worldView(fireball.world)), fall);
console.log("\n## 2. A second lantern in the loft?");
const found = (r: string) => /lantern (here|on the floor|in the dust)|(a|the) (smashed|broken) lantern[^.!?]{0,40}(here|floor|dust|lies|lying)|finds?[^.!?]{0,30}lantern/i.test(r);
await probe(lantern, "recorded prompt (proximity view)", lantern.gm!.input, found);
await probe(lantern, "proposed view (the player listed, carrying it)", withView(lantern, stageView(lantern.world, { full: false })), found);
