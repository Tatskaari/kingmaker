---
title: "Design: tidy RuntimeServices — hypothetical seams, missing seams, overlapping extension points"
labels: [design, tech-debt, services]
---

## Observation

Matt Pocock's heuristic is "one adapter is a hypothetical seam; two adapters is a real one". `RuntimeServices` (`packages/conversation/src/services.ts:95-112`) has both kinds of drift.

**Unused or hypothetical:**
- No hook calls `character.rollSave`, `scenario.setPlayer`, `character.create`, `inventory.add/remove/transfer` or `map.layout`.
- `presentation.setPortrait`'s only adapter is a no-op (`apps/web/src/world-runtime.ts:147`); portrait choice is done in the host via raw `ai.decisions` (:206-218).
- No hook uses `random`: `activity-tools.ts:49,53` call `crypto.randomUUID`, and `checkMechanics` defaults to `rollD20`.

**Missing:**
- `quests` and `mechanics` aren't in `RuntimeServices`. The host passes `worldServices.quests` straight into tree sessions (`world-runtime.ts:274-275,382-384`), around the service composition (:123-147).

**Overlapping:**
- `services.agents.prepare` and `strategies.setup.prepare` override the same thing (`packages/conversation/src/runtime.ts:53-57`).
- `disclosure` silently falls back to `ProgressiveDisclosure` (:92-94) and `debug.documentUpdated` is optional, while everything else throws `UnimplementedServiceError`.
- `LoreService` has top-level `initial/links/open` plus `forCharacter`. The game supplies only `forCharacter` (`packages/conversation/src/document-lore.ts:49-59`).

**Mixed:**
- `CharacterService` combines dice, creation and the dialogue model call.
- Model choice is hard-coded inside hooks (`openai/gpt-6-luna` in `document-review.ts:30`, `document-resolution.ts:12`, `conversation.ts:74`). `checks.ts:7` has its own copy, and `apps/web/src/model-settings.ts` is used only by the Stranger interview.

Possible bug: `rollCheck: checkMechanics(world.simulation.runtimeCharacters.player?.dnd, …)` (`world-runtime.ts:141`) ignores `request.characterId`, so any check uses the player's modifiers. That is fine if only the player ever rolls; is that guaranteed?

## Threads to pull

- Which methods should move to a host-only interface, and which should be deleted?
- Should `quests` join `RuntimeServices` with the same persistence wrapping as `docs`?
- Agents service or setup strategy: which one stays?
- Should the character service split into mechanics (dice keyed by character), creation (host) and dialogue (model contract, see #13)?
- Should model selection be a role configuration (`AiRequestInfo.purpose` → model and effort) injected as a service?
