import assert from "node:assert/strict";
import { test } from "node:test";
import { newGameOf, viewWhen, type Backend } from "../backend.ts";
import { YARD } from "../check/fixture.ts";
import { SceneModel } from "./model.ts";
import type { SceneView } from "./view.ts";

/**
 * The screen's model kept to the rows (SceneModel.follow), as the TUI host uses it: the first view
 * comes from the move (a new game's rows), the screen comes up, and only then does the model
 * follow the rows. Whatever changed in between must show.
 */

const GONE = "(The game's server no longer has this game.)";
const LOST = "The GM has lost the thread for a moment: trying again.";

/** A game whose rows the test moves on by hand: `show` changes the view (none: the seat gone) and tells whoever listens, as the connection does. */
function rowsByHand(first: SceneView) {
  let view: SceneView | undefined = first;
  const listeners = new Set<() => void>();
  const game: Backend & { show(next: SceneView | undefined): void } = {
    view: () => view,
    onChange: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    show(next) { view = next; for (const listener of listeners) listener(); },
    newGame: async () => { game.show(opening); return undefined; },
    joinGame: async () => undefined, say: async () => undefined, retry: async () => undefined, setSuggestions: async () => undefined, close: () => {},
    // The rows a scene doesn't read (V1's title and creation's) are empty.
    home: () => ({ games: [], campaigns: [] }), act: async () => undefined,
  };
  return game;
}

/** A new game's rows as new_game's commit brings them: game 2, its opening (turn 0) being written. */
const opening: SceneView = { ...YARD, game: "2", entries: [], phase: "replying", turn: 0, mayType: false };

/** The host's way in: the new game made, and its first view read (hosts/client.tsx seated()). */
async function seated(game: Backend): Promise<SceneView> {
  const before = game.view()?.game;
  assert.equal(await game.newGame(newGameOf("Wren Ashdown: a hedge wizard", "wizard", "caerwyn")), undefined);
  return await viewWhen(game, v => v.game !== before, 1000);
}

/** The screen coming up (createCliRenderer): the rows can move on meanwhile. */
const screenComesUp = () => new Promise(resolve => setTimeout(resolve, 5));

test("an opening that fails while the screen comes up shows as failed: the box takes a line, and /retry carries it on", async () => {
  const game = rowsByHand(YARD);
  const first = await seated(game);
  game.show({ ...opening, phase: "failed", failed: "400 bad_request: campaign caerwyn@0.1.0 isn't installed here" });
  await screenComesUp();

  const asked: string[] = [];
  const scene = new SceneModel(first, { say: text => asked.push(text), retry: () => asked.push("/retry"), setSuggestions: async () => undefined, quit: () => {} });
  scene.follow(game, GONE);

  assert.equal(scene.view.phase, "failed");
  assert.equal(scene.busy(), undefined, "no spinner: the GM isn't speaking");
  assert.equal(scene.sends(), true);
  scene.input("/retry");
  assert.deepEqual(asked, ["/retry"]);
  assert.equal(scene.status, undefined, "not \"Nothing to retry\"");
});

test("a turn's note set while the screen comes up shows; and every change after it", async () => {
  const game = rowsByHand(YARD);
  const first = await seated(game);
  game.show({ ...opening, note: LOST });
  await screenComesUp();

  const scene = new SceneModel(first, { say: () => {}, retry: () => {}, setSuggestions: async () => undefined, quit: () => {} });
  scene.follow(game, GONE);
  assert.equal(scene.view.note, LOST);

  game.show({ ...opening, entries: [{ turn: 0, speaker: "gm", kind: "narration", text: "Kell looks up." }], phase: "done", mayType: true });
  assert.deepEqual([scene.view.phase, scene.view.note, scene.view.mayType], ["done", undefined, true]);
});

test("a connection that has stopped trying sends no line (it waits in the box), and /quit still goes", () => {
  const asked: string[] = [];
  const scene = new SceneModel({ ...YARD, mayType: false, cutOff: true, note: "(The game's server turned this session away: /quit, then start again.)" },
    { say: text => asked.push(text), retry: () => asked.push("/retry"), setSuggestions: async () => undefined, quit: () => asked.push("/quit") });

  assert.equal(scene.sends(), false);
  scene.input("Kell, are you there?");
  scene.input("/quit");
  assert.deepEqual(asked, ["/quit"]);
});

test("a game gone from the server while the screen comes up shows as gone", async () => {
  const game = rowsByHand(YARD);
  const first = await seated(game);
  game.show(undefined);
  await screenComesUp();

  const scene = new SceneModel(first, { say: () => {}, retry: () => {}, setSuggestions: async () => undefined, quit: () => {} });
  scene.follow(game, GONE);
  assert.equal(scene.gone, GONE);
  assert.equal(scene.sends(), false);
});
