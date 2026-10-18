import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { folderVolume } from "../docs/volumes.ts";
import { scenarioPath } from "../../shared/scene/scenario.ts";
import type { AnswerStore, CampaignStore, Ledger, StoredAnswer, Stores, VersionFiles } from "./stores.ts";

/**
 * The stores as one folder (KM_AI_STORE; a volume in the container):
 *
 *   answers/<key, URI-encoded>.json   each answer by its idempotency key
 *   games/<uid>/calls.jsonl           a game's model calls
 *   games/<uid>/memory-reviews.jsonl  a game's memory reviews, a line a reviewed turn
 *   games/<uid>/docs/…                a game's copy of the lore (the docs service's overlay)
 *   ledger.jsonl                      every call's cost
 *   campaigns/<campaign>/<version>/…  each installed version, as it was PUT
 *
 * Whole files are written beside their place and renamed into it, so a crash never leaves half an
 * answer or half a campaign where a reader would take it for the whole.
 */
export function folderStores(root: string): Stores {
  return {
    answers: answerFolder(join(root, "answers")),
    calls: gameLines(join(root, "games"), "calls.jsonl"),
    reviews: gameLines(join(root, "games"), "memory-reviews.jsonl"),
    ledger: ledgerFile(join(root, "ledger.jsonl")),
    campaigns: campaignFolder(join(root, "campaigns")),
    docs: { overlay: game => folderVolume(join(root, "games", game, "docs")) },
  };
}

function answerFolder(dir: string): AnswerStore {
  const file = (key: string) => join(dir, `${encodeURIComponent(key)}.json`);
  return {
    async get(key) {
      try { return JSON.parse(await readFile(file(key), "utf8")) as StoredAnswer; } catch { return undefined; }
    },
    async put(key, answer) {
      await mkdir(dir, { recursive: true });
      const temp = `${file(key)}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(answer));
      await rename(temp, file(key));
    },
    sweep: async (olderThanMs, now = Date.now()) => sweep(dir, now - olderThanMs),
  };
}

/** A file of JSON lines in each game's folder: its calls, its memory reviews. */
function gameLines(gamesDir: string, name: string): { append(game: string, line: Record<string, unknown>): void } {
  return {
    append(game, line) {
      const file = join(gamesDir, game, name);
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, JSON.stringify(line) + "\n");
    },
  };
}

/**
 * The ledger file, and what today's lines in it cost: read on from where the last read ended, whole
 * lines only (one being written is read next time), each counted for the UTC day of its `at`. Reads
 * are one at a time, each from the last one's end.
 */
function ledgerFile(file: string): Ledger {
  let read: Promise<LedgerRead> = Promise.resolve(UNREAD);
  return {
    append(line) {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, JSON.stringify(line) + "\n");
    },
    async spentToday() {
      read = read.then(from => readOn(file, from));
      const { day, spent } = await read;
      return day === new Date().toISOString().slice(0, 10) ? spent : 0;
    },
  };
}

/** How far the ledger has been read (bytes), and the latest day read with what its lines cost. */
interface LedgerRead { offset: number; day: string; spent: number }
const UNREAD: LedgerRead = { offset: 0, day: "", spent: 0 };

/** The lines written since `from`, added in: a ledger that shrank (replaced) is read again from the start; one that can't be read stays as it was. */
async function readOn(file: string, from: LedgerRead): Promise<LedgerRead> {
  try {
    const handle = await open(file, "r");
    try {
      const { size } = await handle.stat();
      const start = size < from.offset ? UNREAD : from;
      const bytes = Buffer.alloc(size - start.offset);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, start.offset);
      const whole = bytes.subarray(0, bytes.subarray(0, bytesRead).lastIndexOf(0x0a) + 1);
      return { offset: start.offset + whole.length, ...daySpent(start, whole.toString("utf8")) };
    } finally {
      await handle.close();
    }
  } catch {
    return from;
  }
}

/** The latest day's spend, with these lines added: a line of an earlier day than the latest read is past, and one that isn't JSON with a cost is skipped. */
function daySpent(from: LedgerRead, lines: string): Pick<LedgerRead, "day" | "spent"> {
  let { day, spent } = from;
  for (const text of lines.split("\n")) {
    const line = parsedLine(text);
    if (!line || line.day < day) continue;
    if (line.day > day) {
      day = line.day;
      spent = 0;
    }
    spent += line.costUsd;
  }
  return { day, spent };
}

function parsedLine(text: string): { day: string; costUsd: number } | undefined {
  try {
    const line = JSON.parse(text) as { at?: unknown; costUsd?: unknown };
    return typeof line.at === "string" && typeof line.costUsd === "number" && Number.isFinite(line.costUsd) ? { day: line.at.slice(0, 10), costUsd: line.costUsd } : undefined;
  } catch {
    return undefined;
  }
}

/** A version is installed when its scenario (<campaign>.kmscenario) is there; re-installing replaces the whole folder. */
function campaignFolder(dir: string): CampaignStore {
  const folder = (campaign: string, version: string) => join(dir, campaign, version);
  return {
    async put(campaign, version, files) {
      const target = folder(campaign, version);
      const staging = `${target}.${randomUUID()}.tmp`;
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(staging, path)), { recursive: true });
        writeFileSync(join(staging, path), text);
      }
      replaceFolder(staging, target);
    },
    files: (campaign, version) => (existsSync(join(folder(campaign, version), scenarioPath(campaign))) ? filesIn(folder(campaign, version)) : undefined),
    list() {
      if (!existsSync(dir)) return [];
      return readdirSync(dir).flatMap(c => readdirSync(join(dir, c)).filter(v => !v.endsWith(".tmp") && existsSync(join(dir, c, v, scenarioPath(c)))).map(v => `${c}@${v}`)).sort();
    },
  };
}

/** A version's folder, read as it is when it's read (a version PUT again is a new folder in its place). */
function filesIn(dir: string): VersionFiles {
  return {
    read: path => (existsSync(join(dir, path)) ? readFileSync(join(dir, path), "utf8") : undefined),
    paths: () => readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/")),
  };
}

/** The new folder in place of the old: the old is moved aside first, so the swap itself is two renames. */
function replaceFolder(staging: string, target: string): void {
  const old = `${target}.${randomUUID()}.tmp`;
  if (existsSync(target)) renameSync(target, old);
  renameSync(staging, target);
  rmSync(old, { recursive: true, force: true });
}

/** Answers older than `before` (ms since the epoch) deleted: how many. */
function sweep(dir: string, before: number): number {
  if (!existsSync(dir)) return 0;
  let swept = 0;
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).mtimeMs >= before) continue;
    rmSync(file, { force: true });
    swept++;
  }
  return swept;
}
