import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rolesNote } from "../../shared/gm/two-part.ts";
import type { GmState } from "../../shared/gm/state.ts";
import { openRoutes, takeRoute } from "../../shared/scene/beats.ts";
import { effectiveScene } from "../../shared/scene/graph.ts";
import { loadScene } from "../../shared/scene/load.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { fakeFetch, readPrep, walkTo, type FakeOptions } from "../llm/fake-openrouter.ts";
import type { CallContext } from "../llm/openrouter.ts";
import { CAERWYN, viewAt } from "./fixtures.ts";
import { closingDirective, coGm, coGmInput, coGmInstructions, mouthpieceInput, mouthpieceInstructions, movedDirective, narrationSoFar, prepOf, pressureOffered, routeLine, speak, twoPartNow } from "./two-part.ts";
import type { TurnView } from "./view.ts";

/**
 * The two-part GM's AI side (docs/two-part-design.md): PR #666's two-part.test.ts, its tests of the
 * mouthpiece's input and the move shown, on the campaign's hanged clerk in the scene format; then the
 * prep as the design orders it, the per-turn note, the narration read as it streams, the mouthpiece
 * and the co-GM on the fake model, and the fake co-GM's walk through every scene of the campaign.
 */

const sceneFile = (id: string): Scene => effectiveScene(loadScene(readFileSync(join(CAERWYN, "scenes", `${id}.kmscene`), "utf8")), []);
const clerk = sceneFile("hanged-clerk");
const STORY = ["hanged-clerk", "drowned-rat", "heron-warehouse", "kings-morning"];

/** The fake model as a request's calls. */
const fake = (options: FakeOptions = {}): CallContext & { asked: string[] } => {
  const f = fakeFetch(options);
  return { fetch: f.fetch, apiKey: "fake", asked: f.asked };
};

/** The clerk's view at its start, a turn in, with the roles as it opened (note -1). */
function yard(extra: Partial<TurnView> = {}): TurnView {
  const view = viewAt(clerk, clerk.start, { turn: 0, turnsInBeat: 0, ...extra });
  view.twoPart = { roles: { cob: { status: "Throwing stones", mental_state: "", conversation_role: "Cheek and dares." } }, notes: [] };
  return view;
}

