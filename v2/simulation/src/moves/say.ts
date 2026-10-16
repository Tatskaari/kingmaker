// B's file (say: check, resolve, think, commit): until B writes it, it re-exports package A's stand-in, which refuses "not_built".
export { sayReducer } from "../stubs.ts";
