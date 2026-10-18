# Kingmaker V2 PoC: GM-run scenes

A proof of concept for the V2 idea in [Kingmaker V2 prototype.md](Kingmaker%20V2%20prototype.md). The world is split into **scenes** adjudicated by an AI game master. You talk and act in plain English, the people in the scene react, and the scene ends through one of its **exits**, which run a world-update script. In the playable game you walk the town on a map between scenes, and fights are played out on it ([src/app](src/app/README.md)); the scene harness below plays the scenes alone, one after another.

To review the code, start at [ARCHITECTURE.md](ARCHITECTURE.md): the overall diagram, a doc for each component, where state lives, and how to check a change.

What we learned is in [docs/FINDINGS.md](docs/FINDINGS.md), with write-ups in [docs/experiments/](docs/experiments/). The running lab notebook is [docs/LOG.md](docs/LOG.md), and the blind QA write-ups are in [docs/qa/](docs/qa/).

## Play

Needs Node 26 and `OPENROUTER_API_KEY` (or `~/secrets/kingmaker-dev-openrouter.txt`).

```sh
npm install                       # the game's packages (OpenTUI, boardgame.io), and tsc for the typecheck and the scribe's script checks; the scene harness needs none
npm run game                      # the playable game in a terminal: the town, its scenes and the fight at the Heron (z on the title opens the zoo)
npm run qa -- new --session try --as "Wren: a hedge wizard"   # the same game headless, by action id (src/cli/README.md)
npm run scene -- list             # the scene harness: scenes and approaches
npm run scene -- play stranger-crossroads            # interactive: character creation, then the road
npm run scene -- start crossroads-ambush --session demo          # defaults to the recommended v2
npm run scene -- say demo '(I raise my hands) Easy, friend. What happened to your ox?'
npm run scene -- transcript demo
npm run scene -- status demo      # debug: beat, rolls, co-GM notes, latency
npm run scene -- world demo       # Phase 2: world-update scripts for the finished scenes
```

## How a turn works

