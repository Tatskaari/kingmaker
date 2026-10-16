import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AnswerStore, CallLog, CampaignStore, Ledger, StoredAnswer, Stores } from "./stores.ts";

/**
 * The stores as one folder (KM_AI_STORE; a volume in the container):
 *
 *   answers/<key, URI-encoded>.json   each answer by its idempotency key
 *   games/<uid>/calls.jsonl           a game's model calls
 *   games/<uid>/docs/…                a game's copy of the lore (the docs service's overlay)
 *   ledger.jsonl                      every call's cost
 *   campaigns/<campaign>/<version>/…  each installed version, as it was PUT
 *
 * Whole files are written beside their place and renamed into it, so a crash never leaves half an
 * answer or half a campaign where a reader would take it for the whole.
 */
export function folderStores(root: string): Stores & { sweepAnswers(olderThanMs: number, now?: number): number } {
  return {
    answers: answerFolder(join(root, "answers")),
    calls: callFolder(join(root, "games")),
    ledger: ledgerFile(join(root, "ledger.jsonl")),
    campaigns: campaignFolder(join(root, "campaigns")),
    docsRoot: join(root, "games"),
    sweepAnswers: (olderThanMs, now = Date.now()) => sweep(join(root, "answers"), now - olderThanMs),
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
  };
}

function callFolder(gamesDir: string): CallLog {
  return {
    append(game, entry) {
      const file = join(gamesDir, game, "calls.jsonl");
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, JSON.stringify(entry) + "\n");
    },
  };
}

function ledgerFile(file: string): Ledger {
  return {
    append(line) {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, JSON.stringify(line) + "\n");
    },
  };
}

/** A version is installed when its campaign.json is there; re-installing replaces the whole folder. */
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
    root: (campaign, version) => (existsSync(join(folder(campaign, version), "campaign.json")) ? folder(campaign, version) : undefined),
    list() {
      if (!existsSync(dir)) return [];
      return readdirSync(dir).flatMap(c => readdirSync(join(dir, c)).filter(v => !v.endsWith(".tmp") && existsSync(join(dir, c, v, "campaign.json"))).map(v => `${c}@${v}`)).sort();
    },
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
