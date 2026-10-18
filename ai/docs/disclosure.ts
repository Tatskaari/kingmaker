import { characterEntry, playerDoc, readDoc, STORY_INDEX, type Doc } from "./docs.ts";
import { gmNotes, isNotesPath, notesDoc } from "./notes.ts";
import type { Person, WorkingSet } from "./types.ts";

/**
 * What's left of progressive disclosure (V1's): the GM's memory block, from each person's scope.
 * Disclosure itself went with the old pipeline's scene steps (docs/migration-log.md, M2's "The old
 * pipeline's salvage"): each turn Jev judged every unopened note linked from a scope's open docs and
 * opened those it thought the next reply needed (disclose, discloseScope, askJev), and what it opened
 * or kept out stayed open for the scene (keepOpened, withhold). Nothing asks it since the two-part GM
 * plays every scene and talk; the aftermath of a fight (voice.ts gmReply) still reads the memory block.
 */

/** A person's scope (their lore entry and the GM's notes on them), or the GM's (the player's doc, the story's index, the scene's lore). */
type Scope = { id: string; label: string; initial: Doc[]; character?: Person };

function scopes(view: WorkingSet): Scope[] {
  const out: Scope[] = view.present.map(c => {
    const entry = characterEntry(c.id);
    const initial = [entry ? readDoc(view.game, entry) : undefined, notesDoc(view.game, c.id)].filter((d): d is Doc => !!d);
    return { id: `character:${c.id}`, label: c.name, initial, character: c };
  });
  const gm = [playerDoc(view.game, view.player), readDoc(view.game, STORY_INDEX), ...(view.scene.lore ?? []).map(p => readDoc(view.game, p))].filter((d): d is Doc => !!d);
  return [...out, { id: "gm", label: "the GM", initial: gm }].filter(s => s.initial.length);
}

/**
 * The GM's memory block (V1's reuse note: one GM voice gets each person's scoped lore in its own
 * labelled block, so it can keep who-knows-what straight). Split for prompt caching: "stable" is
 * each person's lore entry (changes only when play edits it); "live" is the GM's notes on each
 * person from play (where their memory index was) and the story so far (changes most turns), sent
 * after the conversation. (The notes disclosure opened went in it too, until disclosure went.) Its
 * words are the prototype's otherwise.
 */
export function memoryBrief(view: WorkingSet, part: "stable" | "live"): string | undefined {
  const blocks: string[] = [];
  for (const scope of scopes(view)) {
    const kept = scope.character ? gmNotes(view.game, scope.character.id) : undefined;
    const index = scope.initial.find(d => d.path === STORY_INDEX);
    const parts = part === "stable"
      ? scope.initial.filter(d => d.path !== STORY_INDEX && !isNotesPath(d.path)).map(d => d.body)
      : [
        ...(kept ? [`The GM's notes on ${scope.label} from play (what's happened with them):\n${kept}`] : []),
        ...(index ? [`Earlier scenes (index):\n${index.body.replace(/^# .*\n?/, "").trim()}`] : []),
      ];
    if (parts.length) blocks.push(`### ${scope.character ? `${scope.label}: their own ${part === "stable" ? "lore" : "memories"}` : `The GM's ${part === "stable" ? "own notes (the player character, this place)" : "notes"}`}\n${parts.join("\n\n")}`);
  }
  if (!blocks.length) return undefined;
  return [
    part === "stable" ? "## Who these people are (their lore)" : "## What people remember",
    part === "stable"
      ? "Each person's lore is theirs: what they know and believe. They know nothing beyond it except what they see or are told."
      : "Each person's memories are theirs alone: they know what they lived through, saw or were told, and nothing else. Let what they remember of the player show in how they treat them, and bring it up when it matters, in their own words; don't recite it.",
    ...blocks,
  ].join("\n\n");
}
