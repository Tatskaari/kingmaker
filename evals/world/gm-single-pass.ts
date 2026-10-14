import { respond, type Message } from "../../src/llm/openrouter.ts";
import { loadCases } from "./cases.ts";
import { applyOpsV2, WORLD_LANGUAGE_V2, type WorldOpV2 } from "./language.ts";
import { scoreCase } from "./score.ts";

/**
 * The GM writing the world operations in a hidden block at the end of its own streamed reply, for
 * real (one call): what it costs in time and whether it stays well-formed, against the same call
 * without the block. Accuracy here is only indicative (the reply is new, the labels were written
 * for the recorded one), so it's scored only on cases whose labels follow from the player's turn.
 *
 *   node --no-warnings evals/world/gm-single-pass.ts
 */
const CASES = ["wr-yard-sneak-t2", "wr-rat-hobb-t4", "wr-rat-chair-t2", "wr-cob-boots-t6", "wr-moll-coin-t5", "wr-rat-bar-t2"];
const BLOCK = `After your reply, on a new line, write <world> then a JSON object {"ops": [...]} with the operations that make the game's world model show what your reply establishes, then </world>. The player never sees the block. ${WORLD_LANGUAGE_V2}`;

/** The model may leave out fields it doesn't use: fill them in. */
const DEFAULTS = { feet: 0, how: "", name: "", kind: "", text: "", add: [] as string[], remove: [] as string[], to: "", what: "" };
const rows: string[] = [];
for (const c of loadCases(CASES)) {
  const base = c.gm!.input;
  const withBlock: Message[] = [...base.slice(0, -1), { role: "developer", content: `${base.at(-1)!.content}\n\n${BLOCK}` }];
  const [plain, block] = await Promise.all([
    respond({ operation: "eval.world.gm-plain", effort: "none", instructions: c.gm!.instructions, input: base, maxOutputTokens: 700 }),
    respond({ operation: "eval.world.gm-block-single", effort: "none", instructions: c.gm!.instructions, input: withBlock, maxOutputTokens: 1400 }),
  ]);
  const m = /<world>\s*([\s\S]*?)\s*<\/world>/.exec(block.text);
  let ops: WorldOpV2[] = [];
  let parsed = false;
  try { ops = (JSON.parse(m?.[1] ?? "") as { ops: WorldOpV2[] }).ops; parsed = Array.isArray(ops); } catch { /* not parseable */ }
  const prose = block.text.replace(/<world>[\s\S]*$/, "").trim();
  const world = structuredClone(c.world);
  const applied = parsed ? applyOpsV2(world, ops.map(op => ({ ...DEFAULTS, ...(op as Partial<WorldOpV2>) }) as WorldOpV2), c.turn, "stage", { resolve: true }) : { problems: ["no block"] };
  const score = scoreCase(c, world, applied.problems);
  rows.push(`${c.id} | ${Math.round(plain.firstTextMs ?? 0)} / ${Math.round(plain.latencyMs)} ms | ${Math.round(block.firstTextMs ?? 0)} / ${Math.round(block.latencyMs)} ms | ${plain.outputTokens} / ${block.outputTokens} | ${m ? (parsed ? "yes" : "unparseable") : "missing"} | ${/[{}[\]]|"op"/.test(prose) ? "LEAKED" : "clean"} | ${prose.length} / ${plain.text.length} | ${score.hits}/${score.expected}${score.failures.length ? ` (${score.failures.map(f => f.class).join(", ")})` : ""}`);
  process.stderr.write(`${c.id} done\n`);
}
console.log("case | without block: first text / total | with block: first text / total | output tokens without / with | block | prose | prose chars with / without | labels met");
for (const r of rows) console.log(r);
