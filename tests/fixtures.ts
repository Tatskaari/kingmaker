import { loadPlayableWorld } from "../scripts/lib/playable-world.js";
import { projectWorld } from "../apps/web/src/world-projection.js";
export { loadPlayableWorld };
export const physicalFixture = () => projectWorld(loadPlayableWorld());
