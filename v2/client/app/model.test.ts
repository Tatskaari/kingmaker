import assert from "node:assert/strict";
import { test } from "node:test";
import { refusal } from "../../shared/protocol/refusals.ts";
import { creationRow, FIGHTER, gameRow, OFFER, sheetRow } from "../check/rows.ts";
import { StubBackend } from "../check/stub.ts";
import { YARD } from "../check/fixture.ts";
import { AppModel, GONE, screenOf, type ScreenRows } from "./model.ts";

/** No creation, no seat, nothing in. */
const none: ScreenRows = { sheet: false, scene: false };
const making = (step: string, more: Partial<NonNullable<ScreenRows["creation"]>> = {}): ScreenRows => ({ ...none, creation: { step, offer: "{}", chosen: "{}", ...more } });

test("the title, and a new character's create screen, whatever the rows hold", () => {
  for (const rows of [none, making("backstory"), { ...none, seat: { gameId: 3n, sceneId: 7n }, sheet: true, scene: true }]) {
    assert.equal(screenOf(rows, "title"), "title");
    assert.equal(screenOf(rows, "new"), "create");
  }
});

test("the character being made: the create screen until there's a concept, the creating screen while the GM measures, picks or writes, else its step", () => {
  assert.equal(screenOf(none, "creation"), "create", "before start_creation");
  assert.equal(screenOf(making("concept"), "creation"), "create", "back at the concept");
  assert.equal(screenOf(making("choose", { busy: "builds", offer: undefined }), "creation"), "creating", "the builds being measured");
  assert.equal(screenOf(making("backstory", { busy: "pick", chosen: undefined }), "creation"), "creating", "the GM picking one");
  assert.equal(screenOf(making("backstory", { busy: "traits" }), "creation"), "creating", "written into the story");
  assert.equal(screenOf(making("choose"), "creation"), "choose");
  assert.equal(screenOf(making("custom", { busy: "own" }), "creation"), "custom", "their own, the engine making it");
  assert.equal(screenOf(making("custom"), "creation"), "custom");
  for (const busy of [undefined, "draft", "work", "check"]) assert.equal(screenOf(making("backstory", { busy }), "creation"), "backstory", `the backstory, busy ${busy}`);
  assert.equal(screenOf(making("made"), "creation"), "create", "made already: a new one starts at the concept");
});

test("the GM's part that came to nothing: back on the create screen, where its note says why", () => {
  assert.equal(screenOf(making("choose", { offer: undefined }), "creation"), "create", "no builds came");
  assert.equal(screenOf(making("backstory", { chosen: undefined }), "creation"), "create", "the GM's pick didn't come");
});

test("the game: its scene once begun and in, the sheet before, the creating screen while the sheet comes, the title with no seat", () => {
  assert.equal(screenOf(none, "game"), "title", "no seat");
  assert.equal(screenOf({ ...none, seat: { gameId: 3n } }, "game"), "creating", "made, its sheet on its way");
  assert.equal(screenOf({ ...none, seat: { gameId: 3n }, sheet: true }, "game"), "created", "the sheet, before setting off");
  assert.equal(screenOf({ ...none, seat: { gameId: 3n, sceneId: 7n }, sheet: true }, "game"), "created", "begun, its scene's rows on their way");
  assert.equal(screenOf({ ...none, seat: { gameId: 3n, sceneId: 7n }, sheet: true, scene: true }, "game"), "scene");
  assert.equal(screenOf({ ...none, seat: { gameId: 3n, sceneId: 7n }, scene: true }, "game"), "scene", "a watcher, who has no sheet");
});

test("the app: a character made goes on to its sheet; choosing again goes back to the builds; /quit goes to the title, the game kept", async () => {
  const backend = new StubBackend({ creation: creationRow({ step: "backstory", chosen: OFFER.options[0]! }) });
  const app = new AppModel(backend, { campaign: "caerwyn", intent: "creation" });
  assert.equal(app.screen, "backstory");

  backend.set({ creation: creationRow({ step: "backstory", busy: "traits", chosen: OFFER.options[0]! }) });
  assert.equal(app.screen, "creating");
  backend.set({ creation: creationRow({ step: "made", gameId: 3n }), seat: { playerId: 9n, gameId: 3n, sceneId: undefined }, sheet: sheetRow(FIGHTER), games: [gameRow(3n, "Tamsin Vell", "heading for The Hanged Clerk", 0, Date.now(), false)] });
  assert.deepEqual([app.intent, app.screen], ["game", "created"]);
  assert.equal(app.creation.madeHere, true);
  assert.match(app.creation.intro ?? "", /^Morning, on the eve of the Assembly\. This morning a palace clerk/);

  backend.answers.chooseAgain = () => { backend.set({ creation: creationRow({ step: "choose" }), seat: undefined, sheet: undefined }); };
  await app.creation.chooseAgain();
  assert.deepEqual([app.intent, app.screen], ["creation", "choose"]);

  backend.set({ creation: creationRow({ step: "made", gameId: 4n }), seat: { playerId: 9n, gameId: 4n, sceneId: 7n }, sheet: sheetRow(FIGHTER) }, YARD);
  app.go("game");
  assert.equal(app.screen, "scene");
  app.scene!.input("/quit");
  assert.equal(app.screen, "title");
  assert.deepEqual(backend.made(), ["chooseAgain"], "/quit makes no move: the game is kept");
});

