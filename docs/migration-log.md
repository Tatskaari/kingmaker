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

### Dice in tests (2026-10-18)

The user, after a CI run went red on two dice flakes (#673's e2e, whose six Fire Bolts at the watch house door all missed, about one run in a hundred; M6's headless fight, whose page host rolled dice of its own): "we shouldn't be using a real dice roll in tests." Every die a game rolls comes from its `dice` row's seed (the checks, the rules engine, the town's reactions, a fight's), and the seed is `tx.seed()`, drawn once as the game is made. The memory host's was a fixed sequence already; SpacetimeDB's and the page host's were real randomness.

- **SpacetimeDB:** a private table, `dice_seed`, and the owner's reducer `set_dice_seed({ seed })` ([simulation/src/dice-seed.ts](../simulation/src/dice-seed.ts)). While its one row is there, `tx.seed()` is its seed plus how many games it has seeded since (`given`); none takes it away. Anyone else is refused: not_admin, "Only the database's owner may fix the dice." The memory host runs the same reducer and the same `seedOf` (its Caller's `setDiceSeed`), and the wire test holds `setDiceSeed` off the page's wire, beside installCampaign and dispatchWaiting. The bindings are regenerated: the reducer and `DiceSeed`'s type, nothing else.
- **The page host:** `HostConfig.seed`, where the memory host's sequence starts ([hosts/web/page-host.ts](../hosts/web/page-host.ts)). The contract test gives it 7. The page leaves it out and draws one from crypto at each start, as before: nothing web:check plays turns on what its dice give, so the page takes no seed of its own.
- **The e2e:** step 1 fixes the dice (1018) once the campaign is in, and checks that the AI service's `set_dice_seed` is refused. The town's step fixes them again (19) just before its new game, so its first Fire Bolt hits the door (a d20 of 17: 22 against AC 15), and the loop that cast it up to six times is gone; its check says the cast hit. Step 24 fixes its game's (24), and checks that its ruling's check is a natural 1, a failure, where it took success or failure.
- **The arc check** (CI runs it after the e2e) fixes its dice too, once the campaign is in. None of its checks reads a roll yet, but it plays on SpacetimeDB like the e2e.
- **README's rules:** a test never rolls real dice, and asserts what its seed rolls.

#### Judgement calls

- **The seed plus a counter, in a row.** The n-th game made after `set_dice_seed(s)` gets s + n (seeds go to 999,999,999, then round to 0). Reading the row with SQL shows what's fixed and how far it has gone. Taking it away is the same reducer with none.
- **`tx.seed()` itself honours it,** not only `createGame`: both hosts build `seed()` from `seedOf` (the module's `txOf`, the memory host's transactions), so anything that draws a seed later is fixed with it. It counts in the caller's transaction, so a game that's rolled back hands its seed back.
- **A step that checks what its dice gave pins its own game's,** just before it makes the game (the town's, step 24's). Step 1's seed alone makes every run the same, but a step's dice would move whenever a step before it made one game more or fewer, and M2 and M6 change those steps.
- **The outcome is asserted, not the numbers.** The Fire Bolt's line has to end in hit, not say 17 + 5 = 22, and its damage isn't checked; step 24's has to be a natural 1, which fails whatever the wizard's modifier. The other dice lines (step 26's darts, 27's blow, 28's fire, 29's spectacles, 37's Ray of Frost) were never either-or checks: each step is about where a line comes, whatever it rolled, and they stay as they were.
- **The memory host's tests are left as they are,** either-way checks too (hide's success or failure): their dice were never real (the host's own seed, 7 in most).

#### Checked

The type check clean; `npm test`, 954 of 954 (the three new: the owner's alone, the seed and one more a game, and two hosts rolling alike); the campaign check, no problems; the bindings regenerated, the reducer and `DiceSeed` alone. `npm run e2e` in namespace mode on ports 3361 and 8861, three times: PASS each (435.5 s, 432.8 s and 435.1 s), every dice line the same in all three: C's Insight checks (15 + 4 and 18 + 4), step 24's natural 1 and its plain check's 5, the darts' 8 force, Kell's club (9 + 3 = 12 against AC 12, a hit), the Fire Bolt's 17 + 5 = 22 at its first cast, and the door burned from 17 hit points to 4. `npm run arc` on ports 3362 and 8862: 15 of 16, as before. `npm run build:web` then `npm run web:check`: PASS, 80 checks.
