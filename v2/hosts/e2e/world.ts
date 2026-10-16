import type { FakeOptions } from "../../ai/llm/fake-openrouter.ts";
import type { SceneWorld } from "../../shared/world/scene-world.ts";
import { onTop } from "../dev/fake.ts";
import type { Stack } from "../dev/stack.ts";
import type { Game } from "./creation.ts";
import { aNewGame, gmOf, keyOf, linesOf, phasesOf, RAISED } from "./gm.ts";
import { aiLog, bigints, check, doneTurn, escaped, modelCalls, moduleLog, nextTurn, note, ok, restartAi, step, turnOf, until, type Player } from "./kit.ts";

/**
 * The e2e's steps for the world bridge (world-bridge-design §3.4), after the full GM's: a wizard's
 * spell resolved by the rules before the GM speaks, with the people who saw it reacting; a blow the
 * reply left hanging landing first next turn; a fire that burns on at the next line's start; the AI
 * service gone after it kept the reactions; and the spectator's world, row for row the lead's. On
 * the fake model with fake.json's quiet answers (Kell intervenes, Cob flees, Moll cowers, nothing
 * ruled), each step's recipe on top: the decider casts what the recipe names, where it names.
 */

/** The decider casts a spell at a thing (the details call's choices), on the quiet answers. */
const casting = (fake: FakeOptions, spell: string, at: string): FakeOptions => onTop(fake, { choices: { mechanic: "cast", spell, aim_thing: at } });

/** The place's tables, as the client watches them (net/connection.ts): the world's rows. */
const PLACE = new Set(["place", "entity", "position", "area", "material", "health", "stack", "surface", "creature", "player_character", "gear", "narrative", "world_log"]);

/** What the world bridge's steps share: the wizard's game, and where both players' events stood when B joined it. */
export interface WorldGame { game: Game; from: { a: number; b: number } }

/**
 * 26. Before the GM speaks: Magic Missile at the hoist rope. The dice rows (the cast, the darts, the
 * rope destroyed, the status) reach both clients before the reply's first draft; the world rows have
 * the rope destroyed and Prout's body fallen; the sheet's status has a 1st-level slot gone; the
 * reactions step asked who saw it (Cob fled: gone from the place and off the stage, Moll cowering).
 */
export async function beforeTheGmSpeaks(stack: Stack, root: string, a: Player, b: Player, fake: FakeOptions): Promise<WorldGame> {
  step("26. A spell resolved before the GM speaks, and the people who saw it react");
  await restartAi(stack, casting(fake, "magic-missile", "hoist-rope"), RAISED);
  const game = await aNewGame(stack, a);
  check("B's join_game is made", (await b.conn.joinGame(game.id)) === undefined);
  await until(b, "B to see the scene and its place", 10_000, r => r.game.id === game.id && r.scene.status === "live" && !!r.place && !!b.conn.view()?.place);
  check("A's view has the yard from its rows: Prout's body hanging from the hoist rope", worldOf(a).entities.prout?.states.includes("hanging") === true);
  const from = { a: a.events.length, b: b.events.length };

  const n = nextTurn(a);
  check("A says the line", (await a.conn.say("(I cast Magic Missile at the hoist rope)")) === undefined);
  const rows = await doneTurn(a, n);
  await until(b, `B to see turn ${n} done`, 10_000, r => turnOf(r, n)?.phase === "done");
  const lines = linesOf(rows, n);
  const dice = lines.filter(l => l.kind === "roll").map(l => l.text);
  check(`the rules' lines: ${dice.join(" | ")}`, dice[0] === "Cast Magic Missile (1st-level slot) on the hoist rope" && /^3 darts at the hoist rope: \d+ force$/.test(dice[1] ?? "")
    && /^The hoist rope takes \d+ force damage and is destroyed$/.test(dice[2] ?? "") && /spell slots 1st 3\/4/.test(dice.at(-1) ?? ""));
  check("the dice lines come before the GM's reply in the transcript", lines.map(l => l.kind).join() === `player,${dice.map(() => "roll").join(",")},narration`);
  const turnId = turnOf(rows, n)!.id;
  for (const [p, i] of [[a, from.a], [b, from.b]] as const) {
    const seen = p.events.slice(i);
    const lastDice = seen.findLastIndex(e => e.table === "transcript" && e.op === "insert" && e.row.turn === n && e.row.kind === "roll");
    const firstDraft = seen.findIndex(e => e.table === "reply_draft" && e.op !== "delete" && e.row.turnId === turnId);
    check(`${p.name} saw the dice rows (event ${lastDice}) before the reply's first draft (event ${firstDraft})`, lastDice >= 0 && firstDraft > lastDice);
    const phases = phasesOf(p, i, game, n);
    check(`${p.name} saw turn ${n} go ${phases.join(", ")}: still deciding through the reactions`, phases.slice(0, 2).join() === "deciding,replying");
  }

  const world = worldOf(a);
  check(`the world rows: the rope ${world.entities["hoist-rope"]?.states.join(", ")}, Prout's body ${world.entities.prout?.states.join(", ")} in ${world.entities.prout?.parent}`,
    !!world.entities["hoist-rope"]?.states.includes("destroyed") && world.entities.prout?.states.join() === "fallen" && world.entities.prout?.parent === "yard");
  const status = rows.sheets.find(s => s.playerId === rows.scene.controllerId)?.statusLine ?? "";
  check(`the sheet's status: ${status}`, /spell slots 1st 3\/4, 2nd 2\/2/.test(status));
  check(`the reactions were asked once for the turn: ${keyOf(game, n, "reactions")}`, modelCalls(root, game.uid, "director.reactions", keyOf(game, n, "reactions")) === 1);
  const gm = await gmOf(stack, game);
  const reacted = gm.path.find(p => p.turn === n && p.via.startsWith("reactions:"))?.via;
  check(`the path's reactions step: ${reacted}; absent: ${gm.absent.join(", ")}`, reacted === "reactions:kell=intervene,cob=flee,moll=cower" && gm.absent.join() === "cob");
  const view = a.conn.view()!;
  check(`Cob is gone from the place and off the stage (on stage: ${view.present.map(p => p.key).join(", ")}); Moll ${world.entities.moll?.states.join(", ")}`,
    !!world.entities.cob?.states.includes("gone") && !view.present.some(p => p.key === "cob") && !!world.entities.moll?.states.includes("cowering"));
  return { game, from };
}

