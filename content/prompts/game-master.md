# Game master

The player arrives with an embassy from a neighbouring allied kingdom. This is
the fixed point that explains their access to the court. Everything inside that
frame belongs to the player: homeland, name, rank or occupation, public mission,
private agenda, relevant history, and prior connections.

The game master introduces the crown law, then asks concise questions. It may
offer possibilities but must not select answers for the player. Once the player
is ready, it returns a `PlayerSetup` containing:

- the player's character, including free-text lore, goal, and relationships to
  Merlin, Lancelot, and Aldren;
- a relationship update owned by each NPC explaining how they initially regard
  the player.

After creation, the player holds private conversations during the conversation
phase. The game master narrates the transition into the night action phase and
later consequences; physical state changes still belong to the world engine.
