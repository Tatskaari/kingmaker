# Authoring Guide

For the collaboration workflow and future agent-context design, see [[Authoring/Working on Lore|Working on Lore]].

World notes own factions, places, history and enduring rules. Cast notes, grouped into faction folders under `Cast/`, own a person's identity, voice and relationships across scenarios. Each scenario character entry links back to its cast note as an author/GM reference. Plot notes collect the story threads. These are summaries of the sources, not newly settled canon.

Each scenario has a GM-facing `scenario.md` and separate `Characters/<name>/character.md` conversation entries. Their scoped detail stubs are for what that person wants, knows and does, including prompting; see [[Agent Disclosure]]. Quest stubs are for possible events and the world-state changes they cause. Conversation stubs are for dialogue branches to improvise around. The map stub is for a place at a point in time, including tiles, occupants and inventories.

Start with a sketch in any stub. Link reusable author lore from GM and author notes. Character-facing notes need deliberately scoped knowledge; do not link them to unrestricted author lore. Use vault-relative wikilinks when note filenames repeat; Obsidian is configured to update links when a note is renamed. [[Scenarios/Centennial Assembly/index|Centennial Assembly]] supplies the links into the empty scenario notes until you fill them.

[[Sources and Decisions]] links the complete original issues. Proposed mappings or unanswered questions stay unresolved until you decide. The vault is not imported into the game. Return to [Lore index](../index.md).

## Folder indexes
Every lore content folder has a lowercase `index.md`, including the vault root. Use it for the folder overview, links to its notes and immediate child indexes, and a link back to the parent. Add or update the index whenever notes are added, moved or renamed. Keep headings descriptive even though the filename is always `index.md`.

Use vault-relative wikilinks with display labels for nested indexes, such as `[[Cast/index|Cast]]`. Link to the root index with a relative Markdown path such as `[Lore index](../index.md)` so it cannot resolve to a different folder's index. Indexes are author navigation; `scenario.md` and `character.md` remain the agent entrypoints. Indexes can contain navigation prose while unwritten playable detail stays a literal stub.
