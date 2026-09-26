# Jev action policy

For each autonomous turn, send Jev:

- the whole character, including lore, relationships, and current free-text goal;
- every event visible to that character;
- the character's complete known world state;
- every concrete action currently offered by the engine.

Ask one Choice question: "Which action should this character perform next to
pursue their current goal, given who they are and what has happened?"

Each criterion is an action ID paired with its plain-language description. The
engine should enumerate generously. A sleeping character can wake. An awake
character can move to an adjacent room or search the current room. Searching
reveals several plausible interactions—open a desk, look under a bed, inspect a
hearth—without identifying which is useful. Investigating a spot may reveal an
object and therefore actions such as take, unlock, open, or give. Jev must return
one supplied ID. The engine revalidates it before applying it.

This is reactive goal-oriented action selection, not a shortest-path GOAP search.
The hypothesis is that free goals and social context produce more novel behaviour
than a symbolic plan. If agents become aimless, repetitive, or short-sighted, that
result tells us what planning structure to add next.
