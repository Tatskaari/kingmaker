# Authoring Guide

For the collaboration workflow and future agent-context design, see [[Authoring/Working on Lore|Working on Lore]].

World notes own factions, places, history and enduring rules. Cast folders, grouped by faction under `Cast/`, split each person into `private.md`, `gm.md` and observer-owned `knowledge/` notes. Each scenario character entry links to its own private cast note. Author references and unknown truths stay in GM notes; keep author indexes outside character-facing links. Plot notes collect the story threads. These are summaries of the sources, not newly settled canon.

Each scenario has a GM-facing `scenario.md` and separate `Characters/<name>/character.md` conversation entries. Their scoped detail stubs place the cast character at a specific time and location with current wants, knowledge, actions and situational prompting. Enduring speech style stays in Cast; see [[Agent Disclosure]]. Quest stubs are for possible events and the world-state changes they cause. Conversation stubs are for dialogue branches to improvise around. The map stub is for a place at a point in time, including tiles, occupants and inventories.

Start with a sketch in any stub. Link reusable author lore from GM and author notes. Character-facing notes need deliberately scoped knowledge; do not link them to unrestricted author lore. Use vault-relative wikilinks when note filenames repeat; Obsidian is configured to update links when a note is renamed. [[Scenarios/Centennial Assembly/index|Centennial Assembly]] supplies the links into the empty scenario notes until you fill them.

[[Sources and Decisions]] links the complete original issues. Proposed mappings or unanswered questions stay unresolved until you decide. The vault is not imported into the game. Return to [Lore index](../index.md).

## Folder indexes
Every lore content folder has a lowercase `index.md`, including the vault root. Use it for the folder overview, links to its notes and immediate child indexes, and a link back to the parent. Add or update the index whenever notes are added, moved or renamed. Keep headings descriptive even though the filename is always `index.md`.

Use vault-relative wikilinks with display labels for nested indexes, such as `[[Cast/index|Cast]]`. Link to the root index with a relative Markdown path such as `[Lore index](../index.md)` so it cannot resolve to a different folder's index. Indexes are author navigation; `scenario.md` and `character.md` remain the agent entrypoints. Indexes can contain navigation prose while unwritten playable detail stays a literal stub.

## Scenario character properties

Each `Scenarios/<scenario>/Characters/<name>/properties.json` defines that character's starting mechanical state for that scenario. Keep it beside `character.md`, not in Cast: stats, resources and equipment can differ between scenarios. These files are author/GM data, linked from author indexes rather than character-facing notes; inventory can include concealed items and other facts the character has not learned.

The file contains two fields using the existing [game protobuf](../../packages/contracts/proto/kingmaker/v1/game.proto) JSON representation:

- `dnd`: `DndCharacter` — ruleset, species, background, ability scores, class levels, choices, proficiencies, hit points, resources, spellcasting and conditions.
- `inventory`: `Inventory` — item instances and equipment references. Equipped and attuned item IDs must refer to items in this inventory.

Both start as `null`, meaning **not authored yet**, not zero stats or an empty inventory. Replace each independently with a protobuf JSON object when its contents are decided. Use lowerCamelCase field names, such as `abilityScores`, `hitPoints` and `mainHandItemId`, and protobuf enum names for enums. Inside an authored object, omitted fields follow protobuf defaults; use `inventory: {}` only when an empty inventory is intended. Do not invent scores, rules IDs or equipment to fill a stub, or store calculated sheet totals outside the protobuf's fields.

The normal repository checks require a properties file for each scenario character and validate authored objects against the protobuf. This is an authoring baseline only; the game still reads `content/` and does not load these files. Playthrough changes do not overwrite this baseline.
