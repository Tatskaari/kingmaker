import type { DocsVolume } from "../docs/config.ts";
import { memoryVolume } from "../docs/volumes.ts";
import { scenarioPath } from "../../shared/scene/scenario.ts";
import type { AnswerStore, CampaignStore, DocsStore, Ledger, StoredAnswer, Stores } from "./stores.ts";

/**
 * The stores in memory (stores.ts), with nothing of Node: a browser's (the page's server worker) and
 * a test's. What the service reads back is held here: the answers, each game's copy of the lore,
 * today's spend and the campaigns as PUT. The logs are only ever written, so they're handed on and
 * not held.
 *
 * A host that keeps the stores between runs (in IndexedDB, written behind) gives a persistence: each
 * write is handed to it as it's made, an answer waits until it's kept, and the stores start from
 * what it kept before. The campaigns aren't handed on: a host that has its versions already (the
 * page's are in its build) gives a campaign store of its own in place of this one's.
 */

/** Where a host keeps the stores between runs. */
export interface Persistence {
  /** What it kept before: the stores start from it. */
  kept?: Kept;
  /** An answer, kept before the store's put returns: with the docs written before it, so a reload never finds an answer without the notes its think wrote. */
  answer(key: string, answer: StoredAnswer): Promise<void>;
  /** Answers swept from the store: kept no longer. */
  forget(keys: string[]): void;
  /** A doc written in a game's copy of the lore. */
  doc(game: string, path: string, text: string): void;
  /** A line in a game's call log, or its memory reviews. */
  line(log: "calls" | "reviews", game: string, line: Record<string, unknown>): void;
  /** A line in the ledger. */
  ledger(line: Record<string, unknown>): void;
}

/** What a host kept: the answers by key, each game's copy of the lore by path, and the ledger's lines (today's are enough). */
export interface Kept {
  answers?: Record<string, StoredAnswer>;
  docs?: Record<string, Record<string, string>>;
  ledger?: Array<Record<string, unknown>>;
}

export function memoryStores(persist?: Persistence): Stores {
  const kept = persist?.kept ?? {};
  return {
    answers: answerMap(kept.answers ?? {}, persist),
    calls: { append: (game, line) => persist?.line("calls", game, line) },
    reviews: { append: (game, line) => persist?.line("reviews", game, line) },
    ledger: dailySpend(kept.ledger ?? [], persist),
    campaigns: campaignMap(),
    docs: docsMaps(kept.docs ?? {}, persist),
  };
}

/** Answers by key, each kept by the host (when there is one) before it's held here. */
function answerMap(kept: Record<string, StoredAnswer>, persist: Persistence | undefined): AnswerStore {
  const answers = new Map(Object.entries(kept));
  return {
    get: async key => answers.get(key),
    async put(key, answer) {
      await persist?.answer(key, answer);
      answers.set(key, answer);
    },
    async sweep(olderThanMs, now = Date.now()) {
      const old = [...answers].filter(([, answer]) => Date.parse(answer.at) < now - olderThanMs).map(([key]) => key);
      for (const key of old) answers.delete(key);
      if (old.length) persist?.forget(old);
      return old.length;
    },
  };
}

/** The ledger as what its latest day's lines cost (UTC), as the folder's reading of its file has it: a line of an earlier day is past, one with no cost skipped. */
function dailySpend(kept: Array<Record<string, unknown>>, persist: Persistence | undefined): Ledger {
  let spent = { day: "", usd: 0 };
  const add = (line: Record<string, unknown>) => {
    const cost = costOf(line);
    if (!cost || cost.day < spent.day) return;
    spent = cost.day > spent.day ? cost : { day: spent.day, usd: spent.usd + cost.usd };
  };
  kept.forEach(add);
  return {
    append(line) {
      add(line);
      persist?.ledger(line);
    },
    spentToday: async () => (spent.day === new Date().toISOString().slice(0, 10) ? spent.usd : 0),
  };
}

const costOf = (line: Record<string, unknown>) =>
  typeof line.at === "string" && typeof line.costUsd === "number" && Number.isFinite(line.costUsd) ? { day: line.at.slice(0, 10), usd: line.costUsd } : undefined;

/** Versions as PUT, each held whole, and installed once it has its scenario (<campaign>.kmscenario): one PUT again replaces it, under the readers already handed out too. */
function campaignMap(): CampaignStore {
  const versions = new Map<string, Map<string, string>>();
  const installed = (id: string) => versions.get(id)?.has(scenarioPath(id.slice(0, id.indexOf("@")))) ?? false;
  return {
    async put(campaign, version, files) {
      versions.set(`${campaign}@${version}`, new Map(Object.entries(files)));
    },
    files(campaign, version) {
      const id = `${campaign}@${version}`;
      if (!installed(id)) return undefined;
      return { read: path => versions.get(id)?.get(path), paths: () => [...versions.get(id)?.keys() ?? []] };
    },
    list: () => [...versions.keys()].filter(installed).sort(),
  };
}

/** Each game's copy of the lore, a volume a game: from what was kept, each write handed on. */
function docsMaps(kept: Record<string, Record<string, string>>, persist: Persistence | undefined): DocsStore {
  const games = new Map<string, DocsVolume>();
  return {
    overlay(game) {
      const made = games.get(game) ?? memoryVolume(new Map(Object.entries(kept[game] ?? {})), (path, text) => persist?.doc(game, path, text));
      games.set(game, made);
      return made;
    },
  };
}
