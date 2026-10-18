// New (M6): the zoo in a fight's screen (client/fight/model.ts, client/ui/fight.tsx), for a fight from one of its exhibits: fight it again in one key (the same foes, everyone whole), or pick other foes from its line-ups, a small list over the fight; a spectator has neither.
import type { FightModel } from "../fight/model.ts";
import type { Rejection } from "../backend.ts";
import type { ZooFight } from "./zoo.ts";

/** The exhibit this fight came from, with its line-ups: none for a story's fight, the arena's rings, or a spectator. */
export function zooFightIn(model: Pick<FightModel, "view" | "zoo">): ZooFight | undefined {
  return model.view.watching ? undefined : model.zoo?.fight(model.view);
}

/** The fight again: the same foes, everyone whole (open_exhibit). False when it isn't a zoo fight. */
export function fightAgain(model: FightModel): boolean {
  const zoo = zooFightIn(model);
  if (!zoo) return false;
  model.closeOverlay();
  void answered(model, model.zoo!.again(zoo));
  return true;
}

/** The line-ups to pick from, over the fight, the one being fought picked out. False when it isn't a zoo fight. */
export function openFoes(model: FightModel): boolean {
  const zoo = zooFightIn(model);
  if (!zoo) return false;
  model.overlay = { kind: "foes", index: Math.max(0, zoo.lineUps.findIndex(l => l.id === zoo.foes.id)) };
  model.emit();
  return true;
}

/** A line-up picked from the list: the fight set out again with them. */
export function foesPicked(model: FightModel, index: number): void {
  const zoo = zooFightIn(model);
  const lineUp = zoo?.lineUps[index];
  model.closeOverlay();
  if (zoo && lineUp) void answered(model, model.zoo!.pickFoes(zoo, lineUp.id));
}

/** A zoo move's refusal, said where the fight says its words. */
async function answered(model: FightModel, made: Promise<Rejection | undefined>): Promise<void> {
  const refused = await made;
  if (refused) model.say(refused.text);
}
