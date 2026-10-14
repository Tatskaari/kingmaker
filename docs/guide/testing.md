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

## Turning a failure into a case

1. Find the turn before the failure: the session's `snapshots/<scene>-turn-NNN.json`.
2. Copy it into `evals/fixtures/<topic>/`.
3. Write a reply case with the player's actual input and a criterion that says what a good reply does. Phrase it as an outcome, and make it fail stalling or withholding as well as the failure you saw.
4. Run it before and after the change, then read both.
