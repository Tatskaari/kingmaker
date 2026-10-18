# Caerwyn: the arc, scene by scene

These are the threads that cross scenes, so each scene can be written on its own and still join up. The truth of the whole story is in `lore/World/Fronts.md` and the cast's private notes. In short:
- Under-purveyor **J. Sallow** has been writing the King's grain wagons off as "lost to goblins" and selling the grain downriver through the **Heron** warehouse (Scrope keeps the true book).
- **Wendell Prout**, a clerk of the Granary Roll, found out. Sallow and his bruiser **Big Hobb Mallory** killed him in the tally loft and hung him from the hoist as a suicide.

The investigator works for **King Aldren**, with **Sergeant Agnes Kell** lent to them. She walks with them after the first scene.

| # | Scene | What it is for | The lead it must hand on (a `required` discovery) | Endings → next |
|---|---|---|---|---|
| 1 | hanged-clerk | Prout was murdered; why (the page: Sallow's countersignature on every "lost" wagon); who was there | **Hobb was at the scene**: the big man is Big Hobb Mallory, champion of the Drowned Rat | good: murder by persons unknown, with the Hobb lead · mixed: suicide under suspicious circumstances, with the Hobb lead · bad: failed (no lead), **the story ends** (no `next`). Good and mixed → caerwyn-afternoon |
| 2 | caerwyn-afternoon (interlude) | Downtime; Kell turns the lead into "the Rat, tonight" | none (the story skips interludes) | onward → drowned-rat |
| 3 | drowned-rat | Find Hobb in the Rat and get what he knows: who he works for and where | **Hobb's master is Sallow, and the grain goes through the Heron** (with the way in) | good: Hobb talks / taken in · mixed: Hobb runs / thrown out / gone to work, each with a way to the Heron still found → wharf-night |
| 4 | wharf-night (interlude) | Downtime on the river stairs; the barge loads tonight | none | onward → heron-warehouse |
| 5 | heron-warehouse | Proof: the King's grain re-sacked and the true book; Sallow comes at midnight | **The true book** (or another proof the King can hold) | good: out with the true book / caught in the act · mixed: caught · bad: up in smoke / the barge sails · combat: a fight (the stand-in fights it out until combat is built) → kings-morning |
| 6 | kings-morning | Report to the King before the Assembly; Sallow face to face | none: the end | good: done right by · mixed: after the Assembly · the story ends |

## Threads

- **Quests** (campaign.json `quests`). Keep these keys:
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
