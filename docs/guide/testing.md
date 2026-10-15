# Testing: evals as flags, transcripts as truth

**The steer:** "use the eval to flag things to you but look at the results yourself. I'm not looking to fit to an eval." Every number here is a flag that says where to read. The judgement comes from reading transcripts.

## Instruments

| instrument | what it's for | how |
|---|---|---|
| Blind QA | how play actually feels: tangents, fun, consistency, the things nobody thought to test | Claude players play through the CLI from a frozen worktree, never see the prep, and return structured reports. Personas: absurd, rough, straight, trickster, pedant. A round is about four players. |
| Reply cases | one moment, many samples: did the reply do the right thing? | Pinned to a snapshot from a real session (`evals/fixtures/`), with the player's actual input and an outcome-phrased criterion. `npm run eval -- --suite reply --case <prefix>` |
| Decision cases | the decider's classifications (attempts, pressure, flags) | Labelled inputs with acceptable choices. Compare Luna decisions and Jev. `--suite decision` |
| Trajectories | a simulated player plays a whole scene | Luna player-sim with a persona. They are milder than real players, so use them for volume and blind QA for edge cases. `--suite trajectory` |
| Memory eval | recall across chained scenes | Scripted turns, forced endings, then probes judged against the full transcript. `node --no-warnings src/eval/memory-eval.ts` |

## How to read a result

- **Read the failing replies, and some passing ones.** The judge is often stricter than a player would be, for example by failing a reply that omitted half of a two-part event. Sometimes the probe itself is flawed: a "Hobb couldn't know" probe while the witness is in the room.
- **Separate noise from signal.** With 2–3 samples a case, ±3/20 is noise. A change that moves a whole family of cases, such as all the spurious rolls disappearing, is signal.
- **Trace a failure to where it started.** `calls.jsonl` holds every model call and what it saw. `status` shows the beat path, rolls, co-GM notes and latency. `scene memories <session>` shows the docs. Most "GM failures" started elsewhere: a co-GM note that set terms, a roll at 0.46 confidence, a memory never written.
- **Fix the cause, generally.** Prefer a runtime change or a principle over prompt wording that matches the case. Write the fix so it would help a scene nobody has written yet.
- **Hold some out.** Develop on some moments and check on held-out scenes and personas (absurd QA round 2 was held out from round 1).

## Investigating a player's report (for Claude)

When the user says "report <file>", they've hit a problem in the game and reported it (b, `/report`, or the Esc menu's Report a problem…). The file has what they said, where they were, the screen as it was, and the game's saves, snapshots, model calls and notes (src/cli/README.md). In the static build it's downloaded instead, to ~/Downloads, where the tool also looks.

1. **Read it:** `npm run report -- inspect <file>`. Start from their words and the screen as it was, then the turn it happened in: the player's line, the decider's answers, the rules, the GM's reply, the stage manager's operations and what came of them.
2. **Find where it started,** as above: `--call <n>` for exactly what a model was told and said, `--diff <turn>` for what the world did, `--snapshot <turn>` for the scene as it stood, `--errors` for the stacks.
3. **Reproduce it:** `npm run report -- restore <file>` makes its game a new session, as it was reported. Play on with `npm run qa -- observe --session <id>`, `qa say`, `qa act`.
4. **Fix the cause,** generally, and keep the moment as a case (below: `--snapshot <turn> --raw` is a fixture). Say what you found in the report and what you changed, and which turn and call showed it.

## Turning a failure into a case

1. Find the turn before the failure: the session's `snapshots/<scene>-turn-NNN.json`.
2. Copy it into `evals/fixtures/<topic>/`.
3. Write a reply case with the player's actual input and a criterion that says what a good reply does. Phrase it as an outcome, and make it fail stalling or withholding as well as the failure you saw.
4. Run it before and after the change, then read both.
