# src/runtime: the scene runtime

Part of the [architecture overview](../../ARCHITECTURE.md).

The engine that plays a scene: the player's line goes in, the GM's reply comes out, and the session's state keeps up. Everything the player meets in a scene goes through here, in the terminal app, the browser build, the QA console, the zoo and the evals.

```sh
npm run scene -- start hanged-clerk --session demo    # a scene in the terminal (approach v2): the sheet, then the opening
npm run scene -- say demo '(I look up at the body) Who found him?'
npm run scene -- status demo                          # the beat, the path, the co-GM's notes, latency and cost
```

Live runs need `OPENROUTER_API_KEY` (or `~/secrets/kingmaker-dev-openrouter.txt`). Why each mechanism exists is in [docs/guide/running.md](../../docs/guide/running.md). Where the runtime is going (a flattened `playerTurn`, a model client behind the calls, the session split into documents) is in [docs/design/productionise.md](../../docs/design/productionise.md).

## What it is

A session plays one authored scene at a time ([scenes/](../../scenes/README.md)). Each turn, the director asks a fast decider what the player is attempting and, after the reply, what has happened. The D&D rules ([src/rules](../rules/)) and the scene's world ([src/world](../world/)) settle what's theirs to settle: checks, spells, blows, fire. The GM voice narrates the result from a brief built from the scene's prep and from what people remember ([src/lore](../lore/README.md)). The session records the beat, the rolls, the transcript and what is still pending. Between turns a co-GM reviews the scene and patches the prep where play has left it. When a scene ends, the runtime crosses the boundary: it writes the hand-off, checks the coming scenes against what happened, rewrites the next opening and moves the world's fronts on. How all this is run (one voice or actors, which decider, when the co-GM runs, memory or not) is an approach, a preset in [approaches.ts](approaches.ts).

## What it owns

