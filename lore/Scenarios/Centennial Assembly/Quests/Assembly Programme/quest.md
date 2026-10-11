---
id: assembly_programme
title: Assembly Programme
initial: investigate_missing_pillows
visibility: gm
summary: "Quest graph for the missing pillows and blocked cart, with explicit host transitions. Successful remedies clear the entrance; delivery remains separate."
---
# Assembly Programme

The [[Scenarios/Centennial Assembly/Quests/Assembly Programme/index|author sketch]] describes the opening and alternative outcomes. The [[Scenarios/Centennial Assembly/Quests/Assembly Programme/clear_cart|clearance contract]] specifies required host effects; its clearance and shared-memory effects are implemented. The [[Scenarios/Centennial Assembly/Quests/Assembly Programme/cart_unblocked|next-stage note]] reserves later delivery and programme details.

Record Holt's disclosed lead and direct the investigation to the cart. This does not move the cart or reveal private conversations to other characters. The registered `pillow-lead.ts` conversation helper records `learn_cart_blocked` after Holt has spoken the explanation.

## Node: investigate_missing_pillows | Investigate the missing pillows
### Guidance
Aldren wants his pillows. Ask Holt where the delivery is. Holt is furious about the delayed festivities and resents another enquiry about upholstery. Calming him enough to explain reveals that the pillows are probably held up by Rowan's cart too.

Only Holt actually disclosing that lead advances this stage; greeting him or asking the question is insufficient. His conversation edge invokes the transition explicitly.
### When: learn_cart_blocked -> cart_blocked
Holt has told the player that the pillow delivery is probably blocked by Rowan’s cart.
#### Trigger: none

### When: clear_cart_early -> cart_unblocked
The player resolves the obstruction before hearing Holt’s explanation. The host validates repair with the book, Rowan backing out, or a successful smash.
#### Trigger: fixture_absent furn_cart_left
#### Run: clear-cart.ts

## Node: cart_blocked | Cart blocked
### Guidance
Holt has explained that the pillows are probably delayed by Rowan's cart. Resolve the obstruction by helping Rowan seek Corvin's advice, persuading Rowan to back the cart out the way it came, or smashing it. Holt gives permission to smash only reluctantly if pressed; permission does not make Nine Furrows approve.

Conversation branches own negotiation and scoped reactions. Failed attempts leave other approaches available. Agreement to act is not clearance; invoke the shared transition only through an established successful remedy and its host effects.
### When: clear_cart -> cart_unblocked
A remedy has succeeded: repair using Corvin’s book, Rowan agreeing to back out, or a successful physical smash. The host clears the obstruction and records a shared memory for every character. Delivery remains a separate task.
#### Trigger: fixture_absent furn_cart_left
#### Run: clear-cart.ts

## Node: cart_unblocked | Cart unblocked
### Guidance
The palace service entrance is clear. Every character receives the fixed clearance memory; a plot review updates their dialogue trees to reflect the completed remedy. Deliveries can resume, but goods have not yet arrived in the hall. Do not restart the cart investigation. Later delivery and assembly programme details remain unwritten.
