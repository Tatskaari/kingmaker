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

The replay supplies the final player instruction and Rowan's accepted reply that
the tree is safely down, the cart has stopped bracing and its wheels have eased
back. The live conversation attention and review strategy run normally. The eval
does not seed clearance, a quest transition, fixture removal, delivery or the
public milestone.

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
errors. The production `game` strategy left Assembly Programme at
`cart_blocked`, retained the obstruction and did not publish the milestone:

| Criterion | Score |
| --- | ---: |
| Quest advanced | 0% |
| Obstruction cleared | 0% |
| Milestone broadcast | 0% |
| Delivery pending | 100% |

Local artifact:
`eval-output/2026-10-12T00-08-03.962Z-b334e5f2/`. This single trial establishes
the captured capability gap; it is not a general estimate of review quality.
