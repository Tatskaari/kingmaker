import type { OpenRouterMessage } from "../../packages/providers/src/openrouter.js";

type TimelineMessage = { role: string; content?: OpenRouterMessage["content"] };
interface Stamp { timestamp: number; sequence: number }

/** First observation wins, so pending-call updates never move an existing row. */
export class CliTimeline {
  #stamps = new Map<string, Stamp>();
  constructor(private readonly now = Date.now) {}

  record(id: string) {
    if (!this.#stamps.has(id)) this.#stamps.set(id, { timestamp: this.now(), sequence: this.#stamps.size });
  }

  messageIds(messages: readonly TimelineMessage[]): string[] {
    const occurrences = new Map<string, number>();
    return messages.map(message => {
      const key = JSON.stringify([message.role, message.content]);
      const occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1);
      return `message:${key}:${occurrence}`;
    });
  }

  recordMessages(messages: readonly TimelineMessage[]) {
    for (const id of this.messageIds(messages)) this.record(id);
  }

  sort<T extends { timeId: string }>(entries: T[]): T[] {
    return entries.sort((a, b) => {
      const left = this.#stamps.get(a.timeId), right = this.#stamps.get(b.timeId);
      if (!left || !right) return left ? -1 : right ? 1 : 0;
      return left.timestamp - right.timestamp || left.sequence - right.sequence;
    });
  }
}
