# The golden calls

The prototype's GM calls on the hanged clerk, recorded once, for V0's prompt parity test ([../parity.test.ts](../parity.test.ts)): the AI service's acceptance test (v0-design §10.2, gm-port §16.1). For the same state, V0's GM must ask the models what the prototype's asks.

## How they were recorded

[tools/record-golden.mts](../../../../tools/record-golden.mts), with the prototype's tools (it imports the prototype, which v2 never does), run on the prototype at `44c6d4a`. From the repo's root:

```sh
node --no-warnings tools/record-golden.mts                    # the prototype in this checkout, into v2/ai/gm/golden/hanged-clerk
node --no-warnings tools/record-golden.mts --proto <a worktree at another commit> --out <a folder>
```

Re-record when the prototype's GM changes and the change is copied into [gm/](..), then run the parity test.

It plays the hanged clerk under the prototype's stand-in for OpenRouter (`fakeOpenRouter`: no model is asked, nothing leaves the machine), with the `v2` approach:

| Step | What the player does | The stand-in |
|---|---|---|
| open | `createSession` (Wren Ashdown, the wizard pregen's build, no backstory, seed 1234) and `openScene` | the GM's opening, with a tagged line |
| t1 | "Sergeant, who found him?": a plain question to Kell | every decision its quietest choice; a reply with an untagged line |
| t2 | presses on the holes in Moll's story | `attempt: catch-moll` (the Insight check fails: 3 + 1 = 4) |
| t3 | "(Out of character: what can I actually do here?)" | `ooc: out_of_character` |

It wraps the stand-in's fetch to keep every call's body with a copy of the session as it stood (the rules engine's serialised campaign left out), names each call by its operation from the prototype's call log, and writes one file a step: the opening, then each turn's decide (disclosure and `director.before`), reply (`gm.reply`) and settle (`world.stage` and `director.after`). Each file has the step's line, the stand-in's scripted choices and replies, the session at the step's first call, and every call the step made. The notes on the GM's marks (`notes`) are a later vertical's and left out.

Re-recording gives the same calls; the files differ only in the rules engine's random ids for the character and their gear, which no prompt shows. Checked on 16 Oct from the prototype at `44c6d4a` and from this branch's: every step's calls byte for byte the committed ones.

## What the test compares

Each step's session becomes the request the simulation would send (the GM's bookkeeping from the session's fields of the same names, the world through `worldToRows`, the transcript with the player's lines as `player:1`, the sheet from the player and the rules' status line), V0's endpoint runs on a stand-in told the same, and its calls are compared with the prototype's, in order, on one store (the opening writes the player's doc, which every later prompt reads).

| Call | Compared |
|---|---|
| `gm.opening`, `gm.reply` | the whole request, byte for byte (instructions, every input message, model, effort, token cap) |
| `world.stage` | the whole request, byte for byte (instructions, input, the schema of the world's ids) |
| `memory.disclose.*` | the whole request, byte for byte (each scope's state, every candidate's question) |
| `director.before`, `director.after` | the state byte for byte, and each question V0 asks equal to the prototype's of that id |

A reply's decision is V0's own, from its decide on the same turn; what the decide commit did (the roll and the move) is read off the prototype's session, so parity doesn't depend on V0's dice.

## Where V0 differs, and why

All of it pinned by the test.

- **The director asks fewer questions.** V0 has no considered rolls (`roll_call`, and `attempt_means` in every beat: V0 asks the means only when a route's check is social), no co-GM (`off_graph`) and no rules engine (`mechanic`; after the reply, `left`, `threat`, `threat_severity`). gm-port §6, §9. Every question V0 does ask is the prototype's to the letter, the limit with its `pretending` option included: with no ruling to send a bluff to, V0's GM plays it rather than refusing it as something the scene can't offer.
- **No notes on the GM's marks.** The prototype writes a note for each mark the GM drafts after the reply (`notes`, a model call) and keeps it on the entry, so the GM's own history shows `(phrase)[why: note]`. V0 drops the drafted marks (the GM's own words on them never reach the screen in either build), so a reply's markup has speech only, and its history has no marks. The golden replies have none, so the recorded prompts agree; [../parity.test.ts](../parity.test.ts) pins the difference on a reply that has one.
- **The dice.** The prototype rolls through its rules engine when there's a sheet; V0's simulation rolls its no-sheet `rollCheck` from the game's dice row, so the same seed rolls differently (v0-design §6.4). The prompts carry whatever was rolled.
