import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
process.env.KM_RUNS_DIR = mkdtempSync(join(tmpdir(), "km-app-zoo-"));
process.env.KM_LOOK_MODEL = "off";
process.env.KM_GLYPHS = "ascii";
process.env.OPENROUTER_API_KEY = "offline";
process.env.KM_APP_STEP_MS = "0";
process.env.KM_APP_COMBAT_DELAY_MS = "0";
const { Game } = await import("./game.ts");
const { exploreState } = await import("../game/town.ts");
const { placePlayer, triggerById, triggerTile } = await import("../game/zoo/explorer.ts");
const { ARENAS } = await import("../game/zoo/arenas.ts");
const { ROOMS } = await import("../game/zoo/wings/index.ts");

/**
 * The zoo in the app (no terminal): the title's entry opens a visit on the map, and the next time
 * carries it on; an exhibit's menu sets it off; an arena bell goes to the battlefield and back; a
 * booth's scene opens on the scene screen and comes back to the map through its card.
 */

test("the title's zoo opens a visit on the map, kept apart from the story's games, and carries it on next time", async () => {
  const app = new Game();
  await app.zoo();
  assert.equal(app.screen, "explore");
  assert.ok(app.isZoo);
  assert.match(app.messages.join(" "), /Welcome to the Zoo/);
  assert.match(app.leadTarget()?.label ?? "", /Welcome to the Zoo/);
  const id = app.core!.state.id;
  app.quitToTitle();
  assert.equal(app.zooVisit?.id, id, "the title offers the visit to carry on");
  assert.ok(!app.saves.some(s => s.id === id), "and not as a story game to Continue");
  await app.zoo();
  assert.equal(app.core!.state.id, id);
  assert.equal(app.screen, "explore");
});

test("an exhibit's tile menu sets it off, and what it did plays on the map", async () => {
  const app = new Game();
  await app.zoo();
  const found = triggerById("numbers-bell")!;
  const ex = exploreState(app.core!.state);
  placePlayer(app.core!.state, found.wing.id, found.wing.entry);
  const at = triggerTile(ex, found.wing, found.trigger)!;
  app.openMenu(at, 10, 10);
  const i = app.menu!.actions.findIndex(a => a.id === "use_numbers-bell");
  assert.ok(i >= 0, "the bell's menu offers it");
  await app.chooseFromMenu(i);
  assert.match(app.messages.at(-1) ?? "", /one of everything/);
  const look = app.mapFx()!;
  assert.ok(look, "the wing has a look on the map");
});

test("an arena bell goes to the battlefield, and the fight ends back on the map with a line in the notebook", async () => {
  const app = new Game();
  await app.zoo();
  const found = triggerById("bell-wolves")!;
  placePlayer(app.core!.state, ARENAS["wolves"]!.wing, ARENAS["wolves"]!.outside);
  const at = triggerTile(exploreState(app.core!.state), found.wing, found.trigger)!;
  app.openMenu(at, 10, 10);
  await app.chooseFromMenu(app.menu!.actions.findIndex(a => a.id === "use_bell-wolves"));
  assert.equal(app.screen, "combat");
  assert.ok(app.fight, "the battlefield is up");
  for (let i = 0; i < 80 && !app.core!.currentFight?.result(); i++) await app.combatAct("auto");
  assert.ok(app.core!.currentFight?.result(), "the fight ends");
  await app.afterCombat();
  assert.equal(app.screen, "explore");
  assert.equal(app.core!.state.mode, "explore");
  assert.ok(app.journal.some(j => j.title === "The Arena" && j.lines.length), "a line in the notebook");
});

test("walking into a booth opens its scene; /end takes an ending; its card goes back to the map", async () => {
  const app = new Game();
  await app.zoo();
  const room = ROOMS.find(r => r.sceneId === "zoo-pie-stall")!;
  placePlayer(app.core!.state, room.map, { x: room.door.x, y: room.door.y + 2 });
  await app.walkTo({ x: room.door.x, y: room.door.y - 1 });
  assert.equal(app.screen, "scene");
  assert.equal(app.core!.state.mode, "scene");
  assert.ok(app.lines.some(l => l.kind === "error" && /couldn't open the scene/.test(l.text)), "offline, the GM's opening is an error line");
  await app.input("/end bought");
  assert.ok(app.over?.ready, "the scene is over, and stays up until you go on");
  app.continueScene();
  assert.equal(app.screen, "between");
  assert.match(app.card?.title ?? "", /The Last Pie: over/);
  app.continueFromCard();
  assert.equal(app.screen, "explore");
  assert.equal(exploreState(app.core!.state).map, "zoo-theatre");
});
