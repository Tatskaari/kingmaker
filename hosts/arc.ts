// The checks' words are the prototype's src/app/smoke/flow.ts at 44c6d4a (its sixteen asserts, in order); the run around them is v2's: a stack of its own, play new, and each check on once its vertical lands.
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { newGameOf, type HomeRows } from "../client/backend.ts";
import type { ExploreView } from "../client/explore/rows.ts";
import * as verbs from "../client/headless.ts";
import { stageView } from "../client/look/stage-view.ts";
import { connect, type Connection } from "../client/net/connection.ts";
import type { Mode } from "./dev/mode.ts";
import { startStack, type Stack } from "./dev/stack.ts";
import { fixDice } from "./e2e/kit.ts";
import { configureTerminal } from "./terminal.ts";

/**
 * The arc check (verticals.md §2, v1-design §4.5, story-design §5): the prototype's whole-arc check
 * (src/app/smoke/flow.ts at 44c6d4a) on the split, with the prologue in front of it. A stack of its
 * own on the fake model, the headless client's `play new` as the prototype's flow makes its character
 * (a sentence, no build: the model picks one), which opens the King's Road on the cart (a scene that
 * comes to the player); then the prologue (the road ended, the toll bridge walked to and ended, the
 * King's thanks come to the player and ended), then the flow from the palace to the granary yard and
 * on to The End, each check on once the vertical that brings it has landed. The rest say which unit
 * turns them on. Exits 0 when every check that's on passes.
 *
 *   npm run arc [-- --port 3320] [--ai-port 8807] [--root runs/arc] [--mode host|namespace]
 */

const USAGE = `npm run arc [-- options]
  --port <n>            SpacetimeDB's port (3320)
  --ai-port <n>         the AI service's port (8807)
  --root <dir>          the stack's folder (runs/arc): emptied at the start, but for its keys
  --mode host|namespace detected when absent: host when 11.0.0.1 is on this machine`;

/** The arc's dice, fixed once the campaign is in (no check reads a roll yet, but none is ever SpacetimeDB's randomness). */
const DICE = 1018;
/** The fake co-GM's walk where the arc says lines (the Heron's): to blades out, its fight (docs/combat-gm.md). */
const HERON_WALK = ["fight"];
/** The prototype's flow's character (flow.ts:31). */
const WHO = "Tamsin Vell: a disgraced palace auditor with a ledger-keeper's eye, a sharp tongue and a borrowed rapier";

/**
 * What a check reads: the player's rows once the game is made and begun; on the map (V2), the map as
 * the game began (`start`: the King's Road, its first scene open); and, scene by scene, what the
 * story showed as the flow took it on (`way`: each check's number, with what it found there, or
 * undefined where it didn't hold).
 */
interface Arc { conn: Connection; home: HomeRows; start?: ExploreView; way: Map<number, string | undefined> }

/** One of the flow's checks: what it holds, the unit that turns it on, and, once on, what it found (or undefined when it doesn't hold). */
interface ArcCheck { what: string; unit: string; run?(arc: Arc): string | undefined }

/**
 * The prologue's six, then the flow's, in their order (append-only: a vertical gives a check its
 * `run`). The flow's second and third checks were where it began, in the granary lane: the story
 * begins on the King's Road now, and the yard is reached from the palace after the King's thanks.
 */
const CHECKS: ArcCheck[] = [
  { what: "the character is built by the rules engine", unit: "V1", run: builtByTheEngine },
  { what: "the story starts on the King's Road in the afternoon: its first scene comes to the player, on the cart", unit: "prologue", run: seen(2) },
  { what: "the road's place is drawn with the player in it", unit: "prologue", run: seen(3) },
  { what: "on to the toll bridge at dusk", unit: "prologue", run: seen(4) },
  { what: "along the road onto the bridge", unit: "prologue", run: seen(5) },
  { what: "the King's thanks comes to the player: the palace, with no go", unit: "prologue", run: seen(6) },
  { what: "the hanged clerk waits in the morning, the granary yard the lead", unit: "prologue", run: seen(7) },
  { what: "the granary yard opens the hanged clerk", unit: "V2", run: seen(8) },
  { what: "the scene's place is drawn with the player in it", unit: "V9", run: seen(9) },
  { what: "on to the Drowned Rat at dusk", unit: "V3", run: seen(10) },
  { what: "Kell walks with the investigator", unit: "V3", run: seen(11) },
  { what: "down the river stairs and into the Rat", unit: "V3", run: seen(12) },
  { what: "on to the Heron at night", unit: "V4", run: seen(13) },
  { what: "along the wharf to the Heron", unit: "V4", run: seen(14) },
  { what: "Roll for initiative!", unit: "V4", run: seen(15) },
  { what: "Sallow and the Crakes are in the fight", unit: "V12", run: seen(16) },
  { what: "after the fight, back to the Heron for its aftermath", unit: "V4", run: seen(17) },
  { what: "the King's morning opens straight away", unit: "V4", run: seen(18) },
  { what: "The End", unit: "V4", run: seen(19) },
  { what: "observe says The End", unit: "V4", run: seen(20) },
];

