# The golden calls

The prototype's GM calls on the hanged clerk, recorded once, for the prompt parity test ([../parity.test.ts](../parity.test.ts)): the AI service's acceptance test (v0-design §10.2, v5-design §4.2, gm-port §16.1). For the same state, the AI service's GM must ask the models what the prototype's asks, and come to what it comes to.

## How they were recorded

[tools/record-golden.mts](../../../../tools/record-golden.mts), with the prototype's tools (it imports the prototype, which v2 never does), run on the prototype at `44c6d4a`. From the repo's root:

```sh
node --no-warnings tools/record-golden.mts                    # the prototype in this checkout, into v2/ai/gm/golden/hanged-clerk and v2/ai/gm/testdata/scenes
node --no-warnings tools/record-golden.mts --proto <a worktree at another commit> --out <a folder> --scenes <a folder>
```

Re-record when the prototype's GM changes and the change is copied into [gm/](..), then run the parity test.

Kell's lore in the recorded prompts carries #661's two edits (her `knowledge/Sallow.md` and `private.md`, in the campaign's lore since M1), put into these files by hand as a recording from the prototype at `53f45f3` would have them: nothing else in them changed.

It plays the hanged clerk under the prototype's stand-in for OpenRouter (`fakeOpenRouter`: no model is asked, nothing leaves the machine), with the `v2` approach and suggested lines on. The GM's replies are [tools/v2/golden-replies.json](../../../../tools/v2/golden-replies.json)'s, marked up as the model writes them:

| Moment | What the player does | The GM's reply | The stand-in |
|---|---|---|---|
| open | `createSession` (Wren Ashdown, the wizard pregen's build, no backstory, seed 1234) and `openScene` | Cob's line untagged, Kell's tagged | the quietest choices |
| t1 | "Sergeant, who found him?": a plain question to Kell | Kell, Cob and the girl in the shawl tagged; a why on Cob's last line, in the model's own drift form (nobody can tell who says that line) | the quietest choices |
| t2 | presses on the holes in Moll's story | a you on Moll's reaction | `attempt: catch-moll` (the Insight check fails: 3 + 1 = 4) |
| t3 | "(Out of character: what can I actually do here?)" | an aside, and a know on the Royal Purveyor's office | `ooc: out_of_character` |

At each moment the stand-in is told the notes the notes' writer writes (`byName.notes`) and the lines the suggester suggests (`suggestions`), and the judge finds the second line it's asked about gives away what's held (`line_2: gives_away`). Between them the notes land on a mark of the GM's, on spoken lines and on words of the reply, linked to someone (Cob, Kell, the girl in the shawl by what the player calls her), to a lore doc (a know written with its doc's D id in that call) and to the player's own turn (a you); a you on nothing the player did and a know with no doc don't land. Each set of lines has a name from the Rat (Hobb: unheard, from the campaign's vocabulary), a way out (too early), a line in the GM's markup, and lines that fit; at t2 one is a line offered last time.

It wraps the stand-in's fetch to keep every call's body with a copy of the session as it stood (the rules engine's serialised campaign left out, and the timings: the turns' `metrics`, and how long the last lines took) and names each call by its operation from the prototype's call log. It writes:

| File | What's in it |
|---|---|
| `00-open.json` to `09-t3-settle.json` | A step each: the opening, then each turn's decide (disclosure and `director.before`), reply (`gm.reply`) and settle (`world.stage` and `director.after`). The step's line, the stand-in's options (`fake`), the session at the step's first call, and every call the step made. The opening's and each reply's file also has who says each line (`speakers`): as the reply streams in a word at a time (each time the words shown grow, the prototype's `streamed`) and once it's whole (`readReply`, with the marks the GM drafted) |
| `<moment>.notes.json` | The notes on the moment's reply, from the session frozen at the notes call: the reply (its place on the transcript, its words, who says each line, the GM's marks), the call's body, the marks placed and linked, and each link's card (`knowledgeCard`) |
| `<moment>.suggest.json` | The lines after the moment's reply, from the session frozen at the suggest call: what was offered last, both calls' bodies (the suggester's and the judge's), every field of the vetting, the lines, and what was dropped and why |

The notes and the lines are written again on the frozen copy by the prototype's own `writeNotes`, `knowledgeCard`, `propose` and `vetting`, under a fresh stand-in told the same, and checked against the game's own calls: the same body for the notes' writer and the suggester. So the judge is asked on the state the lines were asked on, as the AI service asks it; in the game it's asked after an await, while the turn moves on.

It also writes the prototype's own scenes that the copied tests play, as authored, to [../testdata/scenes](../testdata/scenes): the Rat, the Heron, the King's morning, the ferry and the pie stall.

Re-recording gives the same calls, notes and lines; the files differ only in the rules engine's random ids for the character and their gear, which no prompt shows. (The timings would differ every time too: they aren't kept.) Checked on 16 Oct from the prototype at `44c6d4a` and from this branch's: every file the same but for those ids, the scenes byte for byte.

## What the test compares

Each step's or moment's session becomes the request the simulation would send (the GM's bookkeeping from the session's fields of the same names, the world through `worldToRows`, the transcript with the player's lines as `player:1` and each entry's markup by the game's keys, the sheet from the player, the rules' status line and the spells, weapons and features they keep ready; a reply's seq its place on the transcript, from 1; the lines offered last, from the session's), the AI service's endpoint runs on a stand-in told the same, and its calls are compared with the prototype's, in the game's order, on one store (the opening writes the player's doc, which every later prompt reads).

