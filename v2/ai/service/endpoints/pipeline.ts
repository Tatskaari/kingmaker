import type { Endpoints } from "../context.ts";
import { decide } from "./decide.ts";
import { open } from "./open.ts";
import { notes } from "./notes.ts";
import { reply } from "./reply.ts";
import { settle } from "./settle.ts";
import { suggest } from "./suggest.ts";

/** The GM pipeline's thinks (KM_AI_GM=pipeline, the default): the prototype's GM, a step a request. */
export const pipeline: Endpoints = { open, decide, reply, settle, notes, suggest };
