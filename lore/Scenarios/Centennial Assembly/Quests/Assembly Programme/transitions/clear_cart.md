---
summary: "Shared clearance effect contract: remove the obstructing cart and assign helpers to carry goods inside after an adjudicated successful remedy."
visibility: gm
id: clear_cart
trigger: none
to: cart_cleared
condition: "A remedy has succeeded, the host has cleared the cart obstruction and assigned helpers to bring the waiting goods inside."
---
# Clear the cart

## Required host effects

After a successful remedy, remove the obstructing cart fixtures and assign helpers executable activities to bring the waiting goods inside. Validate the affected state before publishing these effects and quest progress together; repeated requests must not duplicate activities or goods. Detailed damage handling is deferred.

Conversation helpers supply the successful branch outcome. A promise to try, a failed check or merely discussing a remedy is insufficient. The physical smash action must use this same completion path.

## Current runtime boundary

This is an authored effect contract. The quest service currently records progress only; this note does not execute removal or helper activities. Until a host effect handler exists, callers must establish the effects before recording the transition. Do not report the sequence as playable from this note alone.

Parent: [[Scenarios/Centennial Assembly/Quests/Assembly Programme/transitions/index|Transitions]].
