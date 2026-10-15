import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

/**
 * The page's own TypeScript (src/web/page/doors.ts: the doors' pictures, with the art it shares with
 * the game in src/game/look/door-art.ts), bundled into one module the page imports as doors.js:
 * made by the server as it starts (src/web/server.ts), and by the static build into dist/web.
 */
export const DOORS_ENTRY = fileURLToPath(new URL("./page/doors.ts", import.meta.url));

export function doorsModule(minify = false): string {
  const result = buildSync({
    entryPoints: [DOORS_ENTRY], bundle: true, format: "esm", platform: "browser", target: "es2022",
    write: false, minify, legalComments: "none", logLevel: "warning",
  });
  const out = result.outputFiles[0];
  if (!out) throw new Error("the page's doors module didn't bundle");
  return out.text;
}
