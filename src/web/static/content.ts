/**
 * The game's content for the static build (content.json): what the game reads with node:fs, by repo
 * directory, and nothing else. build.ts bundles it, and check.ts holds the build to it. The scenes,
 * the zoo's wings and the rest of the game are modules, bundled as code.
 */
export const CONTENT: Array<{ dir: string; include: RegExp; what: string }> = [
  { dir: "lore", include: /\.md$/, what: "lore/ Markdown" },
  { dir: "v2/ai/prompts", include: /\.md$/, what: "v2/ai/prompts/ Markdown" },
  { dir: "vendor/dnd-srd-engine", include: /^starter-pack\.json$/, what: "the rules' starter pack" },
  // The sheet's spell pages (src/rules/spells.ts): without them a spell shows the rules alone.
  { dir: "vendor/srd-spells", include: /^spells\.json$/, what: "the SRD's spell descriptions" },
];

/** Is a content path (from the repo, with forward slashes) one the allowlist lets in? Nothing hidden is. */
export function allowed(path: string): boolean {
  const parts = path.split("/");
  if (parts.some(part => part.startsWith("."))) return false;
  return CONTENT.some(c => path.startsWith(`${c.dir}/`) && c.include.test(parts.at(-1)!));
}
