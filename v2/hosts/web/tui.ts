// openTuiFonts and virtualModules are copied from the prototype's src/web/static/plugins.ts at 44c6d4a, whole; the aliases are its src/web/tui/compare/run.ts's (:40-46), pointed at v2's copy of the stand-in.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "esbuild";

/**
 * Where web/tui stands in for OpenTUI in a bundle (browser-design §5): the page's client worker, and
 * the screen check run on the stand-in (hosts/web/screens.ts). The client imports @opentui/core and
 * @opentui/react, whose renderer is native Zig, so a bundle points them at web/tui, and OpenTUI's JSX
 * runtime at React's own. React, its reconciler and the scheduler come from v2/node_modules, where
 * web/tui finds them as the client does (web/tui/imports.test.ts): one React in the bundle. And
 * web/tui/core.ts registers OpenTUI's ASCII fonts (the title's block letters) from a module the
 * bundle makes, read out of the installed @opentui/core.
 *
 *   build({ absWorkingDir: v2, alias: tuiAliases(v2), plugins: [tuiFonts(v2)], jsx: "automatic", jsxImportSource: "@opentui/react", … })
 *
 * An alias's target is found from the working directory, so the bundle is made from v2 (absWorkingDir).
 */

/** esbuild's aliases for a bundle of the client on the stand-in, from v2's folder. */
export function tuiAliases(v2: string): Record<string, string> {
  const tui = join(v2, "web", "tui");
  return {
    "@opentui/core": join(tui, "core.ts"),
    "@opentui/react/test-utils": join(tui, "testing.ts"),
    "@opentui/react/jsx-runtime": "react/jsx-runtime",
    "@opentui/react/jsx-dev-runtime": "react/jsx-dev-runtime",
    "@opentui/react": join(tui, "react.ts"),
  };
}

/** The module web/tui/core.ts registers OpenTUI's fonts from (virtual:opentui-fonts), read out of v2's @opentui/core. */
export function tuiFonts(v2: string): Plugin {
  return virtualModules({ "virtual:opentui-fonts": () => `export default ${JSON.stringify(openTuiFonts(v2))};` });
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
