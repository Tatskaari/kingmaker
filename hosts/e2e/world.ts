import type { FakeOptions } from "../../ai/llm/fake-openrouter.ts";
import { actorsHere } from "../../shared/map/explore.ts";
import type { Tile2 } from "../../shared/map/types.ts";
import type { SceneWorld } from "../../shared/world/scene-world.ts";
import { onTop } from "../dev/fake.ts";
import type { Stack } from "../dev/stack.ts";
import type { Game } from "./creation.ts";
import { gmOf, keyOf, linesOf, phasesOf, RAISED } from "./gm.ts";
import { bigints, check, doneTurn, mapUntil, modelCalls, moduleLog, nextTurn, note, ok, pause, restartAi, step, turnOf, until, type Player } from "./kit.ts";

/**
 * The e2e's steps for the scene's world (world-bridge-design §3.4), after the GM's: a wizard's spell
 * from the lane at Kell, waiting in the yard (the map's act), resolved by the rules on the scene's
 * world before the GM says a word, the people who saw it reacting; a spell said in words in the scene,
 * read by the act step and resolved the same way; a fire the stage manager starts that burns on at
 * the next line's start; and the spectator's world, row for row the lead's. On the fake model with
 * fake.json's quiet answers (Kell intervenes, Cob flees, Moll cowers), each step's recipe on top.
 * (Until M2, the decider read a spell out of the player's words in the turn's one decision (26), a
 * blow the reply left hanging landed first next turn (27), and the AI service kept the reactions as
 * it died (29). M2's two-part GM had no decide, reactions or read after the reply; since "After the
 * migration: spells and blows said in a scene" a line that might be an act asks the act step, and a
 * violent act draws the reactions again (27 is the spell said in words), though none starts a fight,
 * so nothing is left hanging (29 stays empty, its number kept).)
 */

const WREN = { campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "wizard" };

/** The stage manager's answer for step 28: the yard gate alight. */
const LANTERN = { op: "ignite", what: "gate", to: "", how: "", feet: 0, name: "", kind: "", text: "", add: [], remove: [], quantity: 0 };

/** The place's tables, as the client watches them (net/connection.ts): the world's rows. */
const PLACE = new Set(["place", "entity", "position", "area", "material", "health", "stack", "surface", "creature", "player_character", "gear", "narrative", "world_log"]);

/** What the world's steps share: the wizard's game, its place, and where both players' events stood once B was watching it, quiet. */
export interface WorldGame { game: Game; place: bigint; from: { a: number; b: number } }

/**
 * 26. Before the GM speaks: from the lane, Magic Missile at Kell, waiting in the yard (the map's act,
 * town-design §3.4), opens the hanged clerk, B's seat with A's; once the opening's in, the act is
 * turn 1, resolved by the rules on the scene's world: its dice rows (the cast, the darts, the slots
 * left) reach both clients before the reply's first draft, the world rows have Kell hurt (her state,
 * as the rules set it), and the sheet's status has a 1st-level slot gone; and whoever saw it reacted
 * before the reply (Cob fled, gone from the place; Moll cowering), with no fight started.
 */
