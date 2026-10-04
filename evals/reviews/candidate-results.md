# Review candidate results — 2026-10-04

Production baseline, fixtures, judge and rubric are unchanged. We ran **121 trials** across
nine comparison batches; none reported execution or judging errors. These are small,
stochastic samples, not proof of general reliability. Each batch has fresh baseline runs;
compare within batches rather than pooling differently sampled scores.

## Most useful result

`sealed-ledger` passed **all eight gift criteria in 5/5 runs**, including actual player
ownership with no duplicate on Peregrine. Its paired baseline passed gift-inventory 0/5
and scored 12.5% overall; the candidate scored 100%. The model classified the gift and
recipient; the resolver wrote that item through recorded docs calls; subsequent memory
review could not change settled inventory.

On Kobold City, the same candidate retained the promise without a current activity in
3/3 runs, with intent passing 3/3 versus baseline 0/3. Total scores were 71.4% versus 57.1%:
knowledge and restraint still failed, with duplicated memory visible in the outputs.

**The immediate-travel control is not solved.** The final candidate created travel activities
in 2/3 parlour runs and omitted the activity in one. Jev intent passed only 1/3, versus 0/3
for that fresh baseline. One activity status also said Oswin had left despite his unchanged
Great Hall position. No candidate is promoted; a single configuration passing the gift case
is not enough to accept it across the engine.

## Hypotheses and observed failures

1. **present-priorities / situated-priorities:** stop treating every promise as immediate
   work, optionally supplying playable locations. Both avoided Kobold activities in 3/3
   initial runs. Some control runs claimed arrival or skipped travel, so the aggregate
   scores did not improve. World context alone was not sufficient.
2. **material-consequences:** expose real inventory through the existing document tools
   and clarify mundane gifts. One gift passed in the first three runs, none in the next
   three. The model sometimes assigned the object to the giver or only recorded prose.
3. **consequence-led:** distinguish settled effects, immediate next steps and future promises.
   It improved the combined review score in its batch but gift ownership still failed 0/3.
   Some notes claimed player ownership while the inventory edit targeted Peregrine.
4. **effect-ledger:** classify effects, then map the chosen recipient ID to its real document.
   All three classifications chose the player and all three initially wrote the player item.
   Later memory review recreated a duplicate for the giver, so all three final ownership
   checks failed. This isolated a phase-responsibility problem, not a recipient-classification
   failure.
5. **sealed-ledger:** preserve those settled effects during memory/intent review. This fixed
   the duplicate gift in five repeats. It adds an LLM classification call and an eval-only
   service capability; it is not merely a prompt tweak.

The original `deferred-promises` wording is retained as another comparison. All candidate
prompts are general: none embed Oswin, Peregrine, Kobold City, a bird, or rubric answers.
Scene capability data comes from each run's world. The explicit gift policy follows the
user's desired interpretation of a requested, willingly given mundane gift.

## Evidence excerpts

- Initial framing, situated-priorities, Kobold repeat 1: “The invitation is for a later
  occasion.” No activity was active.
- Consequence-led gift repeat 3: memory said “The player now has the bird,” but the player
  inventory was absent and the bird was in Peregrine's inventory.
- Sealed-ledger gift repeat 4: the player owns one wooden bird; the note says “The bird
  now belongs to the envoy.” Peregrine has no matching bird.
- Sealed-ledger Kobold repeat 1: “This is a future promise; neither has traveled.” No activity
  or wait was active.
- Sealed-ledger parlour repeat 2: memory records an intention to comply promptly, but there
  is no activity or wait. This remains a concrete regression risk despite favorable total scores.

## Scores by batch

Counts below are passing trials. Total is the mean across all criteria and trials in that
row. `—` means the gift criterion does not apply. Full per-criterion counts, source revisions
and artifact directory names are in [candidate-results.json](candidate-results.json).

