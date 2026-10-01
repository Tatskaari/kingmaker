import type { PortraitExpression } from "../../../packages/providers/src/conversation-expression.js";

export function strangerPortrait(expression: PortraitExpression = "amused") {
  const visible = expression === "scared" ? "amused" : expression;
  return { expression: visible, src: `./assets/laughing-stranger/${visible}.png`, alt: `The Laughing Stranger looks ${visible}.` };
}
