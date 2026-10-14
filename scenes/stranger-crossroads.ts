import type { Scene } from "../src/runtime/scene.ts";

/**
 * Scene 1 from the brief: introducing yourself to a stranger and creating your character.
 * Adapted from V1's Laughing Stranger (lore/Scenarios/Centennial Assembly/stranger.md).
 * The exit extracts the character sheet, then the road leads to the crossroads ambush.
 */
export const strangerCrossroads: Scene = {
  id: "stranger-crossroads",
  title: "The Laughing Stranger",
  summary: "Character creation as a scene: a trickster god on a milestone helps you invent who you are.",
  setting: "A crossroads at dusk on the edge of the world you know: a bare winter tree, a milestone worn smooth by travellers, the road to Caerwyn running away into frost. A man sits on the milestone turning a coin between his fingers. The air smells faintly of snow and of something sweeter, like spilled wine.",
  premise: "Who is the player's character, and how will they talk their way into the royal court at Caerwyn?",
  hook: "You've heard his laugh in dreams, and occasionally in answer to a prayer. Tonight, at a crossroads, you finally meet him.",
  opening: "A man sits beneath a bare tree on a milestone, turning a coin. His face is unfamiliar; his laugh is not: the player has heard it in dreams and in answer to prayers. He makes room on the milestone and says he's sending them to court, to a palace full of powerful people all expecting to get their own way. He unfolds a blank sheet of paper: they'll need a story to get inside. End with him asking what he should call them.",
  cast: [
    {
      id: "stranger",
      name: "The Laughing Stranger",
      look: "Ageless, unremarkable face that's hard to hold in memory, a traveller's coat with too many pockets, a coin that never stops moving across his knuckles. His laugh is the only constant thing about him.",
      voice: "Intimate, jovial, wry and faintly uncanny. Delights in initiative, punctured dignity and unexpected alliances. Plain when explaining practical things; jokes sparingly.",
      wants: "To send his devotee to meddle at the Centennial Assembly in Caerwyn, with a character and a cover story good enough to get them inside, and to enjoy the creative process.",
      fears: "Boredom. A devotee with no story at all.",
      knows: [
        "The Centennial Assembly: every hundred years the kingdoms must publicly recognise one common sovereign. This winter it meets at King Aldren's palace in Caerwyn.",
        "The delegations: Caerwyn (the host court: roads, courts, garrisons), Nine Furrows (agricultural wizards of the ancient university), Kläggenheim (dwarven miners and engineers, King Gurt), Saltmere (ships, warehouses and credit; Prince Peregrine).",
        "Anyone can get into court with a good enough story: an invited guest, a clerk, a performer, a guard's cousin, a travelling hero known by reputation, a servant of one delegation.",
        "The road from this crossroads leads to Caerwyn. A little way down it, a farmer is having a much worse day than the player is.",
        "He can give the player one small blessing: a coin that is lucky exactly once.",
      ],
      secrets: ["His deeper divine schemes for the Assembly. He enjoys hinting; he never explains."],
      attitude: "Fond, amused and openly on the player's side.",
    },
  ],
  start: "name",
  beats: [
    {
      id: "name",
      title: "What shall I call you?",
      direction: "The Stranger wants a name. Whatever the player offers, he delights in it (or in their evasion: he might offer a ridiculous provisional name and let them correct it). No interrogation; it's a game between friends.",
      cast: { stranger: "Ask what to call them. Savour the answer. Write it on the blank sheet with a flourish." },
      transitions: [
        { id: "named", when: "The player has given their character a name (or accepted one the Stranger offered).", to: "who" },
      ],
    },
    {
      id: "who",
      title: "Who are you?",
      direction: "Build the character together in conversation: where they're from, what they've done, what they're good at and one thing they're bad at. The player can invent their homeland and history freely. The Stranger offers playful suggestions when they're stuck and enjoys contradictions. Anything plausible for a person in a low-fantasy world is welcome; godlike power, armies or crowns aren't on offer, and he says so with a laugh and an alternative.",
      cast: { stranger: "Ask about their past and talents a little at a time. React to everything as if it's the best story you've heard all week. Note it on the sheet." },
      pressure: "The Stranger reads back what's on the sheet so far, with one wickedly flattering embellishment, and asks what they're actually good at.",
      transitions: [
        { id: "sketched", when: "The player has described who their character is and at least one thing they're good at.", to: "cover" },
      ],
    },
    {
      id: "cover",
      title: "A way into court",
      direction: "Now the cover story: how does this person get through the palace doors? The Stranger suggests a few public possibilities that fit what the player has told him (a delegation they could serve, a guest invitation, a trade that's always needed at court) and lets the player choose or invent. He shares public facts about the delegations if asked, never their secrets.",
      cast: { stranger: "Pitch two or three cover stories that fit the character. Enjoy the player's own idea more than yours." },
      pressure: "The coin stops moving. 'The doors close at the solstice, my dear. Who are you when you knock?'",
      transitions: [
        { id: "cover-chosen", when: "The player has settled on how their character will get into the court at Caerwyn.", to: "send-off" },
      ],
    },
    {
      id: "send-off",
      title: "The road to Caerwyn",
      direction: "The Stranger folds the sheet into the player's pocket, gives them his small blessing (a coin that's lucky exactly once) and points them down the road. He mentions, as if in passing, that a farmer up ahead is having a worse day than they are. Let the player ask last questions; he answers the practical ones and laughs off the divine ones.",
      cast: { stranger: "Give the coin. Send them on their way. Be a little sad to see them go, and hide it with a joke." },
      transitions: [
        { id: "ready", when: "The player has said goodbye or set off down the road.", to: "set-off" },
      ],
    },
  ],
  anytime: [
    { id: "leaves-early", on: "attempt", when: "The player walks away from the Stranger down the road before their story is finished.", to: "set-off" },
  ],
  exits: [
    {
      id: "set-off", kind: "progress", title: "Down the road",
      outcome: "The player sets off towards Caerwyn with their story and the Stranger's lucky coin.",
      closing: "The Stranger's laugh follows them down the road and then is simply gone, as is the tree. Ahead, someone is shouting.",
      next: "crossroads-ambush",
      script: (world) => {
        world.player.addItem(world.newItem({ id: "lucky-coin", name: "The Stranger's coin", kind: "trinket", description: "A worn coin that is lucky exactly once.", asset: "lucky-charm" }));
        world.journal("Met the Laughing Stranger at the crossroads. He's sending me to court.");
      },
    },
  ],
  anchors: ["crossroads", "milestone", "winter-tree", "kings-road"],
  createsCharacter: true,
};
