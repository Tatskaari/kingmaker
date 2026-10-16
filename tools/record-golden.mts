/**
 * Records the prototype's GM calls for V0's prompt parity test (v0-design §10.2, gm-port §16.1).
 *
 *   node --no-warnings tools/record-golden.mts [--proto <a checkout of the prototype>] [--out <dir>]
 *
 * --proto is the repo this script is in when absent (its src/ is the prototype), and --out is that
 * repo's v2/ai/gm/golden/hanged-clerk. To record from another commit, check it out in a worktree and
 * name it with --proto.
 *
 * It plays the hanged clerk on the prototype under its stand-in for OpenRouter (fakeOpenRouter, so
 * no model is asked and nothing leaves the machine): createSession (the wizard pregen's build, no
 * backstory) and openScene, then three playerTurns: a plain question to Kell; catch-moll, the
 * decider's attempt scripted; and an out-of-character question. It wraps the stand-in's fetch to
 * keep every call's body with a copy of the session as it stood when the call was made, names each
 * call by its operation from the prototype's own call log, and writes one file per step (the
 * opening, and each turn's decide, reply and settle), each with the session at the step's first
 * call and every call the step made.
 *
 * It reads the prototype and imports it at run time; it writes only under --out and a temporary
 * folder (the prototype's runs, call log and cost ledger go there: KM_RUNS_DIR, KM_CALL_LOG,
 * KM_COST_LEDGER). It lives with the prototype's tools, which may reach into v2; v2 never imports it.
 * Kept in the scratchpad while V0 was built (kingmaker-scratch/v2/v2-research/tools/); here it gains
 * the defaults, and its paths are made absolute before it moves into the temporary folder.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = resolve(import.meta.dirname, "..");
const arg = (name: string, otherwise: string) => { const i = process.argv.indexOf(name); return resolve(i < 0 ? otherwise : process.argv[i + 1] ?? otherwise); };
const PROTO = arg("--proto", REPO);
const OUT = arg("--out", join(REPO, "v2", "ai", "gm", "golden", "hanged-clerk"));

// The prototype's run output, somewhere that isn't the repo; set before its modules load (they read these as they load).
const runs = mkdtempSync(join(tmpdir(), "km-golden-"));
process.env.KM_RUNS_DIR = runs;
process.env.KM_CALL_LOG = join(runs, "calls.jsonl");
process.env.KM_COST_LEDGER = join(runs, "cost-ledger.jsonl");
process.env.OPENROUTER_API_KEY = "sk-or-golden-recording-no-model";
delete process.env.KM_PROMPTS_DIR;
process.chdir(runs);

const proto = (path: string) => import(pathToFileURL(join(PROTO, path)).href);
const { createSession, openScene, playerTurn } = await proto("src/runtime/engine.ts");
const { fakeOpenRouter } = await proto("src/llm/fake-openrouter.ts");
const { PREGENS } = await proto("src/game/combat/pregen.ts");

/** What the script plays: the player, and each step's line, the decider's scripted choices, and the GM's reply. */
const PLAYER = "Wren Ashdown: a hedge wizard from the fens, with more questions than answers";
const OPENING = "Rain beads on the hoist rope. A small grey clerk turns above the cobbles while a scrawny boy in enormous boots lobs gutter stones at him, and a girl on the wall top swears at both of them. [Sergeant Agnes Kell] “You'll be the King's investigator. The Captain calls it suicide.” A stone clangs off the hoist hook.";
const TURNS = [
  { line: "Sergeant, who found him?", choices: {}, reply: "Kell flips her notebook open. “The carter's lad, at first light,” she says. “Then those two turned up to throw stones at him.” She nods at the boy under the body." },
  { line: "Moll, you say you saw him jump. From that wall you'd have had your back to the hoist. What did you really see?", choices: { attempt: "catch-moll" }, reply: "Moll's heels stop drumming on the bricks. [Moll] “All right. I didn't see him jump. Nobody did.” Her fist stays closed." },
  { line: "(Out of character: what can I actually do here?)", choices: { ooc: "out_of_character" }, reply: "(Out of character: you could look at the body, ask the boy about his boots, or press the girl on what she saw.)" },
];

/** Every call the stand-in answers: the step it's in, its body, and the session as it stood. */
interface Recorded { step: string; url: string; body: Record<string, unknown>; session: unknown }
const recorded: Recorded[] = [];
let session: Record<string, unknown> | undefined;
let step = "open";

