import { strToU8, zipSync, type Zippable } from "fflate";

const ISSUE_URL = "https://github.com/Tatskaari/kingmaker/issues/new";

export interface IssueReportData {
  description: string;
  generatedAt: string;
  worldState: unknown;
  transcripts: unknown;
  alerts: unknown;
  environment: Record<string, unknown>;
  screenshot?: Uint8Array;
}

export function issueTitle(description: string): string {
  const summary = description.split(/\r?\n/).find(line => line.trim())?.trim().replace(/\s+/g, " ") || "Unexpected game behaviour";
  const available = 120 - "[Bug] ".length;
  return `[Bug] ${summary.length > available ? `${summary.slice(0, available - 1).trimEnd()}…` : summary}`;
}

export function issuePageUrl(description: string): string {
  const url = new URL(ISSUE_URL);
  url.searchParams.set("title", issueTitle(description));
  url.searchParams.set("body", `${description.trim()}\n\n## Diagnostics\n\nA diagnostic ZIP was downloaded when this report was created. Please drag it into this issue before submitting. It contains the world state, recent model transcripts, warnings and errors, environment details, and a screenshot of the world.`);
  return url.toString();
}

export function issueReportFilename(generatedAt: string): string {
  return `kingmaker-issue-report-${generatedAt.replace(/[:.]/g, "-")}.zip`;
}

export function buildIssueReport(data: IssueReportData): Uint8Array {
  const json = (value: unknown) => strToU8(`${JSON.stringify(value, null, 2)}\n`);
  const files: Zippable = {
    "report.md": strToU8(`# ${issueTitle(data.description)}\n\n${data.description.trim()}\n\nGenerated: ${data.generatedAt}\n`),
    "world-state.json": json(data.worldState),
    "recent-transcripts.json": json(data.transcripts),
    "alerts.json": json(data.alerts),
    "environment.json": json(data.environment),
  };
  if (data.screenshot) files["world.png"] = [data.screenshot, { level: 0 }];
  return zipSync(files, { level: 9 });
}
