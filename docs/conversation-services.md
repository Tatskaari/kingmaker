# Conversation strategies, hooks and services

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

The conversation strategy has one hook: `respond(context, signal, services)`.
It owns preparation, model calls and any review required before returning a reply.
Other strategies retain their own hooks, such as setup's `prepare` and review's
`classify`/`resolve`. Hosts inject services and swap the complete conversation policy.

## Response hook

The shared `runConversation` dispatcher clones the request, checks cancellation,
and delegates once:

```ts
const reply = await runtime.strategies.conversation.respond(
  { request, maxPasses: runtime.maxPasses }, signal, services,
);
```

It checks cancellation again before returning. The dispatcher wraps the character
service to notify the host of each prepared model request for tracing and binding
GM ruling capture. It does not generate another reply after the hook returns.

```ts
interface ConversationStrategy {
  respond(
    context: { request: ConversationContext["request"]; maxPasses: number },
    signal: AbortSignal,
    services: RuntimeServices,
  ): Promise<OpenRouterMessage>;
}
```

The existing `conversationStrategy`, also used by browser and headless player dialogue,
finishes recursive lore disclosure, classifies and resolves skill checks once,
adds the binding dice ruling, calls `services.character.respond`, and runs Jev
attention analysis before returning the reply. Disclosure still enforces its pass
and context limits. Dice outcomes and label reporting are unchanged.

`DisclosureSession.strategy()` provides a disclosure-only response strategy for
NPC openings and the CLI without checks. `directConversationStrategy` delegates
straight to the character service. A replacement strategy can generate multiple
private drafts or return a fixed response without calling that service.

The main game supplies `liveConversationStrategy` as the response policy after
those disclosure and dice steps. Jev classifies a private draft; ordinary flags
queue a GM review using high reasoning, while `gms_discretion` requires GM approval and
consequence updates before release. A refusal adds system guidance and regenerates
the character reply without rerolling. Only the accepted reply is displayed.
Each conversation owns a review queue. The host drains it before the next turn.
Ending a live conversation releases the NPC to act on committed activity immediately,
without waiting for remaining reviews or running another full review. Pending
reviews continue in the background; later activity changes use the existing replan path. Conversations using a replacement strategy or with no live session still
use the post-conversation review. Reset/restore cancels the live session. GM review calls appear in
the model transcript panel. The strategy remains replaceable through the normal
runtime options; the CLI and eval harness can select it independently.

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
  services,
  strategies: {
    conversation: {
      respond: async ({ request }, signal, services) => {
        return services.character.respond(request, signal);
      },
    },
  },
});
```

Replacing `respond` changes the conversation policy; replacing services changes
providers, rendering or randomness. CLI, browser, headless and eval callers all
use this hook. Tests cover cancellation, prepared-request tracing, replacement
strategies, disclosure, dice and attention reporting. Fixed-transcript attention
evals run the shared attention classifier inside their own response strategy.

## Conversation review

`runConversationReview` in `review.ts` runs one `strategies.review.classify` then
`strategies.review.resolve` pass over detached transcript evidence, including GM
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
  strategies: { review: {
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
its current observation. `strategies.action.classify` uses `services.ai.decisions`;
`strategies.action.resolve` returns a concrete `GameAction` or a terminal judgment
(`complete`, `wait`, `unable`). Neither phase executes movement or changes world
state. `jevActionStrategy` is the shared implementation; hosts may replace either
phase through runtime options. Missing operations fail explicitly.

The browser and headless planner use these hooks, retaining the existing request
context, action limit, transcripts and generation checks. The game executes the
command and requests a fresh decision after it finishes. Outcome review remains
separate. Hook options survive runtime forks and headless reloads.

### Document-based conversation review

For a v2 host, inject `documentReviewStrategy` as `strategies.review`. Its resolver uses
`services.ai.responses`, `services.scenario` and `services.docs` to append private
conversation notes and update the scenario character document's `activity` and
`wait` references. `set_activity`, `set_wait` and `clear_activity` stage intent;
the host publishes staged intent atomically through `docs.commit` after the GM’s
final response. Memories use the ordinary document edit tools. On a SHA conflict the model receives refreshed character state
and must restage its edits. Static cast lore and physical properties are preserved.
See [Character activities and waits](activity-waits.md) for file formats and tools.

### V2 review-to-action host

The palace adapter `apps/web/src/world-action.ts` accepts a runtime with the v2
scenario/document services and these strategies:

```ts
const runtime = new ConversationRuntime({
  services: { ...createScenarioServices(world), ai },
  strategies: { review: documentReviewStrategy, action: jevActionStrategy },
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

`strategies.setup.prepare(context, signal, services)` prepares an agent's messages before
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
Player dialogue runs its disclosure loop inside the response strategy. The synchronous
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
to record initial bystanders grouped by Clear, Moderate and Distant earshot in the
conversation transcript, adding another context note only when listeners or
hearing levels change. Unchanged turns retain the existing note in history;
save/load preserves it and failed replies do not commit new notes. Active
participants are excluded; door obstruction and distinct body IDs follow the
existing earshot rules. The warning is context for speech, not a perception event
or a claim that anyone learned it. Override `strategies.setup.prepare` to replace this policy,
or delegate to `setupWorldAgent` to retain the earshot warning.
