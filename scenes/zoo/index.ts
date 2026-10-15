import type { Scene } from "../../src/runtime/scene.ts";
import { belfry } from "./belfry.ts";
import { cardSharp } from "./card-sharp.ts";
import { dictation } from "./dictation.ts";
import { ledger } from "./ledger.ts";
import { pieStall } from "./pie-stall.ts";
import { practiceYard } from "./practice-yard.ts";
import { tavern } from "./tavern.ts";

/**
 * The zoo's own scenes (src/game/zoo/README.md): short, self-contained, each built to show a few of
 * the runtime's mechanics with the real GM. They're no part of the story: nothing in the arc leads
 * to them, and they lead nowhere (their endings have no next scene).
 */
export const ZOO_SCENES: Scene[] = [pieStall, belfry, cardSharp, ledger, practiceYard, tavern, dictation];
