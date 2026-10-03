# Character activities and waits

A character's saved `character.md` frontmatter has two nullable, vault-relative Markdown paths: `activity` and `wait`. An activity takes precedence. Without an activity, a wait receives an independent Jev check every 12–18 seconds. Without either reference the character is idle. Saved-game format 3 requires a fresh game; older saves are not migrated.

Activity documents retain the old objective's four fields in frontmatter:

```yaml
summary: Meet the player in the treasury.
visibility: private
readers: ["character:corvin"]
name: Meet the player in the treasury
status: The player has not arrived. Go there and wait.
success_criteria: Greet the player after their arrival in the treasury.
current_goal: Go to the treasury and wait for the player.
```

Wait documents have prose instructions and an optional `activities` list of activity-document paths. The referenced documents must be readable by the character. For example:

```yaml
summary: Wait in the treasury for the player.
visibility: private
readers: ["character:corvin"]
activities: []
```

The body can say: “Remain in the treasury. Continue while the player is absent. When you see the player here, stop_waiting so you can decide how to greet them.” A routine can instead offer several activity paths and describe when each is suitable.

The review LLM has three intent tools:

- `set_activity(name, status, success_criteria, current_goal, activate?)` stages an activity and normally activates it. `activate:false` defines a reusable option and returns its path without changing the current intent.
- `set_wait(name, instructions, activities, routine?)` stages a wait and clears the activity. `routine:true` writes the character's sibling `routine.md`.
- `clear_activity()` clears the activity and returns to the sibling routine, if present.

These tools stage document writes. `commit_review(summary, newNotes)` publishes all files, notes and character references atomically with SHA conflict checks. A conflict publishes nothing and requires restaging against the refreshed character document. Runtime files are part of the saved world, not edits to the author's vault.

The action planner explicitly supplies the activity's full fields to Jev. `wait` sends the action outcome to the LLM to create a conditional wait. `complete` clears the activity and sets `wait` to the character's `routine.md`, or null if absent. Finishing travel is not completion of an explicit travel-and-wait instruction.

Wait Jev receives the wait, elapsed time, permitted character context, and current-room observations. Its only choices are:

- `set_activity:<path>` for an entry in `activities`: activates that file and clears the wait, without an LLM call.
- `continue`: retains the wait and sleeps until the next check.
- `stop_waiting`: clears the wait, then calls the review LLM. Pending reconsideration is saved so a provider failure can be retried after reload.

Checks do not overlap for a character and are skipped during conversations and conflicting work. Game replacement and pause cancel outstanding checks. Changed observations or document hashes invalidate stale decisions. Timers start anew on load rather than replaying offline ticks.

Run `OPENROUTER_API_KEY=… npm run eval:wait` for the live treasury scenario. `WAIT_EVAL_REPEATS` defaults to 3. JSON artifacts under `eval-output/waits/` include physical milestones, model requests and responses, and the final save. The eval uses live Jev and review calls for travel, conditional waiting and waking to greet the player. Routine fallback is a separate deterministic check after the harness marks the greeting complete; it does not claim to have played a full conversation.

Run `OPENROUTER_API_KEY=… npm run eval:review` to replay Oswin's parlour intimidation conversation from the 2026-10-03 issue dump. Existing conversation-review unit tests mock model replies; this eval executes the current live review and its multi-step tools. It starts from a fresh authored world with Oswin and the player still in the Great Hall, retaining the exact player message, binding GM ruling, and NPC reply in `evals/reviews/oswin-parlour.json`.

Success requires a committed activity, no premature wait, an unchanged physical map, and a read-only Jev plan to open the parlour door or enter it. This tests the conversation-to-travel handoff; the treasury eval separately tests travel, waiting, and waking. It does not reproduce the whole saved game or grade every generated memory note. `REVIEW_EVAL_REPEATS` defaults to 3; `REVIEW_EVAL_OUTPUT_DIR` defaults to `eval-output/reviews/`. Artifacts include the input transcript, initial/final saves, model exchanges, and per-condition results. Any failed run exits nonzero. Production prompts are unchanged, so the reported bug may fail this baseline eval.
