import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveScene } from "../../shared/scene/graph.ts";
import { loadScene } from "../../shared/scene/load.ts";
import { CAMPAIGNS } from "./paths.ts";
import { mouthpieceRules, replySchema, twoPartNow } from "../../ai/gm/two-part.ts";
import type { TurnView } from "../../ai/gm/view.ts";
import { initialGm } from "../../shared/gm/state.ts";
import { afterReply, asOpen, checkOf, mouthpieceRequest, mouthpieceView, movedAgain, partsOf, probeTurn, replyOf, rolesAfter, roundSchema, splicedNote, stateBefore, storyOf, swapped, transcriptOf, wasTaken, type LoggedCall } from "./probe.ts";

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

test("a move the co-GM's answer held (a second look) or refused isn't rebuilt, nor one on a route left out (--drop)", () => {
  const log: LoggedCall[] = [
    { key: key(1, "settle"), operation: "two-part.co-gm", request: { input: [{ role: "user", content: input(1) }] }, calls: [move("find-murder", "Not taken yet: look again."), move("find-motive")] },
    { key: key(2, "settle"), operation: "two-part.co-gm", request: { input: [{ role: "user", content: input(2) }] }, calls: [move("find-murder")] },
  ];
  assert.deepEqual(stateBefore(clerk, log, "7", 3).reached, ["start", "motive", "murder"], "the held move on turn 1 isn't taken; the one on turn 2 is");
  assert.deepEqual(stateBefore(clerk, log, "7", 3, [], ["find-murder"]).reached, ["start", "motive"]);
  assert.deepEqual([wasTaken("Reached \"x\""), wasTaken("error: no"), wasTaken("Not taken yet: [cast-off] ends the scene badly")], [true, false, false]);
});

