// After the GM loop's src/eval/loop/cli.ts at 5f01806 (origin/claude/gm-loop, draft PR #663): its QA rounds' commands (round, games, brief, start, say, the views, review-pack, review-check, triage, report, archive), on the game; the cases, fixtures and evals (case, fixture, run, run-report, rejudge, sample, import) aren't ported yet. New: stack up, down and status, the dev stack the games are played on.
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { connect } from "../client/net/connection.ts";
import { ownerAt, ownerFor } from "../client/net/owner.ts";
import { keepToken, serverFor, sessionAt } from "../client/net/session.ts";
import { apiKey } from "../ai/llm/openrouter.ts";
import { keptCalls, readCalls } from "../qa/loop/calls.ts";
import { callsPath, CAMPAIGNS, recordPath, REPO, reviewPath, roundDir, shortPath, type LoopConfig } from "../qa/loop/paths.ts";
import { act, brief, look, say, start, transcript, type PlayDeps, type Played } from "../qa/loop/play.ts";
import { probeMouthpiece, probeTurn, storyOf, type LoggedCall, type MouthpieceTry, type ProbeTry } from "../qa/loop/probe.ts";
import { BANDS, type Band } from "../shared/gm/two-part.ts";
import { readRecord, turnsTaken, type GameRecord } from "../qa/loop/record.ts";
import { roundReport, type ReportDeps } from "../qa/loop/report.ts";
import { checkReviewFile, reviewPack } from "../qa/loop/review.ts";
import { loadRound, newRound, parseArms, parseScenes, personas } from "../qa/loop/round.ts";
import { campaignAt, endingsOf, playable, sceneOf, type Loaded } from "../qa/loop/scenes.ts";
import { scenarioPath } from "../shared/scene/scenario.ts";
import { triageSheet } from "../qa/loop/triage.ts";
import { effectiveScene } from "../shared/scene/graph.ts";
import { loadScene } from "../shared/scene/load.ts";
import { ping, sql } from "./dev/spacetime.ts";
import { readStackFile } from "./dev/stack-file.ts";
import { stackDown, stackStatus, stackUp } from "./loop/stack.ts";
import { configureTerminal } from "./terminal.ts";

/**
 * npm run loop -- <command>: the GM loop's QA rounds on the game (qa/loop/README.md, the
 * kingmaker-gm-loop skill). The composition root: it reads the environment (KM_LOOP_DIR,
 * KM_LOOP_ARCHIVE) and the arguments, and hands qa/loop what it needs: the connections to a stack,
 * its owner's rows, its campaign, its call log.
 */

