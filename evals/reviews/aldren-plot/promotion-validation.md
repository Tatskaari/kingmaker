# Promoted baseline validation

The game now uses the tested plot-rerouting prompt and shared document-editing guidance. Temporary prompt/SQL variants and candidate lore copies are removed; the fixture and rubric remain. `--list` reports only `aldren-plot: game (baseline)`. General GM guidance and shared review guidance each render once.

SQL access was subsequently enabled by explicit author request for the shared document-capable GM toolset. All six focused categories, general review, and action/event/wait/NPC-exchange reviews receive it. The shared surface also serves GM consultations. Activity-only review retains only `set_activity`; character speech has no tools. SQL availability is not claimed as an independently demonstrated narrative improvement.

## Local checks

Workspace typecheck, contracts lint and all 50 affected tests pass. Coverage includes prompt rendering, the baseline-only eval, review scheduling, document access, SQL SELECT/rejected DELETE, world reviews and character/tool separation.

## Live results

| Setup | Completed trials | Story rubric | Independent tree compilation |
| --- | --- | --- | --- |
| Promoted prompt, before SQL enablement | 2/2 | 100% in both | Both Aldren trees pass; one added Holt tree fails |
| Final SQL-enabled baseline | 1/2 | 100% for completed run; failed run scores zero | Both Aldren trees pass; failed run's Holt tree fails |

The promoted prompt continued to author player-facing reports/invitations. In the final setup, repeat 1 edited Aldren's tree and the quest overview, requiring a report or invitation after the actual Holt exchange. Repeat 2 edited six documents and added a longer report route, but exhausted the existing 16-turn GM tool limit before completing its review. It made two successful SQL calls and recovered from one document conflict. This is an execution failure, not a successful trial; partial document edits remain visible. The eval's 50% aggregate includes that failure rather than omitting it.

Both malformed Holt outputs used an apostrophe in a transition ID (`king's-order-delivered`). The independent compiler rejects it. The unchanged narrative rubric does not grade syntax, and this stack does not include the separate live-definition validation work. Thus 100% narrative scores do not mean fully executable graphs. Hook execution, graph refresh, and reliable completion within the review budget remain follow-up concerns; neither prompt nor limits were changed to hide these outcomes.

See [per-trial results and compiler findings](promotion-results.json). Raw ignored recordings are listed there. The previous [return-beat comparison](return-beat-comparison.md) remains evidence for the wording change, not a substitute for these post-promotion checks.
