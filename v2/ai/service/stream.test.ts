import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { StreamReplyArgs } from "../../shared/protocol/ai.ts";
import { streamSink } from "./stream.ts";

/** A stand-in for SpacetimeDB's HTTP API: every stream_reply it's sent, with its path and bearer, answering `status`. */
async function standIn(status = 200): Promise<{ url: string; posts: Array<{ path: string; auth: string; args: StreamReplyArgs }>; close(): Promise<void> }> {
  const posts: Array<{ path: string; auth: string; args: StreamReplyArgs }> = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      posts.push({ path: req.url ?? "", auth: req.headers.authorization ?? "", args: JSON.parse(body) as StreamReplyArgs });
      res.writeHead(status).end(status === 200 ? "" : "the reducer refused");
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, posts, close: () => new Promise(resolve => server.close(() => resolve())) };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("a reply streams to stream_reply as the service: the first words at once, then at most one post a period, seq rising, the last done", async () => {
  const stdb = await standIn();
  const logged: string[] = [];
  const sentAt: number[] = [];
  const timing: typeof fetch = (input, init) => { sentAt.push(performance.now()); return fetch(input, init); };
  const sink = streamSink({ url: stdb.url, db: "kingmaker", token: "ai-token", periodMs: 100, fetch: timing, log: l => logged.push(l) }, { turn: "812", attempt: 2, started: performance.now() });

  for (const words of ["The", "The yard", "The yard is", "The yard is quiet", "The yard is quiet."]) { sink.show(words, { speech: [], marks: [] }); await sleep(30); }
  await sink.finish("The yard is quiet.", { speech: [{ start: 0, end: 4, speaker: "kell" }], marks: [] });
  await stdb.close();

  const seqs = stdb.posts.map(p => p.args.seq);
  assert.equal(stdb.posts[0]!.path, "/v1/database/kingmaker/call/stream_reply");
  assert.equal(stdb.posts[0]!.auth, "Bearer ai-token");
  assert.equal(stdb.posts[0]!.args.text, "The");
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1));
  assert.ok(stdb.posts.length < 6, "not every change is posted: newer text replaces what waits");
  assert.ok(sentAt.slice(1, -1).every((at, i) => at - sentAt[i]! >= 99), "a period between posts (the last goes as soon as it can)");
  assert.ok(stdb.posts.every(p => p.args.turnId === 812 && p.args.attempt === 2 && p.args.speaker === "gm"));
  assert.deepEqual(stdb.posts.at(-1)!.args, { turnId: 812, attempt: 2, seq: seqs.length, speaker: "gm", text: "The yard is quiet.", markup: { some: JSON.stringify({ speech: [{ start: 0, end: 4, speaker: "kell" }], marks: [] }) }, done: true });
  assert.deepEqual(logged, []);
  assert.ok((sink.firstTextMs() ?? -1) >= 0);
});

test("the draft may shrink (a reply restarted from the top), and every change is posted in order", async () => {
  const stdb = await standIn();
  const sink = streamSink({ url: stdb.url, db: "kingmaker", token: "t", periodMs: 0, log: () => {} }, { turn: "7", attempt: 1, started: performance.now() });

  sink.show("A long first try that");
  await sleep(20);
  sink.show("Second");
  await sleep(20);
  await sink.finish("Second try, whole.");
  await stdb.close();

  assert.deepEqual(stdb.posts.map(p => [p.args.seq, p.args.text, p.args.done]), [[1, "A long first try that", false], [2, "Second", false], [3, "Second try, whole.", true]]);
  assert.deepEqual(stdb.posts.map(p => p.args.markup), [{ none: [] }, { none: [] }, { none: [] }]);
});

test("a post that fails is logged and forgotten: the reply still finishes", async () => {
  const refusing = await standIn(530);
  const logged: string[] = [];
  const sink = streamSink({ url: refusing.url, db: "kingmaker", token: "t", periodMs: 0, log: l => logged.push(l) }, { turn: "7", attempt: 1, started: performance.now() });
  sink.show("Hello");
  await sink.finish("Hello there.");
  await refusing.close();

  const gone = streamSink({ url: "http://127.0.0.1:9", db: "kingmaker", token: "t", periodMs: 0, log: l => logged.push(l) }, { turn: "8", attempt: 1, started: performance.now() });
  await gone.finish("Nobody hears this.");

  assert.equal(logged.length, 3);
  assert.match(logged[0]!, /530/);
  assert.match(logged[2]!, /turn 8/);
});

test("without a token nothing is posted, and the first words are still timed", async () => {
  let asked = 0;
  const sink = streamSink({ url: "http://127.0.0.1:9", db: "kingmaker", periodMs: 0, fetch: async () => { asked++; return new Response(""); }, log: () => {} }, { turn: "1", attempt: 1, started: performance.now() - 50 });
  sink.show("Hello");
  await sink.finish("Hello.");

  assert.equal(asked, 0);
  assert.ok((sink.firstTextMs() ?? 0) >= 50);
});
