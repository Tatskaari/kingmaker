import { clone, create } from "@bufbuild/protobuf";
import { WorldStateSchema, DocumentSchema, type WorldState } from "../../contracts/src/v2.js";
import { WorldGameRuntime, type WorldOptions } from "../../../apps/web/src/world-runtime.js";
import { activityGoal, characterIntent } from "../../lore/src/activity.js";
import { palaceNodes } from "../../../apps/web/src/palace-navigation.js";

/** Human-authored physical milestones, evaluated against real runtime state rather than another model. */
export async function runTreasuryWaitEval(source: WorldState, apiKey: string, options: WorldOptions = {}, progress = (_message: string) => {}) {
  const world = clone(WorldStateSchema, source), id = "corvin";
  const entry = world.characters.find(path => path.endsWith(`/Characters/${id}/character.md`))!;
  const routine = entry.replace("character.md", "routine.md");
  world.docs[routine] = create(DocumentSchema, { frontmatter: { summary: "Rest quietly between undertakings.", visibility: "private", readers: [`character:${id}`], activities: [] },
    body: "Rest quietly. Continue until a meaningful observed event warrants reconsideration." });
  const game = new WorldGameRuntime(world, apiKey, undefined, undefined, undefined, options);
  const signal = AbortSignal.timeout(300_000), trace: string[] = [];
  const milestones = { reachedTreasury: false, enteredWait: false, stayedWaiting: false, wokeOnArrival: false, returnedToRoutine: false };
  let error: string | undefined;
  try {
    await game.overrideActiveObjective(id, { name: "Meet the player in the treasury", status: "The player has not arrived. Go there and wait; do not seek the player elsewhere.",
      success_criteria: "You have waited in the treasury until the player arrives and then greeted them.", current_goal: "Go to the treasury and wait for the player." });
    for (let turn = 0; turn < 24; turn++) {
      const plan = await game.planNpc(id, signal);
      trace.push(plan.decision.choice); progress(`Action: ${plan.decision.choice}`);
      if (!plan.action) {
        game.finishNpcRun(id, plan.decision.choice as "complete" | "wait" | "unable", "Eval action result");
        milestones.reachedTreasury = game.world().simulation!.map!.actors.find(actor => actor.characterId === id)!.roomId === "treasury";
        await game.reviewNpcOutcome(id, true, signal);
        milestones.enteredWait = plan.decision.choice === "wait" && !!characterIntent(game.world(), id).wait && !activityGoal(game.world(), id);
        break;
      }
      for (let step = 0; step < 300; step++) {
        const result = game.stepNpcAction(id, plan.action.id, plan.goal);
        if (result.talkTarget) throw new Error("Character initiated a conversation instead of travelling to wait.");
        if (result.done) break;
        if (step === 299) throw new Error("Movement step limit exceeded.");
      }
    }
    if (!milestones.reachedTreasury || !milestones.enteredWait) throw new Error("Did not reach the treasury and enter a wait.");
    const wait = characterIntent(game.world(), id).wait;
    for (const elapsed of [15, 30]) {
      const choice = await game.checkWait(id, elapsed, signal); trace.push(`absent:${choice}`); progress(`Player absent: ${choice}`);
      if (choice !== "continue" || characterIntent(game.world(), id).wait !== wait || activityGoal(game.world(), id)) throw new Error("Left the wait before the player arrived.");
    }
    milestones.stayedWaiting = true;
    game.movePlayer(palaceNodes.find(node => node.id === "treasury")!);
    const choice = await game.checkWait(id, 45, signal); trace.push(`present:${choice}`); progress(`Player present: ${choice}`);
    milestones.wokeOnArrival = (choice === "stop_waiting" || !!choice?.startsWith("set_activity:"))
      && !!activityGoal(game.world(), id) && characterIntent(game.world(), id).wait !== wait;
    if (!milestones.wokeOnArrival) throw new Error("Player arrival did not activate a follow-up activity.");
    // Follow the newly assigned task far enough to observe a real greeting choice.
    const plan = await game.planNpc(id, signal); trace.push(`awake:${plan.decision.choice}`);
    if (plan.action?.type !== "talk" || plan.action.target !== "player") throw new Error("Woke without choosing to greet the present player.");
    // Completion-to-routine is deterministic; no fabricated conversation is supplied to a model.
    game.finishNpcRun(id, "complete", "Harness marks the greeting complete to verify routine fallback.");
    await game.reviewNpcOutcome(id, true, signal);
    milestones.returnedToRoutine = characterIntent(game.world(), id).wait === routine && !activityGoal(game.world(), id);
  } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  return { success: !error && Object.values(milestones).every(Boolean), milestones, trace, ...(error ? { error } : {}),
    snapshot: game.snapshot(), transcripts: game.recentTranscripts() };
}
