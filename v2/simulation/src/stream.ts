// B's file (streamReply's body): until B writes it, it re-exports package A's stand-in, which refuses "not_built".
export { streamReplyReducer } from "./stubs.ts";
