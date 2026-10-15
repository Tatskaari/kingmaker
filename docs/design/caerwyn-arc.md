# The Purveyor's Man: a three-scene arc in Caerwyn

A three-scene demo of narrative continuity. **Ending one scene starts the next**, and the people the player meets again **remember what the player did**. The chain is `hanged-clerk` → `drowned-rat` → `heron-warehouse`, linked by `exit.next`.

Memory works like V1's docs service:
- Each character has a memory index.
- Each played scene leaves a summary doc.
- Background reviews, fired by attention flags, write first-person memories.
- Jev opens the relevant ones each turn (progressive disclosure).

The world map and world-update patches are parked until continuity works. Scenes and world scripts use the ids below.

## Recurring characters (the point of the demo)

| who | scene 1: `hanged-clerk` | scene 2: `drowned-rat` | scene 3: `heron-warehouse` |
|---|---|---|---|
| Sergeant Kell | the player's partner | comes along (the King lent her to the investigator) | comes along, or is waiting at the wharf if sent for |
| Cob | throws stones, wears the dead man's boots | turns up at the Rat (he knows the big cove by sight; pot-boy for the evening, or tailing the player) | – |
| Big Hobb | named only as "a big man with a bandaged hand" | drinks here | there with the loading crew, unless taken in or fled in scene 2 (the hand-off says) |
| Master Sallow | named or described | his name frightens people | arrives to see the barge loaded |

Cards for recurring characters are written neutral to earlier outcomes: their voice, wants and fears hold whatever happened. What they remember of the player (a cuffed ear, a promise kept, a coin, a threat) comes from memory, not the card.

## The conspiracy (GM truth; players piece it together)

