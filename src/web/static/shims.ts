import { HASHES } from "./node/crypto.ts";

/**
 * What the game asks of Node that the static build's stand-ins (src/web/static/node) only partly
 * have. esbuild already fails the build on a module or a named import that isn't there; this finds
 * what it can't see, in the source of the modules it bundled, so that the build (build.ts) fails too
 * rather than a preview that breaks only in play:
 *
 * - createHash("<algorithm>"): node:crypto here has only the hashes in HASHES (crypto.ts).
 */
export function shimProblems(files: Array<{ path: string; source: string }>): string[] {
  const problems: string[] = [];
  for (const { path, source } of files) {
    for (const match of source.matchAll(/\bcreateHash\(\s*([^),]*?)\s*[,)]/g)) {
      const argument = match[1]!;
      const literal = /^(["'`])([\w-]+)\1$/.exec(argument);
      if (!literal) problems.push(`${path}: createHash(${argument}): the browser build can only check a hash it can read (a string literal)`);
      else if (!(HASHES as readonly string[]).includes(literal[2]!.toLowerCase())) {
        problems.push(`${path}: createHash("${literal[2]}"), and the browser build's node:crypto has only ${HASHES.join(" and ")} (src/web/static/node/crypto.ts)`);
      }
    }
  }
  return problems;
}