| File | What's in it |
|---|---|
| [engine.ts](engine.ts) | The turn pipeline: `createSession`, `openScene`, `playerTurn`, `resumeAfterFight`, `forceEnding` and `chainScene`. The boundary (`crossBoundary`, `moveOn`, `boundaryPreview`), the zoo's hub scenes (`openHubScene`, `closeHubScene`), and reactions to violence (`violence`, `witnessesOf`, `react`). |
| [director.ts](director.ts) | What the decider is asked before the reply (`decideBefore`) and after it (`decideAfter`). The follow-up calls (a spell's or blow's details, a jump, a freeform roll, pressure), `decideReactions`, `decideNextSpeaker` for actors, and the directives that tell the GM what was decided. |
| [voices.ts](voices.ts) | The GM (`gmReply`), the narrator and the actors (`narratorReply`, `actorReply`), and the guard against repeated sentences. `readReply` reads a reply's markup once it's whole. |
| [markup.ts](markup.ts), [speakers.ts](speakers.ts), [knowledge.ts](knowledge.ts) | The GM's markup ([below](#the-gms-markup)): the parser (`parseMarkup`, as the reply streams and once it's whole), who says each line (`withSpeakers`, from the GM's tags or the prose, as the look's barks find them), and what the player knows (`knowledgeBrief` for the GM; `linkMarks`, `unheardNames` and `knowledgeCard` for the marks and their popover). |
| [brief.ts](brief.ts) | What the GM is shown: the stable prep (`sceneBrief`) and the per-turn note (`nowNote`). Also the scene as play has it (`effectiveScene`: the authored scene, the co-GM's patches and "an ending of their own"), who is present, whose names the player hasn't heard, and the prompt loader (`prompt`). |
| [scene.ts](scene.ts) | The Scene format's types, and `validateScene`. The scenes themselves are in [scenes/](../../scenes/README.md). |
| [session.ts](session.ts) | `SessionState` and its files: `saveSession`, `snapshotSession`, `loadSession`. |
| [approaches.ts](approaches.ts) | The 27 approaches (`v2` is the game's), and `sceneApproach`, which applies a scene's own overrides. |
| [repair.ts](repair.ts) | The co-GM: the full review (`runRepair`) and the quick one (`quickRepair`), and how their notes, whispers and patches apply. |
| [background.ts](background.ts), [jobs.ts](jobs.ts) | The work after each turn (the memory review and the co-GM's review). `afterTurn` starts it, and jobs.ts is what it runs. |
| [talk.ts](talk.ts) | Talks with a companion between scenes. |
| [dice.ts](dice.ts) | The seeded RNG and d20 checks, shared with the rules and the world. |

**State.** One `SessionState` per game ([session.ts:135](session.ts#L135)), a mutable JSON object:

- **The story,** kept across scenes: the player, the turn count, the dice's seed and count, the transcript, per-turn metrics, the rules engine's campaign (`rules`), `history` (each finished scene's hand-off, its last moments, scenes skipped and fronts moved) and `talks`.
- **The scene's own,** reset by `freshScene` ([engine.ts:722](engine.ts#L722)) when the next scene starts: the beat and the `path` of moves, facts established, the co-GM's notes, whispers and patches, who has entered or is absent, the scene's status, the memory notes opened, essentials landed or hinted, staged secrets (`guard`), exits already fought, and the place's `world`.
- **What's pending:** `pendingExit` (an ending held for the player's answer), `closing` (a wind-down turn), `endingLead`, `threat` (a blow or a danger that lands next turn), `brawl` and `ended`.
- **From the boundary:** `adjustments`, `opening`, `lead`, and what the player `carried` out of the last scene's world.

**Files,** under `runs/sessions/<id>/` (`KM_RUNS_DIR` moves `runs/`):

| File | Written by | Read by |
|---|---|---|
| `state.json` | `saveSession` (a temp file, then a rename) | `loadSession`, the co-GM job |
| `snapshots/<scene>-turn-NNN.json` | `snapshotSession`, after every turn | the memory job, eval fixtures, the End's chapters ([src/app/story.ts](../app/story.ts)) |
| `repair-NNN.json`, `repair.lock` | the co-GM job, and a quick co-GM that missed its deadline | `applyPendingRepairs`, at the start of the next turn |
| `remember-N.lock`, `memory-reviews.jsonl` | `afterTurn`, the memory job | people reading a run |
| `docs/` | src/lore: this game's copy of the lore | src/lore |
| `calls.jsonl` | src/llm, once the caller points the call log here | people reading a run |

The game core and the app keep `game.json` and `app.json` beside them.

## How it fits

| Caller | What it calls |
|---|---|
| The game core, [src/game/play.ts](../game/play.ts) (the app, the QA console, the browser build and the zoo all play through it) | `createSession`; `openScene` as a scene begins; for each line `playerTurn` (or `talkTurn` in a talk) and then `afterTurn` ([play.ts:267](../game/play.ts#L267)); `forceEnding` for `/end`; `resumeAfterFight` after a fight on the map; `chainScene` with `skipInterludes` when a scene ends ([play.ts:434](../game/play.ts#L434)); `startTalk`, `openTalk`, `endTalk`, `leaveTalk`; `openHubScene` and `closeHubScene` for the zoo |
| The scene harness, [src/cli/scene.ts](../cli/scene.ts) | `createSession`, `openScene`, `playerTurn` and `chainScene`, opening the next scene at once. Its `remember` and `repair` commands are what the background jobs run. |
| The evals, [src/eval/run.ts](../eval/run.ts) | `openScene`, `playerTurn` and `chainScene`, and `decideBefore`, `decideAfter` and `runRepair` on fixture states |
| The browser build, [src/web/static/game.tsx](../web/static/game.tsx) | `setBackgroundRunner`, so the jobs run in the game's worker |
| The zoo's boundary desk, [src/game/zoo/wings/theatre.ts](../game/zoo/wings/theatre.ts) | `boundaryPreview` |

| It calls | For |
|---|---|
| [src/llm](../llm/README.md) | `respond` and `respondJson` for every voice, the hand-off, the boundary verdict and the fronts; `deciderFor` for the director |
| [src/lore](../lore/README.md) | Memory each turn (`disclose`, `memoryBrief`); the boundary's records (`savePlayedScene`, `broadcastEnding`, `rememberScene`, `frontsText`, `moveFronts`); the docs store for talks |
| [src/rules/dnd.ts](../rules/dnd.ts) | The character sheet, checks (`rollFor`), spells, attacks, grapples and shoves, jumps, class features, rests, hazards and NPCs' attacks, time passing, coming to, levelling up, and gear |
| [src/world](../world/) | The place as a world (`buildWorld`, `joinWorld`, `applyOps`, `tick`, `worldView`), the stage manager (`stageManage`), and exit scripts run against a recording world (`recordingWorld`) |
| [scenes/index.ts](../../scenes/index.ts) | `sceneById`, the only way a scene comes in |
| [prompts/](../../prompts/README.md) | Through `prompt()` ([brief.ts:12](brief.ts#L12)) |

**What a caller can count on:**

- **Hooks.** `TurnHooks` ([engine.ts:26](engine.ts#L26)): `onSpeaker` when someone starts speaking; `onText` with the text so far as the player reads it (accumulated, not a delta; the GM's markup taken out), and the markup so far (who says each line, the marks: [the GM's markup](#the-gms-markup)); `onEntry` for each finished entry (dice lines, system lines, finished speech); `onScene` from the core as it goes into a scene.
- **A turn saves at its end.** `playerTurn` writes `state.json` and a snapshot once, when it's done. It returns the entries it added, the exit if the scene ended, and the turn's metric.
- **A turn that throws has already changed the session in memory:** the turn count, the player's line, rolls, the world. The GM reply and the decider calls aren't caught, so when one fails the caller goes back to the last save, as the app does ([src/app/game.ts:1022](../app/game.ts#L1022)). The QA console loads from disk for every command anyway.
- **One turn at a time.** Nothing locks a session; callers send one turn after another.
- **An ended scene takes no turns.** `playerTurn` throws once `state.ended` is set. The caller then fights (a combat exit), chains on, or ends the talk.

## How it works

### A session's life

```mermaid
flowchart TD
  create["createSession<br/>a character sheet from the player's concept"] --> open
  open["openScene<br/>who's here, the place's world, a rest or a level, the opening"] --> turn["playerTurn"]
  turn -->|"the scene goes on"| turn
  turn -->|"a combat exit"| fight["the fight, on the map<br/>(src/game/combat)"]
  fight --> resume["resumeAfterFight<br/>the aftermath, with that exit spent"]
  resume --> turn
  turn -->|"any other exit"| chain["chainScene"]
  chain -->|"no next scene"| theEnd(["The End"])
  chain --> cross["crossBoundary<br/>the hand-off, the verdict, the fronts"]
  cross --> fresh["freshScene<br/>the next scene's own state"]
  fresh --> map["between scenes: the map"]
  map --> open
  map -.-> talk["a talk with a companion<br/>startTalk, openTalk, talkTurn, endTalk"]
  talk -.-> map
```

In the scene harness `chainScene` is followed at once by `openScene`: there's no map between scenes, so the interludes (downtime scenes that stand in for it) are played. The zoo's scenes belong to a hub: `openHubScene` starts one from the top and `closeHubScene` ends it, with nothing handed on.

### One player turn

As `v2` plays it, in a scene with a world and a character sheet. The names in brackets are the calls' operation labels, as they appear in `calls.jsonl`.

```mermaid
sequenceDiagram
  participant Core as Game core
  participant Turn as playerTurn
  participant Dir as Director
  participant Co as Quick co-GM
  participant Mem as Disclosure
  participant Rules as Rules and world
  participant GM as GM voice
  participant Bg as Background jobs

  Core->>Turn: playerTurn(session, line, hooks)
  Turn->>Turn: merge the co-GM's results, log the line
  Turn->>Rules: what the last reply left hanging (a blow, a spell's time, fire)
  par alongside the decision
    Turn->>Co: quickRepair (repair.quick)
  and
    Turn->>Mem: disclose (memory.disclose)
  and
    Turn->>Dir: decideBefore (director.before)
  end
  Dir->>Rules: roll a route's check
  Dir-->>Turn: the move, the rules' act, the flags
  Turn->>Rules: resolve the act, then reactions (director.reactions)
  opt off the graph
    Co-->>Turn: a new route, within 3 s
    Turn->>Dir: decideBefore again
  end
  Turn->>GM: gmReply(directives)
  GM-->>Core: onText, as it streams (gm.reply)
  par after the reply
    Turn->>Rules: stageManage (world.stage)
  and
    Turn->>Dir: decideAfter (director.after)
  end
  Turn->>Turn: endings, gear, save state.json and a snapshot
  Turn-->>Core: TurnResult
  Core->>Bg: afterTurn
  Bg->>Bg: memory review and full co-GM, read next turn
```

1. **Before the decision** ([engine.ts:202](engine.ts#L202)). Co-GM results that have arrived since the last turn are merged (`applyPendingRepairs`), and the scene is the authored one plus their patches. A wind-down turn (`state.closing`) only closes the scene ([engine.ts:234](engine.ts#L234)). Otherwise the rules go first: a timed spell running out, fire spreading in the world, and a blow or danger the last reply left hanging (`state.threat`) all land before the player's act ([engine.ts:254](engine.ts#L254)).
2. **The decision** ([director.ts:412](director.ts#L412)). One decider call asks every question the turn needs at once. Is the player attempting one of the scene's routes, doing something that simply happens, or trying something risky that no route covers? By what means? Should a pacing cue fire? Is this off the graph? Should a missed essential reach them through someone else? Are they pressing someone's secret, or have they earned the payoff? Is it daft enough to send a bill? Is it something the rules resolve? Is it out of character, or past the scene's limits? For actors, who speaks first? A second, smaller call follows only when needed: a spell's or blow's details (`director.mechanic`), a jump, a class feature, a freeform roll's skill and difficulty, or pressure.
3. **What the dice and the rules decide.** A route's check is rolled (`rollFor`) and the move applied: a new beat, facts established, perhaps an ending. The rules resolve a spell, blow, grapple, jump, feature or rest, and violence draws a reaction from everyone present. Each decision becomes a directive, a short paragraph under "For this reply" in the GM's note.
4. **Off the graph** ([engine.ts:426](engine.ts#L426)). In `v2`, a turn the decider judged off the graph waits for the quick co-GM until 3 s after the turn began. If it opened a route, the turn is decided again with it. A late answer is written as a repair file and lands next turn.
5. **The reply.** One streamed GM call (`gm.reply`). For actors, up to four lines in all, the narrator's and the characters', with the decider choosing who speaks next (`director.next`).
6. **After the reply, in parallel.** The stage manager writes what the reply established into the world (`world.stage`, [src/world/stage.ts](../world/stage.ts)). `decideAfter` ([director.ts:851](director.ts#L851)) reads what happened: an outcome route, which ending the story is at, the scene's status, essentials landed or hinted, how far secret-holders have opened up, a threat hanging over the player, and whether they've left the place.
7. **Endings, gear and the save.** The table below says how a scene ends. Gear the story moved to or from the player changes their sheet; the turn's metric goes in `state.metrics`; the state and a snapshot are written. The caller then runs `afterTurn`.

### How a scene ends

| What happened | When the scene closes | Where |
|---|---|---|
| The player chose an exit with no roll in it (an attempt, or something that simply happens), or a fight, read with confidence 0.6 or more | In this reply | [engine.ts:339](engine.ts#L339) |
| A roll decided an exit the player went for, other than a fight | The decisive moment plays now; the scene closes on the next reply | [engine.ts:334](engine.ts#L334) |
| An exit the player didn't choose (a failed check, a cue) | It escalates now and closes on the player's next turn, unless that turn changes things; held once more if they try something (`pendingExit`) | [engine.ts:398](engine.ts#L398) |
| An outcome after the reply leads to an exit | A fight at once; anything else after one wind-down turn (`closing`) | [engine.ts:581](engine.ts#L581) |
| The ending-state read puts the story at an exit (0.6, or 0.35 twice running) | The same | [engine.ts:570](engine.ts#L570) |
| The player walks out of the place (read at 0.7, with a character sheet) | Now, through "an ending of their own" | [engine.ts:605](engine.ts#L605) |

Every scene has "an ending of their own" (`own-ending`, [brief.ts:27](brief.ts#L27)), added by `sceneById`. The director prefers any plausible authored ending to it ([director.ts:931](director.ts#L931)). A fight ends its scene at once so it can be played out on the map from where everyone stood, and `resumeAfterFight` picks the scene up afterwards with that exit spent. `finishScene` ([engine.ts:635](engine.ts#L635)) runs the exit's script against a recording world (`state.ended.operations`) and applies the scene's `afterwards`.

### Approaches

| Switch | What it changes | `v2` |
|---|---|---|
| `voice` | `gm`: one GM voices everyone. `actors`: a narrator, and a call per character from their own card. | `gm` |
| `decider` | Who answers the director's questions ([src/llm/decide.ts](../llm/decide.ts)) | `luna-decisions` |
| `repair` | When the co-GM runs: `off`, `background`, `blocking` (before each reply), `stall` (a holding beat, then a follow-up), `quick-block` (wait for the quick co-GM on off-graph turns) | `quick-block`, 3 s |
| `memory` | `docs`: the docs service each turn, and the background reviews. `lite`: one merged review. Unset: hand-offs only. | `docs` |
| `tone` | `comic` adds [prompts/tone-comic.md](../../prompts/tone-comic.md) to the GM's prompt | `comic` |
| `consequences`, `freeformChecks` | The "daft" question and its bill; a roll for a risky attempt that no route covers | on |
| `pressureRolls`, `staging` | Pressing someone for a secret is ruled yes, no, or a roll at DC 12, 15 or 18; staged secrets (surface, tell, stirred, torn, settled) | off |
| `speculative`, `deciderRelocation`, `hideEssentials`, `effort`, `repairEffort` | Experiments: the reply started alongside the decision, the decider moving missed essentials, no essentials in the prep, reasoning for the voices and the co-GM | off |

A scene can set any of these for itself (`Scene.approach`, through `sceneApproach`, [approaches.ts:104](approaches.ts#L104)). A talk turns the co-GM and freeform rolls off and staged secrets on.

### What the GM sees

`gmReply` ([voices.ts:111](voices.ts#L111)) sends, in this order:

1. **Instructions:** [prompts/gm.md](../../prompts/gm.md), with the tone.
2. **The prep** (`sceneBrief`, [brief.ts:144](brief.ts#L144)): the place, the premise, background, the last hand-off with its last moments word for word, where the prep is out of date (the boundary's adjustments, which outrank it), every cast card with its secrets, the ways it can end, the essentials, the limits, the player character and the table rules.
3. **Each person's lore** (`memoryBrief(…, "stable")`), when the approach has memory.
4. **The scene so far,** as a conversation: the player's lines as user turns, the GM's as assistant turns, dice and system lines as developer notes.
5. **What changes every turn, last:** what people remember (`memoryBrief(…, "live")`) and `nowNote` ([brief.ts:215](brief.ts#L215)). That's the beat and its direction, cast notes, pressure, the routes from here, staged secrets, the co-GM's notes and whispers, details established in play, the player's injuries, names not yet heard, the world right now, and the directives under "For this reply".

The order serves the provider's prompt cache: what's stable comes first, so a newly opened note doesn't spoil the prefix ([voices.ts:124](voices.ts#L124)). The prep ends with "What the player knows" (`knowledgeBrief`), and the note with a one-line reminder of the markup ([prompts/gm-markup.md](../../prompts/gm-markup.md)), just before "For this reply" ([below](#the-gms-markup)).

### The GM's markup

The GM marks its reply up for the screen: who says each line, and notes on the words a moment turns on, which the player can click. The markup never shows. Anything in square brackets is for the screen; a marked phrase stays in the prose, in round brackets:

```text
[Kell] “On what evidence?”                                     who says the line after it
[the pie-seller] “(Not for you, my lamb.)[why: You called…]”   a note on the words it's on
```

- **Speakers.** A tag goes before every spoken line: the speaker's name, what the player calls them until they've heard it, or `you`. `withSpeakers` ([markup.ts](markup.ts)) resolves it to a cast or world id (`tagSpeaker`); an untagged line gets its speaker from the prose, as the look director's barks always have ([speakers.ts](speakers.ts): the speech tag after it, the sentence leading in, a "she says" carrying the last speaker on). Nobody found is left unplaced, and the screen draws them gold.
- **Marks.** Three kinds: `why` (someone refuses, bristles or comes round because of the player's past, a side they're on or not, a prejudice or custom of the world, or a law), `know` (what the player's character would know and a newcomer wouldn't), `you` (one of the player's own past acts, called back). The note is the GM's own words, to the player, and holds only what the player knows ([what the player knows](#what-the-player-knows)).
- **Why these tokens.** The user's sketch was `(text)[note]`. It holds up, with a kind on the note and the speaker's tag in the same square brackets, so square brackets are always for the screen. Markdown's order (`[text](kind: note)`) measured the same (adherence, notes and the judge's scores within noise of each other, docs/LOG.md), so the sketch's shape was kept, and the parser takes both. Brackets that are only brackets (the player's "(I cast Fireball)") stay as they are.
- **What the model drifts to, and how it's read** ([markup.ts](markup.ts), tested in [markup.test.ts](markup.test.ts)): Markdown's order; both in square brackets (`[Warden’s Book][know: …]`); a space between the phrase and its note; a note with no kind (a why); the note first and its phrase after; a note straight after a line, or a sentence, with no words of its own in brackets, or in round ones, or in both (`“…”(why: …)`, `“…”[(why: …)]`: it's on that line or sentence); a tag before a marked line (`[Peg] (“…”)[why: …]`), inside the line it's for, or after it at the end of a line of text; a marked sentence that lost its full stop (it gets it back); a marked phrase in square brackets (read without them). A phrase that isn't words of the reply (a note on a line of its own; a label after a finished sentence: “…again.” (the goblins scatter)[why: …]; or words just said, written again as a label: “…in the tally loft.” [The tally loft][know: …]) isn't shown: its note goes on the phrase where it already stands, or on the sentence it's about, or nowhere. What's malformed falls back to plain words: a phrase whose note never came is shown without brackets, a stray tag disappears, a note that never closes is hidden to the end of its line. Every one of these was seen in the evals or the ferry booth, and over all 1,681 replies of this work's runs the parser shows no markup.
- **As it streams.** `gmReply` parses the reply so far on every token (`parseMarkup(raw, { final: false })`) and calls `onText(text, markup)` only when the words shown have grown. A bracket that might be markup holds back what follows it until it's clear, so the words shown only ever grow, never show a token, and a mark's highlight lands when its note closes. The tests check every cut point of a reply, and pieces of every size.
- **What's kept.** A narration entry keeps the words as the player reads them in `text`, and the markup beside them in `marked` (`{ speech, marks }`, offsets into `text`), so saves, resumes and the static build keep it; everything else that reads the transcript (the judge, the deciders, the stage manager, memory) reads the plain words. The GM's own history is written back with its markup (`markupOf`), a reply from before the markup with its lines tagged from the prose, since a model writes as its last replies were written. A turn's metric keeps how the reply kept to the markup (`markup`: lines tagged, marks by kind, what was dropped or malformed).
- **Links.** After the reply, `linkMarks` ([knowledge.ts](knowledge.ts)) links each mark to what the player knows that it's about: their own turn (a `you` note, or a `why` about something they did: by the words they share), someone they know (the cast by the names they've heard, or what they call them; the place's people), or a place or custom anyone could read about (the public lore of the world and its places, the scene's own first). `unheardNames` puts what the player calls someone in place of a name they haven't heard.

### What the player knows

The GM is still given every fact: a fast model kept from one invents it (docs/guide, and the talks work). What changes is that it's told which of them the player has, so a note can explain without telling a secret. `knowledgeBrief` ([knowledge.ts](knowledge.ts)) builds "What the player knows" for the prep, from what the player has lived and never from the prep: who they are (their concept and their doc, `Player/<Name>.md`, where character creation writes the backstory), how each earlier scene ended and what the notebook says of it (`history[].journal`, the exit script's journal lines), what companions have told them in talks (`talks[].told`), the conversation itself, and the world's common knowledge (the public lore). Whose names they've heard is in the turn's note ("Names the player hasn't heard yet"). Everything else stays behind the screen: secrets, what someone's keeping back and how far they've opened up, what the scene means them to find, the GM-only and private notes, a story not told yet.

A mark's popover shows the GM's note and, through `knowledgeCard`, what the player knows of its link: their own line and the turn they said it; someone by the name they know them by, the public lore on them if they know the name, and the last thing they said to the player; a public lore doc's title and summary. Never a GM-only doc, a look written for the GM, or a name the player hasn't heard (tested in [knowledge.test.ts](knowledge.test.ts)).

### The co-GM and the background jobs

- **The full co-GM** (`runRepair`, [repair.ts:125](repair.ts#L125)) uses [prompts/repair.md](../../prompts/repair.md) with Luna at medium reasoning. Its JSON schema's enums are built from the scene's own ids, so it can only point at beats, endings, people and essentials that exist. It returns notes for the GM (they last two turns), whispers to characters (one turn), canon to keep true, relocated essentials, "no, but" alternatives, a beat the story has already reached, a bridging beat and new routes. The patches go in `state.patches` and are seen through `effectiveScene`; the authored scene is never edited.
- **The quick co-GM** (`quickRepair`, [repair.ts:260](repair.ts#L260)) is one small call with no reasoning. It makes the smallest move: open a route to an existing beat or ending (with a roll if the outcome is uncertain), bring a missed essential through someone present, or leave a note.
- **After each turn,** `afterTurn` ([background.ts:37](background.ts#L37)) starts the memory review when the approach has memory. It starts the full co-GM for `background`, `stall` and `quick-block` approaches when `shouldRepair` ([repair.ts:246](repair.ts#L246)) says so: off the graph this turn, a status other than on track, or three turns since the last review. Each job is a detached `node src/cli/scene.ts remember|repair <id> --turn N`. In the browser, `setBackgroundRunner` runs the same functions (jobs.ts) in the worker.
- **Nothing waits for them.** The co-GM's `repair-NNN.json` is merged at the start of the next turn if it's for the same scene. The memory review writes into this game's docs, where the next disclosure finds it if the review has finished.

### Scene boundaries

`chainScene` ([engine.ts:678](engine.ts#L678)) lists the scenes the story could go to: the exit's `next`, then, while a candidate `assumes` something, its `overtaken` scene (six at most; the game skips interludes). `crossBoundary` ([engine.ts:762](engine.ts#L762)) then makes three calls at once:

- **the hand-off** (`handoff`): how things stand as play left them, for the next scene's GM;
- **the verdict** (`boundary`): which candidates still hold; where the first that holds is out of date (`adjustments`); its opening rewritten to start where the story is; and the `lead`, how the player hears where to go;
- **the world's turn** (`fronts`, `moveOn` at [engine.ts:838](engine.ts#L838)): which steps of the fronts doc play or time have made true, which are now meaningless, any new bills, and what of it shows in the next scene. `moveFronts` writes them into this game's copy ([src/lore/fronts.ts](../lore/fronts.ts)).

Each falls back if its call fails: a plain hand-off line, no scene skipped, the author's opening. Then memory has its turn (`broadcastEnding` for `docs`, `rememberScene` for `lite`, `savePlayedScene` for either). The scene goes in `history`, what the player carries is kept for the next world, and `freshScene` starts the next scene's own state. `boundaryPreview` ([engine.ts:824](engine.ts#L824)) makes the same crossing without moving on, for the zoo's boundary desk.

### Companion talks

A talk ([talk.ts](talk.ts)) is a scene built from a companion's lore ([scenes/talk.ts](../../scenes/talk.ts)) and played by `playerTurn`. `startTalk` sets the waiting scene's own state aside (every field not in `STORY_WIDE`, [talk.ts:41](talk.ts#L41)), and `endTalk` puts it back exactly. `openTalk` runs the greeting alongside the talk's prep:

- `sift` (`talk.sift`, a decider call): which of their notes they've already told the heart of, anywhere, and which is the deepest;
- `plan` (`talk.plan`): the one thing they might open up about this time, how readily, and the first lines the player can choose.

That one thing goes on their card as a staged secret, with a `given` outcome route to the talk's "told" beat (`prepare`, [talk.ts:299](talk.ts#L299)). Their stories are told, now or held. What they've told is in the talk record and their memories, and isn't told again. The one thing for now comes out a step at a time. The deepest is held until the third talk: the GM is told its title and summary, and it's kept out of disclosure. `talkTurn` adds the next dialogue choices (`talk.suggest`) as the reply lands.

### Reactions to violence

The rules may resolve an act that hurt or caught people, or set something burning or broke it where people are (`violence`, [engine.ts:907](engine.ts#L907)). Then up to ten witnesses, the hurt first, each get a reaction from one decider call ([director.ts:772](director.ts#L772)): fight, flee, raise the alarm, cower, intervene, take the player's side, or carry on. The fleeing leave the scene and its world, and the cowering cower. If anyone fights, `state.brawl` records who, the first of them swings at the player at the start of the next turn (`state.threat`), and an authored ending due on the same turn waits.

## Where to look first

- **`playerTurn`** ([engine.ts:202](engine.ts#L202) to 626) is 430 lines with four reply strategies inline: `quick-block`, `stall`, a plain GM reply, and actors. A change to one path can change another, so check which approach flags gate it, and run `v2` as well as the approach the change is for.
- **New session state.** A field added to `SessionState` needs a decision. If it's the story's, it goes in `STORY_WIDE` ([talk.ts:41](talk.ts#L41)), or a talk undoes it. If it's the scene's, `freshScene` ([engine.ts:722](engine.ts#L722)) resets it, or it leaks into the next scene; and `resumeAfterFight` clears it if a fight should.
- **The decider's questions are the logic.** The wording in director.ts is what the model judges, and the thresholds decide what counts: 0.6 (`SCENE_ENDING_CONFIDENCE`, [director.ts:61](director.ts#L61)) for endings, rolls, limits, pressure and the rules' act, and 0.45 for an ordinary route ([director.ts:535](director.ts#L535)). A reworded question needs the decision suite.
- **Directives are matched by their opening words.** The engine drops a directive by its prefix when a later decision overrides it ("This reply closes the scene", "Something the scene needs is within reach": [engine.ts:336](engine.ts#L336), [:365](engine.ts#L371), [:438](engine.ts#L444)). Rewording one breaks its filter without an error.
- **The brief.** Anything added to `sceneBrief` or `nowNote` goes to the GM on every turn. Keep what's stable in the prep and what changes in the note.
- **Latency.** The budget is about 5 s to the text that answers the player. A new model call in the turn should run alongside the decision or the after-reply decision, not in front of the reply.
- **What may fail.** Calls wrapped in `.catch(() => undefined)` are best effort: presence, disclosure, the co-GM, the stage manager, the boundary's three calls. The GM reply and the decisions aren't, and a failure there fails the turn.

## How to test it

```sh
node --no-warnings --test src/runtime/*.test.ts   # decideBefore with a scripted decider, talks, the markup parser and what the player knows: offline
npm test                                          # every unit test (npm run check adds the typecheck and the screens check)
KM_RUNS_DIR=runs/app-test OPENROUTER_API_KEY=offline node --no-warnings src/app/smoke/flow.ts   # the arc through the game core, offline
npm run scene -- start drowned-rat --session t1   # live; then say, status and transcript
npm run qa -- new --session q1 --as "Wren Ashdown: a quick-witted ranger"   # the playable game by action ids (qa observe, say, end)
npm run eval -- --suite decision --decider luna-decisions   # the director's reads on fixture states
npm run eval -- --suite reply --approach v2 --samples 3    # single replies, judged
npm run eval -- --suite trajectory --approach v2           # simulated players through whole scenes
npm run eval -- --suite opening                            # does the next scene pick up where the last one ended?
node --no-warnings src/game/zoo/tour.ts --live              # the zoo's tour with the real GM: the Theatre has a scene per mechanism
```

Offline, the flow smoke's openings fail (as expected), `/end` takes each scene's exit, and the boundary falls back to its plain hand-off. `npm run scene -- status <id>` shows the path (every move, its roll and its source), the co-GM's notes and patches, latency and cost. A live session's model calls, with their whole prompts, are in `runs/sessions/<id>/calls.jsonl`.

## Known gaps and sharp edges

- **No test drives `playerTurn`, `openScene` or `chainScene`.** The unit tests cover `decideBefore`, talks, the markup parser and what the player knows. Offline, the flow smoke ends every scene with `forceEnding`, so turns only run live: the evals, the smoke tests' `--live`, the zoo tour's `--live`.
- **A scene's `approach` doesn't reach everything.** `playerTurn`, `afterTurn` and talks read it through `sceneApproach`. `openScene` ([engine.ts:119](engine.ts#L119)), the voices ([voices.ts:20](voices.ts#L20), [:67](voices.ts#L116)) and the memory job ([jobs.ts:35](jobs.ts#L35)) read the session's approach.
- **A brawl isn't fought on the map.** Nothing outside the engine reads `state.brawl`, though its comment ([session.ts:199](session.ts#L199)) says the game plays it out there. In the game too, the first fighter swings at the start of the next turn, and only a scene's own combat exit takes a fight to the map. Once a brawl has started, later violence in that scene draws no reactions ([engine.ts:360](engine.ts#L360)).
- **The quick co-GM runs on every `v2` turn** ([engine.ts:299](engine.ts#L299)) but is used only off the graph. Its cost is in the ledger, but in the turn's metric only when it was used; the background jobs' costs never are.
- **Background jobs race the next turn.** A co-GM review lands a turn or more late, and only if the scene hasn't changed. Memory reviews of consecutive turns can run at once, and the docs store writes whole files, so two of them adding to one memory index can lose a line. One `repair.lock` serves every repair job. The scene harness starts its jobs with its own copy of `afterTurn`'s gating ([src/cli/scene.ts:73](../cli/scene.ts#L73)).
- **No unit of work.** A turn changes the session as it goes and saves once at the end. `chainScene` writes the docs (the fronts, the played scene, the ending's memories) before it saves the session, so a crash between the two leaves them out of step.
- **A full snapshot every turn,** with the rules engine's event log inside `rules.campaign`, so the session folder grows with every turn.
- **Process-wide state.** The prompt cache ([brief.ts:10](brief.ts#L10)), the background runner ([background.ts:30](background.ts#L30)), the talk scenes ([scenes/talk.ts:48](../../scenes/talk.ts#L48)), and src/llm's call log and spend are per process, so two games in one process share them.
