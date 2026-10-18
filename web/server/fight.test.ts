import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test, type TestContext } from "node:test";
import * as verbs from "../../client/headless.ts";
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
 * A fight played headless (M6, docs/combat-design.md §7), as an agent or the QA loop plays one: the
 * client's Replica over the port link against the page host (whose jobs run the fight's clock,
 * fight_step, when each of its rows' time comes), and the headless client's own verbs. A ring started
 * (ring), observe saying MODE: fight (whose turn, the order with hit points, the board, the last
 * moments, ACTIONS), the fight's ids taken by act (a move, a blow or a spell, end_turn), each waiting
 * for the other side's turns after it; auto to the end; out back to the map.
 */

const V2 = join(import.meta.dirname, "..", "..");

/** What the build's content.json holds, made from the repo: the campaign's files, the prompts by name, the dev fake (answering at once). */
function repoContent(): Content {
  const prompts = join(V2, "ai", "prompts");
  const names = readdirSync(prompts, { recursive: true, encoding: "utf8" }).filter(path => path.endsWith(".md") && path !== "README.md");
  return {
    campaign: readCampaignFiles(join(V2, "campaigns", "caerwyn")),
    prompts: Object.fromEntries(names.map(path => [relative(prompts, join(prompts, path)).split(sep).join("/").slice(0, -3), readFileSync(join(prompts, path), "utf8")])),
    fake: onTop(devFake(), { streamMs: 0, suggestDelayMs: 0 }),
  };
}

/** What a verb printed, and its progress. */
function printed() {
  const lines: string[] = [];
  return { lines, out: { print: (text: string) => { lines.push(text); }, progress: () => {} }, last: () => lines[lines.length - 1] ?? "" };
}

test("a fight played headless against the page host: ring, observe's MODE: fight, the fight's ids taken by act and the other side's turns after each, auto to the end, out back to the map", { timeout: 120_000 }, async (t: TestContext) => {
  const content = repoContent();
  const storage = await openStorage(memoryDatabase(), () => {});
  const host = await startHost({ model: fakeModel(content.fake), ownerMoves: true, log: () => {} }, storage, content);
  const { port1, port2 } = new MessageChannel();
  host.serve(portDuplex(port2));
  const game = new Replica(portLink(port1, { session: "default" }));
  // Whatever happens, the host's clocks stop and the ports close: a failed assertion doesn't leave the run waiting on them.
  t.after(() => { host.stop(); game.close(); port1.close(); port2.close(); });
  await game.ready;
  assert.equal(await game.newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a sellsword between contracts", build: "fighter" }), undefined);

  // A ring: the fight's first moments up to the player's turn, then MODE: fight.
  const started = printed();
  assert.equal(await verbs.ring(game, "practice", started.out, { fast: true, ms: 30_000 }), 0);
  const first = started.last();
  assert.match(first, /^MODE: fight\n\nThe practice ring \(the Arena\): your turn\. 35 ft to move, action ready, bonus action ready\./);
  assert.match(first, /Order, round 1:\n[▶ ] +\d+ {2}[@B] /);
  assert.match(first, /you \(Wren Ashdown\) +28\/28 HP/);
  assert.match(first, /a bandit +11\/11 HP/);
  assert.match(first, /\n {3}0123456789/, "the board, with its rulers");
  assert.match(first, /What happened:\nRoll for initiative! /);
  // The page host's dice are its own: the bandit may have won initiative and closed in already, and then there's no closing in, but a blow.
  assert.match(first, /\nACTIONS:\n(- .+\n)*- (walk@\d+,\d+: Close in on a bandit \(\d+ ft\)|attack@\d+,\d+: Attack a bandit \(Longsword \+5; 5 ft\))\n/);
  assert.match(first, /- end_turn: End your turn/);
  assert.match(first, /- walk@x,y: Move to any tile marked · \(35 ft left\)/);
  // Observe says the same.
  const looked = printed();
  assert.equal(verbs.observe(game, looked.out), 0);
  assert.equal(looked.last(), first, "observe prints the fight as ring did (its few moments so far all among the last)");
  assert.match(looked.last(), /^MODE: fight/);

  // An id that's no action, refused; a move by its id (the close-in it lists); a blow if it's beside them now; end_turn, and the other side's turn after it.
  const nonsense = printed();
  assert.equal(await verbs.act(game, "fly_away", nonsense.out), 1);
  assert.match(nonsense.last(), /^\(There's no fly_away in the fight: observe lists the actions/);
  const close = /- (walk@\d+,\d+): Close in on a bandit/.exec(first)?.[1];
  const moved = printed();
  if (close) {
    assert.equal(await verbs.act(game, close, moved.out), 0);
    assert.match(moved.last(), /What happened:\nYou (close|step) in on a bandit/);
  }
  const blow = /- (attack@\d+,\d+): Attack a bandit/.exec(close ? moved.last() : first)?.[1];
  if (blow) {
    const struck = printed();
    assert.equal(await verbs.act(game, blow, struck.out), 0);
    assert.match(struck.last(), /What happened:\nYou swing at a bandit(: (a critical hit, )?\d+ damage[.!]|, and miss\.)/);
    assert.match(struck.last(), /\n {4}Longsword: your attack on a bandit: \d+ \+5 = \d+ vs AC 12: (hit|miss|critical hit!)/, "its dice under it");
  }
  if (game.fight?.()?.status === "on") {
    const ended = printed();
    assert.equal(await verbs.act(game, "end_turn", ended.out, { ms: 30_000 }), 0);
    const text = ended.last();
    assert.ok(/— Round \d+: a bandit's turn\./.test(text) || /it's over/.test(text), `the bandit's turn came after it:\n${text}`);
  }

  // auto to the end, then out.
  for (let i = 0; i < 30 && game.fight?.()?.status === "on"; i++) {
    const turned = printed();
    assert.equal(await verbs.act(game, "auto", turned.out, { ms: 30_000 }), 0);
  }
  const over = printed();
  assert.equal(verbs.observe(game, over.out), 0);
  assert.match(over.last(), /^MODE: fight\n\nThe practice ring \(the Arena\): it's over \((victory|surrender|defeat|yielded|fled)\)\. /);
  assert.match(over.last(), /\nACTIONS:\n- out: Back to the map$/);
  const out = printed();
  assert.equal(await verbs.act(game, "out", out.out), 0);
  assert.match(out.lines.join("\n"), /^The practice ring: /);
  assert.match(out.last(), /^MODE: explore/);
  await host.idle();
});
