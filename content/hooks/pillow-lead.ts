export default async function run(services: HookServices): Promise<TransitionResult> {
  for (const fixture of services.map.listFixtures()) {
    if (!["furn_cart_left", "furn_cart_right"].includes(fixture.id)) continue;
    await services.map.updateFixture(fixture.id, current => {
      const id = `smash_${current.id}`;
      const existing = current.actions.find(action => action.id === id);
      if (!existing) current.actions.push({ id, label: "Smash cart · Strength check (DC 15)",
        handler: "smash-cart", actorId: "player", illegal: true, order: 25 });
    });
  }
  let quest = services.quests.read("assembly_programme");
  if (quest.currentStageId !== "investigate_missing_pillows") return { status: "accepted", message: "The pillow lead is already recorded." };
  if (!quest.active) quest = await services.quests.setActive(quest.id, true, quest.revision);
  await services.quests.transition(quest.id, "learn_cart_blocked", quest.revision,
    "Holt explained that the pillow delivery is probably blocked by Rowan's cart.");
  return { status: "accepted", message: "Pillow lead recorded: investigate the blocked cart." };
}
