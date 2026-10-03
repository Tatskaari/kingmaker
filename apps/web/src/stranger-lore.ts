import type { WorldState } from "../../../packages/contracts/src/v2.js";
import type { ScenarioService } from "../../../packages/lore/src/services.js";
import { summaryPreview } from "../../../packages/lore/src/markdown.js";
import type { LoreService } from "../../../packages/conversation/src/services.js";

export function strangerEntry(world: Pick<WorldState, "scenario">): string {
  return world.scenario.replace(/scenario\.md$/, "stranger.md");
}
export function strangerConfiguration(world: WorldState) {
  const doc = world.docs[strangerEntry(world)];
  if (!doc) throw new Error("Missing Stranger briefing. Start a fresh game with the current scenario.");
  const { opening, affiliations } = doc.frontmatter ?? {};
  if (typeof opening !== "string" || !opening.trim() || !Array.isArray(affiliations)
    || !affiliations.length || affiliations.some(value => typeof value !== "string" || !value.trim())) {
    throw new Error("The Stranger briefing needs an opening and affiliations.");
  }
  return { opening, affiliations: affiliations as string[] };
}

/** Explicit GM audience for creation; ordinary character loaders retain their access checks. */
export async function strangerLore(scenario: ScenarioService): Promise<LoreService> {
  const entry = strangerEntry(scenario.snapshot());
  const read = async (path: string) => ({ path, markdown: (await scenario.getDocument(path)).document.body });
  return {
    initial: [await read(entry)],
    links(opened) {
      const world = scenario.snapshot(), seen = new Set(opened.map(doc => doc.path));
      return opened.flatMap(source => (world.docs[source.path]?.links ?? []).flatMap(link => {
        if (seen.has(link.target)) return [];
        const target = world.docs[link.target];
        if (!target) throw new Error(`Missing document: ${link.target}`);
        seen.add(link.target);
        return [{ from: source.path, path: link.target, ...summaryPreview(target.frontmatter ?? {}) }];
      }));
    },
    async open(link, signal) { signal.throwIfAborted(); return read(link.path); },
  };
}
