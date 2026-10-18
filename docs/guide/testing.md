# Testing the game, and looking into what goes wrong

The checks a change runs are in [ARCHITECTURE.md](../../ARCHITECTURE.md#checking-a-change) and [README.md](../../README.md#testing-it); QA rounds on the GM are the GM loop's ([qa/loop/README.md](../../qa/loop/README.md)). This page is for looking into a problem someone met while playing. (The prototype's testing guide, with its evals and fixtures, is archived in [docs/prototype/guide/testing.md](../prototype/guide/testing.md).)

## Investigating a player's report (for Claude)

When the user says "report <file>", they've hit a problem in the game and reported it (b on the map or in a fight, `/report` in a scene, an Esc menu's Report a problem…, or the title's line: [docs/running.md](../running.md#reporting-a-problem)). The file is everything needed to look into it, gzipped JSON ([shared/report/format.ts](../../shared/report/format.ts)): what they said, when, the build and settings, where they were and the screen as it was (with the last few before it), the game as its host had it (every table's rows of the game, from `report_game`; the AI service's model calls, memory reviews and docs for it; from a page, its server worker's last log lines), and the errors the client caught. The terminal client saves it under `runs/reports/`; a page downloads it, to `~/Downloads`, where the tool looks too. No key is ever in it.

```
the client (client/report: b, /report, an Esc menu, the title)
  │  the question over the screen, the screen kept as it was (attach.ts reads the renderer)
  │  fileReport (file.ts): the game asked of its host (report_game: the game's owner's procedure)
  ▼
the host: SpacetimeDB's module, or the page's server worker
  │  every table's rows of the game (simulation/src/games/tables.ts), then, nothing locked,
  │  the AI service's GET /v1/games/{game}/calls and /docs (each with its keys out)
  ▼
the report (shared/report/pack.ts): every key out, gzipped; kept by the client's host:
  runs/reports/<time>-game<n>.json.gz (hosts/reports.ts), or the page's download
  ▼
npm run report (hosts/report.ts, qa/report)
  inspect: the summary, then a turn, a call, a table, the errors in full
  restore: the game as a new game in a local stack (restore_game, the AI service's PUT /docs)
```

1. **Read it:** `npm run report -- inspect <file>` (a path, or the bare name, looked for in runs/reports and ~/Downloads; `latest` is the newest). Start from their words and the screen as it was, then where they were: the screen and what was over it, the game, its scene, the turn and its phase (a turn under way, or failed), the map's tile, the fight's round. The last turns follow as the player saw them, each with its calls (`#n`), then the errors caught and the failed, slow and every call by operation.
2. **Find the turn it went wrong in,** and the call behind it: `--turn <n>` shows the player's line and what answered it, the reply as the mouthpiece wrote it (with the check it called), the co-GM's roles and moves (each with what came of it: "Not taken yet…", "Reached…"), the stage manager's operations, and the turn's timing and calls; `--turn <scene>:<n>` for an earlier scene, by its row's id or key. `--call <n>` shows exactly what a model was told (its instructions and every message) and what it said.
3. **Look at the state:** `--rows` lists every table with how many rows the game had in it, and `--rows <table>` gives one in full (`gm_state`'s reached nodes and roles, `transcript`, `entity` and the components for the place, `fight` and `fight_event` for a fight). `--docs` lists the game's docs (the GM's notes on each person under `Cast/`), `--docs <path>` gives one; `--errors` every error with its whole stack; `--screens` the last few screens before it; `--calls` every call a line; `--log` a page's host log; `--json` all of it.
4. **Reproduce it:** `npm run report -- restore <file>` makes its game a new game, as it was reported, in a local stack: npm run dev's when it's up, else one it starts in `runs/report-stack` on free ports (on the fake GM unless `--real`; `npm run report -- stack down` stops it). It's restored for a session (`--session <name>`, else `report-<time>`), which it seats in the new game, so `npm run play -- observe --session <name>` (with `--stack` when it's not runs/dev) shows the very moment it was reported, and `play say`, `play act` carry it on; the client's Continue offers it too. A turn that was under way thinks again there, and one that had failed waits for `/retry` (`play retry`). The game it came from is never touched, and a stack without the report's campaign version says so.
5. **Fix the cause,** generally, and keep the moment as a case where there's one to keep (a GM problem: the loop's probe can ask the co-GM or the mouthpiece again on a round's own turns, [qa/loop/README.md](../../qa/loop/README.md)). Say what you found in the report, which turn and call showed it, and what you changed.

A report the prototype made (format 1, before 2026-10-17: a game's folder of saves) is refused, with where its tool is in history (`git show bc2ab1f:src/cli/report.ts`).
