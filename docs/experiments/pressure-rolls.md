# Pressure rolls: making the player earn a secret

**The steer.** Flag when the player is applying pressure, and make sure the GM makes them roll for it. The roll difficulty should depend on how valuable the information is and how well the player is roleplaying.

**Status.** Built and checked at the decision level and in a live smoke test. It isn't yet validated over whole scenes or with blind players. It's opt-in as `v2-pressure`.

## The model

The model comes from [research/dc-guidance.md](../research/dc-guidance.md), which draws on 5e 2014/2024, the Angry GM, the Alexandrian, Sly Flourish, Blades, PF2e, Dungeon World, Draw Steel, Ironsworn and GUMSHOE. The sources agree on four things:
- Roll only when the outcome is uncertain and failure costs something.
- Difficulty comes from the world: what telling costs the holder, and how they feel about the asker.
- Good play shifts the odds, and a good enough case wins with no roll.
- Failure is a "no, but", not a wall.

The ruling, in [director.ts](../../src/runtime/director.ts) (`pressureRuling`):

```
free, or trivial stakes                         → yes, no roll
no_chance, or the same push after a failed roll → no roll: they hold; their own concerns show
gap = stakes(guarded 1, dangerous 2, ruinous 3) − approach(weak −1 … excellent +2) − disposition(hostile −1 … friendly +1)
gap ≤ 0 → yes     gap 1/2/3 → roll at DC 12/15/18     gap ≥ 4 → no roll ("not like this")
```

Several other rules sit around the ruling:
- **Success rides.** A follow-up after a won secret gets no roll.
- **Bands.** "Yes, and" means beating the DC by 5 or more, or a natural 20. "No, but" means missing by 1–4. "No, and" means missing by 5 or more, or a natural 1. Each band has its own direction for the GM.
- **Method costs.** Intimidation or deception that works leaves the person cooler towards the player.
- **The scene stays winnable.** Nothing already said is taken back, and a secret the scene needs stays reachable.
- **The dice line explains itself.** It carries a player-facing gloss, for example `Persuasion check to talk Moll into telling you what they're holding back (dangerous to admit; your leverage helps)`.
- **Authored routes take precedence.** Pressure only covers what no authored route does.

**The decision calls.**
- The main pre-reply decision asks only *who* is being pressed, if anyone.
- When someone is, a second call asks for means, approach, disposition, stakes and (after a failed roll) whether this is a new angle. That call costs about 0.5–1 s, and only on those turns.

## Decision suite: 12 cases in `src/eval/cases/pressure.ts`

| | Luna decisions | Jev |
|---|---|---|
| accuracy | **92%** | 75–83% |
| typical error | none, apart from a borderline authored-route pick (`persuade-tull`), which Jev also makes | rolls when Kell would tell anyone who asked; reads Pip's appeal as `yes` |

Luna's judgements were conservative: plausible, guarded, wary. Jev's ran higher: strong, dangerous. Most pressure-shaped turns in hanged-clerk hit authored routes first (`catch-moll`, `win-cob`, `scare-kids`). That's by design: pressure covers the gaps, as in warren-hostage and green-standoff.

**Latency.** Luna's decision API was slower today than earlier in the week: 0.5–1.4 s per call, against 0.2–0.35 s before. A same-input A/B showed the pressure question adds nothing measurable to the main call. Jev ran at about 0.3–0.6 s.

## Open

- Whole-scene and blind QA validation: is the yes / no / roll mix right, and does leverage feel rewarded?
- Authoring `stakes` and an `ask` per secret, so a holder with four secrets (Cob) keeps them apart and the dice line can name the question.
- Whether authored social routes should take the same ±3 steps for leverage and disposition.
