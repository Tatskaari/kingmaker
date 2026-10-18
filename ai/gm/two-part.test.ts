import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureDocs } from "../docs/config.ts";
import { note } from "../docs/notes.ts";
import { BANDS, rolesNote } from "../../shared/gm/two-part.ts";
import type { GmState } from "../../shared/gm/state.ts";
import { endingNeeds, openRoutes, oweName, takeRoute } from "../../shared/scene/beats.ts";
import { effectiveScene } from "../../shared/scene/graph.ts";
import { loadScene } from "../../shared/scene/load.ts";
import { parseScene } from "../../shared/scene/document.ts";
import { CONFIDED, talkSceneId, TOLD } from "../../shared/scene/talk.ts";
import { talkScene } from "./talk.ts";
import { loadPlace, placePath } from "../../shared/scene/scenario.ts";
import type { Scene } from "../../shared/scene/types.ts";
import { buildWorld } from "../../shared/world/scene-world.ts";
import { fakeFetch, readPrep, walkTo, type FakeOptions } from "../llm/fake-openrouter.ts";
import type { CallContext } from "../llm/openrouter.ts";
import { CAERWYN, viewAt } from "./fixtures.ts";
import { playerNow } from "./brief.ts";
import { clockNote, closingDirective, coGm, coGmInput, coGmInstructions, companionRoles, companionsOf, deniesItself, deniesMoment, deniesTheLead, firstSentence, inReach, intoBad, intoBetter, mouthpieceInput, mouthpieceInstructions, movedDirective, movedText, narrationSoFar, owedDirective, prepOf, pressureOffered, reachNote, replySchema, routeLine, saidLast, saysNothing, setUpEarlier, speak, stillToCome, tellOf, twoPartNow, unsaidIn } from "./two-part.ts";
import type { Story } from "./story.ts";
import type { TurnView } from "./view.ts";

/**
 * The two-part GM's AI side (docs/two-part-design.md): PR #666's two-part.test.ts, its tests of the
 * mouthpiece's input and the move shown, on the campaign's hanged clerk in the scene format; then the
 * prep as the design orders it, the per-turn note, the narration read as it streams, the mouthpiece
 * and the co-GM on the fake model, and the fake co-GM's walk through every scene of the campaign.
 */

/** The campaign's lore, and each game's own copy of it in a folder of the test's (the GM's notes on the people are written there). */
const COPIES = mkdtempSync(join(tmpdir(), "km-two-part-"));
after(() => rmSync(COPIES, { recursive: true, force: true }));
configureDocs({ loreRoot: join(CAERWYN, "lore"), overlay: game => join(COPIES, game) });

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

test("once the co-GM has moved the scene on, the next reply gives it a beat of its own and ends on it, whoever it brings on seen arriving and what the player set up for it played as they set it (QA round qa3-1018)", () => {
  const view = yard({ reached: ["start", "cart-arrives"], beat: "cart-arrives" });
  assert.equal(movedDirective(clerk, view), undefined, "nothing to show until the co-GM has moved it");
  view.twoPart.moved = "cart-arrives";
  const moved = movedDirective(clerk, view)!;
  assert.match(moved, /^The scene has just moved on to "The dead-cart arrives": Corporal Tull arrives with the dead-cart/);
  assert.match(moved, /This reply gives it a beat of its own, and ends on it: answer the player's turn first, briefly, if it needs an answer, then the event in a paragraph of its own, last \(or open on it, when it's the answer\); never folded into the end of something else\./);
  assert.match(moved, /Show it happening: the corporal comes in now, seen arriving even where the player's turn already speaks of them: by which way, how, and the first thing they do\./);
  assert.match(moved, /If the player set something up for this moment \(asked someone to watch for it or warn them, posted a lookout, agreed a signal, laid a trap\), it happens as they set it up, and whoever they asked does it \(a whistle, a knock on the glass, a word at the door\): the warning reaches the player first, while the newcomers are still coming/);
  assert.match(moved, /Then stop, and leave the player to answer it: the rest of what it brings \(what the newcomers came to do, everyone else's answer to it, the rest of the player's own business\) is for the replies after\./);
  assert.match(moved, /If an earlier reply has already played it, it has happened: go on from it, and don't play it again\.$/, "a move the story had already played (Arlo's third challenge, qa1-1018 g08) isn't played twice");
  // What the player set up for it, in their words (g02 at the Heron: Kell posted at turn 2 to warn of the Master, who came at turn 6 with no word from her).
  view.turn = 4;
  view.transcript.push(
    { turn: 2, scene: "hanged-clerk", speaker: "player", kind: "player", text: "(low, to Kell) Stay by the gate and watch the lane. If the corporal comes, I want to know before he's through it. (then, to the boy) Nice boots." },
    { turn: 3, scene: "hanged-clerk", speaker: "player", kind: "player", text: "(I watch the loft door.) I warn you, lad, I'm patient." },
  );
  assert.match(movedDirective(clerk, view)!, /The player set something up earlier: \(turn 2\) "\(low, to Kell\) Stay by the gate and watch the lane\. If the corporal comes, I want to know before he's through it\." If that was for this moment, it happens as they set it up, and whoever they asked does it/);
  assert.deepEqual(setUpEarlier(view), [`(turn 2) "(low, to Kell) Stay by the gate and watch the lane. If the corporal comes, I want to know before he's through it."`], "watching and warning someone off aren't asking to be warned");
});

