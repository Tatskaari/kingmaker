// B's file (retryTurn): until B writes it, it re-exports package A's stand-in, which refuses "not_built".
export { retryTurnReducer } from "../stubs.ts";
