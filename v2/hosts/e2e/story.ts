import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FakeOptions } from "../../ai/llm/fake-openrouter.ts";
import * as verbs from "../../client/headless.ts";
import type { SceneRows } from "../../client/scene/rows.ts";
import { gmFromRow, type GmRow } from "../../shared/gm/state.ts";
import { idempotencyKey, type Step } from "../../shared/protocol/keys.ts";
import { onTop } from "../dev/fake.ts";
import { camel } from "../dev/gm-status.ts";
import type { Stack } from "../dev/stack.ts";
import type { Game } from "./creation.ts";
import { callLog, check, doneTurn, modelCalls, nextTurn, ok, restartAi, step, until, type Player } from "./kit.ts";

/**
 * The e2e's steps for the whole story (story-design §5, the integrator's): one game from the yard to
 * The End on the fake model, a lead and a spectator. §1.1's recipe finds each scene at the first of
 * its endings the decider offers (the line that reaches it, then its wind-down), but the Rat, which
 * the dev stack's owner ends with end_scene through the headless client's end, as /end does. Each
 * scene's end writes its chapter and the endings' story rows and crosses the boundary on the AI
 * service (the hand-off, the verdict, the fronts and presence, under the ended scene's last turn's
 * key); the next scene waits until the lead walks to it, the spectator's seat following; the Heron's
 * fight is the stand-in, picked up by its aftermath; the King's morning is a summons, opened in the
 * boundary's own commit; and its ending is The End.
 */

/** Step 20 left $10 in today's ledger, so the AI service keeps its ceiling raised from here on. */
const RAISED = { KM_AI_DAILY_USD: "100" };
const WREN = { campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "wizard" };
/** §1.1's recipe: each scene's ending the first of these it offers, the player's own doing. */
const ENDINGS = ["open-case", "hobb-talks", "fight", "caught-in-the-act", "justice"];

/** What a step's headless verb printed, and its progress (dropped). */
interface Printed { text: string[]; out: verbs.Out }
function printed(): Printed {
  const text: string[] = [];
  return { text, out: { print: t => text.push(t), progress: () => {} } };
}

/**
 * 31–34. The whole story. `lead` is a client with the dev stack's owner (it makes end_scene, as
 * /end does), and `b` watches its game. Each check reads the rows the clients hold or the owner's
 * SQL, and the AI service's call log under the step's key.
 */
