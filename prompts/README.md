# prompts: the models' standing instructions

Part of the [architecture overview](../ARCHITECTURE.md).

The system prompts for the GM, the narrator, the actors, the co-GM, the memory reviewers, the world scribe and the evals, one Markdown file each. A prompt is loaded by name and sent as a call's `instructions`; everything that changes from call to call (the scene's prep, the transcript, what was decided this turn) is built in code and sent as the input.

## What it is

Each file is the standing brief for one role: how the GM runs the table ([gm.md](gm.md)), the house style ([tone-comic.md](tone-comic.md)), how the co-GM steers a scene ([repair.md](repair.md)), what each memory reviewer looks for ([review/](review/)), and so on. The prompts are tuned by playtests and evals; each of the GM's principles is there because a playtest showed it was needed ([docs/guide/running.md](../docs/guide/running.md) says which). The scene-specific prep isn't here: it's the scenes' ([scenes/](../scenes/README.md)), turned into the GM's brief by [src/runtime/brief.ts](../src/runtime/brief.ts).

## What it owns

| Prompt | Loaded by | When |
|---|---|---|
| [gm.md](gm.md) | `gmReply`, [src/runtime/voices.ts](../src/runtime/voices.ts) | Every GM reply, opening, closing and talk in a `voice: "gm"` approach (`v2`). `{{tone}}` becomes tone-comic.md for an approach with `tone: "comic"`, and nothing otherwise. Its last part teaches the markup the screen reads: the speaker before each line, and why, know and you notes ([src/runtime/README.md](../src/runtime/README.md#the-gms-markup)). |
| [tone-comic.md](tone-comic.md) | gm.md's `{{tone}}` | `v2` and the comic approaches |
| [suggest.md](suggest.md) | `propose`, [src/runtime/suggest.ts](../src/runtime/suggest.ts) | After a GM reply in a scene of the story, with the game's suggested lines on: three to five lines the player might say or do next. Its brief (what the player knows, the prep behind the screen, what's not to come again) is built in code. No backticks: in Luna's instructions they cost 6 to 7 s before the first word. |
| [gm-markup.md](gm-markup.md) | `gmReply` (`nowNote`'s `remind`) | Every GM reply: a line on the markup, just before "For this reply", where a model attends most |
| [notes.md](notes.md) | `writeNotes`, [src/runtime/notes.ts](../src/runtime/notes.ts) | After every GM reply with a spoken line or a mark: the notes the player reads on the marks, written from what the player knows (never the prep), and a why added to each line where someone refuses, bristles or comes round for a reason they can see |
| [narrator.md](narrator.md) | `narratorReply`, voices.ts | The `actors` approaches: the narration between the characters |
| [actor.md](actor.md) | `actorReply`, voices.ts | The `actors` approaches: one call per speaking character, with their card as `{{name}}`, `{{short}}`, `{{look}}`, `{{voice}}`, `{{wants}}`, `{{fears}}`, `{{attitude}}`, `{{knows}}` and `{{secrets}}` |
| [repair.md](repair.md) | `runRepair`, [src/runtime/repair.ts](../src/runtime/repair.ts) | The full co-GM: in the background after a turn, or inside the turn for `blocking` and `stall` |
| [consider.md](consider.md) | `considerAct`, [src/runtime/consider.ts](../src/runtime/consider.ts) | The GM's review on a considered turn (`v2`): whether to roll, the judgements the DC comes from, and what success and failure each change. Its input is the whole prep and the scene so far; its answer is strict JSON with the scene's own ids. |
| [review/system.md](review/system.md) with [commitment.md](review/commitment.md), [relationship.md](review/relationship.md), [exchange.md](review/exchange.md), [witnessed.md](review/witnessed.md) (what someone present saw or heard for themselves, that they may need to tell or swear to later) | the personal-memories agent, [src/lore/reviews.ts](../src/lore/reviews.ts) | `memory: "docs"`, when the attention filter flags those categories |
| [review/system.md](review/system.md) with [improvised.md](review/improvised.md), [world.md](review/world.md), [focused.md](review/focused.md) | the world-facts agent, reviews.ts | `memory: "docs"`, when it flags an improvised detail or a lasting change (focused.md always comes with this agent) |
| [memory-review.md](memory-review.md), [memory-scene.md](memory-scene.md) | [src/lore/remember.ts](../src/lore/remember.ts) | `memory: "lite"`: a flagged turn, and a scene's end |
| [scribe.md](scribe.md) | [src/world/scribe.ts](../src/world/scribe.ts) | The world scribe's update scripts: `scene world` and the world eval suite |
| [judge.md](judge.md) | [src/eval/judge.ts](../src/eval/judge.ts) | The evals' judge, for single replies and for whole scenes |
| [player-sim.md](player-sim.md) | [src/eval/run.ts](../src/eval/run.ts) | The trajectory suite's simulated players, with `{{character}}` and `{{persona}}` |

## How it fits

`prompt(name, vars)` ([src/runtime/brief.ts:12](../src/runtime/brief.ts#L12)) is the only loader. It reads `prompts/<name>.md` once per process and keeps it (a file of the same name in `KM_PROMPTS_DIR` first, when that's set: a variant to compare in the evals), trims it, replaces each `{{key}}` with `vars[key]`, and closes up runs of blank lines. The runtime, src/lore, src/world and the evals all call it. In the static build the folder is bundled into `content.json` and read through the browser's stand-in for `node:fs` ([src/web/static/content.ts](../src/web/static/content.ts)).

Much of what the models are told isn't here. Written in the code instead:

- **the GM's brief and per-turn note:** `sceneBrief` and `nowNote` (src/runtime/brief.ts), and the directives that say what was decided (src/runtime/director.ts);
- **the decider's questions:** the director, disclosure and the attention filter (src/runtime/director.ts, src/lore);
- **the boundary:** the hand-off, the verdict and the fronts (`crossBoundary` and `moveOn` in src/runtime/engine.ts);
- **the quick co-GM** (src/runtime/repair.ts), **the stage manager** (src/world/stage.ts), **a talk's plan and lines** (src/runtime/talk.ts), and **the suggested lines' brief and judge** (src/runtime/suggest.ts);
- **the character sheet** (src/runtime/engine.ts, src/rules/dnd.ts), **the world judge** (src/eval/judge.ts), **the look inventions** (src/game/look/invent.ts) and **places from a plan** (src/game/map/generate).

## How it works

- **The GM's prompt is the cache's head.** gm.md is the `instructions` of every GM call, and the prep follows it. The prompt doesn't change from turn to turn, so the provider's prompt cache keeps the prefix ([src/runtime/README.md](../src/runtime/README.md), "What the GM sees").
- **Rules, not prep.** These prompts say how to play any scene: the GM's principles, the house style, what counts as a memory. Anything about one scene, place or person belongs in the scene or the lore.
- **The reviews are assembled.** An agent's instructions are review/system.md, then the prompt of each category it handles that was flagged (the world-facts agent always adds focused.md), and for the personal-memories agent one more line from the code. One review runs per agent, not per category.

## Where to look first

- **A prompt change changes every call that uses it,** in every scene. The evals are how it's checked, and the call logs show the exact prompt each call was sent.
- **Placeholders.** A `{{key}}` that isn't passed becomes an empty string without an error, so a renamed placeholder silently drops its text.
- **The markup is parsed.** gm.md's brackets (`[who]`, `(words)[why: …]`, `know`, `you`) are what src/runtime/markup.ts reads; the parser takes what the model drifts to as well, but a new token needs it there and in its tests. The GM's own notes aren't shown: notes.md writes the ones the player reads, from a brief built only of what they know, so what notes.md is sent must never grow a part of the prep. suggest.md's brief has the replies as the player reads them, never the markup, and a suggested line that comes back with any (anything in square brackets) isn't offered.
- **Words the code depends on.** The code tells the GM what was decided in directives, and gm.md says how to take them ("you'll be told the result: narrate it faithfully"). A prompt that contradicts a directive leaves the model to choose.
- **One line, one reason.** Many lines answer a failure seen in play. Before removing one, check the guide ([docs/guide/](../docs/guide/README.md)) or the findings ([docs/FINDINGS.md](../docs/FINDINGS.md)) for why it's there.

## How to test it

```sh
npm run eval -- --suite reply --approach v2 --samples 3   # single replies on fixture states, judged with judge.md
npm run eval -- --suite trajectory --approach v2          # simulated players (player-sim.md) through whole scenes
npm run eval -- --suite world --from runs/sessions        # the scribe's scripts for scenes that ended in recorded games, judged
npm run compare -- runs/evals/<before> runs/evals/<after>  # the same suite before and after a change
npm run scene -- start hanged-clerk --session p1          # a prompt in play: then read runs/sessions/p1/calls.jsonl
node --no-warnings src/eval/memory-eval.ts                # the review prompts: does someone remember, a scene later?
```

There are no unit tests: what a prompt does is only seen in a model's replies. How to read an eval, and when to trust one, is in [docs/guide/testing.md](../docs/guide/testing.md).

## Known gaps and sharp edges

- **Prompts are read once per process.** An edit reaches a running game only after a restart; each background job, in a process of its own, reads them fresh.
- **No versions.** Nothing records which prompts a game was played with, beyond their full text in its call log, so comparing an old game with a new one means diffing call logs.
- **This README is bundled** into the static build's `content.json` with the prompts, since the build takes every `.md` here.
