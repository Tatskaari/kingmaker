// After the prototype's src/report/dump.ts at 44c6d4a: makeDump's parts (the words trimmed, the time, the screens with any keyed one left out) and packDump whole (every key out, the count written in, gzipped with CompressionStream); the build, the settings and the game come from the host here, where it read its own folder and environment.
import { REPORT_FORMAT, REPORT_KIND, type Build, type GameReport, type Report, type ReportAsk, type Settings } from "./format.ts";
import { redact, redactScreen } from "./redact.ts";

/**
 * A report made and packed (V16, M5: docs/migration-log.md): what the client asked for, with the
 * build and the settings its host gives and the game as the host had it, as one object; then as the
 * file's bytes, every key taken out (the keys the host knows of, and anything key-shaped, anywhere
 * in it) and gzipped. No Node: the page's client worker packs one too.
 */

/** The report: the client's part, the host's, and the game (or why it couldn't be had), as it's written before every key comes out; `at`, when it was made (shared reads no clock). */
export function reportOf(ask: ReportAsk, host: { build: Build; settings: Settings; keys: string[] }, game: Report["game"], at: string): Omit<Report, "redacted"> {
  return {
    kind: REPORT_KIND,
    format: REPORT_FORMAT,
    words: ask.words.trim(),
    at,
    build: host.build,
    settings: host.settings,
    where: ask.where,
    screens: screensOf(ask, host.keys),
    ...(game ? { game } : {}),
    errors: ask.errors,
  };
}

/** The screens, with any that has something like a key on it left out (redactScreen). */
function screensOf(ask: ReportAsk, keys: string[]): Report["screens"] {
  return {
    ...(ask.screens.now !== undefined ? { now: redactScreen(ask.screens.now, keys) } : {}),
    recent: ask.screens.recent.map(s => ({ ...s, text: redactScreen(s.text, keys) })),
  };
}

/** A host's answer for the game (report_game's JSON, or why it couldn't be asked), as the report keeps it. */
export function gameIn(answer: string | { text: string }): GameReport | { error: string } {
  if (typeof answer !== "string") return { error: answer.text };
  try {
    const parsed = JSON.parse(answer) as GameReport | { refusal: { text: string } };
    return "refusal" in parsed ? { error: parsed.refusal.text } : parsed;
  } catch (e) {
    return { error: `the host's answer wasn't JSON: ${String(e)}` };
  }
}

/** The report as the file's bytes: every key taken out (those given, and anything key-shaped), the count written in, then gzipped. */
export async function packReport(report: Omit<Report, "redacted">, keys: string[]): Promise<{ bytes: Uint8Array; removed: number }> {
  const { text, removed } = redact(JSON.stringify(report), keys);
  const json = `${text.slice(0, -1)},"redacted":${removed}}`;
  return { bytes: await gzip(json), removed };
}

/** Text gzipped with CompressionStream, which Node and a browser's workers both have. */
async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
