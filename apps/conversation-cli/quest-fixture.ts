import { create } from "@bufbuild/protobuf";
import { QuestSchema, QuestTrigger } from "../../packages/contracts/src/v2.js";

/** CLI-only example from #532, pending the lore quest loader. Never executes effects. */
export function rowanQuestFixture() {
  return create(QuestSchema, {
    id: "cli_pillow_delivery", title: "Pillow Delivery (CLI classification fixture)", initialStageId: "delivery_delayed",
    stages: ["delivery_delayed", "backing_out"].map(id => ({ id })),
    transitions: [{ id: "agree_to_back_out", fromStageId: "delivery_delayed", toStageId: "backing_out",
      trigger: QuestTrigger.DISCRETIONARY, description: "Rowan agrees to back his obstructing cart out of the service entrance.",
      condition: "Rowan has actually agreed to back the cart out. A player request, hypothetical possibility, refusal, or agreement conditional on an unmet requirement is insufficient. Agreement does not establish that the cart has moved or the entrance is clear." }],
  });
}
