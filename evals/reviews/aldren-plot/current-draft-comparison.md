# Current author draft comparison

This tests the Obsidian drafts copied on 2026-10-11 into the prompt variant: `review-plot-progress.md` and `review-focused.md`. The main-checkout files remain author-owned and uncommitted. The variant renderer now injects the candidate shared guidance as well as the task prompt; baseline and SQL-only use committed prompts. A mocked test checks this isolation and exactly-once candidate guidance injection.

The previous successful comparison used a different task prompt. It explicitly said: “when an NPC takes an errand on, provide an appropriate future report, invitation or choice that returns the story to the player.” The current draft instead says to avoid NPC completion and major beats without player involvement. Shared review guidance and role/template composition also changed since the earlier comparison. The fixture, fixed plot flag and rubric remain the same; this is not an isolated test of one instruction.

## Interpretation

Three of four current-prompt outputs compile; the fourth repeats a transition ID and fails compilation. All four stop at Aldren intending to approach Holt. They do not build the subsequent report/invitation back to the player. This supports the hypothesis that an explicit positive requirement to author the return beat matters more than simply prohibiting offscreen completion. It does not prove that hypothesis: there are multiple prompt changes and few trials.

Do not promote this draft on the strength of these results. A useful next experiment would change only that positive instruction, with the user's agreement.

## Scope

These runs inspect a focused GM review at the recorded persuasion boundary. They do not test Jev flagging, NPC travel, the subsequent Holt exchange or activation of edited conversation graphs. No runtime graph, physical state or activity pointer should change. Syntax validation of edited trees is separate from narrative quality or playability.

## Results and evidence

Two batches, one trial per variant in each (eight reviews total), using the same settings. No execution or judging errors; all live quest and physical state remained unchanged.

| Batch | Variant | Changed documents | SQL calls | Rubric total |
| --- | --- | --- | --- | --- |
| 1 | prompt | 1 | 0 | 65% |
| 1 | game | 1 | 0 | 70% |
| 1 | sql-and-prompt | 1 | 0 | 70% |
| 1 | sql | 1 | 1 | 75% |
| 2 | prompt | 1 | 0 | 70% |
| 2 | game | 1 | 0 | 70% |
| 2 | sql | 2 | 6 | 60% |
| 2 | sql-and-prompt | 1 | 0 | 70% |

All eight reviews scored zero for the player-return criterion. Baseline updated an existing memory in both trials. SQL-only recorded the agreement in the quest overview once; its other trial updated memory and changed the introductory quest index's `active` metadata, without changing live quest state. That second SQL run recovered from two invalid queries (`snippet` instead of `snippets`, and an unjoined `props.key`).

Prompt-only added `helping → order-intended` / `intends-to-order`. Combined added `helping → will-approach-holt` / `willing-to-approach`. None added an after-Holt report node, changed Holt's tree, or adapted the lead transition to an Aldren report. Combined never called SQL, so its differences cannot be attributed to SQL use.

Three of four edited trees passed `compileConversationTree`. Combined batch 2 reused `persuaded-to-approach` on three edges and failed with `empty or duplicate transition ID`. Document writes accepted that malformed tree; the current prompt's claim that incorrect formats fail to save is not enforced here. This independent format check is not included in the historical rubric scores above; the rubric was kept fixed.

Local validation: three targeted eval tests, workspace typecheck and contracts lint pass. See [GM evidence](current-draft-evidence.md) for exact output diffs and [results](current-draft-results.json) for per-criterion scores and artifact paths.

Artifacts (ignored local recordings):

- `eval-output/2026-10-11T16-39-53.482Z-c3572088/` (started on 9d21b72 with candidate changes later committed as 6146aa3).
- `eval-output/2026-10-11T16-41-21.095Z-127c42b1/` (6146aa3).

