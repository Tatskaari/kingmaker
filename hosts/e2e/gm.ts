import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FakeOptions } from "../../ai/llm/fake-openrouter.ts";
import type { SceneRows } from "../../client/scene/rows.ts";
import { gmFromRow, type GmRow, type GmState } from "../../shared/gm/state.ts";
import { idempotencyKey, type Step } from "../../shared/protocol/keys.ts";
import { onTop } from "../dev/fake.ts";
import { camel, reviewLines } from "../dev/gm-status.ts";
import type { Stack } from "../dev/stack.ts";
import type { Game } from "./creation.ts";
import { callLog, check, doneTurn, Failed, mapUntil, nextTurn, note, ok, restartAi, seconds, step, turnOf, until, type Player } from "./kit.ts";

/**
 * The e2e's steps for the GM (full-gm-design §4.4, two-part-design.md), after V1's: a memory kept, the
 * co-GM steering the scene (its roles and its moves), and a risky act the mouthpiece calls a check on.
 * On the fake model with fake.json's quiet answers for the full GM (the attention filter flags only
 * what was witnessed, the memories agent saves one memory for Kell), the co-GM kept still unless a
 * step's recipe moves it, each step's recipe on top of them (onTop), so its own choices keep the quiet
 * ones. (Until M2: the old co-GM's review merged at a turn's start, a ruling before the reply and the
 * plain check when it was too slow, and walking out of the place on an ending of the player's own,
 * step 25: the two-part GM has none of them. The memory brought back went with them, since the
 * two-part GM reads no memories: a talk does, step 39.)
 */

/** Step 20 left $10 in today's ledger, so the AI service keeps its ceiling raised from here on. */
export const RAISED = { KM_AI_DAILY_USD: "100" };
const WREN = { campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "wizard" };

/** The role the co-GM gives Moll every turn in step 23. */
const MOLL = { status: "On the yard wall, heels drumming", mental_state: "Itching to be asked", conversation_role: "She wants to be asked about the jump, so she can tell it bigger." };

/**
 * The co-GM's recipe for step 23: Moll's role every turn, and its walk to murder by persons unknown,
 * a route a line (the discovery the ending needs first).
 */
const STEERING: FakeOptions = { coGm: { endings: ["murder-unknown"], roles: { moll: MOLL } } };

/** 22. A memory, kept: the review after a line writes Kell's note into the game's docs. */
export async function aMemory(stack: Stack, root: string, a: Player, fake: FakeOptions): Promise<Game> {
  step("22. A memory, kept");
  await restartAi(stack, fake, RAISED);
  const game = await aNewGame(stack, a);
  const n = nextTurn(a);
  check("A says a line", (await a.conn.say("(I crouch and press a silver crown into the boy's hand) Get yourself something hot, lad. No questions.")) === undefined);
  await doneTurn(a, n);

  const review = await eventually(`turn ${n}'s memory review`, 20_000, () => reviewsOf(root, game).find(r => r.turn === n));
  const changes = review.reviews.flatMap(r => r.changes ?? []);
  check(`the memory review of turn ${n} flagged ${review.flags.join(", ") || "nothing"}, and saved: ${changes.join("; ")}`, review.flags.includes("witnessed") && changes.some(c => /kell/i.test(c)));
  const dir = join(root, "ai", "games", game.uid, "docs", "Cast", "Sergeant Agnes Kell", "memories");
  const notes = existsSync(dir) ? readdirSync(dir).filter(f => /^[0-9a-f]{8}\.md$/.test(f)) : [];
  const index = existsSync(join(dir, "index.md")) ? readFileSync(join(dir, "index.md"), "utf8") : "";
  check(`Kell's note is in the game's docs (${notes.join(", ") || "none"}), linked from her index`, notes.length === 1 && index.includes(`(${notes[0]})`) && index.includes("What the investigator did"));
  check("the note is in her words", readFileSync(join(dir, notes[0]!), "utf8").includes("I watched what the King’s investigator did"));
  return game;
}

/**
 * 23. The co-GM steers (STEERING): after each reply, beside the stage manager, it gives Moll her role,
 * which gm_state keeps and its note for the next turn carries, so the next reply reads it before the
 * player's line; and it walks the scene on a route a line, each move taken again on the rows (the
 * path, what's reached): the dead-cart's arrival moves the stage and brings Tull on with his stage
 * note as his role, and the next reply is told to show it, once.
 */
