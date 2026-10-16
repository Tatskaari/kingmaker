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
import { callLog, check, doneTurn, Failed, nextTurn, note, ok, restartAi, seconds, step, turnOf, until, type Player } from "./kit.ts";

/**
 * The e2e's steps for the full GM (full-gm-design §4.4), after V1's: a memory kept and brought back,
 * the co-GM steering the scene, a risky act the GM rules on (and the plain check rolled when the
 * ruling takes too long), and walking out of the place. On the fake model with fake.json's quiet
 * answers for the full GM (the attention filter flags only what was witnessed, the memories agent
 * saves one memory for Kell, the co-GM finds the scene on track, the ruling is a contest with Cob),
 * each step's recipe on top of them (onTop), so its own choices keep the quiet ones.
 */

/** Step 20 left $10 in today's ledger, so the AI service keeps its ceiling raised from here on. */
export const RAISED = { KM_AI_DAILY_USD: "100" };
const WREN = { campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "wizard" };

/**
 * The co-GM's answer for step 23: on track (so it runs only every third turn), with a note for the
 * GM, a whisper for Moll, a canon line, and a way from the yard to the doubt beat, tried by the
 * player with no check; the decider takes that way (improv-3-0) once it's on offer, and the quiet
 * choice until then.
 */
const STEERING: FakeOptions = {
  byName: {
    co_gm_notes: {
      assessment: "The investigator is going round the edges of the yard; Moll's story is the way in.",
      status: "on_track",
      notes: "Let Kell keep pointing the investigator at the girl on the wall.",
      whispers: [{ to: "moll", note: "She wants to be asked about the jump, so she can tell it bigger." }],
      relocations: [], no_but: [],
      canon: ["Cob keeps his left boot laced tighter than his right."],
      move_to: null, move_to_because: null, add_beat: null,
      add_transitions: [{ beat: "yard", when: "The player presses Moll on what she could really have seen from the wall.", on: "attempt", to: "doubt", check: null, why: "A way into doubt through Moll's story." }],
    },
  },
  choices: { attempt: "improv-3-0" },
};

