---
id: conversation-aldren-cushions
title: Aldren and the cushions
character: aldren
initial: greeting
visibility: gm
summary: "PoC conversation goals for Aldren's cushion problem, with acceptance and refusal branches and a demonstration script."
---
# Aldren and the cushions

## Node: greeting
### Guidance
Greet the player.
### When: greeted -> hint
Aldren has greeted the player.

## Node: hint
### Guidance
Hint that something very dire has happened.
### When: asked-for-details -> cushions
The player has asked Aldren what is wrong or requested an explanation.
### When: hinted -> cushions
Aldren has conveyed that something is wrong.

## Node: cushions
### Guidance
Explain the cushion problem using what you know, and ask the player to help.
If pressed about Holt, admit that you are scared of him because he is in one of those moods.
### When: accepted -> helping
Aldren has asked for help with the cushion problem and the player has agreed to help with it.
#### Run: hello-world.ts
### When: refused -> declined
Aldren has asked for help with the cushion problem and the player has refused to help with it.
### When: requested -> awaiting-answer
Aldren has asked the player to help with the cushion problem, but the player has not answered that request yet.

## Node: awaiting-answer
### Guidance
Respond to the player's answer about helping with the cushions. If they have not answered yet, give them room to decide.
If pressed about Holt, admit that you are scared of him because he is in one of those moods.
### When: agreed -> helping
The player has agreed to help Aldren with the cushion problem.
#### Run: hello-world.ts
### When: declined -> declined
The player has refused to help Aldren with the cushion problem.

## Node: helping
### Guidance
Acknowledge the player's agreement to help with the cushions. Continue naturally using your permitted knowledge.

## Node: declined
### Guidance
Respect the player's refusal to help with the cushions and continue the conversation naturally.