test("the clock felt moving on, a sign at a time: every third reply while a cue's outer limit runs, and every reply from the one before it runs out; never at the opening, once nothing's running, or on a closing (QA round qa3-1018)", () => {
  const due = (turn: number, extra: Partial<TurnView> = {}) => clockNote(clerk, yard({ turn, ...extra }));
  assert.equal(due(0), undefined, "the opening gives the clock as its start says");
  assert.deepEqual([1, 2, 4, 5, 7, 8, 10].map(t => due(t)), Array(7).fill(undefined));
  assert.match(due(3)!, /^## The clock\nThe dead-cart is due at the noon bell\.[\s\S]*\nShow it moving on in this reply by one sign, the next step of it: in passing \(a clause or a line\), never a sign already shown, and never the moment itself\.$/);
  assert.ok(due(6) && due(9) && due(11) && due(13), "every third, then from the reply before the cart's twelve runs out, overdue or not");
  assert.equal(due(6, { reached: ["start", "cart-arrives"], beat: "cart-arrives" }), undefined, "the cart come, no cue is running");
  assert.equal(due(6, { closing: { exitId: "murder-unknown", turn: 5 } }), undefined, "the scene closing");
  assert.match(twoPartNow(clerk, yard({ turn: 3 }), ["Do the thing."]), /\n\n## The clock\n[\s\S]*\n\n## For this reply\nDo the thing\.$/, "last before the directives");
  assert.doesNotMatch(twoPartNow(clerk, yard({ turn: 4 }), []), /## The clock/);
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
  assert.match(mouthpiece, /\n\n## How to reply\nReply as JSON with three fields, in this order: `check`, `narration`, `outcomes`\.[\s\S]*\n\n## Who says each line\nPut the speaker in square brackets before every spoken line, each time they speak: \[Kell\] “Out\.” She turns to the boy\./);
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

test("the per-turn note: what's hidden from the player right now: the world's things out of their sight, and each card's secrets by their first sentence, with what shows of them", () => {
  const note = twoPartNow(clerk, yard(), []);
  const hidden = note.slice(note.indexOf("## Hidden from the player right now"));
  assert.match(hidden, /^## Hidden from the player right now\nBehind the screen until the player finds it, or someone shows or tells them of it in play/);
  assert.match(hidden, /Out of the player's sight:\n- a folded page sewn into the left boot's lining \[ledger-page\]/);
  // QA round qa1-1018: the board, Cob's way in, and the crown, in Moll's fist, were named by the narration.
  // QA round qa2-1018: kept back as the GM's knowledge, shown in behaviour, never theirs to say (people had recited what would open them).
  assert.match(hidden, /What the people here keep back, as you know it \(their cards have the whole of it, and what would bring each of them round\)\. It's your knowledge, not theirs to explain: until the player has earned it, it shows only in how they behave and in their tells, and nobody says what would earn it\.\n[\s\S]*- Cob: The boots are Prout's\. He was in the loft last night: [^\n]*reached through a loose board behind the water butt/);
  assert.match(hidden, /- Moll: [^\n]*The crown, stamped on one face with a little wheat-ear, is in her fist\./);
  assert.match(hidden, /What shows of it is their tells, now and then[^\n]*\n[\s\S]*- Moll: one fist kept tightly closed; her eyes keep going to the yard gate; she shuts Cob up whenever he gets near the night\./);
  assert.ok(!/- Moll: [^\n]*Torn:/.test(hidden), "a tell is what shows, not what they're torn between");
  assert.doesNotMatch(note.slice(note.indexOf("## The world right now"), note.indexOf("## Hidden")), /Out of the player's sight/, "said once, in its own part, not in the world's");
  // Found (the motive's revelation landed: the page is that beat's thing), it's no longer out of sight.
  assert.doesNotMatch(twoPartNow(clerk, yard({ landed: ["motive"] }), []), /Out of the player's sight:/);
  assert.equal(tellOf(["Three days ago…", "Shows: lavender a minute before him. Torn: …"]), "lavender a minute before him.");
  assert.equal(firstSentence("His night work, if asked: the Heron ('It's the King's grain, sir. Everyone knows.'). Tonight's a loading night."), "His night work, if asked: the Heron ('It's the King's grain, sir. Everyone knows.').");
  assert.equal(firstSentence("If Kell says so, he answers: 'He did, Sergeant. I am the proper channels.' Then he goes."), "If Kell says so, he answers: 'He did, Sergeant. I am the proper channels.'");
  assert.equal(firstSentence("Sallow's cane is a sword-cane. Nobody knows."), "Sallow's cane is a sword-cane.", "an apostrophe isn't a quote");
});

test("the per-turn note: what the place the player is in holds, with no dice, is theirs, as written and with what it means, whatever a secret says (QA round qa3-1018: the loft's docker's knot)", () => {
  const into = (view: TurnView, area: string) => { const me = view.world!.entities.player!; me.parent = area; delete me.at; return view; };
  const loft = into(yard({ turn: 9 }), "loft");
  const reach = reachNote(clerk, loft)!;
  assert.match(reach, /^## In the player's reach here\nThe player is in the tally loft \(above the yard, inside the granary\), and your prep's paths say being here is all these take: they're the player's, with no check\. When the player looks, say them as your prep has them, meaning and all \(what a thing is, and whose hand or trade it shows\)/);
  assert.match(reach, /they aren't held back because someone's secret has them too\. What else is here still takes what its path says \(a closer look, a check\)\.\n- A smashed lantern and spilled ink by the tally desk, heel scuffs in the grain dust from the desk to the hoist door, and the hoist rope tied off on its cleat with a docker's knot, not a knot a clerk would know\.$/);
  assert.doesNotMatch(reach, /Royal Granary Roll/, "the book's entries take a look at it and a check, as their path says");
  assert.match(twoPartNow(clerk, loft, []), /## Hidden from the player right now\n[\s\S]*- Cob: [^\n]*docker's knot[\s\S]*\n\n## In the player's reach here\n/, "after the secret that has it too, which it overrides");
  assert.equal(reachNote(clerk, yard()), undefined, "from the yard, nothing of the loft's");
  // The Heron's counting-box holds two: the Master's bag of new pennies, and the true book over Scrope's shoulder.
  const heron = sceneFile("heron-warehouse");
  const box = viewAt(heron, heron.start, { turn: 5 });
  box.world = buildWorld(heron.id, loadPlace(readFileSync(join(CAERWYN, placePath("heron")), "utf8"), placePath("heron")), [], box.player);
  assert.deepEqual(reachNote(heron, into(box, "counting-box"))!.split("\n").filter(l => l.startsWith("- ")).map(l => l.slice(0, 40)), ["- A bag of new heron pennies on the cler", "- The book itself, open under the lamp o"]);
  // The rule the note applies, for whoever gets somewhere the reply takes them.
  assert.match(mouthpieceInstructions(clerk, yard()), /The per-turn note lists what's hidden right now\. But what a place itself holds, where your prep's path through it has no dice, is for whoever gets there: they see it as written, meaning and all, even where someone's secret has it too\./);
});

test("the per-turn note: whoever's here whose name the player hasn't heard, with what to call them, in full and then the short way", () => {
  const names = (view: TurnView) => { const note = twoPartNow(clerk, view, []); const at = note.indexOf("## Names the player hasn't heard yet"); return at < 0 ? "" : note.slice(at).split("\n\n")[0]!; };
  assert.match(names(yard()), /^## Names the player hasn't heard yet\nUntil someone says a name aloud where the player can hear it[\s\S]*\n- Cob: "the boy in the too-big boots", then "the boy"\n- Moll: "the girl in the shawl", then "the girl"$/);
  assert.doesNotMatch(names(yard()), /Tull/, "the corporal isn't here yet");
  const told = yard({ turn: 1 });
  told.transcript.push({ turn: 0, scene: "hanged-clerk", speaker: "gm", kind: "narration", text: "“Cob don’t take orders off palace pigeons.”" });
  assert.match(names(told), /\n- Moll: "the girl in the shawl", then "the girl"$/);
  assert.doesNotMatch(names(told), /- Cob/, "once said aloud, it's heard");
  assert.match(twoPartNow(clerk, told, ["Go."]), /## Names the player hasn't heard yet[\s\S]*\n\n## For this reply\nGo\.$/, "the names, and the directives last");
});

test("the per-turn note: what the player's turn has in brackets or asterisks is done or thought, never heard", () => {
  const thief = yard({ turn: 1 });
  thief.transcript.push({ turn: 1, scene: "hanged-clerk", speaker: "player", kind: "player", text: "(I pocket the padlock, slip inside ahead of Kell, since first in gets first pick.) Coming? *I wink at the boy*" });
  assert.match(twoPartNow(clerk, thief, []), /## The player's turn\nIn the player's turn, \(I pocket the padlock, slip inside ahead of Kell, since first in gets first pick\.\) \(I wink at the boy\) are what their character does or thinks, in the player's words, not words said aloud\. People see what's done[\s\S]*nobody hears the thoughts or reasons in it: nobody answers, repeats or quotes those\./);
  const plain = yard({ turn: 1 });
  plain.transcript.push({ turn: 1, scene: "hanged-clerk", speaker: "player", kind: "player", text: "Who found him?" });
  assert.doesNotMatch(twoPartNow(clerk, plain, []), /## The player's turn/);
});

test("the instructions after the user's prompt: written words read untagged, and what the player sees and hears", () => {
  const mouthpiece = mouthpieceInstructions(clerk, yard());
  assert.match(mouthpiece, /\nOnly words said aloud get a tag\. Words written or printed \(a page, a sign, an order, a note\) are read out in the narration, in single quotes and with no tag/);
  assert.match(mouthpiece, /\n\n## What the player sees and hears\n[\s\S]*- Names: [\s\S]*- What's hidden: [\s\S]*A fist that stays shut is a shut fist\.[\s\S]*- The player's words: [\s\S]*- Your notes stay behind the screen\./);
  // QA round qa3-1018: Sallow's name given Kell with the confession, and read off the Roll, the same as the corporal's order, passed as one more line.
  assert.match(mouthpiece, /\n\n## When something lands\nWhen a name, a link or a confession comes out that someone here would react to \(the player says it, or it's there on what they've found, and it touches what someone's card says they know, fear or watch for\), someone does, in the same reply, before anything else, in character and from their card: [^\n]*It never passes as one more line in a list or a notebook\. But a reaction isn't a secret told: what their card keeps back still waits for what opens it, as the card says\. And the conclusion stays the player's: nobody says what it proves or draws the link for them\.\n\n## The player character\n/);
});

test("the instructions after the user's prompt: a check at a turning point, never on a remark, decided before a word is written, whose setup stops at the attempt and whose outcomes carry what the roll decides; and the companion, whose case it isn't", () => {
  const mouthpiece = mouthpieceInstructions(clerk, yard());
  assert.match(mouthpiece, /Never for a remark, a compliment or a question/);
  assert.match(mouthpiece, /when they try to frighten, persuade, trick or press someone who could go either way/);
  // QA round qa2-1018, H4: a roll on the promise Cob's card says opens him, whose failure sent him off with the lead; since qa3-1018, read first, as the check is decided first.
  assert.match(mouthpiece, /\n- `check` comes first: decide it before you write a word of the narration\. It's null on most turns\. What your prep says for certain wins over the dice: where a path, someone's card or the per-turn note says what an approach gets \(no dice; what they do for a promise that answers their fear, or for someone they trust; what coin never buys\), and the player has made that approach, it gets exactly that, with no check\./);
  assert.match(mouthpiece, /never for something you're still waiting for them to say or do, nor for what's already in plain view or already told/);
  assert.match(mouthpiece, /A failure never puts what the player still needs out of reach: nobody who holds a required discovery leaves, bolts or goes silent for good on a roll \(the per-turn note says who holds one\), and the way stays open \(no, but\)\./);
  // Setup and outcome (QA round qa3-1018: the lock held and the door stayed shut before a roll that tore it free): the narration is the setup alone, and the outcomes carry what the roll decides.
  assert.match(mouthpiece, /\n- `narration`: [^\n]*With a check, it's the setup alone, a few sentences written as if you don't yet know how the roll goes, and it stops at the attempt: [^\n]*Nothing the roll is for comes before the dice: not whether it works \(a lock holding or giving, a gap squeezed through, a mark made out\)/);
  assert.match(mouthpiece, /\n- `outcomes`: null without a check\. With one, its five outcomes, and everything the roll decides is in them\.[^\n]*Each one follows on from the setup as you wrote it and never undoes it: [^\n]*an offer made there is still on the table after a failure[^\n]* And each says only what the roll decided, once: never what the setup has already said\./);
  // The check decided first, then the narration, then the outcomes, as the reply is written (a closing that may wait says whether it closed, last).
  assert.deepEqual(Object.keys((replySchema(false) as { properties: object }).properties), ["check", "narration", "outcomes"]);
  assert.deepEqual((replySchema(true) as { required: string[] }).required, ["check", "narration", "outcomes", "closes"]);
  // Nobody recites their own terms; the player character's body is the player's; the scene stays in its place.
  assert.match(mouthpiece, /- What would win someone over [^\n]*Nobody states their own terms or price unasked, or says their card's words for what would open them/);
  assert.match(mouthpiece, /\n\n## The player character\nTheir body and mind are the player's\. Never give them a wound, an ache, tiredness, fear or any other condition that play [^\n]* or the rules [^\n]* haven't given them/);
  assert.match(mouthpiece, /\n\n## Where the scene plays\nThis scene plays in its place[^\n]*follow them as far as its edge[^\n]*Never narrate the way there, arriving, or anything that happens there\./);
  // Kell walks with the player from the granary on (its onEnd's follow), and here already.
  assert.deepEqual(companionsOf(clerk, yard()).map(c => c.id), ["kell"]);
  const companion = mouthpiece.slice(mouthpiece.indexOf("\n\n## The companion\n") + 2);
  assert.equal(companion, [
    "## The companion",
    "Sergeant Agnes Kell goes with the player, and it's the player's case, not hers:",
    "- What she sees, she says plainly when asked and writes down, and stops there: what it means (murder or not, who did it, where it leads) and what the case still needs are the player's to say. Never \"That tells us…\", \"That establishes…\" or \"I still need…\".",
    "- When a name or a link comes out that touches what she knows (her card), whether the player says it or she reads it on what they've found, she reacts before she writes it down: as her card says (going very still), and at most one dry line, what she'd say of it openly or the first words her card gives. What her card keeps back still waits for what opens it, and what it proves stays the player's.",
    "- A question put to the player is the player's to answer: she never answers it for them, or makes an offer or a promise in their place.",
    "- The player's word stands: a promise or a condition they've made (\"don't take it\", \"his name stays out\"), she keeps, and she never overrides their choice.",
    "- She tests a case once, at its weakest point, when the player puts it to her, never before.",
    "- She never examines or searches anything for them unasked, or chooses their next step or where they go, or hints at it. She does what she's asked.",
  ].join("\n"));
  // The co-GM writes her role with what she holds back, every turn (ours, before its tools).
  const coGmSays = coGmInstructions(clerk, yard());
  assert.match(coGmSays, /\n\n## The companion\nSergeant Agnes Kell \[kell\] goes with the player, and it's the player's case\. Every turn, her conversation role says what she holds back as well as what she does\.[^\n]*Never put a conclusion, what the case still needs or the player's next step in her status, mental state or role: the GM voices what it's given\.\nWhat an ending records that's hers to do [^\n]*\n\n## Your tools\n/);
  // The King's morning has no follow of its own: Kell is the companion because the granary made her one.
  const king = sceneFile("kings-morning");
  const morning = viewAt(king, king.start, { turn: 1 });
  assert.deepEqual(companionsOf(king, morning), []);
  assert.doesNotMatch(coGmInstructions(king, morning), /## The companion/);
  morning.history = [{ sceneId: "hanged-clerk" } as TurnView["history"][number]];
  morning.story = { scene: (id: string) => sceneFile(id) } as unknown as TurnView["story"];
  assert.deepEqual(companionsOf(king, morning).map(c => c.id), ["kell"]);
});

test("the per-turn note: who holds a required discovery the player hasn't reached, so no failure puts it out of reach", () => {
  const holders = (view: TurnView) => { const note = twoPartNow(clerk, view, []); const at = note.indexOf("## Who holds what the player still needs"); return at < 0 ? undefined : note.slice(at).split("\n\n")[0]!; };
  assert.equal(holders(yard()), "## Who holds what the player still needs\n- Hobb was spotted at the scene [hobb], which the scene can't end well without: Sergeant Agnes Kell, Cob, Moll\nNo check's outcome puts it out of reach: none of them leaves, bolts or goes silent for good on a roll. A failure costs something else (a higher price, a condition, a wrong impression, time), and the way to it stays open. That's so nothing closes it off, not a reason to hand it over: it still comes out only as it's earned.");
  assert.equal(holders(yard({ reached: [clerk.start, "hobb"] })), undefined, "once reached, nobody holds it from the player");
});

test("a check's failures read against who holds what the player still needs: one that sends them out of the scene is the other failure, when that one keeps them (QA round qa2-1018, H4)", () => {
  const view = yard({ turn: 18 });
  // g06's turn 18, as the mouthpiece wrote it (the names as the player had them by then).
  const outcomes = {
    major_failure: "Cob recoils and bolts with the girl in the shawl through the gate. [Cob] “No! They’ll find me because of you!” The concrete lead goes with them; Kell’s expression hardens as the corporal turns back to the order.",
    minor_failure: "Cob hesitates, then pulls his sleeve from the girl’s grasp. [Cob] “You say that now. How’m I meant to know?” He won’t take your hand, but he hasn’t left; the girl stays between you and the gate, waiting for something he can trust.",
    barely_passed: "Cob spits into his own palm and gives you a quick, frightened shake.",
    minor_success: "Cob takes your hand and seals the oath with a solemn shake.",
    major_success: "Cob grips your palm, solemn as a magistrate and twice as worried.",
  };
  const kept = inReach(clerk, view, outcomes);
  assert.equal(kept.major_failure, outcomes.minor_failure, "the bolt through the gate is gone");
  assert.deepEqual({ ...kept, major_failure: outcomes.major_failure }, outcomes, "the rest as written");
  // By what the player calls them, or as "he" just after: the boy runs off.
  assert.equal(inReach(clerk, view, { ...outcomes, major_failure: "The boy goes white. He bolts for the gate." }).major_failure, outcomes.minor_failure);
  // Moving about the scene isn't leaving it, nor is a departure said not to happen, nor a figure of speech (the probes' own failures); and both failures sending him off stand, the rules having said it.
  for (const stays of ["Cob backs away from you, boots scraping the cobbles.", "Moll pulls him a step away, but neither leaves the yard.", "Cob’s eyes sweep the shadows; their words stop, but they do not bolt.", "Cob falls silent, and their confidence has vanished.", "The rest is lost; the girl’s voice drops too low to make out."]) {
    assert.deepEqual(inReach(clerk, view, { ...outcomes, major_failure: stays }), { ...outcomes, major_failure: stays }, stays);
  }
  const both = { ...outcomes, minor_failure: "Cob is gone over the wall." };
  assert.deepEqual(inReach(clerk, view, both), both);
  // Once the lead is reached, nothing is held from the player.
  assert.deepEqual(inReach(clerk, yard({ turn: 18, reached: [clerk.start, "hobb"] }), outcomes), outcomes);
});

test("the player character's state shows only when it's from play: a quarter down or more, or a condition (QA round qa2-1018: a fresh dwarf's HP 28/31 got a sore side)", () => {
  const at = (status: string) => playerNow({ ...yard(), rules: { status } });
  assert.equal(at("HP 28/31"), undefined, "a fresh dwarf: toughness is on the sheet's maximum, which healing never reaches");
  assert.equal(at("HP 31/31, spell slots 1st 2/2"), undefined);
  assert.equal(at("HP 20/31"), "## The player character now\nHP 20/31. Let it show as what play has done to them (a blow they took, a fall, a spell): someone hurt moves and looks hurt, and nothing else is wrong with them.");
  assert.match(at("HP 31/31, poisoned")!, /^## The player character now\nHP 31\/31, poisoned\. Let it show/);
});

test("the closing goes on from where the last reply ended: what was said there is listed, and not said again", () => {
  const heron = sceneFile("heron-warehouse");
  const view = viewAt(heron, heron.start, { turn: 16 });
  const arrest = "Kell steps in. “Master Josiah Sallow, you are under arrest.” His reply is smooth. “Sergeant, you will regret this.”";
  const line = (words: string, speaker: string) => ({ start: arrest.indexOf(words), end: arrest.indexOf(words) + words.length, speaker });
  view.transcript.push({ turn: 15, scene: heron.id, speaker: "gm", kind: "narration", text: arrest, marked: { speech: [line("“Master Josiah Sallow, you are under arrest.”", "kell"), line("“Sergeant, you will regret this.”", "sallow")] } });
  view.transcript.push({ turn: 16, scene: heron.id, speaker: "player", kind: "player", text: "(I grab the mooring rope.)" });
  assert.deepEqual(saidLast(heron, view), ["[Sergeant Agnes Kell] “Master Josiah Sallow, you are under arrest.”", "[Master Josiah Sallow] “Sergeant, you will regret this.”"]);
  const caught = heron.exits.find(e => e.id === "caught")!;
  // What the last reply did comes before the ending's words, and only what it didn't is played (QA round qa2-1018: the clerk's close had Kell give Tull his order again).
  assert.match(closingDirective(caught, false, saidLast(heron, view)), /Then bring the scene to a close in a few sentences, where the player is now, landing on a moment that belongs to the player\. Your last reply's moment has happened \(an arrest made, a ruling given, an order given, words said\), even where it's what this ending should feel like: don't stage it again or say it again, but go on from where it ended\. Said there already, so not said again, in those words or others: \[Sergeant Agnes Kell\] “Master Josiah Sallow, you are under arrest\.” \[Master Josiah Sallow\] “Sergeant, you will regret this\.” Of what this ending should feel like, play only what your last reply didn't: /);
  // The ending's words are its feeling, not where the player is: the Heron's left the player on the wharf mid-arrest, and the Rat's walked on into the Heron.
  assert.match(closingDirective(caught, false), / Those words are how the ending should feel, not a script: [^\n]*where they put the player somewhere they aren't \(outside, on the wharf, at a door\), close where the player is\. Don't move the player anywhere they haven't gone themselves, and don't narrate beyond the ending: not the way to the next place, through a door they haven't gone through, arriving there, or anything that happens there\.$/);
  assert.equal(closingDirective(caught, false).includes("Said there already"), false, "nothing said, nothing listed");
});

test("the mouthpiece's narration and each outcome keep names the player hasn't heard out of their words, as they stream and as they're kept", async () => {
  const shown: string[] = [];
  const view = yard({ turn: 1 });
  view.transcript.push({ turn: 1, scene: "hanged-clerk", speaker: "player", kind: "player", text: "Hello up there." });
  const reply = {
    check: { skill: "persuasion", dc: 13 },
    narration: "Moll snorts from the wall. [Cob] “Cob don’t talk to pigeons.” Cob stamps. Moll’s fist stays shut.",
    outcomes: { major_failure: "Moll spits.", minor_failure: "Cob shrugs. Moll looks away.", barely_passed: "Moll nods.", minor_success: "[Cob] “Moll says yes.” Moll nods.", major_success: "Moll grins." },
  };
  const spoke = await speak(clerk, view, [], { operation: "two-part.reply", calls: fake({ byName: { reply }, streamMs: 5 }), byKey: m => m, onText: text => shown.push(text) });
  assert.equal(spoke.narration.text, "The girl in the shawl snorts from the wall. “Cob don’t talk to pigeons.” Cob stamps. The girl’s fist stays shut.");
  assert.deepEqual(spoke.narration.markup?.speech.map(s => s.speaker), ["cob"]);
  assert.ok(shown.every((t, i) => i === 0 || t.startsWith(shown[i - 1]!)), "what's shown only grows");
  assert.ok(shown.every(t => !/\bMoll\b/.test(t)), "and never shows the name");
  assert.equal(shown.at(-1), spoke.narration.text);
  assert.equal(spoke.check?.outcomes.major_failure.text, "The girl in the shawl spits.");
  assert.equal(spoke.check?.outcomes.minor_failure.text, "Cob shrugs. The girl in the shawl looks away.", "Cob said his own name in the narration: heard");
  assert.equal(spoke.check?.outcomes.minor_success.text, "“Moll says yes.” Moll nods.", "said aloud, it's heard");
});

test("a route into a discovery is taken once the player has its heart by one of its paths: the co-GM's open routes say what the revelation is and what has it reached, the mouthpiece's note leaves it to the prep", () => {
  const find = clerk.routes.find(r => r.id === "find-murder")!;
  assert.equal(routeLine(clerk, find), "- [find-murder] from Stones at a hanged man [start] to The victim was murdered [murder]. When: its revelation has landed with the player");
  // QA round qa3-1018 (g08): the tally loft's strong path landed word for word, and "as written" kept the motive back.
  assert.match(routeLine(clerk, find, { revelation: true }), /When: the player has its heart, by one of its paths \(Prout didn't hang himself: he was struck and strangled, then hoisted up on the sack hoist to look like a suicide\.\): a strong or proof path's clue that has landed with them, as its earn allows, is enough, though it doesn't say all the revelation does; suggestive clues count once the player has drawn the conclusion from them$/);
  assert.doesNotMatch(twoPartNow(clerk, yard(), []), /struck and strangled/);
  assert.match(prepOf(clerk, yard(), { coGm: true }), /\n## The discoveries\nWhat the player can come to understand here[^\n]*One is reached when the player has its heart, by one of its paths: a strong or proof path's clue/, "the co-GM's prep says the same");
  assert.match(prepOf(clerk, yard()), /\n## The discoveries\nWhat the player can come to understand here[^\n]*One is reached when its revelation has landed with the player\.\n/, "the mouthpiece's as it was");
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
  assert.match(bell(13), /it rings then, whatever is happening\. Not needed once Hobb has fled\. Its outer limit, whichever runs out first: 15 exchanges into the scene \(the next reply is the 14th\), or 8 after Arlo's third challenge \[arlos-challenge\] \(reached on turn 6: the next reply is the 7th after it\)\. Due soon: it can be felt coming, once, in someone's role \(a sign of it, never the moment itself\)\.$/, "fifteen into the scene is a reply off");
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
  assert.match(lines.find(l => l.startsWith("- [case-lost]"))!, /\.\)? It's a bad ending\. What's true there: The player failed/, "after the condition's own last sentence, a bracket's or not");
  assert.doesNotMatch(twoPartNow(clerk, view, []), /What's true there/);
  assert.doesNotMatch(prepOf(clerk, view, { coGm: true }), /It's a good ending/, "the prep has the endings under their own headings");
});

test("the co-GM's input has the GM's notes on each person on stage who has any (how they stand and why, a promise owed), above their roles; someone with none, or off stage, isn't listed, nobody noted is no such part, and the mouthpiece sees none of it", () => {
  const view = yard({ id: "notes-game", turn: 3 });
  assert.doesNotMatch(coGmInput(clerk, view, undefined)[0]!.content, /Notes on the people here/, "nobody has any yet");
  const kell = { id: "kell", name: "Sergeant Agnes Kell" };
  note("notes-game", kell, "standing", "Warming: the investigator kept Cob's name out of her book, as she asked.");
  note("notes-game", kell, "promises", "Promised the investigator a look at the watch's night book once Prout is signed in.");
  note("notes-game", { id: "tull", name: "Corporal Abner Tull" }, "did", "Waited at the gate with the dead-cart, as the Captain ordered.");
  const input = coGmInput(clerk, view, undefined)[0]!.content;
  assert.match(input, /\n\n# Notes on the people here \(what's happened with them in play\)\n\nThe GM's notes on each of them so far, this scene's included: [^\n]*Let a role follow from them where they bear on the moment \(a promise kept or owed, how the player character has treated them\)[^\n]*\n\n## Sergeant Agnes Kell \[kell\]\nStanding with the player: Warming: the investigator kept Cob's name out of her book, as she asked\.\nPromises:\n- Promised the investigator a look at the watch's night book once Prout is signed in\.\n\n# Current character roles\n/);
  assert.doesNotMatch(input, /## Cob \[cob\]|## Moll \[moll\]/, "no notes on the children");
  assert.doesNotMatch(input, /dead-cart, as the Captain ordered/, "Tull isn't on stage yet");
  assert.match(coGmInstructions(clerk, view), /what a character remembers \(the notes on the people here, in your input\), wants, has been promised or owes/);
  assert.doesNotMatch(mouthpieceInput(clerk, view, []).map(m => m.content).join("\n"), /night book/, "the mouthpiece plays the roles, not the notes");
  assert.doesNotMatch(mouthpieceInstructions(clerk, view), /night book/);
});

test("the co-GM's tools: a route only as its condition is written, the player's own act for a condition about it; no move for what hasn't happened; the ending the player achieved; an overdue cue brought about; roles as behaviour, moved past what has happened", () => {
  const tools = coGmInstructions(clerk, yard()).split("## Your tools\n")[1]!;
  for (const line of [
    "Take a route only when its condition has happened in the story as written, all of it. A condition about what the player does (makes the case, goes after someone, leaves) needs the player to have done it",
    "Call move_scene only for a route whose moment has come, never to note that one hasn't",
    "When more than one open route fits, take the one whose ending matches what the player achieved.",
    "An overdue cue is brought about: take its route now, unless its condition says it's no longer needed.",
    "Write a role as behaviour the GM can show",
    "move everyone's role past it: nobody's role still has it to do",
    "A cue is brought about by taking its route",
  ]) assert.ok(tools.includes(line), line);
  assert.ok(tools.trimEnd().endsWith('Then reply "done".'));
});

test("a move whose reason says it hasn't happened is refused, a cue's aside (its move is what brings it about); a move's answer names any cue still overdue", async () => {
  // The round's own: each took a discovery the player hadn't made or a way in they hadn't taken (g08, g06, g01, g05, g07, g02), then the replays'.
  for (const why of [
    "No one has sought Cob or earned his trust, and the page has not been revealed; do not move this discovery.",
    "Not yet: Hobb has confessed his part in the loft but has not been asked for or given his master's name.",
    "Scrope has explained why the true account exists and linked it to Wendell's discovery, but he has not yet explained its entries page by page, offered testimony, or otherwise",
    "Hobb told Grunda to show the brass token and take a sack, but Grunda has not yet done so or otherwise entered; the route's condition has not happened.",
    "Not yet: the boot has only been offered for inspection; Pip has not yet discovered that it contains Prout’s page or learned what the entries mean.",
    "Cob's account of the late-night argument, a thump, choking, and the hoist creaking without sacks strongly points to a staged hanging, but Corvin has not yet reached the f",
    "No discovery: the player has not yet learned about or uncovered the page sewn into Cob's boot.",
    "Not reached; Hobb has asked what will become of him, but no fear, safe refuge, or Crown-witness option has yet been discussed.",
    "No one has yet revealed that Hobb fears for his mother or the noose, or what could protect her or offer him a way to swear for the Crown.",
    "Nothing has happened yet.",
    // QA round qa2-1018's (g08's true book, taken a turn before it was read) and its probes'.
    "The ledger has not been read or explained page by page, and no witness has yet sworn to its contents; Scrope has only offered it.",
    "Cob told Bartholomew that the huge man with a bandaged right hand was in the loft, but Big Hobb Mallory has not been named or identified as the Drowned Rat's champion.",
    "Cob testified that the huge man with a bandaged right hand was in the loft with the gentleman when Prout was killed, but nobody has yet named him Big Hobb Mallory or identified where to find him.",
    "Cob testified that the enormous man with a bandaged right hand was present during the killing, but neither Cob nor Kell has yet identified him as Big Hobb Mallory or linked him to the Drowned Rat.",
    "Sallow reaches for the ledger; neither Sallow nor the Crakes have drawn blades, so the fight route has not occurred.",
    // QA round qa3-1018's (g04's way in through Kell's eyes, taken while she stood outside; g06's loft on a rope burn) and its probes' (g02's book, the player still in the counting-box; g08's motive).
    "No: Nell is concealed inside while Kell remains outside; she has not witnessed Sallow's transaction.",
    "Arlo revealed that Hobb's palm was skinned in a stripe like rope burn, but no one has established that Hobb was in the tally loft or what happened there.",
    "The player has the true book in hand, but has not left the Heron; they are still in the counting-box confrontation, and nobody is holding them.",
    "Brann has seen the missing Granary Roll page and an adjacent King's Road entry marked 'Lost to goblins' and countersigned by J. Sallow, but the diversion of grain and Prout's discovery of its sales have not landed.",
    "Cob has produced the page sewn into the boot, but no one has yet described the second man who was in the loft or connected that man to Big Hobb Mallory.",
  ]) assert.ok(deniesItself(why), why);
  for (const why of [
    "Pip recognized that Prout was strangled and struck before being hoisted, and Kell confirmed the cord mark and head wound were not caused by hanging.",
    "No one caught him: Hobb got clean away up the river stairs.",
    "Kell hasn't been told, but Hobb has owned to the loft in his own words.",
    "Hobb has broken and begun to tell what he did.",
    "Pip slipped in past Saul's deaf side; neither the Crakes nor Hep has yet noticed her.",
    "Nobody has yet stopped them: Pip walks out of the land door with the true book under her arm.",
    "No one stopped Nell as she went out of the land door with the true book.",
    "Hobb went to work without being arrested, after telling Maren his part in the loft, his master's name and the Heron.",
  ]) assert.ok(!deniesItself(why), why);

  const rat = sceneFile("drowned-rat");
  const view = viewAt(rat, rat.start, { turn: 15, turnsInBeat: 0 });
  delete view.world;
  const gm = { ...view } as unknown as GmState;
  const answers: string[] = [];
  const asking: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init!.body)) as { input: Array<{ type?: string; output?: string }> };
    const outputs = body.input.filter(i => i.type === "function_call_output");
    if (outputs.length) { answers.push(...outputs.map(o => JSON.parse(o.output!) as string)); return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }], usage: { cost: 0 } }); }
    const move = (route: string, why: string) => ({ type: "function_call", call_id: route, name: "move_scene", arguments: JSON.stringify({ route_id: route, outcome: "none", why }) });
    return Response.json({ status: "completed", output: [move("find-the-page", "No discovery: the player has not yet learned of the page."), move("find-the-heron", "Nan told them the token opens the Heron.")], usage: { cost: 0 } });
  };
  const answer = await coGm(rat, view, gm, undefined, { fetch: asking, apiKey: "test" });
  assert.deepEqual(answer.moves.map(m => m.route), ["find-the-heron"], "the page isn't taken on a reason that says it wasn't found");
  assert.match(answers[0]!, /^error: your reason says this hasn't happened, so \[find-the-page\] stays as it is/);
  assert.match(answers[1]!, /^Reached "Where the grain goes: the Heron": the player has it now\. Open routes now: [a-z, -]+\. Still overdue: \[arlo-calls-him-out\], \[bell-rings\]: bring them about now\.$/);
  assert.doesNotMatch(movedText(rat, gm, "the-heron", 3), /overdue/i, "nothing overdue on turn 3");
});

/** The campaign's scenes as the story a view has (what reads the story's other scenes: who a revelation names). */
const campaignStory = (): Story => {
  const scenes = readdirSync(join(CAERWYN, "scenes")).filter(f => f.endsWith(".kmscene")).map(f => sceneFile(f.replace(/\.kmscene$/, "")));
  return { id: "caerwyn@test", scene: id => scenes.find(s => s.id === id), all: () => scenes };
};

/** The bookkeeping a view stands for, as the request carries it (no story: a view's functions don't clone). */
const bookkeeping = (view: TurnView): GmState => { const { story: _story, ...gm } = view; return gm as unknown as GmState; };

/** A view of a scene with its routes taken on their turns (each [turn, route]), so its path has the turns the co-GM counts by, at `turn`. */
function walked(scene: Scene, moves: Array<[number, string]>, turn: number, extra: Partial<TurnView> = {}): TurnView {
  const view = viewAt(scene, scene.start, { turnsInBeat: 0, ...extra });
  delete view.world;
  let gm = { ...view } as unknown as GmState;
  for (const [on, route] of moves) {
    const taken = takeRoute(scene, gm, route, "none", on);
    if ("error" in taken) assert.fail(taken.error);
    gm = taken.gm;
  }
  return { ...view, ...gm, turn } as unknown as TurnView;
}

/** A stand-in for the co-GM's model that makes the calls it's given, a round at a time, then says "done" (what each was answered is in coGm's log). */
function scripted(rounds: Array<Array<[string, Record<string, unknown>]>>): { fetch: typeof fetch } {
  let round = 0;
  const f: typeof fetch = async () => {
    const calls = rounds[round++];
    if (!calls) return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }], usage: { cost: 0 } });
    return Response.json({ status: "completed", output: calls.map(([name, args], i) => ({ type: "function_call", call_id: `r${round}c${i}`, name, arguments: JSON.stringify(args) })), usage: { cost: 0 } });
  };
  return { fetch: f };
}

const move = (route: string, why = "It happened in the story.") => ["move_scene", { route_id: route, outcome: "none", why }] as [string, Record<string, unknown>];

/** The Heron at the Master's coming (reached on turn 7), the King's grain seen and the proof found: every ending from midnight is open. */
const heron = sceneFile("heron-warehouse");
const atMidnight = (turn: number) => walked(heron, [[2, "taken-on"], [4, "find-kings-grain"], [7, "master-comes"], [8, "find-master-due"], [15, "found-the-proof"]], turn, { reached: ["wharf"], beat: "wharf" });

test("endings first: a cue into a bad ending waits on the good and mixed ones, its overdue line saying so; a cue due soon can be felt coming", () => {
  const second = heron.routes.find(r => r.id === "cast-off")!;
  assert.deepEqual([intoBad(heron, second), intoBad(heron, heron.routes.find(r => r.id === "master-comes")!), intoBad(heron, heron.routes.find(r => r.id === "give-up")!)], [true, false, false], "a cue into a bad ending; not a cue into an event, nor a way out the player takes");
  assert.deepEqual(intoBetter(heron, openRoutes(heron, atMidnight(16))).map(r => r.id), ["away-with-book", "in-the-act", "overpowered", "cornered", "attack"]);
  const line = (turn: number) => coGmInput(heron, atMidnight(turn), undefined)[0]!.content.split("\n").find(l => l.startsWith("- [cast-off]"))!;
  assert.match(line(12), /8 after The Master comes \[midnight\] \(reached on turn 7: the next reply is the 5th after it\)\. It's a bad ending\./, "nothing to say yet");
  assert.match(line(13), /\(reached on turn 7: the next reply is the 6th after it\)\. Due soon: it can be felt coming, once, in someone's role \(a sign of it, never the moment itself\)\. It's a bad ending\./);
  assert.match(line(14), /the next reply is the 7th after it\)\. Due soon:/);
  assert.match(line(16), /the next reply is the 9th after it\)\. Overdue: bring it about now, unless a good or mixed ending's condition has happened, which is taken instead, or the player is in the middle of bringing one about, which comes first\. It's a bad ending\./);
  const rat = sceneFile("drowned-rat");
  const bell = coGmInput(rat, walked(rat, [[6, "arlo-calls-him-out"]], 14), undefined)[0]!.content.split("\n").find(l => l.startsWith("- [bell-rings]"))!;
  assert.match(bell, /\. Overdue: bring it about now\.$/, "a cue into an event is brought about as before");

  const tools = coGmInstructions(heron, atMidnight(16)).split("## Your tools\n")[1]!;
  for (const words of [
    "Endings first: before the rest, read each open route into an ending against the story, its condition as written, all of it. One that has happened is taken now, in this settle, ahead of any cue: an overdue cue never goes before it.",
    "One that's about to happen (the arrest made but not yet secured, a hand on the cane but no blade out) hasn't yet: the next reply plays it.",
    "A cue into a bad ending (the time running out on the player) waits on the good and mixed ones: bring it about only when none of their conditions has happened (then take that one instead) and the player isn't in the middle of bringing one about right now",
  ]) assert.ok(tools.includes(words), words);
});

test("the co-GM's cue into a bad ending is held once in a turn while a good or mixed ending is open: the ending taken instead, or the cue on a second call; at once with none open; a cue into an event never held", async () => {
  const view = atMidnight(16);
  const gm = { ...view } as unknown as GmState;

  // Kell's arrest held and the Crakes standing down: the ending, not the bell.
  const arrest = scripted([[move("cast-off", "The second bell rings at its outer limit.")], [move("in-the-act", "Kell has him in irons and the Crakes have their hands up.")]]);
  const caught = await coGm(heron, view, gm, undefined, { fetch: arrest.fetch, apiKey: "test" });
  assert.deepEqual(caught.moves.map(m => m.route), ["in-the-act"]);
  const [held, ended] = caught.log.map(c => c.result);
  assert.match(held!, /^Not taken yet: \[cast-off\] ends the scene badly \(The barge sails\), and a cue into a bad ending waits on the good and mixed endings\. Read these open routes against the story first:\n/);
  assert.match(held!, /\n- \[in-the-act\] to Caught in the act \(good\): Sallow has been caught at the loading of the King's grain/);
  assert.match(held!, /\n- \[cornered\] to Roll for initiative \(mixed\): Sallow, exposed with proof/);
  assert.match(held!, /\nIf one's condition has happened, take it instead\. If the player is in the middle of bringing one about right now \(an arrest made but not yet secured, blades coming out, the proof on its way out of the door\), leave \[cast-off\] this turn: that moment plays out first\. Only if neither, take \[cast-off\] again\.$/);
  assert.equal(ended, "The scene is ending: Caught in the act. The GM closes it on the next reply.");

  // Nothing better happening: the second call takes it.
  const sails = scripted([[move("cast-off", "The second bell rings.")], [move("cast-off", "Sallow got clear away and nothing is in hand: the bell rings.")]]);
  const sailed = await coGm(heron, view, gm, undefined, { fetch: sails.fetch, apiKey: "test" });
  assert.deepEqual(sailed.moves.map(m => m.route), ["cast-off"]);
  assert.match(sailed.log[1]!.result, /^The scene is ending: The barge sails\./);

  // With no good or mixed ending open, the bell rings at once.
  const bare = { ...heron, routes: heron.routes.filter(r => !intoBetter(heron, [r]).length) };
  const alone = await coGm(bare, view, gm, undefined, { fetch: scripted([[move("cast-off", "The second bell rings.")]]).fetch, apiKey: "test" });
  assert.deepEqual(alone.moves.map(m => m.route), ["cast-off"]);

  // A cue into an event (the Rat's bell) is never held, whatever endings are open.
  const rat = sceneFile("drowned-rat");
  const ratView = walked(rat, [[6, "arlo-calls-him-out"]], 14);
  const rang = await coGm(rat, ratView, { ...ratView } as unknown as GmState, undefined, { fetch: scripted([[move("bell-rings", "Eight exchanges after Arlo's challenge: the eleventh bell rings.")]]).fetch, apiKey: "test" });
  assert.deepEqual(rang.moves.map(m => m.route), ["bell-rings"]);

  // And a move's answer says a cue into a bad ending still overdue waits on the better endings.
  const found = movedText(heron, { ...atMidnight(16), reached: ["wharf", "floor", "kings-grain", "midnight", "master-due"] } as unknown as GmState, "master-due", 16);
  assert.match(found, /\. Still overdue, into a bad ending: \[cast-off\]: bring it about now, unless a good or mixed ending's condition has happened, which is taken instead, or the player is in the middle of bringing one about, which comes first\.$/);
});

/** Lines of play, each a GM's narration on its own turn (what reads what's been said: unsaidIn, owedDirective). */
const said = (...lines: string[]) => lines.map((text, i) => ({ turn: i + 1, speaker: "gm", kind: "narration" as const, text }));

/** A view with a lead's name owed on its path, as the settle commit leaves it (beats.ts oweName). */
const owing = (scene: Scene, view: TurnView, lead: string, turn: number): TurnView => ({ ...view, path: oweName(scene, bookkeeping(view), lead, turn).path });

/** The clerk where Cob has described the big man, a turn in, with the campaign's story. */
const describedAt = (turn: number, extra: Partial<TurnView> = {}) => yard({ turn, story: campaignStory(), transcript: said("“The big one was like a door, with a bandage on his right hand. He called the posh one ‘Master.’”"), ...extra });

test("who a revelation names from the story's other scenes that nobody has said yet, in the co-GM's targets with each discovery's paths and how strong each is; a discovery that isn't a lead is held once in a turn, and taken again where the name is a detail of it", async () => {
  const story = campaignStory();
  const hobb = clerk.beats.find(b => b.id === "hobb")!;
  const described = describedAt(16);
  assert.deepEqual(unsaidIn(clerk, described, hobb.revelation!), ["Big Hobb Mallory"], "the Rat's man, by name, is his lead");
  assert.deepEqual(unsaidIn(clerk, { ...described, transcript: [...described.transcript, ...said("Kell writes it down. “Big Hobb Mallory. The Drowned Rat's champion.”")] }, hobb.revelation!), [], "once Kell has named him");
  assert.deepEqual(unsaidIn(clerk, { ...described, story: undefined } as TurnView, hobb.revelation!), [], "no story, nobody elsewhere");
  assert.deepEqual(unsaidIn(clerk, described, clerk.beats.find(b => b.id === "murder")!.revelation!), [], "Prout is nobody else's to find");
  const kings = sceneFile("kings-morning");
  assert.deepEqual(unsaidIn(kings, viewAt(kings, kings.start, { story }), kings.beats.find(b => b.id === "the-promises")!.revelation!), [], "the talk's {name} isn't anyone");
  const rat = sceneFile("drowned-rat");
  const master = rat.beats.find(b => b.id === "the-master")!.revelation!;
  assert.deepEqual(unsaidIn(rat, viewAt(rat, rat.start, { story }), master), ["Master Josiah Sallow"]);
  assert.deepEqual(unsaidIn(rat, viewAt(rat, rat.start, { story, history: [{ sceneId: "hanged-clerk", exitId: "murder-unknown", summary: "Prout's page: wagons countersigned 'J. Sallow, for the Royal Purveyor'." }] }), master), [], "heard in the story before");

  const targets = coGmInput(clerk, described, undefined)[0]!.content;
  assert.match(targets, /\n# The targets\nThe discoveries not reached yet, each with its paths \(your prep has each path's clue and what earns it\):\n- The victim was murdered \[murder\]: Prout didn't hang himself[^\n]* to look like a suicide\. Its paths: the body \(suggestive\), the body \(strong\), the tally loft \(strong\), Cob \[cob\] \(strong\) and Moll \[moll\] \(suggestive\)\.\n/);
  assert.match(targets, /\n- Motive: supplies are being embezzled \[motive\]: [^\n]*Its paths: Cob \[cob\] \(proof\), Sergeant Agnes Kell \[kell\] \(strong\), Cob \[cob\] \(suggestive\), the tally loft \(strong\) and Corporal Abner Tull \[tull\] \(suggestive\)\. \(Nobody has said Master Josiah Sallow's name in the story yet\.\)\n/, "not a lead: the name is all it says");
  assert.match(targets, /\n- Hobb was spotted at the scene \[hobb\] \(required\): A huge man with a bandaged right hand, Big Hobb Mallory, [^\n]* when Prout died\. Its paths: [^\n]*Sergeant Agnes Kell \[kell\] \(hook\)\. \(Nobody has said Big Hobb Mallory's name in the story yet: a lead, it isn't reached until the name is said aloud\. Once he's been described as one of its paths has it, move it: it isn't taken, but the name is then owed, and Sergeant Agnes Kell gives it in the next reply\.\)\n/);
  assert.doesNotMatch(twoPartNow(clerk, described, []), /Nobody has said/, "the mouthpiece's note has none of it");

  // The motive names 'J. Sallow', nobody's said him, and it isn't a lead: held once, and taken on the second call.
  const again = scripted([[move("find-motive", "The page out of Cob's boot was read: wagons 'lost to goblins', each countersigned by J. Sallow.")], [move("find-motive", "The page's entries have landed; his name is a detail of them.")]]);
  const second = await coGm(clerk, described, bookkeeping(described), undefined, { fetch: again.fetch, apiKey: "test" });
  assert.deepEqual(second.moves.map(m => m.why), ["The page's entries have landed; his name is a detail of them."], "taken on the second call");
  assert.match(second.log[0]!.result, /^Not taken yet: \[find-motive\]'s revelation names Master Josiah Sallow, and nobody has said that name in the story yet\. [^\n]*If the name is only a detail of it and its heart has landed, take \[find-motive\] again\.$/);
  const named = { ...described, transcript: [...described.transcript, ...said("“Big Hobb Mallory,” Kell says. “He drinks at the Drowned Rat.”")] } as TurnView;
  const atOnce = await coGm(clerk, named, bookkeeping(named), undefined, { fetch: scripted([[move("find-hobb", "Kell named him from Cob's description.")]]).fetch, apiKey: "test" });
  assert.deepEqual([atOnce.moves.map(m => m.route), atOnce.owed], [["find-hobb"], undefined], "once he's named, at once, nothing owed");

  const tools = coGmInstructions(clerk, described).split("## Your tools\n")[1]!;
  for (const words of [
    "A discovery is reached when the player has its heart, by one of its paths: your prep gives each discovery's paths, how strong each is, its clue and what earns it. A strong or proof path's clue that has landed with the player, as its earn allows, is enough: take it then, though the clue doesn't say all the revelation does. Suggestive clues count once the player has drawn the conclusion from them (said it, or acted on it).",
    "A lead (a discovery an ending needs, whose revelation names someone of the story's other scenes for the player to go and find) needs that name said aloud as well, by someone here or by the player: until it is, its route is refused, however well they've been described.",
    "Once the rest of it has landed (who they are, described as one of its paths has it) but nobody has said the name, move it all the same: it isn't taken, but the name is then owed",
    "Write it into their role with no condition (\"she names him now\", never \"if asked\" or \"if the description comes up\"), and move it again once the name has been said.",
  ]) assert.ok(tools.includes(words), words);
});

test("a lead is never taken while the name it needs is unsaid (QA round qa3-1018, H7: g05's co-GM took Hobb on the hold's own exception, the name first said in the closing): refused every time, the name owed, whatever its reason; with nobody here whose path gives the name freely, the lead waits for it", async () => {
  assert.ok(endingNeeds(clerk, clerk.beats.find(b => b.id === "hobb")!), "the ending needs it");
  assert.ok(!endingNeeds(clerk, clerk.beats.find(b => b.id === "motive")!), "no ending needs the motive");
  const described = describedAt(17);
  const gm = bookkeeping(described);
  const refusedText = /^Not taken: \[find-hobb\] is a lead, and its revelation names Big Hobb Mallory, whose name nobody has said in the story yet \(the game reads what's been said\): it isn't reached until a reply says the name aloud, however well he's been described\. The name is owed now: Sergeant Agnes Kell names him in the next reply, unasked, as her path in your prep has it, and the GM is told so\. Write it into that role with no condition \("names him now", never "if asked" or "if the description comes up"\)\. Don't move \[find-hobb\] again this turn: move it after the reply that says the name\.$/;
  // g05's turn 17, both calls: the second on the reason that Kell would name him in the next reply.
  const twice = scripted([[move("find-hobb", "Moll had already described the gentleman's huge, bandaged-handed companion calling him 'Master Sallow'; with the loft discovery, Kell can identify that description as Big Hobb Mallory, champion of the Drowned Rat.")], [move("find-hobb", "Moll's description of Sallow's huge, bandaged-handed companion has reached Kell; she will identify him as Big Hobb Mallory, champion of the Drowned Rat, in the next reply.")]]);
  const refused = await coGm(clerk, described, gm, undefined, { fetch: twice.fetch, apiKey: "test" });
  assert.deepEqual([refused.moves, refused.owed], [[], ["hobb"]], "refused both times, and the name owed");
  assert.match(refused.log[0]!.result, refusedText);
  assert.equal(refused.log[1]!.result, "Not taken: nobody has said Big Hobb Mallory in the story yet (the game reads what's been said), and no reason changes that: [find-hobb] waits for a reply that says the name. Don't move it again this turn.", "moved again, it waits");

  // g05's turn 12: the co-GM moved it on the reason that nobody had named him, which is when the name is owed.
  const unnamed = await coGm(clerk, described, gm, undefined, { fetch: scripted([[move("find-hobb", "Moll said the gentleman's bandaged-handed companion called him Master Sallow, but no one has named the companion as Big Hobb Mallory or identified where to find him.")]]).fetch, apiKey: "test" });
  assert.deepEqual([unnamed.moves, unnamed.owed], [[], ["hobb"]]);
  assert.match(unnamed.log[0]!.result, refusedText);

  // On "none" it's refused for its reason, and nothing is owed (smoke-fix3-1018's turn 10: nobody had described him, and the name owed had Kell name him from nothing), nor on a reason that denies it outright (that turn's probe, moving it again); moved again on what happened, the name is owed.
  const hollow = await coGm(clerk, yard({ turn: 10, story: campaignStory() }), gm, undefined, { fetch: scripted([[move("find-hobb", "none")], [move("find-hobb", "Brann has not yet learned a description or name of the large man who was at the granary.")], [move("find-hobb", "Brann found a dockworker’s knot, scuffs from the tally desk, and a razored-out page in the loft, but no description or name of the man who helped kill Prout.")]]).fetch, apiKey: "test" });
  assert.deepEqual([hollow.moves, hollow.owed], [[], undefined], "nothing owed on none, or on a denial of the lead itself");
  assert.match(hollow.log[0]!.result, /^error: your reason says nothing of what happened, so \[find-hobb\] stays as it is\./);
  for (const c of hollow.log.slice(1)) assert.equal(c.result, "error: your reason says [find-hobb] hasn't come out, so it stays as it is and nothing is owed: a lead's name is owed once he's been described as one of its paths has it. Move it then; until then, leave it.");
  // The four rounds' moves into a lead that deny something: only the one before anybody had described him denies the lead itself.
  assert.deepEqual([
    "Hobb has confessed that the gentleman killed Prout and ordered him to hoist the body, but has not yet named his master.",
    "Moll said the gentleman's bandaged-handed companion called him Master Sallow, but no one has named the companion as Big Hobb Mallory or identified where to find him.",
    "Moll described the gentleman's bandaged-handed companion and said he called him Master Sallow, but nobody has yet identified him by name as Big Hobb Mallory or connected him to the Drowned Rat.",
    "Moll has said the gentleman's companion was a big man who called him Master Sallow, but neither she nor the player has yet established that he was the Drowned Rat champion Big Hobb Mallory.",
    "Cob described the big man; nobody has named him yet.",
    "Not yet; nobody has described or identified the second man as Big Hobb Mallory and tied him to the Drowned Rat.",
    "Brann has not yet learned a description or name of the large man.",
    "Brann has not yet uncovered a description or account of the large man who was present.",
    "Brann found a dockworker’s knot and a razored-out page in the loft, but no description or name of the man.",
  ].map(deniesTheLead), [false, false, false, false, false, true, true, true, true]);
  const retold = await coGm(clerk, described, gm, undefined, { fetch: scripted([[move("find-hobb", "none")], [move("find-hobb", "Cob described the big man like a door with a bandaged right hand, who called the posh one 'Master'.")]]).fetch, apiKey: "test" });
  assert.deepEqual([retold.moves, retold.owed, retold.log.map(c => c.result.split(":")[0])], [[], ["hobb"], ["error", "Not taken"]], "said what happened, the name is owed");

  // Once owed, the targets say who names him.
  const owed = owing(clerk, described, "hobb", 16);
  assert.match(coGmInput(clerk, owed, undefined)[0]!.content, /\(Nobody has said Big Hobb Mallory's name in the story yet: a lead, it isn't reached until the name is said aloud\. The name is owed: Sergeant Agnes Kell names him in the next reply, as the GM is told; write it into that role with no condition\.\)\n/);

  // The Rat's master: Hobb gives the name last of all, and nobody gives it freely, so it waits.
  const rat = sceneFile("drowned-rat");
  const ratView = viewAt(rat, rat.start, { turn: 5, story: campaignStory() });
  delete ratView.world;
  const waits = await coGm(rat, ratView, bookkeeping(ratView), undefined, { fetch: scripted([[move("find-the-master", "Hobb said 'Master' and stopped himself, white as a sheet.")]]).fetch, apiKey: "test" });
  assert.deepEqual([waits.moves, waits.owed], [[], ["the-master"]]);
  assert.match(waits.log[0]!.result, /^Not taken: \[find-the-master\] is a lead, and its revelation names Master Josiah Sallow, [^\n]* Whoever holds the name gives it as it's earned\. Don't move \[find-the-master\] again this turn: move it after the reply that says the name\.$/);
  assert.equal(owedDirective(rat, owing(rat, ratView, "the-master", 5)), undefined, "nobody is told to give it");
});

test("a lead's name owed: the next reply has whoever gives it as their path has it name them, unasked, until the name has been said (QA round qa3-1018, H6: g07's Kell waited on \"If Grunda asks\" four turns, and the game ran out); the fake mouthpiece says it", async () => {
  const view = describedAt(5);
  assert.equal(owedDirective(clerk, view), undefined, "nothing owed yet");
  const owed = owing(clerk, view, "hobb", 4);
  const direction = owedDirective(clerk, owed)!;
  assert.match(direction, /^Sergeant Agnes Kell names him now: Big Hobb Mallory\. What's been said of him has reached her, and her path in your prep has it: A porter the size of a door who's champion of the arm-wrestling at the Drowned Rat is Big Hobb Mallory[^\n]* No dice: as soon as any description of him reaches her \(his size, his bandaged hand, the Rat's arm-wrestling\), or at once if one already has, she names him unasked and writes it down, and concludes nothing else\. So in this reply, after answering the player's turn, she says the name aloud in a line of her own, unasked, and writes it down: the name and what she knows of him, nothing more\.$/);
  assert.equal(owedDirective(clerk, { ...owed, transcript: [...owed.transcript, ...said("“Big Hobb Mallory,” Kell says.")] }), undefined, "said, so no more");
  assert.equal(owedDirective(clerk, { ...owed, absent: ["kell"] }), undefined, "nobody here to give it");
  assert.equal(owedDirective(clerk, { ...owed, reached: ["start", "hobb"] }), undefined, "reached");

  const spoke = await speak(clerk, owed, [direction], { operation: "two-part.reply", calls: fake({ replies: ["Kell's pencil moves."] }), byKey: m => m });
  assert.equal(spoke.narration.text, "Kell's pencil moves. “Big Hobb Mallory.”");
  assert.deepEqual(spoke.narration.markup?.speech.map(s => s.speaker), ["kell"]);
});

test("the fake co-GM's walk through the clerk: the lead refused while its name is unsaid, so owed, said in the next reply by the fake's Kell, and taken then", async () => {
  const view = yard({ turn: 1, story: campaignStory() });
  const first = await coGm(clerk, view, bookkeeping(view), undefined, fake());
  assert.deepEqual([first.moves, first.owed], [[], ["hobb"]]);
  assert.deepEqual(first.log.map(c => c.result.split(":")[0]), ["Not taken"], "a refusal, not a hold: the fake doesn't take it again");
  const owed = { ...owing(clerk, view, "hobb", 1), turn: 2 };
  const reply = await speak(clerk, owed, [owedDirective(clerk, owed)!], { operation: "two-part.reply", calls: fake(), byKey: m => m });
  const named = { ...owed, transcript: [...owed.transcript, { turn: 2, scene: clerk.id, speaker: "gm", kind: "narration" as const, text: reply.narration.text }] } as TurnView;
  const second = await coGm(clerk, named, bookkeeping(named), undefined, fake());
  assert.deepEqual(second.moves.map(m => m.route), ["find-hobb"]);
});

test("a move's reason that says nothing of what happened is refused, a cue's too (QA round qa3-1018, H8: the Heron closed on \"Out with the true book\" for the reason \"none\", the player still in the counting-box)", async () => {
  const away = heron.routes.find(r => r.id === "away-with-book")!;
  for (const why of ["none", "", "None.", "n/a", "Out with the true book.", "away-with-book", "Taken: out with the true book"]) assert.ok(saysNothing(heron, away, why), JSON.stringify(why));
  for (const why of ["Nell walked out of the land door with the true book under her coat, and nobody laid a hand on her.", "Over the side with the book, and nobody holding her."]) assert.ok(!saysNothing(heron, away, why), why);
  const cart = clerk.routes.find(r => r.id === "cart-comes")!;
  assert.ok(saysNothing(clerk, cart, "The noon bell."), "a cue's label back");
  assert.ok(!saysNothing(clerk, cart, "The twelfth exchange has arrived, the cue's stated outer limit, so the dead-cart comes to the yard."));

  const view = walked(heron, [[2, "taken-on"], [4, "find-kings-grain"], [7, "master-comes"], [8, "find-master-due"], [11, "took-the-book"]], 13, { reached: ["wharf"], beat: "wharf" });
  const answer = await coGm(heron, view, bookkeeping(view), undefined, { fetch: scripted([[move("away-with-book", "none")]]).fetch, apiKey: "test" });
  assert.deepEqual(answer.moves, []);
  assert.match(answer.log[0]!.result, /^error: your reason says nothing of what happened, so \[away-with-book\] stays as it is\. Say in a sentence what happened in the story that takes it; if nothing has, leave it\.$/);
  const bell = await coGm(clerk, yard({ turn: 12 }), bookkeeping(yard({ turn: 12 })), undefined, { fetch: scripted([[move("cart-comes", "The noon bell.")]]).fetch, apiKey: "test" });
  assert.match(bell.log[0]!.result, /^error: your reason says nothing of what happened, so \[cart-comes\] stays as it is\. Say in a sentence what happened in the story that takes it \(for a cue, what brings it about now: its moment come, or its outer limit run out\); if nothing has, leave it\.$/);
});

test("a cue's reason that says its moment hasn't come is refused, one that says the cue hasn't rung yet is its own once it's overdue; a reason that says it's still to come is refused (QA round qa3-1018)", async () => {
  for (const why of [
    "Not yet: the midnight bell has not rung, and Nell is still speaking with Scrope in the counting-box rather than waiting for or watching the Master's arrival.",
    "The ledger is in Nell's hands, so the barge-sailing cue is no longer needed to end the scene; its lines are already drawing taut in the background.",
    "No: nobody is stalling yet.",
  ]) assert.ok(deniesMoment(why), why);
  for (const why of [
    "The eleventh bell is drawing near, but it has not rung in the latest exchange.",
    "The second bell has arrived at the outer limit: the Patience casts off on the ebb with the King's grain aboard while Sallow remains defiant and the Crakes are not yet dealt with.",
    "No one has come for the boy yet, and the twelfth exchange is here: the dead-cart comes.",
  ]) assert.ok(!deniesMoment(why), why);
  // Before it's overdue, a cue's reason that says it hasn't happened says its moment hasn't come (a probe rang the Rat's bell at turn 3 on one); overdue, the move is what rings it.
  const rat = sceneFile("drowned-rat");
  const early = walked(rat, [[2, "arlo-calls-him-out"]], 3);
  const rung = await coGm(rat, early, bookkeeping(early), undefined, { fetch: scripted([[move("bell-rings", "The eleventh bell has not yet rung; Hobb's third refusal has just happened, so there is still time for the player to act.")]]).fetch, apiKey: "test" });
  assert.deepEqual(rung.moves, []);
  assert.match(rung.log[0]!.result, /^error: your reason says its moment hasn't come, so \[bell-rings\] stays as it is: a cue's move says what brings it about now\./);
  const late = walked(rat, [[6, "arlo-calls-him-out"]], 14);
  const rings = await coGm(rat, late, bookkeeping(late), undefined, { fetch: scripted([[move("bell-rings", "The eleventh bell is overdue but has not yet rung: it rings now.")]]).fetch, apiKey: "test" });
  assert.deepEqual(rings.moves.map(m => m.route), ["bell-rings"]);

  for (const why of [
    "Moll's description of Sallow's huge, bandaged-handed companion has reached Kell; she will identify him as Big Hobb Mallory, champion of the Drowned Rat, in the next reply.",
    "Moll had already described the gentleman's huge, bandaged-handed companion calling him 'Master Sallow'; with the loft discovery, Kell can identify that description as Big Hobb Mallory, champion of the Drowned Rat.",
    "After lowering Prout, Corvin has heard the body’s signs of strangulation and a head wound, while Cob’s account identifies the huge porter who was present during the hoisting, with a bandaged right hand; Kell can name him.",
    "Kell is about to name him.",
    "The page is out; once Kell names the big man, the lead is there.",
  ]) assert.ok(stillToCome(why), why);
  for (const why of [
    "The King holds the true book as tangible proof and asks who will stand behind it in front of him, making clear that action requires both something to hold and a witness willing to swear.",
    "Kell has seen Sallow initial the night's page and take his share over the re-sacked King's grain, so she can swear to the theft.",
    "Hobb already told Nell at the Drowned Rat that Master Sallow would come to the Heron tonight.",
    "Kell named him from Cob's description: Big Hobb Mallory, the Drowned Rat's champion.",
  ]) assert.ok(!stillToCome(why), why);
});

test("the companion's role: what an ending records that's hers to do waits until that ending can be taken, and she never says what it waits on (QA round qa3-1018, g05: Kell signed Prout in as a murder four turns before the scene could end on it)", () => {
  const at = (reached: string[]) => companionRoles(clerk, yard({ reached, beat: reached.includes("cart-arrives") ? "cart-arrives" : "start" }))!;
  assert.match(at(["start"]), /\nWhat an ending records that's hers to do \(a death signed in, an arrest made\) waits until the scene can end there: while that way in still needs what hasn't been reached, she doesn't do it, even when asked or pressed\. Until then her role says only that she writes the case down and waits, never why or on what: the GM voices what it's given\. Not open yet: \[signed-murder\] Signed in as murder, which still needs The victim was murdered \[murder\] and Hobb was spotted at the scene \[hobb\]; \[signed-suicide\] [^;\n]*, which still needs Hobb was spotted at the scene \[hobb\]\.$/);
  assert.match(at(["start", "cart-arrives", "murder"]), /Not open yet: \[signed-murder\] Signed in as murder, which still needs Hobb was spotted at the scene \[hobb\]; \[signed-suicide\]/, "g05's turn 15: the murder found, the lead not");
  assert.doesNotMatch(at(["start", "cart-arrives", "murder", "hobb"]), /What an ending records/, "both open: nothing waits");
  // At the Heron (Kell walks with the player from the granary on), her arrest waits on the true book; the endings that name her only in brackets aren't hers.
  const night = walked(heron, [[2, "taken-on"], [4, "find-kings-grain"], [7, "master-comes"]], 9, { reached: ["wharf"], beat: "wharf", history: [{ sceneId: "hanged-clerk" } as TurnView["history"][number]], story: campaignStory() });
  const heronRoles = companionRoles(heron, night)!;
  assert.match(heronRoles, /Not open yet: \[in-the-act\] [^;\n]*, which still needs The proof: the true book \[true-book\]\.$/);
  assert.doesNotMatch(heronRoles, /\[overpowered\]|\[attack\]|\[ablaze\]/);
});

test("roles move on: a line that has been said or answered comes out of the role, and a clock's role names this exchange's one new step, never a menu (QA round qa3-1018: the King's 'What would you have me do?' four times, Tull's 'such as checking the time or readying the sheet' six replies running)", () => {
  const tools = coGmInstructions(clerk, yard()).split("## Your tools\n")[1]!;
  for (const words of [
    "A line someone has said, or a question the player has answered, comes out of their role: don't keep it there, even as done (\"She has already asked 'On what evidence?'\" gets it asked again). Say what they do next instead.",
    "A clock's role (patience running out, a count falling, the minutes going: a corporal waiting on his cart, a forewoman's count, a marshal's watch) names this exchange's one new step, read from the last replies: the step after the last one shown. Never a menu of examples (\"such as checking the time or readying the sheet\"), and never a step already shown.",
    "A move's why says what happened in the story that takes the route, or for a cue what brings it about now: never \"none\", the route's own name, what hasn't happened, or what someone is about to do. A move with such a reason is refused.",
  ]) assert.ok(tools.includes(words), words);
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
  assert.match(closingDirective(caught, true), /^The scene is ending: Kell signs Prout in[\s\S]*set `closes` to false[\s\S]*Otherwise bring the scene to a close[\s\S]*Your last reply's moment has happened[\s\S]*Set `closes` to true\. Those words are how the ending should feel/);
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

test("a talk on the two-part GM: no dice in its reply (a check written anyway is dropped), the companion's lore among the people and the GM's notes on them in the per-turn note and the co-GM's input; the fake co-GM walks a talk only where its recipe says", async () => {
  const template = parseScene(readFileSync(join(CAERWYN, "scenes", "talk.kmscene"), "utf8"), "talk.kmscene");
  const paths = [{ via: "kell", clue: "A pause at the Rat's name.", earn: "Free.", strength: "hook" as const }, { via: "kell", clue: "Nan Quill put her out.", earn: "Asked about it, she tells it.", strength: "strong" as const }];
  const talk = effectiveScene(talkScene(talkSceneId("kell", 1), template)!, [{ turn: 0, why: "the confide", fill: { id: TOLD, revelation: "Nan Quill put her out through the Rat's door.", paths } }]);
  const view = viewAt(talk, talk.start, { id: "two-part-talk", turn: 1, turnsInBeat: 0 });
  delete view.world;
  view.transcript.push({ turn: 1, scene: talk.id, speaker: "player", kind: "player", text: "What's the Rat to you?" });
  note(view.id, { id: "kell", name: "Sergeant Agnes Kell" }, "seen", "Watched the investigator look at the body first.", { origin: { scene: "hanged-clerk", turn: 2 } });

  const instructions = mouthpieceInstructions(talk, view);
  assert.match(instructions, /`check`: always null\. Nothing in a talk is decided by dice/);
  assert.doesNotMatch(instructions, /give the skill and a DC/);
  assert.match(instructions, /### Sergeant Agnes Kell: who they are, in their own lore\nTheir lore is theirs/);
  assert.match(instructions, /### Told \[told\]\nThe revelation: Nan Quill put her out through the Rat's door\.[^]*- Via Sergeant Agnes Kell \[kell\] \(hook\): A pause at the Rat's name\. What earns it: Free\./);
  assert.match(mouthpieceInstructions(clerk, yard()), /give the skill and a DC \(10 easy, 13 moderate, 15 hard, 18 very hard\) instead of deciding it yourself/, "a scene of the story keeps its dice");
  assert.match(twoPartNow(talk, view, []), /## The GM's notes on Sergeant Agnes Kell from play \(what's happened with them\)\n[^#]*Seen the player do:\n- Watched the investigator look at the body first\./);
  assert.doesNotMatch(twoPartNow(clerk, yard(), []), /The GM's notes on/, "a scene of the story's note has none (its co-GM reads them)");
  assert.match(coGmInput(talk, view, undefined)[0]!.content, /# Notes on the people here \(what's happened with them in play\)\n[\s\S]*## Sergeant Agnes Kell \[kell\]\nSeen the player do:\n- Watched the investigator look at the body first\./, "among the notes on the people here, as a scene's co-GM has them");
  assert.match(coGmInstructions(talk, view), /### Sergeant Agnes Kell: who they are, in their own lore/);

  assert.deepEqual(Object.keys((replySchema(false, false) as { properties: object }).properties), ["narration", "check"], "a talk's reply: its narration, and a check that's always null");
  const written = { narration: "Kell's pencil stops.", check: { skill: "insight", dc: 12 }, outcomes: Object.fromEntries(BANDS.map(b => [b, "Kell says more."])) };
  const spoke = await speak(talk, view, [], { operation: "two-part.reply", calls: fake({ byName: { reply: written } }), byKey: m => m });
  assert.deepEqual([spoke.narration.text, spoke.check], ["Kell's pencil stops.", undefined], "a talk has no dice: a check written anyway is dropped");

  const gm = { ...view } as unknown as GmState;
  assert.deepEqual((await coGm(talk, view, gm, undefined, fake())).moves, [], "a talk's ending is the player's to choose, and what she confides hers to give");
  assert.deepEqual((await coGm(talk, view, gm, undefined, fake({ coGm: { endings: [TOLD] } }))).moves.map(m => m.route), [CONFIDED], "walked to what the recipe names");
});
