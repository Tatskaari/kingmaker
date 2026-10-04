# Conversation hooks and services

Status: conversation phases, host wiring and parallel dice/GM resolution implemented.
The compiled interfaces live in `packages/conversation/src/services.ts`, with the
constructor in `packages/conversation/src/runtime.ts`. The CLI, browser and
headless player conversation paths use `runConversation` from `phases.ts`.
Unprovided service operations throw `UnimplementedServiceError`; each host supplies
only the methods it needs. The CLI provides disclosure hooks and the browser and
headless game provide hooks around their existing check policy. The rest of the
legacy game runtime adapts its provider classifiers through the same AI service.
The document-world runtime uses these services for dialogue, reviews, NPC actions
and event reactions.

```ts
const runtime = new ConversationRuntime({
  services: {
    ai: aiService(client, jev),
  },
});
// Responses and decisions use the shared adapter; other services are host supplied.
```

Hooks own the flow, services perform operations, and the runtime owns conversation
state. Construction injects the hooks and services so browser, terminal and
headless implementations can share the same conversation function.

## Turn phases

```ts
async function converse(turn, runtime, signal) {
  const context = runtime.context.forTurn(turn);

  while (true) {
    const labels = await runtime.hooks.conversation.classify(context, signal);
    const result = await runtime.hooks.conversation.resolve(context, labels, signal);
    if (!result.reclassify) break;
  }

  return runtime.services.character.respond({ messages: context.messages }, signal);
}
```

Classification only returns what Jev wants to do. It does not open documents,
roll dice, update portraits or modify context. Classifiers contribute typed labels
to a shared result; resolvers can use labels produced by any classifier.

Resolution performs effects and applies context changes. If documents need
opening, open them and request reclassification against the expanded context.
Defer dice decisions from that pass until the knowledge is settled. Reclassification
produces fresh labels; opened documents and completed actions remain recorded so
later passes do not reopen notes or reroll completed checks. Bound the loop and
context size; exceeding a limit is an error, not permission to reply prematurely.

```ts
interface ConversationHooks {
  classify(
    context: Readonly<ConversationContext>,
    signal: AbortSignal,
  ): Promise<ConversationLabels>;

  resolve(
    context: ConversationContext,
    labels: Readonly<ConversationLabels>,
    signal: AbortSignal,
  ): Promise<{ reclassify: boolean }>;
}
```

The runtime coordinates context updates in a stable order. The context includes
the current player turn, transcript, opened Markdown, added system messages and
completed actions. Labels contain decisions and their parameters, such as check
plans, document links and portrait expressions. Exact label composition and
conflict handling between classifiers remain implementation details to review.

## Injected services

The interfaces below describe the design; the compiled declarations are authoritative.
The initial lore service is scoped to one character/scenario and reuses the existing
loader's synchronous initial documents and link discovery, with asynchronous open.
Request/response types should reuse existing provider and domain types where they
fit. `AbortSignal` carries cancellation through model requests and UI interactions.

```ts
interface RuntimeServices {
  ai: AiService;
  lore: LoreService;
  character: CharacterService;
  presentation: PresentationService;
  random: RandomService;
  debug: DebugService;
}

interface AiService {
  decisions(request: DecisionRequest, signal: AbortSignal): Promise<DecisionResponse>;
  responses(request: ResponseRequest, signal: AbortSignal): Promise<ResponseMessage>;
}

interface LoreService {
  initial(characterId: string, scenarioId: string): Promise<LoreDocument[]>;
  links(documents: readonly LoreDocument[]): readonly LoreLink[];
  open(characterId: string, link: LoreLink, signal: AbortSignal): Promise<LoreDocument>;
}

interface CharacterService {
  rollCheck(request: AbilityCheckRequest, signal: AbortSignal): Promise<RollResult>;
  rollSave(request: SavingThrowRequest, signal: AbortSignal): Promise<RollResult>;
  respond(request: CharacterResponseRequest, signal: AbortSignal): Promise<CharacterReply>;
}

interface AbilityCheckRequest {
  characterId: string;
  skill: CheckSkill;
  difficulty: Difficulty;
}

interface SavingThrowRequest {
  characterId: string;
  ability: Ability;
  difficulty: Difficulty;
}

type Difficulty =
  | "trivial" | "very_easy" | "easy" | "normal"
  | "hard" | "very_hard" | "impossible";

interface PresentationService {
  showRoll(result: Readonly<RollResult>, signal: AbortSignal): Promise<void>;
  setPortrait(characterId: string, expression: PortraitExpression, signal: AbortSignal): Promise<void>;
}

interface RandomService {
  integer(minInclusive: number, maxInclusive: number): number;
}

interface DebugService {
  record(event: ConversationDebugEvent): void;
}
```