const USAGE = `GM loop: QA rounds on the game (qa/loop/README.md)

The stack the games are played on
  loop stack up [--fake] [--fresh] [--root runs/loop-stack] [--port 3330] [--ai-port 8817] [--mode host|namespace]
                                               the dev stack in the background (npm run dev's, in its own folder and ports)
  loop stack down|status [--root runs/loop-stack]

Rounds: blind testers play scenes, blind reviewers judge them, a report shows it all
  loop round <name> (--scene hanged-clerk | --scenes hanged-clerk:3,drowned-rat:2,heron-warehouse:2,kings-morning:1)
             [--personas thief,wizard,barbarian,tangent] [--stack runs/loop-stack | --arms baseline=runs/loop-stack,<name>=<stack>]
             [--max-turns 20] [--repeat 1] [--goal "..."]
                                               a new round: the games dealt across the scenes, personas and arms, neutral names
  loop games <round>                           the games, for handing out (no arms shown)
  loop brief <round> <game>                    a tester's brief: their character, how to play, the commands
  loop start <round> <game>                    make the character, take the story to the game's scene, print its opening
  loop say <round> <game> <what you say or do> take a turn: what answered it, as the player sees it (in a fight on the
                                               board, your turn in your own words, the GM's to play)
  loop act <round> <game> <id>                 in a fight on the board, one of its ACTIONS by its id (attack@x,y,
                                               walk@x,y, feature_second-wind, dash, end_turn, auto…); out, once it's
                                               over, back to the scene
  loop transcript|sheet|journal|map <round> <game>
                                               the scene so far, the character sheet, the notebook, the place (no turn)
  loop review-pack <round> [<game>...]         what a blind reviewer reads: reviews/<game>.pack.md
  loop review-check <round> [<game>...]        check reviews/<game>.json: checks, turns, every quote in its turn's reply
  loop triage <round>                          every finding with its key and turn, to write triage.json from
  loop report <round>                          report/index.html and report/games/*.html
  loop archive <round> [--to dir]              copy the round to KM_LOOP_ARCHIVE (or --to), to outlive this checkout
  loop probe <round> <game> <turn>[-<turn>] [--tries 3] [--want <node>] [--not <node>] [--log <file>]
             [--reply | --reply-text <file>] [--drop <route>,…] [--owe <discovery>,…] [--band <band>] [--role <id>]
                                               the co-GM asked again on a game's turns with this checkout's code and
                                               scenes, on real models: each try's moves, and how many reached --want
                                               or kept off --not (reads the round, writes nothing to it); --reply asks
                                               the turn's reply again first (a check it calls rolled, or set at --band),
                                               --reply-text puts a reply of your own in its place,
                                               --drop leaves the round's moves on those routes out of what's rebuilt,
                                               --owe owes those leads' names in it (a reply asked again is told who says it),
                                               --role shows the role each try set for that person
  loop probe <round> <game> <turn>[-<turn>] --mouthpiece [--arm before|after|both] [--tries 3] [--log <file>]
                                               the mouthpiece asked again: as the round sent it (before), and with this
                                               checkout's rules and per-turn note parts (after); each try's narration,
                                               check and outcomes, and whether a closing closed

Rounds go under KM_LOOP_DIR (default runs/loop). Not ported yet: the cases, fixtures and evals.`;

const STACK = "runs/loop-stack";

async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const [command, ...rest] = argv;
  configureTerminal(env);
  const config = configOf(env);
  const deps = playDeps();

  // A turn's words are everything after the round and the game, flags and all.
  if (command === "say") {
    const [round, game, ...words] = rest;
    return shown(await say(config, need(round), need(game), need(words.join(" ").trim() || undefined), deps));
  }
  const { pos, flags } = parse(rest);
  switch (command) {
    case "stack": return await stack(pos[0], flags);
    case "round": return await round(config, need(pos[0]), flags);
    case "games": return games(config, need(pos[0]));
    case "brief": return shown({ code: 0, text: brief(config, need(pos[0]), need(pos[1])) });
    case "start": return shown(await start(config, need(pos[0]), need(pos[1]), deps));
    case "act": return shown(await act(config, need(pos[0]), need(pos[1]), need(pos[2]), deps));
    case "transcript": return shown(await transcript(config, need(pos[0]), need(pos[1]), deps));
    case "sheet": case "journal": case "map": return shown(await look(config, need(pos[0]), need(pos[1]), command, deps));
    case "review-pack": return await packs(config, need(pos[0]), pos.slice(1), deps);
    case "review-check": return checks(config, need(pos[0]), pos.slice(1));
    case "triage": return shown({ code: 0, text: triageSheet(config, need(pos[0])) });
    case "report": return await report(config, need(pos[0]), deps);
    case "archive": return archive(config, need(pos[0]), flags.to || env.KM_LOOP_ARCHIVE);
    case "probe": return await probe(config, need(pos[0]), need(pos[1]), need(pos[2]), flags);
    default:
      console.log(USAGE);
      return command && command !== "help" && command !== "--help" ? 1 : 0;
  }
}

function configOf(env: NodeJS.ProcessEnv): LoopConfig {
  const dir = env.KM_LOOP_DIR;
  return { rounds: dir ? resolve(dir) : join(REPO, "runs", "loop"), command: `${dir ? `KM_LOOP_DIR=${dir} ` : ""}npm run -s loop --` };
}

// ---------------------------------------------------------------------------------------------
// The commands

