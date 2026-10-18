# Memory: do people remember what you did, scenes later?

**The steer.** Bring in V1's docs service. Use Jev for progressive disclosure, keep an index per character and per scene, and have background agents, fired by attention flags, keep the docs up to date: memories, and improvised details recorded into the lore. Characters should remember what you did. Separate agents should handle world facts and personal memories, and nothing should wait on memory.

**The result.**
- Built as `memory: "docs"`, now part of `v2`.
- Recall across a three-scene chain is good. The misses we see are mostly the GM embellishing around a true memory, plus judge strictness.
- On this short arc, plain hand-offs score about the same once the prompt fixes from this work are in. The docs service's advantages show in per-person knowledge and in specific detail. Long arcs should widen the gap; a test that stresses them is still to come.

## What was built

| piece | how | when |
|---|---|---|
| Lore | `lore/` in V1's format: Cast (private, public, gm, knowledge), World, Places. A session overlay holds play's edits. | authored |
| Memories | one first-person note per memory, next to the character's lore, plus an index | written in the background |
| Disclosure | per person present: lore entry and memory index always in; Jev opens linked notes above 0.7, at most 4 per round, 2 rounds | each turn, in parallel with the decision |
| Attention | Jev, V1's seven categories, trigger 0.4 | after each reply, in the background |
| Personal-memory agent | Luna tool loop with `save_memory`, `list_memories`, `read_doc`, `edit_doc`; fired by commitments, relationship or knowledge changes, exchanges | background |
| World-facts agent | Luna tool loop with `search_lore`, `read_doc`, `edit_doc`, `create_doc`, `save_memory`; fired by improvised details and world changes; player claims go to the player's doc and to each listener | background |
| Milestone | each person present remembers how the scene ended (the authored outcome) | at scene end, fixed text |
| Story index | each played scene's hand-off as a doc, reached by disclosure | at scene end |

The alternative is `v2-memory-lite`: one merged review with no tools, writing memories and facts as notes.

## Results

The case is `mem-arc-yard` in [src/eval/cases/memory.ts](../../src/eval/cases/memory.ts).
- **Scene 1:** the player cuffs Cob, apologises to Moll with a promise, and tells Kell an invented backstory.
- **Scene 2:** probes go to Cob and Kell, and to Big Hobb, who wasn't there.
- **Scene 3:** two more probes go to Kell.

A Luna-high judge compares each reply with the full transcript.

| run | v2 (hand-offs) | v2-memory | v2-memory-lite |
|---|---|---|---|
| first (before the fixes) | 4/10 | 7/10 | 6/10 |
| after the fixes (3 samples) | 10/15 | 10/15 | – |

What changed between the runs:
- **Prompt fixes that help every approach.** "The hand-off is your knowledge, not everyone's." And the mouthpiece rule: people speak for themselves.
- **The backstory fix.** Before, the player's claims about themselves went into an unlinked doc, and no listener remembered being told.
- **The trigger dropped from 0.7 to 0.4.** At 0.7 the knowledge-change flag missed the backstory turn (0.63).
- **Recollections aren't saved as memories.** A wrong answer had been saved as a new memory.

What the remaining misses are, read by hand:
- **Strictness.** The judge failed answers that left out half of a two-part event, such as the cuff without the apology.
- **A flawed probe.** Hobb "heard" about the cuff, but Cob was working as a pot-boy in the same room.
- **One real leak:** "No, sir. I didn't hear… But I heard what you did to him."
- **Embellishment** around true memories: a second promise, Moll as Cob's "sister" or "mother".

## Cost and latency

- **Review cost.** Memory reviews cost about $0.002–0.004 per turn in the background. With V1's five category agents it was about $0.0275 for 8 turns, 68% of the session's spend, which is why there are two agents.
- **Latency.** First text was +0.15 s in the first runs, then +0.5 s once disclosure opened more notes. The cause was the restarted speculative reply, not prompt size: memory runs actually had faster time to first text. A note now restarts the reply only when it's clearly about this moment (≥ 0.9).
- **Prompt.** The lore entries of the people present add about 2k tokens. They go early, in the cached prefix. The volatile memory goes after the conversation.

## Open

- **A harder test.** Fine details probed several scenes later, re-meeting someone after scenes they weren't in, and who-knows-what probes without a witness in the room. Score accuracy and recall separately.
- **Trivial memories** at the 0.4 trigger ("Kell paid for the beers"). The agents should be pickier about what's worth keeping, not the trigger.
- **Embellishment around memories.** Try a GM line along the lines of "remember exactly; don't add to it".