The short version. The whole turn, with the rules, memory and the co-GM, is in [ARCHITECTURE.md](ARCHITECTURE.md#one-turn) and [src/runtime/README.md](src/runtime/README.md#one-player-turn).

1. **Decide before replying.** One call to Luna's decision mode (`openai/gpt-6-luna-decisions`, about 0.2–0.35 s). It asks, in parallel:
   - Is the player attempting a scene route? Routes can carry a roll.
   - Would a GM call for a roll here, and is it what one of the routes is for? A roll that no route settles (another person, another ask, a plan nobody wrote) makes it a **considered turn**: before replying, the GM rules on it with the whole prep (a roll or not, the DC, what success and failure each change), the rules roll it, and the reply plays what was decided. Those turns take a few seconds longer, and the status line says the GM is considering.
   - Is it something that simply happens, with no dice?
   - Should a pacing cue fire?
   - Is the player reaching for something the scene can't offer (its **limits**)?
   - Is the player out of character?
   - In the actors approach only: who speaks first?
2. **Reply.** Luna with reasoning `none` streams the reply, with first text after about 1 s. The GM gets its prep: setting, cast with wants, fears, knowledge and secrets, the ways the scene can end, the limits, the current beat, co-GM notes, and a short "for this reply" direction built from the decision.
3. **Decide after replying.** Has an outcome happened, has the story already moved to the next beat, and is the scene on track, drifting or stuck? The status gates the co-GM and the "break the loop" momentum rule.
4. **Endings.**
   - An ending the player chooses (they attack, succeed, hand it over, set off) closes in that reply.
   - An ending they didn't choose (a failed check, the world losing patience) is held for one last response.
   - An ending that happens in the fiction gets a one-turn wind-down.
   - Every scene also has a built-in "ending of their own" for resolutions the prep didn't foresee.
5. **Between scenes.** A hand-off records how things actually stand. The next scene's prep is told that what happened in play outranks the prep.

## Approaches (each is a runnable PoC)

| approach | what it tests |
|---|---|
| **`v2`** (default) | **Recommended**, and what the game plays. GM voice with essentials in the comic house style (Pratchett / Monty Python: the world plays it straight, daft acts send a bill), V1's docs-service memory, considered rolls (the GM rules on an act a roll should settle that no route covers, or a plan off the graph, before replying), background co-GM. |
| `v2-quick` | `v2` before considered rolls, to compare: a freeform roll for a risky attempt no route covers, and the quick co-GM on off-graph turns (3 s). |
| `v2-straight` | The quick-co-GM `v2`, played straight (the `v2` of the deviation experiment). |
| `v2-pressure` | The quick-co-GM `v2` plus pressure rolls: pressing someone for what they're hiding is ruled yes, no, or a roll at DC 12/15/18 ([research](docs/research/dc-guidance.md)). |
| `v2-comic`, `v2-comic-bill` | Absurdity experiment conditions: the comic style without and with the consequence flag. |
| `gm-quick-block`, `gm-stall-quick` | The two budgeted repair designs `v2` came from: a single wait vs a holding beat plus follow-up. |
| `gm-rigid`, `gm-nudge`, `gm-fast`, `gm-repair-*` | Deviation experiment conditions: no essentials, decider relocation, speculative replies only, co-GM timings (low/stall/blocking). |
| `gm-low`, `gm-medium` | GM voice with more reasoning (no gain, slower). |
| `gm` | One GM voice narrates and plays everyone (Friends & Fables style). Luna decision mode as the director. |
| `gm-jev` / `gm-luna` | The same, with Jev or Luna structured output as the decider. |
| `gm-repair` | Plus a background co-GM (Luna, medium reasoning). It leaves short-lived notes, whispers to characters, "no, but" alternatives, and additive routes. It's gated by the scene status. |
| `actors` | The decider picks who speaks. Each character is its own Luna call that knows only what they know, and the GM only narrates. |
| `actors-jev` / `actors-repair` | Variants of the above. |

## Scenes

`scenes/*.ts` are typed GM prep (`src/runtime/scene.ts`): cast cards, beats with direction, cast notes and pressure, prose transitions with optional checks, exits with world scripts, limits and anchors.

| scene | shape |
|---|---|
| `stranger-crossroads` | Character creation as a scene (the Laughing Stranger). Chains into the next two. |
| `crossroads-ambush` → `crossroads-aftermath` | The brief's example: a raving farmer, then a goblin standoff with a stolen idol. |
| `crossroads-situation` | The same scene as a situation, with no beat sequence (a representation experiment). |
| `garrows-toll` | 1:1 negotiation with an itemised bill. |
| `warren-hostage` | A hostage negotiation with a would-be usurper. |
| `blocked-entrance` | V1's cart standoff: three people, three agendas. |
| `green-standoff` | Multi-faction standoff (after BG3's grove). |
| `hanged-clerk` | An investigation with hostile witnesses and a partner. The first scene of the Caerwyn arc, which the playable game plays. |
| `drowned-rat` → `heron-warehouse` → `kings-morning` | The rest of the arc: a dockside dive, the warehouse on the wharves at night (one of its endings is a fight), and the report to the King. In the scene harness, `caerwyn-afternoon` and `wharf-night` stand in for the map between them. |

Every scene, with where each leads, is in [scenes/README.md](scenes/README.md).

## Checks

```sh
npm run check             # what CI runs (moon.yml): the typecheck, the tests and the screens check, about 20 s
npm test                  # the tests alone
npm run build:web         # the PR preview's site in dist/web: the pitch, the roadmap, and the whole game at play/, played in the browser (src/web/README.md)
npm run web:static-check  # that build, served under the preview's path, its pages clicked through and the game played in Chromium
```

The playable game's smoke tests are in [src/app/README.md](src/app/README.md), the browser's checks in [src/web/README.md](src/web/README.md). Every check, how long it takes and whether CI runs it, is in [ARCHITECTURE.md](ARCHITECTURE.md#checks).

## Reporting a problem

In the game, b (on the map and in fights), `/report` (in a scene) or the Esc menu's Report a problem… asks what went wrong, then saves everything needed to look into it as one file: "Saved runs/reports/<file>: tell Claude 'report <file>'" (the static build downloads it). The key is never in it.

```sh
npm run report -- inspect <file>     # what they said, the build, where they were, the screen, the last turns, errors and calls
npm run report -- restore <file>     # its game as a new session, for the QA console or Continue
```

How to read one is in [src/cli/README.md](src/cli/README.md); what the game does is in [src/app/README.md](src/app/README.md).

## Evals

```sh
npm run eval -- --suite decision --decider luna-decisions,jev,luna-none   # decider accuracy and latency
npm run eval -- --suite reply --approach gm,actors --samples 3            # single-turn improvisation, judged by Luna at high reasoning
npm run eval -- --suite trajectory --approach gm,actors                   # simulated players play whole scenes
npm run eval -- --suite opening                                           # does the next scene pick up correctly?
npm run eval -- --suite world --from runs/sessions --mode reconcile       # Phase 2 scribe, judged
npm run compare -- runs/evals/<a> runs/evals/<b>                          # per-approach aggregates
```

Cases are in `src/eval/cases/`. QA failures become cases using per-turn snapshots, which are tracked in `evals/fixtures/`. The suites, the stage manager's eval and what CI runs of them (nothing) are in [evals/README.md](evals/README.md).

## World updates (Phase 2)

`src/world/dsl.ts` is a stub world API, bounded by a fixed asset catalogue (`src/world/assets.ts`), the scene's anchors, the known locations and the cast. When a scene ends, the **scribe** (`src/world/scribe.ts`) writes `function update(world: WorldApi)` from what was narrated. The script is typechecked with `tsc` and run in a `vm` against a recording world. Anything the story needs that the API can't express goes to `world.unsupported(...)`, which is how the DSL grows.