async function stack(what: string | undefined, flags: Flags): Promise<number> {
  const root = resolve(REPO, flags.root || STACK);
  if (what === "down") return shown({ code: 0, text: await stackDown(root) });
  if (what === "status") return shown({ code: 0, text: stackStatus(root) });
  if (what !== "up") return shown({ code: 1, text: "stack takes up, down or status." });
  const ask = { root, port: Number(flags.port || 3330), aiPort: Number(flags["ai-port"] || 8817), fake: "fake" in flags, fresh: "fresh" in flags, mode: flags.mode };
  console.log(`Starting the dev stack in ${shortPath(root)} (${ask.fake ? "the fake model" : "real models"}, ports ${ask.port} and ${ask.aiPort}): a minute or two…`);
  return shown({ code: 0, text: await stackUp(ask, REPO) });
}

/** The zoo's scene exhibits a round can play, as zoo/<exhibit> (docs/combat-gm.md: the Crakes' toll, zoo/toll). */
function zooScenes(): string[] {
  const path = join(CAMPAIGNS, "zoo", scenarioPath("zoo"));
  if (!existsSync(path)) return [];
  const file = JSON.parse(readFileSync(path, "utf8")) as { exhibits?: Array<{ id: string; fight?: unknown }> };
  return (file.exhibits ?? []).filter(e => !e.fight).map(e => `zoo/${e.id}`);
}

async function round(config: LoopConfig, name: string, flags: Flags): Promise<number> {
  const loaded = await campaignAt(join(CAMPAIGNS, "caerwyn"));
  const made = newRound(config, name, {
    scenes: parseScenes(flags.scenes || need(flags.scene, "round <name> --scene <scene> or --scenes <scene>:<n>,…")),
    personas: (flags.personas || "thief,wizard,barbarian,tangent").split(",").map(p => p.trim()).filter(Boolean),
    arms: parseArms(flags.arms, flags.stack || STACK),
    ...(flags.repeat ? { repeat: Number(flags.repeat) } : {}),
    ...(flags["max-turns"] ? { maxTurns: Number(flags["max-turns"]) } : {}),
    ...(flags.goal ? { goal: flags.goal } : {}),
  }, { personas: personas(), scenes: [...playable(loaded), ...zooScenes()], build: build(), now: new Date().toISOString() });

  const n = Object.keys(made.games).length;
  console.log(`Round ${name}: ${n} game${n === 1 ? "" : "s"} (${made.scenes.map(s => `${s.scene} ${s.games}`).join(", ")}) in ${shortPath(roundDir(config, name))}`);
  console.log(`Arms (keep these from the testers and reviewers): ${Object.entries(made.arms).map(([k, a]) => `${k}=${a.name} (${a.stack})`).join(", ")}`);
  console.log(`Games: ${Object.keys(made.games).join(" ")}`);
  return 0;
}

/** The games, as JSON: each one's persona, scene and how far it's got; never its arm. */
function games(config: LoopConfig, name: string): number {
  const r = loadRound(config, name);
  console.log(JSON.stringify(Object.entries(r.games).map(([game, g]) => {
    const record = readRecord(recordPath(config, name, game));
    return {
      game, persona: g.persona, scene: g.scene, started: !!record?.sceneRow, turns: record ? turnsTaken(record) : 0,
      ended: record?.ended?.title ?? null, stopped: record?.stopped ?? null, reviewed: existsSync(reviewPath(config, name, game)),
    };
  }), null, 1));
  return 0;
}

async function packs(config: LoopConfig, name: string, asked: string[], deps: PlayDeps): Promise<number> {
  const r = loadRound(config, name);
  const ids = asked.length ? asked : Object.keys(r.games).filter(g => readRecord(recordPath(config, name, g))?.sceneRow);
  for (const game of ids) console.log(shortPath(await reviewPack(config, name, game, record => campaignOfRecord(record, deps))));
  return 0;
}

function checks(config: LoopConfig, name: string, asked: string[]): number {
  const r = loadRound(config, name);
  const ids = asked.length ? asked : Object.keys(r.games).filter(g => existsSync(reviewPath(config, name, g)));
  let bad = 0;
  for (const game of ids) {
    const problems = checkReviewFile(config, name, game);
    if (problems.length) bad++;
    console.log(problems.length ? `${game}: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n${problems.map(p => `  - ${p}`).join("\n")}` : `${game}: ok`);
  }
  if (!ids.length) console.log("No reviews yet.");
  return bad ? 1 : 0;
}

