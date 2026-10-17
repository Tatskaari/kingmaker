/**
 * npm run loop -- <command>: the GM improvement loop (evals/loop/README.md, the kingmaker-gm-loop skill).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionState } from "../../runtime/session.ts";
import { extractFixture, gameSource, type Finding } from "./fixture.ts";
import { CASES_DIR } from "./paths.ts";
import { brief, say, start, view } from "./play.ts";
import { roundReport } from "./report.ts";
import { checkReview, reviewPack, type Review } from "./review.ts";
import { importGame } from "./import.ts";
import { gameDir, loadRound, newRound, roundDir } from "./round.ts";

const USAGE = `GM loop (evals/loop/README.md)

QA rounds: blind testers play a scene, blind reviewers judge it, a report shows it all
  loop round <name> --scene hanged-clerk [--variants baseline,<variant>] [--personas thief,wizard,...]
             [--repeat 1] [--max-turns 20] [--level 3] [--goal "..."]
                                               a new round: every persona on every variant, neutral names
  loop import <round> <report.json.gz|session-dir> [--label "..."]
                                               bring a playtest's game into a round (its own arm)
  loop games <round>                           the games, for handing out (no arms shown)
  loop brief <round> <game>                    a tester's brief: their character, how to play, the commands
  loop start <round> <game>                    start a game (the tester's command)
  loop say <round> <game> <what you say or do> take a turn (the tester's command)
  loop transcript|sheet|map <round> <game>     the scene so far, the character sheet, the place
  loop review-pack <round> [<game>...]         what a blind reviewer reads: reviews/<game>.pack.md
  loop review-check <round> [<game>...]        check reviews/<game>.json: checks, turns, every quote in its turn
  loop report <round>                          report/index.html and report/games/*.html

Eval cases: a flagged turn as a fixture
  loop case <round> <game> <finding#> --id <case-id>     cut a case from a review's finding
  loop fixture <session-dir|report.json.gz> --turn N --id <case-id>
      [--check knows --severity 5 --quote "..." --why "..." --better "..."] [--criterion "..."]
                                               cut a case from any session or problem report

Rounds go under KM_LOOP_DIR (default runs/loop); cases under evals/loop/cases.
`;

function parse(args: string[]): { pos: string[]; flags: Record<string, string> } {
  const pos: string[] = []; const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) { flags[a.slice(2)] = args[i + 1] ?? ""; i++; } else pos.push(a);
  }
  return { pos, flags };
}
const list = (s: string | undefined) => s?.split(",").map(x => x.trim()).filter(Boolean);
const need = (x: string | undefined, usage: string): string => { if (!x) throw new Error(`Usage: ${usage}`); return x; };

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  // A turn's words are everything after the round and the game, flags and all.
  if (command === "say") {
    const [round, game, ...words] = rest;
    console.log(say(need(round, "loop say <round> <game> <words>"), need(game, "loop say <round> <game> <words>"), need(words.join(" ").trim() || undefined, "loop say <round> <game> <words>")));
    return;
  }
  const { pos, flags } = parse(rest);

  switch (command) {
    case "round": {
      const name = need(pos[0], "loop round <name> --scene <scene>");
      const round = newRound(name, {
        scene: need(flags.scene, "loop round <name> --scene <scene>"),
        variants: list(flags.variants) ?? ["baseline"],
        personas: list(flags.personas) ?? ["thief", "wizard", "barbarian", "tangent"],
        ...(flags.repeat ? { repeat: Number(flags.repeat) } : {}),
        ...(flags["max-turns"] ? { maxTurns: Number(flags["max-turns"]) } : {}),
        ...(flags.level ? { level: Number(flags.level) } : {}),
        ...(flags.goal ? { goal: flags.goal } : {}),
      });
      console.log(`Round ${name}: ${Object.keys(round.games).length} games of ${round.scene} in ${roundDir(name)}`);
      console.log(`Arms (keep these from the testers and reviewers): ${Object.entries(round.arms).map(([k, v]) => `${k}=${v}`).join(", ")}`);
      console.log(`Games: ${Object.keys(round.games).join(" ")}`);
      return;
    }
    case "import": {
      const usage = "loop import <round> <report.json.gz|session-dir> [--label \"...\"] [--persona playtest]";
      const id = importGame(need(pos[0], usage), need(pos[1], usage), { ...(flags.label ? { label: flags.label } : {}), ...(flags.persona ? { persona: flags.persona } : {}) });
      console.log(`Imported as ${id}.`);
      return;
    }
    case "games": {
      const round = loadRound(need(pos[0], "loop games <round>"));
      console.log(JSON.stringify(Object.entries(round.games).map(([id, g]) => {
        const state = join(gameDir(round.name, id), "state.json");
        const played = existsSync(state) ? (JSON.parse(readFileSync(state, "utf8")) as SessionState) : undefined;
        return { game: id, persona: g.persona, started: !!played, turn: played?.turn ?? 0, ended: played?.ended?.exitId ?? null, reviewed: existsSync(join(roundDir(round.name), "reviews", `${id}.json`)) };
      }), null, 1));
      return;
    }
    case "brief": console.log(brief(need(pos[0], "loop brief <round> <game>"), need(pos[1], "loop brief <round> <game>"))); return;
    case "start": console.log(start(need(pos[0], "loop start <round> <game>"), need(pos[1], "loop start <round> <game>"))); return;
    case "transcript": case "sheet": case "map":
      console.log(view(need(pos[0], `loop ${command} <round> <game>`), need(pos[1], `loop ${command} <round> <game>`), command)); return;
    case "review-pack": {
      const round = loadRound(need(pos[0], "loop review-pack <round> [<game>...]"));
      const games = pos.length > 1 ? pos.slice(1) : Object.keys(round.games).filter(g => existsSync(join(gameDir(round.name, g), "state.json")));
      for (const game of games) console.log(reviewPack({ round: round.name, game, sessionDir: gameDir(round.name, game), out: join(roundDir(round.name), "reviews", `${game}.pack.md`) }));
      return;
    }
    case "review-check": {
      const round = loadRound(need(pos[0], "loop review-check <round> [<game>...]"));
      const games = pos.length > 1 ? pos.slice(1) : Object.keys(round.games).filter(g => existsSync(join(roundDir(round.name), "reviews", `${g}.json`)));
      let bad = 0;
      for (const game of games) {
        const file = join(roundDir(round.name), "reviews", `${game}.json`);
        if (!existsSync(file)) { console.log(`${game}: no review at ${file}`); bad++; continue; }
        let review: Review;
        try { review = JSON.parse(readFileSync(file, "utf8")) as Review; } catch (e) { console.log(`${game}: not valid JSON: ${(e as Error).message}`); bad++; continue; }
        const state = JSON.parse(readFileSync(join(gameDir(round.name, game), "state.json"), "utf8")) as SessionState;
        const problems = checkReview(review, state);
        bad += problems.length ? 1 : 0;
        console.log(problems.length ? `${game}: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n${problems.map(p => `  - ${p}`).join("\n")}` : `${game}: ok (${review.findings.length} findings)`);
      }
      if (bad) process.exitCode = 1;
      return;
    }
    case "report": {
      const name = need(pos[0], "loop report <round>");
      const { dir, files, bytes } = roundReport(name);
      console.log(`${join(dir, "index.html")} and ${Object.keys(files).length} game pages (${(bytes / 1e6).toFixed(1)} MB)`);
      return;
    }
    case "case": {
      const usage = "loop case <round> <game> <finding#> --id <case-id>";
      const round = loadRound(need(pos[0], usage));
      const game = need(pos[1], usage);
      const n = Number(need(pos[2], usage));
      const review = JSON.parse(readFileSync(join(roundDir(round.name), "reviews", `${game}.json`), "utf8")) as Review;
      const finding: Finding | undefined = review.findings[n - 1];
      if (!finding) throw new Error(`Review ${game} has ${review.findings.length} findings.`);
      const id = need(flags.id, usage);
      const c = extractFixture(gameSource(gameDir(round.name, game)), {
        turn: finding.turn, id, out: join(CASES_DIR, id), finding, approach: flags.approach ?? JSON.parse(readFileSync(join(gameDir(round.name, game), "state.json"), "utf8")).approach,
        ...(finding.better ? { criterion: `TODO, from the review's "better": ${finding.better}` } : {}),
      });
      console.log(`Wrote ${join(CASES_DIR, c.id)}: ${c.scene}, turn ${c.turn}, ${finding.check} (${finding.severity}). Now write its criterion in case.json.`);
      return;
    }
    case "fixture": {
      const usage = "loop fixture <session-dir|report> --turn N --id <case-id>";
      const id = need(flags.id, usage);
      const c = extractFixture(gameSource(need(pos[0], usage)), {
        turn: Number(need(flags.turn, usage)), id, out: join(CASES_DIR, id),
        finding: { ...(flags.check ? { check: flags.check } : {}), ...(flags.severity ? { severity: Number(flags.severity) } : {}), ...(flags.quote ? { quote: flags.quote } : {}), ...(flags.why ? { why: flags.why } : {}), ...(flags.better ? { better: flags.better } : {}) },
        ...(flags.criterion ? { criterion: flags.criterion } : {}),
        ...(flags.approach ? { approach: flags.approach } : {}),
      });
      console.log(`Wrote ${join(CASES_DIR, c.id)}: ${c.scene}, turn ${c.turn}, "${c.input}"`);
      return;
    }
    default:
      console.log(USAGE);
      if (command && command !== "help" && command !== "--help") process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
