# Agent Disclosure

This is a proposed content-loading contract for future game integration. Obsidian links provide navigation, not access control; no loader or prompt integration is implemented here.

## Initial context
The GM receives the scenario's `scenario.md`. Fill its world/opening section with the minimum setting, starting situation and invariant rules needed to adjudicate play without opening every note. Its links lead to deeper world lore, plots, quest conditions, scene trees, map state and character dossiers.

Each conversation receives only its own `Characters/<name>/character.md`. Fill its core section with the minimum identity, voice, current objective and hard boundaries needed for a first response. More detailed material is fetched only when relevant; the entry must not depend on reading all linked notes first.

## Character detail
Each scenario character entry links to its reusable `Cast/<faction>/<name>.md` note as an author/GM reference. That link establishes identity and provenance; it does not expand the conversation agent’s retrieval permissions. Put the character-visible subset in their scoped notes.

- `background.md`: character-visible identity, relationships and world understanding. Extract deliberately from author lore; other characters' hidden motives do not belong here.
- `situation.md`: starting knowledge and beliefs, current objectives, prompting/tactics and conditions for disclosing the character's own secrets. Distinguish known facts from suspicions and unknowns.
- `conversation.md`: that NPC's permitted dialogue beats and improvisation limits. Do not copy the full GM scene tree, hidden triggers, other speakers' private intent or unrevealed consequences.

Shared cast/world notes and source issues are author/GM material by default. A character's knowledge is not defined by what is reachable through the authoring graph. Public facts can be included in scoped notes when authored; a future shared player-safe reference needs an explicit grant, not a link to the whole vault.

## Progressive disclosure
1. Supply the entry file and current, recipient-visible game facts.
2. Fetch a permitted detail note only when its topic matters. Follow plain links on demand; do not recursively expand the vault or use automatic embeds.
3. Let the GM adjudicate actions, quest transitions and new discoveries using the full scenario notes.
4. Send only the resulting observations/knowledge to the characters who actually learn them. Do not reveal the hidden branch or overwrite baseline lore with playthrough state.

Conversation retrieval must be restricted to the owning character's subtree and explicitly granted resources. GM material and sibling character folders must remain unavailable even if requested. Enforce that in the future loader/tool permissions; prompt wording alone is not a boundary. Until then, these are authoring conventions only.

## Paths and stubs
Use vault-relative wikilinks for repeated filenames such as `character.md`, `background.md` and `scenario.md`. Each NPC has a separate directory, and every scenario should use its own subtree. Obsidian settings use absolute paths within the vault, not machine-specific paths.

Entry files contain routing text and a blank core section. All supporting scenario content files, excluding author navigation indexes, contain exactly “This is a stub.” until the author sketches them. See [[Scenarios/Centennial Assembly/index|Centennial Assembly]] and [[Authoring Guide]].