async function report(config: LoopConfig, name: string, deps: PlayDeps): Promise<number> {
  const reading: ReportDeps = {
    calls: record => (record.uid ? keptCalls(deps.callLog(record.stack, record.uid), callsPath(config, name, record.game)) : []),
    async scene(record, key) {
      const loaded = record?.campaign ? await campaignOfRecord(record, deps) : await deps.campaign(STACK, "caerwyn", "");
      const scene = sceneOf(loaded, key);
      return { title: scene.title, endings: endingsOf(scene) };
    },
  };
  const { dir, files, bytes, strays } = await roundReport(config, name, reading);
  console.log(`${shortPath(join(dir, "index.html"))} and ${Object.keys(files).length} game pages (${(bytes / 1e6).toFixed(1)} MB)`);
  if (strays.length) console.log(`triage.json names findings there aren't: ${strays.join(", ")}`);
  return 0;
}

function archive(config: LoopConfig, name: string, to: string | undefined): number {
  const from = roundDir(config, name);
  if (!existsSync(from)) return shown({ code: 1, text: `There's no round ${name} (${from}).` });
  if (!to) return shown({ code: 1, text: "Set KM_LOOP_ARCHIVE (the user's is ~/git/kingmaker-scratch/loop), or pass --to <dir>." });
  cpSync(from, join(resolve(to), name), { recursive: true });
  return shown({ code: 0, text: `Copied ${shortPath(from)} to ${join(resolve(to), name)}` });
}

// ---------------------------------------------------------------------------------------------
// What qa/loop is handed

/** The loop's way into a stack: a session's connection (with the stack's owner, for end_scene), the owner's SQL, the campaign, the call log. */
function playDeps(): PlayDeps {
  const loaded = new Map<string, Promise<Loaded>>();
  return {
    async connect(stack, session) {
      const root = resolve(REPO, stack);
      const file = readStackFile(root);
      if (!file) throw new Error(`There's no stack in ${stack}: npm run loop -- stack up (or npm run dev -- --root ${stack}).`);
      if (!(await ping(file.http))) throw new Error(`The stack in ${stack} isn't answering at ${file.http}: npm run loop -- stack status.`);
      const kept = sessionAt(session.runs, session.name);
      const server = serverFor({}, root);
      const owner = ownerFor(ownerAt(root), server);
      return await connect({ ...server, ...(kept.token ? { token: kept.token } : {}), ...(owner ? { owner } : {}), onIdentity: (identity, token) => keepToken(kept, identity, token) });
    },
    owner(stack) {
      const file = readStackFile(resolve(REPO, stack));
      return file ? query => sql(file.http, query, file.owner.token) : undefined;
    },
    campaign(stack, id, version) {
      const installed = join(resolve(REPO, stack), "ai", "campaigns", id, version);
      const dir = version && existsSync(join(installed, scenarioPath(id))) ? installed : join(CAMPAIGNS, id || "caerwyn");
      if (!loaded.has(dir)) loaded.set(dir, campaignAt(dir));
      return loaded.get(dir)!;
    },
    calls: (stack, uid) => readCalls(callLogOf(stack, uid)),
    callLog: (stack, uid) => callLogOf(stack, uid),
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    now: () => new Date(),
  };
}

/** A game's call log in its stack's AI service's store. */
const callLogOf = (stack: string, uid: string) => join(resolve(REPO, stack), "ai", "games", uid, "calls.jsonl");

const campaignOfRecord = (record: GameRecord, deps: PlayDeps) => deps.campaign(record.stack, record.campaign?.id ?? "caerwyn", record.campaign?.version ?? "");

/** The commit, and whether the game's code or campaign has changes beyond it. */
function build(): { commit: string; dirty: boolean } {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "ai", "shared", "simulation", "client", "hosts", "campaigns", "qa"], { cwd: REPO, encoding: "utf8" }).trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: "unknown", dirty: true };
  }
}

