export default async function run(services: HookServices): Promise<TransitionResult> {
  const quest = services.quests.read("assembly_programme");
  if (quest.currentStageId === "cart_unblocked") return { status: "accepted", message: "The entrance is already clear." };
  return services.quests.advance(quest.id,
    quest.currentStageId === "investigate_missing_pillows" ? "clear_cart_early" : "clear_cart",
    quest.revision, "repair");
}
