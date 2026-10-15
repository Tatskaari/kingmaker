/**
 * The docs' line links, kept pointing at what they meant. A link like [`createCharacter`](dnd.ts#L285) or
 * [engine.ts:709](engine.ts#L709) goes stale as soon as code above it moves; this moves the link with it.
 *
 *   node --no-warnings src/cli/doc-anchors.ts           # rewrite the links that moved, and say which
 *   node --no-warnings src/cli/doc-anchors.ts --check   # only say, and fail if any have moved
 *
 * A link whose text is a name in backticks (`name`, `name(...)`, `Type.name`) goes to where that name is
 * defined now (a function, class, const, let, type, interface or enum; a method or property at the start of
 * a line), the definition nearest where the line it pointed at has gone, when there are several. Any other
 * link to a line follows that line: from the commit that last wrote the link (git blame) to the file as it
 * is now, through the diff between them (a line that was changed goes to where its hunk is now), and a
 * "file:line" text moves with it. A link the tool can't follow (the file isn't tracked, or was renamed)
 * is left as it is, and listed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const LINK = /\[([^\]\n]+)\]\(([^)#\s]+)#L(\d+)\)/g;
const git = (...args: string[]): string => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });

function main(): void {
  const check = process.argv.includes("--check");
  const docs = git("ls-files", "*.md").split("\n").filter(Boolean);
  const moved: string[] = [];
  const lost: string[] = [];

  for (const doc of docs) {
    const text = readFileSync(join(ROOT, doc), "utf8");
    if (!/#L\d/.test(text)) continue;
    const written = blame(doc);
    const lines = text.split("\n");
    const next = lines.map((line, i) => line.replace(LINK, (link, label: string, target: string, at: string) => {
      const path = relative(ROOT, resolve(ROOT, dirname(doc), target));
      if (path.startsWith("..") || /^[a-z]+:/i.test(target)) return link;
      const was = followLine(written[i], path, Number(at));
      const name = symbolOf(label);
      const found = name ? definitionLine(path, name, was ?? Number(at)) : was;
      if (found === undefined) { lost.push(`${doc}:${i + 1}: ${link}`); return link; }
      const relabel = label.replace(/:(\d+)$/, `:${found}`);
      if (found === Number(at) && relabel === label) return link;
      moved.push(`${doc}:${i + 1}: ${label} -> ${target}#L${found} (was #L${at})`);
      return `[${relabel}](${target}#L${found})`;
    })).join("\n");
    if (!check && next !== text) writeFileSync(join(ROOT, doc), next);
  }

  for (const m of moved) console.log(`${check ? "moved" : "updated"}: ${m}`);
  for (const l of lost) console.log(`not followed: ${l}`);
  console.log(`${moved.length} links ${check ? "out of date" : "updated"}, ${lost.length} not followed`);
  if (check && moved.length) process.exit(1);
}

/** The commit that last wrote each line of a doc (undefined for a line not yet committed). */
function blame(doc: string): Array<string | undefined> {
  const out: Array<string | undefined> = [];
  for (const line of git("blame", "--porcelain", "--", doc).split("\n")) {
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line);
    if (header) out[Number(header[2]) - 1] = /^0+$/.test(header[1]!) ? undefined : header[1];
  }
  return out;
}

const diffs = new Map<string, Array<{ from: number; gone: number; to: number; added: number }> | undefined>();

/**
 * Where line `at` of a file as it was at a commit is now, by the diff from then to the working tree. A
 * line not yet committed was written against the file as it is, so it stays.
 */
function followLine(commit: string | undefined, path: string, at: number): number | undefined {
  if (!commit) return at;
  const key = `${commit}:${path}`;
  if (!diffs.has(key)) {
    try {
      const hunks = [...git("diff", "-U0", "--no-color", "--no-renames", commit, "--", path).matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)]
        .map(h => ({ from: Number(h[1]), gone: h[2] === undefined ? 1 : Number(h[2]), to: Number(h[3]), added: h[4] === undefined ? 1 : Number(h[4]) }));
      git("cat-file", "-e", `${commit}:${path}`);
      diffs.set(key, hunks);
    } catch { diffs.set(key, undefined); }
  }
  const hunks = diffs.get(key);
  if (!hunks) return undefined;
  let shift = 0;
  for (const h of hunks) {
    // A pure insertion's "from" is the line before it; a change's is its first old line.
    const first = h.gone === 0 ? h.from + 1 : h.from;
    if (at < first) break;
    if (h.gone > 0 && at < h.from + h.gone) return Math.max(1, h.to);
    shift += h.added - h.gone;
  }
  return at + shift;
}

/** The name a link's text gives: `castSpell`, `castSpell(...)`, `Game.input` and `catalogue(state)` are all followed. */
function symbolOf(label: string): string | undefined {
  const quoted = /^`([^`]+)`$/.exec(label.trim());
  if (!quoted) return undefined;
  const name = quoted[1]!.replace(/\(.*$/, "").split(".").pop()?.trim();
  return name && /^[A-Za-z_$][\w$]*$/.test(name) ? name : undefined;
}

const sources = new Map<string, string[] | undefined>();

/** The line the name is defined on in the file now, the nearest to `near` when there are several. */
function definitionLine(path: string, name: string, near: number): number | undefined {
  if (!sources.has(path)) {
    try { sources.set(path, readFileSync(join(ROOT, path), "utf8").split("\n")); } catch { sources.set(path, undefined); }
  }
  const lines = sources.get(path);
  if (!lines) return undefined;
  const n = name.replace(/[$]/g, "\\$");
  const defines = new RegExp(
    `^\\s*(export\\s+)?(default\\s+)?(declare\\s+)?(abstract\\s+)?(async\\s+)?(function\\*?|class|const|let|var|type|interface|enum)\\s+${n}\\b` +
    `|^\\s*(public\\s+|private\\s+|protected\\s+|static\\s+|readonly\\s+|async\\s+|get\\s+|set\\s+)*${n}\\s*(<[^>]*>)?\\s*\\(` +
    `|^\\s*(readonly\\s+)?${n}\\??\\s*[:=]`,
  );
  // A method's line has its parameters closed by a type or a body ("act(id: string): Promise<string> {"); a call's ("act(id);") doesn't.
  const call = new RegExp(`^\\s*(await\\s+)?(this\\.)?${n}\\s*\\(`);
  const hits = lines.flatMap((text, i) => (
    defines.test(text) && !/^\s*(\/\/|\*|return\b|if\b|for\b|while\b|await\b)/.test(text) && !(call.test(text) && !/\)\s*(:|\{)/.test(text)) ? [i + 1] : []
  ));
  if (!hits.length) return undefined;
  return hits.reduce((best, line) => (Math.abs(line - near) < Math.abs(best - near) ? line : best));
}

main();
