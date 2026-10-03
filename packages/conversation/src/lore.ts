import { labels } from "../../lore/src/access.js";
import { links } from "../../lore/src/markdown.js";
import path from "node:path";
import { permitted, readVault } from "../../../scripts/lib/lore-access.js";
import type { CharacterSources, LoreDocument } from "./conversation.js";

export interface LoreLink { path: string; from: string }
export interface CharacterLore {
  initial: CharacterSources;
  candidates(opened: CharacterSources): LoreLink[];
  read(path: string): LoreDocument;
}

/** Resolve only authored links; never treat player input as a retrieval request. */
export function loadCharacterLore(root: string, scenario: string, characterId: string): CharacterLore {
  const notes = readVault(root);
  const entry = `Scenarios/${scenario}/Characters/${characterId}/character.md`;
  if (entry.split("/").some(part => part === "." || part === "..")) throw new Error("Invalid character entry path.");
  const audience = { character: characterId, labels: labels(notes.get(entry)?.metadata.labels) };
  const readable = (name: string) => {
    const note = notes.get(name);
    if (!note) throw new Error(`Missing lore note: ${name}`);
    if (note.error) throw new Error(`${name}: ${note.error}`);
    if (!permitted(name, note, entry, audience)) throw new Error(`No read access: ${name}`);
    return note;
  };
  const read = (name: string): LoreDocument => ({ path: name, markdown: readable(name).body });
  function resolve(from: string, link: { target: string; wiki: boolean }): string | undefined {
    let target = decodeURIComponent(link.target.split("#")[0]!.split("?")[0]!);
    if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return;
    if (!link.wiki && path.posix.extname(target) && !target.endsWith(".md")) return;
    if (!target.endsWith(".md")) target += ".md";
    const absolute = path.posix.normalize(target.replace(/^\//, ""));
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(from), target));
    const matches = link.wiki
      ? notes.has(absolute) ? [absolute] : notes.has(relative) ? [relative] : [...notes.keys()].filter(key => key.endsWith("/" + absolute))
      : [link.target.startsWith("/") ? absolute : relative].filter(key => notes.has(key));
    if (matches.length !== 1) throw new Error(`Broken or ambiguous link in ${from}: ${link.target}`);
    return matches[0]!;
  }
  const initial = [read(entry)];
  const privateLink = links(initial[0]!.markdown).find(link => /^Cast\/.+\/private(?:\.md)?$/.test(link.target));
  if (!privateLink) throw new Error(`No private Cast reference in ${entry}`);
  initial.unshift(read(resolve(entry, privateLink)!));
  return { initial, read, candidates(opened) {
    const seen = new Set(opened.map(document => document.path)), result: LoreLink[] = [];
    for (const document of opened) for (const link of links(document.markdown)) {
      const target = resolve(document.path, link);
      if (!target || seen.has(target)) continue;
      readable(target); // Permissions are checked before exposing candidates or reading bodies.
      seen.add(target); result.push({ path: target, from: document.path });
    }
    return result;
  } };
}
