# The two-part GM in the game

The scenes are played by the two-part GM from PR #666 (approach `two-part`, `src/runtime/two-part.ts` at `origin/claude/two-part-gm` c749270, with its prompts `prompts/two-part-gm.md` and `prompts/two-part-co-gm.md`). In blind QA it scored better than the game's old pipeline: 8 of 8 good endings, and an overall 4/5 in 7 of 8 games. This note maps it onto the game's architecture:
- the client;
- the SpacetimeDB simulation;
- the stateless AI service;
- the browser host, which runs the last two in a worker.

**Port, don't re-engineer.** Copy two-part.ts's logic, with a source header, and adapt it only at the seams named here. The user's two prompts are copied **verbatim** into `ai/prompts/` as `two-part-gm.md` and `two-part-co-gm.md`. They are the user's words: never edit them. What's ours is appended in code: the reply format, the co-GM's tools section, and the markup format.

## The two parts

- **The mouthpiece** voices the scene.
  - Its instructions are fixed for the scene: `two-part-gm.md`, with `{{tone}}`, `{{beats}}` (the prep rendered from the .kmscene) and `{{characters}}` (the cast cards), then the reply format.
  - Its input is the history: for each turn, the co-GM's note written for it (a system message), the player's line, and the GM's earlier replies as the player read them. The latest system message also carries the per-turn note: where the scene is, the open routes, what's settled, the world, names not yet heard, and the player's state.
  - It replies as JSON `{narration, check}`, where `check` is `null | {skill, dc, outcomes: {major_failure, minor_failure, barely_passed, minor_success, major_success}}`. On a wind-down that may wait once, it also returns `closes: boolean`.
- **The co-GM** runs after each reply, beside the stage manager. Its instructions are `two-part-co-gm.md`, with the prep including each event beat's suggested roles and each person's role palette, then its tools section. Its input is the transcript so far, where the scene is, the targets, the open routes, what's settled, the current roles and who's on stage. Its tools:
  - `update_character_role(char_id, status, mental_state, conversation_role)`;
  - `move_scene(route_id, outcome: success|failure|none, why)`. It is checked against the open routes and answered at once with the result: "Moved to …; its suggested roles…; open routes now…", or an error naming the open routes.
  - It gets up to 16 tool rounds a turn.

## The prep as the prompts see it (`{{beats}}`)

Render the .kmscene, in this order:
1. **The scene:** setting, premise, truth ("never told outright: it comes out through the paths"), clock, background and the story so far, the boundary's adjustments, limits, what locals know, and the player.
2. **Where it starts:** the start node's description.
3. **The discoveries:** each beat with a revelation. Give its id in brackets, the revelation, whether it's required, and its suggested paths: via, clue, what earns it, strength, and the check if any.
4. **The events:** each event beat's description and pressure, the routes into it with their conditions, and who arrives. For the co-GM, also its suggested roles.
5. **The endings:** each ending's title, what's true and what it needs (requires), and the routes' conditions.

For the co-GM, also add each person's role palette (characterise, inconsistency, hooks) and the clues that are theirs: the paths `via` them.

## Where the scene is (per turn)

Shared pure functions in `shared/scene/beats.ts` work on the scene and `GmState`. Both sides use the same code, so the AI service's answers to the co-GM's tool calls and the simulation's commits always agree:
- `reachedOf(gm)`;
- `stageOf(scene, gm)`: the latest reached of the start and the event beats;
- `targetsOf(scene, gm)`: the unreached discoveries;
- `openRoutes(scene, gm)`: the source reached, the target not, and every `requires` reached;
- `takeRoute(scene, gm, routeId, outcome, turn)` (`turn`: the one whose reply the move follows, for `closing` and the path). It returns the new state, or an error naming the open routes. It does four things:
  - adds the target to the reached set;
  - settles the beat's and the route's `establishes`;
  - moves the stage for an event beat;
  - for an ending, sets `closing`.

  A dice route refuses outcome `none`, and its failure goes to `onFailure` or stays where it is; a route without dice refuses `failure`. It also marks a carried beat reached as landed (the boundary owes it no more), steps the path, and refuses everything once an ending is reached. `enteringAt(scene, node)` is who an event brings on.

