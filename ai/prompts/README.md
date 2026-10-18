# ai/prompts: the models' standing instructions

Part of the [architecture overview](../../ARCHITECTURE.md), and of [ai/](../README.md): the AI service's prompts and their loader.

The system prompts for the GM (the two-part GM's mouthpiece and co-GM that play the story's scenes, and the old pipeline's GM that plays a talk), the old co-GM, the suggested lines and the memory reviewers, one Markdown file each, and some the prototype used that the game doesn't load yet (the narrator, the actors, the world scribe, the fights, the improvisation guide and the evals'). A prompt is loaded by name and sent as a call's `instructions`; everything that changes from call to call (the scene's prep, the transcript, what was decided this turn) is built in code and sent as the input.

## What it is

Each file is the standing brief for one role: how the GM runs the table ([gm.md](gm.md)), the house style ([tone-comic.md](tone-comic.md)), how the co-GM steers a scene ([repair.md](repair.md)), what each memory reviewer looks for ([review/](review/)), and so on. The prompts were tuned by the prototype's playtests and evals; each of the GM's principles is there because a playtest showed it was needed ([the prototype's running guide](../../docs/prototype/guide/running.md) says which). The scene-specific prep isn't here: it's the campaign's ([campaigns/caerwyn/scenes](../../campaigns/caerwyn/scenes/)), turned into the GM's brief by [gm/brief.ts](../gm/brief.ts).

## What it owns

| Prompt | Loaded by | When |
|---|---|---|
| [two-part-gm.md](two-part-gm.md) | `mouthpieceInstructions`, [gm/two-part.ts](../gm/two-part.ts) | The two-part GM's mouthpiece (docs/two-part-design.md): every reply, opening and closing of a scene of the story. The user's words, copied verbatim from PR #666 (`prompts/two-part-gm.md` at `origin/claude/two-part-gm` c749270): never edit them. `{{tone}}` is tone-comic.md, `{{beats}}` the prep rendered from the .kmscene, `{{characters}}` the cast cards; the code appends the reply format (JSON with the narration and a check) and gm.md's speaker paragraph. |
| [two-part-co-gm.md](two-part-co-gm.md) | `coGmInstructions`, [gm/two-part.ts](../gm/two-part.ts) | The two-part GM's co-GM, after each reply beside the stage manager: each person's role, and the scene's moves along its routes. The user's words, verbatim from the same commit: never edit them. The prep it's given adds each stage's suggested roles and each person's palette and clues; the code appends its tools section. |
| [gm.md](gm.md) | `gmReply`, [gm/voice.ts](../gm/voice.ts) | The old pipeline's GM: a talk's every reply and opening, and the aftermath of a fight. `{{tone}}` becomes tone-comic.md. Its last part teaches the markup the screen reads: the speaker before each line ([gm/markup.ts](../gm/markup.ts) reads it; the notes on marked words went in M2, and a mark a model writes anyway is taken out of the words). |
| [tone-comic.md](tone-comic.md) | gm.md's `{{tone}}` | The house style, in every GM call; the suggested lines' screen reads its words too ([gm/suggest.ts](../gm/suggest.ts)) |
| [suggest.md](suggest.md) | `propose`, [gm/suggest.ts](../gm/suggest.ts) | After a GM reply in a scene of the story, with the game's suggested lines on: three to five lines the player might say or do next. Its brief (what the player knows and nothing more, what's not to come again) is built in code. No backticks: in Luna's instructions they cost 6 to 7 s before the first word. |
| [gm-markup.md](gm-markup.md) | `gmReply` (`nowNote`'s `remind`) | The old pipeline's every reply: a line on the markup (the speaker tags), just before "For this reply", where a model attends most |
| [repair.md](repair.md) | `runRepair`, [gm/repair.ts](../gm/repair.ts) | The old pipeline's co-GM: in the background after a turn (`POST /v1/turns/repair`). No scene of the story asks it since M2 (the two-part GM's co-GM runs in the settle) |
| [memory-review.md](memory-review.md) | the notes review, [docs/reviews.ts](../docs/reviews.ts) | When the attention filter flags anything after a turn: the GM's notes on the people present brought up to date ([docs/notes.ts](../docs/notes.ts)), in one structured call whose updates each rewrite, take out or add a line. `{{parts}}` is the note's five parts with how many lines each holds (`partsText`). Third person, only what this moment brought, each thing once where it belongs, only what each person lived through, a witness's words that matter |
| [review/system.md](review/system.md) with [improvised.md](review/improvised.md), [world.md](review/world.md), [focused.md](review/focused.md) | the world-facts agent, reviews.ts | When it flags an improvised detail or a lasting change (focused.md always comes with this agent). People's notes are the notes review's, not this agent's |
| [gm-improv.md](gm-improv.md), [gm-improv-remind.md](gm-improv-remind.md) | nothing in the game yet | The improvisation guide (#661): the prototype's `v2` approach put it after gm.md, and the reminder before each reply's directives (`guide: "improv"`); neither the old pipeline's GM nor the two-part GM ([gm/](../gm/)) sends it |
| [narrator.md](narrator.md), [actor.md](actor.md) | nothing in the game | The prototype's `actors` approaches: the narration between the characters, and one call per speaking character with their card |
| [fight.md](fight.md) | nothing in the game yet | The prototype's fights: a line typed in a fight, read and answered (V13) |
| [scribe.md](scribe.md) | nothing in the game | The prototype's world scribe: a scene's update script |
| [judge.md](judge.md), [player-sim.md](player-sim.md) | nothing in the game | The prototype's evals: the judge, and the trajectory suite's simulated players |

## How it fits

`prompt(name, vars)` ([index.ts:26](index.ts#L26)) is the only loader. It reads `<name>.md` from its source once per process and keeps it, trims it, replaces each `{{key}}` with `vars[key]`, and closes up runs of blank lines. The source is this folder unless a host gives another (`configurePrompts`: a page's are in its `content.json`); the folder's (`folderPrompts`) is made when the first prompt is asked for, with a file of the same name in `KM_PROMPTS_DIR` first, when that's set (a variant to try). The GM pipeline and the docs service call it here. The page's server worker has no folder to read: its host hands it the prompts from the page's `content.json` ([hosts/web/content.ts](../../hosts/web/content.ts) puts them there).

Much of what the models are told isn't here. Written in the code instead:

- **the GM's brief and per-turn note:** `sceneBrief` and `nowNote` ([gm/brief.ts](../gm/brief.ts)), and the directives that say what was decided ([gm/directives.ts](../gm/directives.ts));
- **the decider's questions:** the director ([gm/director.ts](../gm/director.ts)), disclosure and the attention filter ([docs/](../docs/));
- **the boundary:** the hand-off, the verdict and the fronts ([gm/boundary.ts](../gm/boundary.ts));
- **the stage manager** ([gm/stage.ts](../gm/stage.ts)), **a talk's plan and lines** ([gm/talk.ts](../gm/talk.ts)), and **the suggested lines' brief and judge** ([gm/suggest.ts](../gm/suggest.ts));
- **the builds** ([rules/builds.ts](../rules/builds.ts)), **the backstory** ([docs/backstory.ts](../docs/backstory.ts)) and **the look inventions** ([look/invent.ts](../look/invent.ts)).

## How it works

- **The GM's prompt is the cache's head.** gm.md is the `instructions` of every GM call, and the prep follows it. The prompt doesn't change from turn to turn, so the provider's prompt cache keeps the prefix (the prototype's runtime README told it: "What the GM sees", in git history at `bc2ab1f`).
- **Rules, not prep.** These prompts say how to play any scene: the GM's principles, the house style, what counts as a memory. Anything about one scene, place or person belongs in the scene or the lore.
- **The reviews are assembled.** An agent's instructions are review/system.md, then the prompt of each category it handles that was flagged (the world-facts agent always adds focused.md), and for the personal-memories agent one more line from the code. One review runs per agent, not per category.

## Where to look first

- **A prompt change changes every call that uses it,** in every scene. Play on real models is how it's checked now (the prototype's evals went with it), and the call logs show the exact prompt each call was sent.
- **Placeholders.** A `{{key}}` that isn't passed becomes an empty string without an error, so a renamed placeholder silently drops its text.
- **The markup is parsed.** The speaker tag (`[who]`), which gm.md teaches and the two-part GM's instructions end with, is what [gm/markup.ts](../gm/markup.ts) reads; the parser takes what the model drifts to as well (and takes out a `(words)[why: …]`, `know` or `you` mark, the notes' markup until M2), but a new token needs it there and in its tests. suggest.md's brief has the replies as the player reads them, never the markup, and a suggested line that comes back with any (anything in square brackets) isn't offered. It's built only of what the player knows: given the prep "behind the screen", the suggestions put its answers in the player's mouth, so it must never grow a part of the prep either (its judge has the prep, as held).
- **Words the code depends on.** The code tells the GM what was decided in directives, and gm.md says how to take them ("you'll be told the result: narrate it faithfully"). A prompt that contradicts a directive leaves the model to choose.
- **One line, one reason.** Many lines answer a failure seen in play. Before removing one, check the prototype's guide ([docs/prototype/guide/](../../docs/prototype/guide/README.md)) or its findings ([docs/prototype/FINDINGS.md](../../docs/prototype/FINDINGS.md)) for why it's there.

## How to test it

```sh
npm test                                   # the parity tests hold the calls the prompts go into, byte for byte (ai/gm/golden)
npm run dev                                # then play (npm run client, npm run play), and read runs/dev/ai/games/<game>/calls.jsonl
npm run live -- --script v5                # a scripted run on real models, recorded in docs/live/ (hosts/dev/README.md)
```

There are no unit tests of what a prompt does: that's only seen in a model's replies. The prototype judged replies with evals (`npm run eval`, judge.md and player-sim.md; how to read one is in [the prototype's testing guide](../../docs/prototype/guide/testing.md)); they're in git history at `bc2ab1f`.

## Known gaps and sharp edges

- **Prompts are read once per process.** An edit reaches a running AI service only after a restart; the page's are its build's.
- **No versions.** Nothing records which prompts a game was played with, beyond their full text in its call log, so comparing an old game with a new one means diffing call logs.
- **The page's build takes every prompt here but this README** ([hosts/web/content.ts](../../hosts/web/content.ts)'s allowlist), so a new prompt reaches the page at its next build.