/** Checks 2 to 20 (the prologue, then flow.ts:37-73): what the story showed at that point of the flow, as theStory and theWayOn found it. */
function seen(n: number): (arc: Arc) => string | undefined {
  return arc => arc.way.get(n);
}

/**
 * Checks 3 and 9 (flow.ts:40, the world bridge's drawing half of V9): the scene's place, the world
 * rebuilt from the player's rows, drawn by the look layer's stage view, plain, at 80x24, has the
 * player's @. Looked at on the road and in the yard, before the story moves on.
 */
function placeDrawn(conn: Connection): string | undefined {
  const place = conn.view()?.place;
  const drawn = place ? stageView(place.world, { w: 80, h: 24 }, { t: 0, time: place.time, glyphs: "plain" })?.toPlain() ?? "" : "";
  const row = drawn.split("\n").findIndex(line => line.includes("@"));
  return row >= 0 ? `${place!.world.entities[place!.world.root]?.name ?? "the place"} at 80x24, the @ on row ${row + 1}` : undefined;
}

/** Check 1 (flow.ts:32): the sheet's build line is the engine's ("<species> <class> 3 (<subclass>), <background> background"), and its status line its HP. */
function builtByTheEngine({ home }: Arc): string | undefined {
  const build = home.sheet?.build ?? "", status = home.sheet?.statusLine ?? "";
  return /^\S+ \S+ 3 \([^)]+\), .+ background$/.test(build) && status.startsWith("HP ") ? `${build}: ${status}` : undefined;
}

/** Check 2, as the game began (looked at then): the story on the map, the King's Road come to the player (open, the seat in it, no walk), in the afternoon. */
function theRoad({ start, home, conn }: Arc): string | undefined {
  const story = start?.ex.story;
  const scene = conn.rows()?.scene;
  const where = home.games.find(g => g.gameId === home.seat?.gameId)?.where;
  const ok = story?.lead === "kings-road" && story.time === "afternoon" && start?.ex.scene === "kings-road" && scene?.title === "The King's Road" && home.seat?.sceneId === scene.id;
  return ok ? `${story.time}, ${scene.title} open on ${start!.ex.map} (${start!.ex.at.x},${start!.ex.at.y}); my_games: ${where}` : undefined;
}

/** Check 8 (flow.ts:37-38), as the walk in left it (the story goes on from there): go from the palace, after the King's thanks, into the yard, the hanged clerk open with the seat in it. */
function theYard(walked: { code: number; printed: string }, conn: Connection): string | undefined {
  const ex = conn.explore()?.ex;
  const scene = conn.rows()?.scene;
  const ok = walked.code === 0 && ex?.scene === "hanged-clerk" && scene?.title === "The Hanged Clerk" && conn.home().seat?.sceneId === scene.id;
  return ok ? `${ex.map} (${ex.at.x},${ex.at.y}) in ${ex.scene}: "${walked.printed.split("\n")[2] ?? ""}"` : undefined;
}

const flags = flagsOf(process.argv.slice(2));
configureTerminal(process.env);

console.log(`The arc: the prototype's flow on the split (ports ${flags.port} and ${flags.aiPort}, ${flags.root})`);
const stack = await startStack({
  root: flags.root, stdbPort: flags.port, aiPort: flags.aiPort, ...(flags.mode ? { mode: flags.mode } : {}),
  model: "fake", fake: { streamMs: 0, coGm: { endings: [...HERON_WALK] } }, fresh: true, log: line => console.log(`  … ${line}`),
}).catch((error: unknown) => {
  console.error(`\n✗ the stack didn't start: ${error instanceof Error ? error.message : String(error)}\nFAIL`);
  process.exit(1);
});

let failed = 0;
try {
  const arc = await theStory(stack);
  failed = checked(arc);
  arc.conn.close();
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  console.error(`  The logs are in ${flags.root}/logs.`);
  failed = 1;
} finally {
  await stack.down();
}

const on = CHECKS.filter(c => c.run).length;
console.log(failed ? `\nFAIL: ${failed} of the ${on} checks on` : `\nPASS: ${on} of ${CHECKS.length} checks on, the rest skipped until the units that bring them`);
process.exit(failed ? 1 : 0);

