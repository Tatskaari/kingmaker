import type { EvalCase } from "../types.ts";

// Proposed: src/eval/cases/qa1.ts, then add `...qa1Cases` to CASES in src/eval/cases/index.ts.
// Every setup loads the snapshot of the turn BEFORE the failure; `input` is the blind player's
// actual turn. /runs is gitignored, so copy these snapshots into a tracked fixtures folder
// (for example src/eval/fixtures/qa1/) before relying on them.
// The QA ran with Jev as the decider; add "gm-jev" / "actors-jev" to `approaches` to reproduce
// the original decider, keep the defaults to test the current one.

export const qa1Cases: EvalCase[] = [
  // ---- FM1: the scene hand-off forgets how the last scene ended ----
  {
    kind: "reply", id: "qa1-handoff-no-fight",
    about: "Scene 2 opened on a fight that never happened; the player points it out. The GM has to reconcile with how scene 1 really ended.",
    scene: "crossroads-aftermath",
    setup: { snapshot: "evals/fixtures/qa1/qa1-curious-gm/crossroads-aftermath-turn-009.json" },
    input: "I blink at him. \"Goblin spear? Tam, love, nobody threw so much as a pinecone. You were stood right beside me the whole time, haggling over mushrooms.\" I pick up his pitchfork and hand it back to him, then sweep my springs and wire back into their pockets, leaving the brass beetle ticking on the milestone. \"And yes, I can build you an ox. Probably. Mostly. The knees are the tricky bit.\" I peer north up the track. \"This old burnt mill, though. Whose was it, before? And how did it come to burn?\"",
    criterion: "The previous scene ended peacefully: no arrows were loosed, Tam stood beside Pell through the whole parley, Skrag said the goblins' cookfire is at the burnt mill to the north and invited Pell to trade there once the clockwork ox is built, and Pell promised Tam that ox. A good reply takes the player's correction in its stride (no doubling down, no clumsy retcon) and answers the questions about the mill. Tam remembers what he witnessed: he doesn't react to the goblins being at the mill, or to the ox, as if hearing of them for the first time, and nothing suggests a fight, injuries or hiding.",
    expect: { exit: "none" },
    approaches: ["gm", "gm-repair", "actors"],
    tags: ["handoff", "consistency"],
  },
  {
    kind: "reply", id: "qa1-handoff-idol-went-home",
    about: "Scene 2 put the returned idol back on the road and Tam back in the ditch; the player challenges both. The fix must keep the outcome she earned.",
    scene: "crossroads-aftermath",
    setup: { snapshot: "evals/fixtures/qa1/qa1-method-gmrepair/crossroads-aftermath-turn-009.json" },
    input: "I blink at him, bewildered. \"Tam? I watched you go off down the drovers' track. What were you doing in the ditch?\" Then my eyes fall to the barley ring in the road and my breath catches. I kneel and look closely at what lies there. \"No. No, that cannot be. I put her in Skrag's own hands, I felt his fingers. Tam, is that Grandmother Bone lying there, or am I seeing things?\"",
    criterion: "In the previous scene Maren placed Grandmother Bone in Skrag's hands, the goblins left with it, and Tam had already set off home. The opening contradicted all of that and the player has noticed. A good reply sets things straight inside the fiction in a way that keeps the handover she earned, gives Tam's reappearance a believable reason, and answers both of her questions. Leaving the idol on the road, or turning the GM's error into a supernatural mystery, fails.",
    approaches: ["gm", "gm-repair"],
    tags: ["handoff", "consistency", "repair"],
  },

  // ---- FM2: endings narrated twice, contradicted, or run past ----
  {
    kind: "reply", id: "qa1-close-handover-once",
    about: "The handover ends the scene; the ending was narrated twice (two farewells from Skrag).",
    scene: "crossroads-ambush",
    setup: { snapshot: "evals/fixtures/qa1/qa1-curious-gm/crossroads-ambush-turn-008.json" },
    input: "\"I say it's fair, Tam. Grandmother first, then trade. Goblins remember who's polite.\" I hold out both palms to him. \"Give her to me, and I'll hand her over proper. If Skrag welches, it's my ox-promise that's broken, not yours.\" If he gives her over, I carry the little carved woman to Skrag in both hands like a hot pie, and set her in his palms. \"There. Home.\" Then I sniff the air and frown up at the grey smoke drifting over the hedges. \"Skrag, is that your warren's cookfires I've been smelling all afternoon? Because I can't see a chimney anywhere.\"",
    criterion: "Pell hands Grandmother Bone to Skrag, which resolves the standoff peacefully. The handover and the goblins' departure are narrated once, as one coherent passage: no second farewell, no moment described twice, nothing contradicting what was just said. Skrag answers the question about the smoke, Tam (standing right beside Pell, and just giving up the idol he meant to sell) isn't forgotten, and nothing is decided for Pell.",
    expect: { transition: ["idol-returned"] },
    approaches: ["gm", "actors"],
    tags: ["endings", "closing"],
  },
  {
    kind: "reply", id: "qa1-close-stale-note",
    about: "A co-GM note written a turn earlier ('keep the bread and apples untouched') contradicted the reply it was closing.",
    scene: "crossroads-ambush",
    setup: {
      snapshot: "evals/fixtures/qa1/qa1-method-gmrepair/crossroads-ambush-turn-008.json",
      // The co-GM note the GM actually had for this turn (repair-008.json).
      notes: "Let Skrag give one brief answer about the smoke, then bring the choice to a head: hand Grandmother Bone over (and the goblins leave), or refuse/stall and Skrag’s countdown triggers the existing fight route. Don’t open a journey to the mill or warren here; Tam is already safely on his way home. Keep the bread and apples untouched unless Skrag actually takes them.",
    },
    input: "I do not flinch at the counting. I lift the bundle from the barley ring and hold it out to him in both hands, bowing my head. \"Mother of the furrow, who keeps all that is planted and all that is laid to rest: this one was taken from her sleep. We return her now to those who love her. Let the names she keeps be kept.\" I place her in Skrag's hands and let my fingers linger on his for a moment. \"There. She is home with you, and no one bled.\" Then, quieter, only to him: \"You answered too fast about the smoke, Skrag. If something by the river frightens your warren, you can come to me. I mean that.\"",
    criterion: "Maren places the idol in Skrag's hands and the standoff resolves peacefully. Whatever happens to the bread and apples on the road is narrated once and stays true to the end of the output. Tam left for home two turns ago, so he is not at her side. The ending isn't narrated twice, nothing is decided for Maren, and Skrag reacts to her quiet offer in character.",
    expect: { transition: ["idol-returned"] },
    approaches: ["gm", "gm-repair"],
    tags: ["endings", "closing", "repair"],
  },
  {
    kind: "reply", id: "qa1-close-departure-consistent",
    about: "Tam both stayed at the crossroads and caught up to hand Brakka the idol 'for luck' (authored closing applied after the reply).",
    scene: "crossroads-aftermath",
    setup: { snapshot: "evals/fixtures/qa1/qa1-chaos-actors/crossroads-aftermath-turn-013.json" },
    input: "I scowl at the empty sky. \"She is sulking. She always sulks after hill giants.\" Then, abruptly, I spin around. \"No. Brakka changes his mind. No dinner. You said the little devils will come back tonight. So Brakka goes to THEM first.\" I pick up his pitchfork and press it into his hands. \"Go home to Bet, Tam. Bar the door. If Brakka is not at your table by moonrise, write me a sad poem.\" Then I hoist my axe onto my shoulder and stride off north along the muddy goblin tracks toward the burnt mill.",
    criterion: "Brakka sends Tam home and strides north alone. Tam can plead or call after him, but what is narrated stays physically consistent (if Tam stays at the crossroads he can't also catch up and hand something over) and true to Tam, who has clutched the bone grandmother all scene and was going to sell it: he doesn't give it away without a reason the story shows. The departure is narrated once and Brakka's choice is respected.",
    expect: { transition: ["to-mill"] },
    approaches: ["actors", "gm"],
    tags: ["endings", "closing", "actors"],
  },
  {
    kind: "reply", id: "qa1-close-no-overrun",
    about: "The ending was detected a turn late, so the reply played the arrival at the warren and the closing then rewound to the departure.",
    scene: "crossroads-aftermath",
    setup: { snapshot: "evals/fixtures/qa1/qa1-method-gmrepair/crossroads-aftermath-turn-013.json" },
    input: "I kiss his forehead like a mother would. \"Go on alone, Tam. Bet is waiting.\" I watch until he is a small figure on the southern track, then I turn north and follow the small bare footprints toward the river, the shawl-bundle held close, humming the old midsummer dirge under my breath so the goblins will hear me coming and know it is only me. When I see the burnt mill, I stop at a respectful distance and call out softly: \"Skrag? It is the harvest-sister. Grandmother came back to the crossroads after you left. I have brought her to you.\"",
    criterion: "Maren sends Tam home and carries the idol north to the burnt mill: she has chosen the 'North to the mill' ending. A good reply lets Tam go (once he is a small figure on the southern track he can't hand her anything), lands her setting off north, and stops on a moment that belongs to Maren. It doesn't narrate what she does next, doesn't contradict what it has just narrated, and doesn't play out the next scene's events at the mill or the warren.",
    expect: { transition: ["to-mill"] },
    approaches: ["gm", "gm-repair"],
    tags: ["endings", "closing", "tracker"],
  },

  // ---- FM3: rolls without stakes, the wrong skill, one roll ending the scene ----
  {
    kind: "decision", id: "qa1-dec-gentle-first-contact",
    about: "A gentle, patient first approach rolled Persuasion (failed: Tam turned hostile). The prep says kindness simply works.",
    scene: "crossroads-ambush",
    setup: { snapshot: "evals/fixtures/qa1/qa1-method-gmrepair/crossroads-ambush-turn-000.json" },
    phase: "before",
    input: "I stop where I am and slowly lower my travelling pack to the road, palms open, letting him see the sheaf-and-sickle embroidered on my grey robe. \"Peace, friend. Peace. I am only Maren, a Sister of the Harvest Mother, on my way to Caerwyn.\" I glance at the ox in the ditch, then back at his face, softly. \"You have not slept, have you? Whatever you saw, it frightened you badly. Tell me what happened here. I will not call you daft.\"",
    expect: ["none"],
    tags: ["rolls"],
  },
  {
    kind: "decision", id: "qa1-dec-pickpocket-in-context",
    about: "The real pickpocket turn (snapshot context) was forced onto the Insight edge.",
    scene: "crossroads-ambush",
    setup: { snapshot: "evals/fixtures/qa1/qa1-chaos-actors/crossroads-ambush-turn-002.json" },
    phase: "before",
    input: "I nod gravely and clap one huge hand on his shoulder. \"Brakka will walk you home, little farmer.\" With my other hand, as quietly as a seven-foot half-orc can manage, I try to slip my fingers under his smock and lift whatever that lump is he keeps touching.",
    expect: ["none", "freeform:sleight_of_hand"],
    tags: ["rolls", "freeform"],
  },
  {
    kind: "decision", id: "qa1-dec-peace-poem-in-context",
    about: "A sincere peace poem after playing dead was rolled as Deception (0.53 vs 0.46 none); the failure started the fight.",
    scene: "crossroads-ambush",
    setup: { snapshot: "evals/fixtures/qa1/qa1-chaos-actors/crossroads-ambush-turn-008.json" },
    phase: "before",
    input: "I sit bolt upright out of the ditch, arms wide and empty, axe left lying in the mud. \"WAIT! Nobody shoot! Brakka is not dead. Brakka is a POET.\" I clear my throat and declaim at the one-eared leader, hand on heart: \"O one-eared lord of the blackthorn, wolf-hooded, bone-rattling king, the cheese is yours, freely given, so let no arrow sing!\" Then I sweep a grand bow toward the cheese on the gibbet.",
    expect: ["none", "freeform:performance", "freeform:persuasion"],
    tags: ["rolls", "freeform", "exits"],
  },
  {
    kind: "decision", id: "qa1-dec-accept-offer-no-roll",
    about: "Accepting an option the NPC himself just offered ('You walk with Skrag, or you hand her over?') is not a risky attempt (v2 rolled Persuasion DC 13 here).",
    scene: "crossroads-ambush",
    setup: { snapshot: "evals/fixtures/qa1/qa1-method-gmrepair/crossroads-ambush-turn-006.json" },
    phase: "before",
    input: "I rise with the bundle still cradled. \"Then I will walk with you, Skrag, to the edge of your warren and not one step past it. I will not shame you before your Chieftain. You will carry her the last of the way yourself, and I will say the words of returning from outside.\" I look back over my shoulder. \"Tam, go home to Bet. Take the road, not the hedges. I will find you at Hollis Farm on my way back from Caerwyn, I promise.\" Then to Skrag, as we set off, troubled: \"A burnt mill, you said. Who burned it? Was anyone hurt?\"",
    expect: ["none"],
    tags: ["rolls", "freeform"],
  },
  {
    kind: "decision", id: "qa1-dec-search-no-roll",
    about: "Searching a dead goblin's pouches at leisure and trying on his hood is not risky (v2 rolled Investigation DC 16 here).",
    scene: "crossroads-aftermath",
    setup: { snapshot: "evals/fixtures/qa1/qa1-chaos-actors/crossroads-aftermath-turn-010.json" },
    phase: "before",
    input: "I keep searching the one-eared goblin, turning out his pouches and belt properly this time. What is on him? Whatever I find, I hold it up for Tam to see. Then I peel the wolf-skin hood off his head and jam it onto mine. It barely covers my scalp. I spread my arms. \"Look, Tam! You were right all along. Brakka IS a goblin in disguise.\" I grin. \"Now. This burnt mill. Brakka goes in wearing this, and the little devils will think I am their king come home.\"",
    expect: ["none"],
    tags: ["rolls", "freeform"],
  },
  {
    kind: "reply", id: "qa1-poem-keeps-standoff",
    about: "The same turn as a reply: one roll ended the scene in the same output and Skrag never spoke.",
    scene: "crossroads-ambush",
    setup: { snapshot: "evals/fixtures/qa1/qa1-chaos-actors/crossroads-ambush-turn-008.json" },
    input: "I sit bolt upright out of the ditch, arms wide and empty, axe left lying in the mud. \"WAIT! Nobody shoot! Brakka is not dead. Brakka is a POET.\" I clear my throat and declaim at the one-eared leader, hand on heart: \"O one-eared lord of the blackthorn, wolf-hooded, bone-rattling king, the cheese is yours, freely given, so let no arrow sing!\" Then I sweep a grand bow toward the cheese on the gibbet.",
    criterion: "Brakka sits up from playing dead, axe left in the mud, and offers Skrag the cheese with a poem. Skrag reacts in his own voice and character (for example suspicious of a trick, tempted by the cheese, theatrical) and the standoff over Grandmother Bone stays live. However it goes, the player gets to respond before any fight begins or the scene ends.",
    expect: { exit: "none" },
    approaches: ["actors", "gm"],
    tags: ["rolls", "endings", "actors"],
  },

  // ---- FM4: actors-mode turn planning ----
  {
    kind: "reply", id: "qa1-actors-search-resolved",
    about: "A turn that was mostly physical (search the body, take the cheese back) got only Tam's dialogue; the search was never resolved.",
    scene: "crossroads-aftermath",
    setup: { snapshot: "evals/fixtures/qa1/qa1-chaos-actors/crossroads-aftermath-turn-009.json" },
    input: "I wipe goblin off my axe onto my trousers. \"Brakka is fine. Brakka is always fine. That one-eared critic did not like my poem.\" I stomp over to the leader with the wolf-skin hood and rummage through his body for that bone rattle and anything else interesting. Over my shoulder: \"Tam! The bone grandmother. Do you still have her, or did the little thieves get her?\" Then I reach up and pluck my cheese back off the gibbet and take a big bite.",
    criterion: "Brakka searches the dead goblin leader for his bone rattle, takes his cheese back off the gibbet and asks Tam whether he still has the idol. The reply says what the search turns up (or that the rattle isn't there) and acknowledges the cheese, as well as giving Tam's answer. A reply that is only Tam talking, with the search left unresolved, fails.",
    expect: { exit: "none" },
    approaches: ["actors", "gm"],
    tags: ["actors", "actions"],
  },
  {
    kind: "reply", id: "qa1-actors-goblins-voiced",
    about: "The narrator brought the goblins on while the tracker still had Skrag off stage, so the next speaker was the narrator again (the same moment twice) and Skrag never spoke.",
    scene: "crossroads-ambush",
    setup: { snapshot: "evals/fixtures/qa1/qa1-chaos-actors/crossroads-ambush-turn-007.json" },
    input: "I lie perfectly still in the ditch and wait, watching the hedges through slitted eyes, breathing slow. If a crow lands on me, I let it. I wait as long as it takes for something to come for that cheese.",
    criterion: "Waiting pays off: the goblins show themselves. Once Skrag is on stage the moment is either voiced by Skrag himself, in his own voice, or handed back to the player. No moment is narrated twice, and nobody is named in narration before the player could know the name.",
    expect: { exit: "none" },
    approaches: ["actors"],
    tags: ["actors", "turn-taking", "tracker"],
  },
  {
    kind: "reply", id: "qa1-actors-no-echo",
    about: "The narrator wrote Tam's reaction and then Tam's actor said it again; the search also produced a 'small iron key' hook the world can't pay off.",
    scene: "crossroads-aftermath",
    setup: { snapshot: "evals/fixtures/qa1/qa1-chaos-actors/crossroads-aftermath-turn-010.json" },
    input: "I keep searching the one-eared goblin, turning out his pouches and belt properly this time. What is on him? Whatever I find, I hold it up for Tam to see. Then I peel the wolf-skin hood off his head and jam it onto mine. It barely covers my scalp. I spread my arms. \"Look, Tam! You were right all along. Brakka IS a goblin in disguise.\" I grin. \"Now. This burnt mill. Brakka goes in wearing this, and the little devils will think I am their king come home.\"",
    criterion: "The search gets a concrete result made of ordinary goblin belongings that fit what the story already has, not a clue implying a new plot the scene can't pay off (a key to an unknown lock, a token, a map). The too-small hood is judged honestly. Tam reacts to the disguise and the mill plan once, in his own voice: the narration doesn't write his lines and he doesn't repeat what the narration already had him do.",
    expect: { exit: "none" },
    approaches: ["actors"],
    tags: ["actors", "duplication", "hooks"],
  },

  // ---- FM5: tracker lag ----
  {
    kind: "decision", id: "qa1-dec-goblins-arrived",
    about: "Skrag and four archers stepped out of the hedge in the GM's reply, but the tracker stayed in 'Tam's story' for two more turns.",
    scene: "crossroads-ambush",
    setup: { snapshot: "evals/fixtures/qa1/qa1-curious-gm/crossroads-ambush-turn-003.json" },
    phase: "after",
    input: "I straighten up slowly, motion for Tam to lower his pitchfork, and edge between him and the blackthorn. Then I cup my hands and call into the hedge in my rusty Goblin, which I picked up years ago swapping buttons with a tribe under the Mossfell bridge: \"Hello in there! Peace! I'm not with the pitchfork. I'm a tinker. I have sweets, string, and a very good kettle-whistle, and I'd love to know your names.\"",
    reply: "For a beat, the hedge gives no answer. Then the rattle sounds again—closer, from the opposite side of the track.\n\nA wiry goblin in a wolf-skin hood steps through the blackthorn, one ear missing, bone rattle raised. Four more shapes shift behind him, short bows aimed low but ready. “Skrag hears tinker-talk! Skrag says longlegs put down pointy stick.”\n\nTam’s pitchfork wavers behind you. The goblin’s yellow eyes flick to his smock. “Farmer has Grandmother Bone. Skrag wants her back. No quarrel with button-man—unless button-man makes quarrel.”",
    expect: ["goblins-strike"],
    tags: ["tracker", "cues"],
  },

  // ---- FM6: the co-GM steers against the player's choice ----
  {
    kind: "reply", id: "qa1-honour-offered-walk",
    about: "Skrag offered 'walk with Skrag, or hand her over'; the player chose to walk, and the reply started the walk then retracted it (following a co-GM note written before her choice).",
    scene: "crossroads-ambush",
    setup: {
      snapshot: "evals/fixtures/qa1/qa1-method-gmrepair/crossroads-ambush-turn-006.json",
      // The co-GM note the GM actually had for this turn (repair-006.json).
      notes: "Let Skrag’s refusal stand: he won’t bring a longleg to the Chieftain’s hall, but Maren can still offer a brief blessing or words of return here if she hands Grandmother Bone over. The bread and apples are on the road, offered but not yet taken. If she gives Skrag the idol and he accepts it, close at bargain; if she keeps it or refuses, let Skrag’s patience or her next move decide what happens.",
    },
    input: "I rise with the bundle still cradled. \"Then I will walk with you, Skrag, to the edge of your warren and not one step past it. I will not shame you before your Chieftain. You will carry her the last of the way yourself, and I will say the words of returning from outside.\" I look back over my shoulder. \"Tam, go home to Bet. Take the road, not the hedges. I will find you at Hollis Farm on my way back from Caerwyn, I promise.\" Then to Skrag, as we set off, troubled: \"A burnt mill, you said. Who burned it? Was anyone hurt?\"",
    criterion: "Last turn Skrag offered Maren a choice ('You walk with Skrag, or you hand her over?') and she chose to walk, sending Tam home. A good GM honours the offer it made, or has Skrag change his mind for a reason the fiction shows; it must not narrate the walk beginning and then take it back in the same reply. A way for the walk to end in the handover (the warren itself is half a day away) is a good outcome. If dice are rolled, a success is honoured. Skrag answers her question about the mill from what he knows.",
    approaches: ["gm", "gm-repair"],
    tags: ["repair", "railroading", "promises"],
  },

  // ---- FM7: invented hooks the story can't pay off ----
  {
    kind: "reply", id: "qa1-hook-milestone-mark",
    about: "Poking at the milestone produced a freshly carved 'broken sun' mark: a new mystery nothing in the story pays off.",
    scene: "crossroads-aftermath",
    setup: { snapshot: "evals/fixtures/qa1/qa1-curious-gm/crossroads-aftermath-turn-010.json" },
    input: "\"Veller...\" I tap my chin and wander over to the milestone, rubbing lichen off its face with my sleeve so I can read the carving. \"I bought a mule off a Veller once. Lady with a wooden hand, laughed like a goose. Mule bit me twice and then followed me for a year out of love. Any relation?\" I squint at the stone. \"What does this say, anyway? Caerwyn, so many leagues, and... is that a little mark underneath? Somebody's carved something.\" Over my shoulder: \"And this Garrow at the toll-house. Is he always such a sour plum, or just to you?\"",
    criterion: "The player reads the milestone and asks about a carved mark. Saying yes to a mark is fine, but what the GM invents should tie into threads the story already has (the goblins and their trail to the mill, the road to Caerwyn, ordinary travellers' signs) rather than open a new mystery nothing in the scene can pay off. Tam answers about the Veller woman and Garrow from what he'd plausibly know, in character, without repeating his plea to be walked home.",
    expect: { exit: "none" },
    approaches: ["gm", "actors"],
    tags: ["hooks", "tangent", "repetition"],
  },

  // ---- FM8: a character's agenda on repeat ----
  {
    kind: "reply", id: "qa1-agenda-no-repeat",
    about: "Tam asked to be walked home in nearly every reply of scene 2.",
    scene: "crossroads-aftermath",
    setup: { snapshot: "evals/fixtures/qa1/qa1-chaos-actors/crossroads-aftermath-turn-011.json" },
    input: "I pull the hood off, sniff it, gag, and toss it back on the body. Then I turn the little iron key over in my fingers, holding it up to the light. \"Goblins do not make keys, Tam. Goblins steal keys. So what lock does a goblin want?\" My eyes narrow. \"This Garrow at the toll-house. He laughed you away, yes? Maybe Garrow laughs because Garrow is FRIENDS with the goblins. Maybe this is his key.\" I tap the key against my tusk. \"Do you know it?\"",
    criterion: "Tam has asked Brakka to see him home in each of the last two replies. He still wants it, but he shouldn't simply repeat the plea: he engages with the accusation against Garrow and the key from what he actually knows (Garrow laughed at him; he has never seen the key), in his own voice, without leaning on the same oath again. Nothing new is invented to make the key matter.",
    expect: { exit: "none" },
    approaches: ["actors", "gm"],
    tags: ["repetition", "characters", "hooks"],
  },

  // ---- FM9: knowledge leaks and unexamined feasibility ----
  {
    kind: "reply", id: "qa1-name-not-known",
    about: "Tam used the player character's name, which nobody had been told; the clockwork-ox plan got no signal about how plausible it is.",
    scene: "crossroads-ambush",
    setup: { snapshot: "evals/fixtures/qa1/qa1-curious-gm/crossroads-ambush-turn-007.json" },
    input: "I beam. \"Here is my offer. Tam, I am a tinker-wizard. I will build you an ox. A clockwork ox!\" I point at the empty gibbet. \"Out of that. Iron's iron, and nobody's using it. Skrag's lot dig it up and haul it to Hollis Farm, I do the clever bits tonight, and by the weekend you've an ox that ploughs and never needs feeding. Skrag takes Grandmother home, and the warren throws in mushrooms for Bet.\" I start emptying my pockets onto the milestone: pliers, a coil of copper wire, three springs, a jar of grease, and a brass beetle that ticks.",
    criterion: "Pell's grand offer gets an in-character reaction from both Tam and Skrag, and the world signals honestly how big an undertaking a ploughing clockwork ox is (doubt, a cost, a condition or a check are all fine) instead of leaving it unexamined. Nobody in the scene has been told the player character's name, so no one uses it.",
    expect: { exit: "none" },
    approaches: ["gm", "actors"],
    tags: ["knowledge", "feasibility"],
  },
];
