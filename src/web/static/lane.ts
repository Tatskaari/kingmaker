import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Page } from "playwright";
import { dbName } from "./persist.ts";
import { DEFAULT_BASE } from "./serve.ts";

/**
 * A game standing by the granary lane's lamp post, by day or at night, for the static build's lamp
 * checks and pictures (src/web/static/check.ts, shoot.ts): made here as the game makes one (offline:
 * the rules engine, no GM), a level-5 wizard (Light among its cantrips, a touch: it stands beside
 * the lamp), as the files the browser keeps; and putting them in a preview's saves (IndexedDB), as
 * the worker keeps them, for the next game to start to read.
 */

/** The lane's lamp post, along from the King's Granary gate, and where the wizard stands by it. */
export const LANE_LAMP = "caerwyn:lamp-post@28,9";
export const BY_THE_LAMP = { x: 29, y: 9 };

export interface SaveFile { path: string; data: string; mtimeMs: number }

const filesIn = (dir: string): string[] => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? filesIn(p) : [p]; });

/** The wizard's game by the lane's lamp post at that time of day, made in `dir` (emptied first). */
export async function laneGame(dir: string, time: "morning" | "night"): Promise<SaveFile[]> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const was = { runs: process.env.KM_RUNS_DIR, key: process.env.OPENROUTER_API_KEY };
  process.env.KM_RUNS_DIR = dir;
  process.env.OPENROUTER_API_KEY = "offline";
  try {
    const { Game: Core } = await import("../../game/play.ts");
    const { town, exploreState } = await import("../../game/town.ts");
    const { mapFights } = await import("../../game/fights.ts");
    const { PREGENS } = await import("../../game/combat/pregen.ts");
    const core = await Core.create({ player: `Vesper Hale: ${PREGENS.wizard!.concept}`, level: 5, build: PREGENS.wizard!.build, explorer: town, fights: mapFights(), seed: 11 });
    exploreState(core.state).at = { ...BY_THE_LAMP };
    core.state.story.time = time;
    core.save();
  } finally {
    if (was.runs === undefined) delete process.env.KM_RUNS_DIR; else process.env.KM_RUNS_DIR = was.runs;
    if (was.key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = was.key;
  }
  return filesIn(dir).map(file => ({ path: `/kingmaker/runs/${relative(dir, file).split("\\").join("/")}`, data: readFileSync(file, "utf8"), mtimeMs: statSync(file).mtimeMs }));
}

/** Files put in a preview's saves (IndexedDB, the database the worker keeps them in for `base`). */
export const putSaves = (page: Page, files: SaveFile[], base = DEFAULT_BASE) => page.evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(${JSON.stringify(dbName(base))}, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files", { keyPath: "path" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      for (const file of ${JSON.stringify(files)}) tx.objectStore("files").put(file);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
})()`);
