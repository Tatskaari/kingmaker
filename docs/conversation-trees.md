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

## Host execution

The CLI executor checks all outgoing conditions together through Jev, taking at
most one transition per evaluation. If several match, the first in file order
wins. It uses spoken history as evidence and never treats goal text as speech.
The new node's guidance becomes a GAME_MASTER transcript entry, rendered as a
system message by the existing conversation request builder.

Scripts are trusted TypeScript functions explicitly registered by the host;
a Markdown filename does not permit arbitrary filesystem imports. The demo
`hello-world.ts` returns an inspector message. Future world effects should use
host services. Script execution precedes recording the transition; these are
not an atomic transaction. Any evaluation/script/commit failure stops tree
processing for the session, preventing automatic replay of partial effects.