- **AI:** thin adapters for the decision and responses APIs. Hooks supply questions
  and prompts. Tests can inject fixed or recorded responses.
- **Lore:** discovers references separately from opening their targets. The service
  handles link resolution and permissions; the runtime tracks opened documents.
- **Character:** provides mechanics and dialogue operations. `runtime.character`
  can reference `runtime.services.character`. The default implementation gets
  modifiers from current game state, uses randomness and applies rules. The
  resolver coordinates presentation separately. `respond` uses the AI service with the prepared messages.
- **Presentation:** renders authoritative outcomes without calculating them.
  `showRoll` resolves when the interaction completes and rejects on cancellation.
  Headless presentation completes immediately. Portrait implementation can wait.
- **Randomness:** supports production randomness and deterministic test rolls
  independently of AI and rendering.
- **Debug:** records structured inputs, outputs, context changes and errors with
  turn/pass identifiers for the RHS or headless traces. Observers do not control
  the flow. Secrets such as API keys must not enter trace events.

Context management and action tracking belong to the runtime, rather than an
additional injected service. Preparing GM outcome instructions belongs to the
replaceable dice resolver using `ai.responses`; a separate GM service is not
needed initially.

## Dice resolution

1. Jev identifies whether a check is needed.
2. Jev selects the skill and difficulty category.
3. Resolution generates the authoritative dice results immediately.
4. Presentation animates those results while the GM prepares one direction using
   the actual outcomes. Wait for both, then add the direction as a system message.

All checks are rolled before either asynchronous operation starts. Multiple dice
popups appear sequentially while one GM request covers the complete result set.
The result is fixed before animation; presentation cannot alter it. A failed GM
request or cancelled popup cancels its sibling and prevents the character reply.
The AI response service retries transient provider/network failures and timeouts
once; truncated output retries with twice the token budget. The resolver contains
no retry policy. During a retry, the existing dice results and presentation remain
in place. Cancellation and non-retryable provider errors propagate immediately.

Very easy, easy, normal, hard and very hard use DCs 5, 10, 15, 20 and 25. Trivial
only fails on natural 1; impossible only succeeds on natural 20. Their effective
DCs are modifier + 2 and modifier + 20 respectively, enforcing those endpoints
while retaining existing degree-of-success calculations. The UI names the category.

`RollResult` includes the natural roll, modifier, difficulty, success and outcome
category. The existing seven outcome categories remain in use. Jev selects
categories before any dice are generated; the GM no longer sets numeric DCs or
prepares hypothetical outcome directions.

## Composition and verification

```ts
const runtime = new ConversationRuntime({
  snapshot,
  services,
  hooks: {
    conversation: createConversationHooks({
      classifiers: [disclosureClassifier, checkClassifier],
      resolvers: [disclosureResolver, checkResolver],
    }),
  },
});
```

Replacing hooks changes the strategy; replacing services changes providers,
rendering or randomness. Headless checks should exercise the same classify,
resolve and respond loop, including recursive disclosure, shared labels, deferred
checks, deterministic rolls, selected system messages and cancellation. The RHS
should expose classification results, all prepared GM directions, the roll result
and the exact selected message. Browser presentation waits for acknowledgement;
headless presentation completes immediately. The CLI still uses disclosure hooks;
the check policy is installed in browser and headless player conversations.

## Conversation review

`runConversationReview` in `review.ts` runs one `hooks.review.classify` then
`hooks.review.resolve` pass over detached transcript evidence, including GM
rulings. Classification returns labels without changing the evidence; resolution
receives those labels and the complete transcript. `classifyConversationReview`
is an empty-label stub for future Jev classification, not a reason to skip review.
Errors and cancellation propagate; hosts archive transcripts only after success.

