import type { MapService, MapObservation, MapResult } from "./map.js";
import type { DocsService, ScenarioService } from "../../lore/src/services.js";
import type { CheckDegree, CheckSkill, skillAbilities } from "../../core/src/ability-checks.js";
import type { PortraitExpression } from "../../providers/src/conversation-expression.js";
import type { JevChoice, JevQuestions } from "../../providers/src/jev.js";
import type { ChatCompletionRequest, OpenRouterMessage } from "../../providers/src/openrouter.js";
import type { CharacterSources, LoreDocument } from "./conversation.js";
import type { LoreLink } from "./lore.js";

export interface AiRequestInfo { characterId?: string; purpose?: "gm_consultation" | "dialogue" }
export interface AiService {
  decisions(state: unknown, questions: JevQuestions, signal: AbortSignal, purpose?: "skill_check" | "skill_difficulty" | "prog_disc"): Promise<Record<string, JevChoice>>;
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
export interface CharacterService extends CharacterMechanics {
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
}
export interface RuntimeServices {
  readonly map: MapService;
  readonly scenario: ScenarioService;
  readonly docs: DocsService;
  readonly ai: AiService;
  readonly lore: LoreService;
  readonly character: CharacterService;
  readonly presentation: PresentationService;
  readonly random: RandomService;
  readonly debug: DebugService;
}
