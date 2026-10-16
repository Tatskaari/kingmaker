import type { Beat, Scene, Transition } from "../src/runtime/scene.ts";
import { hangedClerk } from "./hanged-clerk.ts";

/**
 * Representation experiment (2026-10-16): the hanged clerk as more beats and fewer transitions, the GM
 * improvising how the player gets from one to the next. The same people (their cards), facts,
 * essentials, limits, endings and noon clock; each beat is a milestone the story can reach, and its
 * routes are only "the story has reached the next one", the endings and the clock. No authored checks
 * and no routes about one person (the boot's four, win-cob, catch-moll, scare-kids, persuade-tull):
 * considered rolls rule what the player tries, and the co-GM can add routes. No per-beat notes on the
 * cast: the cards say who people are. Compare with hanged-clerk, which has five beats and some forty
 * routes.
 */
const route = (beat: string, id: string): Transition => {
  const t = hangedClerk.beats.find(b => b.id === beat)?.transitions.find(x => x.id === id);
  if (!t) throw new Error(`hanged-clerk has no ${beat}.${id}`);
  return t;
};
const original = (id: string): Beat => hangedClerk.beats.find(b => b.id === id)!;

const notSuicide = route("yard", "not-suicide");
const pageFound = route("yard", "page-found");
const told: Transition = {
  id: "children-told",
  when: "Cob or Moll has told the player something true about last night: what Cob heard in the loft, or that a gentleman paid Moll to say the clerk jumped.",
  to: "witness",
};
const named: Transition = {
  id: "man-named",
  when: "The player has a face or a name for the man behind it from someone who saw him or from something found: the gentleman with the silver-topped cane and the wheat-ear ring (the kids' 'Silvertop'), the big man with the bandaged hand who called him Master, or Master Sallow.",
  to: "who",
};

export const hangedClerkBeats: Scene = {
  ...hangedClerk,
  id: "hanged-clerk-beats",
  title: "The Hanged Clerk (beats)",
  summary: "The hanged clerk as milestones with few routes: the GM improvises how the player gets from one to the next.",
  start: "yard",
  beats: [
    { id: "yard", title: original("yard").title, direction: original("yard").direction, pressure: original("yard").pressure,
      transitions: [notSuicide, told, pageFound, route("yard", "concede"), route("yard", "walk-away"), route("yard", "cart-comes")] },
    { id: "doubt", title: original("doubt").title, direction: original("doubt").direction, pressure: original("doubt").pressure,
      transitions: [told, named, pageFound, route("doubt", "accuse-kid"), route("doubt", "wrap-up"), route("doubt", "cart-comes")] },
    { id: "witness", title: "What the children saw",
      direction: "Cob or Moll has given up something true about last night, and it cost them: Moll wants Cob away from here before the gentleman comes back, and Cob is frightened of the men finding out he told. The thread runs through them now: who it was, what was wanted, and whether the kids will be safe for telling. What they haven't said yet stays theirs until the player gives them a reason.",
      pressure: original("doubt").pressure,
      transitions: [notSuicide, named, pageFound, route("doubt", "accuse-kid"), route("doubt", "wrap-up"), route("doubt", "cart-comes")] },
    { id: "who", title: "A name for Silvertop",
      direction: "The player has a face or a name for the man in the loft. Now it's why, and proof: what Prout had that the man wanted, and something that would stand up when Kell signs Prout in. Kell writes down what a witness will swear to, and tests a case when the player puts one to her.",
      pressure: original("motive").pressure,
      transitions: [pageFound, route("doubt", "accuse-kid"), route("doubt", "wrap-up"), route("doubt", "cart-comes")] },
    { ...original("motive"), cast: undefined },
    { ...original("dead-cart"), cast: undefined, transitions: original("dead-cart").transitions.filter(t => !t.check) },
    { ...original("accused"), cast: undefined },
  ],
};
