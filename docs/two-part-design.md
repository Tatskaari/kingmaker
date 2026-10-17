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

Shared pure functions in `shared/scene/` work on the scene and `GmState`. Both sides use the same code, so the AI service's answers to the co-GM's tool calls and the simulation's commits always agree:
- `reachedOf(gm)`;
- `stageOf(scene, gm)`: the latest reached of the start and the event beats;
- `targetsOf(scene, gm)`: the unreached discoveries;
- `openRoutes(scene, gm)`: the source reached, the target not, and every `requires` reached;
- `takeRoute(scene, gm, routeId, outcome)`. It returns the new state, or an error naming the open routes. It does four things:
  - adds the target to the reached set;
  - settles the beat's and the route's `establishes`;
  - moves the stage for an event beat;
  - for an ending, sets `closing`.

  A dice route refuses outcome `none`, and its failure goes to `onFailure` or stays where it is.

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
   - Then it writes the dice row (`🎲 …` with the band's word: badly, narrowly, only just, cleanly, with room to spare) and the chosen outcome as a narration row.
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
