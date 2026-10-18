import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveScene } from "../../shared/scene/graph.ts";
import { loadScene } from "../../shared/scene/load.ts";
import { CAMPAIGNS } from "./paths.ts";
import { checkOf, probeTurn, stateBefore, swapped, type LoggedCall } from "./probe.ts";

/** The co-GM's probe (qa/loop/probe.ts) on a round's call log, here a made-up one of the campaign's clerk. */

const clerk = effectiveScene(loadScene(readFileSync(join(CAMPAIGNS, "caerwyn", "scenes", "hanged-clerk.kmscene"), "utf8")), []);
const key = (turn: number, step: string) => `uid:s7:t${turn}:${step}`;
const move = (route: string, result = "Reached") => ({ name: "move_scene", args: { route_id: route, outcome: "none", why: "It happened." }, result });
const input = (turn: number) => `# The scene so far\n\nGM: The round's own words, turn ${turn}.\n\n# Where the scene is: Stones at a hanged man [start]\nIt has been here for 2 exchanges. Reached so far: [start], [murder].\n\n# Current character roles\n\nCharacter role for Cob:\nConversation role: The round's own role.\n\n# Who's on stage now\n- Cob [cob]\n\n# This turn's check\nThe GM called Sleight Of Hand DC 13, and the roll came to 9: a failure (minor failure).`;
const calls: LoggedCall[] = [
  { key: key(1, "settle"), operation: "two-part.co-gm", request: { input: [{ role: "user", content: input(1) }] }, calls: [move("find-murder")] },
  { key: key(2, "settle"), operation: "two-part.co-gm", request: { input: [{ role: "user", content: input(2) }] }, calls: [move("find-motive", "error: refused")] },
  { key: key(3, "reply"), operation: "two-part.reply", request: { instructions: "Prompt.\n\n# Your prep for this scene: The Hanged Clerk\n\n## What happened just before this scene\nThe round's own story so far.\n\n## Where it starts: Stones at a hanged man [start]\nAnd so on." } },
  { key: key(3, "settle"), operation: "two-part.co-gm", request: { input: [{ role: "user", content: input(3) }] }, calls: [] },
];

test("the bookkeeping rebuilt from a round's co-GM moves: those answered taken again, the stage's exchanges counted as the settle counts them", () => {
  const gm = stateBefore(clerk, calls, "7", 3);
  assert.deepEqual(gm.reached, ["start", "murder"], "the refused move isn't taken");
  assert.equal(gm.turnsInBeat, 2);
  assert.deepEqual(gm.path.map(p => [p.turn, p.to]), [[1, "murder"]]);
  assert.deepEqual(stateBefore(clerk, calls, "8", 3).reached, ["start"], "another scene's calls aren't this one's");
});

test("the turn's check read back from the co-GM's input, and a part of a prompt swapped for the round's", () => {
  assert.deepEqual(checkOf(input(3)), { skill: "sleight_of_hand", dc: 13, total: 9, success: false, band: "minor_failure" });
  assert.equal(checkOf("# Who's on stage now"), undefined);
  assert.equal(swapped("a [mine] b", "x [theirs] y", "[", "]"), "a [theirs] b");
  assert.equal(swapped("a b", "x [theirs] y", "[", "]"), "a b", "nothing to swap: as it was");
});

test("a probe asks the co-GM as coGm does now, with the round's transcript, roles and story so far in its request", async () => {
  let sent: { instructions: string; input: Array<{ content: string }> } | undefined;
  const model = (async (_url: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init!.body)) as typeof sent;
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }], usage: { cost: 0 } });
  }) as typeof fetch;
  const tried = await probeTurn(clerk, calls, "7", 3, { player: { name: "Nim", concept: "a halfling cutpurse" } }, { fetch: model, apiKey: "test" });
  assert.deepEqual([tried.moves, tried.error], [[], undefined]);
  assert.deepEqual(tried.rebuilt, { reached: ["start", "murder"], turnsInBeat: 2 });
  assert.deepEqual(tried.logged, { reached: ["start", "murder"], turnsInBeat: 2 });
  assert.match(sent!.instructions, /## What happened just before this scene\nThe round's own story so far\.\n\n## Where it starts: Stones at a hanged man \[start\]/, "the prep's head the round's");
  assert.match(sent!.instructions, /## Your tools\n/, "the tools section the code's");
  const said = sent!.input[0]!.content;
  assert.match(said, /^# The scene so far\n\nGM: The round's own words, turn 3\.\n\n# Where the scene is: Stones at a hanged man \[start\]\nIt's turn 3:/);
  assert.match(said, /# Current character roles\n\nCharacter role for Cob:\nConversation role: The round's own role\.\n\n# Who's on stage now/);
  assert.match(said, /# This turn's check\nThe GM called Sleight Of Hand DC 13, and the roll came to 9: a failure \(minor failure\)\./);
});