export async function theCoGmSteers(stack: Stack, root: string, a: Player, game: Game, fake: FakeOptions): Promise<void> {
  step("23. The co-GM steers");
  await restartAi(stack, onTop(fake, STEERING), RAISED);
  const n = nextTurn(a);
  check("A says a line", (await a.conn.say("Moll, where were you when they found him?")) === undefined);
  await doneTurn(a, n);
  const first = await gmOf(stack, game);
  check(`Moll's role is the co-GM's: "${first.twoPart.roles.moll?.conversation_role}"`, first.twoPart.roles.moll?.conversation_role === MOLL.conversation_role && first.twoPart.roles.moll.status === MOLL.status);
  check(`its move is on the rows: ${first.path.map(p => `${p.turn}: ${p.from} -> ${p.to} via ${p.via}`).join("; ")}; reached ${first.reached.join(", ")}`, first.path.at(-1)?.via === "find-hobb" && first.path.at(-1)?.turn === n && first.reached.includes("hobb"));

  const m = n + 1;
  check("A says the next line", (await a.conn.say("Moll, you never saw him jump from up there. What did you see?")) === undefined);
  await doneTurn(a, m);
  const told = modelInput(root, game, "two-part.reply", keyOf(game, m, "reply"));
  check(`turn ${m}'s reply read the co-GM's note for it, Moll's role in it`, told.includes(`Co-GM note, before turn ${m}`) && told.includes(`Character role for Moll:\nStatus: ${MOLL.status}\nMental state: ${MOLL.mental_state}\nConversation role: ${MOLL.conversation_role}`));

  const cart = m + 1;
  check("A says another line", (await a.conn.say("Is that the dead-cart I hear in the lane?")) === undefined);
  await doneTurn(a, cart);
  const moved = await gmOf(stack, game);
  check(`the stage moved to ${moved.beat} (${moved.twoPart.moved ? "to show" : "nothing to show"}), Tull brought on: "${moved.twoPart.roles.tull?.conversation_role.slice(0, 40)}…"`,
    moved.path.at(-1)?.via === "cart-comes" && moved.beat === "cart-arrives" && moved.twoPart.moved === "cart-arrives" && /^Helmet off to the dead/.test(moved.twoPart.roles.tull?.conversation_role ?? ""));
  check("Tull is in the world, and on stage", (await stack.sql(`SELECT * FROM entity WHERE game_id = ${game.id}`)).some(e => e.key === "tull") && a.conn.view()!.present.some(p => p.key === "tull"));

  const after = cart + 1;
  check("A says another line", (await a.conn.say("Corporal, a word before you take him.")) === undefined);
  await doneTurn(a, after);
  const shown = modelInput(root, game, "two-part.reply", keyOf(game, after, "reply"));
  const done = await gmOf(stack, game);
  check("the reply after the move was told to show it, Tull seen arriving; shown, it's done with", /The scene has just moved on to "[^"]+": [\s\S]*arrives now, seen arriving/.test(shown) && done.twoPart.moved === undefined);
}

/**
 * 24. A risky act the GM calls a check on (the mouthpiece's recipe: Sleight of Hand, DC 12, on every
 * reply but an opening or a closing): both clients see the turn go replying, settling, done (no
 * deciding or considering), and its rows: the narration setting it up, the dice line (rolled by the
 * simulation from the game's dice, through the rules engine on the player's sheet) with how far it
 * made or missed it, and the outcome that came up; the co-GM is told how it went. (Until M2 the old
 * pipeline ruled on the act before the reply, and rolled a plain check when the ruling was too slow.)
 */
export async function aRiskyCheck(stack: Stack, root: string, a: Player, b: Player, fake: FakeOptions): Promise<Game> {
  step("24. A risky act the GM calls a check on");
  await restartAi(stack, onTop(fake, { mouthpiece: { check: { skill: "sleight_of_hand", dc: 12 } } }), RAISED);
  const game = await aNewGame(stack, a);
  check("B's join_game is made", (await b.conn.joinGame(game.id)) === undefined);
  await until(b, "B to see the scene", 10_000, r => r.game.id === game.id && r.scene.status === "live");

  const n = nextTurn(a);
  const from = { a: a.events.length, b: b.events.length };
  check("A says a risky line", (await a.conn.say("(I try to lift the folded paper out of the boy's boot while he watches the sergeant)")) === undefined);
  const rows = await doneTurn(a, n);
  await until(b, `B to see turn ${n} done`, 10_000, r => turnOf(r, n)?.phase === "done");
  for (const [p, i] of [[a, from.a], [b, from.b]] as const) {
    const phases = phasesOf(p, i, game, n);
    check(`${p.name} saw turn ${n} go ${phases.join(", ")}`, phases.slice(-3).join() === "replying,settling,done" && !phases.includes("deciding") && !phases.includes("considering"));
  }
  const lines = linesOf(rows, n);
  const dice = lines.find(l => l.kind === "roll")?.text ?? "";
  check(`the narration, the dice line ("${dice}"), then the outcome that came up`, lines.map(l => l.kind).join() === "player,narration,roll,narration" && /^Sleight Of Hand .*DC 12.*\((badly|narrowly|only just|cleanly|with room to spare|natural 20!|natural 1!)\)\.$/.test(dice));
  const told = modelInput(root, game, "two-part.co-gm", keyOf(game, n, "settle"));
  check("the co-GM was told how it went", told.includes("# This turn's check\nThe GM called Sleight Of Hand DC 12, and the roll came to "));
  return game;
}

