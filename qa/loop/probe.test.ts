import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveScene } from "../../shared/scene/graph.ts";
import { loadScene } from "../../shared/scene/load.ts";
import { CAMPAIGNS } from "./paths.ts";
import { mouthpieceRules, twoPartNow } from "../../ai/gm/two-part.ts";
import { checkOf, mouthpieceRequest, mouthpieceView, partsOf, probeTurn, splicedNote, stateBefore, swapped, type LoggedCall } from "./probe.ts";

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

// --- The mouthpiece's probe (QA round qa2-1018's fixes)

test("the note spliced: the round's parts kept, this checkout's made again, the round's out-of-sight list kept in the hidden part, and a closing's directive made again", () => {
  const recorded = [
    "Co-GM note, before turn 4\n\nCharacter role for Cob:\nConversation role: The round's.",
    "## Where the scene is now: Stones at a hanged man\nThe round's stage.\n\n(The scene has been at this point for 3 exchanges.)",
    "## The world right now\nThe round's world.",
    "## Hidden from the player right now\nBehind the screen.\nOut of the player's sight:\n- a folded page [ledger-page]\nKept back by the people here, the round's way:\n- Cob: The boots are Prout's.",
    "## For this reply\nThe round's directive.\n\nThis reply closes the scene: The round's ending. Said there already, so not said again: [Kell] “Noted.”",
  ].join("\n\n");
  const made = [
    "## Where the scene is now: Stones at a hanged man\nThis checkout's stage.",
    "## The world right now\nThis checkout's world.",
    "## Hidden from the player right now\nBehind the screen.\nOut of the player's sight:\n- this checkout's thing [thing]\nKept back, this checkout's way:\n- Cob: The boots are Prout's.",
    "## A new part\nThis checkout's.",
  ].join("\n\n");
  const spliced = splicedNote(recorded, made, d => d.replace("The round's ending.", "Made again."));
  assert.equal(spliced, [
    "Co-GM note, before turn 4\n\nCharacter role for Cob:\nConversation role: The round's.",
    "## Where the scene is now: Stones at a hanged man\nThe round's stage.\n\n(The scene has been at this point for 3 exchanges.)",
    "## The world right now\nThe round's world.",
    "## Hidden from the player right now\nBehind the screen.\nOut of the player's sight:\n- a folded page [ledger-page]\nKept back, this checkout's way:\n- Cob: The boots are Prout's.",
    "## A new part\nThis checkout's.",
    "## For this reply\nThe round's directive.\n\nThis reply closes the scene: Made again. Said there already, so not said again: [Kell] “Noted.”",
  ].join("\n\n"));
  assert.deepEqual(partsOf(spliced).map(p => p.slice(0, 12)), ["Co-GM note, ", "## Where the", "## The world", "## Hidden fr", "## A new par", "## For this "]);
});

test("the mouthpiece's request on a round's turn: as the round sent it, and with this checkout's rules and parts, which are the round's own when nothing has changed", () => {
  const scene = clerk;
  const view = mouthpieceView(scene, () => undefined, [], "7", 1, { player: { name: "Nim", concept: "a halfling cutpurse" }, entries: [{ turn: 0, kind: "narration", text: "A stone clangs off the hoist hook." }, { turn: 1, kind: "player", text: "(I wave.) Morning." }] }, "");
  const note = `Co-GM note, before turn 1\n\nCharacter role for Cob:\nConversation role: Keep the cheek up.\n\n${twoPartNow(scene, view, ["Answer the player."])}`;
  const instructions = `The user's prompt and the round's prep.\n\n${mouthpieceRules(scene, view).replace("## How to reply", "## How to reply (the round's)")}`;
  const logged: LoggedCall[] = [{ key: key(1, "reply"), operation: "two-part.reply", request: { instructions, input: [{ role: "system", content: note }, { role: "user", content: "(I wave.) Morning." }] } }];
  const game = { player: { name: "Nim", concept: "a halfling cutpurse" }, entries: [{ turn: 0, kind: "narration", text: "A stone clangs off the hoist hook." }, { turn: 1, kind: "player", text: "(I wave.) Morning." }] };
  const before = mouthpieceRequest(scene, () => undefined, logged, "7", 1, game, "before");
  assert.equal(before.instructions, instructions);
  assert.equal(before.input[0]!.content, note);
  const after = mouthpieceRequest(scene, () => undefined, logged, "7", 1, game, "after");
  assert.equal(after.instructions, `The user's prompt and the round's prep.\n\n${mouthpieceRules(scene, view)}`, "this checkout's rules after the user's prompt");
  assert.equal(after.input[0]!.content, note, "every part as the round had it, since nothing in this checkout makes it differently");
  assert.equal(after.mayHold, false);
  assert.throws(() => mouthpieceRequest(scene, () => undefined, logged, "7", 2, game, "after"), /no mouthpiece call on turn 2/);
});
