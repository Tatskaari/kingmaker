// New (M6): the zoo's campaign row as install_campaign writes it and the client gets it, read from campaigns/zoo, for the client's tests and the screen check (Node only: it reads the folder).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadScenario } from "../../shared/scene/scenario.ts";
import type { CampaignRow } from "../backend.ts";

const DIR = join(import.meta.dirname, "..", "..", "campaigns", "zoo");

/** The zoo installed: its scenario as the game keeps it (its exhibits in it) and its builds. */
export const ZOO_ROW: CampaignRow = {
  key: "zoo", version: "0.1.0", title: "The zoo",
  json: JSON.stringify(loadScenario(readFileSync(join(DIR, "zoo.kmscenario"), "utf8"))),
  builds: readFileSync(join(DIR, "builds.json"), "utf8"),
};
