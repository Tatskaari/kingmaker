# Kingmaker Tunes for Obsidian

A piano-roll and drum-sequencer editor for `.kmtune` files. Reusable sections hold tracks and notes; an arrangement specifies their order and repeat counts. Tracks reference named instruments in the engine; scores contain musical data, not copies of synth definitions. Preview uses the game's AudioWorklet, instruments, mixer and effects.

## Install

From the Kingmaker repository root (Node and npm as required by the game):

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix tools/kmtune
npm run build:kmtune
```

Copy the **whole** `dist/kingmaker-tunes` directory into `<vault>/.obsidian/plugins/kingmaker-tunes`. It contains `manifest.json`, `main.js`, `styles.css`, and `sound-worklet.js` (all four are required). Reload Obsidian and enable **Kingmaker Tunes** in Community plugins. This is a local desktop plugin, not a published community-directory entry.

With Kingmaker Authoring installed, right-click a folder and choose **Kingmaker → New tune** to name a score in that folder.

For a separate lore vault, run `npm run prepare:music-vault -- /path/to/lore` from the repository root. This creates local `Game/` and `Tunes/` copies only for missing files; it never overwrites saved compositions or campaign edits. `Game/` is ignored by Git and is not another campaign source.

Run **Kingmaker Tunes: Create tune** from the command palette, or open an existing `.kmtune` in the vault. The game’s seven exported music arrangements are in `lore/Tunes/`. Game sound effects remain procedural and are separate from the music editor. `assets/music/lanterns.example.kmtune` is also a small example.

## Compose

- **Sections:** add, rename, set the bar length, or duplicate a section to make a variation. Editing a section changes every occurrence. A section used in the arrangement cannot be deleted until its entries are removed.
- **Arrangement:** click a block or its **Edit section** button to edit that section in the piano roll and inspector. The active block is outlined. Type directly into its name field to rename the shared section (all occurrences update). **Use section** chooses a different existing section for that block. Add the selected section, set each entry's repeat count, and reorder entries with the arrows. A count of 3 means three total plays, not an initial play plus three more.
- **Loop:** optionally choose inclusive arrangement row numbers. The earlier rows play once; the selected range then repeats forever, including the repeat counts inside it. Rows after the loop are not reached. Reordering retains the row positions of the loop; removing an entry disables it.
- **Tracks:** click **+ Track** and choose harp, lute, flute, chip, bell, warm bass, pulse bass, pad, drone or drum kit. The new track is named for its instrument and selected automatically; click a track in the left panel to choose where notes are added. Each track has an **Instrument** dropdown and a visible **Delete** button (Undo restores it). Changing the instrument preserves its notes and custom track name. Choosing a different preset replaces any imported note recipes so the new instrument takes effect; Undo restores the originals. The inspector also offers Delete, volume, pan and an instrument selector. Adding an empty track leaves playback running. Mute and solo affect the selected section's preview only and are not saved in the score.
- **Draw notes:** drag empty space to create a note at the length you choose. Its start and end snap to the grid; its pitch stays on the starting row and follows the chosen scale. Drag either direction; a click makes a one-snap note. The preview commits on release as one undo step; Escape cancels it. Drag existing notes to move them or their right edges to resize. A single selected note also has numeric pitch, start, duration and velocity controls.
- **Box select:** drag a rectangle around notes on the current track, then move, resize, copy/paste or delete the group together. Shift-drag adds to the selection; Shift-click toggles a note. Selection alone never changes the score or clears Redo. Delete/Backspace removes the selection; Ctrl/Cmd+A selects all, Ctrl/Cmd+C/V copies/pastes, and Escape clears the selection or cancels a drag. Relative timing and custom sound recipes are preserved when copying a group.
- **Drums:** choose **Drum kit** for one sequencer with labelled Kick, Snare and Hi-hat rows. Draw hits on each row and box-select patterns across rows. Moving a hit vertically changes its drum sound; velocity controls its strength. Existing separate percussion tracks can be combined with **Merge drum tracks**, preserving their patterns, volume, pan and exact sounds. Legacy single-drum files still open. Kick includes both the low thump and click from the game.
- **Root and scale:** select a root note and scale beside Snap. **All notes** is the chromatic default; major, minor, Dorian, Mixolydian, Phrygian, Lydian and major pentatonic are available. Out-of-scale rows are dimmed. Clicks, drags, pasted notes and numeric pitch edits snap to the selected scale. Changing the scale leaves existing notes unchanged, so imported tunes retain deliberate accidentals. The root and scale save with the score and do not affect drums.
- **Legacy custom files:** existing custom synth tracks can still layer tone, noise and plucked-string voices. New tracks use engine presets. Expand **Track sound** to edit their waveform/filter, frequency, gain, room and envelope or add/remove voices. **Full sound recipe** exposes every synth parameter as validated JSON, including glide, FM, vibrato, filter sweeps, stereo position and delayed voices. The shipped music uses engine presets. Pitch and length edits use each preset’s normal behavior, including natural harp/bell decay, rather than stretching a frozen synth recipe. Inline recipes remain supported when opening legacy files; select such a note and expand **Note sound** to edit it, or **Use track sound** to use its track’s preset. Changing a recipe’s reference pitch or duration changes how it follows the note; ordinary pitch, duration and tempo edits transpose/stretch it automatically.
- **Layout:** sections and tracks are on the left, the arrangement and piano roll are in the centre, and score/section/instrument settings are in the right inspector. Narrow panes move the inspector below the workspace. Colours follow your Obsidian theme.
- **Navigation:** scroll the piano roll; use Zoom to change the horizontal scale. The bar ruler stays visible while scrolling; change its lowest MIDI pitch to reach other octaves. Snap can be one beat, half a beat or a quarter beat. C4 is MIDI 60.
- **Preview:** play the arrangement or loop the selected section. Stop ends playback. **Space** starts/stops playback in the focused sequencer, using the last section/arrangement mode (section playback initially); it does not intercept typing in fields. Adding, moving, resizing, deleting and editing notes updates upcoming playback in place, including Undo/Redo, without resetting the playhead. Notes already sounding finish their natural tails. Adding an empty track also keeps playback running; tempo, section-length and arrangement edits stop it. Notes use the game's natural instrument envelopes: harp, lute and bell ring out rather than being hard-cut at the end of the rectangle.
- **Saving and history:** edits save automatically through Obsidian's text-file view. **Ctrl/Cmd+Z** undoes; **Ctrl/Cmd+Shift+Z** or **Ctrl/Cmd+Y** redoes. History restores the edited section, track and selection, and ignores selection-only clicks. The toolbar Undo also handles an unfinished field edit in one click. Text fields retain their own native typing undo. Autosave acknowledgements keep history; reopening a file or accepting a genuine external file change starts a new history. Invalid edits are rejected. Malformed files are displayed as an error and are not replaced; fix their JSON externally and reopen.

## Use a tune in the game

The game reads `lore/Tunes/` when it builds. Add scores there and rebuild with `npm run build:web` or `npm run build:site`. To build against another vault, pass `--tunes /path/to/lore/Tunes` to either command. The build validates the scores and embeds them in the audio worklet; a running build does not watch the folder, so rebuild after saving changes.

`Tunes/catalog.json` maps the seven default moods (`title`, `town`, `night`, `scene`, `between`, `fight`, `end`) to tune paths without their `.kmtune` extension. Its `cues` map is empty: menu clicks, dice, weapons, spells and other sound effects keep using the game’s procedural sound system.

Scenes and maps can choose music for each time of day and for combat in the Kingmaker authoring editor. Assignments live in the existing `campaigns/caerwyn/scenes/` and `maps/` files. When building against a separate vault, an optional sibling `Game/` folder supplies local assignment overrides by scene/map ID. Leaving an assignment empty uses the relevant default music. The menu’s background music uses the `title` mood; its individual clicks and chimes remain game sound effects.
The game keeps its usual music volume switch and fades on mood changes. Without a loop, an authored score ends after its last arrangement entry and remains quiet until the mood changes. These files are scores, not audio recordings; no downloads or external synth libraries are used.

## Format v1

`.kmtune` is UTF-8 JSON with `version: 1`, `title`, `bpm`, `beats` per bar, `sections`, `arrangement`, and optional `loop` and `key`. This replaces the early line-based sketch with explicit positions for chords and overlapping notes.

- A section has a stable `id`, display `name`, `bars`, and `tracks`.
- A track has a `name`, `instrument`, `gain` (0–1), `pan` (-1–1), and `notes`.
- A note has `at` (beats from section start), `midi` (21–108), `duration` (beats), and `velocity` (0–1), with optional `pan` (-1–1, added to track pan). A sounding note can continue across a section boundary. Ordinary notes are written one per line for readable diffs.
- Legacy or explicitly custom tracks/notes may include a `patch` (never emitted by the music exporter): `{ "midi": 60, "duration": 1, "beatMs": 625, "parts": [...] }`. Each part is a fully validated tone, noise or pluck recipe from the game’s synth. Note patches override track patches. The reference pitch/duration and optional reference beat length let the recipe follow edits without losing its original timbre. Track gain, note velocity and track pan still apply.
- `key` is `{ "root": 2, "scale": "dorian" }`, using pitch classes 0–11 (C–B). It guides editing, without changing playback of existing notes.
- An arrangement entry is `{ "section": "intro", "repeats": 2 }`.
- `loop` is `{ "from": 1, "to": 2 }`, with **zero-based**, inclusive arrangement indices. The UI displays one-based row numbers.

The parser rejects unknown versions, missing references, non-finite or out-of-range values, notes starting outside their sections, and excessive score sizes. Sections allow up to 64 bars and 16 tracks; repeat counts are 1–99. Preview controls such as mute, solo, selection and zoom are not stored. Audio import, MIDI input and automation lanes are not included. A drum-kit track uses `instrument: "drums"`, with MIDI 36 for kick, 38 for snare and 42 for hi-hat.

## Check

```sh
npm run check:kmtune
node --import tsx --test client/sound/*.test.ts
npm run typecheck
npm run build:web
```

The browser test needs Playwright Chromium (`npx playwright install chromium` if absent). It checks section and arrangement editing, repeats, loops, note creation/movement/resizing, copy/paste, undo/redo, file reload, invalid edits, actual AudioWorklet playback of layered recipes, percussion editing, instrument replacement, root/scale constraints, and disposal. It writes `dist/kmtune-check/editor.png`. The wrapper is typechecked against the [official Obsidian API](https://github.com/obsidianmd/obsidian-api); a live Obsidian vault is still needed to verify host-specific behaviour.