/**
 * The co-GM asked again on a game's turns (qa/loop/probe.ts), `--tries` times each, the tries of a
 * turn side by side: the scene is this checkout's campaign's, the bookkeeping rebuilt from the
 * round's co-GM moves, and the transcript, roles and prep's head the round's own. Each try's moves
 * and the nodes they reached; `--want` counts the tries that reached a node, `--not` those that kept
 * off one; and what it all cost, kept off the stack's ledger. `--reply` asks each try's reply again
 * first and shows it, `--drop` leaves the round's moves on those routes out of the bookkeeping (the
 * bad ending a co-GM took the turn before), `--owe` owes those leads' names in it (as if the co-GM
 * before had been refused them: a reply asked again is told who says the name), `--band` sets how a
 * check called there comes out, and `--role` shows the role each try set for that person.
 */
async function probe(config: LoopConfig, name: string, game: string, turns: string, flags: Flags): Promise<number> {
  const record = readRecord(recordPath(config, name, game));
  if (!record?.sceneRow || !record.player) return shown({ code: 1, text: `${game} of ${name} has no scene played` });
  if ("mouthpiece" in flags) return await probeMouthpieceTurns(config, name, game, record, turns, flags);
  const scenesDir = join(CAMPAIGNS, record.campaign?.id ?? "caerwyn", "scenes");
  const scenes = readdirSync(scenesDir).filter(f => f.endsWith(".kmscene")).map(f => effectiveScene(loadScene(readFileSync(join(scenesDir, f), "utf8")), []));
  const scene = scenes.find(s => s.id === record.scene);
  if (!scene) return shown({ code: 1, text: `no scene ${record.scene} in ${shortPath(scenesDir)}` });
  const story = storyOf(record.campaign?.id ?? "caerwyn", scenes);
  const calls = readFileSync(callsPath(config, name, game), "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as LoggedCall);
  const [from, to = from] = turns.split("-").map(Number) as [number, number?];
  const tries = Number(flags.tries || 3);
  let spent = 0;
  const context = { fetch, apiKey: apiKey(), cost: (line: { costUsd: number }) => { spent += line.costUsd; }, log: (entry: Record<string, unknown>) => { if (flags.log) appendFileSync(resolve(flags.log), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`); } };
  const tally = { want: 0, not: 0, all: 0 };
  const list = (flag: string | undefined) => (flag || "").split(",").map(s => s.trim()).filter(Boolean);
  const how = { reply: "reply" in flags || !!flags["reply-text"], drop: list(flags.drop), owe: list(flags.owe), ...(flags.band ? { band: flags.band as Band } : {}), ...(flags["reply-text"] ? { replyText: readFileSync(resolve(flags["reply-text"]), "utf8") } : {}) };
  if (how.band && !BANDS.includes(how.band)) return shown({ code: 1, text: `--band takes one of ${BANDS.join(", ")}` });
  for (let turn = from; turn <= to!; turn++) {
    const done = await Promise.all(Array.from({ length: tries }, () => probeTurn(scene, calls, record.sceneRow!, turn, { player: record.player!, absent: record.handedOn?.absent ?? [], story }, context, how)));
    const { rebuilt, logged } = done[0]!;
    const same = rebuilt.reached.join() === logged.reached.join() && rebuilt.turnsInBeat === logged.turnsInBeat;
    console.log(`${game} turn ${turn}: rebuilt ${rebuilt.reached.join(", ")} (${rebuilt.turnsInBeat} at the stage)${how.owe.length ? `, the name owed for ${how.owe.join(", ")}` : ""}${how.reply ? `${how.drop.length ? `, without the round's ${how.drop.join(", ")}` : ""}; the reply asked again` : same ? ", as the round had it" : `; the round had ${logged.reached.join(", ")} (${logged.turnsInBeat})`}`);
    done.forEach((t: ProbeTry, i) => {
      const wanted = !!flags.want && t.reached.includes(flags.want), avoided = !!flags.not && !t.reached.includes(flags.not);
      tally.all++; if (wanted) tally.want++; if (avoided) tally.not++;
      console.log(`  try ${i + 1}: ${t.error ? `failed: ${t.error}` : t.moves.length ? t.moves.map(m => `${m.route}${m.outcome === "none" ? "" : ` (${m.outcome})`}: "${m.why}"`).join("; ") : "no move"}${t.reached.length ? ` -> ${t.reached.join(", ")}` : ""}${t.owed.length ? `; the name owed for ${t.owed.join(", ")}` : ""} [roles: ${t.roles.join(", ") || "none"}; ${(t.ms / 1000).toFixed(1)} s]`);
      if (t.replied) console.log(`    the reply: ${t.replied.narration}${t.replied.dice ? `\n    [${t.replied.dice}] ${t.replied.outcome}` : ""}`);
      const role = flags.role ? t.given[flags.role] : undefined;
      if (flags.role) console.log(`    ${flags.role}'s role: ${role ? role.conversation_role : "(not set)"}`);
    });
  }
  const rate = (n: number) => `${n} of ${tally.all}`;
  console.log(`${flags.want ? `reached ${flags.want}: ${rate(tally.want)}. ` : ""}${flags.not ? `kept off ${flags.not}: ${rate(tally.not)}. ` : ""}Spent $${spent.toFixed(4)}.`);
  return 0;
}

/**
 * The mouthpiece asked again on a game's turns (qa/loop/probe.ts probeMouthpiece), `--tries` times
 * for each arm: before (the round's request as sent) and after (this checkout's rules and per-turn
 * note parts in it), each try's narration as the model wrote it (tags and all), its check with the
 * five outcomes, and whether a closing closed; with `--log`, each try as a line of JSON.
 */
async function probeMouthpieceTurns(config: LoopConfig, name: string, game: string, record: GameRecord, turns: string, flags: Flags): Promise<number> {
  const loaded = await campaignAt(join(CAMPAIGNS, record.campaign?.id ?? "caerwyn"));
  // The story's scenes have their places: the world the per-turn note's names and the companion are read from.
  const story = (id: string) => loaded.campaign.story.scene(id);
  const scene = story(record.scene);
  if (!scene) return shown({ code: 1, text: `the campaign has no scene ${record.scene}` });
  const calls = readFileSync(callsPath(config, name, game), "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as LoggedCall);
  const [from, to = from] = turns.split("-").map(Number) as [number, number?];
  const tries = Number(flags.tries || 3);
  const arms = (flags.arm && flags.arm !== "both" ? [flags.arm] : ["before", "after"]) as Array<"before" | "after">;
  let spent = 0;
  const context = { fetch, apiKey: apiKey(), cost: (line: { costUsd: number }) => { spent += line.costUsd; } };
  for (let turn = from; turn <= to!; turn++) {
    console.log(`\n${game} turn ${turn}: > ${record.turns[String(turn)]?.said ?? "(the opening)"}`);
    for (const arm of arms) {
      const done = await Promise.all(Array.from({ length: tries }, () => probeMouthpiece(scene, story, calls, record.sceneRow!, turn, { ...record, player: record.player! }, arm, context)));
      done.forEach((t: MouthpieceTry, i) => {
        if (flags.log) appendFileSync(resolve(flags.log), `${JSON.stringify({ at: new Date().toISOString(), round: name, game, turn, try: i + 1, ...t })}\n`);
        console.log(`\n  ${arm} ${i + 1}: ${t.error ? `failed: ${t.error}` : t.narration}${t.closes !== undefined ? `\n    [closes: ${t.closes}]` : ""}`);
        if (t.check) console.log(`    [check ${t.check.skill} DC ${t.check.dc}]\n${Object.entries(t.check.outcomes).map(([band, words]) => `    - ${band}: ${words}`).join("\n")}`);
      });
    }
  }
  console.log(`\nSpent $${spent.toFixed(4)}.`);
  return 0;
}

// ---------------------------------------------------------------------------------------------

type Flags = Record<string, string>;

/** Positionals, and --flags with their values (a flag with none, or followed by another flag, is "": present). */
function parse(args: string[]): { pos: string[]; flags: Flags } {
  const pos: string[] = [], flags: Flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const next = args[i + 1];
    flags[a.slice(2)] = next !== undefined && !next.startsWith("--") ? (i++, next) : "";
  }
  return { pos, flags };
}

function need(x: string | undefined, usage = "see npm run loop -- help"): string {
  if (!x) throw new Error(`Missing an argument: ${usage}`);
  return x;
}

function shown(played: Played): number {
  console.log(played.text);
  return played.code;
}

main(process.argv.slice(2), process.env).then(code => process.exit(code), (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