| Batch | Scenario | Configuration | Runs | Intent passes | Gift passes | Total |
|---|---|---|---:|---:|---:|---:|
| reality-framing | oswin-kobold-city | deferred-promises | 3 | 1 | — | 61.9% |
| reality-framing | oswin-kobold-city | game | 3 | 0 | — | 57.1% |
| reality-framing | oswin-kobold-city | present-priorities | 3 | 3 | — | 71.4% |
| reality-framing | oswin-kobold-city | situated-priorities | 3 | 3 | — | 71.4% |
| reality-framing | oswin-parlour | deferred-promises | 3 | 0 | — | 61.9% |
| reality-framing | oswin-parlour | game | 3 | 3 | — | 100.0% |
| reality-framing | oswin-parlour | present-priorities | 3 | 0 | — | 61.9% |
| reality-framing | oswin-parlour | situated-priorities | 3 | 0 | — | 52.4% |
| reality-gift | peregrine-gift | game | 3 | 1 | 0 | 20.8% |
| reality-gift | peregrine-gift | material-consequences | 3 | 1 | 1 | 41.7% |
| reality-gift | peregrine-gift | present-priorities | 3 | 0 | 0 | 12.5% |
| reality-gift | peregrine-gift | situated-priorities | 3 | 0 | 0 | 12.5% |
| reality-material | oswin-kobold-city | game | 3 | 0 | — | 57.1% |
| reality-material | oswin-kobold-city | material-consequences | 3 | 3 | — | 76.2% |
| reality-material | oswin-kobold-city | situated-priorities | 3 | 3 | — | 76.2% |
| reality-material | oswin-parlour | game | 3 | 1 | — | 90.5% |
| reality-material | oswin-parlour | material-consequences | 3 | 0 | — | 61.9% |
| reality-material | oswin-parlour | situated-priorities | 3 | 1 | — | 66.7% |
| consequence-gift | peregrine-gift | consequence-led | 3 | 1 | 0 | 16.7% |
| consequence-gift | peregrine-gift | game | 3 | 0 | 0 | 12.5% |
| consequence-gift | peregrine-gift | material-consequences | 3 | 1 | 0 | 16.7% |
| consequence-review | oswin-kobold-city | consequence-led | 3 | 2 | — | 71.4% |
| consequence-review | oswin-kobold-city | game | 3 | 0 | — | 57.1% |
| consequence-review | oswin-kobold-city | material-consequences | 3 | 3 | — | 76.2% |
| consequence-review | oswin-parlour | consequence-led | 3 | 1 | — | 90.5% |
| consequence-review | oswin-parlour | game | 3 | 1 | — | 90.5% |
| consequence-review | oswin-parlour | material-consequences | 3 | 0 | — | 85.7% |
| ledger-gift | peregrine-gift | effect-ledger | 3 | 2 | 0 | 20.8% |
| ledger-gift | peregrine-gift | game | 3 | 0 | 0 | 12.5% |
| ledger-review | oswin-kobold-city | effect-ledger | 3 | 3 | — | 71.4% |
| ledger-review | oswin-kobold-city | game | 3 | 0 | — | 57.1% |
| ledger-review | oswin-parlour | effect-ledger | 3 | 0 | — | 85.7% |
| ledger-review | oswin-parlour | game | 3 | 1 | — | 90.5% |
| sealed-gift | peregrine-gift | game | 5 | 0 | 0 | 12.5% |
| sealed-gift | peregrine-gift | sealed-ledger | 5 | 5 | 5 | 100.0% |
| sealed-review | oswin-kobold-city | game | 3 | 0 | — | 57.1% |
| sealed-review | oswin-kobold-city | sealed-ledger | 3 | 3 | — | 71.4% |
| sealed-review | oswin-parlour | game | 3 | 0 | — | 85.7% |
| sealed-review | oswin-parlour | sealed-ledger | 3 | 1 | — | 90.5% |

## Validation and boundaries

`proto run moon -- run workspace:check workspace:build` passed, including **420 tests**.
Focused tests cover typed persistence, baseline isolation, stale writes, invalid inventory
rollback, recipient mapping, duplicate rejection, recorded writes and sealing that still
permits prose edits. No files under packages/conversation, packages/lore or apps/web changed.

Complete docs/AI traces and original manifests remain under the ignored `eval-output/`
directories listed in the JSON. The later type-only dependency correction did not change
candidate behavior. Hypotheses are in [candidate-hypotheses.md](candidate-hypotheses.md).

The inventory adapter is experimental: it covers character possessions and newly introduced
items, not general atomic transfers across multiple owners. Effects can persist if later
review fails; the common runner records that partial state. Sealing fixes responsibility
within one review; it is not persistent cross-run deduplication. The item matcher recognizes
wood/wooden and bird in the name/details. Broader language could need manual inspection.

Jev's semantic criteria sometimes fail together, and some plausible control outputs still
fail intent. Treat scores as evidence alongside actual state; do not present every failing
column as an independently established defect. We did not soften criteria to improve scores.

To reproduce the strongest candidate with fresh baselines:

```sh
npm run eval:review:gift -- --variants sealed-ledger --repeats 5
npm run eval:review -- --variants sealed-ledger --repeats 3
```

Set OPENROUTER_API_KEY first. No baseline promotion was performed.