test("the app: New game starts afresh at the concept, whatever was being made, as the prototype's newCharacter drops its creation", async () => {
  const backend = new StubBackend({ creation: creationRow({ step: "made", gameId: 3n }) });
  const app = new AppModel(backend, { campaign: "caerwyn" });
  app.title.newCharacter();
  assert.equal(app.screen, "create");
  assert.equal(app.creation.creation, undefined, "the fields start empty: one made before isn't this one");

  backend.set({ creation: creationRow({ step: "backstory", chosen: OFFER.options[1]!, story: "I kept the Exchequer's ledgers for nine years." }) });
  assert.deepEqual([app.screen, app.creation.creation], ["create", undefined], "nor is one half made: its name, concept and story aren't this one's");

  await app.creation.offerBuilds("Wren Hale", "a hedge-witch with a crooked hat");
  assert.deepEqual(backend.moves.at(-1), { name: "startCreation", args: { campaign: "caerwyn", name: "Wren Hale", concept: "a hedge-witch with a crooked hat", how: "three", afresh: true } }, "afresh: the simulation keeps nothing of the one before");
  assert.equal(app.intent, "creation");
});

test("a refusal is said on the screen it came on: a line refused in a scene isn't the title's after /quit", async () => {
  const backend = new StubBackend({ seat: { playerId: 9n, gameId: 4n, sceneId: 7n }, sheet: sheetRow(FIGHTER) }, YARD);
  backend.answers.say = () => ({ code: "turn_in_flight", text: "(The GM is still answering.)" });
  const app = new AppModel(backend, { campaign: "caerwyn", intent: "game" });
  await backend.say("Who found him?");
  assert.equal(app.refusal, "(The GM is still answering.)");
  app.scene!.input("/quit");
  assert.deepEqual([app.screen, app.title.error], ["title", undefined]);

  backend.answers.continueGame = () => ({ code: "not_yours", text: "(That isn't one of your games.)" });
  await app.title.resume(gameRow(5n, "Wren Ashdown", "in The Hanged Clerk", 5));
  assert.equal(app.title.error, "(That isn't one of your games.)");
});

test("a refusal on the create screen isn't said again when New game comes back to it, but the same words for a new move are; nor is a word of the model's own", async () => {
  const backend = new StubBackend();
  backend.answers.startCreation = () => refusal("bad_name");
  const app = new AppModel(backend, { campaign: "caerwyn", intent: "new" });
  const long = "Tamsin Vell of the Exchequer, Auditor Extraordinary to the Crown";
  await app.creation.offerBuilds(long, "a disgraced palace auditor");
  assert.equal(app.creation.error, refusal("bad_name").text);

  app.creation.toTitle();
  assert.equal(app.title.error, undefined);
  app.title.newCharacter();
  assert.deepEqual([app.screen, app.creation.error], ["create", undefined], "a fresh form: the refusal was the last one's");
  await app.creation.offerBuilds(long, "a disgraced palace auditor");
  assert.equal(app.creation.error, refusal("bad_name").text, "refused again, in the same words: said again");

  backend.set({ creation: creationRow({ step: "backstory", chosen: OFFER.options[0]! }), refusal: undefined });
  app.go("creation");
  app.creation.workInStory("");
  assert.equal(app.creation.error, refusal("nothing_to_work_in").text);
  app.creation.toTitle();
  app.title.newCharacter();
  assert.equal(app.creation.error, undefined, "the model's own word went with its screen");
});

test("a game gone from under the player (deleted by its host, or the server started again with no data) falls back to the title, which says why", () => {
  const backend = new StubBackend({ seat: { playerId: 9n, gameId: 4n, sceneId: 7n }, sheet: sheetRow(FIGHTER) }, YARD);
  const app = new AppModel(backend, { campaign: "caerwyn", intent: "game" });
  assert.equal(app.screen, "scene");

  backend.set({ seat: undefined, sheet: undefined }, null);
  assert.deepEqual([app.screen, app.title.error], ["title", GONE]);
  app.go("new");
  assert.equal(app.title.error, undefined);
});
