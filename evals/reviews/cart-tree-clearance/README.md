# Cart tree-clearance review

This eval reconstructs the final Rowan turn from
`~/git/qa-dumps/world-state-stuck-after-cart-resolution.zip` immediately before
the world-state failure. The archive SHA-256 is
`8ff20760c3d1ed3cf1703e43c50dd3fc51b9613929060169faf7de302f6f3eb9`.
The recorded dialogue reply is agent-run call 349; its post-reply attention
decision is call 352.

## Reconstruction

The fixture builds a fresh current-format Centennial Assembly world from source
lore. It overlays only Rowan's captured pre-completion activity, places Rowan and
the player at their recorded Entrance Hall positions, and starts Assembly
Programme at `cart_blocked`. It retains the source map's intact two-tile cart and
gift tree. Later dump edits, stale replacement activities and post-hoc memories
are deliberately excluded.

The replay supplies a compact, grounded version of the relevant exchange: Holt's
limited inspection permission, Rowan's inconclusive inspection, the player's
tree-transfer proposal, its binding successful persuasion ruling, Rowan's
agreement, the coordinated lift and Rowan's observation that the tree is safely
down and the cart has stopped bracing. It is not a verbatim transcript, but it
preserves the causal facts and the distinction between agreeing, acting and
observing the result.

The experiment then runs exactly one production-style `plot_progress` review
over the complete transcript. It fixes that classification instead of rerunning
Jev's attention pass, and does not run the conversation-tree evaluator or the
full web-host turn pipeline. This isolates the question under test: can the plot
review connect an established outcome to the authored quest hook? It does not
seed clearance, a quest transition, fixture removal, delivery or the public
milestone.

## Expected result

A successful authoritative resolution advances Assembly Programme to
`cart_unblocked` through the authored hook, removes the blocking left cart
fixture, preserves the tree beside the entrance and creates the idempotent
`Reviews/cart-cleared.md` broadcast. It must not claim the cushions or other
supplies have already arrived.

The captured failure left the quest and fixtures unchanged because conversation
reviews could edit documents and activities but had no quest-advance operation.
This baseline eval measures committed state rather than accepting a review
summary that merely describes clearance.

## Baseline result

One live serial trial on 2026-10-12 completed without execution or judging
errors. The focused production `plot_progress` review left Assembly Programme
at `cart_blocked`, retained the obstruction and did not publish the milestone:

| Criterion | Score |
| --- | ---: |
| Quest advanced | 0% |
| Obstruction cleared | 0% |
| Milestone broadcast | 0% |
| Delivery pending | 100% |

Local artifact:
`eval-output/2026-10-12T00-16-18.332Z-93bad773/`. This single trial demonstrates
the capability gap under the focused design; it is not a general estimate of
review quality. The earlier three-review run used the abbreviated final exchange
and is not comparable to this corrected result.

## Candidate comparison

One live serial comparison on 2026-10-12 completed without execution or judging
errors. The temporary `advance-quest-tool` strategy added the host-dispatched
tool, removed the hook's duplicate remedy whitelist, and instructed plot review
to favour completed improvised solutions without requiring their downstream
effects to exist first.

| Variant | Quest advanced | Obstruction cleared | Milestone broadcast | Delivery pending | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| `game` | 0% | 0% | 0% | 100% | 25% |
| `advance-quest-tool` | 100% | 100% | 100% | 100% | 100% |

Local artifact:
`eval-output/2026-10-12T00-39-45.130Z-6c1cf6af/`. This single paired run supports
promotion for the captured regression, but is not a broad estimate of review
behavior.

## Promoted baseline

One live serial run after promotion completed without execution or judging
errors. The production `game` baseline scored 100%: it advanced to
`cart_unblocked`, cleared the obstruction, published the milestone and left
delivery pending.

Local artifact:
`eval-output/2026-10-12T00-46-01.292Z-a44c07a7/`.
