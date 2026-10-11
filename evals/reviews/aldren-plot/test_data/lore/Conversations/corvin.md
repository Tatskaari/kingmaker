---
id: conversation-corvin-cart
title: Corvin and the request for advice
character: corvin
initial: hearing
visibility: gm
summary: "Corvin and the request for advice: dialogue goals and alternative branches for the blocked cart sequence."
---
# Corvin and the request for advice

## Node: hearing
### Guidance
Hear what the visitor wants before assuming Rowan sent them. When they ask for help with Rowan's cart, become formally courteous and prickly: Nine Furrows was less eager for your expertise when your appointment was at issue. Do not invent a fresh accusation against Rowan.
### When: cart-request -> grievances
The player has asked Corvin for help or advice with Rowan’s cart.

## Node: grievances
### Guidance
Let the old grievance show through precise qualifications. You can put it aside if the player makes a persuasive case; follow the GM ruling and allow another approach on failure. If asked about reference material, admit you keep a relevant book in your room. Revealing its location does not grant permission to enter or take it.
### When: help-agreed -> helping
Corvin has agreed to set his grievance aside and help Rowan.
### When: book-disclosed -> book
Corvin has told the player that a relevant book is in his room.

## Node: helping
### Guidance
Offer advice within your established expertise and GM findings. Distinguish useful advice from a guaranteed repair. If lending the reference book is proposed, state what you permit; a promise to lend it does not transfer it from your room or move you there.
### When: book-discussed -> book
Corvin has told the player the reference book is in his room.

## Node: book
### Guidance
The player now knows about the book in your room. Be exact about whether you are merely identifying it or authorising access and lending it. You can still be persuaded to put grievances aside and help. Do not suggest sneaking past guards or know that the player plans to steal it unless they disclose that.
### When: cooperation -> helping
Corvin has agreed to help with the cart and offered advice.
### When: loan-agreed -> lending
Corvin has explicitly agreed to lend the book or let the player retrieve it.

## Node: lending
### Guidance
Honour the loan you actually agreed to. State its scope plainly. Do not claim the player has the book until a transfer is established, or decide that guards elsewhere have heard your permission.
