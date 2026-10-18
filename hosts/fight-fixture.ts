// New (M6's fight screen): records a fight in one of the zoo's rings on the memory host, a commit at a time, for the client's screen check and its tests to play back offline (client/check/fixtures/fight-<ring>.json).
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { FightOptions } from "../shared/fight/types.ts";
import { eventsOf, fightOf } from "../simulation/src/fight/rows.ts";
import { all, hostWithCampaign, identity } from "../simulation/src/host/testing.ts";

/**
 * A fight as the client gets it, recorded: one of the zoo's rings started for a ready-made character
 * on the memory host (its dice from the seed), then played, the other side's turns a step at a time
 * as SpacetimeDB's schedule plays them and the player's turns by a simple plan (a blow at whoever's
 * in reach, else close in on the nearest, else end the turn; after `rounds` rounds, auto to the
 * end). Each commit is a frame: the fight row's columns as they stood and how many of its moments
 * there were by then. So a check can show the client the rows as they came, frame by frame.
 *
 *   node --no-warnings --import tsx hosts/fight-fixture.ts --ring wolves --build fighter --seed 3 --out client/check/fixtures/fight-wolves.json
 */

const { values } = parseArgs({ options: { ring: { type: "string" }, build: { type: "string" }, seed: { type: "string" }, rounds: { type: "string" }, out: { type: "string" } } });
const ring = values.ring ?? "wolves", build = values.build ?? "fighter", seed = Number(values.seed ?? 3), rounds = Number(values.rounds ?? 3);

const { host } = hostWithCampaign(seed, { map: true });
const wren = identity(1);
const refused = host.as(wren).newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a sellsword", build });
if (refused) throw new Error(refused.text);
host.advance(1000);
const game = all(host.db.game)[0]!;
const started = host.as(wren).startRing({ ring });
if (started) throw new Error(started.text);

const fight = () => host.transact(tx => fightOf(tx, game.id))!;
const frames: Array<{ label: string; fight: Record<string, unknown>; events: number }> = [];
const frame = (label: string) => {
  const f = fight();
  frames.push({
    label, events: host.transact(tx => eventsOf(tx, f.id)).length,
    fight: { status: f.status, outcome: f.outcome, round: f.round, turn: f.turn, order: f.order, board: f.board, options: f.options, result: f.result },
  });
};
frame("start");

/** The player's turn by the plan: a blow at whoever's in reach, else close in on the nearest, else end it. */
function playerTurn(): void {
  const o = JSON.parse(fight().options) as FightOptions;
  const blow = o.actions.find(a => a.kind === "attack" && a.name === "Attack" && a.target?.startsWith("wolf") !== false);
  if (blow?.at) { act(host.as(wren).attack({ how: "attack", at: blow.at }), `you: ${blow.id}`); return; }
  const close = o.actions.find(a => a.kind === "move" && /^Close in/.test(a.name ?? ""));
  if (close?.at) { act(host.as(wren).walk({ to: close.at }), `you: ${close.id}`); return; }
  act(host.as(wren).fightTurn({ act: "end_turn" }), "you: end_turn");
}

function act(why: { text: string } | undefined, label: string): void {
  if (why) throw new Error(`${label}: ${why.text}`);
  frame(label);
}

for (let i = 0; i < 400 && fight().status === "on"; i++) {
  const f = fight();
  if (f.options) {
    if (f.round > rounds) act(host.as(wren).fightTurn({ act: "auto" }), "you: auto");
    else {
      playerTurn();
      // Still the player's turn with the action spent: end it.
      const now = fight();
      if (now.status === "on" && now.options && (JSON.parse(now.options) as FightOptions).actionUsed) act(host.as(wren).fightTurn({ act: "end_turn" }), "you: end_turn");
    }
    continue;
  }
  host.advance(5000);
  if (host.fightSteps()) frame(`step: ${f.turn}`);
}

const f = fight();
const map = JSON.parse(f.map ?? "{}") as unknown;
const events = host.transact(tx => eventsOf(tx, f.id));
const out = { recorded: `node --no-warnings --import tsx hosts/fight-fixture.ts --ring ${ring} --build ${build} --seed ${seed} --rounds ${rounds}`, title: f.title, place: f.place, map, frames, events };
const json = `${JSON.stringify(out, null, 1)}\n`;
if (values.out) writeFileSync(values.out, json);
else process.stdout.write(json);
console.error(`${ring}: ${frames.length} frames, ${events.length} moments, ${f.status} (${f.outcome ?? "?"}) after ${f.round} rounds`);
