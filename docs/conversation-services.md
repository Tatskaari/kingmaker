# Conversation hooks and services

Status: conversation phases, host wiring and parallel dice/GM resolution implemented.
The compiled interfaces live in `packages/conversation/src/services.ts`, with the
constructor in `packages/conversation/src/runtime.ts`. The CLI, browser and
headless player conversation paths use `runConversation` from `phases.ts`.
Unprovided service operations throw `UnimplementedServiceError`; each host supplies
only the methods it needs. The CLI provides disclosure hooks and the browser and
headless game provide hooks around their existing check policy. The rest of the
game runtime is not migrated to these services.

```ts
const runtime = new ConversationRuntime({
  services: {
    ai: { responses: (request, signal) => client.complete(request, signal) },
  },
});
// Only ai.responses is implemented; other operations still fail explicitly.
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
