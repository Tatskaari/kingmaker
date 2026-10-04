import { renderPrompt } from "../../prompts/src/index.js";
import type { AiService } from "../../conversation/src/services.js";
import type { JevQuestions } from "../../providers/src/jev.js";
import { validateRubric, type Criterion, type ScoreLevel, type Result, type RunRecording, type ScoreContext } from "./experiment.js";

/** Anchored quality ratings, not the judge's confidence or a binary pass rate. */
export const accuracyLevels: Record<string, ScoreLevel> = {
  incorrect: { score: 0, description: "0%: Required behavior is absent or fundamentally incorrect." },
  limited: { score: 0.25, description: "25%: A small part is correct, but major errors or omissions dominate." },
  partial: { score: 0.5, description: "50%: Substantial correct behavior, with equally substantial errors or omissions." },
  mostly: { score: 0.75, description: "75%: Most required behavior is correct; limited errors or omissions remain." },
  complete: { score: 1, description: "100%: All applicable requirements are accurately satisfied, with no material errors or omissions." },
};

/** A fixed judge sees evidence and rubric only; its AI calls have a separate recording. */
export function createJevScorer(rubric: readonly Criterion[], evidence: (recording: RunRecording) => unknown,
  ai: Pick<AiService, "decisions">) {
  validateRubric(rubric);
  const questions: JevQuestions = Object.fromEntries(rubric.map((criterion, index) => [`criterion_${index}`, {
    type: "choice", instructions: renderPrompt("jev-scorer-1", { value1: criterion.description }),
    criteria: { ...Object.fromEntries(Object.entries(criterion.levels ?? accuracyLevels).map(([name, level]) => [name, level.description])),
      unscorable: renderPrompt("jev-scorer-2") },
  }]));
  return async (recording: RunRecording, context: ScoreContext): Promise<Result> => {
    const answers = await context.recording.wrap("ai", ai).decisions(evidence(recording), questions, context.signal);
    return { criteria: Object.fromEntries(rubric.map((criterion, index) => {
      const answer = answers[`criterion_${index}`];
      const levels = criterion.levels ?? accuracyLevels;
      if (!answer || !Object.hasOwn(levels, answer.choice)) throw new Error(`Missing or unscorable judge answer: ${criterion.name}`);
      const level = levels[answer.choice]!;
      return [criterion.name, { score: level.score,
        reason: level.description, probabilities: answer.probabilities }];
    })) };
  };
}
