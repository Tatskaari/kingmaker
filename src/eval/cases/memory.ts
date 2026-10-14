/**
 * Memory continuity cases: memorable things done in one scene, probed in the next.
 * Turns starting "#end <exit>" force that ending (and chain into the next scene).
 */
export interface MemoryCase {
  id: string;
  about: string;
  scene: string;
  turns: string[];
  probes: Array<{ say: string; expect: string }>;
}

export const MEMORY_CASES: MemoryCase[] = [
  {
    id: "mem-crossroads-scarf", about: "A gift with an improvised backstory and a promise, recalled in the aftermath scene.",
    scene: "crossroads-ambush",
    turns: [
      "I raise my hands and crouch lower than his pitchfork. \"Easy, friend. I am Wren. Whatever is in that hedge, I will see you home to your wife tonight. You have my word.\"",
      "I press the last of my bread and my good wool scarf into his hands. \"Eat. Keep warm, you are shaking. My mother knitted that scarf in Dunmere, so mind you give it back one day.\"",
      "#end bargain",
    ],
    probes: [
      { say: "\"Tam, the scarf: do you remember where I said it came from?\"", expect: "Tam remembers the scarf was knitted by Wren's mother in Dunmere, and that he's meant to give it back one day." },
      { say: "\"And what did I promise you at the milestone?\"", expect: "Tam remembers Wren promised to see him home to his wife (Bet) tonight." },
    ],
  },
  {
    id: "mem-arc-yard", about: "Hanged clerk -> Drowned Rat -> Heron: a cuffed boy, an apology with a promise, and an improvised backstory, probed one and two scenes later; and someone who wasn't there.",
    scene: "hanged-clerk",
    turns: [
      "I walk into the yard and the boy's next stone clips my shoulder. I grab him by the collar and cuff him round the ear. \"Throw one more stone at a dead man and I'll throw you in the river.\"",
      "\"Sergeant Kell? I'm Wren. Before you ask: I grew up on the river barges out of Saltmere. My father was a bargee, and I know a hanged man from a drowned one.\" I look up at the body.",
      "I turn to the girl on the wall. \"You, up there. I was rough with your friend just now, and that's on me. So here's a promise: whatever comes of this, I'll see he never goes to the Mending House. You have my word.\"",
      "#end case-made",
    ],
    probes: [
      { say: "I spot Cob among the pots and catch his eye. \"Cob. Are we square, you and me, after this morning?\"", expect: "Cob remembers that Wren cuffed him round the ear in the granary yard this morning; he doesn't act as if it never happened (wary, sore, or bargaining over it)." },
      { say: "\"Kell, do you remember what I told you about my father?\"", expect: "Kell remembers that Wren said their father was a bargee and that Wren grew up on the river barges out of Saltmere." },
      { say: "I sit down across from the big man with the bandaged hand. \"Did you hear what I did to the boy at the granary this morning?\"", expect: "Big Hobb wasn't in the granary yard this morning: he must not describe what Wren did to Cob as if he knew it (unless someone in this scene has just told him). Not knowing, or knowing only what he's been told here, passes." },
      { say: "#end hobb-talks", expect: "" },
      { say: "\"Sergeant, whatever happens tonight: what did I promise Moll this morning?\"", expect: "Kell remembers Wren's promise, made to Moll in the granary yard, that Cob would never go to the Mending House." },
      { say: "\"Be honest, Kell. What did you make of me in the yard this morning?\"", expect: "Kell's answer reflects what actually happened in the yard: Wren cuffed Cob, then owned up to it and promised Moll to keep Cob out of the Mending House. She shouldn't misremember or omit the cuffing." },
    ],
  },
];
