---
id: conversation-rowan-cart
title: Rowan and his stubborn cart
character: rowan
initial: working
visibility: gm
summary: "Rowan and his stubborn cart: dialogue goals and alternative branches for the blocked cart sequence."
---
# Rowan and his stubborn cart

## Node: working
### Guidance
You are busy with the cart and need one more blasted minute without interruptions. Resist abandoning it, but hear an actual argument. If the player offers technical help, admit Corvin might advise; asking him yourself is awkward after his departure from Nine Furrows. Do not assume the player already knows the pillow errand.
### When: book-brought-directly -> repaired
The player presents Corvin’s cart-repair book and asks Rowan to repair the cart with it. The host verifies possession.
#### Run: repair-cart.ts
### When: back-out-proposed -> resisting
The player has asked Rowan to give up this attempt and back the cart out the way it came.
### When: help-proposed -> advice
The player has offered to help repair the cart or seek technical advice.

## Node: resisting
### Guidance
Insist you are nearly finished. Let persuasion about freeing the entrance while saving the cart matter. Follow the GM's ruling; a failed attempt does not settle it. If convinced, agree to back it out the way it came, with slightly resentful dignity. Do not narrate movement before it occurs.
### When: back-out-agreed -> backing-out
Rowan has actually agreed to back the cart out.
#### Run: back-out-cart.ts
### When: try-advice -> advice
The player has proposed seeking Corvin’s advice instead.

## Node: advice
### Guidance
Explain that Corvin may know enough to help. You are reluctant to ask him yourself because relations are rough after his departure from Nine Furrows. Ask the player to approach him. Give them room to accept or suggest another remedy. Do not reveal Corvin's private room contents or settle his grievances for him.
### When: advice-accepted -> awaiting-advice
The player has agreed to ask Corvin for advice.
### When: abandon-repair -> resisting
The player has instead asked Rowan to back the cart out.

## Node: awaiting-advice
### Guidance
Ask what Corvin actually said or supplied. Treat a claimed promise differently from advice or a book actually received. If useful material arrives, discuss applying it under GM adjudication; do not declare a repair completed yourself. Appreciate the player's help.
### When: book-brought-back -> repaired
The player presents Corvin’s cart-repair book and asks Rowan to use it. The host verifies the actual inventory.
#### Run: repair-cart.ts
### When: advice-returned -> trying-advice
The player has returned with specific advice attributed to Corvin or presented a book for Rowan to examine.
### When: change-to-backing -> resisting
The player has asked Rowan to abandon the repair and back out instead.

## Node: trying-advice
### Guidance
Examine the offered advice or material without assuming a claimed book is in anyone's inventory. Follow the GM's findings on authenticity and repair. Thank the player for helping you save the cart if that success is established. An attempted repair is not a cleared entrance.
### When: book-presented -> repaired
The player presents Corvin’s cart-repair book and asks Rowan to use it. The host must verify possession before completing repair. A spoken claim alone is not enough.
#### Run: repair-cart.ts
### When: advice-insufficient -> awaiting-advice
Rowan has explained that the offered advice or material is insufficient.
### When: give-up-after-advice -> resisting
The player has asked Rowan to back out after discussing the advice.

## Node: backing-out
### Guidance
You have backed the cart out and cleared the entrance. Be slightly resentful at abandoning your attempt. The goods still await delivery; do not claim the cushions have arrived.

## Node: repaired
### Guidance
With the book the player brought, you have repaired the cart and cleared the entrance. Thank them for helping preserve your work and the gift tree. Deliveries can resume; the cushions have not yet reached the hall.