// ---------------------------------------------------------------------------------------------
// What the steps share.

/**
 * A's new game with a ready-made wizard: it starts on the map in the granary lane (map-design §3.3),
 * so A walks to the lead, into the yard, which opens the hanged clerk; its opening done.
 */
export async function aNewGame(stack: Stack, a: Player): Promise<Game> {
  const before = a.conn.rows()?.game.id;
  const was = a.conn.explore()?.game;
  check(`A's new_game (${WREN.name}, ${WREN.build}) is made`, (await a.conn.newGame(WREN)) === undefined);
  await mapUntil(a, "A's new game on the map, in the lane", 10_000, v => v.game !== was && !v.ex.scene && v);
  check("A walks from the lane to the lead (walk toward lead)", (await a.conn.walk({ toward: "lead" })) === undefined);
  const rows = await until(a, "the new game's scene to go live", 60_000, r => r.game.id !== before && r.scene.status === "live" && r);
  await doneTurn(a, 0);
  const [game] = await stack.sql(`SELECT uid FROM game WHERE id = ${rows.game.id}`);
  ok(`game ${rows.game.id}, its scene live`);
  return { id: rows.game.id, uid: String(game!.uid), scene: rows.scene.id };
}

/** Polls `test` (every 100 ms) until it finds something; a Failed after `ms`. */
export async function eventually<T>(what: string, ms: number, test: () => T | undefined | Promise<T | undefined>): Promise<T> {
  const began = performance.now();
  for (;;) {
    const found = await test();
    if (found !== undefined) {
      note(`${what}: ${seconds(performance.now() - began)}`);
      return found;
    }
    if (performance.now() - began > ms) throw new Failed(`waited ${seconds(ms)} for ${what}`);
    await new Promise(r => setTimeout(r, 100));
  }
}

/** The scene's bookkeeping, as the module keeps it. */
export async function gmOf(stack: Stack, game: Game): Promise<GmState> {
  const [row] = await stack.sql(`SELECT * FROM gm_state WHERE scene_id = ${game.scene}`);
  return gmFromRow(camel(row) as GmRow);
}

/** The game's memory-reviews.jsonl, in the AI service's store. */
function reviewsOf(root: string, game: Game): Array<{ turn: number; flags: string[]; reviews: Array<{ kind: string; changes?: string[]; error?: string }> }> {
  return reviewLines(join(root, "ai", "games", game.uid, "memory-reviews.jsonl")) as ReturnType<typeof reviewsOf>;
}

/** The phases a player saw turn n of the game go through, from its events since `from`. */
export function phasesOf(p: Player, from: number, game: Game, n: number): string[] {
  const phases = p.events.slice(from).filter(e => e.table === "turn" && e.row.n === n && String(e.row.sceneId) === String(game.scene)).map(e => String(e.row.phase));
  return phases.filter((phase, i) => phase !== phases[i - 1]);
}

/** Turn n's entries, in order. */
export function linesOf(rows: SceneRows, n: number): SceneRows["transcript"] {
  return rows.transcript.filter(t => t.turn === n).sort((x, y) => x.seq - y.seq);
}

export function keyOf(game: Game, n: number, step: Step): string {
  return idempotencyKey(game.uid, game.scene, n, step);
}

/** What the model was given for the last call for `operation` under a key: its input's messages, as one text. */
function modelInput(root: string, game: Game, operation: string, key: string): string {
  const call = callLog(root, game.uid).filter(c => !c.started && c.operation === operation && c.key === key).at(-1) as { request?: { input?: Array<{ content: string }> } } | undefined;
  return call?.request?.input?.map(m => m.content).join("\n") ?? "";
}
