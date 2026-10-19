# Kingmaker music library

Open a `.kmtune` in Obsidian with Kingmaker Tunes enabled to edit its sections, instrument tracks, notes and arrangement. These scores are the game's music library. `catalog.json` maps the game's seven default music moods to files here; file identifiers omit `.kmtune` and are relative to this folder.

## Music

| File | Original use | Original key | Original tempo |
| --- | --- | --- | --- |
| `title.kmtune` | Title screen | D Dorian | 76 |
| `town.kmtune` | Town by day | G Mixolydian | 100 |
| `night.kmtune` | Town at night | A minor | 62 |
| `scene.kmtune` | Conversation | A Dorian | 66 |
| `between.kmtune` | Between scenes | D Dorian | 70 |
| `fight.kmtune` | Combat | E Phrygian | 138 |
| `end.kmtune` | Ending | F Lydian | 72 |

Each score contains four sections captured from the original composer: **Intro**, **Theme**, **Bridge**, and **Return**. The intro plays once; the other three sections loop. The original music generated fresh variations indefinitely. A file is a finite, editable arrangement, so this export captures one deterministic passage from each mood rather than every possible variation. The original instrument layers, dynamics, pan, envelopes, swing and humanised timings are retained.

Instrument tracks include harp, lute, flute, chip, bell, warm bass, pulse bass, pad, drone and a drum kit. Where a section uses drums, they share one sequencer with separate kick, snare and hi-hat lanes. The original kick's thump and click are grouped in one note. Exported notes carry their exact synthesiser recipes; the track instrument supplies the sound for newly added notes. To change the timbre of existing exported notes, use the editor's recipe controls or replace their preserved recipes with the selected preset.

## Sound effects

The sequencer is for music. Menu clicks, dice, story cues, weapons, spells and other game effects remain procedural in `client/sound/patches.ts`, retaining their variation and responses to the game's timing, counts and sizes. The catalog's `cues` object stays empty. Character speech remains generated from the character's voice and spoken text.

## Re-exporting

From the repository root:

```sh
node --import tsx tools/kmtune/export.ts /path/to/new/Tunes
node --import tsx --test tools/kmtune/export.test.ts
```

The exporter refuses to overwrite any existing score or catalog. An explicit `--force` discards edits and regenerates the original captures; use a new directory to compare them safely. It does not run during a normal game or plugin build.

The capture seed is `hashOf("kingmaker:tunes:v1:" + id)`, where `id` is the music mood. These files began as captures from `client/sound/music.ts` and can include later composition edits. Tests compare freshly generated exports, including the combined drum kit, against the source recipes and timings; they do not require authored scores to match the originals. Exporting creates seven music scores and their catalog.
