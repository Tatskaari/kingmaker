import assert from "node:assert/strict";
import { test } from "node:test";
import { creationRow, FIGHTER, gameRow, OFFER, sheetRow } from "../check/rows.ts";
import { StubBackend } from "../check/stub.ts";
import { YARD } from "../check/fixture.ts";
import { AppModel, screenOf, type ScreenRows } from "./model.ts";

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

test("the app: New game starts at the concept, whatever was being made; one made before isn't the one shown", () => {
  const backend = new StubBackend({ creation: creationRow({ step: "made", gameId: 3n }) });
  const app = new AppModel(backend, { campaign: "caerwyn" });
  app.title.newCharacter();
  assert.equal(app.screen, "create");
  const fresh = app.creation.creation;
  assert.equal(fresh, undefined, "the fields start empty");

  backend.set({ creation: creationRow({ step: "backstory", chosen: OFFER.options[1]! }) });
  assert.equal(app.screen, "create", "still the create screen, until its concept goes in");
  assert.equal(app.creation.creation?.name, "Tamsin Vell", "the fields filled from the one half made");
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
