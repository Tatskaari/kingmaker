# Sound: the game heard

The game's sound: its menus, its talk said Undertale's way, its dice, spells and blows, the world's changes, and music for each screen. Everything is made as it plays from a few building blocks, so nothing is a recording, and something the story invents gets a sound without anyone making one, as it gets a look (the look layer, [client/look](../client/look/): the AI can make anything without art). The sound plays on the game's page; the terminal client and the headless one are as quiet as they were.

## 1. What plays when

| When | What you hear | Made where |
|---|---|---|
| A menu's pick moves, one's chosen, a menu opens or goes, you back out | a tick, a two-note chime, a step down, a whoosh up or down | the screens and their models: [client/sound/cues.ts](../client/sound/cues.ts) `ui`, and what opens over a screen, by [attach.ts](../client/sound/attach.ts) |
| Something can't be done (a dimmed line chosen, a refusal) | a low double buzz | as above |
| A line said in a scene, the sheet or the notebook opened | a soft send; a page turned | as above |
| Walking into a wall on the map | a bump, as an old handheld's | `ExploreModel.walk` |
| The GM's reply streaming in | blips as the words come: the narration a soft tick, each person in their own voice | [scene.ts](../client/sound/scene.ts), [talker.ts](../client/sound/talker.ts), [voices.ts](../client/sound/voices.ts) |
| A talk's lines between scenes | each line said as it comes | `sayLine` from [ui/between.tsx](../client/ui/between.tsx) |
| The dice | a rattle; once they've settled, how a check went (made, missed, a natural 20's fanfare, a natural 1's "wah wah") | scene.ts |
| A scene opens, ends; The End | a harp's run up; a chord; a longer close | scene.ts, attach.ts |
| A spell in a scene or on the map | cast in its element, its flight, where it lands or its area's blast, each when its effect shows | [client/look/director.ts](../client/look/director.ts) `spellsFrom` |
| A blow in a scene | the swing, and the hit by its damage (or the miss) | `Director.rulesLines` |
| The world changing | fire catching, water, steam, something breaking, an explosion, someone falling, a puff | `Director.observe`: each kind once a turn, however many things it happened to |
| A fight | each beat as it plays on the board: a step, a blade's or a club's swing, a bow, a spell cast, flying and landing, a hit by its damage (a critical's crack and ring), a miss, a parry, a fall, someone running off; the start's sting; your turn's chime; won or lost at the end. A moment hurried past (Space, F) stops its sounds with its effects | [fight.ts](../client/sound/fight.ts) from `FightPlayer.enter` |
| The music | the title and making a character; the town by day, and by night; a scene's talk (sparse, under the voices); between scenes and a word with Kell; a fight; The End | attach.ts `moodOf`, by the screen that's up |

## 2. The engine

[client/sound/engine.ts](../client/sound/engine.ts) is told what to play and asked for its next block of samples. Its messages are small (a sound effect's name and what it needs to know, a blip's voice and letter, the music's mood, a hush, the volumes), so the client never sends audio, only words.

- **Parts** ([parts.ts](../client/sound/parts.ts)) are what every sound is made of: a tone (a wave at a pitch that can glide, wobble, shimmer or ring like a bell through a filter), a band of noise (hiss, a held grain, crackle) or a plucked string (Karplus-Strong: a lute's or a harp's note). Each has its envelope, its gain, its side and how much of it reaches the room.
- **The building blocks** ([dsp.ts](../client/sound/dsp.ts)): band-limited waves, a state-variable filter, the envelope, the plucked string and a small room (a cut-down Freeverb) the music and the spells ring in.
- **The recipes** ([patches.ts](../client/sound/patches.ts)): every sound effect as parts, from a seed, so no two dice rolls or sword blows are quite alike. Spells go by their element (fire roars and crackles, cold rings like glass, lightning cracks, thunder booms, acid and poison bubble, necrotic sinks, radiant chimes, force is a "pew", psychic warbles); a spell with no element sparkles.
- **Three buses,** each with its volume: the effects (the menus' too), the voices, the music. Everything is started on its sample, so a sound asked for 300 ms on lands with its effect; a hush stops a group (a talk's blips, a fight's moment): what's playing fades, what's still to come never comes.
- **The level a game is heard at.** The mix is brought up 12 dB into a look-ahead limiter (2 ms ahead, its ceiling at -1.5 dBFS), so a fireball over the music comes out quieter, not clipped. At the page's own volume the music sits about -20 LUFS (each mood within a couple of dB of the next: a style's `level` evens them), a voice about -17 (the narrator's -19), a menu's tick peaks about -14 dBFS and a spell's blast reaches the limiter. The first cut was 15 to 20 dB quieter than that (the music at -33 to -39 LUFS), and too quiet to hear (the user's report): it's measured now, by BS.1770's K-weighting, not by peaks.
- **Small speakers.** A laptop's give little below 200 Hz, so a voice's buzz always reaches past 1.8 kHz, the bass is a low-passed saw (its harmonics carry it where its fundamental can't), and the kick has a click.

## 3. The voices

A person's lines are said a blip a syllable, as Undertale says them: one on each word's first letter and every other letter after it, rising and falling with the letters, a breath at a comma and a pause at a sentence's end. The narration is a softer, lower tick, every third letter. The markup says who says each line, so a reply with Kell, Cob and Moll in it is heard in three voices and the narrator's.

- **A voice is worked out, not chosen** ([voices.ts](../client/sound/voices.ts)): from what the client knows of the speaker (the place's world: what they are, their size, what's said of them; what the player calls them) and their key. A creature sounds like one (a dog growls, a bird chirps); a person gets a register from the words said of them (a child's higher, a big one's lower, "she" and "he" leaning it up or down), then a pitch of their own in it. Someone the story brings in has a voice at once.
- **A person keeps their voice** all game: the one they were first heard in (a talk between scenes knows less of them than a scene's place).
- **The talk keeps up with the words** ([talker.ts](../client/sound/talker.ts)): it's never more than about a second behind them. A reply that comes all at once is begun (its first second or so said); one streaming in faster than it can be said is said from its newest words, where the eye is.

## 4. The music

The shipped web game plays the editable scores in [lore/Tunes](../lore/Tunes/README.md). These capture the instruments and timing of the original composer in [client/sound/music.ts](../client/sound/music.ts), which remains the fallback when no score is assigned. A mood names a style (a mode, a tempo and a band: a harp, a lute, a recorder, a pad, a drone, bells, a pulse bass, a chip lead, drums). The original composer generates endless seeded variations; the exported scores contain a finite intro, theme, bridge and return, with an editable loop. A change of score fades the last song over a second and a half and starts the next after a breath.

| Mood | When | How it goes |
|---|---|---|
| title | the title, making a character | D Dorian, 76 bpm: a harp's broken chords, a recorder, a pad |
| town | the map by day | G Mixolydian, 100 bpm, swung: a lute's oom-pah and a recorder |
| night | the map, and scenes, in the evening and at night | A minor, 62 bpm: a drone, a harp now and then, bells |
| scene | a scene's talk | A Dorian, 66 bpm: sparse and low, so the voices sit on top |
| between | between scenes, a word with Kell | D Dorian, 70 bpm: a harp and bells |
| fight | a fight, until its last moment has played | E Phrygian, 138 bpm: a pumping bass, drums, a chip tune, lute stabs |
| end | The End | F Lydian, 72 bpm: warm and wide |

## 5. On the page

- **The audio thread.** The engine runs in an AudioWorklet ([web/page/sound-worklet.ts](../web/page/sound-worklet.ts), bundled as `sound-worklet.js`), off the page's thread. The client worker says what to play (`{type: "sound", messages}`), the transport hands it to the page's sound ([web/page/sound.ts](../web/page/sound.ts), `sound.js`), and that posts it to the worklet. The page does no audio work itself.
- **From the first key or click:** a browser plays nothing before the player has done something on the page, so the audio starts then. The effects asked for before go unheard; the music waits, and starts in the mood it was last asked for.
- **The bar under the game** turns the sound effects, the voices and the music on and off, and its slider sets the volume, from nothing to half again over the game's own level (100%), each kept in this browser (localStorage, `kingmaker.sound`). With all three off, or the volume at nothing, the audio stops altogether. A tab out of sight is quiet until it's back.
- `km.sound` (the console, and the browser check): what's on, whether the audio runs, and how many of each kind the client worker has asked for.

## 6. The sound board

The zoo's menu (`z` on the title, `?zoo` on the page) has the sound board after its exhibits: every sound the game makes by kind, each played as it's chosen, a range of voices saying one of Kell's lines, and the music in each mood (held until you leave the board). It's the place to listen to a sound on its own, or to try a new one.

## 7. Adding a sound

1. A sound effect: its name in `SFX` and its recipe in `patchOf` ([patches.ts](../client/sound/patches.ts)), parts with the short helpers there (`tone`, `noise`, `pluck`, `bell`).
2. Where it plays: `sfx(name, what it needs, { delay, group })` ([cues.ts](../client/sound/cues.ts)) where the game knows it happened: a model's method, the director, a fight's beat. A menu's own sounds are `ui(...)`.
3. A line on the sound board ([board.ts](../client/sound/board.ts)).
4. The engine's test plays every sound effect and holds it to being heard, under full scale and over within a few seconds ([engine.test.ts](../client/sound/engine.test.ts)).

A new mood is a style in `STYLES` ([music.ts](../client/sound/music.ts)), a line in `moodOf` ([attach.ts](../client/sound/attach.ts)) and one in `MOOD_WORDS` (board.ts).

## 8. Checked by

- `client/sound/*.test.ts`: the engine offline (every sound effect and every mood heard, under full scale, over in time; a seed's sound the same; a hush; a bus turned down), the talk's timing, voices, what a scene says (its chime, a streaming reply in the narrator's and a person's voice, the dice and how a check went, its end), a fight's beats, and the music for each screen.
- `npm run web:check`, in the zoo's ring: the fight's music and blows reach the page, its audio runs from the keys pressed, the bar's Music turns the music off (kept) and on again, and its slider sets the volume (kept), the audio stopping at nothing.

## 9. Not yet

- **No sound in a terminal** (the user's call: it's the page's).
- **No footsteps on the map,** no doors creaking, no weather or crowd ambience; a fight's steps are its only footsteps.
- **The story's fights** (V12) will be heard as the zoo's are, since they'll play on the same screen.

## 10. Authored music and the Obsidian sequencer

A `.kmtune` score is versioned JSON scheduled one beat at a time by [tune.ts](../client/sound/tune.ts), with section repeats and optional arrangement loops. The game loads its music from `lore/Tunes` at build time. `catalog.json` maps the seven default moods to score IDs; its `cues` object is empty. Menu clicks, dice, spells, weapons and other sound effects keep their procedural recipes in [patches.ts](../client/sound/patches.ts), including their random variation and game-driven duration, count and size. Speech remains driven by the character and text. The sequencer and exported library are for music.

`npm run build:web` and `npm run build:site` use the repository's library by default. Pass `-- --tunes ~/git/kingmaker/lore/Tunes` to build directly from the Obsidian vault. Rebuild after editing; scores are validated and embedded in the audio worklet, not fetched from a user's filesystem by the browser. Missing optional mood mappings use the original composer; broken score references fail the build.

Scenes and maps have music slots for morning, afternoon, evening, night, next morning and combat. The Kingmaker Authoring plugin supplies tune dropdowns. The build reads the sibling `lore/Game` documents' assignments by scene/map ID; a scene's assignment takes priority over the map, then the usual mood applies. Next morning inherits morning if unset. A change of time or location can change scores even when the mood stays the same. The editable current-game copies under `lore/Game` keep the same IDs as the campaign; older vault documents are untouched.

[Kingmaker Tunes](../tools/kmtune/README.md) is a local Obsidian plugin for composing these scores: piano-roll notes, reusable sections, arrangement order and repeat counts, loop ranges, a drum-kit track with kick/snare/hi-hat lanes, custom layered instrument recipes, and preview through the same AudioWorklet. Root/scale selectors constrain new notes and pitch edits while preserving existing notes. Its README covers installation, controls, limits and the file format. `npm run export:tunes -- /path/to/new/Tunes` recreates the seven original music captures and refuses to overwrite existing work. [Lanterns](../assets/music/lanterns.example.kmtune) is a small example with an intro played once and a repeated chorus loop.
