import { fromJson } from "@bufbuild/protobuf";
import { ScenarioSchema } from "../../contracts/src/index.js";
import { BrowserGameRuntime } from "../../../apps/web/src/runtime.js";
import type { JevActionContextOptions } from "../../../apps/web/src/jev-room-view.js";
import { activateGoal, scoreJevAssessment, type JevTalkCall, type JevWorldEvalScenario } from "../../evals/src/jev-world-eval.js";

/** A single actor controlled by TypeScript instead of Jev. No model calls are made. */
export class HeadlessSession {
  #runtime: BrowserGameRuntime;
  #turn = 0;
  #terminalChoice: string | undefined;
  #talkCalls: JevTalkCall[] = [];
  #context: ReturnType<BrowserGameRuntime["npcDecisionContext"]> | undefined;

  constructor(private readonly definition: JevWorldEvalScenario, context?: JevActionContextOptions) {
    if (!Number.isInteger(definition.maxTurns ?? 24) || (definition.maxTurns ?? 24) < 1) {
      throw new Error("maxTurns must be a positive integer.");
    }
    let runtime = definition.createRuntime("");
    if (context) {
      const snapshot = runtime.snapshot();
      runtime = new BrowserGameRuntime(fromJson(ScenarioSchema, snapshot.scenario), "", snapshot,
        undefined, undefined, undefined, context);
    }
    activateGoal(runtime, definition);
    this.#runtime = runtime;
  }

  get status() { return this.#terminalChoice ?? "active"; }
  get turns() { return this.#turn; }

  /** The same state, instructions and selectable criteria that planNpc sends to Jev. */
  observe() {
    if (this.#terminalChoice) throw new Error(`Session ended: ${this.#terminalChoice}`);
    this.#context = this.#runtime.npcDecisionContext(this.definition.characterId);
    const { state, questions } = this.#context.request;
    return { state, instructions: questions.next!.instructions, choices: { ...questions.next!.criteria } };
  }

  /** Execute one choice, including all movement ticks, then return the next observation. */
  act(choice: string) {
    if (this.#terminalChoice) throw new Error(`Session ended: ${this.#terminalChoice}`);
    if (!this.#context) this.observe();
    const { observation, generations, request } = this.#context!;
    if (!Object.hasOwn(request.questions.next!.criteria, choice)) throw new Error(`Unavailable choice: ${choice}`);
    const { characterId } = this.definition;
    this.#turn++;
    this.#context = undefined;
    try {
      if (choice === "complete" || choice === "wait" || choice === "unable") {
        this.#runtime.finishNpcRun(characterId, choice, JSON.stringify({ choice }), generations);
        this.#terminalChoice = choice;
      } else {
        let expected = generations;
        while (true) {
          const step = this.#runtime.stepNpcAction(characterId, choice, observation.goal, expected);
          expected = step.generations;
          if (step.talkTarget) {
            const call = { characterId, targetId: step.talkTarget, actionId: choice, goal: observation.goal, turn: this.#turn };
            this.#talkCalls.push(call);
            if (!this.definition.mockTalk) { this.#terminalChoice = "requires_conversation"; break; }
            const response = this.definition.mockTalk(call);
            const snapshot = this.#runtime.snapshot();
            snapshot.npcActivities![characterId]!.history.push(response);
            (snapshot.npcActivities![characterId]!.actionIds ??= []).push(choice);
            this.#runtime.restore(snapshot);
            break;
          }
          if (step.done) break;
        }
      }
      const activity = this.#runtime.snapshot().npcActivities?.[characterId];
      if (!this.#terminalChoice && (this.#turn >= (this.definition.maxTurns ?? 24) || (activity?.history.length ?? 0) >= 24)) {
        this.#runtime.finishNpcRun(characterId, "limit", "Headless action limit reached.");
        this.#terminalChoice = "limit";
      }
      return { status: this.status, observation: this.#terminalChoice ? null : this.observe() };
    } catch (error) {
      // Movement may already have happened; do not allow a failed action to be silently retried.
      this.#terminalChoice = "error";
      throw error;
    }
  }

  /** Scoring is explicit and only available after play, so it cannot reveal hidden state mid-run. */
  result() {
    if (!this.#terminalChoice) throw new Error("Finish the session before scoring it.");
    const snapshot = this.#runtime.snapshot();
    const assessment = this.definition.evaluate({ scenario: fromJson(ScenarioSchema, snapshot.scenario),
      terminalChoice: this.#terminalChoice, talkCalls: structuredClone(this.#talkCalls),
      completedActionIds: snapshot.npcActivities?.[this.definition.characterId]?.actionIds ?? [] });
    if (this.#terminalChoice === "error") assessment.success = false;
    return { ...assessment, ...scoreJevAssessment(assessment), turns: this.#turn, terminalChoice: this.#terminalChoice };
  }
}
