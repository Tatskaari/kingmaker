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

GM reconciliation tools and final memory JSON prepare a private proposal.
The same reviewing agent then receives `read_state` and `commit_review` tools.
`commit_review` atomically publishes the complete character review and world changes.
The worker's mutation queue rechecks generations and saves before acknowledging success.
A conflict returns `generation_conflict`, fresh state and IDs, and an instruction to
reconcile and explicitly re-call the write tool. The engine never retries a stale
write by substituting newer IDs. Exhaustion or failed persistence leaves the review
available for retry; no part of its proposed update is saved.

Direct court GM writes use the same conflict response. Jev actions carry generations
from their observation, and conflicts cause a new decision with refreshed, knowledge-filtered
state. Player commands carry generations from the visible world; conflict refreshes
the view so the player can choose again. NPC model contexts and player views do not
receive concealed state through generation errors.

This establishes guarded publication; it does not replace the existing single-NPC
background scheduler with concurrent NPC runners. New mutation paths must observe
generations at their mutation boundaries and use the queue for live publication.