export async function theWholeStory(stack: Stack, root: string, lead: Player, b: Player, fake: FakeOptions): Promise<void> {
  step("31. A scene's end crosses the boundary: the yard to the Drowned Rat, waiting");
  // The recipe on fake.json's quiet answers, every call at once (no streaming: this step isn't about it).
  await restartAi(stack, onTop(fake, { choices: { ending: ENDINGS, own_exit: "theirs" }, streamMs: 0, byNameDelayMs: { notes: 0 }, suggestDelayMs: 0 }), RAISED);
  check(`${lead.name}'s new_game (${WREN.name}, ${WREN.build}) is made`, (await lead.conn.newGame(WREN)) === undefined);
  const opened = await until(lead, "the yard to go live", 60_000, r => r.scene.status === "live" && r);
  await doneTurn(lead, 0);
  const game: Game = { id: opened.game.id, uid: String((await stack.sql(`SELECT uid FROM game WHERE id = ${opened.game.id}`))[0]!.uid), scene: opened.scene.id };
  check(`B's join_game(${game.id}) is made`, (await b.conn.joinGame(game.id)) === undefined);
  await until(b, "B to see the yard", 10_000, r => r.game.id === game.id && r.scene.status === "live");

  const yard = await twoLines(lead, "Sergeant, that's a cord mark, not a rope. Write him down as murdered, persons unknown.", "Let's go.", "Murder by persons unknown");
  const rat = await waitingLead(lead, "drowned-rat", "The Drowned Rat");
  check(`the game's time is the Rat's: ${String(rat.game.time)}`, rat.game.time === "evening");
  const [chapter] = await stack.sql(`SELECT * FROM chapter WHERE scene_id = ${game.scene}`);
  const summary = String(chapter?.summary ?? "");
  check(`the yard's chapter: ${String(chapter?.exit_key)}, its hand-off "${summary.split("\n")[0]}" and the fake's words after it, ${Number(chapter?.calls)} calls`,
    chapter?.exit_key === "open-case" && summary.startsWith('Previous scene, "The Hanged Clerk", ended: Murder by persons unknown (hanged-clerk: open-case).') && summary.includes("Kell has it all in her notebook") && Number(chapter?.calls) >= 3);
  const boundary = keyOf(game, yard, "boundary");
  const asked = ["handoff", "boundary", "fronts"].map(op => `${op} ${modelCalls(root, game.uid, op, boundary)}`);
  check(`the boundary asked the hand-off, the verdict and the fronts once each under ${boundary.split(":").slice(1).join(":")}: ${asked.join(", ")}`, asked.every(a => a.endsWith(" 1")));
  const story = rat.story!;
  check(`the ending's story rows: quest ${story.quests.map(q => `${q.key} ${q.status}`).join()}, flag ${story.flags.map(f => `${f.name}=${f.value}`).join()}, ${story.followers.map(f => f.name).join()} follows, ${story.journal.length} journal line`,
    story.quests.some(q => q.key === "hanged-clerk" && q.status === "active") && story.flags.some(f => f.name === "prout_death" && f.value === "murder, unnamed")
      && story.followers.some(f => f.castKey === "kell") && story.journal.some(j => j.text === "Prout was murdered. The watch has it down as persons unknown."));
  const docs = join(root, "ai", "games", game.uid, "docs");
  const kell = join(docs, "Cast", "Sergeant Agnes Kell", "memories", "index.md");
  check("the game's docs: the played scene in the story's index, and Kell's memory of how it ended",
    existsSync(join(docs, "story", "scenes", "hanged-clerk.md")) && existsSync(kell) && readFileSync(kell, "utf8").includes("[The Hanged Clerk: how it ended]"));
  await until(b, "B to see the Rat as the lead", 10_000, r => r.story?.game.leadScene === "drowned-rat" && !r.story.game.onward);
  ok("B sees the story moved on, the yard still on screen");

  step("32. On to the lead: the Rat opens where the story is, Kell and the spectator with the player");
  check("B's walk is refused: not_controller", (await b.conn.act("walk", { to: undefined, toward: "lead" }))?.code === "not_controller");
  const went = printed();
  check("the lead's go (walk toward the lead) opens the Rat", await verbs.go(lead.conn, went.out) === 0 && went.text.join("\n").includes("[The Drowned Rat, evening]"));
  const inRat = await until(lead, "the Rat to be live", 30_000, r => r.scene.title === "The Drowned Rat" && r.scene.status === "live" && r);
  const ratGame: Game = { ...game, scene: inRat.scene.id };
  const openingInput = modelInput(root, ratGame, "gm.opening", keyOf(ratGame, 0, "open"));
  check("its opening was told the story so far: \"What happened just before this scene\", the yard's hand-off", openingInput.includes("What happened just before this scene") && openingInput.includes('Previous scene, "The Hanged Clerk", ended'));
  await until(b, "B's seat to follow into the Rat", 10_000, r => r.scene.id === inRat.scene.id && r.scene.status === "live");
  ok("B's seat followed the lead into the Rat");
  const ratPlace = (await stack.sql(`SELECT * FROM place WHERE game_id = ${game.id}`)).find(p => p.key === "drowned-rat");
  const entities = (await stack.sql(`SELECT * FROM entity WHERE game_id = ${game.id}`)).filter(e => e.key === "kell" || String(e.key).startsWith("pc:"));
  check(`Kell and the player's character are one entity each, in the Rat's place now: ${entities.map(e => `${String(e.key)} in place ${String(e.place_id)}`).join(", ")}`,
    entities.length === 2 && entities.every(e => String(e.place_id) === String(ratPlace?.id)));

  step("33. The Rat ended as the owner (end_scene), on to the Heron; its fight, and the stand-in");
  const ended = printed();
  check("the lead's end --exit hobb-talks (end_scene as the dev stack's owner) prints the way on", await verbs.end(lead.conn, "hobb-talks", ended.out) === 0);
  const between = ended.text.join("\n");
  check("MODE: between, with Kell's words for the Heron", between.includes("MODE: between") && between.includes("“The Heron Warehouse, then.”"));
  const heron = await waitingLead(lead, "heron-warehouse", "The Heron Warehouse");
  check(`the game's time is the Heron's: ${String(heron.game.time)}; wharf-night, an interlude, was never a candidate`, heron.game.time === "night" && !heron.story!.scenes.some(s => s.sceneKey === "wharf-night"));
  const toHeron = printed();
  check("the lead's go opens the Heron", await verbs.go(lead.conn, toHeron.out) === 0);
  const atHeron = await until(lead, "the Heron to be live", 30_000, r => r.scene.title === "The Heron Warehouse" && r.scene.status === "live" && r);
  const heronGame: Game = { ...game, scene: atHeron.scene.id };
  const n = nextTurn(lead);
  check("the lead goes for Sallow", (await lead.conn.say("(I go for Sallow with my blade)")) === undefined);
  const fighting = await until(lead, "the Heron to be fighting", 60_000, r => r.scene.status === "fighting" && r);
  check(`"${lastEntry(fighting).text}" ends it at once, and no chapter yet`, lastEntry(fighting).text === "Scene ends: Roll for initiative" && !(await stack.sql(`SELECT * FROM chapter WHERE scene_id = ${heronGame.scene}`)).length);
  check("a line now is refused: not_now", (await lead.conn.say("Wait!"))?.code === "not_now");
  await until(b, "B to see the fight", 10_000, r => r.scene.status === "fighting");
  ok("B sees the fight");
  check("the lead fights it out (fight_it_out)", (await lead.conn.act("fightItOut", {})) === undefined);
  const after = await until(lead, "the Heron to pick up after the fight", 60_000, r => r.scene.status === "live" && r.turns.some(t => t.n === n + 1 && t.phase === "done") && r);
  const lines = after.transcript.filter(t => t.turn === n + 1).sort((x, y) => x.seq - y.seq).map(t => t.text);
  check(`turn ${n + 1}: the stand-in's line, how the fight went, then the GM's aftermath`, lines[0]!.startsWith("Steel, dust and lantern light") && lines[1] === "The fight: After a short, ugly fight the Crakes went down and Sallow surrendered, very politely." && lines.length >= 3);
  check("the aftermath was asked as one (gm.aftermath, under the turn's open key)", modelCalls(root, game.uid, "gm.aftermath", keyOf(heronGame, n + 1, "open")) === 1);
  const gm = gmFromRow(camel((await stack.sql(`SELECT * FROM gm_state WHERE scene_id = ${heronGame.scene}`))[0]) as GmRow);
  check(`the fight is on the record: fought ${gm.fought.join()}, "${gm.established.find(e => e.startsWith("The fight is over"))?.slice(0, 40)}…", the notebook's line`,
    gm.fought.includes("fight") && gm.established.some(e => e.startsWith("The fight is over: ")) && after.story!.journal.some(j => j.text === "The fight wasn't played: it's told as won."));

  step("34. A summons, then The End");
  await twoLines(lead, "Sergeant, arrest him: he was caught with the King's grain.", "To the palace, then.", "Caught in the act", true);
  const king = await until(lead, "the King's morning to open by itself", 60_000, r => r.scene.title === "The King's Morning" && r.scene.status === "live" && r);
  check(`a summons: the King's morning opened in the boundary's commit with no walk (nothing waits), at ${String(king.game.time)}`, king.game.time === "next-morning" && !king.story!.scenes.some(s => s.status === "waiting"));
  await doneTurn(lead, 0);
  await until(b, "B's seat to be summoned too", 10_000, r => r.scene.id === king.scene.id);
  ok("B's seat went to the King's morning too");
  await twoLines(lead, "Majesty, Sallow's initials are on every lost wagon.", "Thank you, Majesty.", "Done right by");
  const end = await until(lead, "The End", 60_000, r => r.story?.game.status === "ended" && r);
  const chapters = await stack.sql(`SELECT * FROM chapter WHERE game_id = ${game.id}`);
  check(`The End: the game is over with ${chapters.length} chapters (${chapters.sort((x, y) => Number(x.seq) - Number(y.seq)).map(c => c.exit_key).join(", ")}), no lead`,
    chapters.length === 4 && end.story!.game.leadScene === undefined && end.story!.game.onward === undefined);
  check("walk and carry_on are refused: story_over", (await lead.conn.act("walk", { to: undefined, toward: "lead" }))?.code === "story_over" && (await lead.conn.act("carryOn", {}))?.code === "story_over");
  const seen = printed();
  verbs.observe(lead.conn, seen.out);
  const text = seen.text.join("\n");
  check("observe says MODE: end, THE END, and how it went", text.includes("MODE: end") && text.includes("THE END") && text.includes("How it went:") && text.includes("4. The King's Morning: Done right by"));
  await until(b, "B to see The End", 10_000, r => r.story?.game.status === "ended");
  ok("B sees The End too");
}

