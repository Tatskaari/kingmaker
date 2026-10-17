# The town, live run, 2026-10-17

The town unit on real models ([town-design.md](../town-design.md)): the dev stack (`npm run dev -- --fresh`, SpacetimeDB and the module in namespace mode, the AI service on OpenRouter with the dev key from `~/secrets`), played through the headless client (`npm run play`) as a player plays it: the action menu on the map, the yard walked into, a line there, the yard ended as the owner, then two talks with Kell between scenes. The module was the branch at d464973 until the first talk was over, then republished (`p`, the data kept) with the fix the first talk showed was needed (3eedcaa, below) for the second.

| | |
|---|---|
| Character | Wren Ashdown: a hedge wizard who has read about fire extensively. The ready-made wizard (`--build wizard`): human wizard 3 (Evoker), sage |
| Model | openai/gpt-6-luna, the pipeline's, through OpenRouter |
| Requests | 40 to the AI service, each answered once: 76 model calls (36 of the model's, 40 of the decider's), no retry, no error |
| Cost | **$0.0350**, the sum of the AI service's request lines (its call log says $0.0347) |
| The key | Read by the stack from its file. In no log, output or record (each run folder scanned for anything shaped like a key) |

## How it went

| Step | What the player saw | Time and cost |
|---|---|---|
| `new --build wizard` | The map, the granary lane, morning; observe lists the action menu after ACTIONS | 0.9 s, nothing asked of a model |
| `act --id cast_fire-bolt@25,6` from the lane | "(Fire Bolt (cantrip): no clear line to there.)" (exit 1): the watch house's own wall and window are in the way. Nothing written | 0.5 s |
| `act --id walk@22,8` | "You walk 20 steps here." Up the street, outside the watch house | 0.6 s |
| `act --id cast_fire-bolt@25,6`, ten times | Nine misses (the d20 came up 6, 8, 9, 7, 7, 5, 7, 9, 7 against AC 15 at +5), then "Fire Bolt at the door of the watch house: 18 +5 = 23 vs AC 15: hit", "Damage: 1d10 (5) fire", "The door of the watch house takes 5 fire damage (scorched or dented)", "The door of the watch house catches fire", "Both palace guards shout at you to stop it.", "Pigeons run for it.", "A man up a ladder runs off shouting for the watch." | about 0.6 s each, the rules only: no model |
| `act --id go_to_lead` | "You walk 21 steps towards the granary yard." The hanged clerk's opening (below) and four lines | 6.9 s: the opening $0.0029 (5 calls), its notes $0.0005, its lines $0.0009 |
| A line: "(I hail the eel-seller pushing his barrow past the gate, and ask if he saw anything at first light)" | The eel-seller stops and answers; Kell writes it down (below). The stage manager made the eel-seller and his barrow, and each got a look of its own a moment after (`look.invent`): the eel-seller ☻ in teal (a being, of flesh), the barrow æ in oak (wood). Both are in `look_invention` now, so the next of either name has its look at once | 8.6 s: decide $0.0013, the reply $0.0022, notes $0.0005, lines $0.0009, settle $0.0009, **the looks $0.0003 (1.7 s, one call)**, the memory review $0.0017 |
| `end --exit open-case` | Kell reads the entry back ("Prout was murdered. The watch has it down as persons unknown."), the hand-off, and "The Drowned Rat, then." | 13.3 s: the boundary $0.0028 (4 calls) |
| `act --id talk_kell` (the first talk) | "A word with Sergeant Agnes Kell, between one thing and the next." Her greeting, and three lines (below). The prep kept back the deepest of her story (her note on Wendell Prout) for a later talk, and staged one thing she might tell: why she keeps letting Cob go, her guard at "torn" | 5.1 s: the open $0.0024 (3 calls: the greeting, `talk.sift`, `talk.plan`), its notes $0.0003 |
| `say_1`: "You’ve been a sergeant twenty years. What keeps you at it?" | Her reply, then four new lines from the settle (`talk.suggest`); no V5 suggest for a talk | 3.8 s: decide $0.0005, the reply $0.0011, settle $0.0004 (the guard's question and the lines) |
| `say_1`: "What would convince you the proper channels are worth trusting?" | Her reply and three new lines | 4.9 s: $0.0013 with its notes |
| `say_2`: "Why do you keep letting Cob throw stones at the dead?" | **She tells it** (below): her guard moved to "settled" on turn 3, and the AI service wrote her memory of telling it, once: "Told Wren about why she keeps letting Cob go" | 3.9 s: $0.0014 with its notes; the memory reviews behind it $0.0029 (23 s, in the background) |
| `say_goodbye`: "I'll leave you to it." | “Good night, investigator.” She resumes walking, pencil poised over the page. "— Scene ends: Goodbye for now —", then `out` back to the map, in the yard at evening, the lead the Drowned Rat. Kell's record: one talk, told "why she keeps letting Cob go" | 3.0 s: decide $0.0005, the reply $0.0003, no settle calls (the talk was over) |
| The module republished with the fix | | |
| `act --id talk_kell` (the second talk) | "Here: Sergeant Agnes Kell." Her greeting, “Evening, investigator.”, named as hers, and three lines | 6.4 s: the open $0.0025 |
| `say_1`: "Is there somewhere in Caerwyn you’d rather not set foot in?" | She tells the next thing: why the Drowned Rat's door still bothers her (below), with a note on the Rat from the lore | 4.0 s: $0.0021 with its notes; the memory review $0.0020 behind it |
| `walk_on` | Back on the map with no reply; the talk ended; the Drowned Rat still waiting, as it was. Kell's record: two talks, two things told | 0.6 s |

The yard's opening:

> The yard smells of wet grain, pigeons and river mud. A small grey-coated clerk turns slowly from the sack hoist above the shut loft door; a pigeon watches from the beam. Below, a scrawny boy in enormous black boots lobs gutter stones at the body. “Missed. Cob's warming up. That one was for the dead bloke's ears.” On the wall, a sharp-faced girl swears at him in Common, then adds something in a harsher dockside tongue.
>
> A sergeant steps away from the gate, notebook open. “Sergeant Agnes Kell. The Captain’s view is suicide. I haven’t signed it.” Her pencil taps once against the page. A stone clangs off the hoist hook. The body turns a little faster. “Oi! Aim for the pigeon, you daft lump!” The pigeon flaps up into the drizzle-grey air.

The line in the yard, and the eel-seller the GM made up:

> The eel-seller pauses his barrow in the lane, one hand on its creaking handle. He glances from you to the body, then to the sergeant.
>
> “At first light? Saw the porters come legging out, shouting for the watch. Didn’t see what happened before that. I was on the river road.”

The first talk's greeting, and what she told:

> Sergeant Kell stands beside the granary gate, making a careful note of the bent spectacles in the gutter. She closes the notebook and looks up as you come over.
>
> “Investigator.” She waits, pencil resting across the notebook.

> **Wren Ashdown:** Why do you keep letting Cob throw stones at the dead?
>
> Kell’s eyes flick to the boy’s oversized boots. She closes her notebook around the pencil.
>
> “I’ve taken him up twice for pilfering. Twice I let him go instead of sending him to the Mending House.” Her gaze stays on Cob. “He could still turn out well. With boots that fit and a hot dinner.”

The second talk:

> **Wren Ashdown:** Is there somewhere in Caerwyn you’d rather not set foot in?
>
> Kell’s pencil stops turning between her fingers. Her eyes shift briefly towards the river road.
>
> “The Drowned Rat.” A pause. “I haven’t been back in twenty years. Nan Quill threw me out the door, and the pickpocket I’d chased got away while I was picking myself up.” She puts the pencil away. “I’ve always said it was a matter of the rules.”

## What it shows

- The action menu's acts are the rules alone on the map: no model call, half a second a move through the headless client, the prototype's words for a refusal and for what the rules did, and the town reacting by its table.
- A talk plays as the prototype's does on real models: the prep stages one thing she might tell and holds the deepest back, the lines come with each settle, she tells it when it's asked for and never twice, her memory of telling it is written once, and the goodbye ends it through a reply. Walking on ends it with no reply. The waiting scene is untouched.
- The GM making something up gets it a look of its own, for a third of a cent, once a name.

## What it found

The first talk's lines came out "Sergeant Agnes Kell (not in the cast)", and "Nobody else is here": a talk had no on_stage rows, so the client couldn't name or colour its companion (on the fake, every voice in a talk was gold). Fixed in 3eedcaa (the companion's on_stage row moves into the talk; the client keeps an on-stage person's look wherever their entity is), and the second talk shows her named and here.
