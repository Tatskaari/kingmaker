# The scene format (.kmscene, version 2)

A scene is one file, `campaigns/<campaign>/scenes/<id>.kmscene`: JSON that the game loads as it is and the Obsidian plugin edits as it is. There's no export step and no second copy. The file is GM prep, not a script. It says:
- who is here and what they want;
- what the player can find out (the **beats**), and the ways each can come out;
- what happens if the player dawdles;
- the only ways the scene can end.

The GM improvises everything in between. The format exists to serve the two-part GM ([two-part-design.md](two-part-design.md)):
- a **mouthpiece** voices the scene;
- a **co-GM** keeps each person's conversation role and moves the scene along its routes.

The envelope is the authoring plugin's, so its graph editor works on it unchanged:
- **nodes:** `{id, type: "story", position: {x, y}, data}`.
- **edges:** `{id, source, target, type: "smoothstep", label, data}`.
- **Game fields:** they sit in each node's or edge's `data`, and at the top level. Unknown keys are kept on save, never dropped.

## The file

```ts
interface SceneDocument {
  format: "kingmaker";
  version: 2;
  kind: "scene";
  /** The scene's id: a slug, the file's name without .kmscene. Game state keys on it; never rename a played scene. */
  id: string;
  title: string;
  /** One line for listings and the map ("A palace clerk hanged behind the granary, two foul-mouthed kids…"). */
  description: string;
  /** Lore notes about this place and its world (paths under the campaign's lore/): the GM's always-in docs. */
  lore: string[];

  // ---- When and where (the story and the map) ----
  time?: "morning" | "afternoon" | "evening" | "night" | "next-morning";
  /** The place's key: places/<key>.json, the world the stage manager keeps (areas, things, who stands where). */
  place?: string;
  /** Downtime between scenes, standing in for the map (the story skips it). */
  interlude?: boolean;
  rest?: "short" | "long";
  milestone?: boolean;

  // ---- The prep (prose, GM-facing unless it says otherwise) ----
  /** What the player knows walking in: player-facing (the map's lead, the between-scenes card). */
  hook: string;
  /** Where and when, in sensory detail. */
  setting: string;
  /** The dramatic question the scene answers, in a line. */
  premise: string;
  /** What really happened, behind the screen: never said outright, it comes out through the beats' paths. */
  truth: string;
  /** What happens if the player dawdles (the dead-cart at noon): the pressure, and its outer limit. */
  clock?: string;
  /** Tempting things that don't exist or can't work here, so the GM can say "no, but" honestly. */
  limits?: string[];
  /** What any local knows and a newcomer wouldn't (customs, prices, common talk). Never a secret. */
  known?: string[];

  cast: CastMember[];
  /** Fact ids → the sentence the GM is told when the fact is settled (by a beat or a route). Effects test them (if/unless established). */
  facts?: Record<string, string>;

  // ---- Story wiring (unchanged from the campaign format before it) ----
  /** Facts carried in from earlier scenes. */
  background?: string[];
  /** What the prep takes for granted, and where the story goes instead if play has overtaken it. */
  assumes?: string[];
  overtaken?: string;
  /** Effects on every ending, before the ending's own (Kell walks with the player after the granary). */
  onEnd?: Effect[];
  /** World ops applied to the place as the scene ends, whatever the ending (the body taken away). */
  afterwards?: WorldOpData[];
  /** The GM-only fronts doc for this scene's world. */
  fronts?: string;
  /** A talk's: the companion's cast id (only in the talk template). */
  companion?: string;

  nodes: SceneNode[];
  edges: Route[];
}
```

### The cast

```ts
interface CastMember {
  /** A slug; the GM sees it in square brackets. */
  id: string;
  name: string;
  /** What the player calls them until they've heard the name ("the boy in the too-big boots"). */
  called?: string;
  aka?: string[];
  /** Their lore note in the campaign's lore/ (Cast/Cob/public.md): the plugin links it, the GM's memory lives beside it. */
  lore?: string;
  /** Appearance and manner, for narration. */
  look: string;
  voice: string;
  wants: string;
  fears?: string;
  /** Why they're in this scene, now. */
  whyHere: string;
  /** What they know and will share when it makes sense. */
  knows: string[];
  /**
   * What they keep back. For each: how it shows, what pulls them both ways,
   * what opens it, and the first thing they'd say.
   */
  secrets?: string[];
  /** How they meet the player, and what moves them either way. */
  attitude: string;
  /** What never works on them and what they never do ("coin buys boasts, not trust; he never names the big man"). */
  limits?: string;
  /**
   * The co-GM's palette for their conversation role (the user's pacing ladder):
   * - how they're characterised;
   * - the inconsistency that invites a question;
   * - the hooks they offer.
   * The clues they can give are the beats' paths `via` them.
   */
  roles?: { characterise?: string; inconsistency?: string; hooks?: string };
  /** The node where they arrive (an event beat); present from the start when omitted. */
  enters?: string;
  /** A group voiced through its leader, and its members (as before). */
  group?: string;
  members?: Array<{ id: string; name: string; statblock?: string; weapon?: string; look?: string }>;
  /** Rules stats when the rules need them: an SRD statblock id and weapon id. */
  statblock?: string;
  weapon?: string;
}
```

