/**
 * Character creation's moves (v1-design §3.3, §3.5): one a prototype method, each for the caller's
 * own `creation` row, the AI's part a job of the creation's. Package B's: until it lands, each is a
 * stand-in that refuses not_built (stubs.ts). index.ts calls these names.
 */
export {
  startCreationReducer, creationBackReducer, chooseBuildReducer, makeOwnReducer, pickOwnReducer, takeOwnReducer,
  setBackstoryReducer, draftBackstoryReducer, workInBackstoryReducer, takeProposalReducer, leaveProposalReducer,
  finishBackstoryReducer, acceptFixReducer, rewriteIssueReducer, skipBackstoryReducer, chooseAgainReducer,
} from "../stubs.ts";
