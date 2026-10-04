import { create } from "@bufbuild/protobuf";
import { TranscriptMessageSchema, TranscriptRole } from "../../contracts/src/index.js";
import { peregrineGiftCase } from "./peregrine-gift-case.js";
import { oswinParlourCase } from "./oswin-parlour-case.js";
import type { LiveConversationCase } from "./live-conversation-experiment.js";
import graduation from "../../../evals/attention/shared-graduation.json" with { type: "json" };

const observed = graduation[0]!;
export const sharedHistoryCase: LiveConversationCase = {
  ...oswinParlourCase, name: "corvin-shared-graduation", characterId: "corvin", participants: ["corvin", "player"],
  transcript: [create(TranscriptMessageSchema, { role: TranscriptRole.PLAYER, speakerId: "player", text: observed.player }),
    create(TranscriptMessageSchema, { role: TranscriptRole.CHARACTER, speakerId: "corvin", text: observed.reply })],
  expectations: "Record the player's claimed shared university/graduation history and Corvin's accommodation of it so future interaction can refer back to it. Preserve the distinction between a player's claim, Corvin's partial acceptance, and established GM truth. Do not certify close friendship, identify the unnamed short spellcaster, or invent further historical facts. No action objective or inventory change is needed.",
};

/** Deliberate counterfactual: the same gift draft conflicts with an authoritative custody fact. */
export const refusedGiftCase: LiveConversationCase = {
  ...peregrineGiftCase, name: "peregrine-refused-gift", expected: "refusal",
  expectations: "The drafted wooden-bird gift must be refused because the authoritative scenario says it is Abel's loan. The accepted replacement should acknowledge that limitation naturally without giving the bird or another item. No typed inventory may change. Keep memories of the accepted conversation, not the rejected gift. Earlier travel anecdotes remain Peregrine's account rather than confirmed GM truth.",
  loadWorld(overlays) {
    const world = peregrineGiftCase.loadWorld(overlays);
    world.docs[world.scenario]!.body += "\n\n## GM custody fact for this scene\nThe carved wooden bird with faded blue lacquer in Peregrine's temporary custody belongs to Abel. It is on loan for examination only. Peregrine has no authority to give it away. No replacement gift is available during this scene. Respect this established ownership; refuse a draft that transfers the bird, and guide Peregrine to explain that it is borrowed. No resolved check in this conversation overrides that constraint.\n";
    return world;
  },
};
