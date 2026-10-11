# Aldren delegates himself

Reconstructs the focused plot review after the envoy critically succeeds at persuading Aldren to approach Holt himself. Source call IDs and dump hash are in source.json. fixture.json uses the shared character/disclosure/message format; lore overrides hold documents, not a serialized game or provider transcript.

The fixture uses the quest and dialogue source notes from the cart-dialogue-sequence branch, the actual pre-review character entry, and reconstructed activity/memory documents from preceding successful GM tool calls. No desired reroute is seeded. The binding mechanics are condensed; player and character speech is preserved. Disclosure is fixed and relevant rather than a replay of every original disclosure. The map is fresh except Aldren's actual review-time position. His activity text still says Great Hall while the authoritative position has already moved to Royal Back Hall; this discrepancy existed in the captured request. Other actors use fresh-game positions.

Assembly Programme is active at investigate_missing_pillows; the opening conversation has reached helping. The baseline starts from that reconstructed state. The base predates trigger:none: construction compiles those transitions as discretionary, then restores the authored trigger metadata. This review runs no quest scheduler or conversation edge helpers. It tests GM authored edits, not a playable end-to-end continuation. The recorded comparison predates live definition compilation. On the follow-up runtime layers, validated document writes recompile definitions while preserving progress; the invariant now permits those definition/revision changes and still rejects unearned stage, activation or history changes. Historical scores in comparison.md used the earlier invariant.

The normal review hook calls the actual focused GM with the captured plot flag, existing tool surface and high reasoning, isolating it from activity/memory reviewers and Jev classification. The replay supplies the recorded character response without generating new speech. The rubric grades committed before/after edits for honouring delegation, a player return beat, reconnection to the cart, grounding and unchanged runtime state.

Run: `node --import tsx scripts/run-aldren-plot-eval.ts --repeats 2 --concurrency 2 --timeout-ms 600000` with OPENROUTER_API_KEY. The case now runs only `game`, using the promoted shared prompts. Temporary prompt/SQL variants and their lore overrides have been removed. The original fixture and rubric remain regression coverage. Inspect trial recordings for AI responses/tool calls, document diffs and final compiled quests. No UI is added. Historical comparisons below describe earlier commits, not currently available variants.

The latest author-draft comparison (two trials per configuration) is recorded separately in [current draft comparison](current-draft-comparison.md), preserving the earlier successful candidate results.

The follow-up [explicit return-beat comparison](return-beat-comparison.md) tests the restored positive instruction with two trials per configuration and independent compilation checks of edited trees.

See [promoted baseline validation](promotion-validation.md) for final default behavior, SQL tool availability, live trials and known compiler/tool-budget limitations.

## Document hook PoC

The current fixture now loads the generated, read-only hook API reference and the
same document hook registry as the game. The shared review guidance links the
reference index. No desired royal-report hook is seeded and no extra hook-specific
instruction is inserted into the captured conversation.

Two new deterministic criteria report whether the reviewer committed a new/edited
`.ts` hook and whether a final conversation edge binds that source. Unchanged
baseline hooks do not count. These measure authoring adoption, not semantic
correctness or successful execution of the future encounter; interpret them with
the existing delegation/grounding scores. The runtime-preservation criterion must
still pass: the review must not execute future effects while authoring source.

Run the ordinary command above with `--variants game --repeats 2 --concurrency 1`.
Inspect the recorded `docs/hooks/` reads, `.ts` writes and final `Run` headings.
For the separate live Holt path, run `node --import tsx scripts/playtest-holt-hooks.ts`
with the same key. It uses real dialogue and Jev decisions with ordinary game
mechanics, saving turns, actual hook output and final action legality under
`eval-output/`. No fixed die result or successful character response is injected.
