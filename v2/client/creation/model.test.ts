import assert from "node:assert/strict";
import { test } from "node:test";
import { refusal } from "../../shared/protocol/refusals.ts";
import { AppModel } from "../app/model.ts";
import { creationRow, LISTS, NEPHEW, NEPHEW_ISSUE, OFFER, OWN } from "../check/rows.ts";
import { StubBackend } from "../check/stub.ts";
import { DEFAULT_CONCEPT, DEFAULT_NAME } from "./words.ts";

/** The creation's model over rows the test sets; each move recorded. */
function making(row = creationRow(), saveMs = 5) {
  const backend = new StubBackend({ creation: row });
  const app = new AppModel(backend, { campaign: "caerwyn", intent: "creation", saveMs });
  return { backend, app, model: app.creation };
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("the concept in: start_creation with the defaults for empty fields (a colon in the name a space), then the creation's screens", async () => {
  const backend = new StubBackend();
  const app = new AppModel(backend, { campaign: "caerwyn", intent: "new" });
  await app.creation.offerBuilds("  ", "");
  assert.deepEqual(backend.moves, [{ name: "startCreation", args: { campaign: "caerwyn", name: DEFAULT_NAME, concept: DEFAULT_CONCEPT, how: "three" } }]);
  assert.equal(app.intent, "creation");

  backend.moves.length = 0;
  await app.creation.offerBuilds("Tamsin: Vell", "a disgraced auditor");
  assert.deepEqual(backend.moves[0]?.args, { campaign: "caerwyn", name: "Tamsin  Vell", concept: "a disgraced auditor", how: "three" });
});

test("a refused concept stays on the create screen, the refusal its error", async () => {
  const backend = new StubBackend();
  backend.answers.startCreation = () => refusal("bad_concept");
  const app = new AppModel(backend, { campaign: "caerwyn", intent: "new" });
  await app.creation.offerBuilds("Tamsin Vell", "x".repeat(301));
  assert.deepEqual([app.intent, app.screen], ["new", "create"]);
  assert.equal(app.creation.error, "(Your character's concept needs to be 300 characters or fewer.)");
});

test("the cards: one chosen by its index, their own made from the one picked out, back to the concept", () => {
  const { backend, model } = making();
  model.pickCard(2);
  assert.equal(model.creation?.index, 2);
  model.makeOwn();
  model.chooseBuild(1);
  model.backToConcept();
  model.chooseBuild(5);
  assert.deepEqual(backend.moves, [
    { name: "makeOwn", args: { from: 2 } }, { name: "chooseBuild", args: { index: 1 } }, { name: "creationBack", args: {} },
  ], "a card that isn't there isn't chosen");
});

test("their own: a pick drawn at once with the class's subclass, sent, and the row's once it's back; the column the screen's", async () => {
  const own = { picks: { speciesId: "orc", classId: "rogue", subclassId: "thief", backgroundId: "criminal" }, option: OWN, lists: LISTS };
  const { backend, model } = making(creationRow({ step: "custom", own }));
  const pick = model.pickOwn({ ...own.picks, classId: "wizard" });
  assert.deepEqual(model.creation?.own?.picks, { speciesId: "orc", classId: "wizard", subclassId: "evoker", backgroundId: "criminal" }, "the thief isn't a wizard's: the wizard's first");
  assert.equal(model.creation?.own?.making, true);
  await pick;
  assert.deepEqual(backend.moves.at(-1), { name: "pickOwn", args: { speciesId: "orc", classId: "wizard", subclassId: "evoker", backgroundId: "criminal" } });
  assert.deepEqual(model.creation?.own?.picks, own.picks, "the row's picks once the move's back (the stub's row didn't change)");

  model.ownColumn(-1);
  assert.equal(model.creation?.own?.column, 3);
  model.takeOwn();
  assert.equal(backend.moves.at(-1)?.name, "takeOwn");
});

test("the box: its text kept as it's typed and saved once typing stops; a move that needs it carries it", async () => {
  const { backend, model } = making(creationRow({ step: "backstory", chosen: OFFER.options[0]! }));
  model.storyTyped("I owe Fat Jory");
  model.storyTyped("I owe Fat Jory three crowns.");
  assert.equal(model.creation?.story, "I owe Fat Jory three crowns.");
  assert.deepEqual(backend.made(), [], "not while typing");
  await wait(20);
  assert.deepEqual(backend.made(), ["setBackstory"], "saved once, when typing stopped");

  model.storyTyped(NEPHEW);
  model.finishStory(NEPHEW);
  await wait(20);
  assert.deepEqual(backend.moves, [{ name: "finishBackstory", args: { text: NEPHEW } }], "Done carries the text; the save waiting for typing to stop isn't sent");
});

test("the box saves after a second's quiet, as set_backstory", async () => {
  const { backend, model } = making(creationRow({ step: "backstory", chosen: OFFER.options[0]! }));
  model.storyTyped("I owe Fat Jory three crowns.");
  await wait(20);
  assert.deepEqual(backend.moves, [{ name: "setBackstory", args: { text: "I owe Fat Jory three crowns." } }]);
});

test("the backstory's words of its own: too long for the GM, nothing to work in; neither is sent", () => {
  const { backend, model } = making(creationRow({ step: "backstory", chosen: OFFER.options[0]! }));
  model.finishStory("word ".repeat(2001));
  assert.equal(model.error, "It's 2,001 words, and the GM reads all of it every turn: cut it to 2,000 or fewer.");
  model.workInStory("   ");
  assert.equal(model.error, "There's nothing in the box to work in yet: write a few notes first, or Draft one.");
  assert.deepEqual(backend.moves, []);
  model.draftStory();
  assert.deepEqual(backend.made(), ["draftBackstory"]);
  assert.equal(model.error, undefined, "a move clears the word");
});

test("a proposal, an issue: taken or left, accepted or rewritten; nothing while the GM is busy", () => {
  const { backend, model } = making(creationRow({ step: "backstory", chosen: OFFER.options[0]!, proposal: { kind: "draft", text: "A draft." } }));
  model.takeProposal();
  model.leaveProposal();
  backend.set({ creation: creationRow({ step: "backstory", chosen: OFFER.options[0]!, story: NEPHEW, issues: [NEPHEW_ISSUE] }) });
  model.acceptFix();
  model.rewriteIssue();
  backend.set({ creation: creationRow({ step: "backstory", chosen: OFFER.options[0]!, busy: "check" }) });
  model.acceptFix();
  model.skipStory();
  model.draftStory();
  assert.deepEqual(backend.made(), ["takeProposal", "leaveProposal", "acceptFix", "rewriteIssue"]);
});
