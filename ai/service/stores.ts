import type { DocsVolume } from "../docs/config.ts";

/**
 * What the AI service keeps between requests, behind interfaces (v0-design §5.6): it holds nothing of
 * a game in memory, so everything a later request needs is here. V0's are a folder
 * (folder-stores.ts); a page's are in memory, kept where its host keeps them (memory-stores.ts); a
 * hosted service swaps in buckets and tables without touching the endpoints. stores.test.ts holds
 * every kind to the same contract.
 */

/** An answer kept by its idempotency key: the request it answered (by hash) and the body sent back. */
export interface StoredAnswer { requestHash: string; status: 200; body: string; at: string }

/** Answers by key, so a re-dispatched think is answered without calling a model twice. */
export interface AnswerStore {
  get(key: string): Promise<StoredAnswer | undefined>;
  put(key: string, answer: StoredAnswer): Promise<void>;
  /** The answers kept longer than `olderThanMs` before `now`, deleted (a host's start does it): how many. */
  sweep?(olderThanMs: number, now?: number): Promise<number>;
}

/**
 * Each game's model calls in full (its calls.jsonl). Appended synchronously, as the model client's
 * log is; read back for a report of a problem (V16: GET /v1/games/{game}/calls).
 */
export interface CallLog {
  append(game: string, entry: Record<string, unknown>): void;
  /** The game's lines, oldest first (a line that isn't JSON is kept as { unreadable }); none for a game with none. */
  read(game: string): Promise<Array<Record<string, unknown>>>;
}

/**
 * Each game's memory reviews (its memory-reviews.jsonl, the prototype's file): a line a reviewed
 * turn, with what the attention filter flagged and what each review it fired changed, or why it
 * failed. Read back as the call log is.
 */
export interface ReviewLog {
  append(game: string, line: Record<string, unknown>): void;
  read(game: string): Promise<Array<Record<string, unknown>>>;
}

/** A line per model call, with what it cost (costUsd) and when (at), across every game. */
export interface Ledger {
  append(line: Record<string, unknown>): void;
  /** What today's (UTC) lines have cost, in dollars: the daily ceiling's measure (budget.ts). */
  spentToday(): Promise<number>;
}

/** An installed version's files, by their paths in it ("scenes/hanged-clerk.kmscene"). */
export interface VersionFiles {
  /** A file's text, or undefined when the version has none at that path. */
  read(path: string): string | undefined;
  /** Every file's path. */
  paths(): string[];
}

/** Installed campaign versions, each the whole folder as it was PUT. */
export interface CampaignStore {
  put(campaign: string, version: string, files: Record<string, string>): Promise<void>;
  /** A version's files, or undefined when it isn't installed. */
  files(campaign: string, version: string): VersionFiles | undefined;
  /** The installed versions, "caerwyn@0.1.0". */
  list(): string[];
}

/** Each game's own copy of the lore, which the docs service reads and writes as it's played (its overlay, docs/config.ts). */
export interface DocsStore {
  overlay(game: string): DocsVolume;
}

export interface Stores {
  answers: AnswerStore;
  calls: CallLog;
  reviews: ReviewLog;
  ledger: Ledger;
  campaigns: CampaignStore;
  docs: DocsStore;
}
