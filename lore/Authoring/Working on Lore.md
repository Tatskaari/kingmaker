# Working on Lore

This guide is for the assistant collaborating with the author. The same vault serves two purposes: a comfortable place to develop the story in Obsidian, and a future source of selectively loaded context for in-game agents. Keep the writing understandable without requiring the author to design a runtime schema.

## Working together
Work directly in `~/git/kingmaker`, with Obsidian open on `~/git/kingmaker/lore`. Read `AGENTS.md`, this guide, the relevant folder indexes and the notes involved before editing. Inspect Git status and preserve the author's live edits and personal Obsidian settings; stage only the work belonging to the request.

The author supplies direction and sketches. Organize or expand the material they ask to work on, retaining their intent, tone and unresolved choices. A request for structure is not a request to invent lore, dialogue or quest mechanics. Unwritten content stays exactly “This is a stub.” Entry files and indexes may contain routing and blank sections. Once the author writes a sketch, preserve and develop it rather than replacing it with a generic template.

Use the latest explicit author decisions over older issue text. Preserve the original issues as references. Mark a proposed addition or unresolved contradiction clearly; do not quietly turn an inference into canon. Resolve routine organization yourself, and ask about a story choice when the answer materially changes the requested work. Do not require approval for ordinary authorized edits.

## Where writing belongs
| Material | Home | Purpose |
| --- | --- | --- |
| Factions, places, historical events and durable rules | `World/` | Setting shared across scenarios |
| Identity, voice, enduring motives and relationships | `Cast/<faction>/<name>.md` | Reusable character truth, with author-only secrets distinguished |
| Dramatic conflicts and possible story arcs | `Plots/` | Direction without a predetermined outcome |
| World summary, opening situation and invariant scenario rules | `Scenarios/<scenario>/scenario.md` | Compact initial GM context |
| Identity, voice, present objective and hard boundaries | `Characters/<name>/character.md` within a scenario | Compact initial conversation context, linked to the main cast entry |
| Deeper personal context | That character's `background.md`, `situation.md`, `conversation.md` | Scoped detail to retrieve when relevant |
| Possible events, effects, full scene trees and physical state | Scenario `Quests/`, `Conversations/`, `Map/` | GM detail, separate from character knowledge |

When we develop a character, establish the reusable person in Cast first, then describe what that person wants and knows in this particular scenario. Update the cast reference link whenever the character moves. The scenario must not become an unrelated duplicate biography. A scoped background can summarize what the character knows about themselves and others, with its author reference maintained so later lore changes can be reconciled.

When we develop a quest, distinguish prerequisites, attempted actions, completed events, actual state changes and who learns what. A world-history note records an established event; a quest branch is only a possibility. Keep alternatives, refusals and unresolved outcomes playable. Conversation beats help an NPC improvise; they do not grant the NPC authority to decide another character's feelings or apply world-state changes. Map notes describe the scenario's point-in-time tiles, occupants, access and inventories, linked to enduring places.

## Write for progressive disclosure
The GM begins with `scenario.md`; a conversation agent begins with its own `character.md`. Each entry should eventually contain enough essential context for a useful first decision, plus clearly labelled links explaining what deeper notes contain and when they are relevant. Avoid an empty entry that requires loading the whole vault to understand the situation. The current blank sections are intentional authoring stubs, not finished prompts.

Split detail by topic and audience. Write short, descriptive notes and links; fetch the relevant note when needed rather than recursively loading every link. Indexes are human navigation and are not automatically part of any agent prompt. Keep source issues, author discussion and editorial uncertainty out of character-facing context unless deliberately translated into that character's uncertainty.

Separate three things explicitly: author truth, a character's knowledge or belief, and facts established publicly in play. A cast backlink identifies the reusable person; it does not mean the conversation agent may read every secret in that note. The GM can use the full authored scenario, while a character receives only its scoped material and facts it has actually learned. The runtime will need to enforce retrieval permissions; Markdown links and instructions alone cannot do that. See [[Authoring/Agent Disclosure|Agent Disclosure]] for the loading contract.

For example, the GM can know that a document is hidden in a room while a character knows only a rumour about it. Retrieving the GM's room note must not make the document known to the NPC. After an adjudicated discovery, the GM supplies the new fact only to recipients who learned it. Keep those playthrough updates separate from the baseline authored files.

## Navigation and delivery
Every content folder has an `index.md`: maintain its overview, direct note links, child-folder indexes and parent link. Use full vault-relative paths for nested index links and repeated filenames, and relative Markdown links to the root index. Keep `scenario.md` and `character.md` as the distinct agent entrypoints. See [[Authoring/Authoring Guide|Authoring Guide]].

After editing, verify that links resolve unambiguously, every note is reachable from the root index, character entries point to the correct cast notes, and unchanged playable stubs remain empty. Check the scope of character-facing links as well as whether they resolve. Update indexes and related notes when a change affects them; do not overwrite unrelated concurrent author edits.

Follow the repository's commit, check, push and stacked-PR workflow from the stable checkout. Summarize what changed and where the author should continue. Do not wire the vault into the game, generate runtime content or change save formats unless that integration is requested. The current game still reads `content/`; the vault's agent-loading design is a future contract.

Parent: [[Authoring/index|Authoring]].
