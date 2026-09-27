# Court state generations

Player creation remains a single-threaded flow and does not require generation IDs.
Court writes use opaque resource generations persisted in `RuntimeSnapshot.generations`.
Old saves without this field acquire generations on their first read.

| Resource | State covered |
| --- | --- |
| `character:id` | Character sheet, visible memories, task status/history, dialogue metadata |
| `actor:id` | Position, room, awake state |
| `inventory:owner` | Complete contents of a character inventory or fixture, including emptiness |
| `item:id` | Item identity, description, location and concealment |
| `fixture:id` | Container state, access requirements and discoveries |
| `door:id`, `doorway:id` | Door state and occupants of its tiles |
| `entity:id` | ID allocation across characters, fixtures, rooms and items |
| `world:context` | Premise, phase, day, room definitions and world facts |

Reads return `{ generationId, state }`. Writes supply the generations they read.
Every required generation is checked before publication; extra supplied generations
are also checked as decision dependencies. A changed resource gets a new ID even
when a subsequent mutation restores its previous value. Deleted resources keep
tombstones; a never-seen ID reads as `{ generationId: "absent", state: null }`.

Live conversation and NPC outcome reviews receive the current `world_state` before
the conversation/action evidence. Each resource is represented as
`{ resource_id, generation_id, data }`. The agent writes through small tools:

- `update_character`: provide `character_id`, its `generation_id`, and `changes`.
  `append_events` appends memories; `relationships` upserts only named characters;
  `lore` replaces the biography; `current_goal` sets a goal or clears it with `null`.
  Omitted fields remain unchanged. Empty arrays do not clear existing entries.
- `update_inventory`: provide `owner_id`, the **inventory's** `generation_id`, and
  `add_items`. These justified additions are validated together; existing items
  remain unchanged. This tool does not transfer, remove, or modify existing items.
- `record_overheard`, `record_witnessed`, and `message_player`: provide the affected
  character's generation. Hearing and participant eligibility still apply.
- `read_state`: refresh one resource by `resource_id` when needed.
- `finish_review`: finish alone after the intended writes, without repeating them.

The agent-facing tool descriptions include examples, field semantics, generation
sources, and recovery instructions. Each successful write is saved immediately by
the worker's mutation queue and returns `commit_result: "success"` and `new_state`.
A stale write returns `commit_result: "error"`, `reason: "Generation ID out of date"`,
and `new_state` containing the resource's current `generation_id` and `data`.
The agent must reconcile its intended change and explicitly re-call the write tool.
The engine never retries by substituting a newer ID. A failed call writes nothing,
but earlier successful calls remain saved, including if the review later fails.
Retries therefore read current state and must not replay already completed writes.

Other guarded court writes return structured generation conflicts. Jev actions carry generations
from their observation, and conflicts cause a new decision with refreshed, knowledge-filtered
state. Player commands carry generations from the visible world; conflict refreshes
the view so the player can choose again. NPC model contexts and player views do not
receive concealed state through generation errors.

Independent NPC jobs run concurrently; conversations reserve their participants
until review finishes. New mutation paths must observe generations at their mutation
boundaries and use the queue for live publication.
