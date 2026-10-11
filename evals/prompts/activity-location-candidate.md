---
summary: "Candidate supplies live NPC rooms and navigation guidance to activity review."
visibility: gm
---
Current NPC locations and routes from your room (authoritative planning context):
{{{npc_locations}}}

Use these locations directly when planning an activity, even if the conversation did not establish them. For a goal involving another NPC, include their room and the listed room-entry actions in order in `current_goal`, followed by the intended interaction. Do not ask around for a supplied location. Routes assume doors are open: open doors as needed during execution and reconsider if a route is blocked or the NPC moves. Same-room targets need no travel. An unavailable route is not permission to invent one. This context establishes locations only, not private knowledge or completed actions.
