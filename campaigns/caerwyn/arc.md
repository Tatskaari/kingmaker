# Caerwyn: the arc, scene by scene

These are the threads that cross scenes, so each scene can be written on its own and still join up. The truth of the whole story is in `lore/World/Fronts.md` and the cast's private notes. In short:
- Under-purveyor **J. Sallow** has been writing the King's grain wagons off as "lost to goblins" and selling the grain downriver through the **Heron** warehouse (Scrope keeps the true book).
- **Wendell Prout**, a clerk of the Granary Roll, found out. Sallow and his bruiser **Big Hobb Mallory** killed him in the tally loft and hung him from the hoist as a suicide.

The story begins with a prologue on the King's Road, two days before the Assembly: the player rides into Caerwyn on a cart of cushions for the Assembly's seats, fights the goblins Sallow pays to be seen on the road, and is brought to the King by a palace guard. By the next morning they're his investigator, with **Sergeant Agnes Kell** lent to them. She walks with them after the hanged clerk.

| # | Scene | What it is for | The lead it must hand on (a `required` discovery) | Endings → next |
|---|---|---|---|---|
| P1 | kings-road (comes to the player as the game begins) | The cold open: Barnaby Fitch's cart of Assembly cushions, his granddaughter Tansy, and the hedge-goblins' ambush at the crossroads (a fight, with a second wave). Seeds the plot: the goblins shout "Be seen!" and carry new heron pennies | **Smoke at the bridge**: the war-band has the King's patrol pinned at Garrow's toll bridge (only once the fight's begun; it makes Tansy one the story needs, so she hides, never runs) | good: on to the bridge · mixed: beaten up (on to the bridge anyway) → toll-bridge |
| P2 | toll-bridge | The prologue's big fight in two halves: the rearguard at the toll house beside Corporal Haskett and Guardsman Wren, a breath (Garrow's ledger: twelve palace wagons crossed his bridge inward, laden), then the war-boss Grisk on his worg over the bridge; two Kläggenheim axemen may come up the road | none | good: taken to the King · mixed: carried in → kings-thanks |
| P3 | kings-thanks (comes to the player) | Supper with the King: the anchor. He guesses their tea, rejoices over the cushions, puts the goblins off until after the Assembly, and may speak fondly of his grain clerk Wendell, whose letter about "irregularities in the Roll" is on his after-the-Assembly pile. A purse and a room in the palace | none | good: the King's guest → hanged-clerk (the next morning, after a long rest) · bad: shown the door, **the story ends** |
| 1 | hanged-clerk | Prout was murdered; why (the page: Sallow's countersignature on every "lost" wagon); who was there | **Hobb was at the scene**: the big man is Big Hobb Mallory, champion of the Drowned Rat | good: murder by persons unknown, with the Hobb lead · mixed: suicide under suspicious circumstances, with the Hobb lead · bad: failed (no lead), **the story ends** (no `next`). Good and mixed → caerwyn-afternoon |
| 2 | caerwyn-afternoon (interlude) | Downtime; Kell turns the lead into "the Rat, tonight" | none (the story skips interludes) | onward → drowned-rat |
| 3 | drowned-rat | Find Hobb in the Rat and get what he knows: who he works for and where | **Hobb's master is Sallow, and the grain goes through the Heron** (with the way in) | good: Hobb talks / taken in · mixed: Hobb runs / thrown out / gone to work, each with a way to the Heron still found → wharf-night |
| 4 | wharf-night (interlude) | Downtime on the river stairs; the barge loads tonight | none | onward → heron-warehouse |
| 5 | heron-warehouse | Proof: the King's grain re-sacked and the true book; Sallow comes at midnight | **The true book** (or another proof the King can hold) | good: out with the true book / caught in the act · mixed: caught · bad: up in smoke / the barge sails; the fight (blades out, Sallow and the Crakes against the player and Kell) is an event played in the conversation, the scene going on to one of those after it → kings-morning |
| 6 | kings-morning | Report to the King before the Assembly; Sallow face to face | none: the end | good: done right by · mixed: after the Assembly · the story ends |

## Threads

- **The prologue's threads.** The heron pennies on the goblins and Garrow's ledger (palace wagons crossing his bridge laden) are puzzles the player carries into the city: nothing in the prologue explains them. If the King spoke of Wendell's letter at supper, he knows the player knows it at the King's morning (its background says so). The cushions' quest (`assembly-cushions`) starts as the game begins and completes at the King's thanks. Grisk knows of the Saltmere courier Chief Gubbin took at a ford (the burnt mill, for later).
- **Quests** (the scenario's `quests`, in caerwyn.kmscenario). Keep these keys:
  - `hanged-clerk`: Prout's death. It starts at the story's start, and the first scene's endings advance, complete or fail it.
  - `purveyors-man`: Sallow. It starts when the player first has his name tied to the theft: the hanged clerk's motive discovery, if they read the page or heard Kell; otherwise the Rat. It advances at the Rat and the Heron, and completes at the King's morning.
  - `heron-ledger`: the true book. It starts at the Rat and completes at the Heron.

  An ending's effects can test facts (`if: {established: …}`), so they start a quest only when the player has learned what it's about.
- **The proof chain.** Prout's page (in his left boot, which Cob is wearing) is proof of the theft. The true book is proof of the whole operation.
  - The hanged clerk's motive discovery has `carry` for the page. If the player leaves without it, the story owes it to them at the Rat (Cob does pots there).
  - The King's morning needs something the King can hold: the page, the book, or Hobb's sworn word.
- **Kell** follows the player from the first scene's end (`onEnd: follow kell`, every ending). She's in every scene after it, so give her a role in each. She tests a case once ("On what evidence?") and keeps promises made in her hearing.
- **Cob and Moll** can turn up at the Rat (Cob does pots there for a penny and a bowl of stew). How the player treated them in the yard shows in their attitude (the endings' `attitude` effects).
- **Facts carried in.** Each later scene's `background` says what the story has established before it, in plain words. Its `assumes` and `overtaken` say what it takes for granted and where the story goes if play has already settled it. Keep the existing ones unless the new beats change them.
- **Names.** People are called by what the player would call them until they've heard the name (`called`). Hobb is "the big man with the bandaged hand"; Sallow is "Silvertop" or "the gentleman with the silver-topped cane".
