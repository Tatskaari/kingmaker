---
summary: "How to organize and author the lore vault, including audience boundaries, summaries, flat reader properties, Obsidian filters, folder indexes and scenario character properties."
---
# Authoring Guide

For the collaboration workflow and agent-context design, see [[Authoring/Working on Lore|Working on Lore]].

World notes own factions, places, history and enduring rules. Cast folders, grouped by faction under `Cast/`, split each person into `private.md`, `gm.md` and observer-owned `knowledge/` notes. Each scenario character entry links to its own private cast note. Author references and unknown truths stay in GM notes; keep author indexes outside character-facing links. Plot notes collect the story threads. These are summaries of the sources, not newly settled canon.

Each scenario has a GM-facing `scenario.md` and separate `Characters/<name>/character.md` conversation entries. Their scoped detail stubs place the cast character at a specific time and location with current wants, knowledge, actions and situational prompting. Enduring speech style stays in Cast; see [[Agent Disclosure]]. Quest stubs are for possible events and the world-state changes they cause. Conversation stubs are for dialogue branches to improvise around. The map stub is for a place at a point in time, including tiles, occupants and inventories.

Start with a sketch in any stub. Link reusable author lore from GM and author notes. Character-facing notes need deliberately scoped knowledge; do not link them to unrestricted author lore. Use vault-relative wikilinks when note filenames repeat; Obsidian is configured to update links when a note is renamed. [[Scenarios/Centennial Assembly/index|Centennial Assembly]] supplies the links into the empty scenario notes until you fill them.

[[Sources and Decisions]] links the complete original issues. Proposed mappings or unanswered questions stay unresolved until you decide. Conversation loaders read the vault or saved document state. Return to [Lore index](../index.md).

## Labels and read access in Obsidian

Set `readers` and `labels` to **List** properties in Obsidian. Use flat lists of strings; do not nest `characters`, `factions` or `labels` beneath `readers`. Inline lists and Obsidian's one-item-per-line YAML lists are equivalent. Keep `visibility` as a Text property.

For a character's own private note or observer knowledge note, name the reader explicitly:

```yaml
---
visibility: private
readers: ["character:aldren"]
---
```

For knowledge shared by a labelled audience:

1. Add `labels: [court-informed]` to each participating scenario `character.md`. Labels on other notes do not give a reader additional access.
2. Put the shared information in its own note with the following properties:

```yaml
---
visibility: private
readers: ["label:court-informed"]
---
```

3. Link that note from the relevant character entry or an already permitted note so Jev can discover it. For the assembly, use `court_briefing.md` → delegation overview → Cast `public.md`. Update author indexes separately.
4. Run the lore access tests through the normal repository checks. Start a fresh game to load changed baseline metadata into saved document state.

A list can mix grant types, such as `readers: ["character:aldren", "label:court-informed"]`; any match is enough. `faction:caerwyn` is also supported when a trusted audience supplies faction membership, but a faction mentioned in prose gives no permission. Use exact, case-sensitive IDs without spaces or additional colons. Unknown prefixes and nested reader mappings are invalid.

Use `visibility: gm` for hidden truth regardless of reader entries. Use `visibility: public` only when every character may read the entire note. A filename such as `public.md`, a document label, or an Obsidian tag does not grant access. See [[Authoring/Agent Disclosure|Agent Disclosure]] for the full contract.

### Help Jev find the right note

Every lore document, including indexes, author references and stubs, needs a `summary` **Text** property with one or two sentences describing its actual contents. Include ordinary terms a player might use, such as “wizards”, alongside names and titles. Keep the corresponding facts in the body too. For a stub, say explicitly that its content is unwritten and retain the literal “This is a stub.” body. Summaries are presented above the candidate path when Jev decides whether to open a permitted link; they do not replace links, permissions or the full note. See [[Authoring/Agent Disclosure|Agent Disclosure]] for the loading contract.

### Graph filters

Obsidian's [Graph view](https://obsidian.md/help/plugins/graph) accepts [property searches](https://obsidian.md/help/plugins/search) in **Filters → Search files** and in **Groups**:

- `[readers:"character:aldren"]` — notes explicitly naming Aldren as a reader.
- `[readers:"label:court-informed"]` — notes granting the shared court audience access.
- `[labels:"court-informed"]` — labelled notes, including the participating character entries.
- `[visibility:gm]` — explicitly GM-only notes.

These filters inspect properties; they do not calculate a character's complete effective access or follow permissions through links. In particular, the Aldren filter does not include his shared label grants. Keep `labels` as a list property; it is separate from Obsidian's special `tags` property.

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
