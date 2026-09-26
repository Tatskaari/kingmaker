# Dialogue model

The assembled context is deliberately simple and complete:

1. System instructions.
2. The scenario premise and ancient law.
3. This character's lore, long-term objectives, and immediate goal.
4. This character's relationships.
5. Every public event and private event involving this character.
6. The character's complete known world state. Undiscovered hiding places and
   concealed objects remain only in the authoritative game-master state.
7. The conversation transcript.

Each spoken response contains an utterance and optional `replyOptions` (an empty
array or one or more player replies), plus `endConversation`. An NPC can take
its leave with closing words, `endConversation: true`, and no reply options.
The UI retains those words while automatically reviewing the conversation.
Ending the conversation triggers a separate
review of the entire transcript and existing character context. The review saves
new private events and any warranted goal, relationship, or biography updates,
then clears the transcript. Returning to the NPC starts a fresh thread with that
durable memory. Failed reviews or saves leave the conversation open for retry.
Existing events remain historical records; changed circumstances are recorded as
new events without duplicating earlier memories. Events cover every social
concept: observations, thoughts,
promises, agreements, insults, apologies, revelations, and conversations.

Dialogue may create intent, social meaning, misinformation, and surprising plans.
It cannot directly mutate the physical world. A character saying "I give you the
key" can create an event and a goal; the autonomous action loop must still choose
and execute the physical `give` action.

Reply options should offer distinct roleplaying intentions and match the player’s voice and behaviour in the visible conversation. They are suggestions, not spoken NPC dialogue or events. Only a selected or typed response becomes player speech. NPCs cannot compel responses; the GM alone can use compulsion during stalled character creation.


## Immediate goals

NPC `currentGoal` and conversation-review `goalUpdate` describe the next concrete
task for the action planner. Longer-term ambitions remain character context.
The shared guidance in `packages/core/src/goal-guidance.ts` is included in the
character context used by both dialogue and review, including the palace demo.
It asks for explicit targets and observable completion or waiting conditions,
preserves character agency, and leaves pathfinding and action selection to the
engine and planner. No change of intent means `goalUpdate: null`.

This framing follows Jev's guidance on direct, literal conditions and reduced
indirection: https://docs.typesafe.ai/model-jaggedness/jev-1.13 . It does not supply
search recipes or force the NPC to agree to the player's proposals.

Authored `objectives` hold the broader ambitions of each NPC. They inform dialogue,
review, and planner character context independently of `currentGoal`. Conversation
review updates immediate intent without replacing these objectives.
