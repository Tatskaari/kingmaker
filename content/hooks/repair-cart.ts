export default async function run(services: HookServices): Promise<TransitionResult> {
  const quest = services.quests.read("assembly_programme");
  if (quest.currentStageId === "cart_unblocked") return { status: "accepted", message: "The entrance is already clear." };
  try {
    await services.quests.transition(quest.id,
      quest.currentStageId === "investigate_missing_pillows" ? "clear_cart_early" : "clear_cart",
      quest.revision, "repair");
  } catch (error) {
    return { status: "rejected", message: String(error) };
  }
  return { status: "accepted", message: "The cart is cleared. Deliveries can resume; the cushions have not yet arrived." };
}
