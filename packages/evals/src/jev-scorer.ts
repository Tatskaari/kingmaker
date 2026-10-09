import { renderPrompt } from "./prompts.js";
import type { AiService } from "../../conversation/src/services.js";
import type { JevQuestions } from "../../providers/src/jev.js";
import { validateRubric, type Criterion, type ScoreLevel, type Result, type RunRecording, type ScoreContext } from "./experiment.js";

/** Anchored quality ratings, not the judge's confidence or a binary pass rate. */
export const accuracyLevels: Record<string, ScoreLevel> = {
  incorrect: { score: 0, description: renderPrompt("jev-scorer-description-1") },
  limited: { score: 0.25, description: renderPrompt("jev-scorer-description-2") },
  partial: { score: 0.5, description: renderPrompt("jev-scorer-description-3") },
  mostly: { score: 0.75, description: renderPrompt("jev-scorer-description-4") },
  complete: { score: 1, description: renderPrompt("jev-scorer-description-5") },
};

/** A fixed judge sees evidence and rubric only; its AI calls have a separate recording. */
export function createJevScorer(rubric: readonly Criterion[], evidence: (recording: RunRecording) => unknown,
  ai: Pick<AiService, "decisions">) {
  validateRubric(rubric);
  const questions: JevQuestions = Object.fromEntries(rubric.map((criterion, index) => [`criterion_${index}`, {
    type: "choice", instructions: renderPrompt("jev-scorer-instructions", { criterion: criterion.description }),
    criteria: { ...Object.fromEntries(Object.entries(criterion.levels ?? accuracyLevels).map(([name, level]) => [name, level.description])),
      unscorable: renderPrompt("jev-scorer-unscorable") },
  }]));
  return async (recording: RunRecording, context: ScoreContext): Promise<Result> => {
    const answers = await context.recording.wrap("ai", ai).decisions(evidence(recording), questions, context.signal);
    return { criteria: Object.fromEntries(rubric.map((criterion, index) => {
      const answer = answers[`criterion_${index}`];
      const levels = criterion.levels ?? accuracyLevels;
      if (!answer || !Object.hasOwn(levels, answer.choice)) return [criterion.name, { score: null,
        reason: `Missing or unscorable judge answer: ${criterion.name}`, ...(answer ? { probabilities: answer.probabilities } : {}) }];
      const level = levels[answer.choice]!;
      return [criterion.name, { score: level.score,
        reason: level.description, probabilities: answer.probabilities }];
    })) };
  };
}
