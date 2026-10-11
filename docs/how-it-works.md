# How Kingmaker works

This is a tour of the systems that make Kingmaker's characters feel alive. It
is aimed at someone new to the repository: it explains what each piece is for,
why it is built the way it is, and where to find it. For the structure of the
codebase (hooks, services, the two kinds of game state), read
[ARCHITECTURE.md](../ARCHITECTURE.md) first.

## The idea in one paragraph

Characters are written as linked Markdown notes in an Obsidian vault. When you
talk to one, a fast model speaks in their voice, using only the notes they are
allowed to know. Between turns, a cheap decision model (Jev) watches the
conversation: it steers authored conversations, and it flags anything the world
should react to. Only flagged turns wake the expensive game master (GM) model,
which runs in the background and writes what happened back into the notes.
That includes new goals for NPCs, which Jev then carries out step by step in
the physical world. What the NPCs do there becomes something new to talk about.

```
 ┌──────────────────────────── the player waits for this part ──────────────────────────┐
 │                                                                                      │
 │  player message ─▶ ① disclosure ─▶ ② tree check ─▶ dice? ─▶ character reply ─▶ ② tree check
 │                     (Jev)          (Jev)           (Jev+GM)  (no tools)        ③ attention (Jev)
 └──────────────────────────────────────────────────────────────────────────────────┬───┘
                                                                                    │ flags
                    ┌─────────────────── background ────────────────────────────────▼───┐
                    │  focused GM reviews ─▶ documents: memories, relationships, lore,  │
                    │                        activities, waits                          │
                    │                               │                                   │
                    │  ④ Jev plans one action ◀─────┘                                   │
                    │      │                                                            │
                    │      ▼                                                            │
                    │  boardgame.io move ─▶ world event ─▶ perception ─▶ GM review ─┐   │
                    │      ▲                                                        │   │
                    │      └────────────────────── new or revised activity ◀────────┘   │
                    └───────────────────────────────────────────────────────────────────┘
```

## Three models, three jobs

| Model | Job | Why it is shaped this way |
| --- | --- | --- |
| **Character** | Speaks in the character's voice. | No tools and no reasoning, so replies are fast. Everything it needs is put into its context beforehand. |
| **Jev** | Makes small, structured choices: open this note or not, did this condition happen, which action next. | It uses OpenRouter's decisions API, which returns a probability for each option. It is cheap, fast, can ask several questions in one call, and only ever picks from options the host offers. |
| **GM** | Adjudicates and records: dice rulings, reviews, memory and goal updates. | It has tools that write through the services, with conflict checks. It runs only when needed, and mostly off the player's critical path. |

The rest of this document is about how those three are combined.

## ① Progressive disclosure: lore without tool calls

**Problem.** A character's notes are a web of linked documents: their
personality, what they know about each other person, scenario detail, memories.
Putting all of it in every prompt is slow and expensive. Letting the speaking
model fetch notes with tool calls adds round trips and means giving it tools.

**What happens.** A conversation starts with three documents:
- the character's private cast note (voice, history, motives)
- their scenario entry (where they are now, current objectives and intent)
- their memory index

Before each reply, the host repeatedly:
1. Collects the links from every opened document.
2. Drops links the character isn't allowed to read. Access comes from the
   `readers`/`visibility` frontmatter on the target note.
3. Shows Jev each remaining link with its one-line `summary` and asks,
   independently for each, "is opening this relevant to the conversation right
   now?"
4. Opens every link Jev rates above 0.7 and adds it to the context.

It stops when a round opens nothing new, with limits of 16 rounds and 120k
characters. Opened notes stay open for the rest of the conversation. Rejected
links are reconsidered on later turns, as the conversation moves.

**Why it works.**
- Retrieval is a handful of parallel yes/no decisions rather than an agent loop.
- The speaking model never sees a tool.
- Permissions are checked before Jev even sees a summary, so a secret can't
  leak through retrieval.
- Authors control discoverability by writing good summaries.

The same mechanism prepares context for NPC planning, waits and GM reviews. The
GM can read everything; characters can't.

Code: `packages/conversation/src/progressive-disclosure.ts`,
`packages/conversation/src/document-lore.ts`. Authoring rules:
[Agent Disclosure](../lore/Authoring/Agent%20Disclosure.md).

## Dice: rulings before the reply

When the player tries something uncertain (persuade, bluff, intimidate), Jev
decides whether a check is needed and picks the skill and difficulty. The host
rolls the dice. The UI animates the result while the GM writes a binding ruling
on what that outcome means. The ruling is added to the character's context, and
the character must honour it: a success delivers the intended outcome, even an
absurd one. The character never judges the roll itself.

