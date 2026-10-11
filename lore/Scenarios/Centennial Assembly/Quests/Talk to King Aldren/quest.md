---
id: talk_to_aldren
title: Talk to King Aldren
initial: arrived
active: true
visibility: gm
summary: "The player's introductory quest graph: find King Aldren, complete one successful exchange, then deactivate the objective."
---
# Talk to King Aldren

The player has arrived at court. Their first objective is to speak to King Aldren. This quest completes after one successful player exchange with Aldren. See the [[Scenarios/Centennial Assembly/Quests/Talk to King Aldren/index|author overview]].

## Node: arrived | Introduce yourself
### Guidance
You have arrived at court. Find King Aldren in the Great Hall and introduce yourself.
### When: talked_to_aldren -> completed
The player has completed a successful conversation exchange with King Aldren.
#### Trigger: player_talked_to aldren

## Node: completed | Spoken to King Aldren
### Guidance
You have spoken to King Aldren.
### Completed
