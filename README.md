# Kingmaker V2 PoC: GM-run scenes

A proof of concept for the V2 idea in [Kingmaker V2 prototype.md](Kingmaker%20V2%20prototype.md). The world is split into **scenes** adjudicated by an AI game master. You talk and act in plain English, the people in the scene react, and the scene ends through one of its **exits**, which run a world-update script. Between scenes, a map would be the hub. Here the scenes simply chain.

What we learned is in [docs/FINDINGS.md](docs/FINDINGS.md), with write-ups in [docs/experiments/](docs/experiments/). The running lab notebook is [docs/LOG.md](docs/LOG.md), and the blind QA write-ups are in [docs/qa/](docs/qa/).

## Play

Needs Node 26 and `OPENROUTER_API_KEY` (or `~/secrets/kingmaker-dev-openrouter.txt`).

```sh
npm install                       # only needed for typecheck and the world scribe's script checks
npm run scene -- list             # scenes and approaches
npm run scene -- play stranger-crossroads            # interactive: character creation, then the road
npm run scene -- start crossroads-ambush --session demo          # defaults to the recommended v2
npm run scene -- say demo '(I raise my hands) Easy, friend. What happened to your ox?'
npm run scene -- transcript demo
npm run scene -- status demo      # debug: beat, rolls, co-GM notes, latency
npm run scene -- world demo       # Phase 2: world-update scripts for the finished scenes
```

## How a turn works

1. **Decide before replying.** One call to Luna's decision mode (`openai/gpt-6-luna-decisions`, about 0.2–0.35 s). It asks, in parallel:
   - Is the player attempting a scene route? Routes can carry a roll.
   - Is it a risky attempt that no route covers? Then it gets a freeform roll.
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
| **`v2`** (default) | **Recommended.** GM voice with essentials in the comic house style (Pratchett / Monty Python: the world plays it straight, daft acts send a bill), quick co-GM on off-graph turns (3 s), background co-GM. |
| `v2-straight` | The same, played straight (the `v2` of the deviation experiment). |
| `v2-pressure` | `v2` plus pressure rolls: pressing someone for what they're hiding is ruled yes, no, or a roll at DC 12/15/18 ([research](docs/research/dc-guidance.md)). |
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
| `hanged-clerk` | An investigation with hostile witnesses and a partner. |

## Evals

```sh
npm run eval -- --suite decision --decider luna-decisions,jev,luna-none   # decider accuracy and latency
npm run eval -- --suite reply --approach gm,actors --samples 3            # single-turn improvisation, judged by Sol
npm run eval -- --suite trajectory --approach gm,actors                   # simulated players play whole scenes
npm run eval -- --suite opening                                           # does the next scene pick up correctly?
npm run eval -- --suite world --from runs/sessions --mode reconcile       # Phase 2 scribe, judged
npm run compare -- runs/evals/<a> runs/evals/<b>                          # per-approach aggregates
```

Cases are in `src/eval/cases/`. QA failures become cases using per-turn snapshots, which are tracked in `evals/fixtures/`.

## World updates (Phase 2)

`src/world/dsl.ts` is a stub world API, bounded by a fixed asset catalogue (`src/world/assets.ts`), the scene's anchors, the known locations and the cast. When a scene ends, the **scribe** (`src/world/scribe.ts`) writes `function update(world: WorldApi)` from what was narrated. The script is typechecked with `tsc` and run in a `vm` against a recording world. Anything the story needs that the API can't express goes to `world.unsupported(...)`, which is how the DSL grows.
