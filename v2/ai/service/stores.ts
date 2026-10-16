/**
 * What the AI service keeps between requests, behind interfaces (v0-design §5.6): it holds nothing of
 * a game in memory, so everything a later request needs is here. V0's are a folder
 * (folder-stores.ts); a hosted service swaps in buckets and tables without touching the endpoints.
 */

/** An answer kept by its idempotency key: the request it answered (by hash) and the body sent back. */
export interface StoredAnswer { requestHash: string; status: 200; body: string; at: string }

/** Answers by key, so a re-dispatched think is answered without calling a model twice. */
export interface AnswerStore {
  get(key: string): Promise<StoredAnswer | undefined>;
  put(key: string, answer: StoredAnswer): Promise<void>;
}

/** Each game's model calls in full (its calls.jsonl). Synchronous, as the model client's log is. */
export interface CallLog { append(game: string, entry: Record<string, unknown>): void }

/** A line per model call, with what it cost, across every game. */
export interface Ledger { append(line: Record<string, unknown>): void }

/** Installed campaign versions, each the whole folder as it was PUT. */
export interface CampaignStore {
  put(campaign: string, version: string, files: Record<string, string>): Promise<void>;
  /** The folder a version's files are in, or undefined when it isn't installed. */
  root(campaign: string, version: string): string | undefined;
  /** The installed versions, "caerwyn@0.1.0". */
  list(): string[];
}

export interface Stores {
  answers: AnswerStore;
  calls: CallLog;
  ledger: Ledger;
  campaigns: CampaignStore;
  /** Where each game's copy of the lore is (the docs service's overlay): <docsRoot>/<game uid>/docs. */
  docsRoot: string;
}
