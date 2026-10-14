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
