---
name: kingmaker-quest-authoring
description: Structure Kingmaker quest stages, conversation branches and their world effects. Use when authoring or wiring quest sequences and conversation-driven outcomes.
---

# Quest and conversation authoring

Read `lore/Authoring/Working on Lore.md` and `lore/Authoring/Agent Disclosure.md` before lore edits. Follow the stable lore checkout exception in AGENTS.md. Inspect `docs/quest-service.md`, `docs/conversation-trees.md` and comparable handlers before wiring behavior.

## Divide responsibility

- Conversation branches manage checks, agreements and what characters think or know. A branch may require persuasion or deception, then run scoped GM reviews with explicit recipients, evidence and reaction instructions. Its successful outcome may invoke a quest transition.
- Quest transitions apply material changes and sequence set pieces: remove an obstruction, assign helpers to transport goods, or introduce the next scene. Multiple conversation remedies can converge on the same transition.
- Use quest stages for meaningful world states. Do not add stages solely for negotiating, attempting a check or expressing an attitude. Keep failed attempts and alternative approaches available.
- Separate agreeing, attempting, succeeding and completing an activity. Assigning a delivery activity does not mean the goods arrived.

## Effects and disclosure

Keep mechanics and review execution in host/GM services. Character responses remain tool-free with reasoning effort `none`; preserve scoped memory indexes for Jev disclosure.

Validate against live state, stage only affected entities and publish material effects with progress consistently. Repeated completion must not duplicate items, activities or reactions. A fixture action that resolves a quest must share the successful outcome path with conversation helpers.

Scope reaction reviews to what each recipient witnessed or learned. Legal permission and social approval are separate: Holt can authorise cart destruction while Nine Furrows dislikes the player for it. A quest stage is not an automatic broadcast of private facts.

## Current authoring boundary

Quest Markdown loads numbered `NNN_stage_*.md` files and linked transition notes. Conversation trees live in `content/conversation-trees/` and use registered host scripts. The quest service currently records progress only. Branch-declared check/review instructions and quest world-effect handlers are planned extensions, not executable Markdown syntax; label such contracts clearly until implemented.

For the cart, use `delivery_delayed` → `cart_cleared`. Successful repair, backing out and smashing share clearance and helper assignment. Conversation reviews distinguish pleased Nine Furrows, neutral Nine Furrows with a resentful Rowan, and very unhappy Nine Furrows respectively; Holt appreciates resolution. Delivery completion and the later programme remain separate facts.

Keep static characterization in Cast, temporary knowledge in scoped scenario notes, and effect contracts in GM-only quest notes. Preserve unwritten stubs, summaries and navigation. Update affected loader expectations and lore access checks; changed baseline graphs require a fresh game.
