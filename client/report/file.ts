// New (M5: problem reports): a report filed, the client's part and its host's, wherever it's played.
import type { Build, Filed, Report, ReportAsk, Settings } from "../../shared/report/format.ts";
import { gameIn, packReport, reportOf } from "../../shared/report/pack.ts";
import type { Backend } from "../backend.ts";

/**
 * A report of a problem, filed (V16, M5: docs/migration-log.md). The client knows what the player
 * said, where they were, the screens and the errors; its host knows the build and settings it runs
 * as, the keys it knows of, and where a report goes: the terminal's under runs/reports
 * (hosts/reports.ts), the page's to the page, which downloads it (hosts/web/client-worker.tsx). The
 * game is asked of the game's own host (report_game: its rows, and the AI service's own of it).
 */

/** What a host gives the client's reports. */
export interface Reporting {
  build(): Build;
  settings(): Settings;
  /** The keys this host knows of: taken out of the report, as is anything key-shaped. */
  keys(): string[];
  /** The packed report, kept: where it went, in words to pass on. */
  keep(packed: { bytes: Uint8Array; at: string; game?: string }): Promise<Filed>;
}

/** A report filed: the game asked of its host, the report made and packed (every key out), then kept where the host keeps them. */
export async function fileReport(backend: Pick<Backend, "reportGame">, ask: ReportAsk, reporting: Reporting): Promise<Filed> {
  const game = await gameOf(backend, ask.game);
  const keys = reporting.keys();
  const report = reportOf(ask, { build: reporting.build(), settings: reporting.settings(), keys }, game, new Date().toISOString());
  const { bytes } = await packReport(report, keys);
  return reporting.keep({ bytes, at: report.at, ...(ask.game !== undefined ? { game: String(ask.game) } : {}) });
}

/** The game as its host gives it to its owner: none with no game; why not, when it couldn't be asked. */
async function gameOf(backend: Pick<Backend, "reportGame">, game: bigint | undefined): Promise<Report["game"]> {
  if (game === undefined) return undefined;
  if (!backend.reportGame) return { error: "this client has no host to ask for its game (the demo)" };
  return gameIn(await backend.reportGame(game));
}
