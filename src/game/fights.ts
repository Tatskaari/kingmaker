import { tacticalFights, type TacticalFights } from "./combat/index.ts";
import { battlefield } from "./map/index.ts";

/**
 * Fights on the map, for the play loop (src/game/play.ts): tactical combat (src/game/combat) on the
 * scene's own place (the map module's battlefield), with everyone where the scene's world has them
 * when the blades come out, its lanterns and braziers to knock over, its dust and what burns.
 * The app and the QA console fight the same fights.
 */
export function mapFights(): TacticalFights {
  return tacticalFights({
    field: session => {
      const field = session.world ? battlefield(session.sceneId, session.world) : undefined;
      return field ? { map: field.map, at: field.people, props: field.lights, dust: field.dust, fuel: field.fuel } : undefined;
    },
  });
}