Code: `packages/conversation/src/check-strategy.ts`,
`packages/conversation/src/checks.ts`. Details:
[conversation services](conversation-services.md#dice-resolution).

## ② Conversation trees: steering authored conversations

**Problem.** Some conversations should go somewhere. For example, the king has
a task to hand out. We want that without scripting the dialogue, and without
asking the speaking model to track progress.

**What happens.** A tree is one GM-only Markdown file:
- Each node has *guidance* for the character ("you want help with the
  cushions").
- Each outgoing transition has a *condition* in plain prose ("the player agrees
  to help").

Before the character replies, and again after, Jev checks every condition on
the current node against what has actually been said. When one hits:
- the transition is recorded in quest state,
- an optional trusted script runs (for example, activating a quest),
- the character's guidance switches to the new node.

**Why it works.** The character only ever sees its current goal, so it
improvises freely around it. Conditions are judged on spoken evidence by a
separate model, so the character can't "decide" it has progressed. Progress is
saved with the quest, so reloading doesn't replay a transition.

Code: `packages/conversation/src/conversation-tree.ts`,
`packages/lore/src/conversation-tree.ts`; example tree
`content/conversation-trees/aldren.md`. Details:
[conversation trees](conversation-trees.md).

## ③ Attention: deciding what the world must remember

**Problem.** If every turn ran a full GM review, conversations would be slow and
expensive. If none did, promises would be forgotten, invented details would
contradict the world, and nobody would act on what was agreed.

**What happens.** After each reply, Jev answers a fixed set of questions about
the latest exchange. Each one is flagged or not flagged:

| Category | Flags when… |
| --- | --- |
| Immediate commitment | The character agreed to do something now ("Lead on"). |
| Deferred commitment | A promise for later, or for when a condition is met. |
| General commitment | Broad support or allegiance. |
| Improvised detail | Either side introduced a new story fact that wasn't explicitly denied. |
| Plot progress | Progress, a setback or a discovery on an existing plot. |
| Other world update | Narration that doesn't match the world ("I follow you into the parlour" while still in the hall). |
| Conversational exchange | An agreed gift, payment or trade. |
| Relationship or knowledge change | Trust, attitude or knowledge shifted. |

A separate *feasibility* question asks whether an immediate commitment is
possible, impossible, or needs the GM's discretion (for example, an improvised
item that has to be created first).

A small decision tree turns the answers into work:
- **Nothing flagged:** nothing else runs. Most turns end here, having cost one
  Jev call.
- **A commitment, or GM discretion:** an *activity* review whose only tool is
  `set_activity`, so the NPC gets a concrete goal to act on.
- **A commitment:** a *commitment memory* review, so the promise is written down.
- **Any other flagged category:** its own focused review, with its own prompt.

Each review is a GM agent with document tools, running at high reasoning
effort. The reviews go into an ordered queue for that conversation and run in
the background, so the conversation continues while they work. Writes are
compare-and-swap, so a review that loses a race rereads and reconciles instead
of overwriting. When the conversation ends, the NPC is released to act on
whatever has already been committed; any failed reviews surface then.

**Why it works.** The flags are an attention filter, not a judge. Flagging
"improvised detail" doesn't make the claim true. It asks the GM to reconcile
it, and the GM decides whether it becomes shared fact, one character's belief,
or nothing. Splitting reviews by category keeps each GM prompt small and its
toolset narrow. Running them in the background keeps the cost off the player's
wait.

Code: `packages/conversation/src/attention.ts`,
`packages/conversation/src/live-conversation-strategy.ts`,
`packages/conversation/src/document-review.ts`; prompts in
`lore/gm_prompts/conversation/attention/` and `…/review/`.

## ④ Activities and planning: goals become actions

**Problem.** "I'll meet you in the treasury" has to turn into a character
actually walking there, opening doors on the way, and waiting for you. We want
that to work for goals nobody anticipated, in a world that changes underneath
the NPC.

**What happens.**
- **Goals are documents.** A review writes an *activity*: a name, a status (what
  is known, the plan), success criteria, and the immediate goal. It can also
  write a *wait*: prose instructions plus optional activities to switch to.
  Each NPC can have a *routine* to fall back on. The runtime character points
  at its current activity or wait.
- **Jev plans one step at a time, GOAP-style.** The activity's success criteria
  describe the desired state. At each step, Jev gets:
  - the goal and plan
  - a text view of the current room
  - the static map connections
  - its recent history

  It picks the single available action most likely to make progress, or a
  terminal choice: `complete`, `wait` or `unable`. The host validates the
  action and performs it as boardgame.io moves through the map service. Then
  Jev re-plans from a fresh observation, with the previous result as feedback.
  Unlike classic goal-oriented action planning, no search runs over action
  preconditions and effects; Jev is the planner, re-evaluated after every step.
  Walking straight back to the room just left is labelled so it can be
  avoided, and a goal gets at most 24 actions.
- **The room view is modelled on accessibility trees.** Browser agents work
  from a page's accessibility tree (the AXTree) rather than its pixels.
  Kingmaker's planner works the same way, from a compact text view of the room
  (`apps/web/src/jev-room-view.ts`). It lists:
  - people and furniture nearby, ordered by distance, with any open, locked or
    contents state
  - exits and their doors
  - the NPC's inventory

  Every actionable thing appears with a stable ID, for example
  `Open the door [door_parlour]` or `Enter the Treasury [enter_treasury]`. Jev
  chooses an ID, never free text, so every decision is something the
  simulation can check.
- **Finishing.** On `complete`, the activity is cleared and the NPC returns to
  its routine. On `wait` or `unable`, a GM *outcome review* looks at what
  happened and can assign a new activity, a wait, or nothing.
- **Waiting.** A waiting NPC gets a Jev check every 12–18 seconds, fed by what
  it can currently see. Jev can continue, switch to one of the wait's
  activities (no GM call needed), or stop waiting, which asks the GM to
  reconsider.

**The world talks back.** Doors, room entries and finished conversations emit
world events. Characters within earshot roll to perceive them, and hear
clearly, partially or barely depending on distance and walls. Jev decides
whether what they perceived matters to them. If it does, a GM review can
interrupt them and revise their goals, for example a guard leaving their post
to investigate a break-in.

Code: `apps/web/src/world-action.ts`, `packages/conversation/src/action.ts`,
`packages/conversation/src/wait.ts`, `packages/conversation/src/activity-tools.ts`.
Details: [activities and waits](activity-waits.md),
[navigation](navigation.md), [map services](map-services.md).

## A worked example

You ask Magister Corvin to meet you in the treasury, and he agrees.

1. **Disclosure.** Before Corvin answers, Jev opens his notes on the treasury
   and on you, because their summaries are relevant. He hasn't been given
   access to the treasury's secrets, so they never reach Jev or the reply.
2. **Reply.** Corvin answers in his own voice: "Very well. I shall see you
   there."
3. **Attention.** Jev flags *immediate commitment*, with feasibility
   *possible*. Two background reviews start: the activity review writes "Meet
   the player in the treasury" with success criterion "greet the player after
   they arrive", and the memory review notes the promise in Corvin's memories.
4. **Planning.** When the conversation ends, Corvin is free to act. Jev reads
   the room view and picks `enter_great_hall`, then `door_treasury`, then
   `enter_treasury`. It replans after each step from what Corvin can now see.
5. **Waiting.** Corvin has arrived, but you haven't. Jev chooses `wait`. The
   outcome review gives him a wait: "Remain in the treasury. When you see the
   player here, stop waiting."
6. **Waking.** Every 12–18 seconds Jev checks the wait. When you walk in, it
   chooses `stop_waiting`. The GM reviews and sets an activity to greet you,
   and Jev picks the `talk` action. Corvin starts the conversation.

The live eval `npm run eval:wait` exercises this scenario end to end; see
[activities and waits](activity-waits.md).

## Where the cost goes

| Step | Model | When | Does the player wait? |
| --- | --- | --- | --- |
| Disclosure | Jev | Each round before a reply | Yes |
| Check classification | Jev | Each player turn | Yes |
| Dice ruling | GM | Only when a check is rolled | Yes (alongside the dice animation) |
| Character reply | Character model, no reasoning | Each turn | Yes |
| Tree conditions | Jev | Before and after a reply, if a tree is active | Yes |
| Attention | Jev | After each reply | Yes, but briefly |
| Focused reviews | GM, high reasoning | Only for flagged categories | No |
| Planning | Jev | Each step of an active goal | No |
| Wait checks | Jev | Every 12–18 s while waiting | No |
| Outcome and event reviews | GM | When a goal ends, or something relevant is perceived | No |

## Where to go next

- [ARCHITECTURE.md](../ARCHITECTURE.md): hooks, services and the two kinds of game state.
- [Conversation services](conversation-services.md): the hooks and services behind a conversation turn.
- [Document-backed world state](lore-world-state.md): how the vault becomes a saved world.
- [Activities and waits](activity-waits.md), [conversation trees](conversation-trees.md), [quest service](quest-service.md).
- [Working on Lore](../lore/Authoring/Working%20on%20Lore.md) and [Agent Disclosure](../lore/Authoring/Agent%20Disclosure.md): writing characters.
- [Evals](evals.md): how changes to these systems are measured.
