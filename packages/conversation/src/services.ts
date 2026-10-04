import type { AgentSetupContext } from "./agent-setup.js";
import type { ProgressiveDisclosure } from "./progressive-disclosure.js";
import type { MapService, MapObservation, MapResult } from "./map.js";
import type { CharacterCreationService, DocsService, ScenarioService } from "../../lore/src/services.js";
import type { CheckDegree, CheckSkill, skillAbilities } from "../../core/src/ability-checks.js";
import type { PortraitExpression } from "../../providers/src/conversation-expression.js";
import type { JevChoice, JevQuestions } from "../../providers/src/jev.js";
import type { ChatCompletionRequest, OpenRouterMessage, TextProgress } from "../../providers/src/openrouter.js";
import type { CharacterSources, LoreDocument } from "./conversation.js";
import type { LoreLink } from "./lore.js";

export interface AiRequestInfo { characterId?: string; purpose?: "gm_consultation" | "dialogue"; onText?: TextProgress }
export interface DecisionRequestInfo {
  characterId?: string;
  disclosure?: { threshold: number; candidates: (LoreLink & { id: string })[] };
}
export interface AiService {
  decisions(state: unknown, questions: JevQuestions, signal: AbortSignal, purpose?: "skill_check" | "skill_difficulty" | "prog_disc" | "conversation_attention", info?: DecisionRequestInfo): Promise<Record<string, JevChoice>>;
  responses(request: ChatCompletionRequest, signal?: AbortSignal, info?: AiRequestInfo): Promise<OpenRouterMessage>;
}

/** Scoped to one character/scenario at construction; access checks remain in the loader. */
export interface LoreService {
  readonly initial: CharacterSources;
  links(opened: CharacterSources): readonly LoreLink[];
  open(link: LoreLink, signal: AbortSignal): Promise<LoreDocument>;
}

export type Difficulty = "trivial" | "very_easy" | "easy" | "normal" | "hard" | "very_hard" | "impossible";
export type Ability = (typeof skillAbilities)[CheckSkill];
export interface AbilityCheckRequest {
  characterId: string;
  skill: CheckSkill;
  difficulty: Difficulty;
}
export interface SavingThrowRequest {
  characterId: string;
  ability: Ability;
  difficulty: Difficulty;
}
export interface RollResult {
  characterId: string;
  natural: number;
  modifier: number;
  total: number;
  difficulty: Difficulty;
  skill?: CheckSkill;
  /** Effective numeric target used to display the resolved check. */
  dc?: number;
  success: boolean;
  outcome: CheckDegree;
}

/** Mechanics determine the outcome; resolvers coordinate presentation separately. */
export interface CharacterMechanics {
  rollCheck(request: AbilityCheckRequest, signal: AbortSignal): Promise<RollResult>;
  rollSave(request: SavingThrowRequest, signal: AbortSignal): Promise<RollResult>;
}
export interface CharacterService extends CharacterMechanics, CharacterCreationService {
  respond(request: ChatCompletionRequest, signal?: AbortSignal): Promise<OpenRouterMessage>;
}
export interface PresentationService {
  renderMap(observation: Readonly<MapObservation>, result?: Readonly<MapResult>): Promise<void>;
  showRoll(result: Readonly<RollResult>, signal: AbortSignal): Promise<void>;
  setPortrait(characterId: string, expression: PortraitExpression, signal: AbortSignal): Promise<void>;
}
export interface RandomService {
  integer(minInclusive: number, maxInclusive: number): number;
}
export interface ConversationDebugEvent {
  turn: number;
  pass: number;
  source: string;
  stage: "classify" | "resolve" | "respond";
  status: "started" | "completed" | "failed";
  input?: unknown;
  output?: unknown;
  error?: string;
}
export interface DebugService {
  record(event: Readonly<ConversationDebugEvent>): void;
  documentUpdated?(event: DocumentUpdate): void;
}
/** Emitted only after a tool's document write has committed successfully. */
export interface DocumentUpdate {
  path: string;
  beforeSha: string;
  afterSha: string;
  response: OpenRouterMessage;
  toolCallId: string;
}
export interface RuntimeServices {
  readonly agents: {
    prepare(context: Readonly<AgentSetupContext>, signal: AbortSignal): Promise<OpenRouterMessage[]>;
  };
  readonly map: MapService;
  readonly scenario: ScenarioService;
  readonly docs: DocsService;
  readonly ai: AiService;
  readonly disclosure: Pick<ProgressiveDisclosure, "disclose">;
  readonly lore: LoreService & {
    /** Resolve a fresh character-scoped view, including each participant in an exchange. */
    forCharacter(characterId: string, signal: AbortSignal): Promise<LoreService>;
  };
  readonly character: CharacterService;
  readonly presentation: PresentationService;
  readonly random: RandomService;
  readonly debug: DebugService;
}
