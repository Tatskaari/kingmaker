# Dialogue model

The assembled context is deliberately simple and complete:

1. System instructions.
2. The scenario premise and ancient law.
3. This character's lore, dialogue objective, long-term objectives, and immediate goal.
4. This character's relationships.
5. Every public note and private note involving this character.
6. The character's complete known world state. Unknown container contents and
   concealed objects remain only in the authoritative game-master state.
7. The conversation transcript.

Each spoken response contains an utterance and optional `replyOptions` (an empty
array or one or more player replies), plus `endConversation`. An NPC can take
its leave with closing words, `endConversation: true`, and no reply options.
It does so only for a concrete reason to leave now, such as beginning an
immediate chosen task, refusing further discussion, or an urgent interruption.
Completing a dialogue objective is not a reason to close the scene. An NPC must
keep the conversation open whenever its response asks the player a question,
makes an offer, or requests help so the player has a chance to answer.
The UI retains those words while automatically reviewing the conversation.
Ending the conversation triggers a separate
review of the entire transcript and existing character context. The review saves
new free-form private notes and any warranted goal, relationship, or biography updates,
then clears the transcript. Returning to the NPC starts a fresh thread with that
durable memory. Failed reviews or saves leave the conversation open for retry.
Existing notes remain historical records; changed circumstances are appended as
new notes without duplicating earlier memories. Notes are intentionally free-form
and cover observations, thoughts, promises, agreements, insults, apologies,
revelations, and conversations.

Dialogue may create intent, social meaning, misinformation, and surprising plans.
Speech alone cannot mutate the physical world: merely saying "I give you the key"
does not transfer it. During live player dialogue, an NPC can call `give` for an immediate physical
handoff. Jev accepts it only when the exact item is physically and personally
plausible for that character to surrender. The background action planner still
has no give-item action.

Reply options should offer distinct roleplaying intentions and match the player’s voice and behaviour in the visible conversation. They are suggestions, not spoken NPC dialogue or notes. Only a selected or typed response becomes player speech. NPCs cannot compel responses; the GM alone can use compulsion during stalled character creation.

## Real-world events

Physical interactions and completed conversations emit transient world events.
Nearby characters first make a distance-based perception roll: Clear 100%,
Moderate 60%, and Distant 30%. Closed doors and blocked paths exclude listeners.
Moderate and Distant perceptions deliberately omit details.

For every successful NPC perception, Jev makes a fast process-or-ignore decision.
It chooses process when the event can advance, block, reactivate or materially
change an active or parked objective, or when the character would naturally react
immediately, such as to a crime or threat. Processing may interrupt current work.
The character review model then records the perception as a note and may revise,
park, reactivate, replace or preserve objectives. Events themselves are not durable
memory and are never treated as instructions.

## Dialogue objectives

Each NPC has a priority-ordered `dialogueObjectives` list separate from
physical/action objectives. Each entry describes something the character hopes
to reveal, learn, or elicit from the player. The dialogue model should pursue
only the objectives that fit, through believable pacing and only
when the conversation, relationship, and character knowledge support doing so.
It must not recite or exhaust the list, force a topic, invent knowledge, or
guarantee the player's cooperation. Conversation review preserves unfinished
entries, removes fulfilled or obsolete entries, and adds newly relevant threads
known to that character. It never sends dialogue objectives to Jev.


## Immediate goals

NPC `currentGoal` and conversation-review `goalUpdate` describe the next concrete
task for the action planner. Longer-term ambitions remain character context.
The shared guidance in `packages/core/src/goal-guidance.ts` is included in the
character context used by both dialogue and review, in the main game.
It asks for explicit targets and observable completion conditions,
preserves character agency, and leaves pathfinding and action selection to the
engine and planner. No change of intent means `goalUpdate: null`.

This framing follows Jev's guidance on direct, literal conditions and reduced
indirection: https://docs.typesafe.ai/model-jaggedness/jev-1.13 . It does not supply
search recipes or force the NPC to agree to the player's proposals.

Authored `objectives` hold the broader ambitions of each NPC. They inform dialogue,
review, and planner character context independently of `currentGoal`. Conversation
review updates immediate intent without replacing these objectives.

Passive waiting is idle intent. Once the NPC is in the intended place and any
required physical work is done, both conversation and planner-outcome reviews
return `goalUpdate: null` for waiting on speech, someone leaving, or a future
request. Record meaningful intentions in memory; do not re-activate Jev just to
maintain an already-achieved state. A non-null goal is for work needed now.