/**
 * Two lines that end the scene: the first reaches the recipe's ending (the scene closing), the
 * second is its wind-down; the scene ends on `ending`. Its last turn's n (the boundary's key).
 * A summons moves the seat on as the scene ends: `summons` reads the scene's end from the SQL then.
 */
async function twoLines(p: Player, first: string, second: string, ending: string, summons = false): Promise<number> {
  const at = p.conn.rows()!.scene.id;
  check(`${p.name} says "${first}"`, (await p.conn.say(first)) === undefined);
  await until(p, "the scene to close on the ending", 60_000, r => r.scene.id === at && r.scene.status === "closing");
  const n = nextTurn(p);
  check(`${p.name} says the wind-down, "${second}"`, (await p.conn.say(second)) === undefined);
  if (summons) {
    await until(p, "the scene to end and the story to move on", 60_000, r => r.scene.id !== at || (r.scene.status === "ended" && r.story?.game.onward === undefined));
    ok(`the scene ended on ${ending}`);
    return n;
  }
  const rows = await until(p, "the scene to end", 60_000, r => r.scene.id === at && r.scene.status === "ended" && r);
  check(`"${lastEntry(rows).text}" closes it`, lastEntry(rows).text === `Scene ends: ${ending}`);
  return n;
}

/** The story moved on: the boundary in, the next scene waiting as the lead. */
async function waitingLead(p: Player, key: string, title: string): Promise<SceneRows> {
  const rows = await until(p, `${title} to wait as the lead`, 60_000, r => r.story?.game.leadScene === key && r.story.game.onward === undefined && r);
  const waiting = rows.story!.scenes.find(s => s.sceneKey === key);
  check(`${title} waits (${waiting?.status}), the lead's words "${rows.story!.game.leadText ?? "(the fake rewrote none)"}"`, waiting?.status === "waiting");
  return rows;
}

function lastEntry(rows: SceneRows): SceneRows["transcript"][number] {
  return [...rows.transcript].sort((x, y) => x.seq - y.seq).at(-1)!;
}

function keyOf(game: Game, n: number, step: Step): string {
  return idempotencyKey(game.uid, game.scene, n, step);
}

/** What the model was given for the last call for `operation` under a key: its input's messages, as one text. */
function modelInput(root: string, game: Game, operation: string, key: string): string {
  const call = callLog(root, game.uid).filter(c => !c.started && c.operation === operation && c.key === key).at(-1) as { request?: { input?: Array<{ content: string }> } } | undefined;
  return call?.request?.input?.map(m => m.content).join("\n") ?? "";
}