/**
 * 27. A blow left hanging: the settle's read (threat: attack:kell) keeps Kell's attack in gm_state;
 * the next line's first dice row is it landing, before the decide, and it's gone from gm_state after.
 */
export async function aBlowLeftHanging(stack: Stack, a: Player, { game }: WorldGame, fake: FakeOptions): Promise<void> {
  step("27. A blow left hanging lands first next turn");
  await restartAi(stack, onTop(fake, { choices: { threat: "attack:kell" } }), RAISED);
  const n = nextTurn(a);
  check("A says a line", (await a.conn.say("Sergeant, that was an accident. Put the club down.")) === undefined);
  await doneTurn(a, n);
  const kept = await gmOf(stack, game);
  check(`gm_state keeps the threat the settle read: ${JSON.stringify(kept.threat)}`, kept.threat?.kind === "attack" && kept.threat.by === "kell" && kept.threat.turn === n);

  await restartAi(stack, fake, RAISED);
  const m = n + 1;
  check("A says the next line", (await a.conn.say("(I put my hands up)")) === undefined);
  const rows = await doneTurn(a, m);
  const lines = linesOf(rows, m);
  check(`its first dice row is Kell's blow: "${lines[1]?.text}"`, lines[0]?.kind === "player" && lines[1]?.kind === "roll" && /^Club: Sergeant Agnes Kell's attack on you: \d+ .*vs AC \d+/.test(lines[1]!.text));
  const after = await gmOf(stack, game);
  check("the threat is gone from gm_state", after.threat === undefined);
}

/**
 * 28. Fire burns on: Burning Hands at the yard gate sets it alight; the next line's dice rows say it
 * burns (the turn's start, in the say's own commit), before its decide.
 */
export async function fireBurnsOn(stack: Stack, a: Player, { game }: WorldGame, fake: FakeOptions): Promise<void> {
  step("28. Fire burns on at the next line's start");
  await restartAi(stack, casting(fake, "burning-hands", "gate"), RAISED);
  const n = nextTurn(a);
  check("A says the line", (await a.conn.say("(I cast Burning Hands at the yard gate)")) === undefined);
  const rows = await doneTurn(a, n);
  const dice = linesOf(rows, n).filter(l => l.kind === "roll").map(l => l.text);
  check(`the cone catches the gate: ${dice.join(" | ")}`, /^Cast Burning Hands \(1st-level slot\): a 15-foot cone towards the yard gate/.test(dice[0] ?? "") && dice.includes("The yard gate catches fire"));
  check(`the gate is burning in the world rows (${worldOf(a).entities.gate?.states.join(", ")})`, !!worldOf(a).entities.gate?.states.includes("burning"));

  await restartAi(stack, fake, RAISED);
  const m = n + 1;
  const at = a.events.length;
  check("A says the next line", (await a.conn.say("(I watch the gate burn)")) === undefined);
  const deciding = await until(a, `turn ${m} deciding`, 10_000, r => turnOf(r, m)?.phase === "deciding" && r);
  const early = linesOf(deciding, m).filter(l => l.kind === "roll").map(l => l.text);
  check(`as its turn began deciding, its dice rows said the gate burns: ${early.join(" | ")}`, early.some(l => /^The yard gate takes \d+ fire damage/.test(l)));
  await doneTurn(a, m);
  const decided = a.events.slice(at).findIndex(e => e.table === "turn" && e.row.n === m && e.row.phase === "replying");
  const burned = a.events.slice(at).findIndex(e => e.table === "transcript" && e.op === "insert" && e.row.turn === m && /^The yard gate takes/.test(String(e.row.text)));
  check(`they came with the line itself (event ${burned}), before the decide was done (event ${decided})`, burned >= 0 && decided > burned);
  void game;
}

/**
 * 29. The AI service gone after it kept the reactions (KM_AI_FAULTS=exit-after-store:reactions):
 * started again, it answers them from its store, and the turn finishes on them.
 */
export async function keptReactions(stack: Stack, root: string, a: Player, { game }: WorldGame, fake: FakeOptions): Promise<void> {
  step("29. The AI service gone after it kept the reactions");
  const spell = casting(fake, "magic-missile", "spectacles");
  await restartAi(stack, spell, { ...RAISED, KM_AI_FAULTS: "exit-after-store:reactions" });
  const n = nextTurn(a);
  check("A says the line", (await a.conn.say("(I cast Magic Missile at Prout's spectacles)")) === undefined);
  const code = await stack.ai.exited();
  check(`the AI service exited (${code}) right after it stored the reactions`, code === 137);
  await stack.ai.start({ KM_AI_FAKE: JSON.stringify(spell), ...RAISED });
  ok("the AI service is started again, without the fault");
  const rows = await doneTurn(a, n);
  const key = keyOf(game, n, "reactions");
  check("the AI service answered the reactions from its store", new RegExp(`reactions ${escaped(key)} attempt \\d+: 200 from the store`).test(aiLog(root)));
  check("director.reactions was asked once for the key", modelCalls(root, game.uid, "director.reactions", key) === 1);
  const dice = linesOf(rows, n).filter(l => l.kind === "roll").map(l => l.text);
  check(`the turn finished on them: ${dice.filter(l => /spectacles/.test(l)).join(" | ")}`, dice.some(l => /^Prout's spectacles take \d+ force damage and are destroyed$/.test(l)));
}

/**
 * 30. Row for row: every event on the place's tables that B, the spectator, saw since joining is the
 * lead's, in the same order (V0's comparison, over the world's rows). Then the module's times for the
 * rules' work, as it logged them.
 */
export async function rowForRow(stack: Stack, a: Player, b: Player, { from }: WorldGame): Promise<void> {
  step("30. The spectator's world, row for row the lead's");
  const n = nextTurn(a) - 1;
  await until(b, `B to see turn ${n} done`, 10_000, r => turnOf(r, n)?.phase === "done");
  const world = (p: Player, i: number) => p.events.slice(i).filter(e => PLACE.has(e.table)).map(e => `${e.table} ${e.op} ${JSON.stringify(e.row, bigints)}`);
  const seenA = world(a, from.a), seenB = world(b, from.b);
  check(`A and B saw the same ${seenA.length} row events on the place's tables`, seenA.length > 20 && JSON.stringify(seenA) === JSON.stringify(seenB));
  const log = (await moduleLog(stack)).split("\n").filter(l => /\[rules\] (act|first)/.test(l)).map(l => l.replace(/^.*?\[rules\]/, "[rules]"));
  for (const line of log) note(line);
}

/** The world the player's client rebuilt from the place's rows. */
function worldOf(p: Player): SceneWorld {
  const world = p.conn.view()?.place?.world;
  if (!world) throw new Error(`${p.name} has no place`);
  return world;
}