export async function beforeTheGmSpeaks(stack: Stack, a: Player, b: Player, fake: FakeOptions): Promise<WorldGame> {
  step("26. A spell from the lane resolved by the rules before the GM speaks");
  await restartAi(stack, fake, RAISED);
  const was = a.conn.explore()?.game;
  check(`A's new_game (${WREN.name}, ${WREN.build}) is made`, (await a.conn.newGame(WREN)) === undefined);
  const lane = await mapUntil(a, "A's new game on the map, in the lane", 10_000, v => v.game !== was && !v.ex.scene && v);
  check(`B's join_game(${lane.game}) is made`, (await b.conn.joinGame(BigInt(lane.game))) === undefined);
  await mapUntil(b, "B to see the map", 10_000, v => v.game === lane.game && v);
  const kell = actorsHere(lane.ex).find(x => x.ref === "kell");
  check(`Kell waits in the yard, at (${kell?.at.x},${kell?.at.y})`, !!kell);
  const from = { a: a.events.length, b: b.events.length };

  check(`Magic Missile at her (cast magic-missile at ${kell!.at.x},${kell!.at.y})`, (await a.conn.act("cast", { spell: "magic-missile", at: kell!.at as Tile2, self: undefined })) === undefined);
  const opened = await until(a, "the yard to open", 30_000, r => r.scene.title === "The Hanged Clerk" && r);
  await doneTurn(a, 0);
  const rows = await doneTurn(a, 1);
  await until(b, "B to see turn 1 done in the yard", 30_000, r => r.scene.id === opened.scene.id && turnOf(r, 1)?.phase === "done");
  const [row] = await stack.sql(`SELECT uid FROM game WHERE id = ${opened.game.id}`);
  const game: Game = { id: opened.game.id, uid: String(row!.uid), scene: opened.scene.id };
  const lines = linesOf(rows, 1);
  const dice = lines.filter(l => l.kind === "roll").map(l => l.text);
  check(`turn 1 is the act, its rules' lines first: "${lines[0]?.text}" then ${dice.join(" | ")}`, /^\(I cast Magic Missile at Sergeant (?:Agnes )?Kell\)$/.test(lines[0]?.text ?? "")
    && /^Cast Magic Missile \(1st-level slot\) on Sergeant Agnes Kell$/.test(dice[0] ?? "") && dice.filter(l => /^Sergeant Agnes Kell takes \d+ force damage/.test(l)).length === 3 && /spell slots 1st 3\/4/.test(dice.at(-1) ?? ""));
  check("the dice lines come before the GM's reply in the transcript", lines.map(l => l.kind).join() === `player,${dice.map(() => "roll").join(",")},narration`);
  const turnId = turnOf(rows, 1)!.id;
  for (const [p, i] of [[a, from.a], [b, from.b]] as const) {
    const seen = p.events.slice(i);
    const lastDice = seen.findLastIndex(e => e.table === "transcript" && e.op === "insert" && String(e.row.sceneId) === String(game.scene) && e.row.turn === 1 && e.row.kind === "roll");
    const firstDraft = seen.findIndex(e => e.table === "reply_draft" && e.op !== "delete" && e.row.turnId === turnId);
    check(`${p.name} saw the dice rows (event ${lastDice}) before the reply's first draft (event ${firstDraft})`, lastDice >= 0 && firstDraft > lastDice);
  }
  const hurt = worldOf(a).entities.kell?.states ?? [];
  // Three darts (3d4 + 3) drop a guard about half the time: down is as hurt as the rules leave her.
  check(`the world rows have Kell hurt, as the rules left her: ${hurt.join(", ") || "nothing"}`, hurt.some(st => st === "hurt" || st === "badly hurt" || st === "down"));
  const status = rows.sheets.find(s => s.playerId === rows.scene.controllerId)?.statusLine ?? "";
  check(`the sheet's status: ${status}`, /spell slots 1st 3\/4/.test(status));
  const gm = await gmOf(stack, game);
  const reacted = gm.path.find(p => p.turn === 1 && p.via.startsWith("reactions:"))?.via ?? "";
  check(`the people who saw it reacted before the reply: ${reacted}; Cob ${worldOf(a).entities.cob?.states.join(", ")}, Moll ${worldOf(a).entities.moll?.states.join(", ")}`,
    /cob=flee/.test(reacted) && /moll=cower/.test(reacted) && !!worldOf(a).entities.cob?.states.includes("gone") && !!worldOf(a).entities.moll?.states.includes("cowering"));
  check("no fight started, and nothing hangs over the player", gm.brawl === undefined && gm.threat === undefined);
  await pause(500);
  return { game, place: a.conn.rows()!.place!.place.id, from: { a: a.events.length, b: b.events.length } };
}

/** The act step reads a cast at a thing (the details call's choices), on the quiet answers. */
const casting = (fake: FakeOptions, spell: string, at: string): FakeOptions => onTop(fake, { choices: { mechanic: "cast", spell, aim_thing: at } });

