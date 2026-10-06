import { renderPrompt } from "../../prompts/src/index.js";
import { create } from "@bufbuild/protobuf";
import { DocumentSchema, type WorldState } from "../../contracts/src/v2.js";

export const PRESENTATION_GUIDANCE = renderPrompt("presentation-presentation_guidance");

export const presentationPath = (entry: string) => entry.slice(0, entry.lastIndexOf("/") + 1) + "presentation.md";

/** Fresh-character baseline only. Never regenerate or overwrite the GM's prose on load. */
export function seedPresentation(world: WorldState, entry: string, prose?: string) {
  const path = presentationPath(entry);
  if (world.docs[path]) return;
  const doc = world.docs[entry]!;
  const visible = Object.values(world.simulation!.runtimeCharacters).find(actor => actor.document === entry)?.inventory?.items.filter(item => !item.concealed && (item.quantity ?? 1) > 0) ?? [];
  const body = prose ?? (visible.length
    ? `Visible attire and belongings: ${visible.map(item => item.name).join("; ")}.`
    : "Their clothing and grooming have not yet been described.");
  world.docs[path] = create(DocumentSchema, { frontmatter: { visibility: "public",
    summary: `The visible appearance, clothing and grooming of ${doc.frontmatter?.name ?? "this character"}.` }, body });
}
