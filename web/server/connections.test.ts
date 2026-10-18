import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Identity } from "spacetimedb";
import { PROTOCOL, type ToClient, type ToServer } from "../../shared/protocol/port.ts";
import { memoryHost, type MemoryHost } from "../../simulation/src/host/memory.ts";
import { all, caerwynArgs, scriptedAi } from "../../simulation/src/host/testing.ts";
import { serveClient } from "./connections.ts";
import { pushTo, type Push } from "./push.ts";
import { inProcessPair, portDuplex } from "./transport.ts";

/**
 * A client served on its duplex (browser-design §3), over an in-process pair with latency between
 * its ends: its session's identity, its snapshot, its moves made by their names (the player's as
 * itself, the owner's only where the host allows them, nothing else), each move's tx before its
 * answer, a refusal as the answer's rejection and a throw as an error; a client from another build
 * cut off; a disconnect, offline.
 */

/** A page host in small: the hanged clerk installed, each commit pushed, and sessions minting identities as the store does. */
function host(ownerMoves = false) {
  const script = scriptedAi();
  let push: Push | undefined;
  const sim = memoryHost({ ai: script.ai, seed: 7, onCommit: commit => push?.commit(commit) });
  sim.as(sim.owner).installCampaign(caerwynArgs());
  push = pushTo(sim);
  const minted = new Map<string, Identity>();
  const sessions = { session: (name: string) => minted.get(name) ?? minted.set(name, new Identity(BigInt(0x2000 + minted.size))).get(name)! };
  const logs: string[] = [];
  return { sim, push, sessions, logs, served: { sim, push, sessions, ownerMoves, log: (line: string) => logs.push(line) } };
}

/** A client on its own pair (5 ms each way), served: what it heard, and its way of sending. */
function client(t: TestContext, served: Parameters<typeof serveClient>[1]) {
  const [mine, theirs] = inProcessPair(5);
  t.after(() => { mine.close(); theirs.close(); });
  const heard: ToClient[] = [];
  mine.postMessage({ kind: "connect", protocol: PROTOCOL, session: "wren" } satisfies ToServer);
  serveClient(portDuplex(theirs), served);
  mine.onmessage = event => heard.push(event.data as ToClient);
  let id = 0;
  const move = async (name: string, args: unknown): Promise<ToClient & { kind: "answer" }> => {
    const asked = ++id;
    mine.postMessage({ kind: "move", id: asked, name, args } as ToServer);
    await until(() => heard.some(m => m.kind === "answer" && m.id === asked));
    return heard.find((m): m is ToClient & { kind: "answer" } => m.kind === "answer" && m.id === asked)!;
  };
  const call = async (name: string, args: unknown): Promise<ToClient & { kind: "answer" }> => {
    const asked = ++id;
    mine.postMessage({ kind: "call", id: asked, name, args } as ToServer);
    await until(() => heard.some(m => m.kind === "answer" && m.id === asked));
    return heard.find((m): m is ToClient & { kind: "answer" } => m.kind === "answer" && m.id === asked)!;
  };
  return { heard, move, call, send: (message: ToServer) => mine.postMessage(message) };
}

async function until(done: () => boolean, ms = 5000): Promise<void> {
  for (const by = Date.now() + ms; !done(); await new Promise(resolve => setTimeout(resolve, 2))) if (Date.now() > by) throw new Error("not in time");
}

const NEW_GAME = { campaign: "caerwyn", name: "Wren Ashdown", concept: "a hedge wizard from the fens", build: "ranger" };
const playerOf = (sim: MemoryHost) => all(sim.db.player)[0]!;

test("connected as the session's identity (sent before anything waits on it), then the snapshot; the same session is the same identity again", async t => {
  const { served, sessions } = host();
  const wren = client(t, served);
  await until(() => wren.heard.length === 2);

  assert.deepEqual(wren.heard.map(m => m.kind), ["connected", "snapshot"]);
  assert.equal((wren.heard[0] as ToClient & { kind: "connected" }).identity, sessions.session("wren").toHexString());
  const again = client(t, served);
  await until(() => again.heard.length === 2);
  assert.deepEqual(again.heard[0], wren.heard[0]);
});

test("a move's tx goes out before its answer; a refusal is the answer's rejection, in the game's words; a disconnect is offline", async t => {
  const { served, sim } = host();
  const wren = client(t, served);

  const made = await wren.move("newGame", NEW_GAME);
  const answered = wren.heard.indexOf(made);
  assert.equal(made.rejection, undefined);
  assert.ok(wren.heard.slice(0, answered).some(m => m.kind === "tx" && m.changes.some(c => c.table === "game" && c.op === "insert")), "the game's row came first");
  assert.equal(playerOf(sim).online, true, "online since it connected");

  const refused = await wren.move("say", { text: "Hello?" });
  assert.equal(typeof refused.rejection?.text, "string", "a line while the opening is still to come");
  assert.notEqual(refused.rejection?.code, "error", `the simulation's own refusal (${refused.rejection?.code})`);

  wren.send({ kind: "disconnect" });
  await until(() => !playerOf(sim).online);
});

test("only the player's moves are made as the caller: installCampaign, dispatchWaiting and streamReply never; the owner's /end only where the host allows it, and then as the owner", async t => {
  const strict = client(t, host(false).served);
  for (const name of ["installCampaign", "dispatchWaiting", "streamReply", "endScene"]) {
    assert.deepEqual((await strict.move(name, {})).rejection, { code: "error", text: `(There's no move ${name} here.)` }, name);
  }

  const open = client(t, host(true).served);
  const asOwner = await open.move("endScene", { game: 99n, exit: "open-case" });
  assert.equal(asOwner.rejection?.code, "unknown", "made as the owner: past not_admin, to the game it can't find");
});

test("a move that throws is an error, logged, and its transaction rolled back; a client from another build is cut off", async t => {
  const { served, logs } = host();
  const wren = client(t, served);
  const threw = await wren.move("newGame", undefined);
  assert.equal(threw.rejection?.code, "error");
  assert.match(logs.join("\n"), /\[move\] newGame threw/);

  const [mine, theirs] = inProcessPair();
  t.after(() => { mine.close(); theirs.close(); });
  const heard: ToClient[] = [];
  mine.onmessage = event => heard.push(event.data as ToClient);
  serveClient(portDuplex(theirs), served);
  mine.postMessage({ kind: "connect", protocol: PROTOCOL + 1 });
  await until(() => heard.length > 0);
  assert.deepEqual(heard, [{ kind: "status", cutOff: "(The game and its page are from different builds: reload the page.)" }]);
});

test("a call is a procedure, as the caller: report_game's text the answer's value (the host's own report when it has one); a procedure there isn't is a rejection", async t => {
  const { served, sim } = host();
  const wren = client(t, served);
  await wren.move("newGame", NEW_GAME);
  const game = all(sim.db.game)[0]!.id;

  const answered = await wren.call("reportGame", { game });
  assert.equal(answered.rejection, undefined);
  const report = JSON.parse(answered.value!) as { kind: string; id: string };
  assert.deepEqual([report.kind, report.id], ["kingmaker-game", String(game)]);
  assert.equal(JSON.parse((await wren.call("reportGame", { game: 99n })).value!).refusal.code, "unknown");
  assert.deepEqual((await wren.call("pingAi", {})).rejection, { code: "error", text: "(There's no procedure pingAi here.)" });

  const own = client(t, { ...served, reportGame: async (_who, asked) => `{"kind":"the host's own","game":"${asked}"}` });
  assert.equal((await own.call("reportGame", { game })).value, `{"kind":"the host's own","game":"${game}"}`);
});
