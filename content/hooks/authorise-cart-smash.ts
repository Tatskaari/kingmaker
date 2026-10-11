export default async function run(services: HookServices): Promise<TransitionResult> {
  for (const fixture of services.map.listFixtures()) {
    if (!["furn_cart_left", "furn_cart_right"].includes(fixture.id)) continue;
    await services.map.updateFixture(fixture.id, current => {
      const id = `smash_${current.id}`;
      const existing = current.actions.find(action => action.id === id);
      if (!existing) current.actions.push({ id, label: "Smash cart · Strength check (DC 15)",
        handler: "smash-cart", onSuccessHook: "smashed-cart.ts", actorId: "player", illegal: false, order: 25 });
      if (existing) existing.illegal = false;
    });
  }
  return { status: "accepted", message: "Holt authorised the player to smash the cart." };
}
