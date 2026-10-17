// Copied from the prototype's src/web/static/plugins.ts at 44c6d4a: openTuiFonts and virtualModules, whole, for the page's build (build.ts: the JS OpenTUI's core.ts registers the fonts from virtual:opentui-fonts); importMeta isn't needed (nothing in v2 finds its files from import.meta in the browser: its hosts hand them in), nor are replaceModules and stubModules (boardgame.io's debug panel is the prototype's).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "esbuild";

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
