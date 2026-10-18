import { scriptLine, scriptOf } from "../../client/fight/script.ts";
import type { FightView } from "../../client/fight/view.ts";
import { playMs } from "../../shared/fight/pace.ts";
import type { Stack } from "../dev/stack.ts";
import { check, fixDice, mapUntil, moduleLog, note, seconds, step, type Player } from "./kit.ts";

/**
 * The e2e's step for a fight on the map (M6, docs/combat-design.md): one of the zoo's rings on a real
 * SpacetimeDB, through the client's connection, in a game of its own whose dice are fixed as it's made
 * (so what the steps before rolled can't move the fight's). start_ring sets out the wolf run; the wolves' turns
 * are played one at a time by fight_step on SpacetimeDB's own schedule, each a commit of its own
 * paced for the screen, each written as moments (the turn, the move with its path, the bite with its
 * roll); the screen's playback of each (M6's screen: a step a tile, a bite's swing and what it did,
 * each as long on screen as the simulation waited for it); a spectator sees the same moments; the
 * player's own act on their turn; hurry, the screen's skip to their turn, playing the wolves' turns
 * after it at once; then the dice deciding (auto) to the end; out back to the map, the fight's end
 * the map's words. The steps' times as the module logged them. On the fixed dice the wolves win
 * initiative twice over, the player's first blow is a critical hit that downs a wolf, and auto plays
 * on to a victory: each of the step's checks runs every time.
 */

/** The fight's game: a ready-made fighter, a game of its own made just before the ring. */
const SELLSWORD = { campaign: "caerwyn", name: "Wren Ashdown", concept: "a sellsword between contracts", build: "fighter" };
/** Its dice, fixed as it's made: two wolves go before the player, the player's blow lands, and the wolves lose. */
const RING_DICE = 48;