/** The stand-in for this step, its fetch wrapped to keep each call with the session as it stood. */
function standIn(options: { replies: string[]; choices?: Record<string, string> }): () => void {
  const fake = fakeOpenRouter(options);
  const answer = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    recorded.push({ step, url, body: JSON.parse(String(init?.body ?? "{}")), session: snapshot() });
    return answer(input, init);
  };
  return () => fake.restore();
}

/** The session now, as V0's parity test reads it: the rules engine's own state (a serialised campaign, 10 KB) left out. */
function snapshot(): unknown {
  const copy = structuredClone(session) as { rules?: Record<string, unknown> };
  if (copy.rules) delete copy.rules.campaign;
  return copy;
}

// The opening.
const opened = standIn({ replies: [OPENING] });
session = await createSession({ sceneId: "hanged-clerk", approach: "v2", player: PLAYER, level: 3, seed: 1234, id: "golden-hanged-clerk", build: PREGENS.wizard.build });
await openScene(session);
opened();

// Three turns, each on its own stand-in (the scripted choices are the turn's).
for (const [i, turn] of TURNS.entries()) {
  step = `t${i + 1}`;
  const done = standIn({ replies: [turn.reply], choices: turn.choices });
  await playerTurn(session, turn.line);
  done();
}

writeSteps(nameCalls(recorded));
rmSync(runs, { recursive: true, force: true });

// ---------------------------------------------------------------------------------------------

/** Each call's operation, from the prototype's own call log: a decision by its whole request, a reply by its instructions and input. */
function nameCalls(calls: Recorded[]): Array<Recorded & { operation: string }> {
  const log = readFileSync(join(runs, "calls.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l) as { operation: string; request?: { instructions?: string; input?: unknown } & Record<string, unknown>; text?: string; answers?: unknown });
  const done = log.filter(e => e.request && (e.text !== undefined || e.answers !== undefined));
  const used = new Set<number>();
  return calls.map(call => {
    const same = (e: (typeof done)[number]) => call.url.endsWith("/decisions")
      ? JSON.stringify(e.request) === JSON.stringify(call.body)
      : e.request!.instructions === call.body.instructions && JSON.stringify(e.request!.input) === JSON.stringify(call.body.input);
    const at = done.findIndex((e, i) => !used.has(i) && same(e));
    if (at < 0) throw new Error(`a call to ${call.url} in ${call.step} isn't in the call log`);
    used.add(at);
    return { ...call, operation: done[at]!.operation };
  });
}

/** One file per step: the opening, and each turn's decide (disclosure and the director's before), reply and settle (the stage manager and the director's after). The notes on marks, a later vertical's, are left out. */
function writeSteps(calls: Array<Recorded & { operation: string }>): void {
  const stepOf = (c: { step: string; operation: string }) => c.operation === "notes" ? undefined
    : c.step === "open" ? "open"
    : /^(memory\.disclose|director\.(before|ooc))/.test(c.operation) ? `${c.step}-decide`
    : /^gm\./.test(c.operation) ? `${c.step}-reply`
    : /^(world\.stage|director\.after)$/.test(c.operation) ? `${c.step}-settle`
    : undefined;
  mkdirSync(OUT, { recursive: true });
  const steps = new Map<string, Array<Recorded & { operation: string }>>();
  for (const c of calls) {
    const name = stepOf(c);
    if (name) steps.set(name, [...(steps.get(name) ?? []), c]);
  }
  for (const [i, [name, list]] of [...steps].entries()) {
    const turn = name === "open" ? undefined : TURNS[Number(name.slice(1, name.indexOf("-"))) - 1]!;
    const file = { step: name, ...(turn ? { line: turn.line, choices: turn.choices } : {}), replies: [turn ? turn.reply : OPENING], session: list[0]!.session, calls: list.map(c => ({ operation: c.operation, body: c.body })) };
    writeFileSync(join(OUT, `${String(i).padStart(2, "0")}-${name}.json`), JSON.stringify(file, null, 1) + "\n");
  }
  console.log(`${calls.length} calls, ${steps.size} steps written to ${OUT}: ${[...steps].map(([n, l]) => `${n} (${l.map(c => c.operation).join(", ")})`).join("; ")}`);
}