The new `GmState` fields (sent whole to the AI service, as now):
- `reached: string[]`: the start, plus each node reached, in order.
- `beat`: kept, and now meaning the stage.
- `twoPart: { roles: Record<castId, {status, mental_state, conversation_role}>, notes: Array<{turn, text}>, moved?: string, held?: boolean }`.

The rows keep it like the rest of `gm_state`, column by column.

## A turn, step by step (the simulation's plans)

A scene of kind `scene` plays on the two-part steps. A talk (the `talk` template) keeps its own steps unchanged.

1. **say → reply.**
   - The say reducer queues the reply think. The rules' directives from before the player acted are on the plan as now (`rulesFirst`: a timed spell running out, fire's tick, a blow left hanging) and lead the mouthpiece's per-turn directives.
   - A forced mechanic (the map's action menu: an act at a waiting scene, played as its first turn) is resolved by the simulation's rules as it is now, without the decider. Its directive goes to the mouthpiece the same way.
   - The AI service's reply endpoint runs the mouthpiece and **streams the narration** to the turn's draft as it's written. The narration is the JSON's first field: a small incremental extractor reads the `narration` string as tokens arrive.
   - It answers `{narration, check, closes?}` with the markup (below).
2. **The reply commit.**
   - Writes the narration row.
   - With a check, the **simulation rolls it**: the player's own modifiers, through the rules engine as other checks are rolled (`checkThroughEngine`). It picks the band: a natural 1 or 20 is major; otherwise missed by 5 or more is a major failure, missed by 1–4 a minor failure, made by 0–2 barely passed, by 3–6 a minor success, by 7 or more a major success.
   - Then it writes the dice row (`🎲 …` with the band's word: badly, narrowly, only just, cleanly, with room to spare; a natural 20 or 1 says so instead) and the chosen outcome as a narration row.
   - Then it queues the settle, the suggested lines and the notes, as now.
3. **settle** runs the stage manager and the co-GM **in parallel** on the AI service.
   - The stage manager: world ops from the line, the reply, the dice lines and the settled facts, as now.
   - The co-GM: role updates and moves, each move already checked with `takeRoute` against a copy of the state.
   - The answer: the world ops, the roles, the moves `[{route, outcome, why}]`, and the co-GM's tool log.
4. **The settle commit.**
   - Applies the world ops.
   - Re-applies the moves with `takeRoute`, so the rows are the authority.
   - Brings on whoever an event beat brings (the cast whose `enters` is it), and gives anyone newly present a default role (the stage's cast note, else their attitude).
   - Writes the co-GM's note for the next turn (`Co-GM note, before turn N+1`, then each person's status, mental state and conversation role).
   - Bumps or resets `turnsInBeat`, and sets `twoPart.moved` when the stage changed. The next reply is then told the scene has moved on and to show it, "seen arriving", after answering the player's turn first.
   - Queues the memory review, as now.
5. **The wind-down.** With `closing` set, the next say's reply is the closing reply.
   - The first time, it may wait (`closes: false`) when the player has just started something the ending has to answer. That plays out, `twoPart.held` is set, and it closes on the reply after.
   - Otherwise it closes. The scene ends through the story's existing end: the ending's effects, `onEnd`, `afterwards`, then the boundary to `next`.
   - Neither the co-GM nor the stage manager runs on a wind-down turn.
6. **The opening** (`POST /v1/scenes/open`). Everyone present gets a role: `{status: "", mental_state: "", conversation_role: start.cast[id] ?? attitude}`. These become note −1, and the mouthpiece speaks the opening. The co-GM doesn't run after the opening.
   - The boundary's rewritten opening and lead still apply.
   - An aftermath (the scene picking up after a fight) and a queued act still apply.

## Kept as they are

- **The speakers.** Each spoken line is tagged with who says it, so the client gives each person's lines their own colour. Only the speaker part of the old markup is appended to the mouthpiece's instructions, word for word from the old gm.md: "Put the speaker in square brackets before every spoken line, each time they speak: [Kell] "Out." She turns to the boy. [Kell] "You too." Use their name, or what the player calls them until they've heard it ([the pie-seller] "Threepence, my lamb."). The tag is for the screen: your prose still makes clear who's speaking." The reply's speakers are parsed and keyed by the existing markup code (speakers only).
- **The suggested lines.**
- The memory reviews.
- The stage manager.
- The boundary between scenes (owed `carry` beats, the rewritten opening, fronts).
- The map and the town: the action menu, a word with Kell, invented looks.
- Talks, and the client's screens.

**Notes on marked words are removed** (the user, 2026-10-17: "i liked the speakers idea but the notes wasn't tuned well. I'd actually prefer if we didn't include that"). That covers:
- the know, you and why marks in the markup;
- the notes think: the plan, the endpoint and `ai/prompts/notes.md`;
- the notes in the transcript rows;
- the client's marked words and note cards, and their keys;
- the fake's notes, and the e2e, web:check and screens checks of them.

The speaker tags stay. Log the removal in docs/migration-log.md.

**The old pipeline's scene steps** (the decider, the reactions, considered rolls, the co-GM repair) stop being used for scenes. Their code stays in the tree until the QA round, and the user decides afterwards what to salvage. Log it in docs/migration-log.md.

**Known gaps from the prototype's two-part to fix in the port:**
- `pressureOffered` was never set, so the pressure line repeated every turn after two exchanges. Offer it once.
- Essentials never landed. They're `carry` beats now: a beat reached is landed.
- A check wasn't tied to a route. A dice route's check is called by the mouthpiece as the route says, and the co-GM reads the outcome.

## The fake model (the e2e, the arc, the page's `?fake`)

- The fake gains answers for the mouthpiece (the golden replies as `{narration, check: null}`, and one recipe with a check) and for the co-GM.
- The fake co-GM moves each scene towards its first good ending, deterministically. Each turn it takes the next open route on the shortest path to that ending, required beats first. That way `?fake=arc` and `npm run arc` walk the whole story.
- Update the e2e's and the arc's checks to the new scenes. Each check keeps what it was for, with the routes and beats renamed.

## Where to look

- **Two-part's code:** `git show origin/claude/two-part-gm:src/runtime/two-part.ts` and `two-part.test.ts`. The prompts are `prompts/two-part-gm.md` and `prompts/two-part-co-gm.md` on that branch.
- **The QA findings it was tuned on:** ~/git/kingmaker-scratch/v2/mouthpiece/findings.md.
- **The game's turn plumbing:**
  - simulation/src/moves/{say.ts, plans.ts, say-commits.ts, jobs.ts};
  - simulation/src/gm/bookkeeping.ts;
  - ai/service/endpoints/{open.ts, reply.ts, settle.ts, pipeline.ts, turn.ts};
  - ai/gm/{voice.ts, brief.ts, stage.ts, directives.ts};
  - shared/gm/state.ts, shared/protocol/ai.ts, shared/scene/{types.ts, load.ts, graph.ts}.

## As built

Built in M2 on `claude/v2-scenes`; each judgement call is in [migration-log.md](migration-log.md) under M2.

**Where it is.**
- **Shared** ([shared/gm/two-part.ts](../shared/gm/two-part.ts)): the five bands, their words and `bandOf`, the co-GM's note (`rolesNote`), and a role's default (`defaultRole`, `openingRoles`), copied from PR #666 with a source header. Where the scene is, and a route taken, is [shared/scene/beats.ts](../shared/scene/beats.ts), as above. The protocol's additions are the requests' `twoPart` marker, `ReplyResponse.check` and `closes`, `SettleRequest.check` (the turn's check as rolled), `SettleResponse.coGm` (roles, moves, the tool log, an error) and `OpenResponse.check`.
- **The AI service** ([ai/gm/two-part.ts](../ai/gm/two-part.ts)): the prep (`prepOf`, `charactersOf`), the per-turn note (`twoPartNow`), the mouthpiece's input and instructions, `speak` (the call, the narration streamed by `narrationSoFar`, who says each line of the narration and of each outcome read by the game's markup code), the moved and closing directives, and the co-GM (`coGm`: its instructions, input, tools and `runTools` loop, each `move_scene` answered by `takeRoute` on a copy). The endpoints branch on the request's `twoPart`: [reply.ts](../ai/service/endpoints/reply.ts), [settle.ts](../ai/service/endpoints/settle.ts) and [open.ts](../ai/service/endpoints/open.ts).
- **The simulation** ([simulation/src/moves/two-part.ts](../simulation/src/moves/two-part.ts)): the opening's roles (`openingRolesFor`), the turn's start (`twoPartStart`: the rules first, then a forced act), the reply commit (`writeSpoken`, `afterTwoPartReply`), the wind-down, and the settle commit (`afterTwoPartSettle`, `coGmTakesEffect`). [say.ts](../simulation/src/moves/say.ts), [open-scene.ts](../simulation/src/moves/open-scene.ts) and [turns.ts](../simulation/src/turns.ts) route a scene to them by `playsTwoPart` ([scenes.ts](../simulation/src/scenes.ts)).
- **The prompts**: `ai/prompts/two-part-gm.md` and `two-part-co-gm.md`, byte for byte the user's (checked with `cmp` against the branch). What's ours is appended in code: the reply format (FORMAT, the prototype's own), the speakers paragraph (gm.md's words, quoted above), and the co-GM's tools section (CO_GM_TOOLS, the prototype's, with what QA round qa1-1018 showed it needed: a route only as its condition is written, the player's own act for a condition about it; no move for what hasn't happened; the ending the player achieved when several fit; an overdue cue brought about; roles as behaviour to show, moved past what has happened; a cue brought about by its route, not a role).