/** Resolves with what `test` finds in the player's fight, once it finds it; a Failed after `ms`. */
export function fightUntil<T>(p: Player, what: string, ms: number, test: (view: FightView) => T | undefined | null | false | 0): Promise<T> {
  return new Promise((resolve, reject) => {
    const look = () => {
      const view = p.conn.fight();
      const found = view && test(view);
      if (!found) return;
      clearTimeout(timer);
      stop();
      resolve(found);
    };
    const timer = setTimeout(() => {
      stop();
      const v = p.conn.fight();
      reject(new Error(`${p.name} waited ${seconds(ms)} for ${what}; it last saw: ${v ? `${v.title} ${v.status}, round ${v.round}, ${v.turn}'s turn, ${v.events.length} moments` : "no fight"}`));
    }, ms);
    const stop = p.conn.onChange(look);
    look();
  });
}

const theirs = (v: FightView) => v.status === "on" && !!v.options;

/** 40. A fight in the zoo's ring. `lead` plays it, in a new game on the map with its dice fixed; `b` joins that game to watch. */
export async function aFightInTheRing(stack: Stack, lead: Player, b: Player): Promise<void> {
  step("40. A fight in the zoo's ring: start_ring sets out the wolf run; the wolves' turns played one at a time by fight_step on SpacetimeDB's schedule, each its moments, as the screen plays them, which the spectator sees too; the player's act, hurry playing the wolves' turns at once, then auto to the end; out, back to the map");
  const was = lead.conn.explore()?.game;
  await fixDice(stack, RING_DICE);
  check(`${lead.name}'s new_game (${SELLSWORD.name}, the ready-made ${SELLSWORD.build}) is made, its dice fixed (set_dice_seed ${RING_DICE})`, (await lead.conn.newGame(SELLSWORD)) === undefined);
  const game = (await mapUntil(lead, `${lead.name}'s new game on the map`, 10_000, v => v.game !== was && !v.ex.scene && v)).game;
  check(`B's join_game(${game}) is made`, (await b.conn.joinGame(BigInt(game))) === undefined);
  await mapUntil(b, "B to see the map", 10_000, v => v.game === game && v);
  check(`${lead.name}'s start_ring("wolves") is made`, (await lead.conn.act("startRing", { ring: "wolves", fast: undefined })) === undefined);
  const first = await fightUntil(lead, "the wolf run to be set out", 10_000, v => v.title === "The wolf run" && v);
  check(`the fight's rows came: ${first.title}, ${first.order.length} in it, in initiative order ${first.order.join(", ")}: two wolves before the player, on the fixed dice`, first.order.length === 4 && first.status === "on" && first.order.indexOf("player") === 2);
  const start = first.events[0];
  check(`its first moment: "${start?.caption}"`, start?.kind === "start" && /^Roll for initiative!/.test(start.caption));

  const mine = await fightUntil(lead, "the turn to come round to the player", 60_000, v => (theirs(v) || v.status !== "on") && v);
  check("the player's turn came, the fight still on", theirs(mine));
  // This fight's own: the story's Heron was fought on the board before it (step 33), its turns hurried.
  const turns = lead.events.filter(e => e.table === "fight_event" && e.op === "insert" && e.row.kind === "turn" && String(e.row.fightId) === first.id);
  const npcTurns = turns.filter(e => e.row.actor !== "player");
  note(`moments before the player's turn: ${mine.events.map(e => `${e.kind}${e.actor ? `:${e.actor}` : ""}`).join(", ")}`);
  for (const e of mine.events.filter(e => e.kind === "move")) check(`a move's path, a tile at a time: ${e.caption} (${(e.detail.path ?? []).map(t => `${t.x},${t.y}`).join(" ")})`, (e.detail.path ?? []).length > 0);
  for (const e of mine.events.filter(e => e.kind === "attack")) check(`a bite with its roll: ${e.caption} (${e.detail.rolls[0]?.d20.join("/")} ${e.detail.rolls[0]?.bonus} = ${e.detail.rolls[0]?.total} vs AC ${e.detail.rolls[0]?.ac})`, e.detail.rolls.length > 0);
  // The screen plays each as the playback's script has it: a step a tile, a bite's swing and what it did, as long as the simulation waited.
  const named = (id: string) => (id === mine.board.pc ? "you" : mine.board.units[id]?.called ?? id);
  for (const e of mine.events.filter(e => e.actor && e.actor !== "player" && (e.kind === "move" || e.kind === "attack"))) {
    const s = scriptOf(e);
    const steps = s.beats.filter(b => b.kind === "step").length;
    const blow = s.beats.some(b => b.kind === "swing" || b.kind === "shot");
    const landed = s.beats.some(b => b.kind === "hit" || b.kind === "miss");
    check(`the screen plays it: ${scriptLine(e, named)} (${s.ms} ms)`, s.ms === playMs(e) && (e.kind === "move" ? steps === (e.detail.path ?? []).length : blow && landed));
  }
  // Each of the other side's turns came in a commit of its own, a moment apart: SpacetimeDB's schedule playing fight_step.
  const gaps = npcTurns.slice(1).map((e, i) => e.at - npcTurns[i]!.at);
  check(`the wolves' turns came one at a time, paced (${gaps.map(g => `${Math.round(g)} ms`).join(", ")} apart)`, gaps.length >= 1 && gaps.every(g => g >= 200));

  const watched = await fightUntil(b, "B to see the same fight", 10_000, v => v.id === mine.id && v.events.length >= mine.events.length && v);
  check(`B sees the same moments, as a spectator with no actions (${watched.watching ? `watching ${watched.watching}` : "?"})`, watched.events.slice(0, mine.events.length).map(e => e.caption).join("\n") === mine.events.map(e => e.caption).join("\n") && !watched.options && !!watched.watching);
  check("B's own act is refused: not_controller", (await b.conn.act("fightTurn", { act: "dodge" }))?.code === "not_controller");

  const act = mine.options!.actions.find(a => a.kind === "cast" || a.kind === "attack")!;
  const seen = mine.events.length;
  const refused = act.kind === "cast" ? await castById(lead, act.id) : await lead.conn.act("attack", { how: "attack", at: atOf(act.id) });
  check(`${lead.name}'s act on their turn: ${act.id} (${act.label})`, refused === undefined);
  const after = await fightUntil(lead, "the act's moment", 10_000, v => v.events.length > seen && v);
  const struck = after.events[seen]!.caption;
  check(`it lands, as the fixed dice have it: "${struck}"`, /^You swing at a grey wolf: a critical hit, \d+ damage! A grey wolf goes down\.$/.test(struck));
  // The screen's skip to your turn: the turn ended, hurry plays the wolves' turns at once, not a paced step apart.
  check("the player's turn goes on after the blow", theirs(after));
  check("end_turn is made", (await lead.conn.act("fightTurn", { act: "end_turn" })) === undefined);
  const asked = performance.now();
  const hurried = await lead.conn.act("fightTurn", { act: "hurry" });
  check(`hurry is made (or the wolves' turns were already played: ${hurried?.text ?? "made"})`, hurried === undefined || hurried.code === "not_now");
  const hurriedTo = await fightUntil(lead, "the player's turn after hurry", 10_000, v => (theirs(v) || v.status !== "on") && v);
  const took = Math.round(performance.now() - asked);
  check(`the wolves' turns came at once, ${took} ms to the player's turn, not a paced step apart`, took < 1500 && hurriedTo.status === "on");
  check("hurry on the player's own turn says there's nothing to hurry", (await lead.conn.act("fightTurn", { act: "hurry" }))?.text === "(It's your turn already: there's nothing to hurry.)");

  let rounds = 0;
  for (let i = 0; i < 40; i++) {
    const v = await fightUntil(lead, "the player's turn, or the end", 60_000, v => (theirs(v) || v.status !== "on") && v);
    if (v.status !== "on") break;
    rounds++;
    check(`round ${v.round}: auto (the AI plays the player's turn)`, (await lead.conn.act("fightTurn", { act: "auto" })) === undefined);
    await fightUntil(lead, "the turn to move on", 10_000, w => (w.status !== "on" || !theirs(w) || w.round > v.round) && w);
  }
  const over = await fightUntil(lead, "the fight to end", 60_000, v => v.status === "over" && v);
  const last = over.events[over.events.length - 1]!;
  check(`it ended (${over.outcome}) after ${over.round} rounds, ${rounds} of them auto: "${last.caption}" ${over.result?.summary ?? ""}`, last.kind === "over" && !!over.result && over.outcome === "victory");
  check(`the moments in order, numbered 1 to ${over.events.length}`, over.events.every((e, i) => e.seq === i + 1));

  const before = lead.conn.explore()?.acts ?? -1;
  check("out (walk toward out) goes back to the map", (await lead.conn.walk({ toward: "out" })) === undefined);
  const back = await mapUntil(lead, `${lead.name} back on the map`, 10_000, v => v.acts > before && v);
  check(`the map's words are the fight's end: "${back.said.slice(0, 90)}…"`, back.said.startsWith("The wolf run:") && lead.conn.fight() === undefined);

  const log = await moduleLog(stack);
  const steps = [...log.matchAll(/\[fight\] fight \d+: (\S+)'s turn played, (\d+) ms/g)].map(m => `${m[1]} ${m[2]} ms`);
  note(`fight_step's turns, as the module logged them: ${steps.slice(0, 10).join("; ")}${steps.length > 10 ? `, and ${steps.length - 10} more` : ""}`);
}

/** A tile from an action id: attack@4,3 is (4, 3). */
function atOf(id: string): { x: number; y: number } {
  const [x, y] = id.slice(id.indexOf("@") + 1).split(",").map(Number);
  return { x: x!, y: y! };
}

/** A spell by its action id: cast_<spell>@x,y or cast_<spell>_self. */
function castById(p: Player, id: string): ReturnType<Player["conn"]["act"]> {
  const self = id.endsWith("_self");
  const spell = id.replace(/^cast_/, "").replace(/(@\d+,\d+|_self)$/, "");
  return p.conn.act("cast", { spell, at: self ? undefined : atOf(id), self: self ? true : undefined });
}
