/** Opaque versions belong to resources, including empty inventories and deleted IDs. */
export interface GenerationEntry { generationId: string; fingerprint: string }
export type Generations = Record<string, GenerationEntry>;
export type ExpectedGenerations = Record<string, string>;
export interface VersionedState { generationId: string; state: unknown }

function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

export const RECONCILE_CONFLICT = "Nothing was written. Read the returned current state, decide how to reconcile your intended changes, then call the write tool again with the returned generation IDs. Do not blindly retry the old write.";

export class GenerationConflict extends Error {
  readonly response;
  constructor(current: Record<string, VersionedState>, expected: ExpectedGenerations, required: readonly string[]) {
    const requiredResourceIds = [...new Set(required)];
    const missingResourceIds = Object.keys(current).filter(key => !expected[key]);
    const staleResourceIds = Object.keys(current).filter(key => expected[key] && expected[key] !== current[key]!.generationId);
    const error = staleResourceIds.length ? "generation_conflict" : "missing_generation_ids";
    const details = [
      ...(missingResourceIds.length ? [`Missing generation IDs: ${missingResourceIds.join(", ")}.`] : []),
      ...(staleResourceIds.length ? [`Stale generation IDs: ${staleResourceIds.join(", ")}.`] : []),
    ].join(" ");
    super(staleResourceIds.length ? `State changed. ${details}` : details);
    this.response = { ok: false, error, requiredResourceIds, missingResourceIds, staleResourceIds,
      instruction: `${details} Nothing was written. Include every requiredResourceIds entry in generations using the IDs in current. Missing IDs do not mean those resources changed. Read the returned state and decide how to reconcile any staleResourceIds before you call the write tool again. Do not blindly retry stale writes.`, current };
  }
}

/** Observe at mutation boundaries, not just when models read, to detect A → B → A. */
export class GenerationStore {
  #entries: Generations;
  constructor(saved: Generations = {}) { this.#entries = structuredClone(saved); }

  observe(resources: Record<string, unknown>): void {
    for (const key of new Set([...Object.keys(this.#entries), ...Object.keys(resources)])) {
      const next = fingerprint(resources[key] ?? null);
      if (this.#entries[key]?.fingerprint !== next) this.#entries[key] = { generationId: crypto.randomUUID(), fingerprint: next };
    }
  }

  read(resources: Record<string, unknown>, keys = Object.keys(resources)): Record<string, VersionedState> {
    this.observe(resources);
    return Object.fromEntries(keys.map(key => {
      // Never-seen IDs share an absence token; observed deletions retain a fresh tombstone.
      return [key, { generationId: this.#entries[key]?.generationId ?? "absent", state: structuredClone(resources[key] ?? null) }];
    }));
  }

  check(resources: Record<string, unknown>, expected: ExpectedGenerations, required: readonly string[]): void {
    const keys = [...new Set([...required, ...Object.keys(expected)])];
    const current = this.read(resources, keys);
    if (keys.some(key => !expected[key] || expected[key] !== current[key]!.generationId)) throw new GenerationConflict(current, expected, required);
  }

  snapshot(): Generations { return structuredClone(this.#entries); }
}

export function generationIds(states: Record<string, VersionedState>): ExpectedGenerations {
  return Object.fromEntries(Object.entries(states).map(([key, value]) => [key, value.generationId]));
}
