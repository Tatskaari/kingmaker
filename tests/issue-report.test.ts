import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync, strFromU8 } from "fflate";
import { buildIssueReport, issuePageUrl, issueReportFilename, issueTitle } from "../apps/web/src/issue-report.js";

test("issue title uses and bounds the first non-empty line", () => {
  assert.equal(issueTitle("\nDoor cannot be opened\nMore detail"), "[Bug] Door cannot be opened");
  assert.equal(issueTitle("x".repeat(200)).length, 120);
});

test("issue page is prefilled and asks for the downloaded report", () => {
  const url = new URL(issuePageUrl("Door cannot be opened\nExpected it to open."));
  assert.equal(url.origin + url.pathname, "https://github.com/Tatskaari/kingmaker/issues/new");
  assert.equal(url.searchParams.get("title"), "[Bug] Door cannot be opened");
  assert.match(url.searchParams.get("body") || "", /drag it into this issue/i);
});

test("report ZIP contains readable diagnostics and optional screenshot", () => {
  const zip = buildIssueReport({
    description: "A courtier vanished", generatedAt: "2026-09-28T12:34:56.000Z",
    worldState: { revision: 3 }, requests: [{ id: 1 }], agentRuns: { "character/Corvin/run": { calls: [] } }, alerts: [], environment: { language: "en" },
    screenshot: new Uint8Array([1, 2, 3]),
  });
  const files = unzipSync(zip);
  assert.deepEqual(JSON.parse(strFromU8(files["world-state.json"]!)), { revision: 3 });
  assert.deepEqual(JSON.parse(strFromU8(files["recent-requests.json"]!)), [{ id: 1 }]);
  assert.equal(files["recent-transcripts.json"], undefined);
  assert.deepEqual(Object.keys(JSON.parse(strFromU8(files["agent-runs.json"]!))), ["character/Corvin/run"]);
  assert.deepEqual(files["world.png"], new Uint8Array([1, 2, 3]));
  assert.equal(issueReportFilename("2026-09-28T12:34:56.000Z"), "kingmaker-issue-report-2026-09-28T12-34-56-000Z.zip");
});
