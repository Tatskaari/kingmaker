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

The parser is independent of the CLI executor described below.

## Host execution

The CLI executor checks all outgoing conditions together through Jev, taking at
most one transition per evaluation. If several match, the first in file order
wins. It uses spoken history as evidence and never treats goal text as speech.
The new node's guidance becomes a GAME_MASTER transcript entry, rendered as a
system message by the existing conversation request builder.

Scripts are trusted TypeScript functions explicitly registered by the host;
a Markdown filename does not permit arbitrary filesystem imports. The demo
`hello-world.ts` activates `assembly_programme` through `quests.setActive()` and
returns an inspector message. Future world effects should use
host services. Script execution precedes recording the transition; these are
not an atomic transaction. Any evaluation/script/commit failure stops tree
processing for the session, preventing automatic replay of partial effects.

## Run the CLI PoC

With `OPENROUTER_API_KEY` set, run:

```sh
npm run conversation -- --conversation_trees
```

The flag defaults to King Aldren in Centennial Assembly. This PoC requires a
fresh CLI session; snapshots, other characters and other scenarios are rejected.
Without the flag the existing CLI behavior is unchanged.

The right pane shows the active goal, outgoing conditions and pending/hit/miss
results. Select a tree or Jev entry to inspect conditions, probabilities and
transition details. Goal changes are system messages in the transcript. Checks
run before a reply (including the latest player message) and after a completed
reply. Greeting, asking about the problem and agreeing to help should progress
the tree; exact choices depend on Jev. Acceptance displays the hello-world output;
refusal reaches a separate terminal node without running the script.

Ctrl+D exports the usual transcript/world plus `conversationTrees` inspector
history. The demo registers its progress in `world.quests`. Acceptance also activates
Assembly Programme using the API from PR #560; inspect
`world.quests.assembly_programme.active` in the export. Refusal leaves it inactive.
This CLI flag does not change production gameplay.
