# Kingmaker V2 prototype

Kingmaker is a game that aims to bring the wonder if DnD tabletop roll-playing to 
a cRPG gaming experience. Think BG3 if you could talk to any character in plain 
English. 

Goals are:
1. Responsive and interactive story telling
2. With a hand crafted overarching narrative and lore

V1 fall short on this because it tried to build a transitional cRPG world, then 
personify the characters in that world. The characters narrative didn't match 
what's possible in the world. The latest iteration is up as a PR against this repo.
This made significant progress with a background process that continuously tries 
to repair the narative. 


## Inspiration: https://fables.gg/

Fables and Friends builds a very similar experience. The world is hand authored
then the DM takes you through each encounter. The encounters are mostly text 
driven.

The GM will respond to the characters and roll play each character in the scene. 
The players can cast their spells, do their checks etc. but because most of the 
world updates happen just as text, they have to worry a lot less about how to 
reconcile the narractive with the world.

## V2 prototype: a hybrid apraoch

I'd like to break the world up into scenes. Scenes are adjudicated by the GM. The
party should feel like they're having a conversation, but can narrate actions, that
the characters can react to. 

The map then acts as a hub that connects scenes together. For example:
1. Scene 1: Game opens with you introducing yourself to the stranges and creating your character
2. You're then dropped into the map at the crossroads. You can walk down the road and find a peasant loosing his mind
3. When you talk to the peasant, you end up in a scene. The scene progresses with narrating that the peasant is attacked by a group of goblins. Roll for initiative. 
4. You're then dropped back into the map fighting the goblins. When you're done you're dropped into a scene where the GM narrates the peasant comes out of hiding. 

The goal here is still to put the players in a cRPG style world, but drop all the jev action planning. 

## V1 successes

The following worked really well:
1. Progressive disclosure: Jev would inject useful docs and it really did feel like you were talking to a real NPC that remembered what you said.
2. The background fact recording: taking memories, recording improvised details, etc.
3. The conversation trees. These really were effective at guiding the NPCs down a hand crafted narrative, triggering events etc. 

The following didn't work at all:
1. skill checks triggered by jev. I think it makes a lot more sense to trigger them on edges in the conversation tree.
2. NPC actions: the NPCs would typically go around talking to each-other, hallucinating a bunch of nonsense that the player wasn't involved in and throw the story out of whack. For example, at one point they all got stuck on the idea of finding another route for the cart. There was no way for them to achieve this but they all had that as their conversatoin goals so the player got stonewalled. 
3. Narrative repair: sort of started to work in the last PR but the GM agent doesn't understand what's possible in the world. 

## Hypothesis

A scene has a number of exit modes:
1. Start combat
2. Persuade a character 
3. Progress to next area

These have scripts that update world state, or can advance quests etc. but the GM knows what's possible in the world because of this. Within the scene, we can have colourful narration that eventually ends down one of these routes. 

## PoC goals

Create a number of scene graphs. Look at blog posts and any details for how Friends and Fables works for inspiration. We want to be able to:
1. Guide NPCs down pre-authored conversation beats. 
2. Allow space for the player to improvise their own story here a bit 
3. Have the GM repair these beats if the players go off the rails but get them back on track. 

Finally, we exit the scene and have a script that looks like it would mostly produce the expected result based on what was described in the story. 

## Development workflow


Work off a new claude/kingmaker-v2-poc-scenes branch. Create a QA harness so you can play through the scene in a headless mode. Don't worry too much 
about how the game is going to adopt this. Just try and build a PoC to see what works. Form a hypothesis, then write code to test this hypothesis, 
prioritising learning vs. code correctness. 

I'm going to run you over night to experiment with this. Please try and work autonomously. I would recommend starting off by deleting the current kingmaker 
code (on your branch) so you're not distracted by Ci tests. Use the existing code as a jumping off point. 

You should: 
1. Find some real scenes from DnD campaigns on-line and perhaps some cRPG dialogue trees. Produce a range of scenes, no just dialogue between two characters. Find some that are more or less complex.
2. Author these into some kind of scene representation suitable for the online agent to run. This about how we can guide the GM and the characters in the scene down a path. This about how we represent this interaction. Who talks when etc. The conversation trees are a good start but you may want to try a few approaches here. 
3. Build a QA test harness so you can try the scenes. When doing QA fire off a sub-agent that doesn't have any context from this set-up, so they can test it blind.

Some things to try:
1. Use Jev to decide which character should talk next
2. Have the GM narrate each character
3. Use a background agent similar to the narrative repair that can focus on repairing the current scene conversation tree
4. Have key transitions trigger rolls if the scene demands it e.g. and edge in the convo tree represents you have an option to roll to persuade the character. 

After each QA run:
1. Did the player manage to progress the scene? Did the GM acomodate for their approach? Think about what failure modes you encountered. Consider where the failure started and how you can fix it. 
2. Reproduce the failure mode in an eval 
3. Update the prompts, tooling etc. to see if you can remediate the failure
4. Run all effected evals to see if you regressed elsewhere. 

When updating prompts, try not to over-fit the prompt. The best prompts generlise well because they explain the expected outcomes the agent should aim for, rather than overfitted do/don't. Help the agent get into the headspace of a GM trying to tell a fun, well paced, and collaborative story. Avoid implementation details in the prompts. Use evals to see how you're progressing. 

## Phase 2

If you manage to get the scene to work well, we then want to build something that can update the world map in response to what happened. We need to extract the things that were narated, and build a script, or run some kind of agent that can then update the world in response. I think what we likely want is a little typescript DSL or similar for applying world updates. Some functions to search for assets, and scatter them around (we don't actually need the assets rn, we just want to see what fixtures the agent ads to the world) 

From things like:

Aldren has met a bloody end next to the cart. There's blood everywhere -> 
scatter(asset=assets.get("blood"), count=3, around=scene.character("aldren"))

The guards have given the player a written note allowing them to investigate the castle's dungeon. 
player.addItem(newReadable(id="written_note", name="Permissions slip", content="permissions slip to investigate the castle")


I guess as we build the dataset of outcomes from these interactions, then use this to inform this DSL that can help the agent realise these changes in the world. Try to be realistic. Again use the eval flow. Take the outcome, provide function, run the eval, and assess the result. 

