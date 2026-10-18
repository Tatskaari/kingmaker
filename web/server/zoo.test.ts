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
 * The zoo in a page with no server (M6): the page host installs it from the build's content beside
 * the campaign, in its simulation alone, and the headless client visits its combat ring through the
 * Replica over the port link, as an agent or the QA loop would: play new --zoo ring's fight up to the
 * player's turn (MODE: fight, the ring's people, the zoo's actions), the title's games not listing the
 * visit, again (a new fight, the same foes), and foes_dogs (the pack of dogs).
 */

const V2 = join(import.meta.dirname, "..", "..");

/** What the build's content.json holds, made from the repo: the campaign and the zoo, the prompts by name, the dev fake (answering at once). */
function repoContent(): Content {
  const prompts = join(V2, "ai", "prompts");
  const names = readdirSync(prompts, { recursive: true, encoding: "utf8" }).filter(path => path.endsWith(".md") && path !== "README.md");
  return {
    campaign: readCampaignFiles(join(V2, "campaigns", "caerwyn")),
    prompts: Object.fromEntries(names.map(path => [relative(prompts, join(prompts, path)).split(sep).join("/").slice(0, -3), readFileSync(join(prompts, path), "utf8")])),
    fake: onTop(devFake(), { streamMs: 0, suggestDelayMs: 0 }),
    zoo: readCampaignFiles(join(V2, "campaigns", "zoo")),
  };
}

function printed() {
  const lines: string[] = [];
  return { lines, out: { print: (text: string) => { lines.push(text); }, progress: () => {} }, last: () => lines[lines.length - 1] ?? "" };
}

test("the zoo in the page: installed beside the campaign, play new --zoo ring's fight with the zoo's actions, again, and other foes", { timeout: 120_000 }, async (t: TestContext) => {
  const content = repoContent();
  const storage = await openStorage(memoryDatabase(), () => {});
  const host = await startHost({ model: fakeModel(content.fake), ownerMoves: true, log: () => {} }, storage, content);
  const { port1, port2 } = new MessageChannel();
  host.serve(portDuplex(port2));
  const game = new Replica(portLink(port1, { session: "default" }));
  t.after(() => { host.stop(); game.close(); port1.close(); port2.close(); });
  await game.ready;
  assert.deepEqual(game.home().campaigns.map(c => c.key).sort(), ["caerwyn", "zoo"], "both installed");

  // A visit: the ring's fight, up to the player's turn.
  const visited = printed();
  assert.equal(await verbs.visitZoo(game, { exhibit: "ring", build: "fighter", fast: true }, visited.out, { ms: 30_000 }), 0);
  const first = visited.last();
  assert.match(first, /^MODE: fight\n\nThe combat ring \(the combat ring\): (your turn\.|it's over)/);
  for (const who of ["you \\(Wren Ashdown\\)", "Sergeant Agnes Kell", "Master Josiah Sallow", "the talking Crake", "the silent Crake"]) assert.match(first, new RegExp(`${who} +\\d+/\\d+ HP`), who);
  assert.match(first, /What happened:\nRoll for initiative! /);
  assert.match(first, /\n- again: Fight it again \(Sallow and the Crakes, everyone whole\)\n- foes_crakes: Fight the Crakes alone instead \(.+\)\n- foes_dogs: Fight a pack of dogs instead \(.+\)$/);
  assert.deepEqual(game.home().games.map(g => g.campaign), ["zoo"], "my_games has the visit, and says it's the zoo's");

  // Again: a new fight with the same foes (at the same pace: the other side's turns at once); then the dogs.
  const fightId = game.fight?.()?.id;
  const again = printed();
  assert.equal(await verbs.act(game, "again", again.out, { ms: 30_000 }), 0);
  assert.notEqual(game.fight?.()?.id, fightId, "a new fight");
  assert.match(again.last(), /Master Josiah Sallow +33\/33 HP/);
  const dogs = printed();
  assert.equal(await verbs.act(game, "foes_dogs", dogs.out, { ms: 30_000 }), 0);
  assert.match(dogs.last(), /a brindle mastiff +5\/5 HP/);
  assert.doesNotMatch(dogs.last(), /Master Josiah Sallow/);
  assert.match(dogs.last(), /\n- again: Fight it again \(A pack of dogs, everyone whole\)\n- foes_sallow: Fight Sallow and the Crakes instead/);
  const wolves = printed();
  assert.equal(await verbs.act(game, "foes_wolves", wolves.out), 1, "no such line-up: no such action");

  await host.idle();
});
