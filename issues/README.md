# Design threads

Draft GitHub issues for review before submission. Each file is one thread to
pull on, where the code doesn't yet match the architecture in
[`ARCHITECTURE.md`](../ARCHITECTURE.md). The YAML frontmatter holds the issue
title and labels; the body is the issue text. They are framed as questions to
settle, not prescribed fixes. File:line citations are evidence and were checked
against `main` at 9b30a91.

## Simulation state (boardgame.io)

- [01 Per-item idempotent CAS for inventory](01-inventory-item-cas.md): `set_item_count(owner, item, expected, new)` in place of whole-inventory replace.
- [02 Replace the "replace anything" move](02-replace-anything-move.md): `publishSimulationChanges` / `mechanics.commit`.
- [04 One write path for the simulation authority](04-one-simulation-write-path.md)
- [10 Physical rules live in apps/web](10-rules-in-web-host.md)
- [11 One authority clock](11-clocks.md)

## The boundary between simulation and AI state

- [03 Who owns activity/wait pointers and intentRevision](03-intent-pointers-ownership.md)
- [07 Is there a sanctioned multi-service transaction?](07-whole-world-staging.md): player publish clones the world; reset assigns docs directly.
- [08 The third kind of state in WorldSnapshot](08-third-kind-of-state.md): jail, conversations, NPC activity bookkeeping.
- [09 What clients actually receive](09-what-clients-receive.md)
- [18 Prose in core moves, positions in documents](18-prose-in-simulation.md)

## Services

- [05 One versioning and conflict contract](05-shared-versioning-contract.md): includes the NPC step revision check that can't fail.
- [06 Narrow typed reads instead of the live world](06-live-world-reads.md)
- [16 Tidy RuntimeServices seams](16-runtime-services-seams.md): includes the check modifiers that always use the player's sheet.

## Hooks, agents and tools

- [12 One GM tool registry](12-gm-tool-conventions.md)
- [13 The character model has a tool (arrest)](13-character-model-tool.md)
- [14 One player-turn flow](14-conversation-hook-shape.md)
- [15 Three review paths](15-review-paths.md)
- [17 Planning/wait policy and default strategies in apps/web](17-policy-in-web-host.md)

## Cleanup

- [19 Stale docs and dead code paths](19-stale-docs-and-dead-paths.md)

## Considered and judged fine

- **Quests use a revision counter while docs use content SHAs.** Quest transitions are an ordered history; a repeated transition must conflict even when the content matches, which only a counter provides.
- **Movement uses movement IDs and supersede/cancel outcomes, not CAS.** Movement is "last request wins"; a conflict error would be wrong for a player clicking a new destination.
- **Setup-time direct mutation** (`apps/web/src/playable-world.ts`, `apps/web/src/background-characters.ts`) happens before the authority exists. It is the equivalent of boardgame.io `setup`.
- **The host rolls dice and passes them into moves** (`interactWithFixture` takes `natural`). This matches "the host generates dice"; the only cost is that a client needs the server's roll before running the move optimistically.
- **Save/restore serialisation and `structuredClone` of small evidence objects** in strategies are allowed save boundaries, not world clones.
- **The `ConversationRuntime` boilerplate that throws `UnimplementedServiceError`** is noisy, but it gives one clear rule.
- **packages/conversation importing pure helpers** from lore/core/prompts (`characterIntent`, `renderPrompt`, `skillModifier`). These are functions over state, not services.

## Submitting

Nothing has been filed yet. Once reviewed, I can create each file as a GitHub
issue with `gh issue create`, using the frontmatter `title` and `labels`. Some
labels (`design`, `simulation`, `state-boundary`, …) may need creating first.
