# V2 PoC lab notebook

Running log of hypotheses, experiments and results. Newest entries at the bottom.

## 2026-10-14 — Setup

- Repo cleared on `claude/kingmaker-v2-poc`; V1 is at commit `a6cb07f`, PR #649 at branch `pr-649`.
- Node 26 runs `.ts` directly (type stripping), so no build step. `npm run typecheck` uses TypeScript 7.
- Model probes (single calls, cold):
  - Luna (`openai/gpt-6-luna`, reasoning `none`, Responses API, streaming): first text ~1.3 s, total ~1.5 s for one line. ~$0.00001 per short call.
  - Jev (`typesafe/jev-1.13`, `POST /api/alpha/decisions`): 0.2–0.45 s for two questions. ~$0.00002 per call. Returns probabilities + confidence.
  - Luna as a decider (strict JSON schema enum, reasoning `none`): ~1.1 s for the same two questions.
  - The Decisions endpoint rejects `openai/gpt-6-luna`; Responses `reasoning.mode` only accepts `standard|pro`. So "Luna decision mode" is implemented as Luna + strict structured output (`src/llm/decide.ts`), same interface as Jev.
- User steer during setup: judge runs on how the GM and characters improvise around unscripted tangents, not on scene authoring polish; build multiple runnable PoCs that demonstrate the different approaches.

## 2026-10-14 — Runtime skeleton and first evals

Built one runtime with interchangeable approaches (`src/runtime/approaches.ts`): `gm` (one GM voice, Jev director), `gm-luna` (Luna director), `gm-repair` (+ background co-GM), `actors` (decider picks speakers, per-character Luna actors), `actors-repair`. Scenes are TS modules (`scenes/`): cast, beats with direction/cast notes/pressure, transitions (`attempt` / `cue` judged before the reply, `outcome` after), edge-gated checks, exits with world scripts.

Smoke-test findings:
- Luna (reasoning none) sometimes splits a reply into a `commentary` message plus a `final_answer` that critiques it ("'Tam Hollis awaits your response' is GM-facing text…"). The final_answer alone is then wrong. Fix: detect multi-phase output and retry once; always give the model a user turn.
- GM voicing everyone bleeds voices: Tam says "longlegs" (Skrag's word for humans).
- The GM rushes several beats into one reply when the beat direction mentions the next event. Directive now says "play the start of this, let the rest unfold".
- Tracker lag: the GM brought the goblins on itself; the cue then fired a turn later. Post-reply judging now considers cues as outcomes too.

### Decision suite (11 cases × 3 samples, `--suite decision`)

| decider | accuracy | mean latency |
|---|---|---|
| Jev | 73% | 241–253 ms |
| cascade (Jev, Luna when Jev confidence < 0.8) | 82% | 571 ms |
| Luna none (strict JSON enum) | 91% → 100% after fix | ~1.0–1.1 s |
| Luna low | 91% | 1.45 s |

- All deciders rolled persuasion on a kind greeting, because the pre-reply question only listed the roll-gated "attempt" edges. Showing no-roll outcome edges as "simply happens, no dice needed" alternatives fixed Luna (100%) but not Jev.
- Jev reads loosely-worded criteria liberally ("presses him about why the goblins are after him" matched "who else knows about the goblins?"). Its wrong answers had lower confidence (0.66–0.72 vs ~1.0), but not always below the threshold.

### Reply suite baseline (8 improvisation cases × 3 samples, Sol judge)

| approach | criterion pass | intent | consistency | characters | steering | craft |
|---|---|---|---|---|---|---|
| gm | 83% | 4.26 | 4.70 | 4.09 | 4.30 | 4.22 |
| actors | 88% | 4.50 | 4.58 | 4.25 | 4.38 | 4.04 |

Single-turn improvisation is already decent. Failures: threatening to smash the idol fires the intimidation edge → one roll ends the scene (tension never rises); "what are my options?" leaks Skrag's secret willingness to bargain; one blunt out-of-fiction "you can't teleport".
