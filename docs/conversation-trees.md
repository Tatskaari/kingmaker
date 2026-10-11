# Conversation tree PoC

A tree is one GM-only Markdown file. Flat frontmatter supplies `id`, `title`,
`character`, `initial`, `visibility: gm` and a descriptive `summary`.

- `## Node: <id>` declares a stable node ID; optional ` | Title` supplies a display title. IDs may contain hyphens or underscores.
- `### Guidance` supplies the character's current conversation goal.
- `### When: <transition-id> -> <node-id>` supplies an outgoing condition in prose.
- Optional `#### Run: <name>.ts` under a transition selects a host-registered script.

A node may have multiple outgoing transitions. Transition IDs are unique within
the tree. Conditions describe observed events, not instructions to perform them.
Only guidance is character-facing; conditions and scripts remain host-owned.
The shared Markdown graph parser also powers [quest documents](quest-service.md#lore-loading). Conversation guidance remains character-facing; quest guidance and trigger directives remain GM/host-owned.

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
not an atomic transaction. Unexpected evaluation/script/commit failures throw;
the next evaluation may retry, so effects must be safe to repeat.

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

## Try it in the game

Fresh games now include the same Aldren tree from
`content/conversation-trees/aldren.md`. Greet the king, ask about his important
matter, then agree to help with the cushions. Assembly Programme appears in the
existing top-right active quests panel. Refusal leaves the quest inactive.

Only the current goal is injected into the dialogue model's system context.
Jev conditions remain host-owned and appear in Aldren's Agent runs & requests
inspector; the current tree status is also in his debug Raw JSON. Tree progress
is saved with quest state, so loading or reopening a conversation retains its
node and does not repeat the acceptance script. Start a fresh game to get the
new authored tree; existing saves are not upgraded.

## Cart conversation playtest

Fresh games also load Holt, Rowan, Corvin and palace-guard trees. Ask Holt about the pillows, calm him, and hear his explanation; `pillow-lead.ts` activates the quest if needed and advances it to `cart_blocked`. Asking alone does not advance it. Press Holt for permission to smash, or ask Rowan to back out or accept help seeking Corvin’s advice. Corvin can be persuaded to cooperate or disclose the book in his room; guards can hear a distraction proposal. Each guard body has independent saved tree progress.

Use the existing Agent runs & requests inspector to follow branches. These are dialogue playtests: ordinary GM check/review behavior applies, but the trees do not enforce branch-specific rolls or execute cart removal, book placement/transfer, guard movement, helper delivery. NPC agreement is not proof those effects occurred. `cart_unblocked` remains a stub. Start a fresh game; the CLI tree flag remains Aldren-only.

The existing Assembly Programme start hooks (`hello-world.ts`, or direct discovery
through `pillow-lead.ts`) now install illegal smash actions on the cart. Holt's
`blessing-given` edge runs `authorise-cart-smash.ts` to make those same actions legal.
These hooks use the authoritative map callback service. Repeated setup does not
revoke permission, and save/resume preserves it. Raw `quests.setActive` remains a
data API; it does not run application hooks. Generic Markdown stage-entry hooks
are not introduced here. Smashing still does not advance `clear_cart` or deliver goods.


Transition scripts return `TransitionResult` (`status: "accepted"` with an
optional `message`, or `status: "rejected"` with a required `message`) instead
of a string. Rejection retains the current node and quest progress, reports a
`rejected` phase and the structured result in tree status, and includes the
reason alongside the unchanged goal as GM context for the next character reply.
The existing script-output inspector also displays the message. A later matched
attempt reruns the hook against current state. Character models remain tool-free
with reasoning effort `none`. Hooks must reject before applying world effects;
rejection does not roll back previous service calls. Quest hooks use the same
[host result contract](quest-service.md#host-transition-hooks).
