import { streamReplyArgs } from "../../shared/protocol/ai.ts";
import type { Markup } from "../../shared/markup.ts";

/**
 * The stream (v0-design §5.8): a reply as it's written, posted to the simulation's stream_reply
 * reducer over SpacetimeDB's HTTP API as the AI service's own identity, so every client watching
 * the scene sees the GM's words grow in the turn's draft. Posts go in order, one at a time, at most
 * one a period apart (the first at once): a newer text replaces one still waiting. The draft isn't
 * committed text: a reply restarted from the top (a model's two-phase answer) shrinks and grows
 * again, with seq still rising. A post that fails is logged and forgotten: the answer still goes
 * back, and the commit writes the reply whatever the draft showed.
 */

/** Where the posts go, and as whom. Without a token nothing is posted (the answers still work). */
export interface StreamTarget {
  url: string;
  db: string;
  token?: string | undefined;
  /** At most one post this often (KM_AI_STREAM_MS). */
  periodMs: number;
  fetch?: typeof fetch;
  log(line: string): void;
}

/** A reply's words as they're written, for one turn and one attempt. */
export interface StreamSink {
  /** The words shown so far (the markup taken out) and who says each line: posted when they've changed. */
  show(text: string, markup?: Markup): void;
  /** The final words, posted with done: true; resolves once that post is in (or given up on). */
  finish(text: string, markup?: Markup): Promise<void>;
  /** From the request's start to the first words, or null if there were none. */
  firstTextMs(): number | null;
}

interface Post { text: string; markup?: Markup | undefined; done: boolean }

/** How long the final post may hold the answer back, when SpacetimeDB is slow or gone. */
const FINISH_WAIT_MS = 2_000;

export function streamSink(target: StreamTarget, turn: { turn: string; attempt: number; started: number }): StreamSink {
  let shown: string | undefined;
  let firstAt: number | undefined;
  let waiting: Post | undefined;
  let sending: Promise<void> | undefined;
  let lastSent = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  const send = (post: Post) => postDraft(target, { turn: turn.turn, attempt: turn.attempt, seq: ++seq, ...post });

  /** The waiting post, sent when nothing is in flight and its period is up (a final one at once). */
  const pump = (): void => {
    if (sending || !waiting) return;
    const wait = lastSent + target.periodMs - performance.now();
    if (wait > 0 && !waiting.done) {
      timer ??= setTimeout(() => { timer = undefined; pump(); }, wait);
      return;
    }
    const post = waiting;
    waiting = undefined;
    lastSent = performance.now();
    sending = send(post).finally(() => { sending = undefined; pump(); });
  };

  return {
    show(text, markup) {
      if (text === shown) return;
      shown = text;
      firstAt ??= performance.now();
      waiting = { text, markup, done: false };
      pump();
    },
    async finish(text, markup) {
      clearTimeout(timer);
      timer = undefined;
      firstAt ??= performance.now();
      waiting = { text, markup, done: true };
      pump();
      await settledWithin(drained(() => sending, () => waiting), FINISH_WAIT_MS);
    },
    firstTextMs: () => (firstAt === undefined ? null : Math.round(firstAt - turn.started)),
  };
}

/** One post of the draft. Never throws: a failure is logged. */
async function postDraft(target: StreamTarget, post: { turn: string; attempt: number; seq: number; text: string; markup?: Markup | undefined; done: boolean }): Promise<void> {
  if (!target.token) return;
  const url = `${target.url}/v1/database/${encodeURIComponent(target.db)}/call/stream_reply`;
  try {
    const response = await (target.fetch ?? fetch)(url, {
      method: "POST",
      headers: { authorization: `Bearer ${target.token}`, "content-type": "application/json" },
      body: JSON.stringify(streamReplyArgs({ ...post, speaker: "gm", ...(post.markup ? { markup: post.markup } : {}) })),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) target.log(`[stream] turn ${post.turn} attempt ${post.attempt} seq ${post.seq}: stream_reply answered ${response.status} ${(await response.text()).slice(0, 200)}`);
    else await response.body?.cancel();
  } catch (error) {
    target.log(`[stream] turn ${post.turn} attempt ${post.attempt} seq ${post.seq}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Resolves once nothing is in flight and nothing waits. */
async function drained(sending: () => Promise<void> | undefined, waiting: () => Post | undefined): Promise<void> {
  for (let inFlight = sending(); inFlight || waiting(); inFlight = sending()) await (inFlight ?? new Promise(resolve => setTimeout(resolve, 5)));
}

/** A promise, or the end of a wait, whichever comes first. */
function settledWithin(promise: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<void>(resolve => { timer = setTimeout(resolve, ms); })]).finally(() => clearTimeout(timer));
}
