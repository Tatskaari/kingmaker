// B's file (installCampaign's body): until B writes it, it re-exports package A's stand-in, which refuses "not_built".
export { installCampaignReducer } from "./stubs.ts";
