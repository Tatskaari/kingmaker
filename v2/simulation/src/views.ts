// B's file (my_seat and my_names): until B writes it, it re-exports package A's stand-ins, which answer as if nobody had a seat.
export { mySeatView, myNamesView } from "./stubs.ts";
