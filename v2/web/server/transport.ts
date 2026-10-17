import type { ToClient, ToServer } from "../../shared/protocol/port.ts";

/**
 * The page host's end of a client's channel (browser-design §3): the socket analogue, which a host
 * swaps for another without touching what's served over it (connections.ts). Over a MessagePort:
 * the page's channel to its client worker, a test's MessageChannel, or one end of an in-process pair
 * (inProcessPair: both ends in one place, each message a structured clone delivered a moment later,
 * so a test can put latency between them). A host on a network would give a WebSocket's, with a
 * codec (JSON has no bigint).
 */
export interface Duplex {
  send(message: ToClient): void;
  /** The client's messages, from now on (those that came before are held until then, as a port holds them). */
  onMessage(listener: (message: ToServer) => void): void;
  close(): void;
}

/** What a duplex needs of a MessagePort: the page's, Node's (a test's MessageChannel), or an end of an in-process pair. */
export type PortLike = Pick<MessagePort, "postMessage" | "onmessage" | "start" | "close">;

export function portDuplex(port: PortLike): Duplex {
  return {
    send: message => port.postMessage(message),
    onMessage(listener) {
      port.onmessage = event => listener(event.data as ToServer);
      port.start();
    },
    close() {
      port.onmessage = null;
      port.close();
    },
  };
}

/**
 * Two ends of a channel in one place, as a MessageChannel's two ports are: what one end posts, the
 * other hears as a structured clone, in order, `latencyMs` later (held until it listens). Closed,
 * an end neither sends nor hears.
 */
export function inProcessPair(latencyMs = 0): [PortLike, PortLike] {
  const a = new PairEnd(latencyMs), b = new PairEnd(latencyMs);
  a.peer = b;
  b.peer = a;
  return [a as unknown as PortLike, b as unknown as PortLike];
}

/** One end of an in-process pair. */
class PairEnd {
  peer?: PairEnd;
  private listener: ((event: { data: unknown }) => void) | null = null;
  private held: unknown[] = [];
  private open = true;
  private readonly latencyMs: number;

  constructor(latencyMs: number) {
    this.latencyMs = latencyMs;
  }

  get onmessage(): ((event: { data: unknown }) => void) | null {
    return this.listener;
  }

  set onmessage(listener: ((event: { data: unknown }) => void) | null) {
    this.listener = listener;
    this.start();
  }

  postMessage(message: unknown): void {
    if (!this.open) return;
    const data = structuredClone(message);
    setTimeout(() => this.peer?.receive(data), this.latencyMs);
  }

  /** Whatever was held for want of a listener, heard now. */
  start(): void {
    const held = this.held;
    this.held = [];
    for (const data of held) this.receive(data);
  }

  close(): void {
    this.open = false;
    this.listener = null;
  }

  private receive(data: unknown): void {
    if (!this.open) return;
    if (this.listener) this.listener({ data });
    else this.held.push(data);
  }
}
