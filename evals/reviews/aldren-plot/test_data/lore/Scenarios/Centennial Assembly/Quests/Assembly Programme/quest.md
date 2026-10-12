---
id: assembly_programme
title: Assembly Programme
initial: investigate_missing_pillows
visibility: gm
summary: "Quest graph for the missing pillows and blocked cart, with explicit host transitions. The cart-unblocked stage remains unwritten."
---
# Assembly Programme

The [[Scenarios/Centennial Assembly/Quests/Assembly Programme/index|author sketch]] describes the opening and alternative outcomes. The [[Scenarios/Centennial Assembly/Quests/Assembly Programme/clear_cart|clearance contract]] specifies required host effects; it is not an implemented handler. The [[Scenarios/Centennial Assembly/Quests/Assembly Programme/cart_unblocked|next-stage note]] remains unwritten.

Record Holt's disclosed lead and direct the investigation to the cart. This does not move the cart or reveal private conversations to other characters. The registered `pillow-lead.ts` conversation helper records `learn_cart_blocked` after Holt has spoken the explanation.

## Node: investigate_missing_pillows | Investigate the missing pillows
### Guidance
Aldren wants his pillows. Ask Holt where the delivery is. Holt is furious about the delayed festivities and resents another enquiry about upholstery. Calming him enough to explain reveals that the pillows are probably held up by Rowan's cart too.

Only Holt actually disclosing that lead advances this stage; greeting him or asking the question is insufficient. His conversation edge invokes the transition explicitly.
### Quest Log
King Aldren's ceremonial pillows have not arrived. Ask Lord Holt where their delivery has been delayed.
### When: learn_cart_blocked -> cart_blocked
Holt has told the player that the pillow delivery is probably blocked by Rowan’s cart.
#### Trigger: none

## Node: cart_blocked | Cart blocked
### Guidance
Holt has explained that the pillows are probably delayed by Rowan's cart. Resolve the obstruction by helping Rowan seek Corvin's advice, persuading Rowan to back the cart out the way it came, or smashing it. Holt gives permission to smash only reluctantly if pressed; permission does not make Nine Furrows approve.

Conversation branches own negotiation and scoped reactions. Failed attempts leave other approaches available. Agreement to act is not clearance; invoke the shared transition only through an established successful remedy and its host effects.
### Quest Log
Holt believes Rowan's cart at the palace service entrance is holding up the pillow delivery. Find a way to clear the obstruction.
### When: clear_cart -> cart_unblocked
A remedy has succeeded, the host has cleared the cart obstruction and assigned helpers to bring the waiting goods inside.
#### Trigger: none

## Node: cart_unblocked | Cart unblocked
### Guidance
This is a stub.
### Quest Log
The palace service entrance is clear. Deliveries can resume, but King Aldren's pillows have not yet reached the hall.
