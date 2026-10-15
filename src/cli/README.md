# src/cli: the tools for the command line

| tool | what it's for |
|---|---|
| `npm run scene` (scene.ts) | the scene harness: any scene with any approach, a turn at a time (the root README) |
| `npm run qa` (qa.ts) | the headless QA console: the playable game without its screen, by action id (`npm run qa -- help`) |
| `npm run report` (report.ts) | reports of problems from the game: read one, and restore its game to play on (below) |

## Reports: investigating a problem a player reported

A player who hits a problem reports it from the game (b on the map and in a fight, `/report` in a scene, Report a problem… in the Esc menu, or the title's, about the latest game: src/app/README.md). The game says where the report went: "Saved runs/reports/<file>: tell Claude 'report <file>'". The file is everything needed to look into it: what they said, the build and settings, where they were and the screen, the game's saves, snapshots, model calls and notes, its cost, and the errors caught (src/report/dump.ts). The key is never in it.

```sh
npm run report -- inspect <file>                   # the summary (below)
npm run report -- inspect <file> --turns 8         # more of the last turns
npm run report -- inspect <file> --call 13         # call #13 in full: its prompt (or the decider's state and questions) and its reply
npm run report -- inspect <file> --snapshot 3      # turn 3's snapshot: the scene's state, its transcript, its world from above (--raw: JSON)
npm run report -- inspect <file> --diff 3          # the world from the turn before 3 to 3 (--diff 1 3: between two turns)
npm run report -- inspect <file> --screens         # the last few screens before it, and the one it was reported from
npm run report -- inspect <file> --errors          # every error caught, with its whole stack
npm run report -- inspect <file> --calls           # every call, a line each: when, which turn, how long, what it cost, whether it failed
npm run report -- inspect <file> --world           # the scene's world now, from above
npm run report -- inspect <file> --json            # the whole report, as JSON (for jq)
npm run report -- restore <file> [--as <id>]       # its game as a new session, as it was reported
npm run report -- list                             # the reports on this machine, newest first
npm run report -- make --session <id> "<words>"    # a report from a saved game (a QA session, say), as the game would make one
```

`<file>` is a path; or a name, looked for in runs/reports (`KM_RUNS_DIR`'s) and in ~/Downloads (where the static build's go); or `latest`. "report <file>", as the game puts it, works too.

### Investigating one

1. **Read the summary:** `npm run report -- inspect <file>`. It says, in order:
   - what the player said, when, the build (the commit, with local changes or not; the static build's stamp), the settings (the approach, the glyphs, the terminal's size, the browser), the game and where they were in it: the screen and what was open over it, the mode, the scene, its beat and turn, a turn under way;
   - the screen as it was, as text;
   - the last turns: each player's line; the decider's answers (what stands out first, the quiet ones in brackets); the rules' details and lines (🎲); the path the scene took; the GM's reply; the decision after it; the stage manager's operations, with what came of them in the world (`(not done)` for what it couldn't do); the other calls of the turn; and its timing and cost;
   - on the map, What happens; in a fight, who's where, their hit points and its last lines; in the zoo, the wing, what's been seen and the last thing set off;
   - the world's changes;
   - the errors caught, failed or retried calls, slow calls (8 s or more, or first text after 3 s), and every operation's calls, latency and cost, beside the cost ledger's lines for the game.
2. **Find the turn it went wrong in,** and the call behind it. Each call has a number (#n): `--call n` shows exactly what the model was told and what it said. Calls go with the turn whose player's line their prompt holds.
3. **Look at the world:** `--diff` shows what changed between turns, `--snapshot` the scene as it stood, `--world` where everyone is now.
4. **Play it again:** `npm run report -- restore <file>` makes its game a new session (a new id: nothing is overwritten), at the moment it was reported (a report made mid-turn restores to the save before that turn). Then `npm run qa -- observe --session <id>` and `qa say` / `qa act` to try it, or `npm run game` and Continue (it's the latest game; a zoo visit is the title's zoo).
5. **Fix the cause,** generally, and keep the moment as a case (docs/guide/testing.md: a snapshot from `--snapshot <turn> --raw` is a fixture).

### What's in a report

One file, gzipped JSON (`kind: "kingmaker-report"`, `format: 1`):

- `words`, `at`: what the player said, and when;
- `build`: `host` (terminal, server or static), `commit`, `dirty`, `stamp`, `node`, `platform`, the save formats;
- `settings`: `approach`, `glyphs`, `terminal` (cols and rows), `window` and `userAgent` (in a browser), `offline`, and `env` (the `KM_*` settings and the terminal's: never anything named like a key);
- `where`: the app's `screen`, the `overlay` it came from, `busy` (a turn under way), `over`, `fight` (round, whose turn), `latest` (from the title), and `place` (the mode, scene, beat, turn, time, map and tile, from the files);
- `screens`: `now` (as it was reported) and `recent` (the last few before it);
- `game`: `id`; `files` (`game`, `state`, `app`: what's saved; one that wouldn't parse is kept as `{ unreadable }`); `live` (the game in memory, when a turn was under way); `snapshots` (the last 10); `calls` (`total`, and `kept`: all of them, or the last 300); `memoryReviews`; `repairs`; `docs` (the overlay the game wrote); `ledger` (its lines of the cost ledger); `others` (anything else in its folder: a lock file says a background job was still running);
- `errors`: everything caught or logged (`console.error`, `console.warn`), with its stack;
- `zoo`: a visit's own state;
- `redacted`: how many keys were taken out.

Before it's written, the key in use (and the dev key, if there is one on the machine) and anything shaped like an OpenRouter key (`sk-or-…`) are taken out of all of it, and a screen with a key on it isn't kept (src/report/redact.ts; src/report/report.test.ts plants keys in a call log, a save, the docs, an error and the screen, and fails if one survives).
