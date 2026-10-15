import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import type { Plugin } from "esbuild";

/**
 * esbuild plugins shared by the static build (build.ts) and the renderer comparison
 * (src/web/tui/compare/run.ts).
 *
 * importMeta: the game finds its files from where its modules are (import.meta.url, dirname,
 * filename: the prompts beside src/runtime, the lore beside src/lore, the rules' content pack).
 * A bundle has one URL for everything, so each module's own location is written into it: under
 * `virtualRoot` (the browser's file system, "/kingmaker") for the static build, or the repo itself
 * for a bundle that runs in Node.
 */
export function importMeta(options: { root: string; virtualRoot: string }): Plugin {
  const root = resolve(options.root);
  return {
    name: "import-meta",
    setup(build) {
      build.onLoad({ filter: /\.(ts|tsx|js|mjs)$/ }, async args => {
        if (!args.path.startsWith(root) || args.path.includes("/node_modules/")) return undefined;
        const source = await readFile(args.path, "utf8");
        if (!source.includes("import.meta")) return undefined;
        const virtual = `${options.virtualRoot.replace(/\/$/, "")}/${relative(root, args.path).split("\\").join("/")}`;
        const contents = source
          .replaceAll("import.meta.url", JSON.stringify(`file://${virtual}`))
          .replaceAll("import.meta.dirname", JSON.stringify(dirname(virtual)))
          .replaceAll("import.meta.filename", JSON.stringify(virtual));
        const ext = extname(args.path).slice(1);
        return { contents, loader: ext === "tsx" ? "tsx" : ext === "ts" ? "ts" : "js", resolveDir: dirname(args.path) };
      });
    },
  };
}

/**
 * OpenTUI's ASCII fonts (cfonts' block letters, which the title and the End are drawn in), read
 * out of the installed @opentui/core: they're in its bundle as object literals after a
 * "// src/lib/fonts/<name>.json" marker. Only the named ones.
 */
export function openTuiFonts(root: string, names: string[] = ["block", "tiny"]): Record<string, unknown> {
  const dir = resolve(root, "node_modules/@opentui/core");
  const chunk = readdirSync(dir).filter(f => /^chunk-node-.*\.js$/.test(f)).map(f => readFileSync(resolve(dir, f), "utf8")).find(text => text.includes("// src/lib/fonts/block.json"));
  if (!chunk) throw new Error("OpenTUI's fonts aren't where they were (node_modules/@opentui/core/chunk-node-*.js)");
  const fonts: Record<string, unknown> = {};
  for (const name of names) {
    const marker = chunk.indexOf(`// src/lib/fonts/${name}.json`);
    const start = chunk.indexOf("{", chunk.indexOf(`var ${name}_default = `, marker));
    if (marker < 0 || start < 0) throw new Error(`OpenTUI's ${name} font isn't in its bundle`);
    let depth = 0, end = start, quote = "";
    for (let i = start; i < chunk.length; i++) {
      const c = chunk[i]!;
      if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    fonts[name] = new Function(`return (${chunk.slice(start, end + 1)});`)();
  }
  return fonts;
}

/** Modules made at build time: a name -> its source. */
export function virtualModules(modules: Record<string, () => string>): Plugin {
  return {
    name: "virtual-modules",
    setup(build) {
      const filter = new RegExp(`^(${Object.keys(modules).map(k => k.replace(/[.*+?^${}()|[\]\\:]/g, "\\$&")).join("|")})$`);
      build.onResolve({ filter }, args => ({ path: args.path, namespace: "virtual" }));
      build.onLoad({ filter: /.*/, namespace: "virtual" }, args => ({ contents: modules[args.path]!(), loader: "js" }));
    },
  };
}

/** Replace whole modules: a path (absolute) -> the module to load instead. */
export function replaceModules(replacements: Record<string, string>): Plugin {
  const map = new Map(Object.entries(replacements).map(([from, to]) => [resolve(from), resolve(to)]));
  return {
    name: "replace-modules",
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (!args.resolveDir || !(args.path.startsWith(".") || args.path.startsWith("/"))) return undefined;
        const target = map.get(resolve(args.resolveDir, args.path));
        return target ? { path: target } : undefined;
      });
    },
  };
}
