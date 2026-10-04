# Review reality-check experiments

The user authorized autonomous candidate exploration, with no baseline edits or promotion.
All candidates use the same model, judge, transcripts and criteria as their baseline.

- **deferred-promises**: the user's earlier wording. Retained for comparison on Oswin.
- **present-priorities**: hypothesis that obligation-to-act language turns any promise into
  a current task. Replace it with present-scene priorities and distinguish willingness
  from timing. Memories remain character-perspective and concise.
- **situated-priorities**: hypothesis that framing also needs the playable-world boundary.
  Add actual scenario/player paths and available room IDs/names to present-priorities.
  This is world-derived evidence, not case-specific answers or judge expectations.

Run `npm run eval:review -- --repeats 3` and `npm run eval:review:gift -- --repeats 3`
with OPENROUTER_API_KEY set. Gift configurations have a different rubric and are reported
separately. Baselines use the production strategy and services unchanged.

Do not infer that semantic scores are independent diagnoses. Inspect persisted memories,
activities and typed inventory, especially when Jev scores disagree with visible behavior.