/**
 * 27. A spell said in words, in the scene: "(I cast Magic Missile at the hoist rope)" asks the act step
 * (the line check found casting in it), which reads the cast at the rope; the rules resolve it before
 * the GM says a word, as the map's act: its dice rows (the cast, the darts, the rope destroyed, the
 * slots left) reach both clients before the reply's first draft, the world rows have the rope
 * destroyed and Prout's body fallen, the sheet a second slot gone; whoever saw it reacted (Moll
 * cowering still, Kell stepping in when she's up), the act and the reactions each asked once, the
 * turn replying throughout, and no fight started.
 */
export async function aSpellInWords(stack: Stack, root: string, a: Player, b: Player, { game }: WorldGame, fake: FakeOptions): Promise<void> {
  step("27. A spell said in words, resolved by the rules before the GM speaks, and the people who saw it react");
  await restartAi(stack, casting(fake, "magic-missile", "hoist-rope"), RAISED);
  check("Prout hangs from the hoist rope in A's world rows", !!worldOf(a).entities.prout?.states.includes("hanging"));
  const n = nextTurn(a);
  const from = { a: a.events.length, b: b.events.length };
  check("A says the line", (await a.conn.say("(I cast Magic Missile at the hoist rope)")) === undefined);
  const rows = await doneTurn(a, n);
  await until(b, `B to see turn ${n} done`, 10_000, r => turnOf(r, n)?.phase === "done");

  const lines = linesOf(rows, n);
  const dice = lines.filter(l => l.kind === "roll").map(l => l.text);
  check(`the rules' lines: ${dice.join(" | ")}`, dice[0] === "Cast Magic Missile (1st-level slot) on the hoist rope" && /^3 darts at the hoist rope: \d+ force$/.test(dice[1] ?? "")
    && /^The hoist rope takes \d+ force damage and is destroyed$/.test(dice[2] ?? "") && /spell slots 1st 2\/4/.test(dice.at(-1) ?? ""));
  check("the dice lines come before the GM's reply in the transcript", lines.map(l => l.kind).join() === `player,${dice.map(() => "roll").join(",")},narration`);
  const turnId = turnOf(rows, n)!.id;
  for (const [p, i] of [[a, from.a], [b, from.b]] as const) {
    const seen = p.events.slice(i);
    const lastDice = seen.findLastIndex(e => e.table === "transcript" && e.op === "insert" && e.row.turn === n && e.row.kind === "roll");
    const firstDraft = seen.findIndex(e => e.table === "reply_draft" && e.op !== "delete" && e.row.turnId === turnId);
    check(`${p.name} saw the dice rows (event ${lastDice}) before the reply's first draft (event ${firstDraft})`, lastDice >= 0 && firstDraft > lastDice);
  }
  check(`A saw turn ${n} go ${phasesOf(a, from.a, game, n).join(", ")}: replying through the act and the reactions`, phasesOf(a, from.a, game, n).join() === "replying,settling,done");

  const world = worldOf(a);
  check(`the world rows: the rope ${world.entities["hoist-rope"]?.states.join(", ")}, Prout's body ${world.entities.prout?.states.join(", ")}`,
    !!world.entities["hoist-rope"]?.states.includes("destroyed") && !!world.entities.prout?.states.includes("fallen") && !world.entities.prout?.states.includes("hanging"));
  const status = rows.sheets.find(s => s.playerId === rows.scene.controllerId)?.statusLine ?? "";
  check(`the sheet's status: ${status}`, /spell slots 1st 2\/4/.test(status));
  const asked = (op: string, at: "act" | "reactions") => modelCalls(root, game.uid, op, keyOf(game, n, at));
  // The line casts one of her spells by its name, so the act step doesn't ask what it is (PR #677's castNamed): only its details.
  check(`the act step asked its details once (director.mechanic ${asked("director.mechanic", "act")}) and not what it is (director.rules ${asked("director.rules", "act")}: the spell is named), the reactions once (${asked("director.reactions", "reactions")})`,
    asked("director.rules", "act") === 0 && asked("director.mechanic", "act") === 1 && asked("director.reactions", "reactions") === 1);
  const gm = await gmOf(stack, game);
  const path = gm.path.filter(p => p.turn === n).map(p => p.via);
  check(`the path's steps: ${path.join(", ")}; no fight started`, path[0] === "rules:cast:magic-missile" && /^reactions:.*moll=cower/.test(path[1] ?? "") && gm.brawl === undefined && gm.threat === undefined);
  await pause(500);
}

