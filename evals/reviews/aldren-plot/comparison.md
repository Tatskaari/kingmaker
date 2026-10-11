# Plot review comparison

The revised prompt produced the intended authored detour in both runs that used it. SQL search alone did not change the reviewer's decision. This is one trial per configuration, not evidence of reliability or a playable end-to-end fix. Nothing has been promoted into the default game prompt.

| Configuration | Committed edits | Return beat | SQL calls |
| --- | --- | --- | --- |
| Baseline | None | None | Unavailable |
| Prompt | Six documents; Aldren tree plus character/quest guidance | Aldren reports Holt's actual response and invites the player's next choice | Unavailable |
| SQL | None | None | One |
| SQL + prompt | Seven documents; adds Holt guidance as well | Aldren returns and reports; player chooses the follow-up | Zero, despite being available |

## Prompt only

The GM read Aldren's current tree and scenario notes, the quest index, investigation stage, knowledge boundaries and transition. It made 13 document write calls affecting six documents.

It added this route off Aldren's existing `helping` node:

`helping → will-approach-holt → order-delivered → returned-report`

The accepted persuasion remains binding. The new guidance distinguishes agreeing to act, actually delivering the order and reporting Holt's response. Aldren must return/contact the player if absent, or include them if present. The player chooses what to do; Aldren should not clear the cart or finish the delivery offscreen.

The investigation stage and `learn_cart_blocked` condition now allow either Holt telling the player directly or Aldren accurately relaying Holt's actual explanation. Aldren privately learning the cause is explicitly insufficient to advance the player-facing quest. It preserved `trigger: none`.

It also updated Aldren's situation and conversation notes, making the return beat visible in character-scoped guidance. It did not edit Holt, Rowan, Corvin or the guards. Its final answer explicitly identified the missing runtime report helper and unchanged live pointer.

## SQL only

It issued a query over scenario documents matching cushions, Holt and objectives, then read the quest definitions and knowledge boundaries using the normal document tool. It did not read or edit a conversation tree and made no writes.

Its final response began: “No quest or GM-document updates.” It reasoned that willingness was already recorded, the order was undelivered, and no investigation stage could advance. Search found relevant evidence; the original instruction still did not prompt adaptation of the agreed route.

## SQL and prompt

It made 15 document write calls affecting seven documents. It did not call SQL at all; discovery used `list_documents` and `read_document`. Any difference from prompt-only cannot be attributed to actually using SQL.

It added this Aldren route:

`helping → approach-holt → awaiting-holt-response → report-to-player`

Aldren should return with only the facts he heard, then offer the player a choice to hear Holt's account or investigate the obstruction. It revised the same character and quest notes as prompt-only and also changed Holt's `raging` guidance: acknowledge a royal order only after it has actually been delivered, and do not confuse that with compliance or delivered goods. Holt's existing nodes and edges were retained; this was a guidance edit, not a complete new king-to-Holt conversation branch.

Its final answer also identified the missing report-edge/helper wiring. It did not edit Rowan, Corvin, guards or the cart-resolution stage.

## Baseline and grading

The comparison baseline made no changes and said the promise did not support a stage update. An earlier baseline smoke run appended the commitment to the quest index, but still provided no return beat. That variation is why these results should be treated as exploratory.

The fixed rubric scored prompt and combined at 100%, versus 60% for baseline and SQL. The difference was the two criteria for committed player-return and quest-reconnection guidance. Every configuration preserved the runtime state and binding outcome. These are scores for authored guidance; 100% does **not** mean the route is executable. All trials completed with no execution or judging errors.

## What remains before this works in play

All three changed conversation trees (Aldren in each prompt variant, Holt in combined) pass the existing conversation-tree compiler. The output preserves existing node IDs and adds valid references. However:

- The compiled quest graphs, current pointers and activity remain unchanged in every run. Documents are editable, but the live conversation session/quest service still uses its existing graph. A supported graph-update operation needs validation and deliberate handling of the current node.
- Neither candidate added an executable `Run` helper to the new report edge. A supported report event must invoke the existing quest transition after the player hears the lead.
- The return instruction was written into character/quest guidance, not the currently executing activity. A later activity review must make that return actionable; this eval does not establish that it will.
- Conversation edges are evaluated on player dialogue. Their conditions about NPC-to-NPC events need authoritative recorded evidence; a valid Markdown graph alone does not establish that these edges will fire.

The eval starts with the captured Jev plot flag. It does not test revised Jev flagging, NPC travel or subsequent conversations. Positional activity guidance is deliberately outside this comparison.

## Evidence and validation

[Exact GM responses, tool sequence and committed diffs](gm-review-evidence.md). [Compact results](comparison-results.json). Full local recordings are under `eval-output/aldren-comparison/2026-10-11T15-25-23.737Z-95f59632/`; baseline smoke is under `eval-output/aldren-baseline/2026-10-11T15-23-53.072Z-cc61bf51/`.

Workspace typecheck, contracts lint and 14 affected tests passed. GitHub check/build passed for the comparison implementation. The fixture-isolation test verifies identical transcript input, high reasoning and the intended prompt/tool combinations across all four variants.
