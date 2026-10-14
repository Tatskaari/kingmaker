import type { Scene } from "../src/runtime/scene.ts";

/**
 * The user's example: a peasant losing his mind at the crossroads; talking to him becomes a scene
 * where goblins attack ("roll for initiative"). Twist for improvisation: the goblins want something
 * he picked up, so the fight is avoidable if the party works it out.
 */
export const crossroadsAmbush: Scene = {
  id: "crossroads-ambush",
  title: "The Mad Farmer at the Crossroads",
  summary: "A raving farmer at a crossroads milestone, goblins in the hedgerow, and a stolen idol.",
  setting: "Late afternoon where the King's Road from Caerwyn meets the drovers' track to the Nine Furrows farmlands. A weathered milestone, a gibbet with no one in it, tall blackthorn hedgerows on both sides, a dead ox in the ditch with crude arrows in its flank. Crows. A wind that carries woodsmoke from somewhere it shouldn't.",
  premise: "Will the party see past a madman's ravings in time to save him, and how do they deal with goblins who want something back?",
  hook: "You are travelling the King's Road towards Caerwyn for the Centennial Assembly. At the crossroads ahead, a man is shouting at a milestone.",
  opening: "Describe the crossroads and Tam Hollis, a farmer in a mud-caked smock, shouting at the milestone as if it were a person, jabbing a pitchfork at the hedges. He has clearly not slept. Leave the dead ox visible but unexplained. End with Tam noticing the party.",
  cast: [
    {
      id: "tam",
      name: "Tam Hollis",
      look: "Fifties, sunburnt, mud to the knees, a pitchfork he holds like a spear, eyes red from no sleep.",
      voice: "Rapid, rural, repeats himself, swears by turnips and saints, laughs at the wrong moments when frightened.",
      wants: "To get home to his wife at Hollis Farm alive, and for someone to believe him about the 'little green devils'.",
      fears: "That the goblins will follow him home. That he is actually going mad.",
      knows: [
        "Goblins killed his ox last night on the drovers' track and have been following him through the hedges since dawn.",
        "Nobody at the toll house believed him; they said he'd been at the cider.",
        "He lives at Hollis Farm, an hour down the drovers' track, with his wife Bet.",
      ],
      secrets: [
        "Three days ago his plough turned up a bone idol wrapped in rotten leather: a little carved grandmother figure with garnet eyes. He's been carrying it in his smock to sell in Caerwyn. He doesn't connect it with the goblins and is embarrassed to admit he was going to sell it.",
      ],
      attitude: "Frantic and suspicious at first; clings to anyone who treats him kindly.",
    },
    {
      id: "skrag",
      name: "Skrag",
      group: "Skrag and four goblins with short bows and rusty knives",
      look: "A wiry goblin in a wolf-skin hood decorated with teeth, missing an ear, carrying a curved knife and a bone rattle.",
      voice: "Shrill, theatrical, mangles the common tongue, refers to himself in the third person, calls humans 'longlegs'.",
      wants: "The bone idol, Grandmother Bone, back for his warren's shrine. Without it his chieftain will have his other ear.",
      fears: "Steel, armoured longlegs, and going home empty-handed.",
      knows: [
        "Grandmother Bone was stolen from the warren under the old mill when the farmer's plough broke into a burial tunnel.",
        "The warren is under the burnt mill on the river, half a day north.",
      ],
      secrets: ["He would rather bargain than die. Four goblins is all he has."],
      attitude: "Hostile to the farmer; wary of armed travellers.",
      enters: "ambush",
    },
  ],
  limits: [
    "Help from anyone else (the toll-house men, guards, other travellers): nobody is coming. The toll house is a mile back and its men laughed Tam away; the road is empty.",
    "Loot, money or valuables from the goblins: they own nothing worth having except Grandmother Bone, their bows, knives and Skrag's rattle.",
    "A quick escape (a horse, a cart, a shortcut): there is none. Hollis Farm is an hour's walk away.",
    "Going to the goblins' warren: it's under the burnt mill, half a day north. The party can set off for it, but it isn't reachable within this scene.",
    "Magic in the place itself: nothing at the crossroads is magical except Grandmother Bone, and even that does nothing visible.",
  ],
  anchors: ["crossroads", "milestone", "ditch", "hedgerow", "gibbet", "drovers-track", "kings-road"],
  start: "ranting",
  beats: [
    {
      id: "ranting",
      title: "A madman at the milestone",
      direction: "Tam is comic but genuinely terrified. He won't make sense until someone calms him or takes him seriously; then he talks in a rush. Let the party poke at the scene: the dead ox, the arrows (goblin-made, if anyone looks), the hedges that rustle. The hedges should feel watched.",
      cast: { tam: "Shout at the milestone, then at the party. Accuse them of being goblins in disguise. Calm down if they are kind, patient or obviously capable." },
      pressure: "A crude arrow thunks into the milestone next to Tam's head, or the hedgerow rustles and goes still.",
      transitions: [
        { id: "calmed", when: "Tam has calmed down enough to speak sensibly with the party, because they were kind, patient, reassuring or took him seriously.", to: "story" },
        {
          id: "calm-check", on: "attempt",
          when: "The player is trying to calm Tam down or win his trust in a way where success is uncertain (e.g. he is in full panic and they push rather than reassure).",
          check: { skill: "persuasion", dc: 10, success: "Tam deflates, clutches the player's arm and starts talking sense.", failure: "Tam backs off, jabbing the pitchfork, even more convinced they're 'in on it'.", onSuccess: "story" },
        },
      ],
    },
    {
      id: "story",
      title: "Tam's story",
      direction: "Tam tells his story in a rush: the ox, the goblins following him, nobody at the toll house believing him. He doesn't mention the idol. If the party asks the right questions or reads him (he keeps touching his smock pocket), he may show it. Let the dread build slowly underneath the conversation.",
      cast: { tam: "Tell the story, beg the party to walk him home to Hollis Farm. Deflect awkward questions about why the goblins want him; touch the lump in your smock without thinking." },
      pressure: "The crows lift all at once and the hedgerow goes silent. Skrag's rattle sounds from the blackthorn.",
      transitions: [
        {
          id: "read-tam", on: "attempt",
          when: "The player tries to read whether Tam is hiding something, or presses him about why the goblins are after him.",
          check: { skill: "insight", dc: 12, success: "The player notices Tam keeps touching a lump in his smock; he's hiding something and knows it.", failure: "Tam seems like a frightened man telling the truth.", onSuccess: "idol-revealed" },
        },
        { id: "shows-idol", when: "Tam has shown or described the bone idol he found in his field.", to: "idol-revealed", establishes: ["Tam has a bone idol of a grandmother figure with garnet eyes, dug up in his field."] },
        { id: "goblins-strike", on: "cue", when: "The conversation has gone on for several exchanges, the party has decided to escort Tam, or they start to leave the crossroads: the goblins make their move.", to: "ambush" },
      ],
    },
    {
      id: "idol-revealed",
      title: "Grandmother Bone",
      direction: "The idol comes out: a carved grandmother figure, old, unsettling, with garnet eyes. Anyone with arcana or religion senses it's a shrine object, not loot. Tam is defensive about it ('finder's keepers, it's my field'). Give the party a moment to react to it.",
      cast: { tam: "Defend your right to the idol; it'll pay for a new ox. Waver if the party says it's dangerous or what the goblins want." },
      transitions: [{ id: "goblins-appear", on: "cue", when: "The idol has been seen or discussed; the goblins appear.", to: "ambush" }],
    },
    {
      id: "ambush",
      title: "The goblins show themselves",
      direction: "Skrag and his goblins rise from the hedgerow with bows drawn. Make this a standoff, not an instant fight: Skrag demands 'Grandmother Bone' back from 'the dirt-scratcher'. Tam hides behind the party. The party's choice: fight, bargain, intimidate, trick. Goblins are cowardly and greedy; Skrag can be talked to. If the party stalls, the goblins lose patience.",
      cast: {
        skrag: "Posture, threaten, demand the idol. Accept a fair trade or a face-saving retreat. Flee if outmatched and cowed. Attack if insulted or if nobody gives you anything.",
        tam: "Cower behind the party. Refuse to hand over the idol at first ('it's mine, I dug it up!'), give it up if the party insists or explains.",
      },
      pressure: "A goblin looses an arrow into the ground at Tam's feet; Skrag counts down on his fingers, badly.",
      transitions: [
        { id: "party-attacks", on: "attempt", when: "The party attacks the goblins or starts a fight.", to: "fight" },
        { id: "idol-returned", when: "The idol has been handed or thrown to Skrag and he has accepted it.", to: "bargain" },
        {
          id: "intimidate", on: "attempt",
          when: "The player tries to frighten the goblins off with threats or a show of force.",
          check: { skill: "intimidation", dc: 13, success: "The goblins' nerve breaks; they scatter into the hedges, Skrag shrieking curses.", failure: "Skrag calls their bluff and the goblins shoot.", onSuccess: "routed", onFailure: "fight" },
        },
        {
          id: "deceive", on: "attempt",
          when: "The player tries to trick the goblins (a fake idol, a lie about reinforcements, pretending the idol is cursed, etc.).",
          check: { skill: "deception", dc: 14, success: "Skrag falls for it, at least for long enough.", failure: "Skrag sees through it, furious at being made a fool of.", onSuccess: "tricked", onFailure: "fight" },
        },
        { id: "goblins-lose-patience", on: "cue", when: "The goblins have run out of patience and attack, because the party insulted them, stalled too long, or refused outright.", to: "fight" },
      ],
    },
  ],
  anytime: [
    { id: "walk-away", on: "attempt", when: "The party abandons Tam and leaves the crossroads without him.", to: "abandoned" },
  ],
  exits: [
    {
      id: "fight", kind: "combat", title: "Roll for initiative",
      outcome: "Combat begins at the crossroads between the party and Skrag's goblins. Tam is hiding.",
      closing: "Close on the first arrows flying and the goblins charging. End with 'Roll for initiative!'",
      next: "crossroads-aftermath",
      script: (world) => {
        world.startCombat({
          enemies: [{ asset: world.assets.get("goblin-archer"), count: 4 }, { asset: world.assets.get("goblin-boss"), count: 1, leader: "skrag" }],
          at: world.anchor("crossroads"),
        });
        world.character("tam").moveTo(world.anchor("ditch"));
      },
    },
    {
      id: "bargain", kind: "persuaded", title: "Grandmother Bone goes home",
      outcome: "The goblins take the idol back and leave without a fight. Tam is safe but out of pocket.",
      closing: "Skrag cradles the idol, makes some show of dignity, and the goblins melt into the hedges. Let Tam react.",
      next: "crossroads-aftermath",
      script: (world) => {
        world.character("tam").takeItem("bone-idol");
        world.character("skrag").leaveScene("goblin warren under the burnt mill");
        world.quest("mad-farmer").complete("The goblins took their idol back peacefully.");
      },
    },
    {
      id: "routed", kind: "persuaded", title: "The goblins flee",
      outcome: "The goblins scattered without a fight. They still want the idol and may come back.",
      closing: "The goblins scatter into the hedges. Silence, then Tam laughs hysterically.",
      next: "crossroads-aftermath",
      script: (world) => {
        world.character("skrag").leaveScene("goblin warren under the burnt mill");
        world.setFlag("goblins_will_return", true);
      },
    },
    {
      id: "tricked", kind: "persuaded", title: "Skrag is fooled",
      outcome: "The party fooled the goblins into leaving. Skrag will be furious when he realises.",
      closing: "The goblins withdraw, pleased with themselves. Give the party a moment to enjoy it.",
      next: "crossroads-aftermath",
      script: (world) => {
        world.character("skrag").leaveScene("goblin warren under the burnt mill");
        world.setFlag("skrag_humiliated", true);
      },
    },
    {
      id: "abandoned", kind: "leave", title: "On down the road",
      outcome: "The party left Tam to his fate at the crossroads.",
      closing: "Narrate the party walking on; behind them, Tam's shouting rises in pitch, then stops.",
      script: (world) => {
        world.setFlag("tam_abandoned", true);
        world.journal("We left a raving farmer at the crossroads. Later, we heard a scream.");
      },
    },
  ],
};
