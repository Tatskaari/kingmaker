# Conversation hooks and services

Status: service scaffolding implemented; conversation flow remains a proposal.
The compiled interfaces live in `packages/conversation/src/services.ts`, with the
constructor in `packages/conversation/src/runtime.ts`. No existing caller uses
this runtime yet. Every default operation throws `UnimplementedServiceError`;
individual methods can be supplied during construction as they are implemented.

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
  modifiers from current game state, uses injected randomness, applies rules and
  awaits presentation. `respond` uses the AI service with the prepared messages.
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
3. Resolution starts the dice interaction and asks the GM to prepare directions
   for every possible outcome concurrently.
4. When both complete, select the direction matching the actual outcome and add
   it as a system message before the character responds.

```ts
const [result, outcomes] = await Promise.all([
  runtime.character.rollCheck(check, signal),
  prepareOutcomeDirections(context, check, runtime.services.ai, signal),
]);

context.addSystemMessage(outcomes[result.outcome]);
```

`RollResult` includes the natural roll, modifier, difficulty, success and outcome
category. Use the existing seven outcome categories initially: critical failure,
major failure, minor failure, barely passes, minor success, major success and
critical success. The GM receives the plan and context, not the actual result;
validate its complete outcome map before selecting a direction.

Trivial succeeds unless the natural roll is 1. Impossible fails unless the natural
roll is 20. Encode those rules explicitly rather than using extreme numeric DCs.
The middle categories use configured DCs and character modifiers. Their numeric
mapping and endpoint degree mapping still need agreement before implementation.

The resolver must cancel the sibling operation if either parallel operation fails;
`Promise.all` alone does not cancel it. A cancelled roll or failed GM preparation
prevents a character reply. Resolution must retain enough action state to avoid
rerolling a completed check during reclassification.

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
and the exact selected message. Those flow changes are not implemented by the
service scaffolding; no provider, mechanics or presentation implementation is
installed by default, including in headless mode.
