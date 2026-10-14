import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorldCase } from "./types.ts";

const CASES_DIR = join(import.meta.dirname, "cases");

/** The labelled cases in evals/world/cases (optionally only some ids). */
export function loadCases(filter?: string[]): WorldCase[] {
  return readdirSync(CASES_DIR).filter(f => f.endsWith(".json")).sort()
    .map(f => JSON.parse(readFileSync(join(CASES_DIR, f), "utf8")) as WorldCase)
    .filter(c => !filter?.length || filter.includes(c.id));
}