- **Master Josiah Sallow** is an under-purveyor in the Royal Purveyor's office.
  - **Look:** a good coat, a silver-topped cane, a wheat-ear signet ring (the office's mark), and too much lavender water.
  - **The racket:** grain wagons bound for the palace along the King's Road are written off in the Granary Roll as "lost to goblins". The grain goes to the **Heron warehouse** on the river, where it is re-sacked under the heron mark of a Saltmere grain factor and sold downriver. Every write-off is countersigned "J. Sallow, for the Royal Purveyor".
  - **Making the goblin story stick:** he pays the hedge-goblins of the burnt mill to be seen on the road and to raid now and then. He pays in new silver pennies stamped with a heron, which come from the warehouse's Saltmere buyers. In a grey hood he also paid Chief Gubbin to snatch the Saltmere courier (`warren-hostage`). Her letter of credit pays for the Centennial Assembly, and an Assembly short of grain and money is a Purveyor's office that gets to "save" it. That thread can stay in the background.
- **Wendell Prout**, under-clerk of the Granary Roll, noticed that "lost" wagons weighed in at the river warehouses two days later. He cut out a page of the Roll and sewed it into his boot. He asked Sergeant Kell how to report false entries. Sallow and his muscle caught him in the tally loft last night, a little after the midnight bells: they struck him, strangled him, and hoisted him on the sack hoist to look like a suicide. He was found at first light.
- **Hobb Mallory** ("Big Hobb") is Sallow's muscle. He is a dock-porter the size of a door, with a bandaged right hand: rope burn from hauling Prout up on the hoist. He drinks at **the Drowned Rat** on the river stairs every night, and more than usual since. He is not a killer by nature. He's frightened of Sallow, frightened of what he did, and frightened of the hand being noticed. He has a key token for the Heron warehouse's river door and knows the night routine.

## Locations (ids)

| id | name | where | notes |
|---|---|---|---|
| `caerwyn-granary` | The granary yard | Caerwyn, granary quarter | `hanged-clerk` |
| `watch-house` | The watch house | Caerwyn, by the granary quarter | Kell's desk, the cold room, Corporal Tull |
| `palace-kitchens` | The palace kitchens | Caerwyn palace, back courts | Where Cob and Moll might be sent for safety. Mistress Pruett the cook runs it and gossips about Purveyor's office deliveries |
| `corn-exchange` | The Corn Exchange | Caerwyn, market square | Grain factors, prices and wagon lists. The clerk Abel Fennick knows which wagons were "lost" |
| `river-stairs` | The river stairs | Caerwyn, the docks | Steps down to the wharves; porters; the Drowned Rat |
| `drowned-rat` | The Drowned Rat | The river stairs | A dockside dive where Big Hobb drinks. **Scene: `drowned-rat`** |
| `heron-warehouse` | The Heron warehouse | The wharves, downriver end | Heron sign, river door, night watchman. **Scene: `heron-warehouse`** |
| `caerwyn-palace` | The palace | Caerwyn | The King and the Assembly. Taking the case to the King is a later scene |
| `palace-service-entrance` | The palace service entrance | Caerwyn palace | `blocked-entrance` |
| `kings-road`, `crossroads`, `toll-house`, `hollis-farm`, `burnt-mill`, `nine-furrows-green` | The King's Road and around | Outside the city | Existing scenes |

## People (ids)

**Existing:** `kell`, `cob`, `moll`, `tull` (hanged-clerk); `gubbin`, `snikkit`, `hester` (warren-hostage); `tam`, `skrag` (crossroads); `garrow` (toll); `holt`, `rowan` (entrance); and others.

**New:**
- `sallow`: Master Josiah Sallow (see above). Usually at the palace offices. He comes to the Heron warehouse at night to see a barge loaded.
- `hobb`: Big Hobb Mallory (see above).
- `nan-quill`: Nan Quill, landlady of the Drowned Rat. She sells gossip by the measure, keeps a cudgel called "Manners", and has strict house rules, posted and enforced.
- `pruett`: Mistress Pruett, palace cook. For situation play at `palace-kitchens`.
- `fennick`: Abel Fennick, Corn Exchange clerk. For situation play at `corn-exchange`.
- The Heron warehouse night staff (the `heron-warehouse` scene authors them).

## Items (ids)

- `prout-ledger-page`: Page from the Royal Granary Roll (from `hanged-clerk`).
- `wheat-ear-crown`: The silver crown Sallow paid Moll (Moll keeps it unless given up).
- `heron-penny`: A heron-stamped silver penny (from `warren-hostage`, or found on the river).
- `heron-token`: Hobb's brass river-door token for the Heron warehouse.
- `true-book`: The Heron warehouse's own ledger of "lost" royal grain bought, re-sacked and sold. **The proof.**

## Flags and quests

- `prout_death`: "murder, Sallow named" / "murder, unnamed" / "suicide" / "murder, blamed on a granary child" (set by `hanged-clerk`).
- **Quests:**
  - `hanged-clerk`
  - `purveyors-man`: The Purveyor's Man. Find proof of Sallow's racket.
  - `heron-ledger`: started when the player learns of the warehouse.
- **Flags:**
  - `hobb_identified`: the player knows the big man is Hobb of the Drowned Rat.
  - `heron_known`: the player knows of the warehouse.
  - `true_book`: "taken" / "seen" / "burned".

## The arc

1. **`hanged-clerk`** (existing). It ends with the case made, or open, or worse. The player leaves knowing some of these: a big man with a bandaged hand, Silvertop or Sallow, the wheat-ear crown, the page and its river-warehouse weights.
2. **The hub.** Asking around at the watch house, the kitchens or the Corn Exchange (situation play), or straight to the river stairs. Leads to the Drowned Rat:
   - Kell, on her own errand at the noon break, sees the big man with the bandaged hand at a gentleman's elbow by the Purveyor's wagons, and follows him down the river stairs to the Rat. She also knows dock bruisers drink there.
   - Cob has seen the big cove "down the Rat".
   - Pruett hears the porters' gossip.
   - Fennick's wagon lists point to the river.
3. **`drowned-rat`.** Find Big Hobb and get what he knows: who, what happened in the loft, the warehouse, the night routine, the token. There are many ways in: drink, cards, arm-wrestling, Nan's gossip-by-the-measure, fear, kindness, a trick, a fight (Nan's house rules make fights costly).
4. **`heron-warehouse`.** Get in at night and get the true book, or catch Sallow with the barge. Possible approaches: sneak, bluff as a buyer, bribe the watch, Hobb's token, a diversion. Real dangers: the river, the hoists, Sallow's men.
5. **Later.** Take the case to the King. Not in this playtest.
