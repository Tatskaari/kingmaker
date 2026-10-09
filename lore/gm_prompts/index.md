---
summary: "System prompts, decision criteria, tool guidance and runtime context templates for language and decision models."
visibility: gm
---
# Model prompts

Each linked Markdown file is a prompt template. Edit its body as ordinary Markdown; the filename is its runtime ID. YAML frontmatter describes the note for authors and is removed before sending the prompt to a model. The browser and CLI load these game prompts; evals exercise the same game prompts but keep their scoring templates outside the vault in `evals/prompts/`. There is no JSON catalog to maintain.

Use Mustache placeholders such as `{{{observedMap}}}` for runtime values, `{{#feedback}}...{{/feedback}}` for sections and `{{^feedback}}...{{/feedback}}` for inverted sections. Both double and triple braces preserve plain text without HTML escaping. Inserted evidence is never rendered again. Callers must supply referenced values, including explicit false or empty values for optional sections.

Runtime code filters observations and lore permissions before supplying values. Templates cannot retrieve documents, widen character knowledge or execute actions. These are trusted application instructions, not character knowledge or mutable saved-game documents. Restart the CLI or dev server after editing; rebuild published applications.

Folders group prompts by the system they serve. Filenames remain globally unique runtime IDs; moving a template does not change its ID or text. Tool prompts live with their owning flow. Shared GM review tools are under `conversation/review/tools/`.

## Systems

- [[gm_prompts/character_creation/index|character creation]]
- [[gm_prompts/conversation/index|conversation]]
- [[gm_prompts/gm_guidance/index|gm guidance]]
- [[gm_prompts/lore_retrieval/index|lore retrieval]]
- [[gm_prompts/scenario_specific/index|scenario specific]]
- [[gm_prompts/world/index|world]]

Parent: [Kingmaker Lore](../index.md).