/** 22. A memory, kept and brought back: the review after a line writes Kell's note, and the next line's reply has it. */
export async function aMemory(stack: Stack, root: string, a: Player, fake: FakeOptions): Promise<Game> {
  step("22. A memory, kept and brought back");
  await restartAi(stack, onTop(fake, STEERING), RAISED);
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

  const m = nextTurn(a);
  check("A says the next line", (await a.conn.say("Sergeant, who found him?")) === undefined);
  await doneTurn(a, m);
  const told = modelInput(root, game, "gm.reply", keyOf(game, m, "reply"));
  check("the next line's gm.reply input lists Kell's memory", /remembers \(index[^\n]*\n(?:- .*\n)*- \[What the investigator did\]/.test(told));
  return game;
}

/**
 * 23. The co-GM steers (STEERING): its review after turn 3 (the backstop) waits in a co_gm_result
 * row; the next line's start merges it, and its decide takes the new way; the whisper steers one
 * reply and lapses, the note two.
 */
export async function theCoGmSteers(stack: Stack, root: string, a: Player, game: Game): Promise<void> {
  step("23. The co-GM steers");
  const n = nextTurn(a);
  check(`turn ${n} is the scene's third: the co-GM's backstop`, n === 3);
  check("A says a line", (await a.conn.say("Moll, where were you when they found him?")) === undefined);
  await doneTurn(a, n);
  const row = await eventually(`the co-GM's review of turn ${n}`, 20_000, async () => (await reviewRows(stack, game)).find(r => Number(r.turn) === n));
  const kept = JSON.parse(String(row.review)) as { status: string; patches: unknown[]; whispers: unknown[] };
  check(`a co_gm_result row for turn ${n}: ${kept.status}, ${kept.patches.length} patch, ${kept.whispers.length} whisper, not merged`, kept.patches.length === 1 && kept.whispers.length === 1 && row.merged_turn === null);
  const waiting = await gmOf(stack, game);
  check("gm_state is as it was: no notes, whispers, canon or patches yet", !waiting.notes && !waiting.whispers.length && !waiting.canon.length && !waiting.patches.length);

  const m = n + 1;
  check("A says the next line", (await a.conn.say("Moll, you never saw him jump from up there. What did you see?")) === undefined);
  await doneTurn(a, m);
  const merged = await gmOf(stack, game);
  check(`turn ${m}'s start merged it: notes (turn ${merged.notesTurn}), the whisper for ${merged.whispers.map(w => w.to).join()}, the canon, the patch ${merged.patches.map(p => p.transition?.transition.id).join()}`,
    merged.notesTurn === n && !!merged.notes && merged.whispers.length === 1 && merged.whispers[0]!.to === "moll" && merged.canon.length === 1 && merged.patches.length === 1 && merged.lastRepairTurn === n);
  const step4 = merged.path.find(p => p.turn === m);
  check(`its decide took the co-GM's way: ${step4 ? `${step4.from} -> ${step4.to} via ${step4.via}` : "no step"}; the beat ${merged.beat}`, step4?.via === "improv-3-0" && merged.beat === "doubt");
  const after = await reviewRows(stack, game);
  check(`the row is marked merged at turn ${m}`, Number(after.find(r => Number(r.turn) === n)?.merged_turn) === m);
  const told4 = modelInput(root, game, "gm.reply", keyOf(game, m, "reply"));
  check("turn 4's gm.reply input has the co-GM's notes and Moll's whisper", told4.includes("## Notes from your co-GM") && told4.includes("On Moll's mind: She wants to be asked about the jump"));

  const five = m + 1;
  check("A says another line", (await a.conn.say("Kell, write that down.")) === undefined);
  await doneTurn(a, five);
  const told5 = modelInput(root, game, "gm.reply", keyOf(game, five, "reply"));
  const lapsed = await gmOf(stack, game);
  check("at turn 5 the whisper has lapsed, and the note still steers", !lapsed.whispers.length && !!lapsed.notes && told5.includes("## Notes from your co-GM") && !told5.includes("On Moll's mind"));

  const six = five + 1;
  check("A says another line", (await a.conn.say("Cob, did you see anyone go up to the loft?")) === undefined);
  await doneTurn(a, six);
  const told6 = modelInput(root, game, "gm.reply", keyOf(game, six, "reply"));
  const gone = await gmOf(stack, game);
  check("at turn 6 the note has lapsed too", !gone.notes && gone.notesTurn === null && !told6.includes("## Notes from your co-GM"));
}

/**
 * 24. A considered act (roll_call: new): both clients see the turn considering, then the ruling's
 * dice line before the reply, which is told the ruling stands. Then the ruling stalls past a 2 s
 * deadline (KM_CONSIDER_DEADLINE_MS): the plain check is rolled instead, and no ruling is kept.
 */
export async function aConsideredAct(stack: Stack, root: string, a: Player, b: Player, fake: FakeOptions): Promise<Game> {
  step("24. A risky act the GM rules on");
  // Every line wants a roll no route covers, and none is the same push again (a ruling that failed is a try the decider could match).
  const considered = onTop(fake, { choices: { roll_call: "new", same_again: "new" } });
  await restartAi(stack, considered, RAISED);
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
    check(`${p.name} saw turn ${n} go ${phases.join(", ")}`, phases.slice(0, 3).join() === "deciding,considering,replying");
  }
  const lines = linesOf(rows, n);
  check(`the dice line came before the reply: "${lines.find(l => l.kind === "roll")?.text}"`, lines.map(l => l.kind).join() === "player,roll,narration" && /^Sleight Of Hand check .* vs DC 12: (success|failure)/.test(lines[1]!.text));
  const ruled = await gmOf(stack, game);
  const ruling = ruled.rulings[0];
  check(`gm_state.rulings has it: ${ruling ? `${ruling.turn}: ${ruling.act} -> ${ruling.skill} DC ${ruling.dc}, ${ruling.went}` : "none"}`, ruled.rulings.length === 1 && ruling!.turn === n && ruling!.kind === "roll" && ruling!.dc === 12);
  check("the reply was told the ruling stands", modelInput(root, game, "gm.reply", keyOf(game, n, "reply")).includes("Decided, and it stands"));

  await restartAi(stack, onTop(considered, { stall: ["ruling"] }), { ...RAISED, KM_CONSIDER_DEADLINE_MS: "2000" });
  ok("the AI service restarted with the ruling stalled and KM_CONSIDER_DEADLINE_MS=2000");
  const m = n + 1;
  const at = a.events.length;
  check("A says another risky line", (await a.conn.say("(I try the other boot while he looks at the gate)")) === undefined);
  const plain = await doneTurn(a, m);
  const considering = a.events.slice(at).find(e => e.table === "turn" && e.row.n === m && e.row.phase === "considering")?.at;
  const rolled = a.events.slice(at).find(e => e.table === "transcript" && e.op === "insert" && e.row.turn === m && e.row.kind === "roll")?.at;
  const took = considering !== undefined && rolled !== undefined ? rolled - considering : Number.NaN;
  // The deadline is 2 s here and 12 s by default: the bound shows it was this one, with room for a busy machine.
  check(`the plain check was rolled ${seconds(took)} after the turn began considering: "${linesOf(plain, m).find(l => l.kind === "roll")?.text}"`, took < 8_000 && linesOf(plain, m).map(l => l.kind).join() === "player,roll,narration");
  const after = await gmOf(stack, game);
  check(`no ruling kept: ${after.rulings.length} as before; the path's step ${after.path.find(p => p.turn === m)?.via}`, after.rulings.length === 1 && after.path.find(p => p.turn === m)?.via === "freeform");
  return game;
}

