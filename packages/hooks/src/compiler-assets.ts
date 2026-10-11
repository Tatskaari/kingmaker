import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";

/** Build-time/Node reader; Vite embeds only the permitted standard library and hook API. */
export function readCompilerAssets(): Record<string, string> {
  const directory = dirname(ts.getDefaultLibFilePath({}));
  const files: Record<string, string> = {};
  function include(name: string) {
    if (files[`/${name}`]) return;
    const text = readFileSync(join(directory, name), "utf8");
    files[`/${name}`] = text;
    for (const match of text.matchAll(/<reference lib="([^"]+)"/g)) include(`lib.${match[1]}.d.ts`);
  }
  include("lib.es2020.d.ts");
  files["/api.d.ts"] = readFileSync(new URL("./services.ts", import.meta.url), "utf8").replace(/^export /gm, "");
  return files;
}
export default readCompilerAssets();
