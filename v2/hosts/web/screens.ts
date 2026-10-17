// After the prototype's src/web/tui/compare/run.ts at 44c6d4a (a check bundled for Node with the browser build's aliases, then run); importMeta is copied from its src/web/static/plugins.ts at 44c6d4a, whole, with its own paragraph of the comment above it.
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { build, type Metafile, type Plugin } from "esbuild";
import { tuiAliases, tuiFonts } from "./tui.ts";

/**
 * v2's screen check (client/check/screens.tsx) on the JS OpenTUI the page draws with (web/tui), so the
 * stand-in is held to everything OpenTUI's own renderer passes in `npm run screens` (browser-design
 * §5): the check bundled for Node with the stand-in in OpenTUI's place, the bundle checked for one
 * React and none of OpenTUI's native code, then run.
 *
 *   npm run web:screens [-- --show]      (the bundle is kept in runs/web-screens/)
 */

const V2 = resolve(import.meta.dirname, "..", "..");
const CHECK = join(V2, "client", "check", "screens.tsx");
const BUNDLE = join(V2, "runs", "web-screens", "screens.mjs");

async function main(argv: string[]): Promise<number> {
  const metafile = await bundled(CHECK, BUNDLE);
  onTheStandIn(metafile);
  return checked(BUNDLE, argv);
}

/** The check, bundled for Node on the stand-in: each module keeps its own import.meta, since the checks read the campaign's files from beside them. */
async function bundled(entry: string, outfile: string): Promise<Metafile> {
  const result = await build({
    absWorkingDir: V2, entryPoints: [entry], outfile, bundle: true, platform: "node", format: "esm",
    jsx: "automatic", jsxImportSource: "@opentui/react", alias: tuiAliases(V2),
    plugins: [importMeta({ root: V2, virtualRoot: V2 }), tuiFonts(V2)],
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    metafile: true, logLevel: "warning",
  });
  return result.metafile;
}

/** What makes it the stand-in's run: none of @opentui's own code, and one React, one reconciler and one scheduler (with two Reacts, the screens die on their first hook). */
function onTheStandIn(metafile: Metafile): void {
  const inputs = Object.keys(metafile.inputs);
  const native = inputs.filter(f => f.includes("node_modules/@opentui/"));
  if (native.length) throw new Error(`OpenTUI's own code is in the bundle: ${native.slice(0, 3).join(", ")}`);
  for (const name of ["react", "react-reconciler", "scheduler"]) {
    const copies = new Set(inputs.map(f => new RegExp(`^(.*node_modules/${name})/`).exec(f)?.[1]).filter(Boolean));
    if (copies.size !== 1) throw new Error(`${copies.size} copies of ${name} in the bundle: ${[...copies].join(", ")}`);
  }
}

/** The bundle run as `npm run screens` runs the check: its lines on this process's output, its exit code back. */
function checked(bundle: string, argv: string[]): number {
  return spawnSync(process.execPath, ["--no-warnings", bundle, ...argv], { cwd: V2, stdio: "inherit" }).status ?? 1;
}

/**
 * importMeta: the game finds its files from where its modules are (import.meta.url, dirname,
 * filename: the prompts beside src/runtime, the lore beside src/lore, the rules' content pack).
 * A bundle has one URL for everything, so each module's own location is written into it: under
 * `virtualRoot` (the browser's file system, "/kingmaker") for the static build, or the repo itself
 * for a bundle that runs in Node.
 */
function importMeta(options: { root: string; virtualRoot: string }): Plugin {
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

main(process.argv.slice(2)).then(code => process.exit(code), (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