// ---------------------------------------------------------------------------------------------

/**
 * The campaign installed and the dice fixed, then play new as the flow makes its character: the game
 * made and begun, its first scene (the King's Road) open on the cart. Then the story on, as the flow
 * takes it (story-design §1.3): each scene ended through the flow's exit as the QA console's end does
 * (end_scene as the stack's owner), and go to the next, walking to it on the map as the flow does,
 * or the next coming to the player (the King's thanks, the King's morning).
 */
async function theStory(stack: Stack): Promise<Arc> {
  await stack.install(join(import.meta.dirname, "..", "campaigns", "caerwyn"));
  await fixDice(stack, DICE);
  // The stack's owner, for end (end_scene), as play end has it from the dev stack's stack.json.
  const conn = await connect({ url: stack.ws, db: stack.db, owner: { http: stack.http, db: stack.db, token: stack.owner.token } });
  const who = newGameOf(WHO, "", "caerwyn");
  // The King's Road comes to the player: new opens it on the cart and waits for its opening.
  const made = await played(`new --as "${WHO}"`, out => verbs.newCharacter(conn, { campaign: who.campaign, name: who.name, concept: who.concept }, out));
  if (made.code !== 0) throw new Error(`play new exited ${made.code}`);
  const start = conn.explore();
  // The scene's place comes with its rows: wait for them (10 s at most), as the screen does, and look at it before the story moves on.
  for (let waited = 0; !conn.view()?.place && waited < 10_000; waited += 100) await new Promise(r => setTimeout(r, 100));
  const drawn = placeDrawn(conn);
  const home = conn.home();
  const arc: Arc = { conn, home, ...(start ? { start } : {}), way: new Map() };
  const road = theRoad(arc);
  const way = await theWayOn(conn);
  way.set(2, road);
  way.set(3, drawn && road ? drawn : undefined);
  return { ...arc, way };
}

/** A headless verb, printed as the QA console prints it: its exit code and what it said. */
async function played(verb: string, play: (out: verbs.Out) => Promise<number> | number): Promise<{ code: number; text: string }> {
  const printed: string[] = [];
  const code = await play({ print: text => printed.push(text), progress: () => {} });
  console.log(`\nplay ${verb}\n${printed.join("\n").replace(/^/gm, "  | ")}\n`);
  return { code, text: printed.join("\n") };
}

/**
 * The flow from the yard to The End (flow.ts:40-73): end each scene through its exit, go to the lead,
 * fight the Heron's fight on the board, and observe The End. What each point showed, by check.
 * Lines are said only at the Heron: the fake co-GM's walk takes it to blades out on the third, the
 * fight breaks out after that line's settle, everyone takes a side, the player goes on to it (the
 * card's To the fight) and it's fought on the Heron's own map by the dice to its end, then out, the
 * scene going on after it with the GM's aftermath; the co-GM's walk through every scene is the e2e's (step 31).
 */
