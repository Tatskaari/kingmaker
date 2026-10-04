import { create } from "@bufbuild/protobuf";
import { DocumentSchema, type WorldState } from "../../contracts/src/v2.js";

export const PRESENTATION_GUIDANCE = `Maintain each character's presentation.md alongside their entry (Players/presentation.md for the player). Use read_document and the document editing tools to update it when visible appearance changes. This is public, observable prose, never private biography, motives, relationships, hidden inventory or secrets. Use this template: clothing and visible equipment; grooming, hair and visible condition; overall impression in the current setting. Write a short evocative paragraph, grounded in established appearance and unconcealed gear, without inventing injuries or major changes. Omit unknown details. Keep visibility: public and a faithful summary. Do not add document links. Presentation describes appearance; edits do not change inventory or physical state.`;

export const presentationPath = (entry: string) => entry.slice(0, entry.lastIndexOf("/") + 1) + "presentation.md";

/** Fresh-character baseline only. Never regenerate or overwrite the GM's prose on load. */
export function seedPresentation(world: WorldState, entry: string, prose?: string) {
  const path = presentationPath(entry);
  if (world.docs[path]) return;
  const doc = world.docs[entry]!;
  const visible = doc.characterProperties?.inventory?.items.filter(item => !item.concealed && (item.quantity ?? 1) > 0) ?? [];
  const body = prose ?? (visible.length
    ? `Visible attire and belongings: ${visible.map(item => item.name).join("; ")}.`
    : "Their clothing and grooming have not yet been described.");
  world.docs[path] = create(DocumentSchema, { frontmatter: { visibility: "public",
    summary: `The visible appearance, clothing and grooming of ${doc.frontmatter?.name ?? "this character"}.` }, body });
}
