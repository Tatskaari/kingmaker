# Explicit return-beat comparison

Restoring the positive instruction produced a player-facing return beat in all four candidate trials, versus zero of four in the preceding draft comparison. This supports keeping the instruction, with only two trials per configuration; it does not establish reliable end-to-end playability.

The candidate now says: “when an NPC takes an errand on, provide an appropriate future report, invitation or choice that returns the story to the player.” The only other edit since the preceding run removed the explanatory comment after `{{youAreTheGameMaster}}`. Full general GM guidance still renders exactly once. Shared guidance, fixture, model settings, tools and rubric are unchanged from that comparison. Baseline and SQL-only retain committed prompts.

| Configuration | Trials | Player return authored | Average rubric score | Changed documents per trial |
| --- | --- | --- | --- | --- |
| Baseline | 2 | 0/2 | 65% | 2, 0 |
| Prompt | 2 | 2/2 | 100% | 5, 6 |
| SQL only | 2 | 0/2 | 67.5% | 0, 3 |
| SQL + prompt | 2 | 2/2 | 100% | 5, 5 |

## What the GM actually changed

- Prompt repeat 1 added `helping → order-pending → awaiting-report`. Aldren must relay only Holt's actual response and invite the player's next choice. It updated the quest overview, investigation stage and lead-transition notes to accept an accurate report to the player. It left the report hook as follow-through.
- Prompt repeat 2 added `helping → order-pending → report-back → player-involved`, with `Run: pillow-lead.ts` on the actual lead-disclosure edge. It also added Holt's `royal-order` node, conditional on the order actually arriving, and revised the quest notes. It explicitly requested verification of the report helper.
- Combined repeat 1 added `helping → willing-to-order → report-back`, plus the same quest adaptations. Aldren must return if the player is absent. It left report-hook implementation as follow-through.
- Combined repeat 2 added `helping → order-pending → cart-lead-reported`, attaching `pillow-lead.ts` to the report edge. It updated the quest notes and requested confirmation that the helper supports a relayed disclosure.
- Baseline either duplicated the commitment into a new memory or made no changes. SQL-only either made no changes or recorded the commitment in memory and the quest overview. Neither added a return route.

All candidates preserve the player's successful persuasion, distinguish intention from the delivered order, and postpone the investigation transition until the player receives the lead. None claims the cart moved or cushions arrived. All eight reviews preserved live quest, activity and physical state, with no execution or judging errors.

## Format and runtime limits

All five changed conversation trees pass the existing `compileConversationTree` validator. No duplicate transition IDs occurred this time. Compilation was checked separately; it is not part of the unchanged semantic rubric.

Only two of four candidate outputs attach an executable hook to Aldren's report. That hook is registered, but its existing evidence text assumes Holt's direct disclosure. This eval does not execute it, apply revised graphs to live sessions, make Aldren travel/return or verify that NPC-to-NPC events satisfy dialogue edges. Holt's newly added node is terminal and does not add routes back to his existing remedy branches. These are follow-through concerns even though the authored-return rubric scores 100%.

Combined repeat 1 did not call SQL; repeat 2 called it once. Both prompt-only trials also succeeded, so these trials do not establish an additional benefit from SQL access.

## Reproduce and inspect

Revision: `9c0158389141edcd1d6dc9d64ee11919f04e7743`.

Run with `OPENROUTER_API_KEY`: `node --import tsx scripts/run-aldren-plot-eval.ts --repeats 2 --concurrency 2 --timeout-ms 600000`.

Artifacts: `eval-output/2026-10-11T16-47-32.417Z-882e1bb7/`. See [exact GM responses and diffs](return-beat-evidence.md) and [scores and compiler results](return-beat-results.json). The earlier [draft comparison](current-draft-comparison.md) remains intact. Main-checkout Obsidian drafts were not edited during this run; nothing was promoted into the game baseline.
