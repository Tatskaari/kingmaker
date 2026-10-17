import type { Kept, Persistence } from "../../ai/service/memory-stores.ts";
import type { StoredAnswer } from "../../ai/service/stores.ts";
import { metaOf, type Records } from "./database.ts";
import type { WriteBehind } from "./write-behind.ts";

/**
 * The AI service's stores kept in the page's database (browser-design §5): the persistence that
 * memoryStores hands each write to (ai/service/memory-stores.ts), written behind with the
 * simulation's rows.
 *
 * - An answer is kept before the service sends it: it goes in with a flush now, in one transaction
 *   with the docs its think wrote and the rows committed so far, so a reload never finds an answer
 *   without the notes its think made (a re-dispatched think is answered from the store).
 * - Each game's copy of the lore, by [game, path], is written behind.
 * - Each game's call log and memory reviews are written behind and capped: the last KEEP_LINES of
 *   each, kept for a report of a problem and never read back here.
 * - The ledger is kept as today's spend (meta's `spent`), which is all the daily ceiling reads.
 *
 * In meta: `spent` ({day, usd}), and `lines`, how many lines each game's log has had.
 */

/** How many lines of each game's call log, and of its memory reviews, are kept (a call's line carries its whole prompt). */
export const KEEP_LINES = 200;

/** Today's spend (UTC), as the ledger's lines add it up. */
interface Spent { day: string; usd: number }

export function aiPersistence(queue: WriteBehind, records: Records): Persistence {
  const meta = metaOf(records);
  let spent = (meta.get("spent") as Spent | undefined) ?? { day: "", usd: 0 };
  const lines = { ...(meta.get("lines") as Record<string, number> | undefined) };

  return {
    kept: keptOf(records, spent),
    async answer(key, answer) {
      queue.put("answers", key, answer);
      await queue.flush();
    },
    forget: keys => keys.forEach(key => queue.delete("answers", key)),
    doc: (game, path, text) => queue.put("docs", [game, path], text),
    line(log, game, line) {
      const n = lines[`${game} ${log}`] ?? 0;
      queue.put("logs", [game, log, n], line);
      if (n >= KEEP_LINES) queue.delete("logs", [game, log, n - KEEP_LINES]);
      lines[`${game} ${log}`] = n + 1;
      queue.put("meta", "lines", { ...lines });
    },
    ledger(line) {
      spent = spentWith(spent, line);
      queue.put("meta", "spent", spent);
    },
  };
}

/** What the stores start from: the answers by key, each game's docs by path, and today's spend as one line of the ledger. */
function keptOf(records: Records, spent: Spent): Kept {
  const docs: Record<string, Record<string, string>> = {};
  for (const [key, text] of records.docs) {
    const [game, path] = key as [string, string];
    (docs[game] ??= {})[path] = text as string;
  }
  return {
    answers: Object.fromEntries(records.answers.map(([key, answer]) => [String(key), answer as StoredAnswer])),
    docs,
    ledger: spent.day ? [{ at: `${spent.day}T00:00:00.000Z`, costUsd: spent.usd }] : [],
  };
}

/** The spend with a ledger line's cost: a later day's starts it again, and a line of an earlier day, or with no cost, leaves it. */
function spentWith(spent: Spent, line: Record<string, unknown>): Spent {
  if (typeof line.at !== "string" || typeof line.costUsd !== "number" || !Number.isFinite(line.costUsd)) return spent;
  const day = line.at.slice(0, 10);
  if (day < spent.day) return spent;
  return day > spent.day ? { day, usd: line.costUsd } : { day, usd: spent.usd + line.costUsd };
}
