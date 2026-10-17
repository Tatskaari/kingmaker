/**
 * npm run loop -- <command>: the GM improvement loop (evals/loop/README.md, the kingmaker-gm-loop skill).
 */
import { join } from "node:path";
import { extractFixture, gameSource } from "./fixture.ts";
import { CASES_DIR } from "./paths.ts";

const USAGE = `GM loop

  loop fixture <session-dir|report.json.gz> --turn N --id <case-id>
      [--check knows --severity 5 --quote "..." --why "..." --better "..."] [--criterion "..."]
      cut a fixture for turn N (the state after turn N-1) into evals/loop/cases/<case-id>/
`;

function flags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) { out[a.slice(2)] = args[i + 1] ?? ""; i++; }
  }
  return out;
}
const positional = (args: string[]) => args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const f = flags(rest);
  const pos = positional(rest);

  if (command === "fixture") {
    const from = pos[0];
    if (!from || !f.turn || !f.id) throw new Error("Usage: loop fixture <session-dir|report> --turn N --id <case-id>");
    const c = extractFixture(gameSource(from), {
      turn: Number(f.turn), id: f.id, out: join(CASES_DIR, f.id),
      finding: { ...(f.check ? { check: f.check } : {}), ...(f.severity ? { severity: Number(f.severity) } : {}), ...(f.quote ? { quote: f.quote } : {}), ...(f.why ? { why: f.why } : {}), ...(f.better ? { better: f.better } : {}) },
      ...(f.criterion ? { criterion: f.criterion } : {}),
      ...(f.approach ? { approach: f.approach } : {}),
    });
    console.log(`Wrote ${join(CASES_DIR, c.id)}: ${c.scene}, turn ${c.turn}, "${c.input}"`);
    return;
  }

  console.log(USAGE);
  if (command && command !== "help") process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
