/**
 * The live runs' scripts: what each says in the hanged clerk's scene, line by line, and as whom.
 * v0 is V0's (v0-design §10.6); v5 is v5-design §4.6's twelve, two of them a suggested line picked
 * as the headless client's `act` picks one.
 */

/** A suggested line as `act` names it: say_N, or the first of a kind ("the try line"). */
export type Pick = { id: `say_${number}` } | { kind: "say" | "do" | "try" | "leave" };

/** A line of a script: words to say, or a suggested line to pick, the first of the picks that's there. */
export type Step = { say: string } | { act: Pick[] };

export interface Script {
  name: string;
  /** "V5 live run": the record's title. */
  title: string;
  /** What the run is for, a sentence for the record. */
  about: string;
  who: string;
  build: string;
  steps: Step[];
  /** How many of its steps a run plays unless told (--lines). */
  lines: number;
}

const say = (text: string): Step => ({ say: text });
const act = (...picks: Pick[]): Step => ({ act: picks });

export const SCRIPTS: Record<string, Script> = {
  v0: {
    name: "v0",
    title: "V0 live run",
    about: "The hanged clerk's scene through V0's split (client, SpacetimeDB, the AI service)",
    who: "Wren Ashdown: a hedge wizard from the fens",
    build: "wizard",
    // A question, two checks (medicine, insight), a promise that wins Cob over, what it all means, and the boot.
    steps: [
      say("Sergeant, who found him?"),
      say("*I climb up on the cart and look closely at Prout's neck, the back of his head and his hands.*"),
      say("Moll, you never saw him jump, did you? Who paid you to say it?"),
      say("Cob, nobody's taking your boots, and your name stays out of anybody's book. I'll keep the men from the loft off you. What did you hear last night?"),
      say("*I turn to Kell.* He didn't hang himself. Someone strung him up after. We need to know why."),
      say("Cob, may I see what's crackling in your left boot? It stays yours."),
    ],
    lines: 4,
  },
  v5: {
    name: "v5",
    title: "V5 live run",
    about: "The reply as drawn: each speaker's lines, the notes on a reply's marks and the lines suggested after it, through V5's split",
    who: "Wren Ashdown: a quick-witted investigator lent to the case by the King",
    build: "rogue",
    // v5-design §4.6: greetings, a look and a question, the two on the wall, a suggested line, the
    // office, the boots, Cob won round, a risky try if one's offered, the loft, a coin, Moll, the case.
    steps: [
      say("Sergeant Kell? I'm told you've been waiting for me."),
      say("*I look up at the body, then at the two on the wall* Who found him?"),
      say("You two. Did either of you see anything last night?"),
      act({ id: "say_1" }),
      say("Kell, what has the Royal Purveyor's office to do with grain?"),
      say("(I crouch and look at his boots)"),
      say("Cob, nobody's in trouble for talking to me. I'm not the watch."),
      act({ kind: "try" }, { id: "say_2" }),
      say("What did Prout do up in the tally loft?"),
      say("(I hold up a shilling for the boy)"),
      say("Moll, why are you keeping him away from me?"),
      say("Kell, I think he was killed. Let's look at the loft."),
    ],
    lines: 12,
  },
};

/** A pick as `act` writes it: "say_1", "the try line". */
export const pickName = (p: Pick) => ("id" in p ? p.id : `the ${p.kind} line`);

/** The step as the record shows it: its words, or "act the try line, else say_2". */
export const stepName = (s: Step) => ("say" in s ? s.say : `act ${s.act.map(pickName).join(", else ")}`);

/** The suggested line a step picks among those offered (in order, say_1 first), or undefined when none of its picks is there. */
export function picked<T extends { kind: string }>(picks: Pick[], offered: T[]): T | undefined {
  for (const p of picks) {
    const line = "id" in p ? offered[Number(p.id.slice(4)) - 1] : offered.find(l => l.kind === p.kind);
    if (line) return line;
  }
  return undefined;
}