test("each co-GM note reaches the mouthpiece before the player turn it was written for, the latest with the world as it stands", () => {
  const view = yard();
  view.twoPart.notes.push({ turn: -1, text: rolesNote(clerk, view.twoPart.roles, -1) });
  view.transcript.push({ turn: 0, scene: "hanged-clerk", speaker: "gm", kind: "narration", text: "A stone clangs off the hoist hook." });
  view.twoPart.notes.push({ turn: 0, text: "Co-GM note, before turn 1\n\nCharacter role for Cob:\nConversation role: Goes quiet." });
  view.turn = 1;
  view.transcript.push({ turn: 1, scene: "hanged-clerk", speaker: "player", kind: "player", text: "Who found him?" });
  const input = mouthpieceInput(clerk, view, []);
  assert.deepEqual(input.map(m => m.role), ["system", "user", "assistant", "system", "user"]);
  assert.match(input[0]!.content, /Co-GM note, before turn 0[\s\S]*Cheek and dares/);
  assert.equal(input[1]!.content, "(The player is ready. Begin.)");
  assert.equal(input[2]!.content, "A stone clangs off the hoist hook.");
  assert.match(input[3]!.content, /Goes quiet[\s\S]*## Where the scene is now: Stones at a hanged man/);
  assert.doesNotMatch(input[0]!.content, /Where the scene is now/, "only the latest note carries the per-turn note");
  assert.equal(input[4]!.content, "Who found him?");
});

test("the GM's earlier replies are as the player read them: the dice line and the outcome after the narration, the speakers tagged as the GM writes them", () => {
  const view = yard({ turn: 2 });
  view.transcript.push(
    { turn: 1, scene: "hanged-clerk", speaker: "player", kind: "player", text: "(I look at his neck)" },
    { turn: 1, scene: "hanged-clerk", speaker: "gm", kind: "narration", text: "You step closer. “Careful,” Kell says.", marked: { speech: [{ start: 17, end: 27, speaker: "kell" }] } },
    { turn: 1, scene: "hanged-clerk", speaker: "dice", kind: "roll", text: "Medicine check: 14 + 3 = 17 vs DC 12: success (cleanly)." },
    { turn: 1, scene: "hanged-clerk", speaker: "gm", kind: "narration", text: "A thin cord mark crosses his throat." },
    { turn: 2, scene: "hanged-clerk", speaker: "player", kind: "player", text: "Murder, then." },
  );
  const input = mouthpieceInput(clerk, view, []);
  const answered = input.filter(m => m.role === "assistant").at(-1)!.content;
  assert.equal(answered, "You step closer. [Sergeant Agnes Kell] “Careful,” Kell says.\n\n🎲 Medicine check: 14 + 3 = 17 vs DC 12: success (cleanly).\n\nA thin cord mark crosses his throat.");
});

test("once the co-GM has moved the scene on, the next reply shows it, with whoever it brings on seen arriving", () => {
  const view = yard({ reached: ["start", "cart-arrives"], beat: "cart-arrives" });
  assert.equal(movedDirective(clerk, view), undefined, "nothing to show until the co-GM has moved it");
  view.twoPart.moved = "cart-arrives";
  assert.match(movedDirective(clerk, view)!, /moved on to "The dead-cart arrives"[\s\S]*the corporal with the dead-cart's order arrives now, seen arriving|moved on to "The dead-cart arrives"[\s\S]*arrives now, seen arriving/);
  assert.match(movedDirective(clerk, view)!, /seen arriving\. If an earlier reply has already played it, it has happened: go on from it, and don't play it again\.$/, "a move the story had already played (Arlo's third challenge, qa1-1018 g08) isn't played twice");
});

test("the prep in the design's order: the scene (its truth and clock, what locals know, the player), where it starts, the discoveries with their paths, the events, the endings; never the people, the old endings or the table rules", () => {
  const prep = prepOf(clerk, yard());
  const at = (heading: string) => { const i = prep.indexOf(heading); assert.ok(i >= 0, `the prep has ${heading}`); return i; };
  const order = ["## The place", "## What this scene is about", "## What really happened", "## The clock", "## What this scene can't offer", "## The player character", "## Where it starts: Stones at a hanged man [start]", "## The discoveries", "## The events", "## The endings"].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  for (const gone of ["## The people here", "## Ways this scene can end", "## What the player needs to come across", "## Table rules"]) assert.ok(!prep.includes(gone), `not ${gone}`);
  assert.match(prep, /### Hobb was spotted at the scene \[hobb\] \(required: the scene can't end well without it\)\nThe revelation: A huge man with a bandaged right hand/);
  assert.match(prep, /- Via the body \(strong\): Up close: a thin cord mark[\s\S]*?A check that suits it: Medicine DC 12\./);
  assert.match(prep, /### The dead-cart arrives \[cart-arrives\][\s\S]*If it stalls here: Tull's constables[\s\S]*Who arrives: Corporal Abner Tull \[tull\]\nRoutes into it:\n- \[cart-comes\] from Stones at a hanged man \[start\] to The dead-cart arrives \[cart-arrives\]; a cue: bring it about when its moment comes\. When: /);
  assert.match(prep, /### Murder by persons unknown \[murder-unknown\]: a good ending\nWhat's true: Kell signs Prout in[\s\S]*- \[signed-murder\] from The dead-cart arrives \[cart-arrives\] to Murder by persons unknown \[murder-unknown\], once The victim was murdered \[murder\] and Hobb was spotted at the scene \[hobb\] are reached\. When: /);
  assert.ok(!prep.includes("Suggested roles while the scene is here"), "the mouthpiece's has no suggested roles: the co-GM's note carries them");
  assert.match(prepOf(clerk, yard(), { coGm: true }), /### The dead-cart arrives[\s\S]*Suggested roles while the scene is here:\n- Corporal Abner Tull \[tull\]: Helmet off/);
});

test("the people: each card with why they're here and what never works on them; the co-GM's with their role palette and the clues that are theirs", () => {
  const mouthpiece = mouthpieceInstructions(clerk, yard());
  assert.match(mouthpiece, /### Cob\n- Look: [\s\S]*?- Why they're here, now: /);
  assert.match(mouthpiece, /\n\n## How to reply\nReply as JSON with two fields\.[\s\S]*\n\n## Who says each line\nPut the speaker in square brackets before every spoken line, each time they speak: \[Kell\] “Out\.” She turns to the boy\./);
  assert.ok(mouthpiece.startsWith("You are the Game Master of a fantasy roleplaying game, running a live scene for one player."), "the user's prompt first, as written");
  const co = coGmInstructions(clerk, yard());
  assert.match(co, /### Cob\n[\s\S]*?- The clues that are theirs to give:\n  - Towards The victim was murdered \[murder\]: Cob sleeps in the loft\./);
  assert.match(co, /\n\n## Your tools\n- update_character_role: /);
  assert.ok(co.startsWith("You help the Game Master of a fantasy role-playing game"), "the user's co-GM prompt first, as written");
});

test("the per-turn note: the stage, the routes open now with a dice route's check to call as it says, the pressure offered once, two exchanges in", () => {
  const heron = sceneFile("heron-warehouse");
  const at = viewAt(heron, heron.start, { turn: 3, turnsInBeat: 0 });
  delete at.world;
  const note = twoPartNow(heron, at, ["Do the thing."]);
  assert.match(note, /^## Where the scene is now: The Heron by night\n/);
  assert.match(note, /- \[sneak-in\] from The Heron by night \[wharf\] to On the floor \[floor\]; the dice decide \(Stealth DC 13\): a success takes it, a failure leaves the scene where it is\. When: /);
  assert.match(note, /When the player attempts what a route the dice decide describes, call that route's check: its skill and DC\./);
  assert.match(note, /## For this reply\nDo the thing\.$/);

  const clerkNow = (turnsInBeat: number, offered: string[] = []) => twoPartNow(clerk, yard({ reached: ["start", "cart-arrives"], beat: "cart-arrives", turnsInBeat, pressureOffered: offered }), []);
  assert.ok(!clerkNow(1).includes("sitting here a while"), "not yet");
  assert.ok(clerkNow(2).includes("If it's stalling or drifting, the world can push: Tull's constables start getting Prout down"));
  assert.equal(pressureOffered(clerk, yard({ reached: ["start", "cart-arrives"], beat: "cart-arrives", turnsInBeat: 2 })), "cart-arrives", "the reply says it offered it, for the simulation to mark");
  assert.ok(!clerkNow(3, ["cart-arrives"]).includes("sitting here a while"), "once offered, never again");
});

test("a route into a discovery is taken once its revelation has landed: the co-GM's open routes say what the revelation is, the mouthpiece's note leaves it to the prep", () => {
  const find = clerk.routes.find(r => r.id === "find-murder")!;
  assert.equal(routeLine(clerk, find), "- [find-murder] from Stones at a hanged man [start] to The victim was murdered [murder]. When: its revelation has landed with the player");
  assert.match(routeLine(clerk, find, { revelation: true }), /When: its revelation has landed with the player \(Prout didn't hang himself: he was struck and strangled, then hoisted up on the sack hoist to look like a suicide\.\)$/);
  assert.doesNotMatch(twoPartNow(clerk, yard(), []), /struck and strangled/);
});

test("the co-GM's input counts the turns: the scene's turn, the turn each node was reached on, and how far each open cue's outer limit has run, overdue once the next reply reaches it; the mouthpiece's note has none of it", () => {
  const rat = sceneFile("drowned-rat");
  const view = viewAt(rat, rat.start, { turn: 0, turnsInBeat: 0 });
  delete view.world;
  let gm = { ...view } as unknown as GmState;
  for (const [turn, route] of [[6, "arlo-calls-him-out"], [9, "find-the-heron"]] as const) {
    const taken = takeRoute(rat, gm, route, "none", turn);
    if ("error" in taken) assert.fail(taken.error);
    gm = taken.gm;
  }
  const at = (turn: number) => ({ ...view, ...gm, turn, turnsInBeat: turn - 7 }) as unknown as TurnView;
  const input = (turn: number) => coGmInput(rat, at(turn), undefined)[0]!.content;
  assert.match(input(13), /^# Where the scene is: Arlo's third challenge \[arlos-challenge\]\nIt's turn 13: the scene has had 13 exchanges since the opening \(turn 0\), and it has been at this stage for 6 of them\. Reached so far: \[start\] \(at the opening\), \[arlos-challenge\] \(on turn 6\), \[the-heron\] \(on turn 9\)\.$/m);
  const bell = (turn: number) => input(turn).split("\n").find(l => l.startsWith("- [bell-rings]"))!;
  assert.match(bell(13), /it rings then, whatever is happening\. Not needed once Hobb has fled\. Its outer limit, whichever runs out first: 15 exchanges into the scene \(the next reply is the 14th\), or 8 after Arlo's third challenge \[arlos-challenge\] \(reached on turn 6: the next reply is the 7th after it\)\.$/);
  assert.match(bell(14), /\(reached on turn 6: the next reply is the 8th after it\)\. Overdue: bring it about now\.$/, "eight after Arlo's challenge: it rings in the next reply");
  const fresh = coGmInput(rat, { ...view, turn: 3 } as TurnView, undefined)[0]!.content.split("\n").find(l => l.startsWith("- [bell-rings]"))!;
  assert.match(fresh, /or 8 after Arlo's third challenge \[arlos-challenge\] \(not reached yet\)\.$/);
  const talking = takeRoute(rat, { ...view } as unknown as GmState, "hobb-breaks", "none", 3);
  if ("error" in talking) assert.fail(talking.error);
  const arlo = coGmInput(rat, { ...view, ...talking.gm, turn: 9 } as unknown as TurnView, undefined)[0]!.content.split("\n").find(l => l.startsWith("- [arlo-calls-him-out]"))!;
  assert.match(arlo, /Its outer limit, whichever runs out first: 6 exchanges into the scene \(stopped: I only held the rope \[hobb-talking\] is reached\)\.$/, "not once Hobb is talking: past its six, and not overdue");
  const note = twoPartNow(rat, at(14), []);
  assert.match(note, /- \[bell-rings\] [^\n]*it rings then, whatever is happening\. Not needed once Hobb has fled\.\n/, "the mouthpiece's route line is as it was");
  assert.doesNotMatch(note, /Its outer limit, whichever|Overdue|on turn 6/);
});

test("an open route into an ending says how it went and what's true there, for the co-GM; the mouthpiece's note and the prep keep the line as it was", () => {
  const view = yard({ reached: ["start", "murder", "hobb", "cart-arrives"], beat: "cart-arrives", turn: 14 });
  const lines = coGmInput(clerk, view, undefined)[0]!.content.split("\n");
  const signed = clerk.routes.find(r => r.id === "signed-murder")!;
  assert.equal(lines.find(l => l.startsWith("- [signed-murder]")), `${routeLine(clerk, signed)} It's a good ending. What's true there: ${clerk.exits.find(e => e.id === "murder-unknown")!.outcome}`);
  assert.match(lines.find(l => l.startsWith("- [signed-suicide]"))!, /\. It's a mixed ending\. What's true there: The player has the Hobb lead but couldn't show murder/);
  assert.match(lines.find(l => l.startsWith("- [case-lost]"))!, /\. It's a bad ending\. What's true there: The player failed/);
  assert.doesNotMatch(twoPartNow(clerk, view, []), /What's true there/);
  assert.doesNotMatch(prepOf(clerk, view, { coGm: true }), /It's a good ending/, "the prep has the endings under their own headings");
});

test("the co-GM's tools: a route only as its condition is written, the player's own act for a condition about it; no move for what hasn't happened; the ending the player achieved; an overdue cue brought about; roles as behaviour, moved past what has happened", () => {
  const tools = coGmInstructions(clerk, yard()).split("## Your tools\n")[1]!;
  for (const line of [
    "Take a route only when its condition has happened in the story as written, all of it. A condition about what the player does (makes the case, goes after someone, leaves) needs the player to have done it",
    "Never call move_scene to record that something hasn't happened",
    "When more than one open route fits, take the one whose ending matches what the player achieved.",
    "An overdue cue is brought about: take its route now, unless its condition says it's no longer needed.",
    "Write a role as behaviour the GM can show",
    "move everyone's role past it: nobody's role still has it to do",
    "A cue is brought about by taking its route",
  ]) assert.ok(tools.includes(line), line);
  assert.ok(tools.trimEnd().endsWith('Then reply "done".'));
});

test("the narration is read as the reply streams: its escapes undone, an escape cut off part-way held back, nothing before it starts", () => {
  assert.equal(narrationSoFar(""), undefined);
  assert.equal(narrationSoFar("{\"narr"), undefined);
  assert.equal(narrationSoFar("{\"narration\":\""), "");
  assert.equal(narrationSoFar("{\"narration\":\"Kell looks up. [Kell] “Out.”\\n\\nThe boy"), "Kell looks up. [Kell] “Out.”\n\nThe boy");
  assert.equal(narrationSoFar("{\"narration\":\"A \\\"quote\\\" and a \\u00e9"), "A \"quote\" and a é");
  assert.equal(narrationSoFar("{\"narration\":\"Half an escape \\"), "Half an escape ");
  assert.equal(narrationSoFar("{\"narration\":\"Half a code \\u00"), "Half a code ");
  assert.equal(narrationSoFar("{\"narration\":\"Done.\",\"check\":null}"), "Done.");
});

test("the mouthpiece on the fake: its narration streamed as it grows with who says each line, and a check's five outcomes as the screen has them", async () => {
  const shown: Array<{ text: string; speakers: string[] }> = [];
  const view = yard({ turn: 1 });
  view.transcript.push({ turn: 1, scene: "hanged-clerk", speaker: "player", kind: "player", text: "(I look at his neck)" });
  const reply = "Kell steps closer. [Sergeant Kell] “Careful.” The rope creaks.";
  const spoke = await speak(clerk, view, [], {
    operation: "two-part.reply", calls: fake({ replies: [reply], streamMs: 40, mouthpiece: { check: { skill: "medicine", dc: 12 } } }), byKey: m => m,
    onText: (text, markup) => shown.push({ text, speakers: (markup?.speech ?? []).map(s => s.speaker ?? "?") }),
  });
  assert.equal(spoke.narration.text, "Kell steps closer. “Careful.” The rope creaks.");
  assert.deepEqual(spoke.narration.markup?.speech.map(s => s.speaker), ["kell"]);
  assert.ok(shown.length >= 3, `the narration streamed in ${shown.length} posts`);
  assert.ok(shown.every((s, i) => i === 0 || s.text.startsWith(shown[i - 1]!.text.slice(0, -1))), "each post grows the last");
  assert.equal(shown.at(-1)!.text, spoke.narration.text);
  assert.deepEqual(shown.at(-1)!.speakers, ["kell"]);
  assert.equal(spoke.check?.skill, "medicine");
  assert.equal(spoke.check?.dc, 12);
  assert.deepEqual(Object.keys(spoke.check!.outcomes), ["major_failure", "minor_failure", "barely_passed", "minor_success", "major_success"]);
  assert.equal(spoke.closes, true);

  const opening = await speak(clerk, yard(), [], { operation: "two-part.opening", calls: fake({ replies: [reply], mouthpiece: { check: { skill: "medicine", dc: 12 } } }), byKey: m => m });
  assert.equal(opening.check, undefined, "the fake calls no check on an opening");
  const held = await speak(clerk, view, [closingDirective(clerk.exits[0]!, true)], { operation: "two-part.closing", calls: fake({ replies: [reply], mouthpiece: { holds: true } }), byKey: m => m, mayHold: true });
  assert.equal(held.closes, false, "a closing that may wait says whether it closed");
});

test("the closing: it may wait once for something the ending has to answer; a fight's ends on the moment it breaks out", () => {
  const caught = clerk.exits.find(e => e.id === "murder-unknown")!;
  assert.match(closingDirective(caught, true), /^The scene is ending: Kell signs Prout in[\s\S]*set `closes` to false[\s\S]*Otherwise bring the scene to a close[\s\S]*set `closes` to true\.$/);
  assert.match(closingDirective(caught, false), /^This reply closes the scene: Kell signs Prout in[\s\S]*Then bring the scene to a close/);
  const fight = sceneFile("heron-warehouse").exits.find(e => e.id === "fight")!;
  assert.match(closingDirective(fight, false), /A fight starts here and is played out blow by blow on the map/);
});

test("the co-GM on the fake: a move answered at once on a copy of the bookkeeping, and the roles it set; a still one moves nothing", async () => {
  const view = yard({ turn: 1 });
  const gm = { ...view } as unknown as GmState;
  const roles = { cob: { status: "On the water butt", mental_state: "Wary", conversation_role: "Could show the loose board." } };
  const answer = await coGm(clerk, view, gm, undefined, fake({ coGm: { roles } }));
  assert.deepEqual(answer.moves, [{ route: "find-hobb", outcome: "none", why: "The fake co-GM's walk to murder-unknown." }], "the required discovery first");
  assert.deepEqual(answer.roles, roles);
  assert.deepEqual(answer.log.map(c => [c.name, c.result.split(":")[0]]), [["update_character_role", "ok"], ["move_scene", "Reached \"Hobb was spotted at the scene\""]]);
  assert.deepEqual(view.reached, ["start"], "the view is as it was: the simulation takes the moves");

  const still = await coGm(clerk, view, gm, undefined, fake({ coGm: { still: true } }));
  assert.deepEqual([still.moves, still.roles, still.log], [[], {}, []]);
});

test("the fake co-GM reads every route off the prep as routeLine wrote it, and walks every scene of the story to its first good ending, a route a turn", async () => {
  for (const id of STORY) {
    const scene = sceneFile(id);
    const view = viewAt(scene, scene.start, { turn: 1, turnsInBeat: 0 });
    delete view.world;
    const prep = readPrep(coGmInstructions(scene, view));
    assert.deepEqual(prep.routes.map(r => [r.id, r.source, r.target, r.requires.join("+"), r.dice]).sort(), scene.routes.map(r => [r.id, r.source, r.target, (r.requires ?? []).join("+"), !!r.skill]).sort(), `${id}: every route, read back`);
    const first = scene.exits.find(e => e.result === "good")!;
    assert.equal(prep.endings.find(e => e.result === "good")?.id, first.id);

    let gm = { ...view } as unknown as GmState;
    const walked: string[] = [];
    for (let turn = 1; turn <= 10 && !gm.closing; turn++) {
      const answer = await coGm(scene, { ...view, ...gm, turn } as unknown as TurnView, gm, undefined, fake());
      assert.equal(answer.moves.length, 1, `${id}: a move a turn (turn ${turn}, at ${gm.reached.join(", ")})`);
      const taken = takeRoute(scene, gm, answer.moves[0]!.route, answer.moves[0]!.outcome, turn);
      if ("error" in taken) assert.fail(taken.error);
      gm = taken.gm;
      walked.push(answer.moves[0]!.route);
    }
    assert.equal(gm.closing?.exitId, first.id, `${id} walked to ${first.id}: ${walked.join(", ")}`);
    assert.deepEqual(walked, walkTo(prep, [scene.start], first.id), `${id}: the walk, a route at a time`);
    assert.deepEqual(openRoutes(scene, gm), [], "nothing open once it's closing");
  }
});

test("the fake co-GM walks to the first of the recipe's endings the scene has", () => {
  const heron = sceneFile("heron-warehouse");
  const prep = readPrep(coGmInstructions(heron, viewAt(heron, heron.start, { turn: 1 })));
  assert.deepEqual(walkTo(prep, ["wharf"], "fight"), ["took-the-book", "master-comes", "cornered"], "the required discovery, then midnight, then the fight");
  assert.deepEqual(walkTo(prep, ["wharf"], "proof-taken"), ["took-the-book", "away-with-book"]);
});

test("the fake co-GM walks on to the recipe's next ending once a fight is fought (the e2e's Heron: the fight, then caught in the act)", async () => {
  const heron = sceneFile("heron-warehouse");
  const view = viewAt(heron, "midnight", { turn: 5, turnsInBeat: 0 });
  Object.assign(view, { reached: ["wharf", "true-book", "midnight"], beat: "midnight", fought: ["fight"] });
  const gm = { ...view } as unknown as GmState;
  const answer = await coGm(heron, view, gm, undefined, fake({ coGm: { endings: ["murder-unknown", "fight", "caught-in-the-act"] } }));
  assert.deepEqual(answer.moves.map(m => [m.route, m.why]), [["find-kings-grain", "The fake co-GM's walk to caught-in-the-act."]], "the fight's routes are shut once it's fought: on to the next ending, the King's grain it needs first");
  const found = takeRoute(heron, gm, "find-kings-grain", "none", 5);
  if ("error" in found) assert.fail(found.error);
  const next = await coGm(heron, { ...view, ...found.gm, turn: 6 } as unknown as TurnView, found.gm, undefined, fake({ coGm: { endings: ["murder-unknown", "fight", "caught-in-the-act"] } }));
  assert.deepEqual(next.moves.map(m => m.route), ["in-the-act"]);
});
