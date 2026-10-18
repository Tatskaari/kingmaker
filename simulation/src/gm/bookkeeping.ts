// Copied from the prototype at 44c6d4a: settledFacts from src/runtime/engine.ts:418-437 (beside applyMove). It reads GmState, not the session. (keepOpened, src/lore/disclosure.ts:94-96, went with disclosure.) What else was here went with the old pipeline's scene steps (docs/migration-log.md, M2's "The old pipeline's salvage"): wantsReview (engine.ts:397-410) and routeOf, the route the decide commit took, with its decide; resolve (director.ts:330-342), applyMove, moveTaken (engine.ts:255-265) and heldEnding (:276-286), the move a route or a ruling made and the ending it held for the player's answer, with considered rolls; and the read after the reply applied (moveOnAfterReply, endingReached, whyItWaits, arrivals, reachEnding: engine.ts:335-395) with its settle. The two-part GM's moves are shared/scene/beats.ts takeRoute's.

import type { GmState } from "../../../shared/gm/state.ts";

/** What's been settled in this scene so far: its facts, the last 16. (The GM's rulings, how they went, were among them until considered rolls went.) */
export function settledFacts(gm: GmState): string[] {
  return gm.established.slice(-16);
}
