import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { findReport, listReports, readReport } from "./read.ts";

/** Finding a report (M5: npm run report): by its path, by its bare name in runs/reports or the browser's downloads (the page's only), or the latest; read gzipped or not, and only a game's. */
test("a report is found by its path, its bare name in runs/reports or ~/Downloads, or as latest, and read whether gzipped or not", () => {
  const root = mkdtempSync(join(tmpdir(), "km-reports-"));
  try {
    const places = { reports: join(root, "runs", "reports"), downloads: join(root, "Downloads") };
    mkdirSync(places.reports, { recursive: true });
    mkdirSync(places.downloads, { recursive: true });
    const report = (words: string) => JSON.stringify({ kind: "kingmaker-report", format: 2, words });
    writeFileSync(join(places.reports, "20261018-120000-game1.json.gz"), gzipSync(report("in a terminal")));
    writeFileSync(join(places.downloads, "kingmaker-report-20261018-130000.json.gz"), report("in a page"));
    writeFileSync(join(places.downloads, "holiday-photos.json.gz"), "not ours");
    utimesSync(join(places.reports, "20261018-120000-game1.json.gz"), 1000, 1000);

    assert.equal(readReport(findReport("20261018-120000-game1.json.gz", places)).words, "in a terminal");
    assert.equal(readReport(findReport("report kingmaker-report-20261018-130000.json.gz", places)).words, "in a page", "as the game says it");
    assert.equal(readReport(findReport("latest", places)).words, "in a page");
    assert.deepEqual(listReports(places).map(r => r.file), ["kingmaker-report-20261018-130000.json.gz", "20261018-120000-game1.json.gz"], "the downloads' own only, newest first");
    assert.throws(() => findReport("missing.json.gz", places), /No report "missing\.json\.gz"/);
    assert.throws(() => readReport(join(places.downloads, "holiday-photos.json.gz")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
