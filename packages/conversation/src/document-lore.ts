import { summaryPreview } from "../../lore/src/markdown.js";
import { characterIntent, intentContext } from "../../lore/src/activity.js";
import type { ScenarioService } from "../../lore/src/services.js";
import { permitted, labels } from "../../lore/src/access.js";
import type { LoreService, RuntimeServices } from "./services.js";

/** Character-scoped view of the authoritative GM document service. */
export async function documentLore(scenario: ScenarioService, characterId: string): Promise<LoreService> {
  const intent = characterIntent(scenario.snapshot(), characterId), entry = intent.entry;
  characterId = intent.actorId;
  const audienceId = scenario.snapshot().simulation!.runtimeCharacters[characterId]!.characterId;
  const allowed = (path: string, document: { body: string; frontmatter?: Record<string, unknown> | undefined }) => {
    if (!permitted(path, { body: document.body, metadata: document.frontmatter ?? {} }, entry, {
      character: audienceId, labels: labels(scenario.snapshot().docs[entry]?.frontmatter?.labels),
      factions: labels(scenario.snapshot().docs[entry]?.frontmatter?.factions),
    })) {
      throw new Error(`No read access: ${path}`);
    }
  };
  const read = async (path: string) => {
    const { document } = await scenario.getDocument(path);
    allowed(path, document);
    return { path, markdown: document.body + (path === entry ? `\n\n${intentContext(scenario.snapshot(), characterId)}` : "") };
  };
  const character = await scenario.getDocument(entry);
  const identity = character.document.links.find(link => /^Cast\/.+\/private\.md$/.test(link.target));
  if (!identity) throw new Error(`No private Cast reference in ${entry}`);
  return {
    initial: [await read(identity.target), await read(entry)],
    links(opened) {
      const state = scenario.snapshot();
      const intent = characterIntent(state, characterId);
      const seen = new Set([...opened.map(doc => doc.path), intent.activity, intent.wait]);
      return opened.flatMap(source => (state.docs[source.path]?.links ?? []).flatMap(link => {
        if (seen.has(link.target)) return [];
        const target = state.docs[link.target];
        if (!target) throw new Error(`Missing document: ${link.target}`);
        allowed(link.target, target);
        seen.add(link.target);
        return [{ from: source.path, path: link.target, ...summaryPreview(target.frontmatter ?? {}) }];
      }));
    },
    async open(link, signal) { signal.throwIfAborted(); return read(link.path); },
  };
}

/** Host default: construct document views lazily, preserving scoped or factory overrides. */
export function documentLoreService(scenario: ScenarioService,
  overrides: Partial<RuntimeServices["lore"]> = {}): Partial<RuntimeServices["lore"]> {
  return { ...overrides, forCharacter: async (characterId, signal) => {
    signal.throwIfAborted();
    if (overrides.forCharacter) return overrides.forCharacter(characterId, signal);
    const defaults = overrides.initial && overrides.links && overrides.open ? undefined : await documentLore(scenario, characterId);
    signal.throwIfAborted();
    return { initial: overrides.initial ?? defaults!.initial,
      links: opened => overrides.links ? overrides.links(opened) : defaults!.links(opened),
      open: (link, cancellation) => overrides.open ? overrides.open(link, cancellation) : defaults!.open(link, cancellation) };
  } };
}