### Nodes

Every node is `{ id, type: "story", position: {x, y}, data }`. The `id` is a slug that is unique in the scene. Its `data.kind` is one of three:

```ts
/** Where the scene opens. There's exactly one. It is always "reached", so its routes are open all scene long. */
interface StartData {
  kind: "start";
  title: string;
  /**
   * The opening:
   * - the situation the player walks into;
   * - the suggested ways into it;
   * - how to play the people here;
   * - an opening image.
   */
  description: string;
  /** Each person's conversation role at the start (the co-GM's first note). */
  cast?: Record<string, string>;
  lore: string[];
}

/**
 * A beat. It is one of two kinds:
 * - With a `revelation`, it's a discovery: something the player can come to understand,
 *   in any order with the others, by any of its paths.
 * - Without one, it's an event: a turn the scene takes (the dead-cart arrives), and the
 *   scene's new situation from then on.
 */
interface BeatData {
  kind: "beat";
  title: string;
  /** What the beat is for and how to play it. For an event: what happens and what it puts to the player. */
  description: string;
  /** A discovery's: what the player comes to understand, in a sentence or two. */
  revelation?: string;
  /** A discovery's suggested revelation paths: examples, not a sequence. Other plausible ways count too. */
  paths?: Path[];
  /** The scene can't end well without it (the lead to the next scene). Give it at least three paths, at least one needing no dice. */
  required?: boolean;
  /** Fact ids settled when the beat is reached. */
  establishes?: string[];
  /**
   * When the rest of the story needs it too:
   * - what it opens up;
   * - what later needs it;
   * - the things in the place it's in.
   * Missed, the story owes it the player in the next scene that can hold it.
   */
  carry?: { unlocks: string; later?: string; things?: string[] };
  /** An event's: each person's conversation role while the scene is here (the co-GM's suggestions). */
  cast?: Record<string, string>;
  /** An event's: what the world does if it stalls here. */
  pressure?: string;
  lore: string[];
}

/** One way a discovery can come out. */
interface Path {
  /** Who or what holds it: a cast id, or a thing or place in a few words ("the body", "the tally loft"). */
  via: string;
  /** What's there to find or hear, concretely. */
  clue: string;
  /** What earns it: free to a look, a kindness, a promise, getting up there, a roll. Say when it's free. */
  earn: string;
  /** What it amounts to as evidence. */
  strength: "hook" | "suggestive" | "strong" | "proof";
  /** A roll that suits the attempt (the mouthpiece uses it when the player tries this path and the outcome is uncertain). */
  check?: { skill: Skill; dc: number };
}

/** An ending. The scene closes on it with the next reply (which may wait once). */
interface EndingData {
  kind: "exit";
  title: string;
  /** What is true if the scene ends this way. */
  description: string;
  /** How the GM should close it: the feeling, the last image. */
  closing: string;
  /** How it went for the player: a good ending, a mixed one, or a bad one. QA counts good and mixed endings reachable. */
  result: "good" | "mixed" | "bad";
  /** The story's kind of ending (combat ends in a fight, before the scene picks up again). */
  exitKind: "combat" | "persuaded" | "progress" | "leave" | "other";
  /** The scene the story goes on to (an interlude or a scene id). None at the story's end. */
  next?: string;
  /** What ending this way does to the story and the world (quests, flags, attitudes, memories, journal, follow, promises, world ops). */
  effects?: Effect[];
  lore: string[];
}
```

### Routes (edges)

```ts
interface Route {
  /** A slug, unique in the scene. The co-GM sees it in square brackets and moves the scene by it. */
  id: string;
  /** Node ids: the start, a beat, an ending. */
  source: string;
  target: string;
  type: "smoothstep";
  /** The route's name on the graph. */
  label: string;
  data: {
    /**
     * What has to have happened in the story to take it, in prose.
     * Into a discovery it may be empty: the route is taken when the revelation has landed.
     */
    condition: string;
    /**
     * - "outcome": judged on what has happened (the default).
     * - "cue": a moment (the noon bell, the player setting off) that the co-GM
     *   brings about when it comes.
     */
    phase: "outcome" | "cue";
    /** Beats that must have been reached first (the endings' evidence, the lead). The runtime refuses the route until they are. */
    requires?: string[];
    /**
     * The dice decide it: when the player attempts what the condition says, the
     * mouthpiece calls this check. Success takes the route; failure goes to
     * `onFailure`, or leaves the scene where it is. Empty: no dice.
     */
    skill: Skill | "";
    dc: number;
    onFailure?: string;
    /** Fact ids settled when it's taken. */
    establishes?: string[];
  };
}
```

## What it means in play

- **Reached.** The scene keeps the set of nodes it has reached, in order. The start is reached as the scene opens.
  - A discovery is reached when the co-GM takes a route into it, which happens when its revelation has landed with the player.
  - An event beat is reached when the co-GM takes a route into it. It becomes the scene's **stage**, and its people arrive (`enters`).
  - An ending is reached when the co-GM takes a route into it. The scene closes on the next reply, which may wait once if the player has just started something the ending has to answer.
