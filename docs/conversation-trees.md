# Conversation tree PoC

A tree is one GM-only Markdown file. Flat frontmatter supplies `id`, `title`,
`character`, `initial`, `visibility: gm` and a descriptive `summary`.

- `## Node: <id>` declares a stable node ID.
- `### Guidance` supplies the character's current conversation goal.
- `### When: <transition-id> -> <node-id>` supplies an outgoing condition in prose.
- Optional `#### Run: <name>.ts` under a transition selects a host-registered script.

A node may have multiple outgoing transitions. Transition IDs are unique within
the tree. Conditions describe observed events, not instructions to perform them.
Only guidance is character-facing; conditions and scripts remain host-owned.
The parser compiles nodes and transitions into the existing quest graph schema;
script names remain separate host metadata. No script executes during parsing.

This layer supplies the parser only; CLI activation follows in a dependent layer.
