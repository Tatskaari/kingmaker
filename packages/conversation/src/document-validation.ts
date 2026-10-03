import type { OpenRouterTool } from "../../providers/src/openrouter.js";
import type { DocsService } from "../../lore/src/services.js";

export const validateDocumentsTool: OpenRouterTool = { type: "function", function: {
  name: "validate_documents",
  description: "GM-only, read-only audit of live document links and character access. Supply null to check saved documents, or a proposed full Markdown document (including frontmatter) to preflight a create/edit without saving. Returns denied, broken, ambiguous and invalid findings with source-to-target trails. Checks internal note targets, not external URLs, assets, heading anchors or secrets copied into prose. Fix links or reader/audience metadata deliberately; never grant access just to silence a finding.",
  parameters: { type: "object", additionalProperties: false, required: ["proposal"], properties: {
    proposal: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["path", "text"], properties: {
      path: { type: "string", description: "Vault-relative Markdown path." },
      text: { type: "string", description: "Complete proposed Markdown, including YAML frontmatter." },
    } }] },
  } },
} };

export async function validateDocuments(input: Record<string, unknown>, docs: DocsService) {
  const proposal = input.proposal;
  if (proposal === null) {
    const findings = await docs.validate();
    return { ok: findings.length === 0, findings };
  }
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)
    || !("path" in proposal) || typeof proposal.path !== "string" || !proposal.path.trim()
    || !("text" in proposal) || typeof proposal.text !== "string") {
    throw new Error("Expected proposal to be null or an object with path and full Markdown text.");
  }
  const findings = await docs.validate({ path: proposal.path, text: proposal.text });
  return { ok: findings.length === 0, findings };
}