async function theWayOn(conn: Connection): Promise<Map<number, string | undefined>> {
  const way = new Map<number, string | undefined>();
  const story = () => conn.view()?.story;
  const at = (title: string) => { const v = conn.view(); return v?.title === title && v.phase !== "failed" && !v.over && !v.fighting; };

  // The prologue: the King's Road ended on the way on, the toll bridge walked to and ended, the King's thanks come to the player.
  await played("end --exit on-to-the-bridge", out => verbs.end(conn, "on-to-the-bridge", out));
  way.set(4, story()?.lead?.key === "toll-bridge" && story()?.time === "evening" ? `the lead ${story()!.lead!.title}, ${story()!.time}` : undefined);
  const bridge = await played("go", out => verbs.go(conn, out));
  way.set(5, bridge.code === 0 && at("Garrow's Toll Bridge") ? `"${bridge.text.split("\n")[2]}"` : undefined);
  const thanks = await played("end --exit to-the-king", out => verbs.end(conn, "to-the-king", out));
  way.set(6, thanks.code === 0 && at("The King's Thanks") && conn.explore()?.ex.map === "palace" ? `${conn.view()!.title}, ${story()?.time}, on the palace's map with no go` : undefined);
  await played("end --exit kings-guest", out => verbs.end(conn, "kings-guest", out));
  way.set(7, story()?.lead?.key === "hanged-clerk" && story()?.time === "morning" ? `the lead ${story()!.lead!.title}, ${story()!.time}` : undefined);

  // The flow: into the yard from the palace, then on as the prototype's went.
  const yard = await played("go", out => verbs.go(conn, out));
  way.set(8, theYard({ code: yard.code, printed: yard.text }, conn));
  for (let waited = 0; !conn.view()?.place && waited < 10_000; waited += 100) await new Promise(r => setTimeout(r, 100));
  way.set(9, at("The Hanged Clerk") ? placeDrawn(conn) : undefined);

  // The hanged clerk's good ending (it was open-case in the prototype's flow, whose clerk M2 re-authored as beats).
  await played("end --exit murder-unknown", out => verbs.end(conn, "murder-unknown", out));
  way.set(10, story()?.lead?.key === "drowned-rat" && story()?.time === "evening" ? `the lead ${story()!.lead!.title}, ${story()!.time}` : undefined);
  way.set(11, story()?.with.some(w => w.key === "kell") ? `with ${story()!.with.map(w => w.name).join(", ")}` : undefined);
  const rat = await played("go", out => verbs.go(conn, out));
  way.set(12, rat.code === 0 && at("The Drowned Rat") ? `"${rat.text.split("\n")[2]}"` : undefined);

  await played("end --exit hobb-talks", out => verbs.end(conn, "hobb-talks", out));
  way.set(13, story()?.lead?.key === "heron-warehouse" && story()?.time === "night" ? `the lead ${story()!.lead!.title}, ${story()!.time}` : undefined);
  const heron = await played("go", out => verbs.go(conn, out));
  way.set(14, heron.code === 0 && at("The Heron Warehouse") ? `"${heron.text.split("\n")[2]}"` : undefined);

  for (const line of ["I'll take that book off the desk.", "Someone's coming: the Master?", "Sallow, you're cornered."]) await played(`say ${line}`, out => verbs.say(conn, line, out, { settled: true }));
  const sides = conn.view()?.entries.find(e => e.text.startsWith("Roll for initiative! "))?.text;
  way.set(15, sides && conn.view()?.fighting ? `"${sides}"` : undefined);
  const onBoard = await played("act --id fight (To the fight)", out => verbs.fight(conn, out));
  const units = Object.values(conn.fight?.()?.board.units ?? {});
  const foes = (id: string) => units.some(u => u.castId === id && u.side === "enemy");
  way.set(16, onBoard.code === 0 && foes("sallow") && foes("crake-1") && foes("crake-2") ? `Sallow and both Crakes against the player on ${conn.fight!()!.map.id}'s board` : undefined);
  await played("the fight seen through by the dice, then out", out => verbs.foughtOut(conn, out, { settled: true }));
  const told = conn.view()?.entries.find(e => e.text.startsWith("The fight: "));
  way.set(17, told && at("The Heron Warehouse") ? `"${told.text}", and the scene goes on` : undefined);

  const summons = await played("end --exit caught-in-the-act", out => verbs.end(conn, "caught-in-the-act", out));
  way.set(18, summons.code === 0 && at("The King's Morning") ? `${conn.view()!.title}, ${story()?.time}, with no go` : undefined);
  const end = await played("end --exit justice", out => verbs.end(conn, "justice", out));
  way.set(19, story()?.ended && end.text.includes("MODE: end") ? "the story is over" : undefined);
  const observed = await played("observe", out => verbs.observe(conn, out));
  way.set(20, observed.text.includes("THE END") ? `"${observed.text.split("\n").find(l => l.startsWith("THE END"))}"` : undefined);
  return way;
}

/** Each check in turn: "ok" or "FAIL" for those on, "skip" with the unit for the rest. How many failed. */
function checked(arc: Arc): number {
  let failures = 0;
  CHECKS.forEach((c, i) => {
    if (!c.run) return console.log(`skip: ${i + 1}. ${c.what} (${c.unit})`);
    const found = c.run(arc);
    if (!found) failures++;
    console.log(found ? `ok: ${i + 1}. ${c.what} (${found})` : `FAIL: ${i + 1}. ${c.what}`);
  });
  return failures;
}

function flagsOf(argv: string[]): { port: number; aiPort: number; root: string; mode?: Mode } {
  const { values } = parseArgs({ args: argv, options: { port: { type: "string" }, "ai-port": { type: "string" }, root: { type: "string" }, mode: { type: "string" }, help: { type: "boolean" } } });
  if (values.help) { console.log(USAGE); process.exit(0); }
  const mode = values.mode;
  if (mode !== undefined && mode !== "host" && mode !== "namespace") { console.error(`--mode ${mode}: host or namespace\n${USAGE}`); process.exit(2); }
  return {
    port: Number(values.port ?? 3320), aiPort: Number(values["ai-port"] ?? 8807), root: resolve(values.root ?? join("runs", "arc")),
    ...(mode ? { mode } : {}),
  };
}