| Call, or what came of it | Compared |
|---|---|
| `gm.opening`, `gm.reply` | the whole request, byte for byte (instructions, every input message, model, effort, token cap): the history writes back who says each line, by the name the player knows them by, and the notes on the earlier replies |
| `world.stage` | the whole request, byte for byte (instructions, input, the schema of the world's ids) |
| `memory.disclose.*` | the whole request, byte for byte (each scope's state, every candidate's question) |
| `director.before`, `director.after` | the state byte for byte; every question the prototype asked is asked, each equal to the prototype's of that id |
| who says each line | as the reply streams, a word at a time (the draft's posts), and once it's whole, with the GM's drafted marks; no mark of the GM's own on the reply |
| `notes` | the whole request, byte for byte (instructions, input, the schema); the marks placed (offsets, kinds, notes, links by the game's keys) and each link's card |
| `scene.suggest` | the whole request, byte for byte (the player's spells in "who they are" too) |
| `scene.suggest.judge` | the state byte for byte, and every question |
| the vetting, the lines | every field of the vetting, equal; the lines, and what was dropped and why |

A reply's decision is the AI service's own, from its decide on the same turn; what the decide commit did (the roll and the move) is read off the prototype's session, so parity doesn't depend on V0's dice.

## Where the AI service differs, and why

All of it pinned by the test.

- **The director asks every question the prototype's does.** Since the full GM (full-gm-design §4.1) it asks considered rolls' `roll_call` and the means (`attempt_means`) in every beat, the co-GM's `off_graph`, and after the reply the rules' `left`; since the world bridge (world-bridge-design §3.1) the rules' `mechanic` before the reply, and their `threat` and `threat_severity` after it. The rules' questions are asked when the sheet has a build, as both recordings' have (the wizard's and the rogue's), so the test's `NOT_ASKED` is empty. Every question is the prototype's to the letter, the limit with its `pretending` option included. The act's details call (`director.mechanic`, `.jump`, `.feature`) and the reactions (`director.reactions`) aren't in the recordings: none of their turns casts, strikes or jumps.
- **The spells in the suggested lines' "who they are" are the sheet's.** The prototype tells the suggester and the judge the character's spells from the rules engine (`suggest.ts`'s `who`); the AI service from the sheet the request sends (`SheetRow.spells`, since the world bridge), the same list, so what they're sent is the same byte for byte.
- **The dice.** The prototype rolls through its rules engine when there's a sheet; V0's simulation rolls its no-sheet `rollCheck` from the game's dice row, so the same seed rolls differently (v0-design §6.4). The prompts carry whatever was rolled.

V0's difference on the GM's marks is gone: a reply's drafted marks go back with it (`drafted`), the notes are written on them, and the next reply's history has them, as the prototype's.
