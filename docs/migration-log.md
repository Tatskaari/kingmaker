# The migration to one codebase

On 2026-10-17 the repo stopped being two codebases: the prototype (the "Kingmaker V2 PoC", at the root) and the production game beside it in `v2/`. The milestones:

- **M1:** the prototype is dropped, `v2/` is flattened to the root, and the site's `play/` is the game's browser build (below).
- **M2:** the scenes, re-authored as beats on the two-part GM.
- **M3:** the Obsidian plugin authors them.
- **M4:** problem reports.
- Combat later.

Each entry says what changed, where the old thing is in git history, and why where there was a choice. The prototype's last commit is `bc2ab1f`: `git show bc2ab1f:<path>` shows any file of it.

## M1: v2 is the game

### Removed (in history at `bc2ab1f`)

- `src/`: the prototype's code (app, cli, eval, game, llm and lore shims, report, rules, runtime, web, world), with its component READMEs.
- `scenes/`: its 25 TypeScript scenes and their worlds. The game's campaign has the arc's six as data (`campaigns/caerwyn`).
- `evals/` and `.github/workflows/evals.yml`. The eval history they published stays on gh-pages, and the site still carries it.
- `lore/`: the prototype's copy of the Caerwyn lore, the same Cast, Places and World as `campaigns/caerwyn/lore` (once #661's edits were ported, below), plus its README, the plugin's imported `.kmscene` and `.kmscenario` files and two Objects notes.
- `vendor/`: the prototype's rules engine build (`dnd-srd-engine.js`, its typings, `patch.ts`), its pack and the SRD spells. The game's `vendor/` has the module-ready bundle made from it, the same pack, NOTICE and LICENSE, and the same `spells.json`.
- `assets/fonts/`: byte for byte the game's `web/fonts/`.
- `tools/v2/` (the converters and recorders that ran the prototype: `scene-files` with its hand-written table of each scene's facts and effects in `scenes/`, `map-files`, `v1-campaign`, `export-vocabulary`, `record-v1-golden`, `record-spell-facts`, `module-engine`, `golden-replies.json`), `tools/record-golden.mts`, `tools/ansi2png.py`, `tools/door-options.ts`, `tools/preview.py`, `tools/sheet.py`.
- `moon.yml`, `.moon/`, and the moon check workflow (`check.yml` at `bc2ab1f`).
- The root `package.json`, `package-lock.json` and `tsconfig.json`: the game's took their place.
- `.agents/skills/*` and `.claude/skills` (a link to them): V1-era skills about `packages/`, `scripts/`, `content/` and `AGENTS.md`, none of which is in this repo.

### Moved

- `v2/*` to the root, in one rename-only commit; `v2/docs/*` into `docs/`. `.gitignore` merged: the root's lines, and v2's `runs/`.
- The prototype's docs to [docs/prototype/](prototype/README.md), not edited: its README, ARCHITECTURE.md, `Kingmaker V2 prototype.md`, LOG.md, FINDINGS.md, `design/`, `guide/` and `experiments/`. Their links point where things were.
- The pitch and the roadmap (the user's claude.ai artifacts, as saved) from `src/web/site/` to [web/site/](../web/site/), not edited. Their repo copies are synced there now.
- `.github/workflows/v2.yml` to `check.yml`, named `check`.

### Changed

- **#661's fix to Sergeant Kell's lore** (53f45f3, which only reached the prototype's lore): the campaign's `private.md` and `knowledge/Sallow.md` take the same two edits. The GM's golden calls embed her lore, so the same words are put into them by hand ([ai/gm/golden](../ai/gm/golden/README.md)).
- **The site:** `npm run build:site` ([hosts/web/build-site.ts](../hosts/web/build-site.ts)) builds the pitch, the roadmap and the game's page at `play/` into `dist/site`. It fails if a link swap misses, a claude.ai artifact link is left, or anything like a key is in it. `preview.yml` publishes that site for each PR, its comment linking `play/` and `play/?fake`. `pages.yml` builds main's the same way. `web:serve` and `web:check` serve the page under `/kingmaker/pr-preview/pr-0/play/`.
- **Paths:** every `v2/` path and `cd v2` that code, scripts, CI and the live docs follow. What's left names the prototype's tools in history (`tools/v2/...`), is a copy's provenance (its first line), or is a record (the design docs, `docs/live`). The AI service's READMEs now describe the game alone.
- **The plugin** previews maps with the game's `client/map/render.ts`, and its fixtures read the campaign's lore.

### Judgement calls

- **`.prototools` stays, without moon.** Proto's default Node on this machine is 24.18, and the game needs 26.4 or later; the file pins 26.9 inside the repo.
- **`tools/srd-spells` stays.** It builds and checks `vendor/srd-spells/spells.json`, the only copy now (`--check`: 339 spells against the PDF). The prototype's account of where the words come from is folded into [vendor/srd-spells/README.md](../vendor/srd-spells/README.md).
- **`tools/glyphs` and `assets/glyphs` stay.** The terminal client draws sprites with the Kingmaker Glyphs font when it's installed. `build.py` now writes `web/fonts` and `client/look/kingmaker-glyphs.ts` (the fonts rebuild byte for byte). The npm scripts are back, except `glyphs:check`, whose `kingmaker-check.tsx` has no counterpart in the game.
- **The prototype's README and ARCHITECTURE.md are archived too**, beyond the docs the plan named: they describe only the prototype. ARCHITECTURE.md is new, the game's.
- **The docs service's default lore** (`ai/docs/config.ts`) is the campaign's, in place of the root `lore/`. Two of its test files read the default (the backstory's lore check and the fronts', seven tests), and every host sets its own.
- **`.containerignore` is an allowlist** (package.json, ai/, shared/, vendor/, hosts/ai.ts). The image's build context is the repo's root now, not `v2/`. The image builds and answers its health check on the fake model.
- **The design docs and live records are left as written**, with `v2/x` paths, since they're records of each vertical; two broken links in them are repointed. Provenance comments (a copy's first line) are left too.
- **The plugin's importer tests read the prototype's scenes from history:** `tests/prototype-game.mjs` takes `scenes/`, `lore/` and `package.json` out of `bc2ab1f` with `git archive`. The five-scene conversion test read the user's own checkout before.
- **The plugin's `node:` aliases** point at the game's `web/node` stand-ins. Only fs, os and path exist there, and the renderer imports none of them.
- **`build:site` is a script of its own** beside `build:web`. CI's check job builds the whole site; the browser job plays `build:web`'s page.
- **The preview's comment keeps the old header** (`pr-preview-v2`), so on a PR that had the `/v2/` link the new comment takes its place.
- **`pages.yml` no longer waits on the deleted evals workflow**, and still merges gh-pages' `pr-preview/` and `evals/`.
- **The page's IndexedDB name** keeps its scheme, `kingmaker-v2-web <its folder>`, now `…/play/`. The prototype's page was at `play/` too, with its database named `kingmaker-v2 <the site's root>`. A browser's old prototype games stay apart from the game's, and are left behind.
- **`hosts/ci.test.ts` parses every workflow's run steps**, not only the checks'.
- **The hanged clerk importer** labels new notes `campaigns/caerwyn/...`. The committed examples keep the `v2/` path they were imported from.

### Checked

At the end of M1, from the root: `npm ci`; `npm run check` (the type checks, 951 tests, the screens PASS 712; a first run lost one timing test under load, `ai/service/stream.test.ts`'s "a period between posts", and passed again); `npm run build:site`; `npm run web:check` (PASS, under `/kingmaker/pr-preview/pr-0/play/`, and on `dist/site/play` too); `npm run web:screens` (PASS 712); `npm run campaign -- check campaigns/caerwyn` (no problems); `npm run e2e` in namespace mode (PASS, all 39 steps) and `npm run arc` (15 of 16, as before); the bindings regenerated unchanged; the AI service's image built from the root. From `tools/authoring`: `npm ci`, typecheck, `test:host` (91), build, Playwright (59).

### Reviewed

M1 was reviewed on its own commits before going anywhere, from the worktree's root against `bc2ab1f`:

- **Nothing lost.** Of `bc2ab1f`'s 1,817 files, v2's 998 are all at their new paths (915 byte for byte, 83 with the edits above). Of the other 819, 97 are still at their paths (some, like README.md and package.json, now with the game's), 178 have an identical copy kept (the archived docs, the site's pages, the lore's Cast, Places and World, the fonts, the Objects notes, the engine's typings), and the 544 deleted outright are the prototype's alone: `src/` (378), `evals/` (96), `scenes/` (31), `tools/` (20), `lore/`'s README and the plugin's imported scene files (8), the engine build and `patch.ts`, the evals workflow, moon and the skills, and `v2.yml`, which is `check.yml` now. The two rename commits are renames only, but for `.gitignore`'s merge, and `git log --follow` goes through them. The pitch and the roadmap are byte for byte main's. In the ten goldens, Kell's edits are exactly her lore's two line edits, wherever the recordings quote them.
- **Nothing broken.** Beyond the checks below: the site served at depth (`/kingmaker/pr-preview/pr-7/` and `/kingmaker/`) in Chromium, where the pitch's buttons go to `play/` and `roadmap/`, `play/` asks for a key and starts both workers on the fake GM with every request under its path, and the roadmap's links lead back to the pitch. The workflows parse and point at what exists. The glyph fonts rebuild byte for byte; the bindings regenerate unchanged; the AI service's image, built from the root, holds only `package.json`, `ai/`, `shared/`, `vendor/` and `hosts/ai.ts`, and answers its health as CI asks. Every relative link outside docs/prototype resolves, anchors too.
- **What it changed,** a commit each: `hosts/web/serve.ts`'s first line gave its base as v2's `/v2/`, and run by hand it announced `dist/web` whatever `--dir` it served; four first lines named a design doc at `v2/docs/`, and `ai/gm/fixtures.ts` a recorder that never was at `tools/v2/record-golden.mts`; three READMEs called the game v2; this log was short of the diff (`tools/v2/`'s tables and `v1-campaign`, the seven tests of the docs service's default, what's left of `v2/` paths, the `V2` constants); and docs/research had 65 broken links.
- **Judgement calls.** docs/research's links are repointed rather than left: it's the research behind the game, linked from the README and ARCHITECTURE.md, and every link resolved before M1. Only the targets change, and what only history has gets a permalink at `bc2ab1f`. A first line's doc path is brought up to date but not its provenance: `v2/docs/x.md` becomes `docs/x.md`, while what a copy's first line says of its source, commit and edits stays, but for `serve.ts`'s base, which M1 changed. docs/prototype stays as archived.
- **Checked again,** after the fixes: `npm ci`; `npm run check` (the type checks, 951 of 951 tests, the screens PASS 712, in 44 s); `npm run build:site` (28 files); `npm run build:web` then `npm run web:check` (PASS, 80 checks), and `web:check` on `dist/site/play` (PASS, 80); `npm run web:screens` (PASS 712); `npm run campaign -- check campaigns/caerwyn` (no problems); `npm run e2e` in namespace mode (PASS, all 39 steps, 433 s; run as the review's fixes went in, which change no code the e2e runs). From `tools/authoring`: `npm ci`, typecheck, `test:host` (91 of 91, none skipped), build, Playwright (59 of 59).

### Revisit

- **#661's improvisation guide isn't in the game's GM.** `ai/prompts/gm-improv.md` and `gm-improv-remind.md` are there, but `ai/gm` doesn't send them (the prototype did, with `guide: "improv"`). #661's `scenes/hanged-clerk.ts` half is not ported either: the pay-cob-to-talk route, Kell testing only a case put to her, and Cob's crackle shown once. M2 re-authors the scenes.
- **Prompts nothing in the game loads:** narrator, actor, scribe, judge, player-sim, fight (V13 will want it), and the lite memory's memory-review and memory-scene with `ai/docs/remember.ts`.
- **docs/research and docs/qa** keep their text. The 65 links in docs/research that the move broke (all resolved before it) point where their targets are now: the archive in docs/prototype, the game's files, the campaign's lore (the same docs), or, for what only history has (`src/`, `scenes/`, `evals/`), a GitHub permalink at `bc2ab1f`. docs/prototype's links still point where things were (168 don't resolve): the same repointing would mend them, if the archive is to be edited.
- **The engine's rebuild pipeline is only in history:** the prototype's build, `patch.ts` and `tools/v2/module-engine.mts`. An engine upgrade brings it back.
- **The golden recorders are only in history** (`tools/record-golden.mts`, `tools/v2/record-v1-golden.mts`, `record-spell-facts.mts`). Recording again runs them from a checkout of `bc2ab1f`, where the game was `v2/`.
- **The campaign's converters are only in history:** `tools/v2/scene-files.mts` with its tables in `tools/v2/scenes/`, `map-files.mts` and `v1-campaign.mts` made `campaigns/caerwyn` from the prototype's scenes, and only their output is committed. Making it again runs them from a checkout of `bc2ab1f`; M2's re-authored scenes take their place.
- **`campaigns/caerwyn/vocabulary.json`** was exported from the prototype's 25 scenes (`tools/v2/export-vocabulary.mts`, in history). M2's scenes may change what it needs to be.
- **No counterpart in the game:** the glyph tests (fonts and code against the bitmaps, a sprite one cell wide), `kingmaker-check.tsx`, the sprite gallery, and the frame dump `tools/glyphs/frame.py` draws. `client/look/kingmaker-glyphs.ts` keeps a provenance line the generator drops at its next rebuild.
- **`V2` constants** in `hosts/` and a few tests (`const V2 = resolve(import.meta.dirname, ...)`) name the repo's root. Left as they are.
- **The plugin has no vault in the repo:** the root `lore/` it was installed into is gone, and M3 brings it to `campaigns/caerwyn`. Its `import-main-campaign.mjs` reads the prototype's TypeScript scenes, so it's obsolete once M2 lands.
- **Still only the prototype's** (in history): problem reports (`src/report`, M4), fights on the map (V12) and words typed in a fight (V13), the quick co-GM, the actors approaches, the zoo, and the page's door and lamp pictures.

## M2: the GM loop on the game (QA tooling)

The prototype's GM loop (draft PR #663, branch `claude/gm-loop` at 5f01806) ran blind QA rounds on the prototype's scene harness: persona testers played a scene, a blind reviewer judged each game against a rubric, and I triaged every finding and published a report. Its round half (steps 1 and 2 of its skill) is ported onto the game, so the re-authored scenes and the two-part GM can be played blind as they land. The cases, fixtures and evals half (steps 3 to 5) isn't, yet.

### Ported (from `origin/claude/gm-loop` at 5f01806)

- `evals/loop/rubric.md` and `truth/hanged-clerk.md` to [qa/loop/](../qa/loop/README.md), as they were.
- `evals/loop/personas.json`, each persona with `build` added: the ready-made build nearest them, for when their sentence won't make a character.
- `evals/loop/tester.md` and `reviewer.md` to `qa/loop/brief/`, rewritten for the game's commands, its speakers' names, a later scene's notebook and its handed-on prep, and a command's five-minute timeout.
- `src/eval/loop/{round,play,review,triage,report,html,paths}.ts` to `qa/loop/`, and `cli.ts`'s round commands to [hosts/loop.ts](../hosts/loop.ts) (`npm run loop`), reworked for the game. Each file's first line says what it's after.
- `.claude/workflows/gm-qa-round.js` and the skill (`.agents/skills/kingmaker-gm-loop/SKILL.md` there) to `.claude/workflows/` and `.claude/skills/kingmaker-gm-loop/`, steps 1 and 2 rewritten for the game, steps 3 to 5 marked not ported.
- The scratch adapter that drove the two-part GM through the loop (`kingmaker-scratch/v2/mouthpiece/qa`: `qa`, `char.mts`, `run.mts`'s `writeState`) showed what another runtime needs: a game's state written from its own transcript, and the prep swapped into the pack. The game's record and pack do that; nothing of it is copied.

### New

- **Playing the game:** `start` and `say` (qa/loop/play.ts) drive a dev stack through the headless client's verbs, each game its own session and player. `start` makes the character, takes the story to the game's scene (reach.ts) and prints the opening; `say` plays a line and prints what answered it, as the player saw it.
- **Scenes mixed in a round:** `--scenes hanged-clerk:3,drowned-rat:2,heron-warehouse:2,kings-morning:1`, the arms taking turns within a scene and each persona played on every arm before the next.
- **The loop's stack:** `npm run loop -- stack up [--fake]` runs the dev host in the background (hosts/loop/stack.ts), and `stack down` stops it.
- **The report's calls** come from the stack's call log (`<stack>/ai/games/<uid>/calls.jsonl`), by each call's key; the calls that made the character and ended the scenes on the way are listed apart. The report keeps a copy of each game's log in the round (`calls/<game>.jsonl`), so a round outlives its stack (`--fresh` wipes the stack's store) and its archive is whole.

### Judgement calls

- **The commands' composition root is `hosts/loop.ts`, not `qa/loop/cli.ts`.** The README's rule: the hosts are the only code that reads the environment or argv. qa/ is handed its config (the loop's folder, the stack's connections, its owner's rows, its campaign, its call log), and `qa/imports.test.ts` holds it to that and to its imports (node:, itself, client/, ai/, shared/).
- **An arm is a stack, not a prompt overlay.** The prototype's variants were prompt folders laid over one harness (`KM_PROMPTS_DIR`); the game's AI service takes no overlay. A round's arm names a dev stack's folder, and a candidate is a stack run from another checkout, so any change, prompts or code, can be an arm.
- **The loop has a stack of its own:** `runs/loop-stack` on ports 3330 and 8817, clear of a dev stack being played on (3300), the e2e (3310) and the arc (3320). It's the dev host run detached with `--no-keys`, ready when its screen is in its log. A round can name another (`--stack runs/dev`).
- **A later scene is reached through `end_scene`, not a new reducer.** The owner-only reducer the QA console's `end` calls already ends a scene through a named exit, and the story moves on through its real boundary. The loop picks the exit: the scene's first good or mixed ending, read from the runtime scene the AI service's loader gives (the M2 format's `result`). Today's scenes don't grade their endings, so until M2 an exit of kind progress or persuaded counts as good, leave as bad, and other and combat as ungraded. If the game refuses an exit, the next is tried. No module change, and it works on the fake and on real models.
- **The character is made from the persona's own sentence**, the GM picking the build, with no backstory, as the prototype's harness had none. That's reliable headless (the e2e and `npm run live -- --creation` do it). If it never takes after the backoffs, the persona's ready-made build is used instead, and the record says why.
- **The suggested lines are off for the loop's players.** The testers write their own lines, as the prototype's harness offered none. The rubric judges the GM's replies, not the lines, and it saves a model call a turn.
- **What a tester and a reviewer see:** the narration, the dice lines, the game's own lines, and each spoken line after its speaker's name as the player knew them then. On a player's screen that's the speaker's colour. The notes on marked words are left out, as the prototype loop left out its ⟨⟩ lines (and M2 drops the notes). A quote is checked against the turn's reply with the names or without.
- **A busy turn is waited on, not only retried.** The module already tries a failed model call again every 15 s for ten minutes. A 402 from the key's in-flight cap reaches it as the AI service's 500 model_failed. The headless verbs wait three minutes. So the loop waits on a busy turn a backoff at a time (20, 40, 80, 160 s), carries a failed turn on with `retry_turn`, and logs each wait on the turn with the 402s the call log shows. The day's ceiling (KM_AI_DAILY_USD) isn't waited on.
- **A fight a line brings on** is fought out by the game's stand-in, as fights aren't built yet; the tester sees its line and the aftermath. A scene that ends in a summons (the Heron's) is recorded as it last stood before the seat moved on.
- **The prep is the runtime scene written out loosely.** prep.ts shows today's fields, the M2 format's (truth, clock, a discovery's revelation and paths, the people's roles, graded endings, a route list), and any prose field it doesn't know, under its own name, so a new format drops nothing. The pack adds what the boundary handed on to a later scene (gm_state's adjustments, rewritten opening, lead, owed and absent, read as the stack's owner as the scene opens) and the player's notebook.
- **A say past the limit, or after the scene's end, exits 0,** as the prototype's did, so a tester agent doesn't take the game's answer for a failure and try again. A turn the game couldn't answer even after the waits says so and exits 1, and the tester is told to say the same line again in a minute: a line said again after its turn failed carries that turn on (retry_turn) and isn't said twice.

### Checked

`npm run typecheck`; `npm test` (981 tests, 30 of them qa/'s); `npm run check` (the type checks, 981 tests, the screens PASS 712); `npm run e2e` in namespace mode (PASS, all 39 steps, 438.5 s).

A round on the fake model, played with the commands and no agents (`npm run loop -- stack up --fake`, round `fake1`, kept in `runs/loop/fake1`): two games, the hanged clerk and the Drowned Rat. The Rat's was reached through the hanged clerk's real boundary, ended for QA on `case-made`, the story moved on and the lead walked to. Each game took three lines and a fourth past the limit. Both review packs were built (82 kB and 107 kB). Two hand-written reviews were checked: review-check caught a quote that isn't in its turn, then passed. The triage worksheet was written from, the report built (`runs/loop/fake1/report/`, 2.2 MB, an index and two game pages) and read in Chromium, where a turn's call opens as its own transcript. The round archived to a scratch folder.

On real models (`KM_AI_DAILY_USD=0.2`, the dev key, its own stack folder `runs/loop-real`), round `real1`: a start and two lines in the hanged clerk. The GM made the investigator a human rogue 3 with the sage background from her sentence, and a Persuasion check rolled with its dice line. The cost was $0.0204 in 40 calls: the character $0.0005, the opening $0.0034, and about $0.008 a turn with its background memory reviews. It took 10 s to start and 6 and 10 s a turn, with no waits and no 402s. Its pack and report were built. Then a later scene on real models, round `real2`: the Drowned Rat reached through the hanged clerk, ended on `case-made`, with the boundary's own hand-off in the player's notebook and the Rat's opening the GM's, in 30 s for $0.0120 in 21 calls (the hanged clerk's opening $0.0029, its boundary $0.0026, the Rat's opening $0.0050, notes and the character's pick the rest). On the fake, round `fake2`: the Heron reached through two boundaries in 24 s, and the King's morning through three in 31 s, the last a summons as the Heron's `proof-taken` ends; a line played in the King's morning. Real spend for all of it: $0.0324.

### Revisit

- **The cases, fixtures and evals aren't ported:** `src/eval/loop/{fixture,eval,judge,eval-report,import}.ts`, `evals/loop/{cases,variants,judge.md}`, and the commands `case`, `fixture`, `run`, `run-report`, `rejudge`, `sample` and `import` (a playtest's problem report brought into a round). The game's state is SpacetimeDB's rows and the AI service's stores, not a session folder, so a case would be cut from them, and the GM it replays will be M2's two-part GM.
- **Truth sheets:** only the hanged clerk has one (the prototype's), and the Rat's, the Heron's and the King's morning's packs have the prep alone. When M2's re-authored hanged clerk lands with its own `truth`, the sheet needs bringing in step with it, or retiring.
- **Ending grades before M2** are read from an exit's kind (above): the report shows "ungraded" for the many endings of kind other.
- **The report's "Make it a case" column** waits for the cases.
- **The skill's costs** are from one game of two lines on real models.