- **Open routes.** A route is open when three things hold:
  - its source is reached;
  - its target isn't;
  - every beat in its `requires` is.

  The start is always reached, so its routes are open all scene long. That's how discoveries happen in any order, and how a last-resort ending stays available. Once an ending is reached, nothing is open: the scene is closing.
- **Taking a route.** A route with dice is taken on its check's outcome: a success goes to its target, a failure to its `onFailure` or nowhere (the scene stays where it is, and the route stays open to try again). A route without dice can't fail: it's taken once its condition has happened.
- **The stage.** The latest reached of the start and the event beats. Its `cast` notes are the co-GM's suggested roles, and its `pressure` is what the world does when the scene stalls.
- **The targets.** The discoveries not yet reached, each with its paths. The GM steers towards them through the people's roles.
- **Facts.** A reached beat's and a taken route's `establishes` are settled (a dice route's on a success). The GM is told their sentences, and the endings' effects test them.
- **Carried beats.** A beat with `carry` that the scene ends without is owed to the player by the story, as the campaign's essentials were before. One the scene reaches is owed no more. While it's owed, its `things` go on with whoever holds them into the next scene that can hold it (the page in Cob's boot); a scene ended for QA (`thorough`) takes the things of the discoveries it reaches into the player's hands.
- **Effects.** As the scene ends, `onEnd`'s effects and then the ending's apply, each when its facts hold (`if` all established, `unless` none). The story's (quest, flag, attitude, journal, follow) write the story. The world's (give, remove, move, create, note…) change the scene's place as the stage manager's do: a give puts the thing in the player's keeping (`$player`) or a person's, and a remove takes someone or something off the place. They name things by their ids in the place, and one whose thing isn't there isn't done (the game logs it). What the player holds then goes on with them into the next scene. `remember`, `promise` and a combat ending's `startFight` are recorded.

The game's code for this is shared by the simulation and the AI service: [shared/scene/document.ts](../shared/scene/document.ts) parses a file (its shape and what it refers to; the install refuses a file that isn't one), [load.ts](../shared/scene/load.ts) makes the runtime's Scene from it, and [beats.ts](../shared/scene/beats.ts) has the semantics above (`reachedOf`, `stageOf`, `targetsOf`, `openRoutes`, `takeRoute`).

## Rules the campaign check enforces

`npm run campaign -- check campaigns/<campaign>` ([campaigns/README.md](../campaigns/README.md)) holds each scene to these, once its file has the shape above:

- Ids are slugs (`[a-z0-9][a-z0-9-]*`) and unique within the scene (nodes and routes separately; the cast's too, but the talk template's `{companion}`). The scene's id is its file's name. There's exactly one start.
- The prose is there: a title, description, hook, setting, premise and truth (an interlude needs no premise or truth); each person's name, look, voice, wants, whyHere and attitude; each node's title and description; each ending's closing. Every lore path (the scene's, its fronts, its people's, its nodes') is in the campaign's `lore/`.
- Every edge's source and target exist. No route leaves an ending. Every `requires` names a beat. Only a route into a discovery may have an empty condition.
- Every beat and ending can be reached from the start, a route opening once its source and everything it requires are reached. Every scene but the talk template has a `good` or `mixed` ending among them (no route leaves a `bad` one, so it's reached without one).
- A discovery has a `revelation` and at least two paths, each with a `via`, a `clue` and an `earn`; a `via` of one word names a cast id. A `required` one has at least three paths, at least one with no check. A beat with paths has a revelation.
- A revelation is never locked behind one roll: at least one route into each discovery has no dice.
- Endings that need evidence say so in `requires`, not only in prose: in a scene with a `required` discovery, every route into a `good` ending requires at least one beat, and each required discovery is required by at least one of them.
- Every `enters` names an event beat, every `cast` note is for someone in the cast, and every `onFailure` names a node.
- An ending with `next` names a scene of the campaign.
- A beat's carried `things` are things of its place, or carried by another scene of the campaign (Prout's page comes into the Rat in Cob's boot).
- Effects only use the ops the story knows (quest, flag, attitude, remember, journal, follow, promise, startFight, and the world's ops), their `if`/`unless` name facts, and the people, quests and things they name exist (the cast, campaign.json's quests, the place's areas and things, and what the story carries between scenes). A combat ending's `startFight` is recorded for when fights are built: keep it.
- The talk template (`kind: "scene"` with `companion`) is checked by the talk's own rules: its `companion` is `{companion}` and its first cast entry the companion's (`{companion}`, named `{name}`); it has an event beat `told` and an ending `goodbye`, and no place; and everyone the story has walk with the player has a lore entry to talk from. In the game, a talk's ways into `goodbye` are the player's attempt, judged before the reply from either beat, and its way into `told` is the talk's own, worded for each talk from what it may bring out: the template's route there stands for it in the file.
