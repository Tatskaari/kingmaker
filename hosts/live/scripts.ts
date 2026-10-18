/**
 * The live runs' scripts: what each says in the hanged clerk's scene, line by line, and as whom.
 * v0 is V0's (v0-design §10.6); v5 is v5-design §4.6's twelve, two of them a suggested line picked
 * as the headless client's `act` picks one; map is the map's (map-design §4): the scene opened by
 * talking to Kell in the lane (as every script's is, now the campaign starts on its map), then V0's
 * first three lines, played beside the prototype's QA console on the same lines; gm is
 * full-gm-design §1.2's eight, two of them said once the memory review is done, as a
 * tester reading the reply would; world is world-bridge-design §1.2's spells and blows, with what
 * the world showed after each.
 */

/** A suggested line as `act` names it: say_N, or the first of a kind ("the try line"). */
export type Pick = { id: `say_${number}` } | { kind: "say" | "do" | "try" | "leave" };

/**
 * A line of a script: words to say, or a suggested line to pick, the first of the picks that's there.
 * `wait: "background"`: said once the scene's background jobs (the memory review) are done.
 */
export type Step = { say: string; wait?: "background" } | { act: Pick[] };

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
  /**
   * The GM's side is recorded (npm run status): each line's memory review,
   * with the background jobs waited for once the last line is done, so its review is in.
   */
  gmSide?: boolean;
  /**
   * The world's side is recorded (world-bridge-design §1.3): after each turn, what the place's rows
   * showed changed (destroyed, burning, fallen, wet, who left), and who reacted to the act and how.
   */
  worldSide?: boolean;
}

const say = (text: string): Step => ({ say: text });
const act = (...picks: Pick[]): Step => ({ act: picks });
/** Words said once the memory review has done with the lines before. */
const later = (text: string): Step => ({ say: text, wait: "background" });

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
    about: "The reply as drawn: each speaker's lines and the lines suggested after it, through V5's split",
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
  map: {
    name: "map",
    title: "Walk Caerwyn live run",
    about: "A game begun on the map in the granary lane, the hanged clerk opened by talking to Kell (map-design §4), then V0's first three lines",
    who: "Wren Ashdown: a hedge wizard from the fens",
    build: "wizard",
    steps: [
      say("Sergeant, who found him?"),
      say("*I climb up on the cart and look closely at Prout's neck, the back of his head and his hands.*"),
      say("Moll, you never saw him jump, did you? Who paid you to say it?"),
    ],
    lines: 3,
  },
  gm: {
    name: "gm",
    title: "The full GM live run",
    about: "The full GM (full-gm-design §1.2), as the two-part GM plays it: people remember what the player did (the memory reviews), and the co-GM moves the scene on in the settle",
    who: "Wren Ashdown: a hedge wizard from the fens",
    build: "wizard",
    // full-gm-design §1.2, rows 2 to 8: a coin for Cob (someone remembers it), a question at once (the
    // review doesn't hold the turn), a lift from his boot (the GM's check, since considered rolls
    // went), what Kell remembers (once the reviews are in), a plan off the graph, two lines that drift,
    // and walking out, once the memory reviews are done. (The old co-GM's steering and the ending of
    // the player's own went with the old pipeline.)
    steps: [
      say("(I crouch and press a silver crown into the boy's hand) Get yourself something hot, lad. No questions."),
      say("Sergeant, who found him?"),
      say("(I try to lift the folded paper out of the boy's boot while he watches the sergeant)"),
      later("Sergeant, you saw what I gave the boy. Think me soft?"),
      say("Sergeant, what if we leave him up there and watch who comes back for those boots? I'll wait in the loft."),
      say("I ask the girl what songs the granary kids sing."),
      say("And the one about the miller's cat?"),
      later("(I nod to the sergeant and walk out of the yard, back towards the palace)"),
    ],
    lines: 8,
    gmSide: true,
  },
  world: {
    name: "world",
    title: "The world bridge live run",
    about: "The world bridge (world-bridge-design §1.2): spells and blows said in words, read by the act step and resolved by the rules on the scene's world before the GM speaks, the people who saw them reacting (none starting a fight), fire burning on at the next line, and a spell Wren hasn't got refused by the rules",
    who: "Wren Ashdown: an absent-minded hedge-wizard of the Invisible College who has read about fire extensively and is keen to try it",
    build: "wizard",
    // §1.2, rows 3 to 9: a spell at a thing (the rope breaks, Prout falls, the yard reacts), a cone of
    // fire at the gate, the fire on the next line, a blow at Kell (the yard reacts; until the old
    // pipeline went, a fight might break out and its blow land first on the next line, hands up; a
    // scene's reactions start none now), Fire Bolt at the old elm and the elm burning on, and a spell
    // Wren hasn't got (the rules' own no).
    steps: [
      say("(I cast Magic Missile at the hoist rope)"),
      say("(I cast Burning Hands at the yard gate)"),
      say("(I watch the gate burn)"),
      say("I take a swing at Sergeant Kell with my staff"),
      say("(I put my hands up)"),
      say("(I cast Fire Bolt at the old elm)"),
      say("(I watch the elm burn)"),
      say("I cast Fireball at the elm"),
    ],
    lines: 5,
    worldSide: true,
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
