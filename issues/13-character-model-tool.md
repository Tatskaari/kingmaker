---
title: "Design: the character model has a tool (arrest), contrary to the no-tools rule"
labels: [design, tech-debt, agents]
---

## Observation

- `packages/conversation/src/conversation-actions.ts:5-9` defines `arrestTool`, and :18 calls `respond({ ...request, tools: [arrestTool] })` on the character's own reply call.
- It is wired in `apps/web/src/world-runtime.ts:343-362` (dialogue) and `:674-676` (opening line).
- The rest of the arrest policy lives in host code inside `checkedTalkToCharacter`, not in a strategy: the defence-roll GM ruling (:350-356) and staging and committing the arrest (:369-374).
- No other host (CLI, evals) has this behaviour.

Related: the "character" seam doesn't enforce the model contract.
- `effort: "none"` is just a value in the request built at `packages/conversation/src/conversation.ts:74`.
- NPC-to-NPC speech skips `character.respond` and calls `services.ai.responses` directly (`packages/conversation/src/document-resolution.ts:12-14`).
- `world-runtime.ts:114-115` copies an injected `character.respond` into `ai.responses`, so GM rulings in that runtime also go through the character override.

## Why it doesn't pass the sniff test

AGENTS.md: "characters themselves must not have tools or model reasoning… Tool use, memory writes, world changes and adjudication belong to the DM/GM or host services". Arrest is adjudication with a world effect, decided by the character model.

## Threads to pull

- Should arrest become a Jev label after a plain reply ("arrest attempted"), with the GM ruling on it and a host-neutral hook applying it? That would match how attention and conversation-tree checks work.
- Should the dialogue service own the model contract (fixed model, effort `none`, tools stripped) so no strategy can violate it, with NPC exchanges going through it too?
- Is "conversation actions" (`conversation_actions: [arrest]` frontmatter) a general extension point that needs a design, or a one-off?
