/** A registered conversation hook. Export one default async function with this signature.
 * @remarks Hooks run before the conversation transition. Service writes are separate
 * commits: make effects retry-safe because a later failure does not roll back earlier writes.
 * No imports, network, timers, filesystem or whole-world access are available.
 */
export type Hook = (services: HookServices) => Promise<TransitionResult>;

/** A hook either permits the edge or rejects it with a character-facing reason.
 * @remarks Reject before applying effects. Rejection keeps the conversation at
 * its current node, and later attempts may retry. Earlier effects are not undone.
 */
export type TransitionResult =
  | { status: "accepted"; message?: string }
  | { status: "rejected"; message: string };

/** Services available to document-authored hooks. Read methods return detached data.
 * @example
 * ```ts
 * export default async function run(services: HookServices): Promise<TransitionResult> {
 *   const quest = services.quests.read("assembly_programme");
 *   await services.quests.setActive(quest.id, true, quest.revision);
 *   return { status: "accepted", message: "Assembly Programme activated." };
 * }
 * ```
 */
export interface HookServices {
  /** Inspect and advance quest progress through the authoritative quest service. */
  quests: HookQuestService;
  /** Inspect fixtures and update their interaction actions through authoritative moves. */
  map: HookMapService;
}

/** Detached quest progress. Read again after a write to obtain the current revision. */
export interface HookQuestState {
  /** Stable quest ID, for example assembly_programme. */
  id: string;
  /** Current stage ID. */
  currentStageId: string;
  /** Optimistic concurrency revision required by writes. */
  revision: number;
  /** Whether the quest is currently active. */
  active: boolean;
}

/** Quest progress operations; these do not run other hooks or physical effects. */
export interface HookQuestService {
  /** Read all registered quests as detached progress records. */
  list(): HookQuestState[];
  /** Read a quest by its stable ID.
   * @throws If the quest does not exist.
   */
  read(id: string): HookQuestState;
  /** Activate or deactivate a quest without advancing its stage.
   * @param id - Stable quest ID.
   * @param active - Desired activation state.
   * @param expectedRevision - Revision from the latest read.
   * @returns Updated progress; matching activation is a no-op after the revision check.
   * @throws If the quest is missing or the revision is stale.
   */
  setActive(id: string, active: boolean, expectedRevision: number): Promise<HookQuestState>;
  /** Record an adjudicated transition from the current stage.
   * @param id - Stable quest ID.
   * @param transitionId - An outgoing edge of the current stage.
   * @param expectedRevision - Revision from the latest read.
   * @param evidence - Explanation of the established outcome.
   * @returns Updated progress. Completed stages deactivate the quest.
   * @throws If the edge is unavailable or the revision is stale.
   * @remarks Establish physical outcomes before recording progress. This call does
   * not evaluate a condition, clear a cart or execute a quest lifecycle hook.
   */
  transition(id: string, transitionId: string, expectedRevision: number, evidence?: string): Promise<HookQuestState>;
}

/** A fixture interaction definition. Existing application handlers execute actions. */
export interface HookAction {
  /** Globally unique action ID; reuse it on retry instead of appending duplicates. */
  id: string;
  /** Player-visible action label. */
  label: string;
  /** The initial PoC exposes the existing cart-smashing handler only. */
  handler: "smash-cart";
  /** Runtime actor ID allowed to perform this action, typically player. */
  actorId: string;
  /** Whether performing this action is illegal. Permission does not change ownership. */
  illegal: boolean;
  /** Display ordering. */
  order: number;
}

/** Detached fixture action data. Other physical fields remain host-owned. */
export interface HookFixture {
  /** Immutable fixture ID. */
  readonly id: string;
  /** Interaction actions; edit these inside updateFixture's synchronous callback. */
  actions: HookAction[];
}

/** Fixture operations. This PoC exposes action edits, not arbitrary map mutation. */
export interface HookMapService {
  /** List detached fixture IDs and actions, without cloning or exposing the world. */
  listFixtures(): HookFixture[];
  /** Edit the current fixture's actions inside one authoritative move.
   * @param id - Existing fixture ID.
   * @param update - Synchronous callback: mutate actions and return nothing.
   * @throws If the fixture is missing, the callback is async, identity changes,
   * or resulting actions are invalid. Rejected updates publish no changes.
   * @remarks The callback runs in the bounded VM with the latest fixture data.
   * It cannot call services, retain a writable draft or perform async work.
   * Await the outer call. Multiple calls are separate commits.
   */
  updateFixture(id: string, update: (fixture: HookFixture) => void): Promise<void>;
}