Review hooks receive the same injected services as turns as their final argument. `scenario` and `docs` reuse
`ScenarioService` and `DocsService` from `packages/lore/src/services.ts`, preserving
SHA-checked document writes. Hosts must supply an authoritative v2 service pair;
there is no implicit conversion from the existing v1 game. As with other services,
unprovided operations fail explicitly. A resolver can use `ai` for GM reasoning
and `debug` for observations without depending on browser presentation.

Browser/headless `endConversation` now uses this pipeline. Its default classifier
is the stub; its default resolver passes labels and full evidence to the existing
GM reconciliation via `services.ai.responses`. The current playable v1 host keeps
its existing resource/staged writes; it does not yet author v2 documents. Inject
`reviewOptions` when constructing `BrowserGameRuntime`, or the fourth argument of
`WorldHeadlessGame`; these dependencies survive forks and headless reloads. Either
phase can be overridden independently:

```ts
const reviewOptions = {
  services: { scenario, docs, ai },
  hooks: { review: {
    classify: classifyConversationReview,
    resolve: async (context, labels, signal, services) => {
      // Read/revise documents via services.docs, consulting services.ai as needed.
      return myReview(context, labels, signal, services);
    },
  } },
};
```

The host clears only the reviewed transcript after both phases succeed. Failed or
cancelled reviews retain evidence; successful incremental writes remain committed.
A transcript changed during review is not cleared. Review cancellation is accepted
by `endConversation` and forwarded to the model and the write boundaries.

## Action selection

After conversation review commits an active goal, the game calls `runAction` with
its current observation. `hooks.action.classify` uses `services.ai.decisions`;
`hooks.action.resolve` returns a concrete `GameAction` or a terminal judgment
(`complete`, `wait`, `unable`). Neither phase executes movement or changes world
state. `jevActionHooks` is the shared implementation; hosts may replace either
phase through runtime options. Missing operations fail explicitly.

The browser and headless planner use these hooks, retaining the existing request
context, action limit, transcripts and generation checks. The game executes the
command and requests a fresh decision after it finishes. Outcome review remains
separate. Hook options survive runtime forks and headless reloads.

### Document-based conversation review

For a v2 host, inject `documentReviewHooks` as `hooks.review`. Its resolver uses
`services.ai.responses`, `services.scenario` and `services.docs` to append private
conversation notes and update the scenario character document's `activity` and
`wait` references. `set_activity`, `set_wait` and `clear_activity` stage intent;
`commit_review` publishes related documents and notes atomically through
`docs.commit`. On a SHA conflict the model receives refreshed character state
and must restage its edits. Static cast lore and physical properties are preserved.
See [Character activities and waits](activity-waits.md) for file formats and tools.

### V2 review-to-action host

The palace adapter `apps/web/src/world-action.ts` accepts a runtime with the v2
scenario/document services and these hooks:

```ts
const runtime = new ConversationRuntime({
  services: { ...createScenarioServices(world), ai },
  hooks: { review: documentReviewHooks, action: jevActionHooks },
});
const { review, plan } = await reviewAndPlanWorldAction(evidence, runtime, signal);
```

Review completes before the planner reads the activity document's `current_goal`.
Without an activity, the action planner skips Jev. A plan contains a concrete
action or terminal decision and the goal; it does not execute anything. The host
validates generation IDs before executing physical commands. Pass completed
action IDs to subsequent `planWorldAction` calls to retain history and enforce
the 24-action bound. `wait` requests an LLM-authored wait, while `complete` returns
to the sibling routine document. The worker independently polls wait documents
at jittered 15-second intervals, validating document hashes and observations
before applying their decisions.

The adapter uses the v2 map and typed character inventories to enumerate the
existing palace actions through a temporary mechanics projection. It does not
create v1 saved characters or infer physical facts from Markdown. The map must
place the selected character using its scenario directory ID; the existing
palace uses `player` for the player actor. Supply a map whose actors match the
selected cast. Jev receives only the character's permitted entry/private bodies,
its goal and the filtered room view, not the complete GM document graph or other
characters' private properties. No saved-game migration is introduced.

## AI request correlation

