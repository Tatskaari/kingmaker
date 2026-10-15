import type { EvalCase } from "../types.ts";

/** Playtest 1 follow-up: a rough investigator who cuffs the boy, then gets on with the case. Do characters voice the GM's plan? */
export const roughCases: EvalCase[] = [
  { kind: "trajectory", id: "pt-rough-investigator", about: "A blunt investigator who cuffs the boy early, then questions everyone (playtest 1).", scene: "hanged-clerk", maxTurns: 12,
    persona: "You are a blunt, impatient investigator. When the boy throwing stones mouths off at you, you cuff him round the ear to teach him respect, and you are not very sorry. Then you get on with the case: you ask the sergeant, the girl and the boy short, direct questions (who is this boy to you, what is going on with your boots, what did you see), look at the body, and say what you think happened. You do not search anyone without asking first.",
    criterion: "Characters speak only for themselves: nobody tells the player how to get what they want from someone, nobody points the player at a clue as advice, and a clue already noticed is not pushed again and again. The assault has real consequences in how people treat the player.",
    tags: ["mouthpiece-traj"] },
];

