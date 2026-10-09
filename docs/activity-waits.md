# Character activities and waits

Each record in saved `world.simulation.runtimeCharacters`, keyed by runtime character or guard instance ID, owns optional vault-relative Markdown paths, `activity` and `wait`, plus an `intentRevision`. Scene creation copies authored `character.md` defaults into these fields once. Runtime character records also identify the shared character and its document; physical map actors do not store intent. Subsequent reviews change runtime fields, leaving the authored defaults unchanged. Bodies sharing one character document have independent pointers; a shared identity targets the nearest body, while an explicit instance ID targets that body. An activity takes precedence. Without an activity, a wait receives an independent Jev check every 12–18 seconds. Without either reference the character is idle. Saved-game format 6 requires a fresh game; older saves are not migrated.

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

- `set_activity(name, status, success_criteria, current_goal, activate?)` saves an activity and normally activates it. `activate:false` defines a reusable option and returns its path without changing the current intent.
- `set_wait(name, instructions, activities, routine?)` saves a wait and clears the activity. `routine:true` writes the character's sibling `routine.md`.
- `clear_activity()` clears the activity and returns to the sibling routine, if present.

Each tool stages only its own document writes, then immediately publishes activity files and runtime pointers atomically with document SHA and actor intent-revision conflict checks. A conflict publishes nothing from that call and requires retrying against the refreshed character document. Earlier successful calls remain saved. Runtime files are part of the saved world, not edits to the author's vault.

The action planner explicitly supplies the activity's full fields to Jev. `wait` sends the action outcome to the LLM to create a conditional wait. `complete` clears the activity and sets `wait` to the character's `routine.md`, or null if absent. Finishing travel is not completion of an explicit travel-and-wait instruction.

Wait Jev receives the wait, elapsed time, permitted character context, and current-room observations. Its only choices are:

- `set_activity:<path>` for an entry in `activities`: activates that file and clears the wait, without an LLM call.
- `continue`: retains the wait and sleeps until the next check.
- `stop_waiting`: clears the wait, then calls the review LLM. Guard instances have individual post activities and routines and may leave their posts to respond to witnessed trouble. Pending reconsideration is saved so a provider failure can be retried after reload.

Checks do not overlap for a character and are skipped during conversations and conflicting work. Game replacement and pause cancel outstanding checks. Changed observations or document hashes invalidate stale decisions. Timers start anew on load rather than replaying offline ticks.

Run `OPENROUTER_API_KEY=… npm run eval:wait` for the live treasury scenario. `WAIT_EVAL_REPEATS` defaults to 3. JSON artifacts under `eval-output/waits/` include physical milestones, model requests and responses, and the final save. The eval uses live Jev and review calls for travel, conditional waiting and waking to greet the player. Routine fallback is a separate deterministic check after the harness marks the greeting complete; it does not claim to have played a full conversation.

For rubric-based comparisons of review strategies, use [the common eval framework](evals.md).

Run `OPENROUTER_API_KEY=… npm run eval:review:handoff` to replay Oswin's parlour intimidation conversation from the 2026-10-03 issue dump. Existing conversation-review unit tests mock model replies; this eval executes the current live review and its multi-step tools. It starts from a fresh authored world with Oswin and the player still in the Great Hall, retaining the exact player message, binding GM ruling, and NPC reply in `evals/reviews/oswin-parlour.json`.

Success requires a committed activity, no premature wait, an unchanged physical map, and a read-only Jev plan to open the parlour door or enter it. This tests the conversation-to-travel handoff; the treasury eval separately tests travel, waiting, and waking. It does not reproduce the whole saved game or grade every generated memory note. `REVIEW_EVAL_REPEATS` defaults to 3; `REVIEW_EVAL_OUTPUT_DIR` defaults to `eval-output/reviews/`. Artifacts include the input transcript, initial/final saves, model exchanges, and per-condition results. Any failed run exits nonzero. The original prompt failed all three baseline runs by saving a premature wait. Use this eval to check the GM review prompt and handoff after changes.

GM reviews and roll rulings use the same document and activity tools. Reviews begin with the GM role and storytelling responsibilities; character lore is supplied as evidence, alongside the NPC’s actual location. The GM can inspect live pointers and instance IDs with `list_characters`, and list, read, create, replace, insert into and delete documents across all characters and quests. Document discovery is paginated. Direct document edits save immediately with SHA checks and automatic validation; memories use those document tools exclusively. Each activity tool publishes its validated documents and intent together immediately, so an NPC can start work after the conversation ends while the GM continues reviewing. The GM sets executable activity before memory bookkeeping. Earlier successful calls remain saved if a later call fails. A conflict discards that call’s intent changes and supplies the current document for reconciliation. GM access never grants an NPC knowledge: quest truths and private memories retain their audience permissions.

## Following a character

Jev's room actions offer `follow_<id>` alongside Talk for each visible, awake character.
Selecting Follow saves a wait with `follow_target` set to that body's ID and the current
activity in `activities`. Movement runs without model calls, choosing a free adjacent
tile using current positions. It respects closed doors, furniture and room access;
blocked followers remain in place until the route opens or Jev chooses another action.

Following waits wake Jev every 15 seconds. Continue keeps following; activating the
original activity returns to ordinary planning; stop_waiting requests reconsideration.
Movement pauses during the check and conversations. Pause, game replacement and changed
intent cancel pursuit. Saved waits resume with fresh timers on load. This action is
available to NPC planners, including when the followed character is the player.