/** 25. Walking out (choices.left: gone): the scene ends on an ending of the player's own. */
export async function walkingOut(stack: Stack, a: Player, b: Player, game: Game, fake: FakeOptions): Promise<void> {
  step("25. Walking out of the place");
  await restartAi(stack, onTop(fake, { choices: { left: "gone" } }), RAISED);
  const n = nextTurn(a);
  check("A walks out", (await a.conn.say("(I nod to the sergeant and walk out of the yard, back towards the palace)")) === undefined);
  const rows = await until(a, "the scene to end", 60_000, r => r.scene.status === "ended" && r);
  await doneTurn(a, n);
  const last = [...rows.transcript].sort((x, y) => x.seq - y.seq).at(-1)!;
  check(`"${last.text}" closes the transcript`, last.kind === "system" && last.text === "Scene ends: An ending of their own");
  const gm = await gmOf(stack, game);
  const out = gm.path.at(-1);
  check(`the path's last step: ${out ? `${out.from} -> ${out.to} via ${out.via}` : "none"}`, out?.via === "left-the-place" && out.to === "own-ending" && gm.ended?.exitId === "own-ending");
  await until(b, "B to see the scene end", 10_000, r => r.scene.status === "ended");
  ok("B saw it end too");
  const queued = (await stack.sql("SELECT * FROM job")).filter(j => String(j.scene_id) === String(game.scene) && String(j.move) === "repair");
  check("no co-GM is asked after the scene's end", queued.length === 0 && !(await reviewRows(stack, game)).some(r => Number(r.turn) === n));
}

// ---------------------------------------------------------------------------------------------
// What the steps share.

/** A's new game with a ready-made wizard: its opening done. */
export async function aNewGame(stack: Stack, a: Player): Promise<Game> {
  const before = a.conn.rows()?.game.id;
  check(`A's new_game (${WREN.name}, ${WREN.build}) is made`, (await a.conn.newGame(WREN)) === undefined);
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

async function reviewRows(stack: Stack, game: Game): Promise<Array<Record<string, unknown>>> {
  return stack.sql(`SELECT * FROM co_gm_result WHERE scene_id = ${game.scene}`);
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
