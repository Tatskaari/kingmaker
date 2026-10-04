---
summary: "System instructions, decision criteria and tool guidance for the game's language and decision models, with runtime template variables."
visibility: gm
---
# Model prompts

`catalog.json` is the shared prompt catalog for the browser, CLI and evals. Each entry contains a `template` array: one string per line, joined with newlines. Edit this data to change model instructions; engine code selects an entry and supplies runtime values.

Templates use Mustache syntax: `{{name}}` for a value, `{{#name}}...{{/name}}` for a section and `{{^name}}...{{/name}}` for an inverted section. Prompts are plain text, so values are not HTML-escaped. Inserted data is never rendered a second time. Use descriptive variable names. Callers must supply every referenced value, including explicit false or empty values for optional sections.

Runtime code must filter observations and lore permissions before supplying values. A template cannot retrieve documents, widen character knowledge, execute actions or choose a different map view. These files are trusted application configuration, not character knowledge or mutable saved-game documents. Rebuild/restart after editing the catalog.

The catalog includes system messages, decision-model instructions and criteria, tool guidance, and supplemental rulings. Model output, player speech and scenario documents remain runtime data.

Parent: [Kingmaker Lore](../index.md).
