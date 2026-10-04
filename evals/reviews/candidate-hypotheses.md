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

- **material-consequences**: hypothesis that possessions fail because GM Markdown writes
  preserve typed properties and cannot express item creation. Add an eval-only docs service
  that exposes typed inventory in character Markdown reads and supports atomic, SHA-checked
  edits through the same tools. Add guidance resolving a requested and willingly given
  mundane gift without another acceptance turn. Uses situated-priorities framing otherwise.
  This combines a capability and a policy change; improvement cannot isolate their effects.
  It does not seed a bird or mention a character/case by name. No production service changes.

- **consequence-led** (follow-up): initial framing candidates avoided the Kobold journey,
  but some parlour outputs skipped travel and claimed arrival. The first inventory candidate
  created the gift for the player in only 1/3 runs; another created it for the giver.
  Hypothesis: the prompt conflates settled effects, immediate next steps and future promises,
  and its blanket ban on physical effects contradicts writable possessions. Keep the same
  inventory service, explicitly separate those timescales, retain the physical movement
  boundary, and authorize supported ownership changes. Compare with material-consequences
  and a fresh baseline; keep prior variants and the rubric unchanged.

- **effect-ledger** (follow-up): traces showed prose claiming player ownership while edits
  added the gift to the giver's inventory. Hypothesis: classify effects before writing,
  and let the resolver map model-selected recipient IDs to actual document paths. A new
  classify hook returns newly introduced items and distinguishes immediate/future intent;
  the resolver writes those items through the recorded docs service before memory review.
  It uses consequence-led framing and the same inventory service. This adds an LLM call
  and supports only newly introduced items, not transfer of existing items. No case names,
  bird descriptions or expected answers are embedded in the strategy.

- **sealed-ledger** (follow-up): all three effect-ledger classifications assigned the gift
  to the player and persisted it, but later memory review recreated a duplicate for the
  giver. Hypothesis: give the two phases separate write responsibilities. Reuse the same
  classification and application, then seal typed inventories during memory/intent review.
  Invalid inventory edits return a tool error; prose edits still work. This preserves
  model-selected ownership rather than repairing it after seeing the rubric. The original
  effect-ledger remains available as an ablation. This restriction is eval-only.
