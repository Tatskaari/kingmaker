import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test, type TestContext } from "node:test";
import { AppModel } from "../../client/app/model.ts";
import type { FightModel } from "../../client/fight/model.ts";
import { portLink } from "../../client/net/port.ts";
import { Replica } from "../../client/net/replica.ts";
import { readCampaignFiles } from "../../hosts/dev/campaign.ts";
import { devFake, onTop } from "../../hosts/dev/fake.ts";
import { startHost } from "../../hosts/web/page-host.ts";
import type { Content } from "./content.ts";
import { memoryDatabase } from "./database.ts";
import { fakeModel } from "./model.ts";
import { openStorage } from "./sim-store.ts";
import { portDuplex } from "./transport.ts";

/**
 * The fight's screen against the game itself (M6's screen): the client's AppModel over the Replica on
 * the port link to the page host, as the page plays it. A ring started from the map turns the screen
 * to the fight, played from its first moment; skipped to the player's turn, their options are the
 * menu's lines; an attack aimed and done goes to the simulation as its move and comes back as its
 * moments, played; the dice decide the rest; and once it's over, back to the map is the map again.
 * The page host's dice are fixed (DICE), so it's the same fight every run: the player's turn comes,
 * the menu offers an attack (a shot across the ring), and auto plays it on to a victory in round 4.
 */

const V2 = join(import.meta.dirname, "..", "..");
/** The page host's dice: the fight the comment above says. */
const DICE = 1;

function repoContent(): Content {
  const prompts = join(V2, "ai", "prompts");
  const names = readdirSync(prompts, { recursive: true, encoding: "utf8" }).filter(path => path.endsWith(".md") && path !== "README.md");
  return {
    campaign: readCampaignFiles(join(V2, "campaigns", "caerwyn")),
    prompts: Object.fromEntries(names.map(path => [relative(prompts, join(prompts, path)).split(sep).join("/").slice(0, -3), readFileSync(join(prompts, path), "utf8")])),
    fake: onTop(devFake(), { streamMs: 0, suggestDelayMs: 0 }),
  };
}

/** Resolves once `ok` says so, looked at as the app changes and every few milliseconds (the playback moves on with the clock); fails after `ms`. */
function until(app: AppModel, what: string, ok: () => boolean, ms = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const look = () => { if (ok()) { clearTimeout(timer); clearInterval(poll); stop(); resolve(); } };
    const timer = setTimeout(() => { clearInterval(poll); stop(); reject(new Error(`waited ${ms} ms for ${what}`)); }, ms);
    const poll = setInterval(look, 20);
    const stop = app.subscribe(look);
    look();
  });
}

test("the fight's screen against the game: a ring started turns the screen to it, the player's attack aimed from the menu goes as its move and comes back as its moments, the dice decide the rest, and out is the map again", { timeout: 120_000 }, async (t: TestContext) => {
  const content = repoContent();
  const storage = await openStorage(memoryDatabase(), () => {});
  const host = await startHost({ model: fakeModel(content.fake), ownerMoves: true, log: () => {}, seed: DICE }, storage, content);
  const { port1, port2 } = new MessageChannel();
  t.after(() => { port1.close(); port2.close(); });
  host.serve(portDuplex(port2));
  const game = new Replica(portLink(port1, { session: "default" }));
  await game.ready;
  assert.equal(await game.newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a sellsword between contracts", build: "fighter" }), undefined);
  const app = new AppModel(game, { campaign: "caerwyn", intent: "game" });
  t.after(async () => { app.fight?.close(); await host.idle(); host.stop(); game.close(); });
  await until(app, "the map", () => app.screen === "explore");

  // A ring, from the map: the screen turns to the fight, played from its first moment.
  assert.equal(await game.act("startRing", { ring: "practice", fast: true }), undefined);
  await until(app, "the fight's screen", () => app.screen === "fight" && !!app.fight);
  const fight = app.fight as FightModel;
  assert.equal(fight.view.title, "The practice ring");
  assert.ok(fight.player.log.length <= 1 || fight.frame().playing?.event.kind === "start", "played from its start, not all at once");
  // Skipped to the player's turn: their options as the menu's lines.
  fight.skip();
  await until(app, "the player's turn", () => fight.canAct() || fight.view.status !== "on");
  assert.equal(fight.view.status, "on", "the player's turn came, the fight still on");
  fight.openMenu();
  assert.ok(fight.menu, "the menu opens on their turn");
  const names = fight.menu!.entries.map(e => e.name);
  assert.ok(names.includes("End your turn") && names.includes("Dodge"), names.join(", "));
  // The attack the menu offers: it goes as its move and comes back as its moments.
  const before = fight.view.events.length;
  const attack = fight.menu!.entries.findIndex(e => e.name === "Attack");
  assert.ok(attack >= 0, `an attack on the menu: ${names.join(", ")}`);
  fight.chooseFromMenu(attack);
  if (fight.aim) fight.fire();
  await until(app, "the act's moments, and its answer", () => fight.view.events.length > before && !fight.sending);
  assert.equal(fight.status, undefined, `no refusal (${fight.status})`);
  const act = fight.view.events[before]!;
  assert.equal(act.actor, "player");
  assert.equal(act.kind, "attack");
  assert.ok(fight.player.log.some(l => l.seq === act.seq) || !fight.player.caughtUp, "played (or playing)");
  // The dice decide the rest, a turn at a time.
  for (let i = 0; i < 40 && fight.view.status === "on"; i++) {
    fight.skip();
    await until(app, "the player's turn, or the end", () => fight.canAct() || fight.view.status !== "on");
    if (fight.view.status !== "on") break;
    const seen = fight.view.events.length;
    await fight.act("auto");
    await until(app, `the turn played (${fight.status ?? "no refusal"})`, () => fight.view.events.length > seen || fight.view.status !== "on");
  }
  assert.equal(fight.view.status, "over");
  assert.equal(fight.view.outcome, "victory");
  fight.skip();
  assert.equal(fight.player.log[fight.player.log.length - 1]!.kind, "over", "its end in the log");
  // Out: back to the map.
  await fight.out();
  await until(app, "the map again", () => app.screen === "explore" && !app.fight);
});
