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