/**
 * 28. Fire burns on: the stage manager, keeping the world in step with a line (its answer the
 * recipe's), sets the yard gate alight; the next line's dice rows say it burns (the turn's start, in
 * the say's own commit), before the mouthpiece says a word.
 */
export async function fireBurnsOn(stack: Stack, a: Player, { game }: WorldGame, fake: FakeOptions): Promise<void> {
  step("28. Fire burns on at the next line's start");
  await restartAi(stack, onTop(fake, { byName: { world_ops: { ops: [LANTERN] } } }), RAISED);
  const n = nextTurn(a);
  check("A says the line", (await a.conn.say("(I knock the lantern off its hook against the yard gate)")) === undefined);
  await doneTurn(a, n);
  check(`the gate is burning in the world rows (${worldOf(a).entities.gate?.states.join(", ")})`, !!worldOf(a).entities.gate?.states.includes("burning"));

  await restartAi(stack, fake, RAISED);
  const m = n + 1;
  const at = a.events.length;
  check("A says the next line", (await a.conn.say("(I watch the gate burn)")) === undefined);
  const replying = await until(a, `turn ${m} replying`, 10_000, r => ["replying", "settling", "done"].includes(turnOf(r, m)?.phase ?? "") && r);
  const early = linesOf(replying, m).filter(l => l.kind === "roll").map(l => l.text);
  check(`as its turn began, its dice rows said the gate burns: ${early.join(" | ")}`, early.some(l => /^The yard gate takes \d+ fire damage/.test(l)));
  const rows = await doneTurn(a, m);
  const turnId = turnOf(rows, m)!.id;
  const burned = a.events.slice(at).findIndex(e => e.table === "transcript" && e.op === "insert" && e.row.turn === m && /^The yard gate takes/.test(String(e.row.text)));
  const drafted = a.events.slice(at).findIndex(e => e.table === "reply_draft" && e.op !== "delete" && e.row.turnId === turnId);
  check(`they came with the line itself (event ${burned}), before the reply's first draft (event ${drafted})`, burned >= 0 && drafted > burned);
  void game;
}

/**
 * 30. Row for row: every event on the place's tables, for this scene's place, that B, the spectator,
 * saw once both were watching the yard, quiet (after the act's turn), is the lead's, in the same
 * order (V0's comparison, over the world's rows; B's own subscriptions coming and going, a place it
 * watched before, aren't the place's): the fire lit and burning on. Then the module's times for the
 * rules' work, as it logged them.
 */
export async function rowForRow(stack: Stack, a: Player, b: Player, { place, from }: WorldGame): Promise<void> {
  step("30. The spectator's world, row for row the lead's");
  const n = nextTurn(a) - 1;
  await until(b, `B to see turn ${n} done`, 10_000, r => turnOf(r, n)?.phase === "done");
  const here = (table: string, row: any) => (table === "place" ? row.id : row.placeId) === place;
  const world = (p: Player, i: number) => p.events.slice(i).filter(e => PLACE.has(e.table) && here(e.table, e.row)).map(e => `${e.table} ${e.op} ${JSON.stringify(e.row, bigints)}`);
  const seenA = world(a, from.a), seenB = world(b, from.b);
  const first = seenA.findIndex((e, i) => e !== seenB[i]);
  check(`A and B saw the same ${seenA.length} row events on the place's tables${first >= 0 ? ` (they part at ${first}: A ${seenA[first]?.slice(0, 160)}; B ${seenB[first]?.slice(0, 160)})` : ""}`, seenA.length > 3 && first < 0 && seenA.length === seenB.length);
  const log = (await moduleLog(stack)).split("\n").filter(l => /\[rules\] (act|first)/.test(l)).map(l => l.replace(/^.*?\[rules\]/, "[rules]"));
  for (const line of log) note(line);
}

/** The world the player's client rebuilt from the place's rows. */
function worldOf(p: Player): SceneWorld {
  const world = p.conn.view()?.place?.world;
  if (!world) throw new Error(`${p.name} has no place`);
  return world;
}

