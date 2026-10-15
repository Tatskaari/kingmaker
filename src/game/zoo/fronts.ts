import { readDoc, writeDoc } from "../../lore/docs.ts";

/**
 * The zoo's own fronts (the Theatre's boundary desk): what's in motion among the booths' people, in
 * the shape of the story's (lore/World/Fronts.md: fronts with a clock of steps, and bills still to
 * come due), for a booth's ending to move on at the desk. It lives only in a zoo visit's copy of the
 * docs (its session's overlay), never in the authored lore, so nothing in it reaches the story.
 */

export const ZOO_FRONTS = "Zoo/Fronts.md";

const BODY = `# What's in motion in the Theatre

The booths' people get on with their own troubles between booths. Each front is someone who wants something, with a clock of steps. A step ticks at the boundary desk when a booth's ending has made it true, never because it would be dramatic.

## Madam Crust's pies
**Who**: Madam Crust, who sells the last pie in the zoo, and never forgets a customer.
**Wants**: to sell out every day, and never to be thought a soft touch.
- [ ] **If the last pie went to Saltmere** (the pie stall ends "No pie"): the Saltmere servant tells his delegation the zoo's pies are the only decent ones in Caerwyn, and they send for forty more. *Shows as*: salt-gull livery queueing at the stall.
- [ ] **If the visitor threatened or insulted her over a pie**: she puts them on the list she reads out at Midwinter, and tells the ledger office about it when she goes in for her receipt. *Shows as*: Madam Crust at the ledger office, telling anyone who'll listen.
- [ ] **If she gave the visitor a pie for nothing**: she pretends she didn't, to everyone, loudly. *Shows as*: Madam Crust insisting to the ledger office that she has never given anything away in her life.

## The noon bell
**Who**: Old Peal, the bell-ringer, sixty years without missing noon; and a pigeon with two eggs in the bell.
**Wants**: Peal, to ring noon; the pigeon, to be left alone.
- [ ] **If the noon bell rang with the nest in it** (the belfry ends "Noon"): the zoo's pigeons hold a grudge. *Shows as*: pigeons on every sign in the Theatre, watching the visitor.
- [ ] **If the eggs were spared or the nest moved**: Peal tells the whole courtyard he's missed noon for the first time in sixty years, and is proud of it. *Shows as*: Peal in the courtyard, telling anyone, twice.

## The auditor's round
**Who**: Mister Tally, the auditor, with his two assistants, who audits the Theatre's books a booth at a time.
**Wants**: every ledger found, every column added, every fine paid.
- [ ] **If the ledger was found**: Tally moves on to the card room's books, where the takings don't add up. *Shows as*: Tally at the card room's door, with a pencil.
- [ ] **If the ledger office was fined**: Mister Inkpen goes round the booths borrowing the fine a penny at a time. *Shows as*: Inkpen, hat in hand, at the next booth.

## Bills still to come due
`;

/** The visit's copy of the zoo's fronts: made the first time the desk is used, then moved on by each crossing. */
export function zooFronts(sessionId: string): string {
  if (!readDoc(sessionId, ZOO_FRONTS)) {
    writeDoc(sessionId, { path: ZOO_FRONTS, meta: { summary: "GM only: what's in motion among the zoo's booths (Madam Crust's pies, the noon bell, the auditor's round), for the Theatre's boundary desk.", title: "The zoo's fronts", type: "world", visibility: "gm" }, body: BODY });
  }
  return ZOO_FRONTS;
}