test("a reply asked again: the per-turn note's routes as the rebuilt bookkeeping has them and a closing's directive left out; then the co-GM asked about it with the turn before's transcript and roles, the player's line and the new reply after them", async () => {
  const note = "## Where the scene is now: Stones at a hanged man\nThe yard.\n\n## What moves the scene on from here\n- (nothing: the scene is closing)\n\n## The world right now\nThe yard as it is.\n\n## For this reply\nThis reply closes the scene: the cart goes.";
  const open = asOpen(clerk, note, initialGm(clerk), true);
  assert.match(open, /## What moves the scene on from here\n- \[find-murder\] from Stones at a hanged man \[start\][^\n]*\n- \[find-motive\][\s\S]*\n\n## The world right now\nThe yard as it is\.$/, "the routes open, the world kept, the closing gone");
  assert.match(asOpen(clerk, note, initialGm(clerk), false), /## For this reply\nThis reply closes the scene/, "a reply's directives are its own");

  const before = `# The scene so far\n\nGM: The yard.\n\nNim (player): Hello.\n\nGM: Kell nods.\n\n# Where the scene is: Stones at a hanged man [start]\nReached so far: [start].\n\n# Current character roles\n\nCharacter role for Cob:\nConversation role: Cheek.\n\nCharacter role for Sergeant Agnes Kell:\nConversation role: Watches.\n\n# Who's on stage now\n- Cob [cob]`;
  const prior: LoggedCall = { key: key(4, "settle"), operation: "two-part.co-gm", request: { input: [{ role: "user", content: before }] }, calls: [{ name: "update_character_role", args: { char_id: "kell", status: "By the hoist", mental_state: "Patient", conversation_role: "Names the big man." }, result: "ok" }, { name: "update_character_role", args: { char_id: "moll", status: "", mental_state: "", conversation_role: "Says nothing." }, result: "ok" }] };
  const closing: LoggedCall = { key: key(5, "reply"), operation: "two-part.closing", request: { instructions: "Prompt.\n\n# Your prep for this scene: The Hanged Clerk\n\n## What happened just before this scene\nThe round's own story so far.\n\n## Where it starts: Stones at a hanged man [start]\nAnd so on.", input: [{ role: "system", content: note }, { role: "user", content: "(I look up) Who was the big one?" }] } };
  const roles = rolesAfter(clerk, before, prior.calls!);
  assert.equal(roles, "Character role for Cob:\nConversation role: Cheek.\n\nCharacter role for Sergeant Agnes Kell:\nStatus: By the hoist\nMental state: Patient\nConversation role: Names the big man.\n\nCharacter role for Moll:\nConversation role: Says nothing.");
  const after = afterReply(clerk, prior, "Nim", closing, { narration: "Kell writes. “Big Hobb Mallory.”", costUsd: 0 });
  assert.equal(transcriptOf(after), "GM: The yard.\n\nNim (player): Hello.\n\nGM: Kell nods.\n\nNim (player): (I look up) Who was the big one?\n\nGM: Kell writes. “Big Hobb Mallory.”");

  const sent: Array<{ instructions: string; input: Array<{ role?: string; content?: string }>; text?: { format?: { schema?: { required?: string[] } } } }> = [];
  const model = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body)) as (typeof sent)[number];
    sent.push(body);
    if (body.text?.format) return new Response(`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ narration: "[Sergeant Agnes Kell] “Big Hobb Mallory,” Kell says.", check: null }) }] }], usage: { cost: 0.001 } } })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }], usage: { cost: 0 } });
  }) as typeof fetch;
  const log = [...calls.slice(0, 2), prior, closing];
  const tried = await probeTurn(clerk, log, "7", 5, { player: { name: "Nim", concept: "a halfling cutpurse" } }, { fetch: model, apiKey: "test" }, { reply: true });
  assert.equal(tried.error, undefined);
  assert.equal(tried.replied?.narration, "“Big Hobb Mallory,” Kell says.", "the speakers' tags out, as the transcript keeps it");
  const [asked, coGmAsked] = sent;
  assert.deepEqual(asked!.text?.format?.schema?.required, ["check", "narration", "outcomes"], "a reply in this checkout's format, which its instructions ask for, and not a closing that may wait");
  assert.doesNotMatch(String(asked!.input.at(-2)?.content), /## For this reply/);
  assert.match(String(asked!.input.at(-2)?.content), /- \[find-motive\]/);
  const said = String(coGmAsked!.input[0]!.content);
  assert.match(said, /\n\nNim \(player\): \(I look up\) Who was the big one\?\n\nGM: “Big Hobb Mallory,” Kell says\.\n\n# Where the scene is: Stones at a hanged man \[start\]\nIt's turn 5:/);
  assert.match(said, /Character role for Sergeant Agnes Kell:\nStatus: By the hoist\nMental state: Patient\nConversation role: Names the big man\./);
});

test("a lead's name owed in the rebuilt bookkeeping (--owe, QA round qa3-1018's fixes): the reply asked again is told who names him, after the round's own directives; the co-GM, asked about that reply, takes the lead once the name is said", async () => {
  const note = "## Where the scene is now: Stones at a hanged man\nThe yard.\n\n## What moves the scene on from here\n- (nothing)\n\n## For this reply\nThe round's own directive.";
  assert.match(asOpen(clerk, note, initialGm(clerk), false, ["Mine."]), /\n\n## For this reply\nThe round's own directive\.\n\nMine\.$/, "after the round's");
  assert.match(asOpen(clerk, note, initialGm(clerk), true, ["Mine."]), /\n\n## For this reply\nMine\.$/, "a closing's left out, ours kept");

  const scenes = readdirSync(join(CAMPAIGNS, "caerwyn", "scenes")).filter(f => f.endsWith(".kmscene")).map(f => effectiveScene(loadScene(readFileSync(join(CAMPAIGNS, "caerwyn", "scenes", f), "utf8")), []));
  const before = "# The scene so far\n\nGM: The yard.\n\nNim (player): Who else was here?\n\nGM: “The big one was like a door, with a bandage on his right hand.”\n\n# Where the scene is: Stones at a hanged man [start]\nReached so far: [start].\n\n# Current character roles\n\nCharacter role for Sergeant Agnes Kell:\nConversation role: If asked, names him.\n\n# Who's on stage now\n- Sergeant Agnes Kell [kell]";
  const prior: LoggedCall = { key: key(4, "settle"), operation: "two-part.co-gm", request: { input: [{ role: "user", content: before }] }, calls: [] };
  const reply: LoggedCall = { key: key(5, "reply"), operation: "two-part.reply", request: { instructions: "Prompt.\n\n# Your prep for this scene: The Hanged Clerk\n\n## Where it starts: Stones at a hanged man [start]\nAnd so on.", input: [{ role: "system", content: "## Where the scene is now: Stones at a hanged man\nThe yard.\n\n## What moves the scene on from here\n- (nothing)" }, { role: "user", content: "Sergeant?" }] } };
  const sent: Array<{ input: Array<{ role?: string; content?: string; type?: string }>; text?: { format?: unknown } }> = [];
  const model = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body)) as (typeof sent)[number];
    sent.push(body);
    if (body.text?.format) return new Response(`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ narration: "[Sergeant Agnes Kell] “Big Hobb Mallory. Champion at the Drowned Rat.”", check: null }) }] }], usage: { cost: 0.001 } } })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
    if (body.input.some(i => i.type === "function_call_output")) return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }], usage: { cost: 0 } });
    return Response.json({ status: "completed", output: [{ type: "function_call", call_id: "c1", name: "move_scene", arguments: JSON.stringify({ route_id: "find-hobb", outcome: "none", why: "Kell named the big man from the description: Big Hobb Mallory of the Drowned Rat." }) }], usage: { cost: 0 } });
  }) as typeof fetch;
  const tried = await probeTurn(clerk, [prior, reply], "7", 5, { player: { name: "Nim", concept: "a halfling cutpurse" }, story: storyOf("caerwyn", scenes) }, { fetch: model, apiKey: "test" }, { reply: true, owe: ["hobb"] });
  assert.equal(tried.error, undefined);
  assert.match(String(sent[0]!.input.at(-2)?.content), /\n\n## For this reply\nSergeant Agnes Kell names him now: Big Hobb Mallory\. /, "the reply asked again is told");
  assert.deepEqual([tried.reached, tried.owed], [["hobb"], []], "said in the reply, so taken");
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

// --- QA round qa3-1018's fixes

test("a round's request asked in the schema its instructions were written for: the one before QA round qa3-1018's fixes for its format with two fields, this checkout's otherwise; and its reply read in either", () => {
  const round = "Prompt and prep.\n\n## How to reply\nReply as JSON with two fields.\n- `narration`: what you say.";
  assert.deepEqual(Object.keys((roundSchema(round, false) as { properties: object }).properties), ["narration", "check"]);
  assert.deepEqual((roundSchema(round, true) as { required: string[] }).required, ["narration", "check", "closes"]);
  assert.deepEqual(roundSchema("Prompt.\n\n## How to reply\nReply as JSON with two fields.\n- `narration`: what you say.\n- `check`: always null. Nothing in a talk is decided by dice.", false), replySchema(false, false), "a talk's, then and now");
  assert.deepEqual(roundSchema(`Prompt.\n\n${mouthpieceRules(clerk, mouthpieceView(clerk, () => undefined, [], "7", 1, { player: { name: "Nim", concept: "a halfling cutpurse" }, entries: [] }, ""))}`, false), replySchema(false));
  const outcomes = { major_failure: "a", minor_failure: "b", barely_passed: "c", minor_success: "d", major_success: "e" };
  assert.deepEqual(replyOf(JSON.stringify({ narration: "You push.", check: { skill: "athletics", dc: 13, outcomes } })), { narration: "You push.", check: { skill: "athletics", dc: 13, outcomes } });
  assert.deepEqual(replyOf(JSON.stringify({ check: { skill: "athletics", dc: 13 }, narration: "You push.", outcomes, closes: false })), { narration: "You push.", check: { skill: "athletics", dc: 13, outcomes }, closes: false });
  assert.deepEqual(replyOf(JSON.stringify({ check: null, narration: "Kell nods.", outcomes: null })), { narration: "Kell nods." });
});

test("the mouthpiece probe's after: a move to show as this checkout writes it, in place of the round's", () => {
  const cart = { ...mouthpieceView(clerk, () => undefined, [], "7", 9, { player: { name: "Nim", concept: "a halfling cutpurse" }, entries: [] }, ""), reached: ["start", "cart-arrives"], beat: "cart-arrives" } as TurnView;
  const directives = "The rules' directive.\n\nThe scene has just moved on to \"The dead-cart arrives\": Tull comes. Answer the player's turn first; then let it show in this reply: the corporal arrives now, seen arriving. If an earlier reply has already played it, it has happened: go on from it, and don't play it again.";
  const again = movedAgain(clerk, cart)(directives);
  assert.ok(again.startsWith("The rules' directive.\n\nThe scene has just moved on to \"The dead-cart arrives\": Corporal Tull arrives"));
  assert.match(again, /This reply gives it a beat of its own, and ends on it[\s\S]*don't play it again\.$/);
  assert.doesNotMatch(again, /Answer the player's turn first; then let it show/);
  assert.equal(movedAgain(clerk, cart)("The rules' directive."), "The rules' directive.", "no move to show, nothing made again");
});

test("the mouthpiece probe's view: the player where the round's world had them, for what's in their reach there", () => {
  const game = { player: { name: "Nim", concept: "a halfling cutpurse" }, entries: [] };
  // The clerk with its place, as the campaign installs it.
  const placed = { ...clerk, world: JSON.parse(readFileSync(join(CAMPAIGNS, "caerwyn", "places", "granary-yard.json"), "utf8")) } as typeof clerk;
  const note = "## The world right now\nThe yard behind the King's Granary: the player is in the tally loft (above the yard, inside the granary).\nThe player carries: nothing.";
  const view = mouthpieceView(placed, () => undefined, [], "7", 9, game, note);
  assert.equal(view.world!.entities.player!.parent, "loft");
  assert.match(twoPartNow(placed, view, []), /## In the player's reach here\nThe player is in the tally loft/);
  assert.notEqual(mouthpieceView(placed, () => undefined, [], "7", 9, game, "").world!.entities.player!.parent, "loft", "where the place starts them, with no world in the note");
});
