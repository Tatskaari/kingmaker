# Live Holt hook playtest

On 2026-10-11, the fresh-game playtest in `scripts/playtest-holt-hooks.ts` passed
after rebasing the implementation onto main's structured transition results.
It uses the normal `WorldGameRuntime`, live model calls and authored documents;
it does not inject a transition decision or a permission result.

The player asked about the delayed cushions, offered help with the obstruction,
and then proposed smashing the cart if Holt authorised it. On the third exchange,
Holt explicitly granted permission. The conversation reached `authorised` through
`blessing-given` and returned:

```json
{"status":"accepted","message":"Holt authorised the player to smash the cart."}
```

Both cart fixtures, `furn_cart_left` and `furn_cart_right`, then had a `smash-cart`
action for `player` with `illegal: false`. The pillow-lead hook also ran on the
first exchange. This verifies permission and its executable fixture effect; it
does not claim the cart was physically destroyed.

Reproduce with an OpenRouter key in the environment:

```sh
node --import tsx scripts/playtest-holt-hooks.ts eval-output/holt-hooks
```

The script writes `result.json` and `model-runs.json` to the output directory and
exits unsuccessfully unless permission and both fixture effects are observed.
Model responses and the number of turns can vary. Generated run artifacts are
ignored by Git. The King plot-review eval is unchanged; this playtest checks
execution of shipped document hooks, not automatic hook creation by a reviewer.
