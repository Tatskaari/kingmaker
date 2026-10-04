# Peregrine's wooden bird gift

Source: the user-provided terminal screenshot `codex-clipboard-9996e79d-3e2f-439d-b184-846908cfd8d7.png`,
showing `npm run conversation -- --character peregrine`. The six visible turns are manually
transcribed, preserving the player's spelling. Terminal wrapping is removed. No hidden
model calls, GM rulings, acceptance turn or post-review state were supplied.

The user explicitly chose **the player receives the bird** as the desired outcome, rather
than requiring a subsequent acceptance. This is an eval expectation, not an invented
transcript turn. Review should persist the harmless gift in the player's real inventory,
retain Peregrine's memory, and preserve the item description and unrelated possessions.
Peregrine's account of the East and Abel remains attributed to him.

Reconstruction uses the current authored playable world and default player. Both speakers
are placed together in the Great Hall and Peregrine starts without an activity or wait.
These are test preconditions, not claims about the screenshot's hidden world state. No bird
is pre-seeded: it was introduced in dialogue and does not exist in authored inventories.
This replays conversation review only, not dialogue generation or physical handoff execution.

Run `OPENROUTER_API_KEY=… npm run eval:review:gift -- --repeats 3`.
The dedicated entrypoint uses the common runner, recorders, Jev grader, concurrency and
artifact reporting. It keeps this baseline-only case and its additional inventory criterion
separate from the existing strategy comparison suite. No candidate or production fix is added.

Seven shared review criteria grade grounding, coverage, knowledge, intent, preservation,
restraint and physical-state preservation. The extra deterministic `gift-inventory` criterion
requires exactly one item described as a wooden bird in the player's typed inventory and
none in Peregrine's. Prose memories alone cannot pass. Identification uses “bird” and
“wood”/“wooden” in item names/details, not an imposed item ID; alternate descriptions may
need inspection. Jev assesses semantic fidelity and preservation separately.