`aiService` is the provider transport boundary for browser, CLI and live evaluation
entrypoints. Older classifiers use `decisionClient(ai)` to reach this boundary.
Provider implementations and provider unit tests can call their own transports;
gameplay code should use `services.ai`.

The document-world host and conversation CLI wrap this boundary with
`traceAiService`. Each captured request has:

- `characterId`: the subject of this particular request; the parent character scope.
- `participantIds`: characters involved in the operation, including both NPCs in an exchange.
- `conversationId`: the conversation or execution session, shared across its calls.
- `turnId`: one player turn, closing review, or NPC operation within that session.
- `spanId`: a unique request/response pair, including failures and response retries.
- `operation`, scenario, and (in the game host) world generation and character position.

Dialogue, disclosure, skill checks and GM rulings share one turn. Closing review
has its own turn in the same conversation. Starting another conversation creates
a new conversation ID. Forks share the recorder and conversation identity; each
call captures its own context so concurrent characters cannot overwrite it.
Response retry attempts have separate spans with the same turn ID. Provider-level
rate-limit recovery remains inside its service-call span.

Context is metadata, never extra model instructions or provider payload fields.
The recorder redacts secrets and retains failed calls independently of rollback.
Debug history is session-local: it is not saved or migrated with games. The browser
keeps 50 completed sessions plus active sessions and 50 recent calls; the CLI exports
its retained requests and sessions alongside the conversation artifact.

The character inspector includes calls owned by, or explicitly involving, that
character. It filters individual calls inside sessions as well as standalone calls.
Its chronological menu includes dialogue, decisions and reviews; selecting a call
shows the response, request messages and correlation context.


## Shared progressive disclosure

`ProgressiveDisclosure.disclose(docs, context, signal, options?)` accepts a scoped
`LoreService` and task messages containing its initial document bodies. It returns
only new system messages, recursively opening relevant links until context is
sufficient. The source owns access checks; the engine uses summaries to select
links and never treats a link as a permission grant. Limits and cancellation fail
without returning partial context. AI transport stays in `services.ai`; retrieval
is independently injectable as `services.disclosure`.

Conversation hooks adapt the same traversal one round at a time for player replies
and NPC-initiated openings, retaining opened notes and running any checks only
after disclosure finishes. Planning, reviews, perceived-event attention and NPC
exchanges use the complete disclosure operation before their final decision or response. Each NPC
speaker and each review gets a separate character-scoped source. Review writes
and action execution happen after retrieval, outside its recursive loop.

Disclosure decisions retain the `prog_disc` trace purpose and the requesting
character's identity, including the recipient's calls during shared NPC exchanges.

## Agent setup

`hooks.setup(context, signal, services)` prepares an agent's messages before
execution. Context identifies the agent role and character and carries task
messages plus an optional already-scoped lore source or initial documents.
The default `setupAgent` supplies character/GM instructions and can retrieve
character lore and run disclosure through the injected services. A host can
replace it or call `setupAgent` and extend its result.

`services.agents.prepare` dispatches to this hook and checks cancellation before
and after setup. This facade lets resolvers and nested GM calls use the host's
policy without depending on a particular runtime instance. Supplying that service
explicitly overrides dispatch; forwarding it to a nested runtime preserves the
parent policy. Setup runs before model execution, not inside provider retries.
Player dialogue retains its classify/resolve disclosure loop. The synchronous
`conversationRequest` helper remains a default-policy preview for CLI displays;
actual turns use `prepareConversation` and the setup hook.

NPC exchange speakers, action planning, wait decisions, event attention and the
Stranger interview also use this setup policy, with distinct `agent` values.
Their default hook resolves fresh scoped lore using `services.lore.forCharacter`
(the Stranger supplies its GM-scoped source) and completes disclosure before
execution. Review still refreshes character evidence between GM tool turns,
keeping that evidence in user messages and preserving all custom system messages.

The browser/headless host installs `setupWorldAgent` by default. For character
replies, NPC openings and NPC exchanges, it reads the map and scenario services
to add current bystanders grouped by Clear, Moderate and Distant earshot. Active
participants are excluded; door obstruction and distinct body IDs follow the
existing earshot rules. The warning is context for speech, not a perception event
or a claim that anyone learned it. Override `hooks.setup` to replace this policy,
or delegate to `setupWorldAgent` to retain the earshot warning.
