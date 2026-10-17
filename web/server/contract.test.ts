import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test, type TestContext } from "node:test";
import { portLink } from "../../client/net/port.ts";
import { Replica } from "../../client/net/replica.ts";
import { readCampaignFiles } from "../../hosts/dev/campaign.ts";
import { devFake, onTop } from "../../hosts/dev/fake.ts";
import { startHost, type PageHost } from "../../hosts/web/page-host.ts";
import type { Content } from "./content.ts";
import { memoryDatabase, type Database } from "./database.ts";
import { fakeModel } from "./model.ts";
import { openStorage, type Storage } from "./sim-store.ts";
import { portDuplex } from "./transport.ts";

/**
 * The contract between the page's two halves, in Node (browser-design §7): the client's Replica over
 * the port link against the page host, over a real MessageChannel (every message a real structured
 * clone, revived on the client's side), on the fake model (hosts/dev/fake.json, its delays taken
 * out). A new game with a ready-made build, the map with its lead, the walk into the yard (what g
 * makes), the opening streamed, then a line with its reply and the suggested lines.
 * Then the server rebuilt from what the database in memory kept, a new client on a new channel, and
 * the game carried on from where it was.
 */

const V2 = join(import.meta.dirname, "..", "..");
const LINE = "Sergeant, who found him?";
const NEXT = "And the Purveyor's office: who keeps it?";

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

/** The page host on the database, as the server worker starts it once it has its tab and content: its lines kept. */
async function pageHost(database: Database, content: Content): Promise<{ host: PageHost; storage: Storage; logs: string[] }> {
  const logs: string[] = [];
  const storage = await openStorage(database, () => {});
  const host = await startHost({ model: fakeModel(content.fake), ownerMoves: true, log: line => logs.push(line) }, storage, content);
  return { host, storage, logs };
}

/** The page's client on a channel of its own to the host (its session "default", as the page's is), and every row event it heard, in order. */
function clientOf(t: TestContext, host: PageHost) {
  const { port1, port2 } = new MessageChannel();
  t.after(() => { port1.close(); port2.close(); });
  host.serve(portDuplex(port2));
  const replica = new Replica(portLink(port1, { session: "default" }));
  const events: string[] = [];
  replica.onEvent((table, op, row) => events.push(`${table} ${op} ${String((row as { turnId?: bigint; id?: bigint }).turnId ?? (row as { id?: bigint }).id ?? "")}`));
  return { replica, events };
}

/** Waits until `done`, looking every 10 ms; a wait that never ends fails, saying what for. */
async function until(done: () => boolean, what: string, ms = 30_000): Promise<void> {
  for (const by = Date.now() + ms; !done(); await new Promise(resolve => setTimeout(resolve, 10))) if (Date.now() > by) throw new Error(`${what}: not in ${ms} ms`);
}

const turn = (replica: Replica, n: number) => replica.rows()?.turns.find(row => row.n === n);
/** A column the client's row types leave out (they pick what the screens read), though the row came with every one. */
const column = (row: object, name: string) => (row as Record<string, unknown>)[name];

test("the page's two halves over a real MessageChannel, on the fake model: a new game, the map, into the yard, the opening streamed, a line with its reply and suggested lines; then the server rebuilt from what was kept, and the game carried on", { timeout: 120_000 }, async t => {
  const database = memoryDatabase();
  const content = repoContent();

  // The first run: the title's rows, a ready-made character, the map and its lead.
  const first = await pageHost(database, content);
  const { replica, events } = clientOf(t, first.host);
  await replica.ready;
  assert.deepEqual(replica.home().campaigns.map(campaign => `${campaign.key}@${campaign.version}`), ["caerwyn@0.1.0"]);
  assert.equal(await replica.newGame({ campaign: "caerwyn", name: "Wren Ashdown", concept: "a quick-witted investigator lent to the case by the King", build: "ranger" }), undefined);
  assert.equal(replica.explore()?.lead?.title, "The Hanged Clerk", "the map, the lead just south");

  // g: the walk to the lead, into the yard, which opens the scene; its opening streams in.
  assert.equal(await replica.walk({ toward: "lead" }), undefined);
  await until(() => turn(replica, 0)?.phase === "done", "the opening");
  const opening = turn(replica, 0)!;
  assert.ok(column(opening, "firstTextAt"), "the opening streamed into its draft");
  assert.ok(events.indexOf(`reply_draft insert ${opening.id}`) >= 0 && events.indexOf(`reply_draft delete ${opening.id}`) > events.indexOf(`reply_draft insert ${opening.id}`), "its draft came, and went as the reply committed");
  assert.ok(replica.view()!.entries.some(entry => /Behind the King’s Granary/.test(entry.text ?? "")), "the fake's first golden reply");

  // A line, its reply and the suggested lines.
  assert.equal(await replica.say(LINE), undefined);
  await until(() => turn(replica, 1)?.phase === "done" && !!replica.rows()?.suggestions.some(line => line.turn === 1), "the line's reply and lines");
  const rows = replica.rows()!;
  assert.deepEqual(rows.transcript.filter(line => line.turn === 1).map(line => line.kind), ["player", "narration"]);
  assert.ok(rows.suggestions.filter(line => line.turn === 1).length >= 3, "three or more lines suggested");
  const seen = replica.view()!;

  // Rebuilt: what the memory database kept, the server started again, a new client on a new channel.
  await first.host.idle();
  replica.close();
  first.host.stop();
  await first.storage.close();
  const second = await pageHost(database, content);
  const again = clientOf(t, second.host);
  await again.replica.ready;
  assert.deepEqual(again.replica.view()!.entries.map(entry => entry.text), seen.entries.map(entry => entry.text), "the scene as it was, the same identity back in its seat");
  assert.equal(again.replica.home().games.length, 1);
  assert.ok(Object.keys(second.storage.ai.kept?.docs ?? {}).length, "the game's copy of the lore kept (the memory reviews' notes)");
  assert.ok(!second.logs.some(line => /campaign caerwyn@0\.1\.0 installed/.test(line)) && first.logs.some(line => /campaign caerwyn@0\.1\.0 installed/.test(line)), "installed once: the second start found it in");

  // The game carried on.
  assert.equal(await again.replica.say(NEXT), undefined);
  await until(() => turn(again.replica, 2)?.phase === "done", "the line after the rebuild");
  const said = again.replica.rows()!.transcript;
  assert.deepEqual(said.filter(line => line.turn === 2).map(line => [line.kind, line.kind === "player" ? line.text : "…"]), [["player", NEXT], ["narration", "…"]]);
  assert.ok(said.filter(line => line.turn === 2).every(line => rows.transcript.every(before => (column(before, "id") as bigint) < (column(line, "id") as bigint))), "the ids carry on");
  await second.host.idle();
  second.host.stop();
  again.replica.close();
});
