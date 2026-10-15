# src/report: reports of problems from the game

A player who hits a problem reports it from the game, and the report is everything needed to look into it, in one file. How a player reports one is in src/app/README.md; how to read one, and what's in it, in src/cli/README.md.

```
the game (src/app: b, /report, the Esc menu, the title)
  │  openReport: "What went wrong?" over the screen, kept as it was (src/app/report.ts reads the renderer)
  │  sendReport: the game saved, then
  ▼
fileReport (dump.ts)
  1. makeDump: the words, the build, the settings, where, the screens, the game's files, the errors
  2. packDump: every key taken out (redact.ts), then gzipped (CompressionStream)
  3. the sink: runs/reports/<time>-<game>.json.gz (the terminal app, the server's games),
     or the static build's: to the page, which downloads kingmaker-report-<time>.json.gz
  ▼
npm run report (src/cli/report.ts)
  inspect (inspect.ts): the summary, a call, a snapshot, the world between turns
  restore (restore.ts): its game as a new session, for the QA console and Continue
```

| file | what it does |
|---|---|
| `dump.ts` | what a report holds, made from the game's folder and what the app says; packing it; where it goes (`setReportSink`) |
| `redact.ts` | the key never goes in: the keys in use and anything key-shaped, out of all of it; a screen with a key on it isn't kept |
| `recent.ts` | what the files don't have: the errors caught or logged (and the game they were caught in), and the last few screens |
| `inspect.ts` | reading one: finding it (runs/reports, ~/Downloads), the summary, and each part in full |
| `restore.ts` | its game as a session of its own, under a new id |
| `report.test.ts` | keys planted everywhere a report reads, and none surviving; a real game, played with a stand-in for OpenRouter (v2/ai/llm/fake-openrouter.ts), reported, read and restored |

The cost ledger (v2/ai/llm/openrouter.ts) names the game each line is for, so a report can keep its game's lines.