**Which scenes.** Every scene, and every talk (kind `talk`, since the old pipeline's salvage: below). Until then campaign.json's `gm: "pipeline"` kept the old pipeline playing the tests' own hanged clerk in the simulation's test pack and the local host's tests; the switch went with the old scene steps (migration-log.md, M2's "The old pipeline's salvage"), and those tests went with it or moved onto the two-part GM.

**A turn, as built.**
1. **say → reply.** `twoPartStart` runs the rules first (`rulesFirst`: a spell's time, fire's tick, coming round, a blow left hanging), unless the scene is closing, then a forced act (`takeAct`, as the decide commit took one: its dice lines, its directive), and plans the reply with no decide. The reply endpoint's directives are the rules' and the act's, then the closing's or the move to show. The mouthpiece answers `{check, narration, outcomes}` (since QA round qa3-1018, the check decided first; a talk's `{narration, check: null}`; `closes` too on a closing that may wait), at no reasoning effort and 2500 tokens at most; the narration streams to the turn's draft as the JSON comes, with who says each line.
2. **The reply commit.** The narration is written. A check whose skill is a skill and whose five outcomes are all there is rolled by `rollerFor` (the rules engine's check on an engine-made character, `checkThroughEngine`; the sheet's skills otherwise), from the game's `dice` row; its band picks the outcome; the dice line is `describeRoll`'s with the band's word ("Insight check: 12 + 4 = 16 vs DC 12: success (cleanly)."), or with a natural 20 or 1 its mark alone ("success (natural 20!).": shared/gm/two-part.ts `diceLine`) and the outcome is a narration row with who says its lines. A check that isn't whole is dropped, and the narration stands alone. The suggested lines are asked for, the box opens (`settling`), and the settle is planned with what was said, the dice lines and the check as rolled.
3. **settle.** The stage manager and the co-GM run side by side (`Promise.all`). The co-GM is told this turn's check (skill, DC, total, success, band) and the dice route it fits, if one does, and its open routes into a discovery carry the revelation in brackets. Since QA round qa1-1018 it's also told the scene's turn and the turn each node was reached on; each open cue's outer limit, count by count, with how far it has run and "Overdue: bring it about now" once the next reply reaches one (shared/scene/beats.ts `limitOf`, from the cue's `limit`); and for each open route into an ending, whether it's good, mixed or bad and what's true there. A move whose own reason says it hasn't happened is refused, but a cue's, whose move is what brings it about, and a move's answer names any cue still overdue. Since QA round qa2-1018 two kinds of move are held the first time they're made in a turn, for a second look, and taken if the co-GM makes them again: a cue into a bad ending while a good or mixed ending is open (those endings' conditions are put to it), and a move into a discovery whose revelation names someone of the story's other scenes nobody has said yet (`unsaidIn`, which the targets list too). It has 20 s a round (a round with no answer is asked again once) and 45 s in all, inside the settle's minute. A co-GM that fails answers no roles and no moves, with its error, and the world ops still land.
4. **The settle commit.** The world ops through the gate; each of the co-GM's moves taken again with `takeRoute` (a move the rows refuse is logged and left); the roles it set, for the scene's own cast; whoever an event brings on joined to the world and given a default role; the co-GM's note for the next turn; `turnsInBeat` bumped, or `moved` set when the stage changed (the next reply shows it, then it's cleared; one an earlier reply already played, it goes on from rather than playing again); a route to an ending sets the scene `closing`. Then the memory review, and the turn is done.
5. **The wind-down.** With `closing` set, the next line's reply is the mouthpiece's closing (`two-part.closing`; a combat ending's ends on the fight breaking out, "Roll for initiative!"). The first time it may answer `closes: false`: `twoPart.held` is set and the scene stays closing for one more reply, which closes whatever it answers. Neither the stage manager nor the co-GM runs on it, and no lines are asked after the reply that closed it. The scene ends through the story's end (`endScene`): a combat ending goes to its fight, any other to its chapter, effects, `afterwards` and boundary.
6. **The opening.** `openingRolesFor` gives everyone present a role and writes note −1 before the opening is asked for; the mouthpiece speaks it (`two-part.opening`) with the boundary's opening directive. A queued act from the map plays as turn 1, its mechanic forced as above. The scene picking up after a fight keeps its roles, and its aftermath is the GM's as it was (`gm.aftermath`, the old voice's one call), since the prototype's two-part had no fights.

**Talks** (since the old pipeline's salvage: [migration-log.md](migration-log.md), M2's "The old pipeline's salvage"). A word with whoever walks with the player plays on the same steps, with no world, no stage manager and no dice.
- *The template* (`scenes/talk.kmscene`, its ids kept) is a two-part scene: a start, `talk`, with the companion's opening role (a `cast` note for `{companion}`, note -1 as the talk opens); a discovery, `told`, that each talk's prep fills (a `fill` patch: its revelation, and its paths, how it shows and what brings it out) or drops with its way in when there's nothing to confide (`drop`); and the ending `goodbye`, its way in from the start.
- *The opening* still chooses what the companion might confide (`talk.sift`, then `talk.plan`, beside the greeting, which is the mouthpiece's: `two-part.opening`), and keeps the talk record. The companion's lore entry goes with the people (ai/gm/talk.ts `talkLore`), and the GM's notes on them in the per-turn note (`talkNotes`) as well as among the co-GM's notes on the people here, as the old talk's GM had their lore and memories.
- *A turn* is a reply and a settle: the mouthpiece (its reply format with no check: `TALK_FORMAT`), then the co-GM beside the talk's own next lines (`talk.suggest`, not the suggest job). The co-GM stages the confide through the companion's role, the next piece only, and takes the way into `told` once it's out; the record then has it told, and the settle writes a line that they told it in the GM's notes on them, once.
- *The goodbye* said in so many words (the talk's last choice: `isFarewell`) is taken as the turn starts, so the reply to it is the closing, which never waits, and the talk ends with it; said in the player's own words, the co-GM takes it after the reply that answered it, and the talk ends at that settle. Walking on ends it with no reply, as before.

**The prep.** As listed above, in that order, with the gaps fixed: the pressure is in the per-turn note once a stage, two exchanges in (the reply says which stage it offered, and the simulation marks it); a carried beat is landed when it's reached (`takeRoute`), so the boundary owes it no more; and the routes open now are in the per-turn note with a dice route's skill and DC, the reply format tells the mouthpiece to use them ("Where your prep's routes say the dice decide something the player is trying, use that route's skill and DC"), and the co-GM is told which route a check fits and how it went.

**Speakers stay, notes went.** The speaker tags are appended to the mouthpiece's instructions and parsed by the game's markup code, so each person's lines keep their colour; the markup is `{speech}` alone. The notes on marked words are gone: the know, you and why marks (the parser takes a mark a model writes anyway out of the words), the notes think (its plan, step, job, endpoint and prompt), the turn's `noting` phase (the `turn.notes` column stays, unwritten), the notes on transcript rows, the client's marked words, note cards and their keys, the fake's notes, the dev host's `n` key, and the checks of them.

**After QA round qa1-1018** (its fixes are in [migration-log.md](migration-log.md), M2's "Fixes from QA round qa1-1018"). What's ours after the user's prompt (`mouthpieceRules`) also says what the player sees and hears (a name only once it's been said, nothing hidden named, the player's bracketed words done or thought but never heard, the prep's meaning never narrated), that written words are read untagged, how the companion plays (it's the player's case), and that a check is called when the player makes a clear, risky attempt on someone who could go either way, never on a remark, with outcomes that follow their setup and never undo it. The per-turn note lists what's hidden from the player right now (the world's things out of their sight, and the cards' secrets by their first sentences, with their tells), the names they haven't heard with what to call them, and what their turn did or thought in brackets; a closing is told the lines its last reply said, not to say them again. And the narration's names the player hasn't heard are swapped for what they'd call that person before it's shown or kept ([ai/gm/unheard.ts](../ai/gm/unheard.ts)), in its own words only: a tag is the screen's, and a name said aloud is how the player hears it.

**Memory, as the GM's notes** (the old pipeline's salvage, after QA round qa1-1018: [migration-log.md](migration-log.md), M2's "The old pipeline's salvage"). The memory reviews keep one living note per person per game in the game's copy of the lore ([ai/docs/notes.ts](../ai/docs/notes.ts)), in the third person: how they stand with the player and why, what they've seen the player do, what they've learned, the promises made by them or to them, and what they did, each part so many lines at most, a line rewritten rather than another added when a moment changes it. A scene's end adds what its ending's effects say of each person (an attitude is their standing, a memory what they did, a promise in both sides' notes) and the time between. The co-GM's input has the notes on each person on stage above the current roles ("# Notes on the people here (what's happened with them in play)", `notesOnPeople`), so a role carries a promise kept or owed and how the player has treated them; its tools section points at them. The mouthpiece reads none in a scene: it plays the roles, and the scenes before reach it as the prep's hand-offs (a talk's has the companion's in its per-turn note: below). A "So far:" line on its cards was probed and not kept.

**After QA round qa2-1018, the co-GM** (its part is in [migration-log.md](migration-log.md), M2's "Fixes from QA round qa2-1018"). The co-GM's tools section reads the endings first: one whose condition has happened, as written, is taken in that settle ahead of any cue, and one about to happen (an arrest not yet secured) isn't yet. A cue into a bad ending (the Heron's second bell, the barge sailing) waits on the good and mixed endings, coming only when none of their conditions has happened and the player isn't in the middle of bringing one about; its overdue line says so, and its first move in a turn while one is open is held (above). A cue two replies from its limit is due soon, and can be felt coming in someone's role. A discovery is reached once its heart has landed, as written: when it points to someone the player must go and find, who they are by name and where to find them, someone holding the rest giving it in the next reply as their card says (Kell names a man from his description). The co-GM's view has the campaign's story from the first scene on, for `unsaidIn`; the fake co-GM takes a held move again once, so its walks are as they were.

**After QA round qa2-1018, the mouthpiece** (its part is in [migration-log.md](migration-log.md), M2's "Fixes from QA round qa2-1018"). A check keeps to the prep: what a path or a card says an approach gets (no dice, a promise that answers someone's fear, what coin never buys) it gets without a roll; a check is for what the player has just tried, not what's already in view or still awaited; its setup stops at the attempt, each outcome says only what the roll decided, and no failure sends whoever holds a required discovery out of the scene. The per-turn note lists who here holds each required discovery not yet reached, and before the outcomes are kept a failure that sends one of them off is swapped for the other failure (`inReach`). What's ours also says nobody states their own terms (what opens someone is the GM's to know, shown in behaviour), the player character's body and mind are the player's, a reply follows the player only to the edge of the scene's place, and the companion keeps to five plain points (says what she sees when asked and stops there; leaves questions put to the player to them; keeps the player's word; tests a case once, when it's put; examines, chooses and hints nothing for them); the co-GM is told, in ours before its tools, to write the companion's role every turn with what she holds back (`companionRoles`). A closing is told what its last reply did and said first, then plays only what that reply didn't of the ending's words, where the player is, moving them nowhere and narrating no way on. The player's state shows in the note only a quarter down or more, or with a condition. A cast group's named members (the Crakes) are in the name pass, called what they are, and the speakers read a line said mid-sentence as nobody's, "the big man" as Hobb, and a speech tag naming a stranger as theirs. The loop's probe asks the mouthpiece again on a round's turns (`--mouthpiece`).

**After QA round qa3-1018, the co-GM** (its part is in [migration-log.md](migration-log.md), M2's "Fixes from QA round qa3-1018"). A move is refused on a reason that says nothing of what happened ("none", or the route's own name back: the Heron closed on "Out with the true book" for "none"), that says it's still to come ("she will identify him in the next reply"), or, for a cue, that its moment hasn't come (one that opens "Not yet", calls itself no longer needed, or says it hasn't happened while it isn't overdue), and more of the ways a reason denies itself are caught. A lead (a discovery an ending needs whose revelation names someone of the story's other scenes) is refused every time while nobody has said that name, however its reason reads: the refusal leaves the name owed, a step on the path that moves nothing (beats.ts `oweName`, the settle answer's `owed`), and while it's unsaid each reply is told that whoever gives it freely as their path has it (a hook path whose clue has the name: the clerk's Kell) names them now (`owedDirective`, from the reply endpoint, which reads the campaign's story only then); the co-GM is told to move a lead once its person has been described, so the name is owed, and to write the holder's role with no condition. A lead with nobody to give the name freely (the Rat's master) waits for it to come out as it's earned. Any other discovery naming someone unsaid is held once as before. A discovery is reached when the player has its heart by one of its paths: a strong or proof path's clue that has landed, as its earn allows, or suggestive clues once the player has drawn the conclusion; the targets list each discovery's paths with how strong each is. The companion's role holds back what an ending records that's theirs to do (Kell signing Prout in) until that ending's way in is open, saying only that she writes the case down and waits. And a role drops a line once it's been said or answered, and a clock's role names this exchange's one new step, never a menu. The fake's mouthpiece says an owed name when its note says who names them now, so the clerk's walk takes Hobb a turn later; the Rat's master waits on the fake for someone to say Sallow.

**After QA round qa3-1018, the mouthpiece** (its part is in [migration-log.md](migration-log.md), M2's "Fixes from QA round qa3-1018"). The reply is `{check, narration, outcomes}` in that order: the check's skill and DC (or null) decided before a word is written, then the narration, which with a check is the setup alone and stops at the attempt, then the five outcomes, which carry everything the roll decides (a talk's is `{narration, check: null}` as before); the format reads what the prep says for certain first. A move to an event gives it a beat of its own that the reply ends on, whoever it brings on seen coming in and doing what first, and what the player set up for it happens as they set it, the directive quoting their words when they asked to be warned (`setUpEarlier`). The per-turn note has the scene's clock, a sign of it to show, every third reply while an open cue's outer limit runs and every reply from the one before it runs out (`clockNote`), and what the place the world has the player in holds with no dice, theirs as written and with what it means whatever a card's secret says (`reachNote`). What's ours has "When something lands": a name, a link or a confession that touches someone's card is reacted to in character (a tell, the card's first words), not a secret told, and the conclusion stays the player's; the companion reacts before she writes. The speakers credit a line after a verb of speech said of someone named just before it ("…, and the forewoman with the sack-needle calls,"), and go back a sentence from a lead-in about nobody who might speak. The loop's mouthpiece probe asks a round in its own schema, makes a move to show again and puts the player where the round's world had them.

**The fake.** The mouthpiece answers with the next golden reply as `{check: null, narration, outcomes: null}` (`mouthpiece.check` makes it call a check, with five outcomes of its own, on every reply but an opening or a closing; `mouthpiece.holds` makes a closing wait once; a talk's is `{narration, check: null}`). The co-GM reads the scene off its own prep (the route lines as `routeLine` writes them, the endings and the required discoveries) and its input (what's reached, the open routes), and each turn takes the next open route on the shortest walk to the scene's first good ending, the required discoveries first; `coGm.endings` names the endings to walk to (the first a scene has whose walk is still open, so a fight fought hands on to the next), `coGm.still` keeps it from moving, `coGm.roles` sets roles every turn. fake.json's co-GM walks; the e2e keeps it still where a scene must stay open and walks it where an ending is the point; `?fake=arc` and the dev stack's whole-story recipe walk murder by persons unknown, Hobb talking, the true book taken out and the King's justice.

**What scenes no longer use.** The old pipeline's scene steps went after the old pipeline's salvage, a part a commit ([migration-log.md](migration-log.md), M2's "The old pipeline's salvage", "The old scene steps, deleted"): the decide, consider and repair endpoints and steps, the reply endpoint's and settle's old paths (the director's after-reply read: an outcome route, what landed or was hinted, walking out), disclosure with the old opening, the simulation's commits for them, the bookkeeping only they kept, and the prompts nothing loaded (the improvisation guide among them). The spell-and-blow handling is parked for combat: the rules' mechanic question and the act's details call, the reactions step, the threat a reply leaves hanging, and fight.md ([ai/README.md](../ai/README.md), "Parked for combat").

**Checked.** `npm run typecheck`; `npm test` (955); `npm run screens` (685); `npm run campaign -- check campaigns/caerwyn`; `npm run e2e` (every step, 390 s; 24 changed and 25, 27 and 29 gone, as its header says); `npm run arc` (15 of 16: the fight's own check, V12's, stays off); `npm run web:check` (80); `npm run build:site`; and a game on real models, eight lines into the hanged clerk: two Medicine checks (narrowly, only just), the co-GM's roles every turn and its moves to the murder and to Hobb, first words in 0.9 to 3.3 s, $0.057. It showed two things, both fixed: a co-GM round that hung for 180 s (now 20 s a round and 45 s in all), and a co-GM that held the scene back until its routes into a discovery carried the revelation. The numbers are in migration-log.md.
