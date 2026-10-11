export default async function run(services: HookServices): Promise<TransitionResult> {
  for (const fixture of services.map.listFixtures()) {
    if (!["furn_cart_left", "furn_cart_right"].includes(fixture.id)) continue;
    await services.map.updateFixture(fixture.id, current => {
      const id = `smash_${current.id}`;
      const existing = current.actions.find(action => action.id === id);
      if (!existing) current.actions.push({ id, label: "Smash cart · Strength check (DC 15)",
        handler: "smash-cart", onSuccessHook: "smashed-cart.ts", actorId: "player", illegal: true, order: 25 });
    });
  }
  const quest = services.quests.read("assembly_programme");
  await services.quests.setActive(quest.id, true, quest.revision);
  return { status: "accepted", message: "Hello world! Assembly Programme is now active." };
}
