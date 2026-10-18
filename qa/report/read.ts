// After the prototype's src/report/inspect.ts at 44c6d4a, its finding and reading (findReport, listReports, readDump): the places to look are handed in, where it read them itself.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { REPORT_KIND, type Report } from "../../shared/report/format.ts";

/**
 * A report of a problem found and read (V16, M5): `npm run report` (hosts/report.ts) is told where
 * reports are kept on this machine, runs/reports (the terminal's) and ~/Downloads (the page's), and
 * finds a report by its path, by its bare name in either, or as "latest".
 */

/** Where reports are kept: the terminal's folder, and the browser's downloads (the page's are named kingmaker-report-*). */
export interface Places { reports: string; downloads: string }

/** A report's file from what was said of it: a path; a name in runs/reports or ~/Downloads; "latest", the newest of those. "report <file>", as the game says it, too. */
export function findReport(said: string, places: Places): string {
  const name = said.replace(/^report\s+/, "").trim();
  if (name === "latest") {
    const found = listReports(places)[0];
    if (!found) throw new Error(`No reports in ${places.reports} or ${places.downloads} yet.`);
    return found.path;
  }
  for (const path of [resolve(name), join(places.reports, name), join(places.downloads, name)]) if (existsSync(path) && statSync(path).isFile()) return path;
  throw new Error(`No report "${name}" (looked as given, in ${places.reports} and in ${places.downloads})`);
}

/** The reports on this machine, newest first: runs/reports', and the page's downloads. */
export function listReports(places: Places): Array<{ path: string; file: string; mtimeMs: number }> {
  return [places.reports, places.downloads].flatMap(dir => {
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return []; }
    return names.filter(f => f.endsWith(".json.gz") && (dir === places.reports || f.startsWith("kingmaker-report-")))
      .map(file => ({ path: join(dir, file), file, mtimeMs: statSync(join(dir, file)).mtimeMs }));
  }).sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** A report of the game's as it's made now (format 2): the prototype's (format 1, a game's folder of saves) is read by its own tool, in history. */
export function current(report: Report): Report {
  if (report.format === 2) return report;
  throw new Error(`This is ${report.format === 1 ? "the prototype's report (format 1, from before the game's v2 became the game on 2026-10-17)" : `a report of format ${String(report.format)}`}: this tool reads format 2. The prototype's tool is in history: git show bc2ab1f:src/cli/report.ts (check out bc2ab1f and run npm run report there).`);
}

/** A report's file read: gzipped (or not), JSON, and a report of the game's (its kind). */
export function readReport(path: string): Report {
  const bytes = readFileSync(path);
  const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
  const report = JSON.parse(text) as Report;
  if (report.kind !== REPORT_KIND) throw new Error(`${basename(path)} isn't a Kingmaker report (no "kind": "${REPORT_KIND}")`);
  return report;
}
